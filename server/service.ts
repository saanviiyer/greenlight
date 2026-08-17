// Business logic layer sitting between the HTTP routes and the store. Uses the
// pure slot logic and enforces the request state machine and double-book
// prevention. Kept free of Express so it can be unit tested directly.

import type { Meeting, MeetingRequest, Slot } from './types.js';
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

let counter = 0;
function id(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

export function getAvailableSlots(
  store: Store,
  opts: { duration?: number; days?: number; now?: Date } = {},
): Slot[] {
  const availability = store.getAvailability();
  const now = opts.now ?? new Date();
  const days = opts.days ?? 14;
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
  const email = (input.email || '').trim();
  if (!name) throw new HttpError(400, 'Name is required.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new HttpError(400, 'A valid email is required.');
  }
  if (!input.start || Number.isNaN(Date.parse(input.start))) {
    throw new HttpError(400, 'A valid start time is required.');
  }
  const duration = Number(input.durationMinutes);
  if (!availability.durations.includes(duration)) {
    throw new HttpError(400, `Duration ${duration} is not offered.`);
  }

  const start = new Date(input.start);
  const end = new Date(start.getTime() + duration * 60_000);
  if (start.getTime() <= Date.now()) {
    throw new HttpError(400, 'That time is in the past.');
  }

  // The slot must still be open against confirmed meetings.
  const meetings = store.listMeetings('confirmed');
  if (conflictsWithMeetings(start, end, meetings, availability.bufferMinutes)) {
    throw new HttpError(409, 'That time is no longer available.');
  }

  const request: MeetingRequest = {
    id: id('req'),
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
  sendNotification({
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
  const request = store.getRequest(requestId);
  if (!request) throw new HttpError(404, 'Request not found.');
  if (request.status !== 'pending') {
    throw new HttpError(409, `Request is already ${request.status}.`);
  }

  const availability = store.getAvailability();
  const start = new Date(request.start);
  const end = new Date(request.end);
  const meetings = store.listMeetings('confirmed');
  // Double-book prevention: refuse if the slot now conflicts.
  if (conflictsWithMeetings(start, end, meetings, availability.bufferMinutes)) {
    throw new HttpError(409, 'That time now conflicts with a confirmed meeting.');
  }

  const now = new Date().toISOString();
  const meeting: Meeting = {
    id: id('mtg'),
    requestId: request.id,
    name: request.name,
    email: request.email,
    note: request.note,
    start: request.start,
    end: request.end,
    durationMinutes: request.durationMinutes,
    status: 'confirmed',
    createdAt: now,
  };
  store.createMeeting(meeting);

  const updated: MeetingRequest = {
    ...request,
    status: 'approved',
    decidedAt: now,
    decisionMessage: message?.trim() || undefined,
  };
  store.updateRequest(updated);

  sendNotification({
    type: 'request.approved',
    to: request.email,
    subject: 'Your meeting request was approved',
    body: message?.trim() || `Your meeting on ${request.start} is confirmed.`,
  });

  return { request: updated, meeting };
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
    decisionMessage: message?.trim() || undefined,
  };
  store.updateRequest(updated);
  sendNotification({
    type: 'request.declined',
    to: request.email,
    subject: 'Update on your meeting request',
    body: message?.trim() || 'Unfortunately that time does not work.',
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
  sendNotification({
    type: 'meeting.cancelled',
    to: meeting.email,
    subject: 'Your meeting was cancelled',
    body: `The meeting on ${meeting.start} has been cancelled.`,
  });
  return updated;
}
