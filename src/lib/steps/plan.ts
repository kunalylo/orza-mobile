/**
 * Scheduling decisions of the step sync (`sync.ts`) — pure, so `npm run test:steps` covers them:
 * which reason a queued run keeps, which past days still need their final count, when to read them, and how two
 * pending save jobs combine.
 */
import { addDays } from '../alarms/schedule';

import type { DaySteps, RefreshReason } from './types';

/** Past days whose final count is still saved, at most this far back (CMPedometer keeps 7 days, the sampler 10). */
export const FINAL_DAYS = 7;
/** Pending past days are read again at most this often (plus on launch, a permission change and a new day). */
export const PAST_READ_EVERY_MS = 30 * 60_000;

const PRIORITY: Record<RefreshReason, number> = { today: 0, background: 1, foreground: 2, launch: 3, permission: 4 };

/** A run queued behind a running one keeps the more important reason (a permission re-check is never lost). */
export function mergeReason(queued: RefreshReason | undefined, next: RefreshReason): RefreshReason {
  if (!queued) return next;
  return PRIORITY[queued] > PRIORITY[next] ? queued : next;
}

/** The past days (newest first, within FINAL_DAYS) whose final count isn't saved yet. */
export function pendingPastDays(today: string, isFinal: (date: string) => boolean): string[] {
  const out: string[] = [];
  for (let i = 1; i <= FINAL_DAYS; i++) {
    const date = addDays(today, -i);
    if (!isFinal(date)) out.push(date);
  }
  return out;
}

/** Read the pending past days on this run? (Throttled: each read can mean a few health-store queries.) */
export function shouldReadPast(
  reason: RefreshReason,
  today: string,
  now: number,
  last: { at: number; today: string } | null
): boolean {
  if (reason === 'launch' || reason === 'permission' || !last || last.today !== today) return true;
  return now - last.at >= PAST_READ_EVERY_MS;
}

/** A past day's count is final once a source read the whole day (`complete`). */
export function isFinalRead(day: DaySteps | undefined): boolean {
  return !!day?.complete;
}

/**
 * Two save jobs waiting for the same slot: the newer readings win; days only the older one read (past days) are kept,
 * so a newer today-only run never drops a pending final count.
 */
export function mergeDays(older: readonly DaySteps[], newer: readonly DaySteps[]): DaySteps[] {
  const dates = new Set(newer.map((d) => d.date));
  return [...newer, ...older.filter((d) => !dates.has(d.date))];
}
