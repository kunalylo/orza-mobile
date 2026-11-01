/**
 * Real reads of a day's step count on the server (Today's dashboard fetch, the sync's own check before saving, a
 * refused save's answer — the day's row as it is), with the time each request STARTED and the day's edit marker when
 * the server sent one. Never fed by this phone's own automatic saves or React Query's cache updates — those would make
 * a stale number look fresh. Memory only (per app run); pure, so the tests can use it.
 */
import type { TrackingDay } from '../../features/today/types';

import type { MarkerRow } from './merge';
import type { ServerObservation } from './policy';

const seen = new Map<string, ServerObservation>();

const key = (userId: string, date: string) => `${userId}|${date}`;

/** The edit marker in a day's row: a string, null (none), or undefined (the old server's row has no such field). */
export function markerOf(t: TrackingDay | null | undefined): string | null | undefined {
  if (!t || !('steps_edited_at' in t)) return undefined;
  return typeof t.steps_edited_at === 'string' && t.steps_edited_at ? t.steps_edited_at : null;
}

/** What a day's row says beside its count and marker (M5c2): the edit's own number (B2), when it was last written. */
export function markerRowOf(t: TrackingDay | null | undefined): MarkerRow {
  const out: MarkerRow = {};
  const edited = t?.steps_edited_value;
  if (typeof edited === 'number' && Number.isFinite(edited) && edited >= 0) out.editedSteps = edited;
  const written = typeof t?.updated_at === 'string' ? Date.parse(t.updated_at) : Number.NaN;
  if (Number.isFinite(written)) out.updatedAt = written;
  return out;
}

/**
 * Remember a real server read (the newest request wins; a slow older answer never replaces a newer one). `marker`: the
 * day's edit marker in the answer (null: none; undefined: the answer didn't carry one — the old server); `row`: what
 * else the row says about it (`markerRowOf`).
 */
export function observeServerSteps(userId: string, date: string, steps: number, requestedAt: number, marker?: string | null, row: MarkerRow = {}) {
  if (!userId || !Number.isFinite(steps) || steps < 0) return;
  const k = key(userId, date);
  const prev = seen.get(k);
  if (prev && prev.requestedAt > requestedAt) return;
  seen.set(
    k,
    marker === undefined ? { steps, requestedAt } : { steps, requestedAt, marker: typeof marker === 'string' && marker ? marker : null, ...row }
  );
  if (seen.size > 200) {
    const first = seen.keys().next().value;
    if (first !== undefined) seen.delete(first);
  }
}

/** A day's row as the server answered a request started at `requestedAt` (Today's dashboard): its count and marker. */
export function observeServerRow(userId: string, date: string, t: TrackingDay | null | undefined, requestedAt: number) {
  if (t && typeof t.steps === 'number') observeServerSteps(userId, date, t.steps, requestedAt, markerOf(t), markerRowOf(t));
}

export function serverObservation(userId: string, date: string): ServerObservation | null {
  return seen.get(key(userId, date)) ?? null;
}

export function forgetServerObservations() {
  seen.clear();
}
