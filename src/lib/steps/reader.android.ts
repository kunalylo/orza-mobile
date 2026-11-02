/**
 * Android steps (`docs/notes/steps-v2.md` §2.1): the sources that are ON for the member, each read for the member's
 * days (profile zone) and handed on as is — `merge.ts` decides the day. The decisions are `androidSources.ts` (pure,
 * tested); this file does the native calls. Metro picks it on Android only.
 *
 * - S-A1 Health Connect (`health/bridge.android.ts`): with the member's store consent and `READ_STEPS` granted. Its
 *   aggregate per day, the part before ÖRZA's first grant on the grant's day (S-H2), a base's count since its instant.
 *   In the background without `READ_HEALTH_DATA_IN_BACKGROUND` it isn't read: the days are unread (M5f).
 * - S-A2 the Recording API (`modules/orza-steps`): with the member's phone consent, Physical activity and a step
 *   counter, while Play services is available and the subscription went through — subscribed again once per
 *   `prepare`. 15-min buckets for the days, 1-min buckets for a base's count since (S-R4).
 * - S-A3: while Health Connect counts this phone itself (Android 14+, extension 20) and is ON, the phone's own sources
 *   are off: the Recording API is unsubscribed and the sampler stopped.
 * - S-A4 the sampler (raw counter samples, `counter.ts`): only when the Recording API can't be used. Taking over from
 *   it starts from fresh samples (the old ones end where the sampler stopped).
 * - M9: nothing from before a shared phone's coverage floor (`ReadOptions.coverFloor`).
 * The member's consent comes in `ReadOptions.consent` (the sync's gate, `plan.stepsGate`): a kind without it is OFF.
 */
import { AppState, Linking, PermissionsAndroid, Platform } from 'react-native';

import * as native from '../../../modules/orza-steps';
import { safeTimeZone } from '../alarms/schedule';
import { healthBridge } from '../health/bridge';
import type { HealthAvailability } from '../health/types';

import {
  assembleDays,
  dayPlans,
  featuresOf,
  hcAnswers,
  hcAsks,
  hcRanges,
  hcReading,
  phonePlan,
  recordingReadings,
  recordingTotalsRange,
  recordingWindowFor,
  samplerReadings,
  sinceRange,
  storeAccessOf,
  withSince,
  type DayPlan,
  type PhoneMode,
} from './androidSources';
import type { StepSample } from './counter';
import { firstAsk, sourcesOn } from './plan';
import { recordingRange, recordingSince } from './recording';
import { hcGrantAt, noteHcGrant, permissionHistory, setPermissionHistory } from './store';
import type { ReadConsent, ReadOptions, SourceReading, StepPermission, StepsAccess, StepsReader } from './types';

const PERMISSION = PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION;
/** "Physical activity" became a run-time permission in Android 10 (API 29). */
const RUNTIME_PERMISSION = Number(Platform.Version) >= 29;
/** Samples read for the earliest requested day start this far back (the reading that opens its first interval). */
const LOOKBACK_MS = 36 * 3_600_000;

async function phoneAvailable(): Promise<boolean> {
  return native.isOrzaStepsAvailable() && (await native.isAvailable());
}

async function permission(): Promise<StepPermission> {
  if (!RUNTIME_PERMISSION) return 'granted';
  try {
    if (await PermissionsAndroid.check(PERMISSION)) {
      if (permissionHistory().blocked) setPermissionHistory({ blocked: false });
      return 'granted';
    }
  } catch {
    return 'undetermined';
  }
  const h = permissionHistory();
  return h.blocked ? 'blocked' : h.asked ? 'denied' : 'undetermined';
}

async function availability(): Promise<HealthAvailability> {
  try {
    return await healthBridge.availability();
  } catch {
    return 'unsupported';
  }
}

/** Everything the phone says about its step sources right now (never throws: each wrapper has its default). */
async function probe() {
  const [counter, status, subscribedAt, store, health] = await Promise.all([
    phoneAvailable(),
    native.recordingStatus(),
    native.recordingSubscribedAt(),
    availability(),
    native.healthFeatures(),
  ]);
  const phonePermission: StepPermission = counter ? await permission() : 'unavailable';
  // S-H2: the first time ÖRZA sees Health Connect's steps granted on this install (kept only the first time).
  if (health.stepsGranted) noteHcGrant();
  return { counter, phonePermission, status, subscribedAt, store, health, features: featuresOf(store, health.stepTracking, counter) };
}

/* ───────────────────────────── Which sources run ───────────────────────────── */

/** Bumped by `reset` (sign-out): a decision in flight stops before switching anything on again. */
let generation = 0;
/** What this JS session last set the sampler to (null: not yet — the native state is whatever it was). */
let applied: { sampler: boolean; tz: string } | null = null;
/** Subscribe to the Recording API again at the next decision (every `prepare`, and once per JS session). */
let resubscribe = true;
/** Decisions run one at a time (the background task and the app can overlap). */
let deciding: Promise<unknown> = Promise.resolve();

interface SourceState {
  /** Health Connect is ON (S-A1). */
  hcOn: boolean;
  /** HC counts this phone itself (M4 `includesPhone`). */
  stepTracking: boolean;
  /** `READ_HEALTH_DATA_IN_BACKGROUND` is granted. */
  hcBackground: boolean;
  /** Which phone counter is read: `recording`, `sampler`, `unread` (the Recording API is ON but can't answer) or `off`. */
  phone: Exclude<PhoneMode, 'subscribe'>;
  subscribedAt: number | null;
}

const NOTHING_ON: SourceState = { hcOn: false, stepTracking: false, hcBackground: false, phone: 'off', subscribedAt: null };

/** Decide the sources that are ON for `consent` (§2.1) and set the phone's counters to match. Never throws. */
function decideSources(timeZone: string, consent: ReadConsent): Promise<SourceState> {
  const run = deciding.then(() => decide(timeZone, consent)).catch(() => NOTHING_ON);
  deciding = run;
  return run;
}

async function decide(timeZone: string, consent: ReadConsent): Promise<SourceState> {
  const gen = generation;
  const p = await probe();
  if (gen !== generation) return NOTHING_ON;
  const inputs = { consent, storeGranted: p.health.stepsGranted, phoneGranted: p.phonePermission === 'granted' };
  // S-A1…S-A4 (with the Recording API assumed usable: whether it is comes next).
  const on = sourcesOn(p.features, { ...inputs, recordingReady: true });
  const plan = phonePlan(
    on.some((x) => x !== 'store'),
    p.status,
    p.subscribedAt,
    resubscribe
  );
  let subscribedAt = p.subscribedAt;
  if (plan.unsubscribe) {
    await native.recordingUnsubscribe(); // safe whatever Play services says; the time is always forgotten
    subscribedAt = null;
  }
  let phone: SourceState['phone'] = plan.mode === 'subscribe' ? 'recording' : plan.mode;
  if (plan.mode === 'subscribe') {
    if (gen !== generation) return NOTHING_ON;
    const r = await native.recordingSubscribe();
    subscribedAt = r.subscribedAt ?? (await native.recordingSubscribedAt());
    if (subscribedAt != null) resubscribe = false;
    // S-A4: the subscription didn't go through → the sampler.
    phone = subscribedAt != null ? 'recording' : 'sampler';
  }
  if (gen !== generation) return NOTHING_ON;
  await applySampler(phone === 'sampler', timeZone, gen);
  return {
    hcOn: on.includes('store'),
    stepTracking: p.health.stepTracking,
    hcBackground: p.health.backgroundGranted,
    phone: gen === generation ? phone : 'off',
    subscribedAt,
  };
}

/**
 * The sampler on (its midnight samples in `timeZone`) or off. Taking over from another source (it was stopped), it
 * starts from fresh samples: the old ones end where it stopped, and the stretch since would read as one long estimate.
 */
async function applySampler(on: boolean, timeZone: string, gen: number) {
  if (on) {
    if (applied?.sampler && applied.tz === timeZone) return;
    if (!applied?.sampler) {
      const status = await native.getStatus();
      if (gen !== generation) return;
      if (status && !status.enabled) await native.clear();
    }
    if (gen !== generation) return;
    applied = (await native.start(timeZone)) ? { sampler: true, tz: timeZone } : null;
  } else if (applied?.sampler !== false) {
    await native.stop();
    applied = { sampler: false, tz: timeZone };
  }
}

/* ───────────────────────────── Reading ───────────────────────────── */

type HcDays = Map<string, { reading: SourceReading | null; unread: boolean }>;

/** Health Connect's readings (S-A1, S-H1, S-H2, since): one batch of aggregates for every day. */
async function readHealthConnect(days: readonly DayPlan[], state: SourceState, opts: ReadOptions, now: number): Promise<HcDays> {
  const out: HcDays = new Map();
  if (!state.hcOn) return out;
  const grantAt = hcGrantAt();
  const asks = hcAsks(days, grantAt, opts.sinceAt);
  if (!asks.length) return out;
  // From the background Health Connect answers only with READ_HEALTH_DATA_IN_BACKGROUND: without it the days are unread.
  const readable = !opts.background || state.hcBackground || AppState.currentState === 'active';
  const totals = readable ? await healthBridge.stepsBetween(hcRanges(asks)).catch(() => null) : null;
  const answers = hcAnswers(asks, totals);
  const byDate = new Map(days.map((d) => [d.date, d]));
  asks.forEach((ask, i) => {
    const day = byDate.get(ask.date);
    if (day) out.set(ask.date, hcReading(day, ask, answers[i], { grantAt, stepTracking: state.stepTracking, now }));
  });
  return out;
}

interface PhoneDays {
  readings: Map<string, SourceReading>;
  unread: Set<string>;
}

/** The Recording API's readings (S-R1…S-R4); `unread` mode: none, and the days it covers are unread. */
async function readRecording(days: readonly DayPlan[], state: SourceState, opts: ReadOptions, now: number): Promise<PhoneDays> {
  const empty: PhoneDays = { readings: new Map(), unread: new Set() };
  if (state.subscribedAt == null) return empty;
  const tz = safeTimeZone(opts.timeZone);
  const window = recordingWindowFor(state.subscribedAt, now, opts.coverFloor);
  if (state.phone === 'unread') return recordingReadings(null, days, tz, window);
  const range = recordingTotalsRange(days, window);
  const buckets = range ? await native.recordingRead(range.startMs, range.lastMs, range.bucketMinutes) : [];
  const out = recordingReadings(buckets, days, tz, window);
  // S-R4: each base's count since its instant, in 1-min buckets — today and past days alike. A failed read leaves
  // none: the day is then a lower bound (`sinceUnknown`).
  for (const day of days) {
    const reading = out.readings.get(day.date);
    const ask = reading ? sinceRange(day, reading.coverFrom, opts.sinceAt?.[day.date]) : null;
    if (!reading || !ask) continue;
    if (!ask.range) {
      out.readings.set(day.date, withSince(reading, { at: ask.at, steps: 0 }));
      continue;
    }
    const r = recordingRange(ask.range.start, ask.range.end, 1);
    const minutes = r ? await native.recordingRead(r.startMs, r.lastMs, r.bucketMinutes) : [];
    if (minutes) out.readings.set(day.date, withSince(reading, { at: ask.at, steps: recordingSince(minutes, ask.at, ask.range.end) }));
  }
  return out;
}

/** The sampler's readings from its raw samples (plus a live reading when the app is in front). */
async function readSampler(days: readonly DayPlan[], opts: ReadOptions): Promise<PhoneDays> {
  const out: PhoneDays = { readings: new Map(), unread: new Set() };
  const read = days.filter((d) => d.read);
  if (!read.length) return out;
  const tz = safeTimeZone(opts.timeZone);
  const first = Math.min(...read.map((d) => d.start));
  // A live reading (the app is in front): counts up to this second. Stored natively only if the last stored one is
  // ≥ 10 min old, so it's added here when it wasn't.
  const live = opts.background ? null : await native.sampleNow();
  const samples: StepSample[] = await native.getSamples(first - LOOKBACK_MS);
  if (live && !samples.some((s) => s.ts === live.ts && s.counter === live.counter)) samples.push(live);
  out.readings = samplerReadings(samples, days, tz, opts.sinceAt);
  return out;
}

async function readPhone(days: readonly DayPlan[], state: SourceState, opts: ReadOptions, now: number): Promise<PhoneDays> {
  if (state.phone === 'recording' || state.phone === 'unread') return readRecording(days, state, opts, now);
  if (state.phone === 'sampler') return readSampler(days, opts);
  return { readings: new Map(), unread: new Set() };
}

/* ───────────────────────────── The reader ───────────────────────────── */

export const stepsReader: StepsReader = {
  platform: 'android',
  permissionName: 'Physical activity',
  settingsPath: 'Settings › Apps › ÖRZA › Permissions › Physical activity › Allow',

  async access(): Promise<StepsAccess> {
    try {
      const p = await probe();
      return {
        phoneAvailable: p.counter,
        phonePermission: p.phonePermission,
        firstAsk: firstAsk(p.features),
        store: storeAccessOf(p.store, p.health.stepsGranted),
        recording: p.status,
        recordingReady: p.status === 'available' && p.subscribedAt != null,
        features: p.features,
      };
    } catch {
      return { phoneAvailable: false, phonePermission: 'unavailable' };
    }
  },

  async requestPermission(kind = 'phone') {
    if (kind === 'hc') {
      if ((await availability()) !== 'available') return 'unavailable';
      const grant = await healthBridge.requestSteps();
      if (!grant.granted) return 'denied'; // a refusal, or Health Connect's lockout after two (it can't be told apart)
      noteHcGrant(Date.now(), true); // the member's own grant: noted even after a Disconnect in this process
      return 'granted';
    }
    if (kind !== 'phone' || !(await phoneAvailable())) return 'unavailable';
    if (!RUNTIME_PERMISSION) return 'granted';
    try {
      const result = await PermissionsAndroid.request(PERMISSION);
      if (result === PermissionsAndroid.RESULTS.GRANTED) {
        setPermissionHistory({ asked: true, blocked: false });
        return 'granted';
      }
      const blocked = result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN;
      setPermissionHistory({ asked: true, blocked });
      return blocked ? 'blocked' : 'denied';
    } catch {
      return permission();
    }
  },

  async prepare(timeZone, opts) {
    resubscribe = true;
    if (opts) await decideSources(safeTimeZone(timeZone), opts.consent);
  },

  async reset() {
    generation += 1;
    applied = null;
    resubscribe = true;
    // Sign-out: the next member can't read this one's walking (the Recording API's data goes with the subscription).
    await Promise.all([native.recordingUnsubscribe(), native.stop().then(() => native.clear())]);
  },

  async readDays(dates, opts) {
    try {
      const now = Date.now();
      const tz = safeTimeZone(opts.timeZone);
      const days = dayPlans(dates, tz, now, opts.coverFloor);
      const state = await decideSources(tz, opts.consent);
      const [hc, phone] = await Promise.all([
        readHealthConnect(days, state, opts, now).catch((): HcDays => new Map()),
        readPhone(days, state, opts, now).catch((): PhoneDays => ({ readings: new Map(), unread: new Set() })),
      ]);
      return assembleDays(days, { hc, phone: phone.readings, phoneUnread: phone.unread });
    } catch {
      return [];
    }
  },
};

/** "Open Settings" for a blocked permission: the app's own page. */
export function openStepsSettings(): Promise<void> {
  return Linking.openSettings();
}
