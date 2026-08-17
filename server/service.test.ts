import { describe, expect, it } from 'vitest';
import { MemoryStore } from './store.js';
import {
  HttpError,
  approveRequest,
  createRequest,
  declineRequest,
  getAvailableSlots,
} from './service.js';
import type { Availability } from './types.js';

// Availability far enough in the future that slots are never in the past.
function makeStore(): MemoryStore {
  const availability: Availability = {
    timezone: 'UTC',
    weeklyWindows: [
      { day: 0, start: '09:00', end: '17:00' },
      { day: 1, start: '09:00', end: '17:00' },
      { day: 2, start: '09:00', end: '17:00' },
      { day: 3, start: '09:00', end: '17:00' },
      { day: 4, start: '09:00', end: '17:00' },
      { day: 5, start: '09:00', end: '17:00' },
      { day: 6, start: '09:00', end: '17:00' },
    ],
    durations: [30, 60],
    bufferMinutes: 15,
    blackoutDates: [],
  };
  return new MemoryStore({ availability });
}

function futureSlotStart(): string {
  // Next available 09:00 UTC that is comfortably in the future.
  const d = new Date(Date.now() + 3 * 86_400_000);
  d.setUTCHours(9, 0, 0, 0);
  return d.toISOString();
}

describe('request -> approve -> slot removed', () => {
  it('confirms the meeting and removes the slot so it cannot be double-booked', () => {
    const store = makeStore();
    const start = futureSlotStart();

    // The slot is available before booking.
    const before = getAvailableSlots(store, { duration: 30 });
    expect(before.some((s) => s.start === start)).toBe(true);

    const request = createRequest(store, {
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      note: 'Discuss the analytical engine',
      start,
      durationMinutes: 30,
    });
    expect(request.status).toBe('pending');

    // Still pending, so still offered until approved.
    const duringPending = getAvailableSlots(store, { duration: 30 });
    expect(duringPending.some((s) => s.start === start)).toBe(true);

    const { request: approved, meeting } = approveRequest(store, request.id, 'See you then');
    expect(approved.status).toBe('approved');
    expect(meeting.status).toBe('confirmed');
    expect(meeting.start).toBe(start);

    // The slot is gone from availability after approval.
    const after = getAvailableSlots(store, { duration: 30 });
    expect(after.some((s) => s.start === start)).toBe(false);
  });

  it('prevents double-booking a conflicting request after approval', () => {
    const store = makeStore();
    const start = futureSlotStart();

    const a = createRequest(store, {
      name: 'A',
      email: 'a@example.com',
      note: 'first',
      start,
      durationMinutes: 30,
    });
    const b = createRequest(store, {
      name: 'B',
      email: 'b@example.com',
      note: 'second, same slot',
      start,
      durationMinutes: 30,
    });

    approveRequest(store, a.id, undefined);
    expect(() => approveRequest(store, b.id, undefined)).toThrowError(HttpError);
  });
});

describe('request state machine', () => {
  it('rejects approving an already-decided request', () => {
    const store = makeStore();
    const start = futureSlotStart();
    const req = createRequest(store, {
      name: 'C',
      email: 'c@example.com',
      note: 'hi there please',
      start,
      durationMinutes: 30,
    });
    approveRequest(store, req.id, undefined);
    expect(() => approveRequest(store, req.id, undefined)).toThrowError(/already approved/);
  });

  it('declines a pending request and blocks re-decision', () => {
    const store = makeStore();
    const start = futureSlotStart();
    const req = createRequest(store, {
      name: 'D',
      email: 'd@example.com',
      note: 'please meet',
      start,
      durationMinutes: 30,
    });
    const declined = declineRequest(store, req.id, 'No time this week');
    expect(declined.status).toBe('declined');
    expect(declined.decisionMessage).toBe('No time this week');
    expect(() => declineRequest(store, req.id, undefined)).toThrowError(/already declined/);
    expect(() => approveRequest(store, req.id, undefined)).toThrowError(/already declined/);
  });

  it('rejects an unknown request id', () => {
    const store = makeStore();
    expect(() => approveRequest(store, 'nope', undefined)).toThrowError(/not found/);
  });

  it('validates request input', () => {
    const store = makeStore();
    expect(() =>
      createRequest(store, {
        name: '',
        email: 'bad',
        start: futureSlotStart(),
        durationMinutes: 30,
      }),
    ).toThrowError(HttpError);
  });
});
