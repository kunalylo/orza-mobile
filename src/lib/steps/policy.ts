/**
 * When the phone saves its automatic count, and which number Today shows — pure (tested by `npm run test:steps`).
 *
 * `POST /api/track/steps` SETS the day's count. The phone only ever raises it, like the server's own Health import
 * mirror (`steps = max(existing, synced)`): never below what this phone already saved for the day, never below a
 * higher number someone else saved (another phone, a Health sync, a number typed higher). Today's saves are throttled
 * (≥ 50 steps more, or 10 min since the last save); a past day's final count is saved whenever it is higher.
 *
 * Two exceptions, both kept as the day's BASE ("the day was N when the automatic count stood at A"):
 * - an EDIT: the member set the day themselves — lower too (a bus ride counted as steps) — on the phone's Edit sheet,
 *   or on the website / another phone (seen as a real server read, made after this phone's last save, that is lower
 *   than it). From then on the day is N + whatever is counted after it; a day edited with nothing counting it (a past
 *   day) stays at N;
 * - a START: this phone began counting partway through a day that already had a count saved (typed before automatic
 *   counting existed, or saved before a sign-out cleared the phone's readings). The day is then the higher of the
 *   automatic count and N + what was counted since.
 */
import type { DaySteps, StepSource } from './types';

/** Where a shown / saved number came from: an automatic source, a count saved elsewhere, or the member's own edit. */
export type ShownSource = StepSource | 'saved' | 'edited';

/** An automatic count for a day (the best source's). */
export interface AutoCount {
  steps: number;
  source: StepSource;
}

export interface DayBase {
  kind: 'edit' | 'start';
  /** The day's count at `at`. */
  steps: number;
  /** The automatic count (`source`) at `at`; what it adds after that counts on top. */
  auto: number;
  /** Null: nothing counted this day when it was set (an edited past day) — it stays at `steps`. */
  source: StepSource | null;
  at: number;
  /** The day's count at the last reading (carried over when the best source changes). */
  last?: number;
}

/** What this phone knows about one day on the server. */
export interface DayRecord {
  /** The count this phone last saved (the server confirmed it), or the member's edit it accepted. */
  sent?: number;
  sentAt?: number;
  sentSource?: ShownSource;
  /** The day's count as last read from the server (a real read — never this phone's own cached save). */
  server?: number;
  serverAt?: number;
  base?: DayBase;
  /** A past day whose final count was saved (it is no longer read). */
  final?: boolean;
}

/** A real read of the day's count on the server: the value and when the request STARTED. */
export interface ServerObservation {
  steps: number;
  requestedAt: number;
}

/** Server limit (`boundedNumber(0, 100000)`). */
export const MAX_DAY_STEPS = 100_000;
export const POST_MIN_CHANGE = 50;
export const POST_MIN_INTERVAL_MS = 10 * 60_000;

export function clampSteps(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_DAY_STEPS, Math.round(n));
}

/** The highest count this phone knows is on the server for the day. */
export function knownFloor(rec: DayRecord | undefined): number {
  return Math.max(rec?.sent ?? 0, rec?.server ?? 0);
}

/* ───────────────────────────── The day's base ───────────────────────────── */

/**
 * The day's count from the automatic reading `auto` and the day's base; null when there is neither. While the best
 * source isn't the base's own any more, the base counts as its last value (the sync re-anchors it: `rebased`).
 */
export function withBase(auto: AutoCount | null, base: DayBase | undefined): { steps: number; source: ShownSource } | null {
  if (!base) return auto ? { steps: clampSteps(auto.steps), source: auto.source } : null;
  const label: ShownSource = base.kind === 'edit' ? 'edited' : (base.source ?? 'saved');
  if (base.source == null) return { steps: clampSteps(base.steps), source: label };
  if (!auto || auto.source !== base.source) {
    const kept = clampSteps(base.last ?? base.steps);
    if (base.kind === 'start' && auto && clampSteps(auto.steps) > kept) return { steps: clampSteps(auto.steps), source: auto.source };
    return { steps: kept, source: label };
  }
  const counted = clampSteps(base.steps + Math.max(0, auto.steps - base.auto));
  if (base.kind === 'start') return { steps: Math.max(counted, clampSteps(auto.steps)), source: auto.source };
  return { steps: counted, source: 'edited' };
}

/** The best source changed under a base: the same base re-anchored on the new source (null when nothing to do). */
export function rebased(base: DayBase | undefined, auto: AutoCount | null, now: number): DayBase | null {
  if (!base || base.source == null || !auto || auto.source === base.source) return null;
  const kept = clampSteps(base.last ?? base.steps);
  return { ...base, steps: kept, auto: auto.steps, source: auto.source, at: now, last: kept };
}

/** A member's edit to `steps`, made while the automatic count stood at `auto` (null: nothing counting that day). */
export function editBase(steps: number, auto: AutoCount | null, now: number): DayBase {
  const n = clampSteps(steps);
  return { kind: 'edit', steps: n, auto: auto ? auto.steps : 0, source: auto ? auto.source : null, at: now, last: n };
}

/**
 * A real server read lower than this phone's last save, requested after that save completed: the day was set lower
 * elsewhere (the member, on the website or another phone — automatic saves only ever raise it).
 */
export function editedOnServer(rec: DayRecord | undefined, seen: ServerObservation | null | undefined): boolean {
  if (!seen || rec?.sent == null || rec.sentAt == null) return false;
  return seen.requestedAt > rec.sentAt && seen.steps < rec.sent;
}

/** This phone's counter began partway through the day (no earlier readings) and the day has no base yet. */
export function needsStartBase(day: DaySteps, rec: DayRecord | undefined): boolean {
  return !rec?.base && day.source === 'phone' && day.partialFrom != null;
}

/** The START base for such a day, given the server's count (null = unknown): what was saved before counting began. */
export function startBase(day: DaySteps, rec: DayRecord | undefined, server: number | null, now: number): DayBase {
  const saved = Math.max(rec?.sent ?? 0, server ?? 0);
  return { kind: 'start', steps: saved, auto: day.steps, source: day.source, at: now, last: Math.max(saved, clampSteps(day.steps)) };
}

/**
 * The count to save for `day` (null: nothing to save — an edited day nothing counts). Today never saves the estimated
 * part of a reading (steps from a long stretch the phone couldn't check, spread over the days by time): today's number
 * on the server stays what was really counted, and the estimate goes in once the day is past.
 */
export function postTarget(day: DaySteps, rec: DayRecord | undefined, isToday: boolean): number | null {
  const base = rec?.base;
  if (base) {
    if (base.source == null) return null;
    return withBase(day, base)?.steps ?? null;
  }
  const estimate = isToday ? Math.max(0, day.estimated ?? 0) : 0;
  return clampSteps(day.steps - estimate);
}

/* ───────────────────────────── Saving ───────────────────────────── */

/**
 * Should the automatic count `steps` be saved now? `final`: a past day (saved whenever it is higher, no throttle).
 * The caller re-reads the server's current value right before saving (`serverAllows`).
 */
export function shouldPost(steps: number, rec: DayRecord | undefined, now: number, final: boolean): boolean {
  const target = clampSteps(steps);
  const floor = knownFloor(rec);
  if (target <= floor) return false;
  if (final || rec?.sentAt == null) return true;
  return target - floor >= POST_MIN_CHANGE || now - rec.sentAt >= POST_MIN_INTERVAL_MS;
}

/** With the server's current value `server` (null = unknown), may `steps` be saved? Never lowers the server's count. */
export function serverAllows(steps: number, server: number | null): boolean {
  return server == null || clampSteps(steps) > server;
}

/* ───────────────────────────── Today's number ───────────────────────────── */

/**
 * The number Today shows for a day: the highest of the live automatic count (with the day's base), what this phone
 * saved, and what the server has (so it never drops below what the website shows). Ties favour the live reading,
 * then this phone's save. After an edit `sent` is the member's own number, so the higher count before it is gone.
 */
export function shownSteps(
  auto: AutoCount | null,
  rec: DayRecord | undefined,
  server: number | null | undefined
): { steps: number; source: ShownSource } | null {
  const candidates: { steps: number; source: ShownSource; rank: number }[] = [];
  const live = withBase(auto, rec?.base);
  if (live) candidates.push({ ...live, rank: 0 });
  if (rec?.sent != null) candidates.push({ steps: rec.sent, source: rec.sentSource ?? 'saved', rank: 1 });
  const serverNow = server ?? rec?.server;
  if (serverNow != null) {
    const ours = rec?.sent != null && serverNow === rec.sent;
    candidates.push({ steps: serverNow, source: ours ? (rec?.sentSource ?? 'saved') : 'saved', rank: ours ? 1 : 2 });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.steps - a.steps || a.rank - b.rank);
  return { steps: candidates[0].steps, source: candidates[0].source };
}
