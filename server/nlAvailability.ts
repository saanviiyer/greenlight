// Rule-based natural-language availability parser. Used directly as the offline
// fallback, and as the safety net when the AI parser is unavailable or errors.

import type { WeeklyWindow } from './types.js';

export interface ParseResult {
  windows: WeeklyWindow[];
  warnings: string[];
}

const DAY_TOKENS: Array<{ re: RegExp; days: number[] }> = [
  { re: /\bweekdays?\b/, days: [1, 2, 3, 4, 5] },
  { re: /\bweekends?\b/, days: [0, 6] },
  { re: /\b(everyday|every day|daily|all week)\b/, days: [0, 1, 2, 3, 4, 5, 6] },
  { re: /\b(sun|sunday)\b/, days: [0] },
  { re: /\b(mon|monday)\b/, days: [1] },
  { re: /\b(tue|tues|tuesday)\b/, days: [2] },
  { re: /\b(wed|weds|wednesday)\b/, days: [3] },
  { re: /\b(thu|thur|thurs|thursday)\b/, days: [4] },
  { re: /\b(fri|friday)\b/, days: [5] },
  { re: /\b(sat|saturday)\b/, days: [6] },
];

const PERIOD_WINDOWS: Record<string, { start: number; end: number; ampm: 'am' | 'pm' }> = {
  morning: { start: 9 * 60, end: 12 * 60, ampm: 'am' },
  afternoon: { start: 12 * 60, end: 17 * 60, ampm: 'pm' },
  evening: { start: 17 * 60, end: 20 * 60, ampm: 'pm' },
  night: { start: 18 * 60, end: 21 * 60, ampm: 'pm' },
};

function toMinutes(hour: number, minute: number, ampm: 'am' | 'pm' | null): number {
  let h = hour;
  if (ampm === 'pm' && h < 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  return h * 60 + minute;
}

// Resolves an hour to minutes-since-midnight. An explicit am/pm always wins.
// A bare 12 with no explicit marker means noon, so "10 to 12" reads as 10:00
// to 12:00 rather than 10:00 to midnight.
function resolveHour(
  hour: number,
  minute: number,
  explicitAmpm: 'am' | 'pm' | null,
  contextAmpm: 'am' | 'pm' | null,
): number {
  if (explicitAmpm) return toMinutes(hour, minute, explicitAmpm);
  if (hour === 12) return 12 * 60 + minute;
  if (contextAmpm) return toMinutes(hour, minute, contextAmpm);
  return toMinutes(hour, minute, null);
}

function fmt(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Detects which weekday numbers a phrase refers to. Defaults to weekdays.
function detectDays(text: string): { days: number[]; warning: string | null } {
  const found = new Set<number>();
  for (const tok of DAY_TOKENS) {
    if (tok.re.test(text)) tok.days.forEach((d) => found.add(d));
  }
  if (found.size === 0) {
    return { days: [1, 2, 3, 4, 5], warning: 'No days recognized; defaulted to weekdays.' };
  }
  return { days: [...found].sort((a, b) => a - b), warning: null };
}

// Detects a time range from an explicit range or a period word.
function detectRange(
  text: string,
): { start: number; end: number; warning: string | null } {
  const period = Object.keys(PERIOD_WINDOWS).find((p) => new RegExp(`\\b${p}s?\\b`).test(text));
  const contextAmpm = period ? PERIOD_WINDOWS[period].ampm : null;

  const rangeRe =
    /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|to|until|through|\u2013|\u2014)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/;
  const match = text.match(rangeRe);
  if (match) {
    const sh = Number(match[1]);
    const sm = Number(match[2] || 0);
    const sap = (match[3] as 'am' | 'pm' | undefined) ?? null;
    const eh = Number(match[4]);
    const em = Number(match[5] || 0);
    const eap = (match[6] as 'am' | 'pm' | undefined) ?? null;

    const start = resolveHour(sh, sm, sap, contextAmpm);
    let end = resolveHour(eh, em, eap, contextAmpm ?? sap);
    // If end lands before start (e.g. "9 to 5" read as 9am to 5am), nudge the
    // end into the afternoon.
    if (end <= start && eap !== 'am') {
      end = toMinutes(eh, em, 'pm');
    }
    if (end <= start) {
      return {
        start,
        end: start + 60,
        warning: 'End time was not after start time; adjusted to a one hour window.',
      };
    }
    return { start, end, warning: null };
  }

  if (period) {
    const w = PERIOD_WINDOWS[period];
    return { start: w.start, end: w.end, warning: null };
  }

  return {
    start: 9 * 60,
    end: 17 * 60,
    warning: 'No time range recognized; defaulted to 09:00 to 17:00.',
  };
}

export function parseAvailabilityText(input: string): ParseResult {
  const text = input.toLowerCase().trim();
  const warnings: string[] = [];
  if (!text) {
    return { windows: [], warnings: ['Empty input.'] };
  }

  const { days, warning: dayWarning } = detectDays(text);
  const { start, end, warning: rangeWarning } = detectRange(text);
  if (dayWarning) warnings.push(dayWarning);
  if (rangeWarning) warnings.push(rangeWarning);

  const windows: WeeklyWindow[] = days.map((day) => ({
    day,
    start: fmt(start),
    end: fmt(end),
  }));

  return { windows, warnings };
}
