// Business logic layer sitting between the HTTP routes and the store. Uses the
// pure slot logic and enforces the request state machine and double-book
// prevention. Kept free of Express so it can be unit tested directly.

import type { Meeting, MeetingRequest, Slot } from './types.js';
import { randomUUID } from 'node:crypto';
import type { Store } from './store.js';
import { conflictsWithMeetings, generateSlots } from './slots.js';
import { sendNotification } from './notify.js';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function id(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

const BOOKING_HORIZON_DAYS = Math.min(365, Math.max(1, Number(process.env.BOOKING_HORIZON_DAYS) || 14));
const MIN_NOTICE_MINUTES = Math.min(10_080, Math.max(0, Number(process.env.MIN_NOTICE_MINUTES) || 60));

function notifySafely(notification: Parameters<typeof sendNotification>[0]): void {
  try { sendNotification(notification); }
  catch (error) { console.error('[notify] delivery hook failed:', (error as Error).message); }
}

export function getAvailableSlots(
  store: Store,
  opts: { duration?: number; days?: number; now?: Date } = {},
): Slot[] {
  const availability = store.getAvailability();
  const now = opts.now ?? new Date();
  const days = opts.days ?? BOOKING_HORIZON_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > 60) throw new HttpError(400, 'Days must be a whole number from 1 to 60.');
  const duration = opts.duration ?? availability.durations[0];
  if (!availability.durations.includes(duration)) {
    throw new HttpError(400, `Duration ${duration} is not offered.`);
  }
  const from = now;
  const to = new Date(now.getTime() + days * 86_400_000);
  const meetings = store.listMeetings('confirmed');
  return generateSlots({ availability, duration, from, to, meetings, now });
}

export interface CreateRequestInput {
  name: string;
  email: string;
  note?: string;
  start: string;
  durationMinutes: number;
}

export function createRequest(
  store: Store,
  input: CreateRequestInput,
): MeetingRequest {
  const availability = store.getAvailability();
  const name = (input.name || '').trim();
  const email = (input.email || '').trim().toLowerCase();
  if (!name) throw new HttpError(400, 'Name is required.');
  if (name.length > 120) throw new HttpError(400, 'Name must be 120 characters or fewer.');
  if ((input.note || '').length > 4_000) throw new HttpError(400, 'Reason must be 4,000 characters or fewer.');
  if (email.length > 254) throw new HttpError(400, 'Email must be 254 characters or fewer.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new HttpError(400, 'A valid email is required.');
  }
  if (!input.start || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(input.start) || Number.isNaN(Date.parse(input.start))) {
    throw new HttpError(400, 'A valid start time is required.');
  }
  const duration = Number(input.durationMinutes);
  if (!availability.durations.includes(duration)) {
    throw new HttpError(400, `Duration ${duration} is not offered.`);
  }

  const start = new Date(input.start);
  const end = new Date(start.getTime() + duration * 60_000);
  const now = new Date();
  if (start.getTime() < now.getTime() + MIN_NOTICE_MINUTES * 60_000) {
    throw new HttpError(400, `Bookings require at least ${MIN_NOTICE_MINUTES} minutes of notice.`);
  }
  const meetings = store.listMeetings('confirmed');
  const horizon = now.getTime() + BOOKING_HORIZON_DAYS * 86_400_000;
  if (start.getTime() > horizon) throw new HttpError(400, `Bookings are limited to ${BOOKING_HORIZON_DAYS} days ahead.`);
  // Recompute the authoritative schedule. This rejects forged times that are
  // outside a window, on a blackout date, misaligned to the slot cadence, or
  // made stale by a newly confirmed meeting.
  const valid = generateSlots({
    availability,
    duration,
    from: new Date(start.getTime() - 86_400_000),
    to: new Date(end.getTime() + 86_400_000),
    meetings,
    now: new Date(now.getTime() + MIN_NOTICE_MINUTES * 60_000 - 1),
  }).some((slot) => slot.start === start.toISOString() && slot.end === end.toISOString());
  if (!valid || conflictsWithMeetings(start, end, meetings, availability.bufferMinutes)) {
    throw new HttpError(409, 'That time is no longer available.');
  }
  if (store.listRequests('pending').some((request) => request.email === email && request.start === start.toISOString())) {
    throw new HttpError(409, 'You already have a pending request for that time.');
  }

  const request: MeetingRequest = {
    id: id('req'),
    statusToken: randomUUID(),
    name,
    email,
    note: (input.note || '').trim(),
    start: start.toISOString(),
    end: end.toISOString(),
    durationMinutes: duration,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  store.createRequest(request);
  notifySafely({
    type: 'request.created',
    to: 'owner',
    subject: `New meeting request from ${name}`,
    body: `${name} (${email}) requested ${request.start}. Reason: ${request.note || 'none'}`,
  });
  return request;
}

export function approveRequest(
  store: Store,
  requestId: string,
  message?: string,
): { request: MeetingRequest; meeting: Meeting } {
  const result = store.transaction(() => {
    const request = store.getRequest(requestId);
    if (!request) throw new HttpError(404, 'Request not found.');
    if (request.status !== 'pending') throw new HttpError(409, `Request is already ${request.status}.`);
    const availability = store.getAvailability();
    const start = new Date(request.start); const end = new Date(request.end);
    if (conflictsWithMeetings(start, end, store.listMeetings('confirmed'), availability.bufferMinutes)) throw new HttpError(409, 'That time now conflicts with a confirmed meeting.');
    const now = new Date().toISOString();
    const meeting: Meeting = { id: id('mtg'), requestId: request.id, name: request.name, email: request.email, note: request.note, start: request.start, end: request.end, durationMinutes: request.durationMinutes, status: 'confirmed', createdAt: now };
    const updated: MeetingRequest = { ...request, status: 'approved', decidedAt: now, decisionMessage: message?.trim().slice(0, 2_000) || undefined };
    store.createMeeting(meeting); store.updateRequest(updated);
    return { request: updated, meeting };
  });
  notifySafely({
    type: 'request.approved',
    to: result.request.email,
    subject: 'Your meeting request was approved',
    body: message?.trim().slice(0, 2_000) || `Your meeting on ${result.request.start} is confirmed.`,
  });
  return result;
}

export function declineRequest(
  store: Store,
  requestId: string,
  message?: string,
): MeetingRequest {
  const request = store.getRequest(requestId);
  if (!request) throw new HttpError(404, 'Request not found.');
  if (request.status !== 'pending') {
    throw new HttpError(409, `Request is already ${request.status}.`);
  }
  const now = new Date().toISOString();
  const updated: MeetingRequest = {
    ...request,
    status: 'declined',
    decidedAt: now,
    decisionMessage: message?.trim().slice(0, 2_000) || undefined,
  };
  store.updateRequest(updated);
  notifySafely({
    type: 'request.declined',
    to: request.email,
    subject: 'Update on your meeting request',
    body: message?.trim().slice(0, 2_000) || 'Unfortunately that time does not work.',
  });
  return updated;
}

export function cancelMeeting(store: Store, meetingId: string): Meeting {
  const meeting = store.getMeeting(meetingId);
  if (!meeting) throw new HttpError(404, 'Meeting not found.');
  if (meeting.status !== 'confirmed') {
    throw new HttpError(409, `Meeting is already ${meeting.status}.`);
  }
  const updated: Meeting = {
    ...meeting,
    status: 'cancelled',
    cancelledAt: new Date().toISOString(),
  };
  store.updateMeeting(updated);
  notifySafely({
    type: 'meeting.cancelled',
    to: meeting.email,
    subject: 'Your meeting was cancelled',
    body: `The meeting on ${meeting.start} has been cancelled.`,
  });
  return updated;
}
