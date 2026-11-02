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
 *    (M5c3, `merge.implicitStart`) — the server is read for it, once (only before the day's first automatic save); and
 *    on a day with a base, counting restarted after it (the switch off and on, a fresh subscription): the base moves to
 *    the restart with this phone's save in between (`merge.restartBase`), so those steps stay in the day;
 * 3. the plan: nothing, `auto` or `reconcile`;
 * 4. the answer: `applied` → it is this phone's last automatic save (`autoSent`, the only number ever reconciled —
 *    and only by a count that stands for what made it, `autoBy`);
 *    `edited` → step 1 with the answer's marker; `not_higher` / `changed` → the server's count is known, and this
 *    phone's own save is left as it was (a foreign value is never reconciled).
 *
 * `syncDay` is one day of a sync run: the save, then — a past day — whether it is final now (M7, `plan.isFinal`). Not
 * on a run that failed, nor on one that took an edit it couldn't save on from (the reading has no count after the
 * edit's instant yet: the next run reads it and saves edit + since). The run that may make a past day final also sends
 * its count once more (`savePlan`'s `settling`): another phone's reconcile may have lowered the day since this phone
 * last heard of it.
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

import { autoCount, baseForEdit, baseFromMarker, baseWithoutReading, counted, dayValue, implicitStart, restartBase, type DayValue, type MarkerRow } from './merge';
import { finalPatch, isFinal } from './plan';
import { clampSteps, editedOnServer, savePlan, serverAllows, type DayRecord, type SavePlan, type ServerObservation } from './policy';
import { markerOf, markerRowOf, observeServerSteps, serverObservation } from './serverSeen';
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

/**
 * A real read of the day on the server: its count, and its edit marker when the server has them (B2) — with what else
 * the row says about it (`MarkerRow`: the edit's own number, when the row was last written).
 */
export interface ServerDay extends MarkerRow {
  steps: number;
  /** `steps_edited_at`: null — no edit; undefined — the old server (no markers). */
  marker?: string | null;
}

export interface SaveDeps {
  getRecord(userId: string, date: string): DayRecord | undefined;
  updateRecord(userId: string, date: string, patch: Partial<DayRecord>): void;
  /**
   * When this phone last had an automatic save of `userId`'s steps applied (any day; null: never) — kept in the prefs,
   * so it outlives the day records (deleted at sign-out, a purged cache: M5c3).
   */
  lastAutoSave(userId: string): number | null;
  noteAutoSave(userId: string, at: number): void;
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
  /**
   * A day's number this phone must not send yet (`policy.countsIphoneHealthData` on an iPhone — Apple Health or the
   * motion sensor — until the app-wide AI consent ships): no automatic save of it — no raise, no reconcile, no settling
   * raise. The day is otherwise handled as usual (edits taken, final when settled).
   */
  hold?: (value: DayValue) => boolean;
}

/**
 * How one day's save went (`syncDay`): `done` — saved, or nothing to save; `edited` — the member's edit was taken and
 * what was counted after it isn't saved yet (the next run reads it); `retry` — it failed, try again later.
 */
export type DayOutcome = 'done' | 'edited' | 'retry';

/** A count from the server's answer (the server's own limit; anything else → `fallback`). */
const countOf = (n: unknown, fallback: number) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? clampSteps(n) : fallback);

type ServerRead = { ok: true; steps: number | null } | { ok: false; retry: boolean };

/** A real read of the day on the server, remembered as an observation (`serverSeen`) and on the day's record. */
async function readServer(deps: SaveDeps, userId: string, date: string, opts: SaveOptions): Promise<ServerRead> {
  const requestedAt = deps.now();
  try {
    const day = await deps.fetchServerDay(date);
    const steps = day?.steps;
    if (steps == null || !Number.isFinite(steps) || steps < 0) return { ok: true, steps: null };
    observeServerSteps(userId, date, steps, requestedAt, day?.marker, { editedSteps: day?.editedSteps, updatedAt: day?.updatedAt });
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
  if (seen.marker !== undefined) return baseFromMarker(seen.marker, seen.steps, reading, now, rec?.editRef, seen);
  if (rec?.serverModes === true || !editedOnServer(rec, seen)) return null;
  return baseForEdit(seen.steps, seen.requestedAt, reading, rec?.editRef);
}

/**
 * Take the member's number (`base`, made on this phone or seen on the server) as the day's: the server holds `server`
 * (the edit, or a count raised on top of it since), and this phone's earlier automatic save is gone (never
 * reconciled); today's save throttle restarts from it.
 */
function takeEdit(deps: SaveDeps, userId: string, date: string, base: DayBase, server = base.steps) {
  const now = deps.now();
  deps.updateRecord(userId, date, { base, editRef: base.editRef ?? null, server, serverAt: now, autoSent: undefined, autoBy: undefined, autoAt: now });
}

/** Step 1: an edit the latest real read of the day shows is taken first. The base taken (null: none). */
function takeServerEdit(deps: SaveDeps, userId: string, reading: DayReading): DayBase | null {
  const seen = serverObservation(userId, reading.date);
  const edit = serverEdit(deps.getRecord(userId, reading.date), seen, reading, deps.now());
  if (edit) takeEdit(deps, userId, reading.date, edit, seen?.steps);
  return edit;
}

/**
 * M5c3 may apply — the server is then read once for it:
 * - no base (`merge.implicitStart`): the winning reading starts after midnight, and this phone hasn't saved the day
 *   automatically since that coverage began;
 * - a base (`merge.restartBase`, R/U review): the winning count after the base starts after its instant (counting
 *   restarted), and this phone saved the day between the two — or, with no save on record, its last automatic save
 *   (`lastAutoSave`) came after the base and the server's count last seen isn't the base's own.
 */
function startsLate(reading: DayReading, isToday: boolean, rec: DayRecord | undefined, lastAutoSave: number | null): boolean {
  const base = rec?.base;
  if (base) {
    if (!(base.at < reading.end)) return false;
    const winner = counted(reading, base.at, isToday);
    if (!winner || winner.coverFrom <= base.at) return false;
    if (rec.autoSent != null) return (rec.autoAt ?? -Infinity) >= base.at && (rec.autoAt ?? -Infinity) < winner.coverFrom;
    return lastAutoSave != null && lastAutoSave >= base.at && (rec.server == null || rec.server > base.steps);
  }
  const winner = autoCount(reading, isToday);
  if (!winner || winner.coverFrom <= reading.start) return false;
  return rec?.autoSent == null || (rec.autoAt ?? Infinity) < winner.coverFrom;
}

/**
 * The plan for the day as it stands now (with the marker the day was last read with: an untaken one blocks it) —
 * nothing for a number held back (`SaveOptions.hold`).
 */
function planNow(deps: SaveDeps, userId: string, reading: DayReading, isToday: boolean, settling: boolean, opts: SaveOptions): SavePlan | null {
  const rec = deps.getRecord(userId, reading.date);
  const seen = serverObservation(userId, reading.date);
  const value = dayValue(reading, rec?.base, isToday);
  if (value && opts.hold?.(value)) return null;
  return savePlan(value, rec, isToday, deps.now(), seen?.marker, { settling });
}

const samePlan = (a: SavePlan | null, b: SavePlan) => !!a && a.mode === b.mode && a.steps === b.steps && a.expect === b.expect && a.editRef === b.editRef;

/**
 * Step 4: the server's answer to `plan`, sent at `sentAt`. True when it applied the save.
 * - No `applied` (the old server): it set the count — this phone's automatic save; the day stays on the old way.
 * - `applied`: the same, and the day now uses the modes.
 * Either way the prefs note when (`noteAutoSave`, M5c3).
 * - Refused: the answer is a real read of the day. `edited` → its marker is taken as the member's edit (`onEdit` gets
 *   the base; when it isn't one this phone can take — the server has none, say — the phone's `edit_ref` follows the
 *   server's, so the next save isn't refused again); `not_higher` / `changed` → the server's count is known, this
 *   phone's own save left as it was.
 */
function takeAnswer(
  deps: SaveDeps,
  userId: string,
  reading: DayReading,
  plan: SavePlan,
  answer: StepsAnswer,
  sentAt: number,
  opts: SaveOptions,
  onEdit: (base: DayBase) => void
): boolean {
  const date = reading.date;
  const t = answer.tracking;
  const steps = countOf(t?.steps, plan.steps);
  const now = deps.now();
  if (answer.applied !== false) {
    const serverModes = answer.applied === true;
    deps.updateRecord(userId, date, {
      autoSent: steps,
      autoBy: plan.by ?? undefined,
      autoAt: now,
      server: steps,
      serverAt: now,
      serverModes,
      ...(opts.tz ? { tz: opts.tz } : {}),
    });
    deps.noteAutoSave(userId, now);
    if (t) opts.onSaved?.(date, t);
    return true;
  }
  const marker = markerOf(t);
  const row = markerRowOf(t);
  observeServerSteps(userId, date, steps, sentAt, marker, row);
  deps.updateRecord(userId, date, { server: steps, serverAt: now, serverModes: true });
  opts.onServerSteps?.(date, steps);
  if (answer.reason !== 'edited') return false;
  const edit = baseFromMarker(marker, steps, reading, now, deps.getRecord(userId, date)?.editRef, row);
  if (edit) {
    takeEdit(deps, userId, date, edit, steps);
    onEdit(edit);
  } else deps.updateRecord(userId, date, { editRef: marker ?? null });
  return false;
}

/**
 * Saves the day of `reading` when the plan says so (`settling`: this run may make the past day final — the plan
 * checks the server once more, `savePlan`). `edited` when this call took an edit with steps to count after it (its
 * instant is before the day's end) and saved nothing on top of it; `retry` when it should be tried again later
 * (offline, server error).
 */
async function saveOnce(
  deps: SaveDeps,
  userId: string,
  reading: DayReading,
  isToday: boolean,
  opts: SaveOptions,
  settling: boolean
): Promise<DayOutcome> {
  const stale = opts.stale ?? (() => false);
  const date = reading.date;
  let edited = false;
  const took = (base: DayBase | null) => {
    if (base && base.at < reading.end) edited = true;
    return !!base;
  };
  const done = (): DayOutcome => (edited ? 'edited' : 'done');

  // 1. The member set the day elsewhere: their number first.
  took(takeServerEdit(deps, userId, reading));

  // 2. Counting began (or began again) partway through the day: carry on from what the server already had (M5c3).
  if (startsLate(reading, isToday, deps.getRecord(userId, date), deps.lastAutoSave(userId))) {
    const server = await readServer(deps, userId, date, opts);
    if (stale()) return done();
    if (!server.ok) return server.retry ? 'retry' : done();
    took(takeServerEdit(deps, userId, reading));
    const rec = deps.getRecord(userId, date);
    const known = { base: rec?.base, autoSent: rec?.autoSent, autoAt: rec?.autoAt, server: server.steps, lastAutoSave: deps.lastAutoSave(userId) };
    const base = rec?.base ? restartBase(reading, isToday, known) : implicitStart(reading, isToday, known);
    if (base) deps.updateRecord(userId, date, { base });
  }

  // 3. What to save, and whether it's worth a save now (a run that took an edit doesn't make the day final).
  const lastCall = settling && !edited;
  const plan = planNow(deps, userId, reading, isToday, lastCall, opts);
  if (!plan) return done();

  // The old server (or the day's modes not known yet): never lower its count — read it right before saving (one GET
  // per save; saves are throttled), and catch an edit made since.
  if (deps.getRecord(userId, date)?.serverModes !== true) {
    const server = await readServer(deps, userId, date, opts);
    if (stale()) return done();
    if (!server.ok) return server.retry ? 'retry' : done();
    if (took(takeServerEdit(deps, userId, reading))) return done(); // the member's number: the next run saves from it
    // The day changed meanwhile (the member's number saved on this phone, a higher count read): the next run decides.
    if (!samePlan(planNow(deps, userId, reading, isToday, lastCall, opts), plan) || !serverAllows(plan.steps, server.steps)) return done();
  }

  // 4. Save, and take the answer.
  const sentAt = deps.now();
  try {
    const answer = await deps.postSteps(date, clampSteps(plan.steps), plan.mode, plan.editRef, plan.expect);
    if (stale()) return done();
    // Applied: the day's number, with any edit taken above, is saved — nothing of it waits for the next run.
    if (takeAnswer(deps, userId, reading, plan, answer, sentAt, opts, took)) edited = false;
    return done();
  } catch (e) {
    return deps.isPermanent(e) ? done() : 'retry';
  }
}

/**
 * Saves the day of `reading` when the plan says so. False when it should be retried later (offline, server error).
 * A sync run uses `syncDay` (the save, then whether a past day is final).
 */
export async function saveDay(deps: SaveDeps, userId: string, reading: DayReading, isToday: boolean, opts: SaveOptions = {}): Promise<boolean> {
  return (await saveOnce(deps, userId, reading, isToday, opts, false)) !== 'retry';
}

/**
 * One day of a sync run (`storeOn`: a health store is ON for the member, M7): `saveDay`, and then a past day goes
 * final (`plan.isFinal`; the record notes whether the read had a store count, `plan.finalPatch`) — only when the save
 * went through or there was nothing to save (`done`): never on a run that failed, nor on one that took an edit with
 * steps after it still to save (`edited`). Only a run that `isFinal` allowed before the save (`settling`) finalizes:
 * that run checked the server once more.
 */
export async function syncDay(
  deps: SaveDeps,
  userId: string,
  reading: DayReading,
  isToday: boolean,
  storeOn: boolean,
  opts: SaveOptions = {}
): Promise<DayOutcome> {
  const date = reading.date;
  const settling = !isToday && isFinal(reading, deps.getRecord(userId, date), deps.now(), storeOn);
  const outcome = await saveOnce(deps, userId, reading, isToday, opts, settling);
  if (outcome !== 'done' || !settling || opts.stale?.()) return outcome;
  const rec = deps.getRecord(userId, date);
  if (!rec?.final && isFinal(reading, rec, deps.now(), storeOn)) deps.updateRecord(userId, date, finalPatch(reading));
  return outcome;
}

/** What the sync knows of a day the member saves a number for while no reading of it is at hand (M5c1). */
export interface ManualDayInfo {
  /** The day's end (epoch ms, the profile zone); null / undefined: unknown. */
  end?: number | null;
  /** Something counts the member's steps on this phone: a source is ON (the counter's permission, a health store). */
  counting: boolean;
}

/**
 * The member typed the day's steps on this phone (the Edit / Log sheet) and the server took `steps` (`editRef`: the
 * edit marker it answered with; null / undefined from the old server). It becomes the day's base (M5c1):
 * - with the day's latest reading (`reading`, `merge.baseForEdit`): an `edit` when something was counting the day at
 *   that moment — the member's number plus steps counted after it, lower than the automatic count too (a bus ride
 *   counted as walking); else a `start` — typed while nothing counted, so counting that begins later adds on, and a
 *   higher whole-day count can still replace it;
 * - with none at hand (the first read hasn't finished, or it timed out; `merge.baseWithoutReading`): an `edit` when
 *   the day had ended, when this phone saved it automatically, or when `day.counting` says a source is ON; else a
 *   `start` — never the kind whose higher whole-day count would undo a correction downwards.
 */
export function applyManualSteps(
  deps: SaveDeps,
  userId: string,
  date: string,
  steps: number,
  reading: DayReading | null,
  editRef?: string | null,
  day: ManualDayInfo = { counting: false }
) {
  const n = clampSteps(steps);
  const now = deps.now();
  const counting = day.counting || deps.getRecord(userId, date)?.autoSent != null;
  const base = reading ? baseForEdit(n, now, reading, editRef) : baseWithoutReading(n, now, { end: day.end, counting }, editRef);
  // A manual save on a server with markers always sets one: without one, this answer came from the old server.
  observeServerSteps(userId, date, n, now, editRef || undefined);
  takeEdit(deps, userId, date, base);
}

/**
 * The member's own number for the day, typed on this phone: `POST /api/track/steps` in `manual` mode (the server sets
 * the day's edit marker), then the day's base (`applyManualSteps`; `day`: what is known of the day when no reading is
 * at hand) with that marker as its `edit_ref` — so this phone's next automatic save isn't refused for its own edit.
 * The answer tells the day's modes too. Throws when the save fails (the sheet shows it).
 */
export async function saveManualDay(
  deps: SaveDeps,
  userId: string,
  date: string,
  steps: number,
  reading: DayReading | null,
  day?: ManualDayInfo
): Promise<StepsAnswer> {
  const n = clampSteps(steps);
  const answer = await deps.postSteps(date, n, 'manual', null);
  applyManualSteps(deps, userId, date, countOf(answer.tracking?.steps, n), reading, markerOf(answer.tracking) ?? null, day);
  deps.updateRecord(userId, date, { serverModes: answer.applied !== undefined });
  return answer;
}
