/**
 * What the phone saves for a day, and which number Today shows — steps v2's plan (`docs/notes/steps-v2.md` §2.4,
 * §2.5). Pure (tested by `npm run test:steps`); the day's number itself is `merge.dayValue` (M0–M5).
 *
 * `POST /api/track/steps` gets three modes (backend B1): `manual` (the member's number; it sets the day's edit marker
 * `steps_edited_at`), `auto` (an atomic raise, refused while the server has a marker this phone hasn't seen) and
 * `reconcile` (a compare-and-set, refused when the day changed since). The phone's plan for a day (M6):
 * - target T = the day's number — today without its long-gap estimate, so today's number on the server stays what was
 *   really counted; known floor K = the higher of the server's count and this phone's last automatic save;
 * - an edit made after the day ended: nothing, ever (the member's number for good, M5d);
 * - T > K: `auto`. Today throttled (≥ 50 steps more, or 10 min since the last save, or nothing saved yet); a past day
 *   at once;
 * - a past day whose number is now LOWER than the server's, while the server still holds exactly this phone's own last
 *   automatic save (today's live tail, above the store until the store caught up): `reconcile` to it — past days follow
 *   the store (M4). Never a number somebody else saved, never on a server without the modes, and never with a number
 *   that may be missing steps (`DayValue.sinceUnknown`: a lower bound only raises);
 * - a past day read while a health store that is ON wasn't (`storeUnread`): nothing (§2.9) — the next run decides;
 * - the run that may make a past day final (`settling`, M7): `auto` T once more even when the server's count last seen
 *   was higher — another phone's reconcile may have lowered the day since (the atomic raise refuses it otherwise);
 * - else nothing.
 * Today shows the higher of the day's number and the server's (it never drops below what the website shows); a past
 * day shows the server's — the reconciled truth.
 *
 * A day whose saves the server hasn't answered with the modes yet (`DayRecord.serverModes`: the old production server)
 * is saved the old raise-only way (`save.ts`): the server read right before each save, a lower read taken as an edit
 * (`editedOnServer`), no reconcile. That branch goes once B1 is deployed (V4).
 */
import { clampSteps, type DayValue, type MarkerRow } from './merge';
import type { DayBase, StepSource } from './types';

/** The server's day limit and the clamp to it live with the merge rules (M5 clamps the day's number). */
export { clampSteps, MAX_DAY_STEPS } from './merge';
export type { DayBase } from './types';

/** Where a shown number came from: an automatic source, a count saved before / elsewhere, or the member's own edit. */
export type ShownSource = StepSource | 'saved' | 'edited';

/** What this phone knows about one day on the server. */
export interface DayRecord {
  /**
   * This phone's last automatic save of the day that the server applied. None yet, or the member's edit replaced it
   * since: only this number is ever reconciled (M6).
   */
  autoSent?: number;
  /** When the day was last saved from this phone, or an edit of it taken: today's save throttle runs from it. */
  autoAt?: number;
  /** The day's count as last read from the server (or answered by a save). */
  server?: number;
  serverAt?: number;
  /** The day's base (M5): the member's edit, or the number the day had when counting began. */
  base?: DayBase;
  /** The server's edit marker (`steps_edited_at`) this phone knows for the day (null: none). */
  editRef?: string | null;
  /** The server answered a save with the v2 modes (`applied`); unset: the old server — no reconcile. */
  serverModes?: boolean;
  /** The profile time zone the day was saved under (M8: a past day saved under another zone is frozen). */
  tz?: string;
  /** A past day that is final: no longer read (M7). */
  final?: boolean;
  /** Final, and the read that made it so had no health-store count (Apple Health's "no steps" state, `plan.healthEmpty`). */
  noStore?: boolean;
}

/** A real read of the day's count on the server: the value and when the request STARTED. */
export interface ServerObservation extends MarkerRow {
  steps: number;
  requestedAt: number;
  /**
   * The day's edit marker in that answer (`steps_edited_at`, backend B2): null when the day has none; undefined when
   * the answer didn't say (the old server — its only sign of an edit is a lower count, `editedOnServer`).
   */
  marker?: string | null;
}

export const POST_MIN_CHANGE = 50;
export const POST_MIN_INTERVAL_MS = 10 * 60_000;

/** K: the highest count this phone knows is on the server for the day. */
export function knownFloor(rec: DayRecord | undefined): number {
  return Math.max(rec?.server ?? 0, rec?.autoSent ?? 0);
}

/**
 * A real server read lower than this phone's last automatic save, requested after that save: the day was set lower
 * elsewhere (the member, on the website or another phone — automatic saves only ever raise it). The old server's only
 * sign of an edit; with the modes, only the edit marker is one (`save.ts`: another phone's reconcile can lower a day).
 */
export function editedOnServer(rec: DayRecord | undefined, seen: ServerObservation | null | undefined): boolean {
  if (!seen || rec?.autoSent == null || rec.autoAt == null) return false;
  return seen.requestedAt > rec.autoAt && seen.steps < rec.autoSent;
}

/** With the server's current value `server` (null = unknown), may `steps` be saved? The old server's raise-only guard. */
export function serverAllows(steps: number, server: number | null): boolean {
  return server == null || clampSteps(steps) > server;
}

/* ───────────────────────────── Saving (M6) ───────────────────────────── */

/** One save for a day: the request `POST /api/track/steps {steps, date, mode, edit_ref, expect}` sends. */
export interface SavePlan {
  mode: 'auto' | 'reconcile';
  steps: number;
  /** `reconcile` only: the server's count it replaces — this phone's own last automatic save. */
  expect?: number;
  /** The edit marker this phone knows (`edit_ref`): the server refuses the save while its own differs. */
  editRef: string | null;
}

/**
 * T: the count to save for the day's number `value` (null: nothing, ever — no number, or an edit made after the day
 * ended). Today leaves its long-gap estimate out; a past day saves all of it.
 */
export function saveTarget(value: DayValue | null | undefined, isToday: boolean): number | null {
  if (!value || value.fixed) return null;
  return clampSteps(value.steps - (isToday ? value.estimated : 0));
}

/**
 * M6: what to save for the day now (null: nothing). `value` is the day's number (`merge.dayValue`), `rec` what this
 * phone knows of the day, `marker` the server's edit marker as last read (undefined: not read). A marker this phone
 * hasn't taken yet means nothing is saved: the edit comes first (M5c2) — the server would refuse either save.
 * `settling`: this run may make the past day final (`plan.isFinal`) — the last chance to save it.
 */
export function savePlan(
  value: DayValue | null | undefined,
  rec: DayRecord | undefined,
  isToday: boolean,
  now: number,
  marker?: string | null,
  opts: { settling?: boolean } = {}
): SavePlan | null {
  const target = saveTarget(value, isToday);
  if (target == null || !value) return null;
  // A past day without the store's count it follows (M4): nothing either way until the store is read.
  if (!isToday && value.storeUnread) return null;
  const editRef = rec?.editRef ?? null;
  if (marker && marker !== editRef) return null;
  const floor = knownFloor(rec);
  if (target > floor) {
    const throttled = isToday && rec?.autoAt != null && target - floor < POST_MIN_CHANGE && now - rec.autoAt < POST_MIN_INTERVAL_MS;
    return throttled ? null : { mode: 'auto', steps: target, editRef };
  }
  if (isToday || rec?.serverModes !== true) return null;
  // A past day below the server: only this phone's own automatic save is corrected — and never with a number that may
  // be missing steps.
  const server = rec.server;
  if (server != null && target < server && rec.autoSent === server && !value.sinceUnknown) {
    return { mode: 'reconcile', steps: target, expect: server, editRef };
  }
  // The day goes final after this run: the server's count last seen may be stale (another phone's reconcile lowers a
  // day, and only answers to this phone's own saves tell it) — one atomic raise, refused when it isn't higher.
  return opts.settling && target > 0 ? { mode: 'auto', steps: target, editRef } : null;
}

/**
 * The day's number comes from Apple Health's count (its winner is Apple Health's reading: the whole day's, or what it
 * counted after the day's base) — HealthKit data. Until the app-wide AI data consent ships (coordinator decision,
 * App Store 5.1.2(i) / 5.1.3), the server's coach would read it from `tracking.steps`, so the iPhone holds such a
 * number back (`save.SaveOptions.hold`); the iPhone's own motion count (CMPedometer) and the member's typed number are
 * not HealthKit data.
 */
export function countsAppleHealth(value: DayValue): boolean {
  return value.winner?.source === 'apple_health';
}

/* ───────────────────────────── Today's number (§2.4) ───────────────────────────── */

export interface ShownSteps {
  steps: number;
  source: ShownSource;
  /** Counted by the phone's sampler: "Counted by this phone · approximate". */
  approximate: boolean;
}

/** The label of the day's own number: the member's edit, the counting source, or (a start alone) the saved number. */
function ownLabel(value: DayValue): Omit<ShownSteps, 'steps'> {
  if (value.basis === 'edit') return { source: 'edited', approximate: false };
  const w = value.winner;
  return w ? { source: w.source, approximate: w.counter === 'sampler' } : { source: 'saved', approximate: false };
}

/**
 * The number Today shows for a day and its label (null: nothing known). `value` is the day's number (null: no reading
 * at hand), `server` the server's count from Today's data (null / undefined: not loaded — offline).
 * - Today: the higher of `value` and the server's count (offline: the last known one — read, or this phone's own
 *   save); a tie → the day's own label. An edit is "Edited by you" whichever number shows.
 * - A past day: the server's count (the reconciled truth; the day's own label when they agree); offline, `value`.
 */
export function shownSteps(
  value: DayValue | null | undefined,
  rec: DayRecord | undefined,
  server: number | null | undefined,
  isToday: boolean
): ShownSteps | null {
  const known = server ?? rec?.server ?? rec?.autoSent ?? null;
  const own = value ? { steps: value.steps, ...ownLabel(value) } : null;
  const edited = rec?.base?.kind === 'edit' || value?.basis === 'edit';
  const saved = (steps: number): ShownSteps => ({ steps, source: edited ? 'edited' : 'saved', approximate: false });
  if (isToday) {
    if (own && (known == null || own.steps >= known)) return own;
    return known == null ? null : saved(known);
  }
  if (server != null) return own && own.steps === server ? own : saved(server);
  if (own) return own;
  return known == null ? null : saved(known);
}
