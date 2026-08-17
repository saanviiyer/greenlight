import { describe, expect, it } from 'vitest';
import { parseAvailabilityText } from './nlAvailability.js';

describe('parseAvailabilityText', () => {
  it('parses "weekday afternoons 2 to 5"', () => {
    const { windows } = parseAvailabilityText('weekday afternoons 2 to 5');
    expect(windows.map((w) => w.day)).toEqual([1, 2, 3, 4, 5]);
    expect(windows[0].start).toBe('14:00');
    expect(windows[0].end).toBe('17:00');
  });

  it('parses "weekdays 9am-5pm"', () => {
    const { windows } = parseAvailabilityText('weekdays 9am-5pm');
    expect(windows).toHaveLength(5);
    expect(windows[0].start).toBe('09:00');
    expect(windows[0].end).toBe('17:00');
  });

  it('parses specific days and a morning window', () => {
    const { windows } = parseAvailabilityText('monday and wednesday mornings 10 to 12');
    expect(windows.map((w) => w.day)).toEqual([1, 3]);
    expect(windows[0].start).toBe('10:00');
    expect(windows[0].end).toBe('12:00');
  });

  it('uses period defaults when no explicit range is given', () => {
    const { windows } = parseAvailabilityText('weekends evening');
    expect(windows.map((w) => w.day)).toEqual([0, 6]);
    expect(windows[0].start).toBe('17:00');
    expect(windows[0].end).toBe('20:00');
  });

  it('defaults days to weekdays and warns when none are recognized', () => {
    const { windows, warnings } = parseAvailabilityText('10 to 3');
    expect(windows.map((w) => w.day)).toEqual([1, 2, 3, 4, 5]);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('handles an empty string', () => {
    const { windows, warnings } = parseAvailabilityText('');
    expect(windows).toHaveLength(0);
    expect(warnings).toContain('Empty input.');
  });
});
