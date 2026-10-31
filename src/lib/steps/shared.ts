/** Helpers shared by the platform readers and the sync (pure). */
import { addDays, safeTimeZone } from '../alarms/schedule';

import { dayStartMs } from './counter';
import { autoCount } from './merge';
import type { DayReading, DaySteps } from './types';

/** `[start, end)` of each local date in `timeZone`, the end capped at `now` (today is still running). */
export function dayRanges(dates: readonly string[], timeZone: string, now = Date.now()): { start: number; end: number }[] {
  const tz = safeTimeZone(timeZone);
  return dates.map((date) => {
    const start = dayStartMs(date, tz);
    return { start, end: Math.max(start, Math.min(now, dayStartMs(addDays(date, 1), tz))) };
  });
}

/** `[start, end)` of local `date` in `timeZone`: the whole day, also while it is still running (a `DayReading`'s). */
export function dayBounds(date: string, timeZone: string): { start: number; end: number } {
  const tz = safeTimeZone(timeZone);
  return { start: dayStartMs(date, tz), end: dayStartMs(addDays(date, 1), tz) };
}

/**
 * Thin adapter until R5a / U1 move Today's published state to `merge.dayValue`: the one-row-per-day shape Today's
 * card still takes, picked by the v2 rules (`merge.autoCount`: today the higher by real steps, a past day the
 * store's). The winner brings its flags; a coverage that starts after midnight becomes `partialFrom`. Null when no
 * source has the day.
 */
export function legacyDaySteps(reading: DayReading, isToday: boolean): DaySteps | null {
  const w = autoCount(reading, isToday);
  if (!w) return null;
  return {
    date: reading.date,
    steps: w.steps,
    source: w.source,
    ...(w.coverFrom > reading.start ? { partialFrom: w.coverFrom } : {}),
    ...(w.estimated ? { estimated: w.estimated } : {}),
    ...(w.complete ? { complete: true } : {}),
  };
}
