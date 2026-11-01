/**
 * Android step sources — every decision of `reader.android.ts` (`docs/notes/steps-v2.md` §2.1), which only does the
 * native calls. Pure — no React Native imports — so `npm run test:steps` runs it in Node.
 *
 * - S-A1 Health Connect: its aggregate per instant range of the profile-zone day (S-H1: 0 = nothing synced), covered
 *   from the first grant on the grant's day when it had nothing before (S-H2); it holds this phone's steps (M4) when
 *   it counts the phone itself (`stepTracking`) or a phone step recorder wrote the day (`HC_PHONE_ORIGINS`).
 * - S-A2 / S-A4 the phone's own counter: the Recording API when subscribed, else the sampler (`phonePlan`); S-A3 (HC
 *   counts the phone itself) turns both off — the caller decides that with `plan.sourcesOn`.
 * - S-R3 / S-R4: the Recording API's 10-day window from the subscription; a base's count since its instant on every
 *   day that has one, past days too (1-min buckets; the sampler and HC measure the same range).
 * - M5f: a source that is ON but wasn't read this run (HC skipped in the background or failed, the Recording API
 *   failing or briefly unavailable) marks the day `storeUnread` — a lower bound that may raise, never lower or settle.
 * - M9: a shared phone reads nothing from before the member's consent (`dayPlans`' coverage floor).
 */
import type { HealthAvailability, StepRange, StepsTotal } from '../health/types';

import { coversWholeDay, dailyStepCounts, dayComplete, stepsInRange, type StepSample } from './counter';
import { hcCoverFrom } from './merge';
import { recordingDays, recordingRange, recordingWindow, type RecordingBucket, type RecordingRange } from './recording';
import { sinceRange, withSince, type DayPlan } from './shared';
import type { DayReading, RecordingStatus, SinceCount, SourceReading, StepFeatures, StoreAccess } from './types';

/** The member days to read and a base's count since (moved to `shared.ts` for the iPhone reader too). */
export { dayPlans, sinceRange, withSince, type DayPlan } from './shared';

/**
 * Health Connect data origins that record this phone's own steps all day: Health Connect's on-device count
 * (`android`, Android 14+), Samsung Health, Google Fit. With one of them in a day's total, the store holds the phone's
 * steps (M4) — elsewhere it may hold only a watch worn part of the day or a running app's workouts.
 */
export const HC_PHONE_ORIGINS: ReadonlySet<string> = new Set(['android', 'com.sec.android.app.shealth', 'com.google.android.apps.fitness']);

/* ───────────────────────────── What this phone has (§2.2) ───────────────────────────── */

/** The phone's features from Health Connect's SDK status (the bridge), its step tracking and the step counter. */
export function featuresOf(availability: HealthAvailability, stepTracking: boolean, counter: boolean): StepFeatures {
  const store = availability === 'available' ? 'available' : availability === 'unsupported' ? 'unavailable' : 'installable';
  return { platform: 'android', store, stepTracking, counter };
}

/** Health Connect's steps access: `needs_install` when it can be installed or updated from Play. */
export function storeAccessOf(availability: HealthAvailability, stepsGranted: boolean): StoreAccess {
  if (availability === 'available') return stepsGranted ? 'granted' : 'not_granted';
  return availability === 'unsupported' ? 'unavailable' : 'needs_install';
}

/* ───────────────────────────── The phone's counter (S-A2, S-A4) ───────────────────────────── */

/**
 * - `off`: no phone source (no consent, S-A3, no permission or counter);
 * - `subscribe`: the Recording API, after a (re)subscribe — the sampler if it doesn't go through;
 * - `recording`: the Recording API, subscribed;
 * - `sampler`: the sampler (Play services missing / disabled / too old, never subscribed);
 * - `unread`: the Recording API is subscribed but Play services can't answer right now (updating, an error) — no
 *   phone reading this run, and the days it covers are unread (M5f). Not the sampler: it stopped when the Recording
 *   API took over, so its samples would turn the whole stretch since into one long estimate.
 */
export type PhoneMode = 'off' | 'subscribe' | 'recording' | 'sampler' | 'unread';

/**
 * Which phone counter runs: `phoneOn` (a phone source is ON per `plan.sourcesOn`), the Recording API's `status`, its
 * subscription (`subscribedAt`, null: none) and `resubscribe` (subscribe again even when subscribed: once per prepare).
 * `unsubscribe`: remove the subscription first — phone sources off (S-A3, the member's consent; minimisation), or Play
 * services gone for good.
 */
export function phonePlan(
  phoneOn: boolean,
  status: RecordingStatus,
  subscribedAt: number | null,
  resubscribe: boolean
): { mode: PhoneMode; unsubscribe: boolean } {
  const subscribed = subscribedAt != null;
  if (!phoneOn || status === 'no_sensor') return { mode: 'off', unsubscribe: subscribed };
  if (status === 'available') return { mode: subscribed && !resubscribe ? 'recording' : 'subscribe', unsubscribe: false };
  if (status === 'missing' || status === 'disabled') return { mode: 'sampler', unsubscribe: subscribed };
  return { mode: subscribed ? 'unread' : 'sampler', unsubscribe: false };
}

/* ───────────────────────────── Health Connect (S-A1, S-H1, S-H2) ───────────────────────────── */

/** What Health Connect is asked for one day. */
export interface HcAsk {
  date: string;
  /** The day's total over its read range. */
  total: StepRange;
  /** S-H2: [from, grantAt) on the day of the first grant; null on every other day. */
  preGrant: StepRange | null;
  /** M5 / S-R4: the count since the day's base (`sinceRange` from the read range's start). */
  since: { at: number; range: StepRange | null } | null;
}

/** Health Connect's answers for one `HcAsk` (null: not asked, or the query failed). */
export interface HcAnswer {
  total: StepsTotal | null;
  preGrant?: StepsTotal | null;
  since?: StepsTotal | null;
}

/** The asks for every day that may be read (`grantAt`: S-H2's first grant on this install; `sinceAt`: the bases). */
export function hcAsks(days: readonly DayPlan[], grantAt: number | null | undefined, sinceAt?: Readonly<Record<string, number>>): HcAsk[] {
  const out: HcAsk[] = [];
  for (const day of days) {
    if (!day.read) continue;
    const { from, to } = day.read;
    const grant = grantAt != null && Number.isFinite(grantAt) && grantAt > from && grantAt < day.end ? grantAt : null;
    out.push({
      date: day.date,
      total: { start: from, end: to },
      preGrant: grant != null ? { start: from, end: Math.min(grant, to) } : null,
      since: sinceRange(day, from, sinceAt?.[day.date]),
    });
  }
  return out;
}

/** Every range of `asks` for one `stepsBetween` call: per ask its total, then its pre-grant part and its since, if asked. */
export function hcRanges(asks: readonly HcAsk[]): StepRange[] {
  return asks.flatMap((a) => [a.total, ...(a.preGrant ? [a.preGrant] : []), ...(a.since?.range ? [a.since.range] : [])]);
}

/** `stepsBetween`'s answer to `hcRanges(asks)` back per ask; null `totals` (the read was skipped) → every answer null. */
export function hcAnswers(asks: readonly HcAsk[], totals: readonly (StepsTotal | null)[] | null): (HcAnswer | null)[] {
  if (!totals) return asks.map(() => null);
  let i = 0;
  const next = () => totals[i++] ?? null;
  return asks.map((a) => {
    const total = next();
    const preGrant = a.preGrant ? next() : null;
    const since = a.since?.range ? next() : null;
    return { total, preGrant, since };
  });
}

/**
 * Health Connect's reading of `day` from its `answer` (null: skipped). `unread`: HC is ON but its total couldn't be
 * read (M5f) — not "no data". A 0 is no reading (S-H1). Coverage per S-H2 (an unknown pre-grant part counts as
 * nothing: coverage from the grant, claiming less); `includesPhone` per M4; `since` measured for the base's very
 * instant (a failed query: none — the day is then a lower bound, `merge.dayValue`'s `sinceUnknown`).
 */
export function hcReading(
  day: DayPlan,
  ask: HcAsk,
  answer: HcAnswer | null,
  opts: { grantAt: number | null | undefined; stepTracking: boolean; now: number }
): { reading: SourceReading | null; unread: boolean } {
  const total = answer?.total;
  if (!total || !Number.isFinite(total.steps)) return { reading: null, unread: true };
  const steps = Math.round(total.steps);
  if (steps <= 0) return { reading: null, unread: false };
  const coverFrom = hcCoverFrom({ start: ask.total.start, end: day.end }, ask.preGrant ? opts.grantAt : null, answer?.preGrant?.steps ?? 0);
  const origins = total.origins.filter((o) => typeof o === 'string' && !!o);
  const includesPhone = opts.stepTracking || origins.some((o) => HC_PHONE_ORIGINS.has(o));
  let since: SinceCount | undefined;
  if (ask.since) {
    const s = ask.since.range ? answer?.since : { steps: 0 };
    if (s && Number.isFinite(s.steps)) since = { at: ask.since.at, steps: Math.max(0, Math.round(s.steps)) };
  }
  return {
    reading: {
      source: 'health_connect',
      steps,
      coverFrom,
      complete: opts.now >= day.end,
      ...(includesPhone ? { includesPhone: true } : {}),
      ...(origins.length ? { origins } : {}),
      ...(since ? { since } : {}),
    },
    unread: false,
  };
}

/* ───────────────────────────── The sampler (S-A4) ───────────────────────────── */

/**
 * The sampler's reading of each day from its raw samples (`counter.ts`): the day's count as `dailyStepCounts` gives
 * it, or — on a shared phone's consent day — only what was counted from the floor on (`stepsInRange`, covered from
 * it). A day the samples don't reach (or whose samples end before the floor) has none. `since`: the same count from a
 * base's instant on.
 */
export function samplerReadings(
  samples: readonly StepSample[],
  days: readonly DayPlan[],
  timeZone: string,
  sinceAt?: Readonly<Record<string, number>>
): Map<string, SourceReading> {
  const out = new Map<string, SourceReading>();
  if (!samples.length) return out;
  const counts = dailyStepCounts(samples, timeZone);
  for (const day of days) {
    const d = counts.get(day.date);
    if (!day.read || !d) continue;
    const whole = coversWholeDay(d, timeZone) ? day.start : d.coveredFrom;
    let steps = d.steps;
    let coverFrom = whole;
    if (day.read.from > day.start) {
      if (d.coveredTo <= day.read.from) continue;
      steps = stepsInRange(samples, timeZone, day.read.from, day.end);
      coverFrom = Math.max(whole, day.read.from);
    }
    const estimated = Math.min(steps, d.estimatedSteps);
    const reading: SourceReading = {
      source: 'phone',
      counter: 'sampler',
      steps,
      coverFrom,
      ...(estimated > 0 ? { estimated } : {}),
      // A past day is final once a reading after its midnight exists (a background run may not have one yet) and no
      // reboot without a shutdown reading may have lost steps (C10).
      complete: dayComplete(d, timeZone),
    };
    const ask = sinceRange(day, coverFrom, sinceAt?.[day.date]);
    out.set(day.date, ask ? withSince(reading, { at: ask.at, steps: ask.range ? stepsInRange(samples, timeZone, ask.at, day.end) : 0 }) : reading);
  }
  return out;
}

/* ───────────────────────────── The Recording API (S-A2, S-R1…S-R4) ───────────────────────────── */

/** S-R3's window W from the subscription (and now − 10 days), raised to a shared phone's coverage floor (M9). */
export function recordingWindowFor(subscribedAt: number, now: number, coverFloor?: number | null): { start: number; end: number } {
  const w = recordingWindow(subscribedAt, now);
  return coverFloor != null && Number.isFinite(coverFloor) && coverFloor > w.start ? { start: coverFloor, end: w.end } : w;
}

/** The one 15-min read for the days' totals: from the earliest day read (not before the window) to now. Null: none. */
export function recordingTotalsRange(days: readonly DayPlan[], window: { start: number; end: number }): RecordingRange | null {
  const froms = days.filter((d) => d.read && d.end > window.start).map((d) => Math.max(d.read?.from ?? d.start, window.start));
  if (!froms.length) return null;
  return recordingRange(Math.min(...froms), window.end);
}

/**
 * The Recording API's reading of each day from the totals read's `buckets` (`recording.recordingDays`). A failed read
 * (null) gives none, and every day the window reaches is `unread` (M5f) — days before it have no data either way.
 */
export function recordingReadings(
  buckets: readonly RecordingBucket[] | null,
  days: readonly DayPlan[],
  timeZone: string,
  window: { start: number; end: number }
): { readings: Map<string, SourceReading>; unread: Set<string> } {
  const dates = days.filter((d) => d.read).map((d) => d.date);
  const byDay = recordingDays(buckets ?? [], dates, timeZone, window);
  const readings = new Map<string, SourceReading>();
  const unread = new Set<string>();
  for (const [date, reading] of byDay) {
    if (!reading) continue;
    if (buckets) readings.set(date, reading);
    else unread.add(date);
  }
  return { readings, unread };
}

/* ───────────────────────────── The day ───────────────────────────── */

/**
 * The day readings, in `days`' order: each source's reading (Health Connect first), `storeUnread` when Health
 * Connect or the phone's Recording API is ON but wasn't read for the day (M5f). A day that may not be read (M9) has
 * no sources and is never unread.
 */
export function assembleDays(
  days: readonly DayPlan[],
  parts: {
    hc?: ReadonlyMap<string, { reading: SourceReading | null; unread: boolean }>;
    phone?: ReadonlyMap<string, SourceReading>;
    phoneUnread?: ReadonlySet<string>;
  }
): DayReading[] {
  return days.map((day) => {
    const { date, start, end } = day;
    if (!day.read) return { date, start, end, sources: [] };
    const hc = parts.hc?.get(date);
    const phone = parts.phone?.get(date);
    const sources = [...(hc?.reading ? [hc.reading] : []), ...(phone ? [phone] : [])];
    const unread = !!hc?.unread || !!parts.phoneUnread?.has(date);
    return { date, start, end, sources, ...(unread ? { storeUnread: true } : {}) };
  });
}
