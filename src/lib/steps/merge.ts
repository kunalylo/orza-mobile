/**
 * Which reading decides a member day — steps v2's merge rules (`docs/notes/steps-v2.md` §2.3). Pure — no React Native
 * imports — so `npm run test:steps` runs it in Node.
 *
 * - M0: a health store's 0 is "nothing synced" (no reading); a phone source's 0 for time it covered is a real 0. A
 *   missing reading never wins and is never complete.
 * - M1: the phone's own sources (Recording API, sampler, CMPedometer) read one sensor: compared by real steps
 *   (`steps − estimated`), never added. The winner brings its own flags (coverage, estimate, complete).
 * - M2: at most one health store per platform (Health Connect's aggregate, Apple Health's statistics sum).
 * - M3, today: the higher of the store and the phone by real steps (the live tail — stores lag behind), a tie to the
 *   store. Today never saves the estimated part (the save plan subtracts it).
 * - M4, a past day: the store's, when it covers the day from as early as the phone does — even when the phone counted
 *   more (it is what other health apps show, C3). Otherwise the higher by real steps; the phone alone counts whole,
 *   estimate included.
 * - C16 (documented, not fixed): two phones carried in different parts of a day each save their own count and the
 *   server keeps the higher one, so such a day is low. Adding them would double count the usual day, when both are
 *   carried together.
 * - M5, the day's base (`DayBase`), anchored in TIME, never in a source's value (C4): the day is the base's number
 *   plus what was counted after its instant `at` — each source's own count over [at, now), chosen by M3 / M4 like a
 *   day. So a change of the leading source never loses or adds steps, and a watch's late sync of steps from before
 *   `at` never adds on. An `edit` is that sum; a `start` (the day had a number before anything counted it) is the
 *   higher of that sum and the whole-day count; an edit made after the day ended is the member's number for good.
 */
import type { DayBase, DayReading, PhoneCounter, SourceReading, StepSource } from './types';

/** Server limit (`boundedNumber(0, 100000)`). */
export const MAX_DAY_STEPS = 100_000;

/** A day count as the server takes it: a whole number in 0..MAX_DAY_STEPS (not finite → 0). */
export function clampSteps(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_DAY_STEPS, Math.round(n));
}

const STORES: ReadonlySet<StepSource> = new Set(['health_connect', 'apple_health']);

/** Equal real steps between phone sources: the exact counters before the sampler ("approximate"). */
const COUNTER_RANK: Record<PhoneCounter, number> = { recording: 0, pedometer: 1, sampler: 2 };

export const isStore = (source: StepSource) => STORES.has(source);

/** Real steps: the count without its long-gap estimate (C7: comparisons never let an estimate decide). */
export const realSteps = (x: SourceReading) => x.steps - (x.estimated ?? 0);

/** M0: a reading that may take part (whole steps, the estimate within them), or null. */
function usable(x: SourceReading | null | undefined): SourceReading | null {
  if (!x || !Number.isFinite(x.steps) || x.steps < 0 || !Number.isFinite(x.coverFrom)) return null;
  const steps = Math.round(x.steps);
  if (steps <= 0 && isStore(x.source)) return null;
  const estimated = Number.isFinite(x.estimated) && (x.estimated ?? 0) > 0 ? Math.min(steps, Math.round(x.estimated ?? 0)) : 0;
  if (steps === x.steps && estimated === (x.estimated ?? 0)) return x;
  const { estimated: _dropped, ...rest } = x;
  return { ...rest, steps, ...(estimated ? { estimated } : {}) };
}

/** `a` beats `b` among phone sources: more real steps, then less estimated, then the more exact counter. */
function betterPhone(a: SourceReading, b: SourceReading): boolean {
  if (realSteps(a) !== realSteps(b)) return realSteps(a) > realSteps(b);
  if ((a.estimated ?? 0) !== (b.estimated ?? 0)) return (a.estimated ?? 0) < (b.estimated ?? 0);
  return COUNTER_RANK[a.counter ?? 'sampler'] < COUNTER_RANK[b.counter ?? 'sampler'];
}

/** M1: the phone source with the most real steps (null when no phone source has a reading). */
export function phoneWinner(sources: readonly SourceReading[]): SourceReading | null {
  let best: SourceReading | null = null;
  for (const raw of sources) {
    if (raw.source !== 'phone') continue;
    const x = usable(raw);
    if (x && (!best || betterPhone(x, best))) best = x;
  }
  return best;
}

/** M2: the health store's reading (null when it has none). */
export function storeReading(sources: readonly SourceReading[]): SourceReading | null {
  let best: SourceReading | null = null;
  for (const raw of sources) {
    if (!isStore(raw.source)) continue;
    const x = usable(raw);
    if (x && (!best || realSteps(x) > realSteps(best))) best = x;
  }
  return best;
}

/**
 * M3 / M4: the reading that decides the day's automatic count (null when no source has one). Its `steps` include its
 * estimate; `estimated` says how much of it that is.
 */
export function autoCount(reading: DayReading, isToday: boolean): SourceReading | null {
  const store = storeReading(reading.sources);
  const phone = phoneWinner(reading.sources);
  if (!store || !phone) return store ?? phone;
  // M4: a past day follows the store when it sees the day from as early as the phone.
  if (!isToday && store.coverFrom <= phone.coverFrom) return store;
  // M3 (and M4 otherwise): the higher by real steps, a tie to the store.
  return realSteps(phone) > realSteps(store) ? phone : store;
}

/**
 * S-H2: the first instant of `day` Health Connect can see. On the day ÖRZA first saw `READ_STEPS` granted
 * (`grantAt`), HC holds this phone's steps only from the grant on (its on-device counting starts with the first
 * grant): covered from the grant when HC had nothing before it (`preGrant`, its count over [day start, grantAt); an
 * empty read is 0, S-H1), from the day's start when another writer (a watch, a fitness app) had. Every other day:
 * the whole day.
 */
export function hcCoverFrom(day: { start: number; end: number }, grantAt: number | null | undefined, preGrant: number | null | undefined): number {
  if (grantAt == null || !Number.isFinite(grantAt) || grantAt <= day.start || grantAt >= day.end) return day.start;
  return (preGrant ?? 0) > 0 ? day.start : grantAt;
}

/**
 * M9, a shared phone: the part of `day` this member's steps may come from — from `floor` (their consent, when another
 * member consented on this install first). Null for a day that ended by then: no reading at all. Readers read every
 * source over the returned range, so a source's `coverFrom` is never before the floor (and today becomes a START,
 * M5c3, when the day already had steps saved).
 */
export function applyCoverFloor(day: { start: number; end: number }, floor: number | null | undefined): { start: number; end: number } | null {
  if (floor == null || !Number.isFinite(floor) || floor <= day.start) return day;
  if (floor >= day.end) return null;
  return { start: floor, end: day.end };
}

/* ───────────────────────────── M5: bases ───────────────────────────── */

/**
 * What source `x` counted after `at`, as a reading of its own covered from max(at, coverFrom) — or null when it can't
 * tell. All of its count when its coverage starts at or after `at`; else its `since`, when the reader measured it for
 * this very `at` (one for another instant — the base changed after the read — is never stretched to fit). Never more
 * than its whole count. A `since` without an estimate of its own is taken as at most the reading's (C7: it never
 * passes as real steps).
 */
function sinceReading(x: SourceReading, at: number): SourceReading | null {
  if (x.coverFrom >= at) return x;
  const since = x.since;
  if (!since || since.at !== at || !Number.isFinite(since.steps)) return null;
  const steps = Number.isFinite(x.steps) ? Math.min(since.steps, x.steps) : since.steps;
  const estimated = since.estimated ?? Math.min(steps, x.estimated ?? 0);
  const { since: _since, estimated: _estimated, ...rest } = x;
  return { ...rest, steps, coverFrom: at, ...(estimated ? { estimated } : {}) };
}

/**
 * M5 `counted(base)`: what the day's sources counted after `at`, chosen like a day's count (M0–M4 over each source's
 * count since `at`: today the higher, a past day the store's) — null when no source can say (none has a count for
 * that instant, or `at` is at or after the day's end: nothing can be counted then).
 */
export function counted(reading: DayReading, at: number, isToday: boolean): SourceReading | null {
  if (!(at < reading.end)) return null;
  const sources = reading.sources.flatMap((x) => sinceReading(x, at) ?? []);
  return autoCount({ ...reading, sources }, isToday);
}

/** A member day's number (M5) — what Today shows and the save plan saves (`policy.ts`). */
export interface DayValue {
  /** The day's count, 0..MAX_DAY_STEPS. */
  steps: number;
  /** How many of `steps` are a long-gap estimate (a phone source's): today's save leaves them out (M3). */
  estimated: number;
  /**
   * What decided it: `auto` — the whole-day automatic count (no base, or a start's whole-day count was higher);
   * `edit` / `start` — the base's number plus what was counted after it.
   */
  basis: 'auto' | 'edit' | 'start';
  /** The reading the count comes from (its source and counter label the number); null: the base alone. */
  winner: SourceReading | null;
  /** An edit made after the day ended (M5d): the member's number for good — nothing is saved automatically. */
  fixed: boolean;
}

function valueOf(steps: number, estimated: number | undefined, basis: DayValue['basis'], winner: SourceReading | null): DayValue {
  const n = clampSteps(steps);
  return { steps: n, estimated: Math.min(n, clampSteps(estimated ?? 0)), basis, winner, fixed: false };
}

const realValue = (v: DayValue) => v.steps - v.estimated;

/**
 * M5: the day's number from its reading and its base (null: no base and no source has the day).
 * - (e) no base: the automatic count (M3 / M4);
 * - (a) `edit`: the base's number plus what was counted after its instant;
 * - (b) `start`: the higher of the whole-day count and that sum — by real steps (C7: a mostly estimated whole day
 *   doesn't replace a typed number), a tie to the whole-day count;
 * - (d) an `edit` made at or after the day's end: its number, fixed — late data from before it never adds on.
 */
export function dayValue(reading: DayReading, base: DayBase | null | undefined, isToday: boolean): DayValue | null {
  const auto = autoCount(reading, isToday);
  const whole = auto ? valueOf(auto.steps, auto.estimated, 'auto', auto) : null;
  if (!base) return whole;
  if (base.kind === 'edit' && base.at >= reading.end) return { ...valueOf(base.steps, 0, 'edit', null), fixed: true };
  const since = counted(reading, base.at, isToday);
  const added = valueOf(clampSteps(base.steps) + (since?.steps ?? 0), since?.estimated, base.kind, since);
  if (base.kind === 'edit' || !whole) return added;
  return realValue(added) > realValue(whole) ? added : whole;
}

/** M5c: something counted the day at instant `a` — a source with a reading (not a store's "nothing synced") from `a` or earlier. */
function countingAt(reading: DayReading | null | undefined, a: number): boolean {
  return !!reading?.sources.some((raw) => {
    const x = usable(raw);
    return !!x && x.coverFrom <= a;
  });
}

/**
 * M5c1: the member saved `steps` for the day on this phone at `at` (`editRef`: the edit marker the server answered
 * with; null from a server without markers). An `edit` when something was counting the day at that instant
 * (`reading`: the day's latest); else a `start` — typed while nothing counted, so counting that begins later adds on,
 * and a higher whole-day count can still replace it.
 */
export function baseForEdit(steps: number, at: number, reading: DayReading | null | undefined, editRef: string | null | undefined): DayBase {
  return { kind: countingAt(reading, at) ? 'edit' : 'start', steps: clampSteps(steps), at, editRef: editRef ?? null };
}

/**
 * M5c2: the server's edit marker for the day (`steps_edited_at`, set by every manual save — the website, another
 * phone) with the day's count there, seen at `now`. None, or one this phone already knows (`knownRef`: its own
 * edit's, or one taken before) → null. Else the base, made like `baseForEdit` at the marker's instant clamped to
 * [day start, now] (a marker that doesn't parse: now), with the marker as its `editRef`.
 */
export function baseFromMarker(
  marker: string | null | undefined,
  serverSteps: number,
  reading: DayReading,
  now: number,
  knownRef: string | null | undefined
): DayBase | null {
  if (!marker || marker === knownRef) return null;
  const latest = Math.max(reading.start, now);
  const parsed = Date.parse(marker);
  const at = Number.isFinite(parsed) ? Math.min(Math.max(parsed, reading.start), latest) : latest;
  return baseForEdit(serverSteps, at, reading, marker);
}

/**
 * M5c3, an implicit start: counting began partway through a day that already had a number on the server — a new
 * source's first day, a re-subscribe after a sign-out, a shared phone's consent day (M9). When the day has no base,
 * this phone hasn't saved it automatically yet (`autoSent`), the server's count (`server`, as last read) is above 0
 * and the winning reading's coverage starts after midnight: a `start` with that number, at that coverage's start.
 * Else null. `known` takes the day's record as it is.
 */
export function implicitStart(
  reading: DayReading,
  isToday: boolean,
  known: { base?: DayBase | null; autoSent?: number | null; server?: number | null }
): DayBase | null {
  if (known.base || known.autoSent != null) return null;
  const server = clampSteps(known.server ?? 0);
  if (server <= 0) return null;
  const winner = autoCount(reading, isToday);
  if (!winner || winner.coverFrom <= reading.start) return null;
  return { kind: 'start', steps: server, at: winner.coverFrom };
}
