/**
 * Saving one day's count — the step sync's decisions with their I/O injected (`SaveDeps`), so `npm run test:steps`
 * runs them in Node against fakes. `sync.ts` wires the real store (`store.ts`) and API.
 *
 * The day's number is `merge.dayValue` (the day's reading and its base, M5); what to save is `policy.savePlan` (M6).
 * Until J6 adds the server's modes (backend B1), this is the old server's path: raise only, the server READ right
 * before each save. Per day, in order:
 * 1. a real server read made after this phone's last automatic save that is LOWER than it = the member's edit (website /
 *    another phone; automatic saves only ever raise the count) → the day's base (`merge.baseForEdit`), at that read;
 * 2. counting began partway through a day that already had a count on the server → a START base at the coverage's
 *    start (M5c3, `merge.implicitStart`): the server is read for it;
 * 3. the plan (`auto` only: no reconcile without the modes);
 * 4. READ the server's current count right before saving (never Today's cache, which this phone's own saves keep
 *    looking fresh) — never lower it, and catch an edit made since — then `POST /api/track/steps`.
 * Remaining race (the old endpoint has no conditional write): a count saved elsewhere between that read and the POST.
 */
import type { TrackingDay } from '../../features/today/types';

import { autoCount, baseForEdit, dayValue, implicitStart } from './merge';
import { clampSteps, editedOnServer, savePlan, serverAllows, type DayRecord } from './policy';
import { observeServerSteps, serverObservation } from './serverSeen';
import type { DayBase, DayReading } from './types';

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

/**
 * Take the member's number (`base`, made on this phone or seen on the server) as the day's: the server holds it, and
 * this phone's earlier automatic save is gone (never reconciled); today's save throttle restarts from it.
 */
function takeEdit(deps: SaveDeps, userId: string, date: string, base: DayBase): DayRecord | undefined {
  const now = deps.now();
  deps.updateRecord(userId, date, { base, editRef: base.editRef ?? null, server: base.steps, serverAt: now, autoSent: undefined, autoAt: now });
  return deps.getRecord(userId, date);
}

/** M5c3 may apply: no base, no automatic save of the day yet, and the winning reading starts after midnight. */
function startsLate(reading: DayReading, isToday: boolean, rec: DayRecord | undefined): boolean {
  if (rec?.base || rec?.autoSent != null) return false;
  const winner = autoCount(reading, isToday);
  return !!winner && winner.coverFrom > reading.start;
}

/**
 * Saves the day of `reading` when the plan says so. False when it should be retried later (offline, server error) — a
 * past day is only marked final after a true.
 */
export async function saveDay(deps: SaveDeps, userId: string, reading: DayReading, isToday: boolean, hooks: SaveHooks = {}): Promise<boolean> {
  const stale = hooks.stale ?? (() => false);
  const date = reading.date;
  let rec = deps.getRecord(userId, date);

  // 1. A real server read made after this phone's last save shows a lower count: the member set the day themselves.
  const seen = serverObservation(userId, date);
  if (seen && editedOnServer(rec, seen)) rec = takeEdit(deps, userId, date, baseForEdit(seen.steps, seen.requestedAt, reading, rec?.editRef));

  // 2. Counting began partway through the day: carry on from what the server already had (M5c3).
  if (startsLate(reading, isToday, rec)) {
    const server = await readServer(deps, userId, date, hooks);
    if (stale()) return true;
    if (!server.ok) return !server.retry;
    rec = deps.getRecord(userId, date);
    const base = implicitStart(reading, isToday, { base: rec?.base, autoSent: rec?.autoSent, server: server.steps });
    if (base) {
      deps.updateRecord(userId, date, { base });
      rec = deps.getRecord(userId, date);
    }
  }

  // 3. What to save, and whether it's worth a save now (the old server: raise only).
  const plan = savePlan(dayValue(reading, rec?.base, isToday), rec, isToday, deps.now());
  if (plan?.mode !== 'auto') return true;

  // 4. Never lower the server's count: read it right before saving (one GET per save; saves are throttled).
  const server = await readServer(deps, userId, date, hooks);
  if (stale()) return true;
  if (!server.ok) return !server.retry;
  rec = deps.getRecord(userId, date);
  const fresh = serverObservation(userId, date);
  if (fresh && editedOnServer(rec, fresh)) {
    takeEdit(deps, userId, date, baseForEdit(fresh.steps, fresh.requestedAt, reading, rec?.editRef));
    return true; // the next run saves from the member's number
  }
  // The day changed meanwhile (the member's number saved on this phone, a higher count read): the next run decides.
  const again = savePlan(dayValue(reading, rec?.base, isToday), rec, isToday, deps.now());
  if (again?.mode !== 'auto' || again.steps !== plan.steps || !serverAllows(plan.steps, server.steps)) return true;

  const steps = clampSteps(plan.steps);
  try {
    const tracking = await deps.postSteps(date, steps);
    if (stale()) return true;
    const saved = typeof tracking?.steps === 'number' ? tracking.steps : steps;
    const at = deps.now();
    deps.updateRecord(userId, date, { autoSent: saved, autoAt: at, server: saved, serverAt: at });
    if (tracking) hooks.onSaved?.(date, tracking);
    return true;
  } catch (e) {
    return deps.isPermanent(e);
  }
}

/**
 * The member typed the day's steps on this phone (the Edit / Log sheet) and the server took `steps` (`editRef`: the
 * edit marker it answered with; null from the old server). It becomes the day's base (M5c1, `merge.baseForEdit`): an
 * `edit` when something was counting the day at that moment (`reading`: the day's latest, null when none is at hand) —
 * the member's number plus steps counted after it, lower than the automatic count too (a bus ride counted as walking);
 * else a `start` — typed while nothing counted, so counting that begins later adds on, and a higher whole-day count can
 * still replace it.
 */
export function applyManualSteps(deps: SaveDeps, userId: string, date: string, steps: number, reading: DayReading | null, editRef?: string | null) {
  const n = clampSteps(steps);
  observeServerSteps(userId, date, n, deps.now());
  takeEdit(deps, userId, date, baseForEdit(n, deps.now(), reading, editRef));
}
