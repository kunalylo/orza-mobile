/**
 * iPhone steps (`docs/notes/steps-v2.md` §2.1): the sources that are ON for the member, each read for the member's days
 * (profile zone) and handed on as is — `merge.ts` decides the day. The decisions are `iosSources.ts` (pure, tested);
 * this file does the native calls. Metro picks it on iOS only.
 *
 * - S-I1 Apple Health (`health/bridge.ios.ts`, the primary source): with the member's store consent once the StepCount
 *   sheet was answered — a statistics sum per day (iPhone + Apple Watch counted once, like the Health app) and a base's
 *   count since its instant. A failed read (the phone locked: the store is encrypted) leaves the days unread (M5f).
 * - S-I2 CMPedometer (expo-sensors, the motion coprocessor): only with the member's phone consent — the one-time
 *   fallback offer when Apple Health has no steps, or an iPhone without HealthKit — and Motion & Fitness. 7 days.
 * - §4.3: while Apple Health is ON, it wakes ÖRZA when new steps arrive (hourly at most, also after the app was
 *   closed): set up when the store comes ON, cleared when it goes off and at sign-out (`reset`). The prefs keep what is
 *   set up (`hkBackground`; R5b's observer subscribes by it).
 * - M9: nothing from before a shared iPhone's coverage floor (`ReadOptions.coverFloor`).
 * The member's consent comes in `ReadOptions.consent` (the sync's gate, `plan.stepsGate`): a kind without it is OFF.
 */
import { PermissionStatus } from 'expo';
import { Pedometer } from 'expo-sensors';
import { Linking } from 'react-native';

import { safeTimeZone } from '../alarms/schedule';
import { healthBridge } from '../health/bridge';
import type { StepRange } from '../health/types';

import {
  askAnswers,
  askRanges,
  backgroundChange,
  healthAsks,
  healthReading,
  iosDays,
  iosFeatures,
  iosStoreAccess,
  pedometerAsks,
  pedometerReading,
  readingsByDate,
  storeAnswer,
  type DayRead,
} from './iosSources';
import { firstAsk, sourcesOn } from './plan';
import { dayPlans, type DayPlan } from './shared';
import { hkBackground, setHkBackground } from './store';
import type { ReadConsent, ReadOptions, StepPermission, StepsAccess, StepsReader } from './types';

async function phoneAvailable(): Promise<boolean> {
  try {
    return await Pedometer.isAvailableAsync();
  } catch {
    return false; // a build without the native module
  }
}

async function permission(): Promise<StepPermission> {
  try {
    const p = await Pedometer.getPermissionsAsync();
    if (p.granted || p.status === PermissionStatus.GRANTED) return 'granted';
    if (p.status === PermissionStatus.UNDETERMINED) return 'undetermined';
    return p.canAskAgain ? 'denied' : 'blocked';
  } catch {
    return 'undetermined';
  }
}

async function healthAvailable(): Promise<boolean> {
  try {
    return (await healthBridge.availability()) === 'available';
  } catch {
    return false;
  }
}

/** The StepCount sheet was seen answered in this JS session (a failed status check keeps that answer, `storeAnswer`). */
let seenAnswered = false;

/** Everything the iPhone says about its step sources right now (never throws: each call has its default). */
async function probe() {
  const [store, status, counter] = await Promise.all([healthAvailable(), healthBridge.stepsGranted(), phoneAvailable()]);
  const phonePermission: StepPermission = counter ? await permission() : 'unavailable';
  if (status != null) seenAnswered = status;
  // A failed check (a locked phone in a background wake-up): the earlier answer — this session's, or background
  // delivery set up (only ever while the store was ON) — never "not answered" (R/U review).
  const answer = storeAnswer(status, seenAnswered || hkBackground());
  return {
    store,
    answered: store && answer.answered,
    unknown: store && answer.unknown,
    counter,
    phonePermission,
    features: iosFeatures(store, counter),
  };
}

/* ───────────────────────────── Which sources run ───────────────────────────── */

/** Bumped by `reset` (sign-out): a decision in flight stops before setting anything up again. */
let generation = 0;
/** Decisions (and sign-out's clearing) run one at a time: HealthKit's background setup must never race itself. */
let deciding: Promise<unknown> = Promise.resolve();

interface SourceState {
  /** Apple Health is ON (S-I1). */
  store: boolean;
  /** CMPedometer is ON (S-I2). */
  pedometer: boolean;
}

const NOTHING_ON: SourceState = { store: false, pedometer: false };

/** Decide the sources that are ON for `consent` (§2.1) and set Apple Health's background delivery to match. Never throws. */
function decideSources(consent: ReadConsent): Promise<SourceState> {
  const run = deciding.then(() => decide(consent)).catch(() => NOTHING_ON);
  deciding = run;
  return run;
}

async function decide(consent: ReadConsent): Promise<SourceState> {
  const gen = generation;
  const p = await probe();
  if (gen !== generation) return NOTHING_ON;
  // A failed status check with the member's store consent: the store stays ON (its reads fail too: the days are
  // unread, M5f) and background delivery stays as it is — never cleared by a locked-phone wake-up (R/U review).
  const keep = p.unknown && consent.store;
  const on = sourcesOn(p.features, { consent, storeGranted: p.answered || keep, phoneGranted: p.phonePermission === 'granted' });
  const state = { store: on.includes('store'), pedometer: on.includes('pedometer') };
  await applyBackground(state.store, gen, keep);
  return gen === generation ? state : NOTHING_ON;
}

/**
 * §4.3: Apple Health's background delivery on while the store is ON — HealthKit is called only when that changes, and
 * never while the StepCount check failed for a member who agrees to the store (`keep`).
 */
async function applyBackground(storeOn: boolean, gen: number, keep = false) {
  const change = backgroundChange(storeOn, hkBackground(), keep);
  if (!change || gen !== generation) return;
  // Kept only when HealthKit took it: a failed clear is tried again on the next decision.
  if (await healthBridge.configureStepsBackground(change === 'configure')) setHkBackground(change === 'configure');
}

/* ───────────────────────────── Reading ───────────────────────────── */

async function pedometerSteps(range: StepRange): Promise<number | null> {
  try {
    const r = await Pedometer.getStepCountAsync(new Date(range.start), new Date(range.end));
    return typeof r?.steps === 'number' && Number.isFinite(r.steps) ? r.steps : null;
  } catch {
    return null;
  }
}

/** Apple Health's readings (S-I1, since): one batch of statistics sums for every day. */
async function readHealth(days: readonly DayPlan[], opts: ReadOptions, now: number): Promise<Map<string, DayRead>> {
  const asks = healthAsks(days, opts.sinceAt);
  if (!asks.length) return new Map();
  const totals = await healthBridge.stepsBetween(askRanges(asks)).catch(() => null);
  const answers = askAnswers(asks, totals ? totals.map((t) => t?.steps ?? null) : null);
  return readingsByDate(days, asks, answers, healthReading, now);
}

/** CMPedometer's readings (S-I2, since): the days it still holds. */
async function readPedometer(days: readonly DayPlan[], opts: ReadOptions, now: number): Promise<Map<string, DayRead>> {
  const asks = pedometerAsks(days, now, opts.sinceAt);
  if (!asks.length) return new Map();
  const counts = await Promise.all(askRanges(asks).map(pedometerSteps));
  return readingsByDate(days, asks, askAnswers(asks, counts), pedometerReading, now);
}

/* ───────────────────────────── The reader ───────────────────────────── */

export const stepsReader: StepsReader = {
  platform: 'ios',
  permissionName: 'Motion & Fitness',
  settingsPath: 'Settings › ÖRZA › Motion & Fitness',

  async access(): Promise<StepsAccess> {
    try {
      const p = await probe();
      return {
        phoneAvailable: p.counter,
        phonePermission: p.phonePermission,
        firstAsk: firstAsk(p.features),
        store: iosStoreAccess(p.store, p.answered),
        ...(p.unknown ? { storeUnknown: true } : {}),
        features: p.features,
      };
    } catch {
      return { phoneAvailable: false, phonePermission: 'unavailable' };
    }
  },

  /**
   * `healthkit`: Apple Health's sheet with Steps only. `granted` = the sheet was answered — HealthKit never says whether
   * reading was allowed (a refusal shows up as "Health has no steps", §2.2). A sheet that couldn't open: `undetermined`
   * (nothing was asked). `phone`: Motion & Fitness. Android's `hc`: `unavailable`.
   */
  async requestPermission(kind = 'phone') {
    if (kind === 'healthkit') {
      if (!(await healthAvailable())) return 'unavailable';
      return (await healthBridge.requestSteps()).granted ? 'granted' : 'undetermined';
    }
    if (kind !== 'phone' || !(await phoneAvailable())) return 'unavailable';
    try {
      await Pedometer.requestPermissionsAsync();
    } catch {
      // fall through to the current state
    }
    return permission();
  },

  async prepare(_timeZone, opts) {
    // The motion coprocessor and Apple Health count on their own; with the member's consent, Apple Health's background
    // delivery is set up (or cleared) to match.
    if (opts) await decideSources(opts.consent);
  },

  async reset() {
    // Sign-out: Apple Health no longer wakes ÖRZA for this member's steps — after any decision in flight, so it can't
    // set it up again afterwards. Cleared whatever the prefs say (they may be behind HealthKit's own record).
    generation += 1;
    const run = deciding.then(async () => {
      if (await healthBridge.configureStepsBackground(false)) setHkBackground(false);
    });
    deciding = run.catch(() => undefined);
    await deciding;
  },

  async readDays(dates, opts) {
    try {
      const now = Date.now();
      const days = dayPlans(dates, safeTimeZone(opts.timeZone), now, opts.coverFloor);
      const state = await decideSources(opts.consent);
      // A read that throws all the same (each call has its own fallback) leaves every day it would read unread.
      const [health, phone] = await Promise.all([
        state.store ? readHealth(days, opts, now).catch(() => readingsByDate(days, healthAsks(days), [], healthReading, now)) : null,
        state.pedometer ? readPedometer(days, opts, now).catch(() => readingsByDate(days, pedometerAsks(days, now), [], pedometerReading, now)) : null,
      ]);
      return iosDays(days, { health: health ?? undefined, phone: phone ?? undefined });
    } catch {
      return [];
    }
  },
};

export function openStepsSettings(): Promise<void> {
  return Linking.openSettings();
}
