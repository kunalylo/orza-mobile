/**
 * When the phone saves its automatic count, and which number Today shows — pure (tested by `npm run test:steps`).
 *
 * `POST /api/track/steps` SETS the day's count, so the phone only ever raises it, like the server's own Health import
 * mirror (`steps = max(existing, synced)`): never below what this phone already saved for the day, never below a
 * higher number someone else saved (typed on the website, a Health sync, another phone). Today's saves are throttled
 * (≥ 50 steps more, or 10 min since the last save); a past day's final count is saved whenever it is higher.
 */
import type { StepSource } from './types';

/** What this phone knows about one day on the server. */
export interface DayRecord {
  /** The count this phone last saved (the server confirmed it). */
  sent?: number;
  sentAt?: number;
  sentSource?: StepSource;
  /** The day's count as last seen on the server (Today's data or a check before saving). */
  server?: number;
  serverAt?: number;
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

/**
 * Should the automatic count `steps` be saved now? `final`: a past day (saved whenever it is higher, no throttle).
 * The caller re-checks the server's current value before actually saving (`serverAllows`).
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

/** Where the number Today shows came from: an automatic source, or a count saved earlier (typed / another device). */
export type ShownSource = StepSource | 'saved';

/**
 * The number Today shows for a day: the highest of the live automatic count, what this phone saved, and what the
 * server has (so it never drops below what the website shows). Ties favour the live reading, then this phone's save.
 */
export function shownSteps(
  auto: { steps: number; source: StepSource } | null,
  rec: DayRecord | undefined,
  server: number | null | undefined
): { steps: number; source: ShownSource } | null {
  const candidates: { steps: number; source: ShownSource; rank: number }[] = [];
  if (auto) candidates.push({ steps: clampSteps(auto.steps), source: auto.source, rank: 0 });
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
