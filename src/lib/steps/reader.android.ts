/**
 * Android steps: Health Connect (when the member connected it on the Health screen and allowed Steps) and the phone's
 * own hardware step counter, sampled natively all day by `modules/orza-steps` (with the app closed too) and turned
 * into daily totals by `counter.ts`. Each day takes the higher of the two. Metro picks this file on Android only.
 */
import { Linking, PermissionsAndroid, Platform } from 'react-native';

import * as sampler from '../../../modules/orza-steps';
import { healthBridge } from '../health/bridge';

import { coversDayEnd, coversWholeDay, dailyStepCounts, dayStartMs, type StepSample } from './counter';
import { bestOf, dayRanges, type Candidate } from './shared';
import { permissionHistory, setPermissionHistory } from './store';
import type { DaySteps, ReadOptions, StepPermission, StepsAccess, StepsReader } from './types';

const PERMISSION = PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION;
/** "Physical activity" became a run-time permission in Android 10 (API 29). */
const RUNTIME_PERMISSION = Number(Platform.Version) >= 29;
/** Samples read for the earliest requested day start this far back (the reading that opens its first interval). */
const LOOKBACK_MS = 36 * 3_600_000;

async function phoneAvailable(): Promise<boolean> {
  return sampler.isOrzaStepsAvailable() && (await sampler.isAvailable());
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

/** Daily totals from the native sampler's raw samples (null for a day the samples don't reach). */
async function phoneDays(dates: readonly string[], opts: ReadOptions): Promise<Map<string, Candidate>> {
  const out = new Map<string, Candidate>();
  if (!dates.length || !(await phoneAvailable()) || (await permission()) !== 'granted') return out;
  const tz = opts.timeZone;
  const first = [...dates].sort()[0];
  // A live reading (the app is in front): counts up to this second. Stored natively only if the last stored one is
  // ≥ 10 min old, so it's added here when it wasn't.
  const live = opts.background ? null : await sampler.sampleNow();
  const samples: StepSample[] = await sampler.getSamples(dayStartMs(first, tz) - LOOKBACK_MS);
  if (live && !samples.some((s) => s.ts === live.ts && s.counter === live.counter)) samples.push(live);
  const days = dailyStepCounts(samples, tz);
  for (const date of dates) {
    const d = days.get(date);
    if (!d) continue;
    out.set(date, {
      source: 'phone',
      steps: d.steps,
      ...(coversWholeDay(d, tz) ? {} : { partialFrom: d.coveredFrom }),
      ...(d.estimatedSteps > 0 ? { estimated: d.estimatedSteps } : {}),
      // A past day is final once a reading after its midnight exists (a background run may not have one yet).
      complete: coversDayEnd(d, tz),
    });
  }
  return out;
}

export const stepsReader: StepsReader = {
  platform: 'android',
  permissionName: 'Physical activity',
  settingsPath: 'Settings › Apps › ÖRZA › Permissions › Physical activity › Allow',

  async access(): Promise<StepsAccess> {
    if (!(await phoneAvailable())) return { phoneAvailable: false, phonePermission: 'unavailable' };
    return { phoneAvailable: true, phonePermission: await permission() };
  },

  async requestPermission() {
    if (!(await phoneAvailable())) return 'unavailable';
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

  async prepare(timeZone) {
    if ((await phoneAvailable()) && (await permission()) === 'granted') await sampler.start(timeZone);
  },

  async reset() {
    await sampler.stop();
    await sampler.clear();
  },

  async readDays(dates, opts) {
    const ranges = dayRanges(dates, opts.timeZone);
    const [phone, health] = await Promise.all([
      phoneDays(dates, opts).catch(() => new Map<string, Candidate>()),
      opts.healthConnected ? healthBridge.stepsBetween(ranges).catch(() => ranges.map(() => null)) : Promise.resolve(ranges.map(() => null)),
    ]);
    const out: DaySteps[] = [];
    for (let i = 0; i < dates.length; i++) {
      const date = dates[i];
      // 0 from Health Connect means nothing synced into it for that day ("no data"), not a day without steps.
      const candidates: Candidate[] = [{ source: 'health_connect', steps: health[i] || null, complete: !!health[i] }];
      const p = phone.get(date);
      if (p) candidates.push(p);
      const best = bestOf(date, candidates);
      if (best) out.push(best);
    }
    return out;
  },
};

/** "Open Settings" for a blocked permission: the app's own page. */
export function openStepsSettings(): Promise<void> {
  return Linking.openSettings();
}
