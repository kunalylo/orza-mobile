/**
 * Real reads of a day's step count on the server (Today's dashboard fetch, the sync's own check before saving, a
 * refused save's answer — the day's row as it is), with the time each request STARTED and the day's edit marker when
 * the server sent one. Never fed by this phone's own automatic saves or React Query's cache updates — those would make
 * a stale number look fresh. Memory only (per app run); pure, so the tests can use it.
 */
import type { ServerObservation } from './policy';

const seen = new Map<string, ServerObservation>();

const key = (userId: string, date: string) => `${userId}|${date}`;

/**
 * Remember a real server read (the newest request wins; a slow older answer never replaces a newer one). `marker`: the
 * day's edit marker in the answer (null: none; undefined: the answer didn't carry one — the old server).
 */
export function observeServerSteps(userId: string, date: string, steps: number, requestedAt: number, marker?: string | null) {
  if (!userId || !Number.isFinite(steps) || steps < 0) return;
  const k = key(userId, date);
  const prev = seen.get(k);
  if (prev && prev.requestedAt > requestedAt) return;
  seen.set(k, marker === undefined ? { steps, requestedAt } : { steps, requestedAt, marker: typeof marker === 'string' && marker ? marker : null });
  if (seen.size > 200) {
    const first = seen.keys().next().value;
    if (first !== undefined) seen.delete(first);
  }
}

export function serverObservation(userId: string, date: string): ServerObservation | null {
  return seen.get(key(userId, date)) ?? null;
}

export function forgetServerObservations() {
  seen.clear();
}
