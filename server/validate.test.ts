import { describe, expect, it } from 'vitest';
import { validateAvailability } from './validate.js';

const valid = { timezone: 'UTC', weeklyWindows: [{ day: 1, start: '09:00', end: '17:00' }], durations: [60, 30, 30], bufferMinutes: 15, blackoutDates: ['2026-08-17'] };

describe('availability validation', () => {
  it('normalizes unique durations and stable ordering', () => {
    expect(validateAvailability(valid).durations).toEqual([30, 60]);
  });
  it('rejects invalid zones, clocks, ranges, buffers, and calendar dates', () => {
    expect(() => validateAvailability({ ...valid, timezone: 'Mars/Olympus' })).toThrow(/Unknown timezone/);
    expect(() => validateAvailability({ ...valid, weeklyWindows: [{ day: 1, start: '25:00', end: '26:00' }] })).toThrow(/24-hour/);
    expect(() => validateAvailability({ ...valid, weeklyWindows: [{ day: 1, start: '17:00', end: '09:00' }] })).toThrow(/after start/);
    expect(() => validateAvailability({ ...valid, bufferMinutes: -1 })).toThrow(/Buffer/);
    expect(() => validateAvailability({ ...valid, blackoutDates: ['2026-02-30'] })).toThrow(/real dates/);
  });
});
