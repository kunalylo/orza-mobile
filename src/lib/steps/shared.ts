/** Helpers shared by the platform readers (pure). */
import { addDays, safeTimeZone } from '../alarms/schedule';

import { dayStartMs } from './counter';
import type { DaySteps, StepSource } from './types';

/** `[start, end)` of each local date in `timeZone`, the end capped at `now` (today is still running). */
export function dayRanges(dates: readonly string[], timeZone: string, now = Date.now()): { start: number; end: number }[] {
  const tz = safeTimeZone(timeZone);
  return dates.map((date) => {
    const start = dayStartMs(date, tz);
    return { start, end: Math.max(start, Math.min(now, dayStartMs(addDays(date, 1), tz))) };
  });
}

/** One candidate count for a date from one source (null = that source couldn't read the day). */
export interface Candidate {
  source: StepSource;
  steps: number | null;
  partialFrom?: number;
  /** How many of `steps` are a long-gap estimate (phone counter). */
  estimated?: number;
  /** The source read the whole day. */
  complete?: boolean;
}

/**
 * The day's automatic count: the highest readable candidate (every source measures the same walking — the higher one
 * missed less; e.g. a watch in Health Connect, or the phone counting live while Health Connect hasn't synced yet).
 * A tie goes to the health store (listed first). Null when no source could read the day. The winner's own details
 * (partial / estimated / complete) come with it: a past day is final only when the count it is saved with is.
 */
export function bestOf(date: string, candidates: readonly Candidate[]): DaySteps | null {
  let best: DaySteps | null = null;
  for (const c of candidates) {
    if (c.steps == null || !Number.isFinite(c.steps) || c.steps < 0) continue;
    const steps = Math.round(c.steps);
    if (!best || steps > best.steps) {
      best = {
        date,
        steps,
        source: c.source,
        ...(c.partialFrom != null ? { partialFrom: c.partialFrom } : {}),
        ...(c.estimated ? { estimated: Math.min(steps, Math.round(c.estimated)) } : {}),
        ...(c.complete ? { complete: true } : {}),
      };
    }
  }
  return best;
}
