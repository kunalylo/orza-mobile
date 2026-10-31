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
 */
import type { DayReading, PhoneCounter, SourceReading, StepSource } from './types';

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
