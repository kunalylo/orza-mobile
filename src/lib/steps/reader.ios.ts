/**
 * iPhone steps: Apple Health (when the member connected it on the Health screen — a statistics sum, iPhone + Apple
 * Watch counted once) and the iPhone's motion coprocessor through CMPedometer (expo-sensors; it records all day by
 * itself and keeps 7 days). Each source's reading goes out as is; `merge.ts` decides the day. Metro picks this file
 * on iOS only.
 */
import { PermissionStatus } from 'expo';
import { Pedometer } from 'expo-sensors';
import { Linking } from 'react-native';

import { healthBridge } from '../health/bridge';

import { dayBounds, dayRanges } from './shared';
import type { DayReading, SourceReading, StepPermission, StepsAccess, StepsReader } from './types';

/** CMPedometer keeps this many days (older ranges return only what is left). */
const PEDOMETER_DAYS_MS = 7 * 24 * 3_600_000;

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

async function pedometerSteps(range: { start: number; end: number }, now: number): Promise<number | null> {
  if (!(range.end > range.start) || now - range.start > PEDOMETER_DAYS_MS) return null;
  try {
    const r = await Pedometer.getStepCountAsync(new Date(range.start), new Date(range.end));
    return typeof r?.steps === 'number' && Number.isFinite(r.steps) ? r.steps : null;
  } catch {
    return null;
  }
}

export const stepsReader: StepsReader = {
  platform: 'ios',
  permissionName: 'Motion & Fitness',
  settingsPath: 'Settings › ÖRZA › Motion & Fitness',

  async access(): Promise<StepsAccess> {
    if (!(await phoneAvailable())) return { phoneAvailable: false, phonePermission: 'unavailable' };
    return { phoneAvailable: true, phonePermission: await permission() };
  },

  async requestPermission() {
    if (!(await phoneAvailable())) return 'unavailable';
    try {
      await Pedometer.requestPermissionsAsync();
    } catch {
      // fall through to the current state
    }
    return permission();
  },

  async prepare() {
    // The motion coprocessor counts on its own; nothing to start.
  },

  async reset() {
    // Nothing stored on the phone by ÖRZA.
  },

  async readDays(dates, opts) {
    const now = Date.now();
    const ranges = dayRanges(dates, opts.timeZone, now);
    const usePedometer = (await phoneAvailable()) && (await permission()) === 'granted';
    const [health, phone] = await Promise.all([
      opts.healthConnected ? healthBridge.stepsBetween(ranges).catch(() => ranges.map(() => null)) : Promise.resolve(ranges.map(() => null)),
      usePedometer ? Promise.all(ranges.map((r) => pedometerSteps(r, now))) : Promise.resolve(ranges.map(() => null)),
    ]);
    return dates.map((date, i): DayReading => {
      const day = dayBounds(date, opts.timeZone);
      const sources: SourceReading[] = [];
      // 0 from Apple Health also means "nothing readable" (HealthKit hides a denied read as no data, M0).
      const hk = health[i];
      if (hk) sources.push({ source: 'apple_health', steps: hk, coverFrom: day.start, complete: now >= day.end });
      // CMPedometer answers for the whole range it was asked (it records all day by itself).
      const p = phone[i];
      if (p != null) sources.push({ source: 'phone', counter: 'pedometer', steps: p, coverFrom: day.start, complete: now >= day.end });
      return { date, ...day, sources };
    });
  },
};

export function openStepsSettings(): Promise<void> {
  return Linking.openSettings();
}
