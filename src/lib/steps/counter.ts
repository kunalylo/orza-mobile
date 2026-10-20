/**
 * Daily step totals from raw step-counter samples (Android's hardware counter, read by `modules/orza-steps`).
 *
 * Pure — no React Native imports — so `npm run test:steps` runs it in Node. Each sample is `counter` steps since the
 * phone booted; the counter restarts from 0 at every boot. Between two consecutive samples:
 * - same boot, counter not lower → the difference was walked in between;
 * - a reboot (or the counter restarted) → the new value was walked since the restart (from boot time when known);
 * - a delta faster than MAX_STEPS_PER_HOUR is a glitch and ignored (the next plausible reading carries on);
 * and each delta is credited to local days in the member's time zone, split across midnight in proportion to time.
 *
 * "Same boot" is decided by the boot clock (`elapsed`) whenever both readings have it: it restarts only with the
 * kernel, while BOOT_COUNT can move without one (a runtime restart re-sends BOOT_COMPLETED). Readings of one boot are
 * re-anchored to that boot's latest wall clock, so a reading taken before network time was set (or across a manual
 * clock change) lands at its real instant.
 */
import { addDays, safeTimeZone, utcToZoned, zonedToUtc } from '../alarms/schedule';

export interface StepSample {
  /** Wall clock, epoch ms. */
  ts: number;
  /** Steps since this boot. */
  counter: number;
  /** Boot number (Settings.Global.BOOT_COUNT); -1 when unknown. */
  boot: number;
  /** ms since this boot at the reading (survives wall-clock changes); -1 when unknown. */
  elapsed: number;
}

export interface DayCount {
  /** Local day, YYYY-MM-DD. */
  date: string;
  steps: number;
  /** Earliest instant of this day the samples cover (epoch ms) — the day's start when the whole day is covered. */
  coveredFrom: number;
  /** Latest instant of this day the samples cover. */
  coveredTo: number;
  /** Some of the count comes from a long gap between samples that crossed midnight (split by time: an estimate). */
  estimated: boolean;
  /** How many of `steps` are such an estimate (0 when none). */
  estimatedSteps: number;
}

/** Faster than this is a sensor glitch, not walking (elite sprinting is ~18 000 steps an hour). */
export const MAX_STEPS_PER_HOUR = 50_000;
/** Short intervals are judged as if they lasted this long: a delayed reading can bunch a few minutes of steps. */
export const MIN_RATE_WINDOW_MS = 15 * 60_000;
/** A delta spread over a longer gap than this across midnight makes the days it touches estimates. */
export const ESTIMATE_GAP_MS = 3 * 3_600_000;

const HOUR_MS = 3_600_000;
/** A day counts as covered from its start (to its end) when coverage begins (ends) within this of midnight. */
const COVER_SLACK_MS = 60_000;
/** Readings of one boot whose wall clocks disagree by more than this were taken under different clocks. */
const CLOCK_SLACK_MS = 2 * 60_000;
/** A boot instant this much later than the previous reading means a new kernel boot (absorbs small clock fixes). */
const BOOT_SLACK_MS = 5 * 60_000;
/**
 * Readings stamped before this (2025-01-01) were taken under a reset clock (a phone that lost its time shows 1970 /
 * 2009 / 2016 until network time arrives). Kept only when their boot has a later, sane reading to re-anchor them.
 */
const MIN_PLAUSIBLE_TS = Date.UTC(2025, 0, 1);

/* ───────────────────────────── Time zone helpers ───────────────────────────── */

/** Local day (YYYY-MM-DD) of an instant in `tz`. */
export function localDay(ms: number, tz: string): string {
  return utcToZoned(new Date(ms), tz).date;
}

const dayStarts = new Map<string, number>();

/** First instant (epoch ms) of local day `date` in `tz` (DST-safe, including zones whose midnight can be skipped). */
export function dayStartMs(date: string, tz: string): number {
  const key = `${tz}|${date}`;
  const known = dayStarts.get(key);
  if (known !== undefined) return known;
  let start = zonedToUtc(date, '00:00', tz).getTime();
  if (localDay(start, tz) !== date || localDay(start - 1, tz) === date) {
    // Midnight doesn't exist that day (or the guess landed off): find the first minute that belongs to `date`.
    let lo = start - 26 * HOUR_MS;
    let hi = start + 26 * HOUR_MS;
    while (hi - lo > 60_000) {
      const mid = Math.floor((lo + hi) / 2);
      if (localDay(mid, tz) < date) lo = mid;
      else hi = mid;
    }
    start = hi;
  }
  if (dayStarts.size > 2_000) dayStarts.clear();
  dayStarts.set(key, start);
  return start;
}

/** The first instant after `ms` that belongs to the next local day. */
function nextDayStart(ms: number, tz: string): number {
  const next = dayStartMs(addDays(localDay(ms, tz), 1), tz);
  return next > ms ? next : ms + 1;
}

/* ───────────────────────────── Ordering ───────────────────────────── */

const valid = (s: StepSample) => Number.isFinite(s.ts) && s.ts > 0 && Number.isFinite(s.counter) && s.counter >= 0;
const hasElapsed = (s: StepSample) => Number.isFinite(s.elapsed) && s.elapsed >= 0;

/** Wall-clock instant of the boot a sample belongs to, when known. */
function bootInstant(s: StepSample): number | null {
  return hasElapsed(s) ? s.ts - s.elapsed : null;
}

const knownBoot = (s: StepSample) => Number.isFinite(s.boot) && s.boot >= 0;

/** Which boot a sample belongs to: the boot number, else the boot instant to the minute. */
function sessionOf(s: StepSample): string {
  if (knownBoot(s)) return `b${s.boot}`;
  const boot = bootInstant(s);
  return boot != null ? `t${Math.round(boot / 60_000)}` : 'u';
}

/**
 * Samples in the order they were taken: readings within a boot by time since boot (immune to wall-clock changes) and
 * re-anchored to that boot's latest wall clock; boots by their boot number when every boot has one (it only goes up),
 * else by boot instant / first reading; exact duplicates dropped.
 */
export function orderSamples(input: readonly StepSample[]): StepSample[] {
  const sessions = new Map<string, StepSample[]>();
  for (const s of input) {
    if (!valid(s)) continue;
    const key = sessionOf(s);
    const list = sessions.get(key);
    if (list) list.push(s);
    else sessions.set(key, [s]);
  }
  const groups: { boot: number; start: number; list: StepSample[] }[] = [];
  for (const raw of sessions.values()) {
    const byElapsed = raw.every(hasElapsed);
    raw.sort((a, b) => (byElapsed ? a.elapsed - b.elapsed : 0) || a.ts - b.ts || a.counter - b.counter);
    // One boot clock, one wall clock: the latest reading's clock is the most likely right one (network time is set by
    // then); a reading whose boot instant disagrees with it by more than CLOCK_SLACK_MS is moved onto that clock.
    const ref = byElapsed ? bootInstant(raw[raw.length - 1]) : null;
    const list = ref == null ? raw : raw.map((s) => (Math.abs(s.ts - s.elapsed - ref) > CLOCK_SLACK_MS ? { ...s, ts: ref + s.elapsed } : s));
    const unique: StepSample[] = [];
    for (const s of list) {
      if (s.ts < MIN_PLAUSIBLE_TS) continue; // a reset clock nothing could re-anchor
      const last = unique[unique.length - 1];
      if (last && last.ts === s.ts && last.counter === s.counter && last.elapsed === s.elapsed) continue;
      unique.push(s);
    }
    if (!unique.length) continue;
    groups.push({ boot: knownBoot(unique[0]) ? unique[0].boot : -1, start: ref ?? Math.min(...unique.map((s) => s.ts)), list: unique });
  }
  const byBootNumber = groups.every((g) => g.boot >= 0);
  groups.sort((a, b) => (byBootNumber ? a.boot - b.boot : 0) || a.start - b.start);
  return groups.flatMap((g) => g.list);
}

/* ───────────────────────────── Deltas ───────────────────────────── */

interface Delta {
  steps: number;
  /** The interval the steps were taken in (epoch ms, in the newer reading's clock). */
  start: number;
  end: number;
  /** A reboot: from the previous reading to the boot nobody could count (phone off / restarting) — covered, 0 steps. */
  gapFrom?: number;
  /** The readings' clocks can't place it (a reboot whose new reading isn't after the old one, no boot clock): skip. */
  unplaceable?: boolean;
}

/**
 * Did the phone boot again between reading `a` and the later reading `b`? With both boot clocks: yes when b's restarted
 * (lower) or b's boot instant comes after `a` — a different BOOT_COUNT alone isn't enough (it can move without a
 * kernel reboot, and then the counter keeps running). Without them: a different boot.
 */
function rebootedBetween(a: StepSample, b: StepSample): boolean {
  if (hasElapsed(a) && hasElapsed(b)) {
    if (b.elapsed < a.elapsed) return true;
    if (knownBoot(a) && knownBoot(b) && a.boot === b.boot) return false;
    return b.ts - b.elapsed > a.ts + BOOT_SLACK_MS;
  }
  return sessionOf(a) !== sessionOf(b);
}

/** Steps between reading `a` and the later reading `b`. */
function deltaBetween(a: StepSample, b: StepSample): Delta {
  const rebooted = rebootedBetween(a, b);
  if (!rebooted && b.counter >= a.counter) {
    // Measure the interval on the boot clock when possible: a wall-clock change in between doesn't stretch it.
    const span = hasElapsed(a) && hasElapsed(b) ? b.elapsed - a.elapsed : b.ts - a.ts;
    return { steps: b.counter - a.counter, start: b.ts - Math.max(0, span), end: b.ts };
  }
  // Rebooted (or the counter restarted): everything on the counter now was walked since it restarted.
  const boot = rebooted ? bootInstant(b) : null;
  if (rebooted && b.ts <= a.ts) {
    // The two boots' clocks disagree: credit the new boot's steps from its own boot when known, else skip it.
    if (boot != null && boot <= b.ts) return { steps: b.counter, start: boot, end: b.ts };
    return { steps: b.counter, start: b.ts, end: b.ts, unplaceable: true };
  }
  let start = a.ts;
  if (boot != null && boot > start && boot <= b.ts) start = boot;
  start = Math.min(start, b.ts);
  return { steps: b.counter, start, end: b.ts, ...(start > a.ts ? { gapFrom: a.ts } : {}) };
}

function plausible(d: Delta): boolean {
  if (d.unplaceable) return false;
  const ms = Math.max(d.end - d.start, MIN_RATE_WINDOW_MS);
  return d.steps <= (MAX_STEPS_PER_HOUR * ms) / HOUR_MS;
}

/* ───────────────────────────── Crediting days ───────────────────────────── */

class DayBook {
  readonly days = new Map<string, DayCount>();

  constructor(private readonly tz: string) {}

  private credit(date: string, steps: number, from: number, to: number, estimated: boolean) {
    const est = estimated ? steps : 0;
    const d = this.days.get(date);
    if (!d) {
      this.days.set(date, { date, steps, coveredFrom: from, coveredTo: to, estimated, estimatedSteps: est });
      return;
    }
    d.steps += steps;
    d.coveredFrom = Math.min(d.coveredFrom, from);
    d.coveredTo = Math.max(d.coveredTo, to);
    d.estimated = d.estimated || estimated;
    d.estimatedSteps += est;
  }

  /** Coverage without steps (the first reading: counting starts here). */
  mark(at: number) {
    this.credit(localDay(at, this.tz), 0, at, at, false);
  }

  /** Credits a delta: its steps, and the off-time before a reboot as covered (so a reboot doesn't look like a gap). */
  add(d: Delta) {
    if (d.gapFrom != null && d.start > d.gapFrom) this.spread(0, d.gapFrom, d.start);
    this.spread(d.steps, d.start, d.end);
  }

  /** Credits `steps` taken during [start, end], split across local days in proportion to time (whole steps). */
  spread(steps: number, start: number, end: number) {
    if (!(end > start)) {
      this.credit(localDay(end, this.tz), steps, end, end, false);
      return;
    }
    const pieces: { date: string; from: number; to: number }[] = [];
    let at = start;
    for (let guard = 0; at < end && guard < 400; guard++) {
      const to = Math.min(end, nextDayStart(at, this.tz));
      pieces.push({ date: localDay(at, this.tz), from: at, to });
      at = to;
    }
    if (at < end) pieces.push({ date: localDay(at, this.tz), from: at, to: end });

    const estimated = steps > 0 && pieces.length > 1 && end - start > ESTIMATE_GAP_MS;
    // Largest-remainder rounding: the pieces add up to exactly `steps`.
    const total = end - start;
    const exact = pieces.map((p) => (steps * (p.to - p.from)) / total);
    const whole = exact.map(Math.floor);
    let left = steps - whole.reduce((s, n) => s + n, 0);
    const byRemainder = exact.map((x, i) => ({ i, r: x - whole[i] })).sort((a, b) => b.r - a.r || a.i - b.i);
    for (const { i } of byRemainder) {
      if (left <= 0) break;
      whole[i] += 1;
      left -= 1;
    }
    pieces.forEach((p, i) => this.credit(p.date, whole[i], p.from, p.to, estimated));
  }
}

/* ───────────────────────────── Public ───────────────────────────── */

/**
 * Steps per local day (member's time zone `timeZone`) from raw samples in any order. Days with coverage but no steps
 * are included with 0; days the samples don't reach are absent.
 *
 * The very first reading has nothing before it: when the phone booted earlier that same local day, its counter is
 * exactly that day's steps since boot (counted from boot time); otherwise counting starts at the reading and the day
 * is partial (`coveredFrom` after its start).
 */
export function dailyStepCounts(samples: readonly StepSample[], timeZone: string): Map<string, DayCount> {
  const tz = safeTimeZone(timeZone);
  const book = new DayBook(tz);
  let base: StepSample | null = null;
  /** The last reading rejected as a glitch — kept in case the counter really jumped and carries on from there. */
  let rejected: StepSample | null = null;

  for (const cur of orderSamples(samples)) {
    if (!base) {
      const boot = bootInstant(cur);
      const first: Delta | null = boot != null && boot <= cur.ts && localDay(boot, tz) === localDay(cur.ts, tz) ? { steps: cur.counter, start: boot, end: cur.ts } : null;
      if (first && plausible(first)) book.spread(first.steps, first.start, first.end);
      else book.mark(cur.ts);
      base = cur;
      continue;
    }
    const d = deltaBetween(base, cur);
    if (plausible(d)) {
      book.add(d);
      base = cur;
      rejected = null;
      continue;
    }
    if (rejected) {
      const r = deltaBetween(rejected, cur);
      if (plausible(r)) {
        book.add(r);
        base = cur;
        rejected = null;
        continue;
      }
    }
    rejected = cur;
  }
  return book.days;
}

/** True when `day`'s coverage starts at (or within a minute of) its local midnight. */
export function coversWholeDay(day: DayCount, timeZone: string): boolean {
  return day.coveredFrom <= dayStartMs(day.date, safeTimeZone(timeZone)) + COVER_SLACK_MS;
}

/** True when `day`'s coverage reaches (within a minute of) the next local midnight — a past day's count is final. */
export function coversDayEnd(day: DayCount, timeZone: string): boolean {
  const tz = safeTimeZone(timeZone);
  return day.coveredTo >= dayStartMs(addDays(day.date, 1), tz) - COVER_SLACK_MS;
}
