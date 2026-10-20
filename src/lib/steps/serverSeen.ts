/**
 * Real reads of a day's step count on the server (Today's dashboard fetch, the sync's own check before saving), with
 * the time each request STARTED. Never fed by this phone's own saves or React Query's cache updates — those would make
 * a stale number look fresh. Memory only (per app run); pure, so the tests can use it.
 */
import type { ServerObservation } from './policy';

const seen = new Map<string, ServerObservation>();

const key = (userId: string, date: string) => `${userId}|${date}`;

/** Remember a real server read (the newest request wins; a slow older answer never replaces a newer one). */
export function observeServerSteps(userId: string, date: string, steps: number, requestedAt: number) {
  if (!userId || !Number.isFinite(steps) || steps < 0) return;
  const k = key(userId, date);
  const prev = seen.get(k);
  if (prev && prev.requestedAt > requestedAt) return;
  seen.set(k, { steps, requestedAt });
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
