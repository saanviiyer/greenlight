// Timezone helpers built on the Intl API so we avoid a date library dependency.

// Returns the offset in milliseconds between the given timezone and UTC at the
// given instant. Positive means the zone is ahead of UTC.
export function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const asUTC = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );
  return asUTC - date.getTime();
}

// Converts a wall-clock time in a given timezone into a UTC Date instant.
export function zonedWallTimeToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  // Offsets around a transition may differ. Try both sides of the target day,
  // retain only instants that round-trip to the requested wall clock, and pick
  // the earliest occurrence when a fall-back hour is ambiguous.
  const offsets = new Set(
    [-86_400_000, 0, 86_400_000].map((delta) =>
      timeZoneOffsetMs(new Date(guess + delta), timeZone),
    ),
  );
  const matches = [...offsets]
    .map((offset) => new Date(guess - offset))
    .filter((candidate) => {
      const parts = wallPartsInZone(candidate, timeZone);
      return (
        parts.year === year &&
        parts.month === month &&
        parts.day === day &&
        parts.hour === hour &&
        parts.minute === minute
      );
    })
    .sort((a, b) => a.getTime() - b.getTime());
  if (matches.length === 0) {
    throw new RangeError(
      `Local time ${dateKey(year, month, day)} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} does not exist in ${timeZone}.`,
    );
  }
  return matches[0];
}

export function wallPartsInZone(
  date: Date,
  timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) map[part.type] = part.value;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
  };
}

// Returns the calendar parts of an instant as seen in a given timezone.
export function partsInZone(
  date: Date,
  timeZone: string,
): { year: number; month: number; day: number; weekday: number } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    weekday: weekdayNames.indexOf(map.weekday),
  };
}

// Parses "HH:MM" into total minutes since midnight.
export function parseHHMM(value: string): number {
  const [h, m] = value.split(':').map(Number);
  if (!/^\d{2}:\d{2}$/.test(value) || h < 0 || h > 23 || m < 0 || m > 59) {
    throw new RangeError(`Invalid wall-clock time: ${value}`);
  }
  return h * 60 + m;
}

// Formats a "YYYY-MM-DD" key from numeric parts.
export function dateKey(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}
