import type { Availability, WeeklyWindow } from './types.js';
import { parseHHMM } from './time.js';
export class ValidationError extends Error {}
function validDateKey(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value); if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() + 1 === Number(match[2]) && date.getUTCDate() === Number(match[3]);
}
function parseWindow(value: unknown): WeeklyWindow {
  if (!value || typeof value !== 'object') throw new ValidationError('Each availability window must be an object.');
  const item = value as Partial<WeeklyWindow>;
  if (!Number.isInteger(item.day) || Number(item.day) < 0 || Number(item.day) > 6) throw new ValidationError('Availability window days must be integers from 0 to 6.');
  if (typeof item.start !== 'string' || typeof item.end !== 'string') throw new ValidationError('Availability windows require start and end times.');
  let start: number; let end: number;
  try { start = parseHHMM(item.start); end = parseHHMM(item.end); }
  catch { throw new ValidationError('Availability times must use valid 24-hour HH:MM values.'); }
  if (start >= end) throw new ValidationError('Availability window end times must be after start times.');
  return { day: Number(item.day), start: item.start, end: item.end };
}
export function validateAvailability(value: unknown): Availability {
  if (!value || typeof value !== 'object') throw new ValidationError('Invalid availability payload.');
  const body = value as Partial<Availability>;
  if (typeof body.timezone !== 'string' || body.timezone.length > 100) throw new ValidationError('A valid timezone is required.');
  try { new Intl.DateTimeFormat('en-US', { timeZone: body.timezone }); }
  catch { throw new ValidationError(`Unknown timezone: ${body.timezone}`); }
  if (!Array.isArray(body.weeklyWindows) || body.weeklyWindows.length > 100) throw new ValidationError('Weekly windows must be an array of at most 100 entries.');
  const weeklyWindows = body.weeklyWindows.map(parseWindow); const seen = new Set<string>();
  for (const item of weeklyWindows) { const key = `${item.day}:${item.start}-${item.end}`; if (seen.has(key)) throw new ValidationError('Duplicate availability windows are not allowed.'); seen.add(key); }
  if (!Array.isArray(body.durations) || body.durations.length === 0 || body.durations.length > 20) throw new ValidationError('Provide between 1 and 20 meeting durations.');
  const durations = [...new Set(body.durations.map(Number))];
  if (durations.some((item) => !Number.isInteger(item) || item < 5 || item > 480)) throw new ValidationError('Meeting durations must be whole minutes between 5 and 480.');
  const bufferMinutes = Number(body.bufferMinutes);
  if (!Number.isInteger(bufferMinutes) || bufferMinutes < 0 || bufferMinutes > 240) throw new ValidationError('Buffer must be a whole number from 0 to 240 minutes.');
  if (!Array.isArray(body.blackoutDates) || body.blackoutDates.length > 1_000) throw new ValidationError('Blackout dates must be an array of at most 1,000 dates.');
  const blackoutDates = [...new Set(body.blackoutDates)];
  if (blackoutDates.some((item) => typeof item !== 'string' || !validDateKey(item))) throw new ValidationError('Blackout dates must be real dates in YYYY-MM-DD format.');
  return { timezone: body.timezone, weeklyWindows: weeklyWindows.sort((a, b) => a.day - b.day || a.start.localeCompare(b.start)), durations: durations.sort((a, b) => a - b), bufferMinutes, blackoutDates: blackoutDates.sort() };
}
