/**
 * iPhone step sources — every decision of `reader.ios.ts` (`docs/notes/steps-v2.md` §2.1, §2.2, §4.3), which only does
 * the native calls. Pure — no React Native imports — so `npm run test:steps` runs it in Node.
 *
 * - S-I1 Apple Health: a statistics sum per instant range of the profile-zone day (iPhone + Apple Watch counted once,
 *   like the Health app), covering the whole day (HealthKit keeps the iPhone's history from before the grant). ON with
 *   the member's store consent once the StepCount sheet was answered. A 0 is no reading (M0): HealthKit shows a refused
 *   read as "no data", so ÖRZA never claims the member denied it (§2.2's "Health empty").
 * - S-I2 CMPedometer (the motion sensor): only with the member's phone consent (the fallback offer, or no HealthKit) and
 *   Motion & Fitness. It keeps 7 days: a day that starts further back has no reading. A real 0 counts (it covered the
 *   time).
 * - M5 / S-R4 on iPhone: a base's count since its instant, from both sources, on every day that has one.
 * - M5f: a source that is ON but couldn't be read this run (Apple Health while the phone is locked — its store is
 *   encrypted —, a failed query) marks the day `storeUnread`: a lower bound that may raise, never lower or settle.
 * - M9: a shared iPhone reads nothing from before the member's consent (`shared.dayPlans`' coverage floor).
 * - §4.3: Apple Health's background delivery of steps is set up while the store is ON, and only when that changes.
 */
import type { StepRange } from '../health/types';

import { SETTLE_PHONE_MS } from './plan';
import { sinceRange, withSince, type DayPlan } from './shared';
import type { DayReading, SinceCount, SourceReading, StepFeatures, StoreAccess } from './types';

/** CMPedometer keeps this much history: a day that starts further back can't be read whole (S-I2: no reading). */
export const PEDOMETER_KEEP_MS = 7 * 24 * 3_600_000;

/* ───────────────────────────── What this iPhone has (§2.2) ───────────────────────────── */

/** `healthAvailable`: HealthKit is there (not on a restricted device, nor in a build without the module). */
export function iosFeatures(healthAvailable: boolean, counter: boolean): StepFeatures {
  return { platform: 'ios', store: healthAvailable ? 'available' : 'unavailable', counter };
}

/** Apple Health's steps access: `granted` = the StepCount sheet was answered (HealthKit never says whether reading was allowed). */
export function iosStoreAccess(healthAvailable: boolean, answered: boolean): StoreAccess {
  if (!healthAvailable) return 'unavailable';
  return answered ? 'granted' : 'not_granted';
}

/* ───────────────────────────── Asks ───────────────────────────── */

/** What one source is asked for one day: its total over the day's read range, and a base's count since its instant. */
export interface DayAsk {
  date: string;
  total: StepRange;
  /** `shared.sinceRange` from the read range's start (null: no base, or all of the count is after it). */
  since: { at: number; range: StepRange | null } | null;
}

function askFor(day: DayPlan, sinceAt: Readonly<Record<string, number>> | undefined): DayAsk | null {
  if (!day.read) return null;
  const { from, to } = day.read;
  return { date: day.date, total: { start: from, end: to }, since: sinceRange(day, from, sinceAt?.[day.date]) };
}

/** Apple Health: every day that may be read (S-I1: the whole day — HealthKit has the history; or from the floor, M9). */
export function healthAsks(days: readonly DayPlan[], sinceAt?: Readonly<Record<string, number>>): DayAsk[] {
  return days.flatMap((d) => askFor(d, sinceAt) ?? []);
}

/** CMPedometer: the days it still holds — read from at most `PEDOMETER_KEEP_MS` before `now` (S-I2). */
export function pedometerAsks(days: readonly DayPlan[], now: number, sinceAt?: Readonly<Record<string, number>>): DayAsk[] {
  return days.flatMap((d) => (d.read && now - d.read.from <= PEDOMETER_KEEP_MS ? (askFor(d, sinceAt) ?? []) : []));
}

/** Every range of `asks` for one batch: per ask its total, then its since range when there is one. */
export function askRanges(asks: readonly DayAsk[]): StepRange[] {
  return asks.flatMap((a) => [a.total, ...(a.since?.range ? [a.since.range] : [])]);
}

/** One ask's answers: steps over its total and since ranges (null: not asked, or the query failed). */
export interface AskAnswer {
  total: number | null;
  since: number | null;
}

/** The batch's counts (`askRanges` order) back per ask; null `counts` (the batch was skipped or failed) → every answer null. */
export function askAnswers(asks: readonly DayAsk[], counts: readonly (number | null)[] | null): (AskAnswer | null)[] {
  if (!counts) return asks.map(() => null);
  let i = 0;
  const next = () => counts[i++] ?? null;
  return asks.map((a) => {
    const total = next();
    const since = a.since?.range ? next() : null;
    return { total, since };
  });
}

/* ───────────────────────────── Readings ───────────────────────────── */

/** A source's reading of one day (null: none), and whether it is ON but wasn't read (M5f). */
export interface DayRead {
  reading: SourceReading | null;
  unread: boolean;
}

const count = (n: number | null | undefined): number | null => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.round(n) : null);

/** The base's count since its instant: 0 when nothing can follow it, none when its query failed (`sinceUnknown`). */
function sinceOf(ask: DayAsk, answer: AskAnswer | null): SinceCount | undefined {
  if (!ask.since) return undefined;
  const steps = ask.since.range ? count(answer?.since) : 0;
  return steps == null ? undefined : { at: ask.since.at, steps };
}

/**
 * S-I1: Apple Health's reading of `day`. No answer (the read failed: the phone locked, a query error) → unread, never
 * "no data". A 0 → no reading (M0: nothing recorded, or a refused read — HealthKit hides which). Covered from the
 * read range's start (the day's, or a shared iPhone's floor).
 */
export function healthReading(day: DayPlan, ask: DayAsk, answer: AskAnswer | null, now: number): DayRead {
  const steps = count(answer?.total);
  if (steps == null) return { reading: null, unread: true };
  if (steps <= 0) return { reading: null, unread: false };
  const reading: SourceReading = { source: 'apple_health', steps, coverFrom: ask.total.start, complete: now >= day.end };
  const since = sinceOf(ask, answer);
  return { reading: since ? withSince(reading, since) : reading, unread: false };
}

/**
 * S-I2: CMPedometer's reading of `day` — a real 0 included (it counted the time). Complete an hour after the day ended
 * (M7). A failed query → unread (like Android's Recording API, R2): the day may be missing the phone's count.
 */
export function pedometerReading(day: DayPlan, ask: DayAsk, answer: AskAnswer | null, now: number): DayRead {
  const steps = count(answer?.total);
  if (steps == null) return { reading: null, unread: true };
  const reading: SourceReading = {
    source: 'phone',
    counter: 'pedometer',
    steps,
    coverFrom: ask.total.start,
    complete: now >= day.end + SETTLE_PHONE_MS,
  };
  const since = sinceOf(ask, answer);
  return { reading: since ? withSince(reading, since) : reading, unread: false };
}

/** Each ask's answer read into the day's reading (`healthReading` / `pedometerReading`), by date. */
export function readingsByDate(
  days: readonly DayPlan[],
  asks: readonly DayAsk[],
  answers: readonly (AskAnswer | null)[],
  read: (day: DayPlan, ask: DayAsk, answer: AskAnswer | null, now: number) => DayRead,
  now: number
): Map<string, DayRead> {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const out = new Map<string, DayRead>();
  asks.forEach((ask, i) => {
    const day = byDate.get(ask.date);
    if (day) out.set(ask.date, read(day, ask, answers[i] ?? null, now));
  });
  return out;
}

/* ───────────────────────────── The day ───────────────────────────── */

/**
 * The day readings, in `days`' order: Apple Health's reading first, then CMPedometer's; `storeUnread` when either source
 * is ON but wasn't read for the day (M5f). A day that may not be read (M9) has no sources and is never unread.
 */
export function iosDays(days: readonly DayPlan[], parts: { health?: ReadonlyMap<string, DayRead>; phone?: ReadonlyMap<string, DayRead> }): DayReading[] {
  return days.map((day) => {
    const { date, start, end } = day;
    if (!day.read) return { date, start, end, sources: [] };
    const health = parts.health?.get(date);
    const phone = parts.phone?.get(date);
    const sources = [health?.reading, phone?.reading].filter((x): x is SourceReading => !!x);
    const unread = !!health?.unread || !!phone?.unread;
    return { date, start, end, sources, ...(unread ? { storeUnread: true } : {}) };
  });
}

/* ───────────────────────────── Background delivery (§4.3) ───────────────────────────── */

/**
 * Apple Health wakes ÖRZA for new steps (hourly at most) while the store is ON for the member (`storeOn`), and not
 * otherwise (no consent, the switch off, sign-out). `configured`: what this install last set up (the prefs'
 * `hkBackground`). Only a change calls HealthKit: configuring again tears its observer down and drops the JS callback.
 */
export function backgroundChange(storeOn: boolean, configured: boolean): 'configure' | 'clear' | null {
  if (storeOn === configured) return null;
  return storeOn ? 'configure' : 'clear';
}
