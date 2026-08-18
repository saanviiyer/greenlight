// Pure slot-generation and double-book prevention logic. No I/O here so it can
// be unit tested in isolation.

import type { Availability, Meeting, Slot } from './types.js';
import { dateKey, parseHHMM, partsInZone, zonedWallTimeToUtc } from './time.js';

export function intervalsOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

// True if [start, end] conflicts with any confirmed meeting, expanded by the
// buffer on both sides. This is the core double-book guard.
export function conflictsWithMeetings(
  start: Date,
  end: Date,
  meetings: Meeting[],
  bufferMinutes: number,
): boolean {
  const bufferMs = bufferMinutes * 60_000;
  const s = start.getTime();
  const e = end.getTime();
  for (const m of meetings) {
    if (m.status !== 'confirmed') continue;
    const ms = new Date(m.start).getTime() - bufferMs;
    const me = new Date(m.end).getTime() + bufferMs;
    if (intervalsOverlap(s, e, ms, me)) return true;
  }
  return false;
}

export interface GenerateSlotsInput {
  availability: Availability;
  duration: number; // minutes
  from: Date;
  to: Date;
  meetings: Meeting[];
  now?: Date; // slots at or before `now` are excluded
}

// Generates bookable slots from the availability rules within [from, to],
// excluding blackout dates, past times, and slots that conflict with confirmed
// meetings (respecting the buffer). Slots are returned as UTC instants.
export function generateSlots(input: GenerateSlotsInput): Slot[] {
  const { availability, duration, from, to, meetings } = input;
  const now = input.now ?? new Date();
  const tz = availability.timezone;
  const step = duration + availability.bufferMinutes;
  const blackout = new Set(availability.blackoutDates);
  const slots: Slot[] = [];

  const startParts = partsInZone(from, tz);
  const dayCount =
    Math.ceil((to.getTime() - from.getTime()) / 86_400_000) + 1;

  for (let i = 0; i < dayCount; i++) {
    // Enumerate calendar dates using UTC arithmetic (safe for date math).
    const cursor = new Date(
      Date.UTC(startParts.year, startParts.month - 1, startParts.day + i),
    );
    const y = cursor.getUTCFullYear();
    const mo = cursor.getUTCMonth() + 1;
    const d = cursor.getUTCDate();
    const weekday = cursor.getUTCDay();
    const key = dateKey(y, mo, d);
    if (blackout.has(key)) continue;

    const windows = availability.weeklyWindows.filter((w) => w.day === weekday);
    for (const w of windows) {
      const winStart = parseHHMM(w.start);
      const winEnd = parseHHMM(w.end);
      for (let m = winStart; m + duration <= winEnd; m += step) {
        const hour = Math.floor(m / 60);
        const minute = m % 60;
        let slotStart: Date;
        try {
          slotStart = zonedWallTimeToUtc(y, mo, d, hour, minute, tz);
        } catch (error) {
          if (error instanceof RangeError) continue; // DST spring-forward gap
          throw error;
        }
        const slotEnd = new Date(slotStart.getTime() + duration * 60_000);
        if (slotStart.getTime() <= now.getTime()) continue;
        if (slotStart.getTime() < from.getTime()) continue;
        if (slotEnd.getTime() > to.getTime()) continue;
        if (
          conflictsWithMeetings(
            slotStart,
            slotEnd,
            meetings,
            availability.bufferMinutes,
          )
        ) {
          continue;
        }
        slots.push({
          start: slotStart.toISOString(),
          end: slotEnd.toISOString(),
          durationMinutes: duration,
        });
      }
    }
  }

  slots.sort((a, b) => a.start.localeCompare(b.start));
  return slots;
}
