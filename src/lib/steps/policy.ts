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
 *   the store (M4). Never a number somebody else saved, and never on a server without the modes;
 * - else nothing.
 * Today shows the higher of the day's number and the server's (it never drops below what the website shows); a past
 * day shows the server's — the reconciled truth.
 *
 * Until the server has the modes (`DayRecord.serverModes`), `save.ts` keeps the old raise-only path: it reads the
 * server right before each save and takes a lower read as an edit (`editedOnServer`), J6 / V4.
 */
import { clampSteps, type DayValue } from './merge';
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
}

/** A real read of the day's count on the server: the value and when the request STARTED. */
export interface ServerObservation {
  steps: number;
  requestedAt: number;
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
 * sign of an edit; with the modes, the edit marker replaces it (J6).
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
 */
export function savePlan(
  value: DayValue | null | undefined,
  rec: DayRecord | undefined,
  isToday: boolean,
  now: number,
  marker?: string | null
): SavePlan | null {
  const target = saveTarget(value, isToday);
  if (target == null) return null;
  const editRef = rec?.editRef ?? null;
  if (marker && marker !== editRef) return null;
  const floor = knownFloor(rec);
  if (target > floor) {
    const throttled = isToday && rec?.autoAt != null && target - floor < POST_MIN_CHANGE && now - rec.autoAt < POST_MIN_INTERVAL_MS;
    return throttled ? null : { mode: 'auto', steps: target, editRef };
  }
  // A past day below the server: only this phone's own automatic save is corrected, and only with the modes.
  const server = rec?.server;
  if (!isToday && server != null && target < server && rec?.autoSent === server && rec.serverModes === true) {
    return { mode: 'reconcile', steps: target, expect: server, editRef };
  }
  return null;
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
