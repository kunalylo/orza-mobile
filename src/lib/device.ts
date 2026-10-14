/**
 * This phone in the user's `devices` registry (`POST /api/devices`, app sessions only).
 * Called after sign-in and on launch / return to foreground (throttled).
 *
 * `alarms_local` stays **false** until the on-phone alarm engine ships (Phase C): while a phone reports
 * `alarms_local: true` the server stops sending Web Push for medicine doses, so claiming it before the app
 * can actually ring would make people miss doses. Phase C passes `alarmsLocal` + the Expo `pushToken`.
 */
import * as Localization from 'expo-localization';

import { api, deviceLabel } from './api';
import { APP_VERSION, PLATFORM } from './config';
import { KEYS, writeSecure } from './secure';
import type { AppDeviceView } from './types';

const FALLBACK_TZ = 'Asia/Kolkata';

function isTimeZone(tz: string | null | undefined): tz is string {
  if (!tz || tz.length > 64 || !/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The phone's IANA timezone (e.g. "Asia/Kolkata"); falls back to IST like the website. */
export function deviceTimeZone(): string {
  let tz: string | null | undefined;
  try {
    tz = Localization.getCalendars()[0]?.timeZone;
  } catch {
    tz = null;
  }
  if (isTimeZone(tz)) return tz;
  try {
    const intl = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (isTimeZone(intl)) return intl;
  } catch {
    // ignore
  }
  return FALLBACK_TZ;
}

export interface RegisterOptions {
  pushToken?: string | null;
  alarmsLocal?: boolean;
}

const MIN_INTERVAL_MS = 10 * 60 * 1000;
let lastSentAt = 0;
let inflight: Promise<AppDeviceView | null> | null = null;

/** Upserts this phone for the current app session. Never throws (returns null on failure). */
export function registerDevice(opts: RegisterOptions & { force?: boolean } = {}): Promise<AppDeviceView | null> {
  if (PLATFORM === 'web') return Promise.resolve(null);
  if (inflight) return inflight;
  if (!opts.force && Date.now() - lastSentAt < MIN_INTERVAL_MS) return Promise.resolve(null);
  inflight = (async () => {
    try {
      const body: Record<string, unknown> = {
        platform: PLATFORM,
        device_label: deviceLabel(),
        app_version: APP_VERSION,
        timezone: deviceTimeZone(),
        alarms_local: opts.alarmsLocal ?? false,
      };
      if (opts.pushToken) body.push_token = opts.pushToken;
      const res = await api.post<{ device: AppDeviceView }>('/devices', body, { timeoutMs: 15_000 });
      lastSentAt = Date.now();
      await writeSecure(KEYS.device, res.device.id);
      return res.device;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Forget the throttle (after sign-out, so the next account registers immediately). */
export function resetDeviceRegistration() {
  lastSentAt = 0;
  void writeSecure(KEYS.device, null);
}
