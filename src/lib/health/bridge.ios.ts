/**
 * Apple Health (HealthKit) reader — iPhone only. Metro picks this file on iOS, so the HealthKit native module is never
 * loaded on Android. The module itself is loaded lazily on first use: a build without it (Expo Go) reports
 * "unsupported" instead of crashing the app at start-up.
 *
 * HealthKit never tells an app whether *reading* was allowed (privacy): denied types simply return no samples. So
 * "connected" means the permission sheet was answered, and an empty first sync is reported to the user honestly.
 *
 * Steps v2 (`docs/notes/steps-v2.md`): ÖRZA reads only Steps, Sleep, Resting heart rate and Weight (P5) and writes
 * nothing (no share types: app.json's `NSHealthUpdateUsageDescription` is off, P10). The Health screen asks for the
 * four (`requestAccess`), Today's steps card for StepCount alone (`requestSteps`). The Health import (`readDays`) reads
 * the other three; automatic steps read `stepsBetween` (a statistics sum per instant range: iPhone + Apple Watch counted
 * once, like the Health app) and set up background delivery of new steps (`configureStepsBackground`, §4.3; the
 * app.json entitlement comes from the plugin's `background: true`).
 */
import type {
  QuantityTypeIdentifier,
  QueryStatisticsResponse,
  StatisticsOptions,
  UnitForIdentifier,
} from '@kingstinct/react-native-healthkit';
import { Linking } from 'react-native';

import { DayCollector, datesSince, localDate, rangeStart, sleepMinutesByWakeDate, type SleepInterval } from './aggregate';
import { HealthNotAuthorizedError, PHONE_METRICS, type HealthBridge, type HealthMetric, type StepsGrant } from './types';

type HealthKit = typeof import('@kingstinct/react-native-healthkit');

let loading: Promise<HealthKit> | null = null;
function healthKit(): Promise<HealthKit> {
  loading ??= import('@kingstinct/react-native-healthkit').catch((e: unknown) => {
    loading = null;
    throw e;
  });
  return loading;
}

const SLEEP = 'HKCategoryTypeIdentifierSleepAnalysis' as const;
const STEPS = 'HKQuantityTypeIdentifierStepCount' as const;

/**
 * What ÖRZA reads (P5). Active energy, distance, heart rate and water are no longer asked for or read: they were
 * uploaded and shown nowhere. A member who answered the old, longer sheet has answered these four too.
 */
const READ_TYPES = [STEPS, 'HKQuantityTypeIdentifierRestingHeartRate', 'HKQuantityTypeIdentifierBodyMass', SLEEP] as const;
/** The metrics READ_TYPES feed (HealthKit can't say which were allowed: all of them, `HealthAccessResult`). */
const METRICS: HealthMetric[] = [...PHONE_METRICS];

const NOTHING_GRANTED: StepsGrant = { granted: false, background: false };

/** Sleep that ended on the first day of the window started the evening before. */
const SLEEP_LOOKBACK_MS = 18 * 60 * 60 * 1000;

type Pick = (r: QueryStatisticsResponse) => number | undefined;

async function dailyStatistic<T extends QuantityTypeIdentifier>(
  hk: HealthKit,
  collector: DayCollector,
  metric: HealthMetric,
  identifier: T,
  option: StatisticsOptions,
  unit: UnitForIdentifier<T>,
  pick: Pick,
  start: Date,
  end: Date
) {
  const rows = await hk.queryStatisticsCollectionForQuantity(identifier, [option], start, { day: 1 }, {
    filter: { date: { startDate: start, endDate: end } },
    unit,
  });
  for (const r of rows) {
    if (!r.startDate) continue;
    collector.set(localDate(r.startDate), metric, pick(r));
  }
}

async function sleepIntervals(hk: HealthKit, start: Date, end: Date): Promise<SleepInterval[]> {
  const { CategoryValueSleepAnalysis: V } = hk;
  const asleep = new Set<number>([V.asleepUnspecified, V.asleepCore, V.asleepDeep, V.asleepREM]);
  const samples = await hk.queryCategorySamples(SLEEP, {
    limit: 0,
    ascending: true,
    filter: { date: { startDate: new Date(start.getTime() - SLEEP_LOOKBACK_MS), endDate: end } },
  });
  const out: SleepInterval[] = [];
  for (const s of samples) {
    if (!asleep.has(Number(s.value))) continue;
    out.push({
      source: s.sourceRevision?.source?.bundleIdentifier || 'unknown',
      start: new Date(s.startDate).getTime(),
      end: new Date(s.endDate).getTime(),
    });
  }
  return out;
}

/** The StepCount sheet was answered (HealthKit throws / crashes on queries for a type that was never asked). */
async function stepsAnswered(hk: HealthKit): Promise<boolean> {
  return (await stepsStatus(hk)) === true;
}

/** The StepCount sheet: answered (true), not asked yet (false), or no answer (null: HealthKit's `unknown` — an error). */
async function stepsStatus(hk: HealthKit): Promise<boolean | null> {
  const status = await hk.getRequestStatusForAuthorization({ toRead: [STEPS] });
  if (status === hk.AuthorizationRequestStatus.unnecessary) return true;
  return status === hk.AuthorizationRequestStatus.shouldRequest ? false : null;
}

export const healthBridge: HealthBridge = {
  platform: 'ios',
  name: 'Apple Health',
  source: 'apple_health',

  async availability() {
    try {
      const hk = await healthKit();
      return (await hk.isHealthDataAvailableAsync()) ? 'available' : 'unsupported';
    } catch {
      return 'unsupported'; // Expo Go / a build without the native module
    }
  },

  async hasAccess() {
    try {
      const hk = await healthKit();
      const status = await hk.getRequestStatusForAuthorization({ toRead: READ_TYPES });
      return status === hk.AuthorizationRequestStatus.unnecessary;
    } catch {
      return false;
    }
  },

  async requestAccess() {
    const hk = await healthKit();
    const shown = await hk.requestAuthorization({ toRead: READ_TYPES });
    return { granted: !!shown, metrics: shown ? [...METRICS] : [] };
  },

  async readDays(days) {
    const hk = await healthKit();
    // HealthKit crashes on queries for types that were never requested (e.g. a type added in an app update):
    // make sure the sheet has been answered for every type first.
    const status = await hk.getRequestStatusForAuthorization({ toRead: READ_TYPES });
    if (status === hk.AuthorizationRequestStatus.shouldRequest) throw new HealthNotAuthorizedError();

    const end = new Date();
    const start = rangeStart(days, end);
    const collector = new DayCollector(new Set(datesSince(start, end)));

    const avg: Pick = (r) => r.averageQuantity?.quantity;
    const latest: Pick = (r) => r.mostRecentQuantity?.quantity;

    // Never steps (steps v2 §0.5): the import doesn't carry them, and StepCount is read only for a member who agreed to
    // it (`lib/steps`, through `stepsBetween`).
    const jobs: Promise<unknown>[] = [
      dailyStatistic(hk, collector, 'resting_hr', 'HKQuantityTypeIdentifierRestingHeartRate', 'discreteAverage', 'count/min', avg, start, end),
      dailyStatistic(hk, collector, 'weight_kg', 'HKQuantityTypeIdentifierBodyMass', 'mostRecent', 'kg', latest, start, end),
      sleepIntervals(hk, start, end).then((intervals) => {
        for (const [date, minutes] of sleepMinutesByWakeDate(intervals)) collector.set(date, 'sleep_minutes', minutes);
      }),
    ];
    const results = await Promise.allSettled(jobs);
    const failed = results.filter((r) => r.status === 'rejected');
    // One unreadable type shouldn't sink the rest; only fail when nothing could be read at all.
    if (failed.length === results.length) throw (failed[0] as PromiseRejectedResult).reason;
    return collector.rows();
  },

  async stepsBetween(ranges) {
    const none = ranges.map(() => null);
    if (!ranges.length) return none;
    try {
      const hk = await healthKit();
      // Never query a type whose permission sheet wasn't answered (HealthKit throws / crashes on those).
      if (!(await stepsAnswered(hk))) return none;
      return await Promise.all(
        ranges.map(async (r) => {
          if (!(r.end > r.start)) return { steps: 0, origins: [] };
          try {
            // A statistics sum: iPhone + Apple Watch steps counted once, like the Health app. No data → an empty
            // response (0); a locked phone (the store is encrypted) → the query fails → null, never 0.
            const res = await hk.queryStatisticsForQuantity(STEPS, ['cumulativeSum'], {
              filter: { date: { startDate: new Date(r.start), endDate: new Date(r.end) } },
              unit: 'count',
            });
            const n = res.sumQuantity?.quantity;
            return { steps: typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.round(n) : 0, origins: [] };
          } catch {
            return null; // e.g. the Health store is locked (phone locked) during a background run
          }
        })
      );
    } catch {
      return none;
    }
  },

  /**
   * Today's steps card (§2.2 `healthkit`): the HealthKit sheet with Steps only (P5). `granted` = the sheet was
   * answered — HealthKit never says whether reading was allowed (a refusal reads as "no steps", §2.2's "Health empty").
   * Never throws.
   */
  async requestSteps() {
    try {
      const hk = await healthKit();
      return { granted: !!(await hk.requestAuthorization({ toRead: [STEPS] })), background: false };
    } catch {
      return NOTHING_GRANTED; // Expo Go / a build without the module, or HealthKit unavailable (iPad)
    }
  },

  async stepsGranted() {
    let hk: HealthKit;
    try {
      hk = await healthKit();
    } catch {
      return false; // no HealthKit module in this build
    }
    try {
      return await stepsStatus(hk);
    } catch {
      return null; // the check failed (e.g. a background wake-up with the phone locked): no answer, never "not granted"
    }
  },

  /**
   * §4.3: StepCount background delivery, hourly (iOS never delivers steps more often). kingstinct keeps the types in
   * UserDefaults and registers the observer query natively at every launch (no AppDelegate change), calling
   * HealthKit's completion handler itself; JS hears of a delivery through `subscribeToChanges` (R5b's observer).
   * Configuring again tears the observer down and drops that JS callback: call it only when the setting changes.
   * Off clears the stored types and stops the observer. Never throws.
   */
  async configureStepsBackground(on) {
    try {
      const hk = await healthKit();
      return on ? await hk.configureBackgroundTypes([STEPS], hk.UpdateFrequency.hourly) : await hk.clearBackgroundTypes();
    } catch {
      return false;
    }
  },

  async revokeAll() {
    return false; // HealthKit can't: the member removes ÖRZA in Settings › Health › Data Access & Devices
  },

  async openManage() {
    await Linking.openSettings();
  },

  async openStore() {
    // Apple Health ships with every iPhone.
  },
};
