/**
 * Saving one day's count — the step sync's decisions with their I/O injected (`SaveDeps`), so `npm run test:steps`
 * runs them in Node against a fake server. `sync.ts` wires the real store (`store.ts`) and API.
 *
 * The day's number is `merge.dayValue` (the day's reading and its base, M5); what to save is `policy.savePlan` (M6);
 * how is `POST /api/track/steps` with a mode (`docs/notes/steps-v2.md` §2.5, backend B1): `auto` — an atomic raise the
 * server refuses while the day has an edit marker this phone hasn't taken (`edit_ref`); `reconcile` — a compare-and-
 * set (`expect`: this phone's own last automatic save); `manual` — the member's number, which sets the marker. Per day,
 * in order:
 * 1. the member set the day elsewhere (the website, another phone) — a marker this phone hasn't taken, read with the
 *    day (Today's dashboard, the read before a save, a refused save's answer): it becomes the day's base at the
 *    marker's instant (M5c2, `merge.baseFromMarker`), and the next save is that number plus what was counted after it;
 * 2. counting began partway through a day that already had a count on the server: a START base at the coverage's start
 *    (M5c3, `merge.implicitStart`) — the server is read for it, once (only before the day's first automatic save);
 * 3. the plan: nothing, `auto` or `reconcile`;
 * 4. the answer: `applied` → it is this phone's last automatic save (`autoSent`, the only number ever reconciled);
 *    `edited` → step 1 with the answer's marker; `not_higher` / `changed` → the server's count is known, and this
 *    phone's own save is left as it was (a foreign value is never reconciled).
 *
 * The old production server (until B1 is deployed, V4) has no modes: it SETS whatever it is sent and answers
 * `{tracking}` without `applied`. So a day whose answers haven't shown `applied` yet (`DayRecord.serverModes`, feature
 * detection) is saved the old way: raise only, the server READ right before each save (never Today's cache, which this
 * phone's own saves keep looking fresh), and an edit seen as a real read LOWER than this phone's last automatic save
 * (`policy.editedOnServer`: automatic saves there only ever raise). No reconcile. The modes go along all the same (the
 * old server ignores them), so the first answer with `applied` switches the day over. Remaining race there: a count
 * saved elsewhere between that read and the POST. With the modes, a lower count is never taken as an edit (C5: another
 * phone's reconcile can lower a day) — only a marker is.
 */
import type { TrackingDay } from '../../features/today/types';

import { autoCount, baseForEdit, baseFromMarker, dayValue, implicitStart } from './merge';
import { clampSteps, editedOnServer, savePlan, serverAllows, type DayRecord, type SavePlan, type ServerObservation } from './policy';
import { observeServerSteps, serverObservation } from './serverSeen';
import type { DayBase, DayReading } from './types';

/** `POST /api/track/steps`'s `mode` (backend B1; the old server ignores it). */
export type StepsMode = 'manual' | 'auto' | 'reconcile';

/** Why the server didn't apply an `auto` / `reconcile` save. */
export type StepsRefusal = 'not_higher' | 'edited' | 'changed';

/**
 * `POST /api/track/steps`'s answer: the day's row as it is now (with its edit marker, B2). `applied` is missing from
 * the old server's answers — that is how the phone tells the two apart.
 */
export interface StepsAnswer {
  tracking: TrackingDay;
  applied?: boolean;
  reason?: StepsRefusal;
}

/** A real read of the day on the server: its count, and its edit marker when the server has them (B2). */
export interface ServerDay {
  steps: number;
  /** `steps_edited_at`: null — no edit; undefined — the old server (no markers). */
  marker?: string | null;
}

export interface SaveDeps {
  getRecord(userId: string, date: string): DayRecord | undefined;
  updateRecord(userId: string, date: string, patch: Partial<DayRecord>): void;
  /** The day on the server now (`GET /dashboard/today?date=`); null when it answered for another day. Throws. */
  fetchServerDay(date: string): Promise<ServerDay | null>;
  /** `POST /api/track/steps {steps, date, mode, edit_ref, expect}`. Throws (an answer without the day's row too). */
  postSteps(date: string, steps: number, mode: StepsMode, editRef: string | null, expect?: number): Promise<StepsAnswer>;
  /** A failure a retry won't fix (a 4xx other than auth / timeout / rate limit). */
  isPermanent(e: unknown): boolean;
  now(): number;
}

export interface SaveOptions {
  /** The profile time zone the day is counted in: kept on the day's record with each save (M8, the zone freeze). */
  tz?: string;
  /** A save went through. */
  onSaved?: (date: string, tracking: TrackingDay) => void;
  /** A real read of the day's server count (Today's number can follow it). */
  onServerSteps?: (date: string, steps: number) => void;
  /** The member signed out meanwhile: stop without writing anything more. */
  stale?: () => boolean;
}

/** A count from the server's answer (the server's own limit; anything else → `fallback`). */
const countOf = (n: unknown, fallback: number) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? clampSteps(n) : fallback);

/** The marker in a row: a string, null (none), or undefined (the old server's row has no such field). */
function markerOf(t: TrackingDay | null | undefined): string | null | undefined {
  if (!t || !('steps_edited_at' in t)) return undefined;
  return typeof t.steps_edited_at === 'string' && t.steps_edited_at ? t.steps_edited_at : null;
}

type ServerRead = { ok: true; steps: number | null } | { ok: false; retry: boolean };

/** A real read of the day on the server, remembered as an observation (`serverSeen`) and on the day's record. */
async function readServer(deps: SaveDeps, userId: string, date: string, opts: SaveOptions): Promise<ServerRead> {
  const requestedAt = deps.now();
  try {
    const day = await deps.fetchServerDay(date);
    const steps = day?.steps;
    if (steps == null || !Number.isFinite(steps) || steps < 0) return { ok: true, steps: null };
    observeServerSteps(userId, date, steps, requestedAt, day?.marker);
    if (deps.getRecord(userId, date)?.server !== steps) deps.updateRecord(userId, date, { server: steps, serverAt: deps.now() });
    opts.onServerSteps?.(date, steps);
    return { ok: true, steps };
  } catch (e) {
    return { ok: false, retry: !deps.isPermanent(e) };
  }
}

/**
 * The member's edit that a real read `seen` shows and this phone hasn't taken (null: none):
 * - a read with the day's marker (a server with markers): one other than the marker this phone knows (M5c2);
 * - a read without one, on a day whose saves haven't been answered with the modes (the old server): a count lower than
 *   this phone's last automatic save, read after it (`policy.editedOnServer`), anchored at the read.
 */
function serverEdit(rec: DayRecord | undefined, seen: ServerObservation | null, reading: DayReading, now: number): DayBase | null {
  if (!seen) return null;
  if (seen.marker !== undefined) return baseFromMarker(seen.marker, seen.steps, reading, now, rec?.editRef);
  if (rec?.serverModes === true || !editedOnServer(rec, seen)) return null;
  return baseForEdit(seen.steps, seen.requestedAt, reading, rec?.editRef);
}

/**
 * Take the member's number (`base`, made on this phone or seen on the server) as the day's: the server holds it, and
 * this phone's earlier automatic save is gone (never reconciled); today's save throttle restarts from it.
 */
function takeEdit(deps: SaveDeps, userId: string, date: string, base: DayBase) {
  const now = deps.now();
  deps.updateRecord(userId, date, { base, editRef: base.editRef ?? null, server: base.steps, serverAt: now, autoSent: undefined, autoAt: now });
}

/** Step 1: an edit the latest real read of the day shows is taken first. True when one was. */
function takeServerEdit(deps: SaveDeps, userId: string, reading: DayReading): boolean {
  const edit = serverEdit(deps.getRecord(userId, reading.date), serverObservation(userId, reading.date), reading, deps.now());
  if (edit) takeEdit(deps, userId, reading.date, edit);
  return !!edit;
}

/** M5c3 may apply: no base, no automatic save of the day yet, and the winning reading starts after midnight. */
function startsLate(reading: DayReading, isToday: boolean, rec: DayRecord | undefined): boolean {
  if (rec?.base || rec?.autoSent != null) return false;
  const winner = autoCount(reading, isToday);
  return !!winner && winner.coverFrom > reading.start;
}

/** The plan for the day as it stands now (with the marker the day was last read with: an untaken one blocks it). */
function planNow(deps: SaveDeps, userId: string, reading: DayReading, isToday: boolean): SavePlan | null {
  const rec = deps.getRecord(userId, reading.date);
  const seen = serverObservation(userId, reading.date);
  return savePlan(dayValue(reading, rec?.base, isToday), rec, isToday, deps.now(), seen?.marker);
}

const samePlan = (a: SavePlan | null, b: SavePlan) => !!a && a.mode === b.mode && a.steps === b.steps && a.expect === b.expect && a.editRef === b.editRef;

/**
 * Step 4: the server's answer to `plan`, sent at `sentAt`.
 * - No `applied` (the old server): it set the count — this phone's automatic save; the day stays on the old way.
 * - `applied`: the same, and the day now uses the modes.
 * - Refused: the answer is a real read of the day. `edited` → its marker is taken as the member's edit (when it isn't
 *   one this phone can take — the server has none, say — the phone's `edit_ref` follows the server's, so the next save
 *   isn't refused again); `not_higher` / `changed` → the server's count is known, this phone's own save left as it was.
 */
function takeAnswer(deps: SaveDeps, userId: string, reading: DayReading, plan: SavePlan, answer: StepsAnswer, sentAt: number, opts: SaveOptions) {
  const date = reading.date;
  const t = answer.tracking;
  const steps = countOf(t?.steps, plan.steps);
  const now = deps.now();
  if (answer.applied !== false) {
    const serverModes = answer.applied === true;
    deps.updateRecord(userId, date, { autoSent: steps, autoAt: now, server: steps, serverAt: now, serverModes, ...(opts.tz ? { tz: opts.tz } : {}) });
    if (t) opts.onSaved?.(date, t);
    return;
  }
  const marker = markerOf(t);
  observeServerSteps(userId, date, steps, sentAt, marker);
  deps.updateRecord(userId, date, { server: steps, serverAt: now, serverModes: true });
  opts.onServerSteps?.(date, steps);
  if (answer.reason !== 'edited') return;
  const edit = baseFromMarker(marker, steps, reading, now, deps.getRecord(userId, date)?.editRef);
  if (edit) takeEdit(deps, userId, date, edit);
  else deps.updateRecord(userId, date, { editRef: marker ?? null });
}

/**
 * Saves the day of `reading` when the plan says so. False when it should be retried later (offline, server error) — a
 * past day is only marked final after a true.
 */
export async function saveDay(deps: SaveDeps, userId: string, reading: DayReading, isToday: boolean, opts: SaveOptions = {}): Promise<boolean> {
  const stale = opts.stale ?? (() => false);
  const date = reading.date;

  // 1. The member set the day elsewhere: their number first.
  takeServerEdit(deps, userId, reading);

  // 2. Counting began partway through the day: carry on from what the server already had (M5c3).
  if (startsLate(reading, isToday, deps.getRecord(userId, date))) {
    const server = await readServer(deps, userId, date, opts);
    if (stale()) return true;
    if (!server.ok) return !server.retry;
    takeServerEdit(deps, userId, reading);
    const rec = deps.getRecord(userId, date);
    const base = implicitStart(reading, isToday, { base: rec?.base, autoSent: rec?.autoSent, server: server.steps });
    if (base) deps.updateRecord(userId, date, { base });
  }

  // 3. What to save, and whether it's worth a save now.
  const plan = planNow(deps, userId, reading, isToday);
  if (!plan) return true;

  // The old server (or the day's modes not known yet): never lower its count — read it right before saving (one GET
  // per save; saves are throttled), and catch an edit made since.
  if (deps.getRecord(userId, date)?.serverModes !== true) {
    const server = await readServer(deps, userId, date, opts);
    if (stale()) return true;
    if (!server.ok) return !server.retry;
    if (takeServerEdit(deps, userId, reading)) return true; // the member's number: the next run saves from it
    // The day changed meanwhile (the member's number saved on this phone, a higher count read): the next run decides.
    if (!samePlan(planNow(deps, userId, reading, isToday), plan) || !serverAllows(plan.steps, server.steps)) return true;
  }

  // 4. Save, and take the answer.
  const sentAt = deps.now();
  try {
    const answer = await deps.postSteps(date, clampSteps(plan.steps), plan.mode, plan.editRef, plan.expect);
    if (stale()) return true;
    takeAnswer(deps, userId, reading, plan, answer, sentAt, opts);
    return true;
  } catch (e) {
    return deps.isPermanent(e);
  }
}

/**
 * The member typed the day's steps on this phone (the Edit / Log sheet) and the server took `steps` (`editRef`: the
 * edit marker it answered with; null / undefined from the old server). It becomes the day's base (M5c1,
 * `merge.baseForEdit`): an `edit` when something was counting the day at that moment (`reading`: the day's latest,
 * null when none is at hand) — the member's number plus steps counted after it, lower than the automatic count too (a
 * bus ride counted as walking); else a `start` — typed while nothing counted, so counting that begins later adds on,
 * and a higher whole-day count can still replace it.
 */
export function applyManualSteps(deps: SaveDeps, userId: string, date: string, steps: number, reading: DayReading | null, editRef?: string | null) {
  const n = clampSteps(steps);
  // A manual save on a server with markers always sets one: without one, this answer came from the old server.
  observeServerSteps(userId, date, n, deps.now(), editRef || undefined);
  takeEdit(deps, userId, date, baseForEdit(n, deps.now(), reading, editRef));
}

/**
 * The member's own number for the day, typed on this phone: `POST /api/track/steps` in `manual` mode (the server sets
 * the day's edit marker), then the day's base (`applyManualSteps`) with that marker as its `edit_ref` — so this
 * phone's next automatic save isn't refused for its own edit. The answer tells the day's modes too. Throws when the
 * save fails (the sheet shows it).
 */
export async function saveManualDay(deps: SaveDeps, userId: string, date: string, steps: number, reading: DayReading | null): Promise<StepsAnswer> {
  const n = clampSteps(steps);
  const answer = await deps.postSteps(date, n, 'manual', null);
  applyManualSteps(deps, userId, date, countOf(answer.tracking?.steps, n), reading, markerOf(answer.tracking) ?? null);
  deps.updateRecord(userId, date, { serverModes: answer.applied !== undefined });
  return answer;
}
