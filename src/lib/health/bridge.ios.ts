/**
 * Apple Health (HealthKit) reader — iPhone only. Metro picks this file on iOS, so the HealthKit native module is never
 * loaded on Android. The module itself is loaded lazily on first use: a build without it (Expo Go) reports
 * "unsupported" instead of crashing the app at start-up.
 *
 * HealthKit never tells an app whether *reading* was allowed (privacy): denied types simply return no samples. So
 * "connected" means the permission sheet was answered, and an empty first sync is reported to the user honestly.
 */
import type {
  QuantityTypeIdentifier,
  QueryStatisticsResponse,
  StatisticsOptions,
  UnitForIdentifier,
} from '@kingstinct/react-native-healthkit';
import { Linking } from 'react-native';

import { DayCollector, datesSince, localDate, rangeStart, sleepMinutesByWakeDate, type SleepInterval } from './aggregate';
import { HEALTH_METRICS, HealthNotAuthorizedError, type HealthBridge, type HealthMetric } from './types';

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

const READ_TYPES = [
  'HKQuantityTypeIdentifierStepCount',
  'HKQuantityTypeIdentifierActiveEnergyBurned',
  'HKQuantityTypeIdentifierDistanceWalkingRunning',
  'HKQuantityTypeIdentifierRestingHeartRate',
  'HKQuantityTypeIdentifierHeartRate',
  'HKQuantityTypeIdentifierBodyMass',
  'HKQuantityTypeIdentifierDietaryWater',
  SLEEP,
] as const;

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
    return { granted: !!shown, metrics: shown ? [...HEALTH_METRICS] : [] };
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

    const sum: Pick = (r) => r.sumQuantity?.quantity;
    const avg: Pick = (r) => r.averageQuantity?.quantity;
    const latest: Pick = (r) => r.mostRecentQuantity?.quantity;

    const jobs: Promise<unknown>[] = [
      dailyStatistic(hk, collector, 'steps', 'HKQuantityTypeIdentifierStepCount', 'cumulativeSum', 'count', sum, start, end),
      dailyStatistic(hk, collector, 'active_kcal', 'HKQuantityTypeIdentifierActiveEnergyBurned', 'cumulativeSum', 'kcal', sum, start, end),
      dailyStatistic(hk, collector, 'distance_km', 'HKQuantityTypeIdentifierDistanceWalkingRunning', 'cumulativeSum', 'km', sum, start, end),
      dailyStatistic(hk, collector, 'resting_hr', 'HKQuantityTypeIdentifierRestingHeartRate', 'discreteAverage', 'count/min', avg, start, end),
      dailyStatistic(hk, collector, 'avg_hr', 'HKQuantityTypeIdentifierHeartRate', 'discreteAverage', 'count/min', avg, start, end),
      dailyStatistic(hk, collector, 'weight_kg', 'HKQuantityTypeIdentifierBodyMass', 'mostRecent', 'kg', latest, start, end),
      dailyStatistic(hk, collector, 'water_ml', 'HKQuantityTypeIdentifierDietaryWater', 'cumulativeSum', 'mL', sum, start, end),
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

  async openManage() {
    await Linking.openSettings();
  },

  async openStore() {
    // Apple Health ships with every iPhone.
  },
};
