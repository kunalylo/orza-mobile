/** Helpers shared by the platform readers and the sync (pure). */
import { addDays, safeTimeZone } from '../alarms/schedule';
import type { StepRange } from '../health/types';

import { dayStartMs } from './counter';
import { applyCoverFloor, autoCount } from './merge';
import type { DayReading, DaySteps, SinceCount, SourceReading } from './types';

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

/* ───────────────────────────── The days a reader reads (both platforms) ───────────────────────────── */

/** One member day to read: [start, end) in the profile zone, and the part of it this member's steps come from. */
export interface DayPlan {
  date: string;
  start: number;
  end: number;
  /**
   * [from, to): from the day's start — or the shared phone's coverage floor (M9) — to its end or now. Null: nothing of
   * the day may be read (it ended by the floor, or hasn't begun).
   */
  read: { from: number; to: number } | null;
}

export function dayPlans(dates: readonly string[], timeZone: string, now: number, coverFloor?: number | null): DayPlan[] {
  return dates.map((date) => {
    const day = dayBounds(date, timeZone);
    const range = applyCoverFloor(day, coverFloor);
    const to = Math.min(day.end, now);
    return { date, ...day, read: range && to > range.start ? { from: range.start, to } : null };
  });
}

/**
 * What a base's count since `at` needs (M5, S-R4) for a source covering `day` from `coverFrom`: nothing when there is
 * no base or the source covers only from `at` on (all of its count is after it); `range` null when nothing can be
 * after it (at or after the end of what is read: 0); else the range [at, to).
 */
export function sinceRange(day: DayPlan, coverFrom: number, at: number | null | undefined): { at: number; range: StepRange | null } | null {
  if (at == null || !Number.isFinite(at) || !day.read || at <= coverFrom) return null;
  return { at, range: at < day.read.to ? { start: at, end: day.read.to } : null };
}

/** `reading` with its count since a base (`ReadOptions.sinceAt`). */
export function withSince(reading: SourceReading, since: SinceCount): SourceReading {
  return { ...reading, since };
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
