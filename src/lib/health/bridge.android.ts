/**
 * Health Connect reader — Android only. Metro picks this file on Android, so the Health Connect module is never loaded
 * on iPhone. Permissions are declared in app.json (`android.permission.health.READ_*`); the library's config plugin adds
 * the permissions-rationale intent filter + activity alias Health Connect requires.
 */
import { Linking, Platform } from 'react-native';
import type {
  AggregateResult,
  AggregateResultRecordType,
  Permission,
  ReadRecordsOptions,
  RecordResult,
  RecordType,
} from 'react-native-health-connect';

import { DayCollector, datesSince, localDate, rangeStart, sleepMinutesByWakeDate, type SleepInterval } from './aggregate';
import { HealthNotAuthorizedError, type HealthBridge, type HealthMetric } from './types';

const PROVIDER = 'com.google.android.apps.healthdata';
const STORE_URL = `market://details?id=${PROVIDER}&url=healthconnect%3A%2F%2Fonboarding`;
const STORE_WEB_URL = `https://play.google.com/store/apps/details?id=${PROVIDER}`;

/** Health Connect record type → the ÖRZA metric it feeds. */
const RECORDS = {
  Steps: 'steps',
  ActiveCaloriesBurned: 'active_kcal',
  Distance: 'distance_km',
  SleepSession: 'sleep_minutes',
  RestingHeartRate: 'resting_hr',
  HeartRate: 'avg_hr',
  Weight: 'weight_kg',
  Hydration: 'water_ml',
} as const satisfies Partial<Record<RecordType, HealthMetric>>;

type ReadType = keyof typeof RECORDS;
const READ_TYPES = Object.keys(RECORDS) as ReadType[];
const PERMISSIONS: Permission[] = READ_TYPES.map((recordType) => ({ accessType: 'read', recordType }));

const SLEEP_LOOKBACK_MS = 18 * 60 * 60 * 1000;
/**
 * Stage values that are not sleep: AWAKE (1), OUT_OF_BED (3) and AWAKE_IN_BED (7). The library passes the platform's
 * raw stage int through, and its JS `SleepStageType` stops at REM (6) — but Health Connect (androidx connect-client
 * 1.1, Android 14+) also has `STAGE_TYPE_AWAKE_IN_BED = 7`, which the website likewise doesn't count as asleep.
 */
const AWAKE_STAGES = new Set([1, 3, 7]);

type TimeRange = ReadRecordsOptions['timeRangeFilter'];
type HealthConnect = typeof import('react-native-health-connect');

/**
 * The module is loaded lazily: its TurboModule lookup throws when the native side is missing (Expo Go), which must
 * surface as "unsupported", not crash the app at start-up.
 */
let loading: Promise<HealthConnect> | null = null;
function healthConnect(): Promise<HealthConnect> {
  loading ??= import('react-native-health-connect').catch((e: unknown) => {
    loading = null;
    throw e;
  });
  return loading;
}

let ready: Promise<boolean> | null = null;

/** `initialize()` must run once before anything but `getSdkStatus`. */
async function client(): Promise<HealthConnect> {
  const hc = await healthConnect();
  ready ??= hc.initialize(PROVIDER).catch((e: unknown) => {
    ready = null;
    throw e;
  });
  const ok = await ready;
  if (!ok) {
    ready = null;
    throw new Error('Health Connect could not start on this phone.');
  }
  return hc;
}

async function readableTypes(hc: HealthConnect): Promise<Set<ReadType>> {
  const granted = await hc.getGrantedPermissions();
  const out = new Set<ReadType>();
  for (const p of granted) {
    if (p.accessType === 'read' && p.recordType in RECORDS) out.add(p.recordType as ReadType);
  }
  return out;
}

async function readAll<T extends RecordType>(hc: HealthConnect, recordType: T, timeRangeFilter: TimeRange): Promise<RecordResult<T>[]> {
  const out: RecordResult<T>[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 20; page++) {
    const res = await hc.readRecords(recordType, { timeRangeFilter, ascendingOrder: true, pageSize: 1000, pageToken });
    out.push(...res.records);
    pageToken = res.pageToken || undefined;
    if (!pageToken) break;
  }
  return out;
}

async function daily<T extends AggregateResultRecordType>(
  hc: HealthConnect,
  collector: DayCollector,
  recordType: T,
  metric: HealthMetric,
  timeRangeFilter: TimeRange,
  pick: (r: AggregateResult<T>) => number | undefined
) {
  const groups = await hc.aggregateGroupByPeriod({ recordType, timeRangeFilter, timeRangeSlicer: { period: 'DAYS', length: 1 } });
  // Period groups use local date-times ("2026-10-01T00:00"), so the first 10 characters are the local day.
  for (const g of groups) collector.set(String(g.startTime).slice(0, 10), metric, pick(g.result));
}

/** A session minus its awake / out-of-bed stages, as asleep intervals. */
function asleepPieces(start: number, end: number, stages: { startTime: string; endTime: string; stage: number }[] | undefined, source: string) {
  const awake = (stages ?? [])
    .filter((s) => AWAKE_STAGES.has(s.stage))
    .map((s) => [Math.max(start, Date.parse(s.startTime)), Math.min(end, Date.parse(s.endTime))] as const)
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s)
    .sort((a, b) => a[0] - b[0]);
  const out: SleepInterval[] = [];
  let cursor = start;
  for (const [s, e] of awake) {
    if (s > cursor) out.push({ source, start: cursor, end: s });
    cursor = Math.max(cursor, e);
  }
  if (end > cursor) out.push({ source, start: cursor, end });
  return out;
}

export const healthBridge: HealthBridge = {
  platform: 'android',
  name: 'Health Connect',
  source: 'health_connect',

  async availability() {
    try {
      const hc = await healthConnect();
      const status = await hc.getSdkStatus(PROVIDER);
      if (status === hc.SdkAvailabilityStatus.SDK_AVAILABLE) return 'available';
      if (status === hc.SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) {
        // Android 14+ has Health Connect built in (it only needs updating); 9–13 install it from Google Play.
        const api = typeof Platform.Version === 'number' ? Platform.Version : Number(Platform.Version);
        return api >= 34 ? 'needs_update' : 'needs_install';
      }
      return 'unsupported';
    } catch {
      return 'unsupported'; // Expo Go / a build without the native module
    }
  },

  async hasAccess() {
    try {
      const hc = await client();
      return (await readableTypes(hc)).size > 0;
    } catch {
      return false;
    }
  },

  async requestAccess() {
    const hc = await client();
    const granted = await hc.requestPermission(PERMISSIONS);
    const metrics = new Set<HealthMetric>();
    for (const p of granted) {
      if (p.accessType === 'read' && p.recordType in RECORDS) metrics.add(RECORDS[p.recordType as ReadType]);
    }
    return { granted: metrics.size > 0, metrics: [...metrics] };
  },

  async readDays(days) {
    const hc = await client();
    const allowed = await readableTypes(hc);
    if (!allowed.size) throw new HealthNotAuthorizedError();

    const end = new Date();
    const start = rangeStart(days, end);
    const collector = new DayCollector(new Set(datesSince(start, end)));
    const range: TimeRange = { operator: 'between', startTime: start.toISOString(), endTime: end.toISOString() };
    const can = (t: ReadType) => allowed.has(t);

    const jobs: Promise<unknown>[] = [];
    if (can('Steps')) jobs.push(daily(hc, collector, 'Steps', 'steps', range, (r) => r.COUNT_TOTAL));
    if (can('ActiveCaloriesBurned'))
      jobs.push(daily(hc, collector, 'ActiveCaloriesBurned', 'active_kcal', range, (r) => r.ACTIVE_CALORIES_TOTAL?.inKilocalories));
    if (can('Distance')) jobs.push(daily(hc, collector, 'Distance', 'distance_km', range, (r) => r.DISTANCE?.inKilometers));
    if (can('RestingHeartRate')) jobs.push(daily(hc, collector, 'RestingHeartRate', 'resting_hr', range, (r) => r.BPM_AVG));
    if (can('HeartRate')) jobs.push(daily(hc, collector, 'HeartRate', 'avg_hr', range, (r) => r.BPM_AVG));
    if (can('Hydration')) jobs.push(daily(hc, collector, 'Hydration', 'water_ml', range, (r) => r.VOLUME_TOTAL?.inMilliliters));
    if (can('Weight')) {
      jobs.push(
        readAll(hc, 'Weight', range).then((records) => {
          // Latest weigh-in of each local day (records come oldest first).
          const latest = new Map<string, number>();
          for (const r of records) {
            const at = Date.parse(r.time);
            if (Number.isFinite(at)) latest.set(localDate(at), r.weight.inKilograms);
          }
          for (const [date, kg] of latest) collector.set(date, 'weight_kg', kg);
        })
      );
    }
    if (can('SleepSession')) {
      const sleepRange: TimeRange = {
        operator: 'between',
        startTime: new Date(start.getTime() - SLEEP_LOOKBACK_MS).toISOString(),
        endTime: end.toISOString(),
      };
      jobs.push(
        readAll(hc, 'SleepSession', sleepRange).then((sessions) => {
          const pieces: SleepInterval[] = [];
          for (const s of sessions) {
            const a = Date.parse(s.startTime);
            const b = Date.parse(s.endTime);
            if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue;
            pieces.push(...asleepPieces(a, b, s.stages, s.metadata?.dataOrigin || 'unknown'));
          }
          for (const [date, minutes] of sleepMinutesByWakeDate(pieces)) collector.set(date, 'sleep_minutes', minutes);
        })
      );
    }

    const results = await Promise.allSettled(jobs);
    const failed = results.filter((r) => r.status === 'rejected');
    if (results.length && failed.length === results.length) throw (failed[0] as PromiseRejectedResult).reason;
    return collector.rows();
  },

  async stepsBetween(ranges) {
    const none = ranges.map(() => null);
    if (!ranges.length) return none;
    try {
      const hc = await client();
      if (!(await readableTypes(hc)).has('Steps')) return none;
      return await Promise.all(
        ranges.map(async (r) => {
          if (!(r.end > r.start)) return 0;
          try {
            // Health Connect's aggregate de-duplicates overlapping apps / devices (its own priority list).
            const res = await hc.aggregateRecord({
              recordType: 'Steps',
              timeRangeFilter: { operator: 'between', startTime: new Date(r.start).toISOString(), endTime: new Date(r.end).toISOString() },
            });
            const n = res.COUNT_TOTAL;
            return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
          } catch {
            return null; // e.g. read from the background without background-read access
          }
        })
      );
    } catch {
      return none;
    }
  },

  async openManage() {
    try {
      (await healthConnect()).openHealthConnectSettings();
    } catch {
      await Linking.openSettings();
    }
  },

  async openStore() {
    try {
      await Linking.openURL(STORE_URL);
    } catch {
      await Linking.openURL(STORE_WEB_URL);
    }
  },
};
