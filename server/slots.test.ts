import { describe, expect, it } from 'vitest';
import { conflictsWithMeetings, generateSlots, intervalsOverlap } from './slots.js';
import type { Availability, Meeting } from './types.js';

// Use a fixed UTC-based availability so slot counts are deterministic
// regardless of the machine timezone or DST.
const utcAvailability: Availability = {
  timezone: 'UTC',
  weeklyWindows: [
    { day: 1, start: '09:00', end: '17:00' }, // Monday
  ],
  durations: [30, 60],
  bufferMinutes: 15,
  blackoutDates: [],
};

// 2026-08-17 is a Monday.
const MONDAY = new Date('2026-08-17T00:00:00.000Z');
const PAST_NOW = new Date('2020-01-01T00:00:00.000Z');

describe('intervalsOverlap', () => {
  it('detects overlap and non-overlap', () => {
    expect(intervalsOverlap(0, 10, 5, 15)).toBe(true);
    expect(intervalsOverlap(0, 10, 10, 20)).toBe(false); // touching edges
    expect(intervalsOverlap(0, 10, 20, 30)).toBe(false);
  });
});

describe('generateSlots', () => {
  it('generates duration+buffer stepped slots inside a window', () => {
    const slots = generateSlots({
      availability: utcAvailability,
      duration: 30,
      from: MONDAY,
      to: new Date('2026-08-17T23:59:59.000Z'),
      meetings: [],
      now: PAST_NOW,
    });
    // Window 09:00-17:00 (480 min), step 45 (30+15). Starts at 0,45,...
    // last start s with s+30 <= 480 => s <= 450 => 450/45 = 10 => 11 slots.
    expect(slots.length).toBe(11);
    expect(slots[0].start).toBe('2026-08-17T09:00:00.000Z');
    expect(slots[0].end).toBe('2026-08-17T09:30:00.000Z');
    expect(slots[1].start).toBe('2026-08-17T09:45:00.000Z');
  });

  it('changes count with a longer duration', () => {
    const slots = generateSlots({
      availability: utcAvailability,
      duration: 60,
      from: MONDAY,
      to: new Date('2026-08-17T23:59:59.000Z'),
      meetings: [],
      now: PAST_NOW,
    });
    // step 75 (60+15), s+60<=480 => s<=420 => 420/75=5.6 => starts 0..375 => 6 slots
    expect(slots.length).toBe(6);
  });

  it('excludes blackout dates', () => {
    const slots = generateSlots({
      availability: { ...utcAvailability, blackoutDates: ['2026-08-17'] },
      duration: 30,
      from: MONDAY,
      to: new Date('2026-08-17T23:59:59.000Z'),
      meetings: [],
      now: PAST_NOW,
    });
    expect(slots.length).toBe(0);
  });

  it('excludes slots that conflict with a confirmed meeting (with buffer)', () => {
    const meeting: Meeting = {
      id: 'm1',
      requestId: 'r1',
      name: 'X',
      email: 'x@y.com',
      note: '',
      start: '2026-08-17T09:00:00.000Z',
      end: '2026-08-17T09:30:00.000Z',
      durationMinutes: 30,
      status: 'confirmed',
      createdAt: PAST_NOW.toISOString(),
    };
    const slots = generateSlots({
      availability: utcAvailability,
      duration: 30,
      from: MONDAY,
      to: new Date('2026-08-17T23:59:59.000Z'),
      meetings: [meeting],
      now: PAST_NOW,
    });
    // 09:00 slot removed, and 09:45 removed because meeting end 09:30 + 15 buffer
    // = 09:45 blocks a slot starting at 09:45? overlap is exclusive at the edge,
    // so 09:45 survives. The 09:00 slot is removed. Expect one fewer than 11.
    expect(slots.some((s) => s.start === '2026-08-17T09:00:00.000Z')).toBe(false);
    expect(slots.length).toBe(10);
  });

  it('converts wall-clock time to the correct UTC instant for a fixed-offset zone', () => {
    // America/Phoenix does not observe DST; it is UTC-7 year round.
    const phoenix: Availability = {
      ...utcAvailability,
      timezone: 'America/Phoenix',
    };
    const slots = generateSlots({
      availability: phoenix,
      duration: 30,
      from: MONDAY,
      to: new Date('2026-08-18T12:00:00.000Z'),
      meetings: [],
      now: PAST_NOW,
    });
    // 09:00 Phoenix (UTC-7) == 16:00 UTC.
    expect(slots[0].start).toBe('2026-08-17T16:00:00.000Z');
  });
});

describe('conflictsWithMeetings', () => {
  const meeting: Meeting = {
    id: 'm1',
    requestId: 'r1',
    name: 'X',
    email: 'x@y.com',
    note: '',
    start: '2026-08-17T10:00:00.000Z',
    end: '2026-08-17T10:30:00.000Z',
    durationMinutes: 30,
    status: 'confirmed',
    createdAt: PAST_NOW.toISOString(),
  };

  it('flags an overlapping time', () => {
    expect(
      conflictsWithMeetings(
        new Date('2026-08-17T10:15:00.000Z'),
        new Date('2026-08-17T10:45:00.000Z'),
        [meeting],
        0,
      ),
    ).toBe(true);
  });

  it('respects the buffer', () => {
    // 10:30 to 11:00 does not overlap the meeting, but a 15 min buffer does.
    expect(
      conflictsWithMeetings(
        new Date('2026-08-17T10:30:00.000Z'),
        new Date('2026-08-17T11:00:00.000Z'),
        [meeting],
        0,
      ),
    ).toBe(false);
    expect(
      conflictsWithMeetings(
        new Date('2026-08-17T10:30:00.000Z'),
        new Date('2026-08-17T11:00:00.000Z'),
        [meeting],
        15,
      ),
    ).toBe(true);
  });

  it('ignores cancelled meetings', () => {
    const cancelled: Meeting = { ...meeting, status: 'cancelled' };
    expect(
      conflictsWithMeetings(
        new Date('2026-08-17T10:15:00.000Z'),
        new Date('2026-08-17T10:45:00.000Z'),
        [cancelled],
        0,
      ),
    ).toBe(false);
  });
});
