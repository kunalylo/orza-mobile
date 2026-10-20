/**
 * Saving one day's automatic count — the step sync's decisions with their I/O injected (`SaveDeps`), so
 * `npm run test:steps` runs them in Node against fakes. `sync.ts` wires the real store (`store.ts`) and API.
 *
 * Per day, in order:
 * 1. a real server read made after this phone's last save that is LOWER than it = the member's edit (website / another
 *    phone; automatic saves only ever raise the count) → it becomes the day's base, steps counted after it add on;
 * 2. this phone's counter began partway through the day → a START base on top of what the day already had;
 * 3. the best source changed under a base → re-anchor it;
 * 4. the target (`policy.postTarget`), throttled (`policy.shouldPost`);
 * 5. READ the server's current count right before saving (never Today's cache, which this phone's own saves keep
 *    looking fresh) — never lower it, and catch an edit made since — then `POST /api/track/steps`.
 * Remaining race (the endpoint has no conditional write): a count saved elsewhere between that read and the POST.
 */
import type { TrackingDay } from '../../features/today/types';

import {
  clampSteps,
  editBase,
  editedOnServer,
  knownFloor,
  needsStartBase,
  postTarget,
  rebased,
  serverAllows,
  shouldPost,
  startBase,
  withBase,
  type AutoCount,
  type DayRecord,
} from './policy';
import { observeServerSteps, serverObservation } from './serverSeen';
import type { DaySteps } from './types';

export interface SaveDeps {
  getRecord(userId: string, date: string): DayRecord | undefined;
  updateRecord(userId: string, date: string, patch: Partial<DayRecord>): void;
  /** The day's count on the server now (`GET /dashboard/today?date=`); null when it answered for another day. Throws. */
  fetchServerSteps(date: string): Promise<number | null>;
  /** `POST /api/track/steps {steps, date}` → the saved row (null: no row in the answer). Throws. */
  postSteps(date: string, steps: number): Promise<TrackingDay | null>;
  /** A failure a retry won't fix (a 4xx other than auth / timeout / rate limit). */
  isPermanent(e: unknown): boolean;
  now(): number;
}

export interface SaveHooks {
  /** A save went through. */
  onSaved?: (date: string, tracking: TrackingDay) => void;
  /** A real read of the day's server count (Today's number can follow it). */
  onServerSteps?: (date: string, steps: number) => void;
  /** The member signed out meanwhile: stop without writing anything more. */
  stale?: () => boolean;
}

type ServerRead = { ok: true; steps: number | null } | { ok: false; retry: boolean };

/** A real read of the day's server count, remembered as an observation (`serverSeen`) and on the day's record. */
async function readServer(deps: SaveDeps, userId: string, date: string, hooks: SaveHooks): Promise<ServerRead> {
  const requestedAt = deps.now();
  try {
    const steps = await deps.fetchServerSteps(date);
    if (steps != null && Number.isFinite(steps) && steps >= 0) {
      observeServerSteps(userId, date, steps, requestedAt);
      if (deps.getRecord(userId, date)?.server !== steps) deps.updateRecord(userId, date, { server: steps, serverAt: deps.now() });
      hooks.onServerSteps?.(date, steps);
    }
    return { ok: true, steps };
  } catch (e) {
    return { ok: false, retry: !deps.isPermanent(e) };
  }
}

/** Accept the member's edit to `steps` (seen on the server, or made on this phone) as the day's base. */
export function acceptEdit(deps: SaveDeps, userId: string, date: string, steps: number, auto: AutoCount | null): DayRecord | undefined {
  const now = deps.now();
  const n = clampSteps(steps);
  deps.updateRecord(userId, date, { base: editBase(n, auto, now), sent: n, sentAt: now, sentSource: 'edited', server: n, serverAt: now });
  return deps.getRecord(userId, date);
}

/**
 * Saves `day` when the policy says so. False when it should be retried later (offline, server error) — a past day is
 * only marked final after a true.
 */
export async function saveDay(deps: SaveDeps, userId: string, day: DaySteps, isToday: boolean, hooks: SaveHooks = {}): Promise<boolean> {
  const stale = hooks.stale ?? (() => false);
  let rec = deps.getRecord(userId, day.date);

  // 1. A real server read made after this phone's last save shows a lower count: the member set the day themselves.
  const seen = serverObservation(userId, day.date);
  if (seen && editedOnServer(rec, seen)) rec = acceptEdit(deps, userId, day.date, seen.steps, day);

  // 2. This phone began counting partway through the day: carry on from what was already saved that day.
  if (needsStartBase(day, rec)) {
    const server = await readServer(deps, userId, day.date, hooks);
    if (stale()) return true;
    if (!server.ok) return !server.retry;
    rec = deps.getRecord(userId, day.date);
    if (!rec?.base) {
      deps.updateRecord(userId, day.date, { base: startBase(day, rec, server.steps, deps.now()) });
      rec = deps.getRecord(userId, day.date);
    }
  }

  // 3. The best source changed under a base: re-anchor it on the new one.
  const moved = rebased(rec?.base, day, deps.now());
  if (moved) {
    deps.updateRecord(userId, day.date, { base: moved });
    rec = deps.getRecord(userId, day.date);
  }

  // 4. What to save, and whether it's worth a save now.
  const target = postTarget(day, rec, isToday);
  if (target == null) return true;
  if (rec?.base && rec.base.last !== target) {
    deps.updateRecord(userId, day.date, { base: { ...rec.base, last: target } });
    rec = deps.getRecord(userId, day.date);
  }
  if (!shouldPost(target, rec, deps.now(), !isToday)) return true;

  // 5. Never lower the server's count: read it right before saving (one GET per save; saves are throttled).
  const server = await readServer(deps, userId, day.date, hooks);
  if (stale()) return true;
  if (!server.ok) return !server.retry;
  rec = deps.getRecord(userId, day.date);
  const fresh = serverObservation(userId, day.date);
  if (fresh && editedOnServer(rec, fresh)) {
    acceptEdit(deps, userId, day.date, fresh.steps, day);
    return true; // the next run saves from the member's number
  }
  // The day changed meanwhile (the member's own number saved on this phone): the next run saves from it.
  if (postTarget(day, rec, isToday) !== target) return true;
  if (!serverAllows(target, server.steps) || target <= knownFloor(rec)) return true;

  const steps = clampSteps(target);
  try {
    const tracking = await deps.postSteps(day.date, steps);
    if (stale()) return true;
    const saved = typeof tracking?.steps === 'number' ? tracking.steps : steps;
    const at = deps.now();
    const source = withBase(day, rec?.base)?.source ?? day.source;
    deps.updateRecord(userId, day.date, { sent: saved, sentAt: at, sentSource: source, server: saved, serverAt: at });
    if (tracking) hooks.onSaved?.(day.date, tracking);
    return true;
  } catch (e) {
    return deps.isPermanent(e);
  }
}

/**
 * The member typed the day's steps on this phone (the Edit / Log sheet) and the server took `steps`. On a past day,
 * with a count running today (`live`), or lower than what the day already had, it becomes the day's base: the
 * member's number, plus steps counted after it today (lower than the automatic count too — a bus ride counted as
 * walking). A count typed today with nothing counting is a plain save (counting that starts later adds on top of it).
 */
export function applyManualSteps(deps: SaveDeps, userId: string, date: string, steps: number, today: string, live: AutoCount | null) {
  const n = clampSteps(steps);
  const now = deps.now();
  observeServerSteps(userId, date, n, now);
  if (date !== today || live || n < knownFloor(deps.getRecord(userId, date))) {
    acceptEdit(deps, userId, date, n, live);
    return;
  }
  deps.updateRecord(userId, date, { server: n, serverAt: now });
}
