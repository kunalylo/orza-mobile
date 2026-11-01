/**
 * ÖRZA's phone step sources — Android native module (local Expo module, autolinked from ./modules).
 *
 * - The step sampler records RAW readings of the phone's hardware step counter (Sensor.TYPE_STEP_COUNTER: steps since
 *   boot, reset at every reboot) — on request, about hourly (less often in stricter standby buckets), just before and
 *   after midnight, at boot / app update and at shutdown — in a 10-day ring buffer (never backed up), with the app
 *   closed too. Turning readings into daily totals is pure TypeScript (`src/lib/steps/counter.ts`).
 * - The Recording API on mobile (Google Play services) counts steps in the background once subscribed; `recordingRead`
 *   returns its buckets for `src/lib/steps/recording.ts` (`recordingRange` gives the read's arguments).
 * - `healthFeatures` reports what Health Connect can do for steps (its own step counting, background reading, grants).
 *
 * The module also holds Health Connect's privacy-policy screen (HealthPrivacyActivity, no JS).
 *
 * `requireOptionalNativeModule` → null where the module isn't built in (Expo Go, web, iOS, an older dev build): every
 * function then resolves to a harmless default and `isOrzaStepsAvailable()` is false.
 */
import { NativeModule, requireOptionalNativeModule } from 'expo';

/** One reading: `counter` steps since boot number `boot`, at wall-clock `ts`, `elapsed` ms after that boot. */
export interface NativeStepSample {
  /** Epoch ms. */
  ts: number;
  counter: number;
  /** Settings.Global.BOOT_COUNT (-1 when unknown). */
  boot: number;
  /** SystemClock.elapsedRealtime() (ms since boot; -1 when unknown). */
  elapsed: number;
  /** app / periodic / midnight / boot / updated / shutdown */
  reason?: string;
}

/**
 * The Recording API on this phone: Play services' answer for the steps-only minimum version, or `no_sensor` when the
 * phone has no step counter. Only `available` can be subscribed to and read.
 */
export type RecordingStatus = 'available' | 'update_required' | 'missing' | 'disabled' | 'unavailable' | 'no_sensor';

export interface RecordingSubscription {
  ok: boolean;
  /** The first successful subscription (epoch ms): the API has no data from before it. Null when not subscribed. */
  subscribedAt: number | null;
  /** Why it failed (exception class + status code) — for logs, never shown. */
  error: string | null;
}

/** One Recording API bucket: `steps` counted in [start, end) (epoch ms) — the shape of `recording.ts`'s RecordingBucket. */
export interface NativeRecordingBucket {
  start: number;
  end: number;
  steps: number;
}

/** What Health Connect can do for steps on this phone (`plan.firstAsk` / `plan.sourcesOn`). */
export interface HealthFeatures {
  /** Health Connect counts this phone's steps itself: Android 14+ with SDK extension ≥ 20. */
  stepTracking: boolean;
  /** Android 14's SDK extension level (0 below Android 14). */
  extension: number;
  /** Health Connect supports reading in the background (then ÖRZA asks for it with Steps). */
  backgroundRead: 'available' | 'unavailable';
  /** READ_HEALTH_DATA_IN_BACKGROUND is granted. */
  backgroundGranted: boolean;
  /** READ_STEPS is granted. */
  stepsGranted: boolean;
}

const NO_HEALTH_FEATURES: HealthFeatures = {
  stepTracking: false,
  extension: 0,
  backgroundRead: 'unavailable',
  backgroundGranted: false,
  stepsGranted: false,
};

const RECORDING_STATUSES: readonly RecordingStatus[] = ['available', 'update_required', 'missing', 'disabled', 'unavailable', 'no_sensor'];

export interface NativeStepsStatus {
  available: boolean;
  permission: boolean;
  enabled: boolean;
  /** The periodic sample is set (none in the Restricted standby bucket). */
  armed: boolean;
  midnightArmed: boolean;
  /** "Alarms & reminders" is allowed — diagnostics only: the midnight samples are always an inexact chain (P14). */
  exactMidnight: boolean;
  /** App Standby bucket (10 active · 20 working set · 30 frequent · 40 rare · 45 restricted). */
  standbyBucket: number;
  samples: number;
  timeZone: string | null;
  bootCount: number;
  /** The Recording API (absent in builds before steps v2). */
  recording?: RecordingStatus;
  /** When the Recording API subscription began (epoch ms), null when not subscribed. */
  subscribedAt?: number | null;
}

declare class OrzaStepsNativeModule extends NativeModule {
  isAvailable(): Promise<boolean>;
  hasPermission(): Promise<boolean>;
  start(timeZone: string): Promise<boolean>;
  stop(): Promise<void>;
  sampleNow(): Promise<(NativeStepSample & { stored: boolean }) | null>;
  getSamples(sinceMs: number): Promise<string>;
  clear(): Promise<void>;
  getStatus(): Promise<NativeStepsStatus>;
  recordingStatus(): Promise<string>;
  recordingSubscribe(): Promise<{ ok: boolean; subscribedAt: number | null; error: string | null }>;
  recordingUnsubscribe(): Promise<boolean>;
  recordingRead(startMs: number, lastMs: number, bucketMinutes: number): Promise<string>;
  recordingSubscribedAt(): Promise<number | null>;
  healthFeatures(): Promise<HealthFeatures>;
}

const native = requireOptionalNativeModule<OrzaStepsNativeModule>('OrzaSteps');

/** The native module is in this build (Android dev / release build). */
export function isOrzaStepsAvailable(): boolean {
  return native != null;
}

/** This phone has a hardware step counter (false without the module). */
export async function isAvailable(): Promise<boolean> {
  if (!native) return false;
  try {
    return await native.isAvailable();
  } catch {
    return false;
  }
}

/** "Physical activity" is granted (native check; always true below Android 10). */
export async function hasPermission(): Promise<boolean> {
  if (!native) return false;
  try {
    return await native.hasPermission();
  } catch {
    return false;
  }
}

/**
 * Turn counting on for the member's `timeZone` (midnight samples follow it): arms the alarms and keeps the counter
 * active. False — nothing armed — without a step counter or the permission. Cheap; call it on every launch.
 */
export async function start(timeZone: string): Promise<boolean> {
  if (!native) return false;
  try {
    return await native.start(timeZone);
  } catch {
    return false;
  }
}

/** Turn counting off (cancels the alarms; samples stay until `clear`). */
export async function stop(): Promise<void> {
  if (!native) return;
  try {
    await native.stop();
  } catch {
    // nothing armed
  }
}

/**
 * Read the counter now (≤ ~3.5 s). The reading is stored when the last stored one of this boot is ≥ 10 min old;
 * either way it is returned, so the caller can count up to this instant. Null when nothing could be read.
 */
export async function sampleNow(): Promise<NativeStepSample | null> {
  if (!native) return null;
  try {
    const s = await native.sampleNow();
    return s && isSample(s) ? s : null;
  } catch {
    return null;
  }
}

/** Stored samples taken at or after `sinceMs` (plus the one just before), in the order they were taken. */
export async function getSamples(sinceMs: number): Promise<NativeStepSample[]> {
  if (!native) return [];
  try {
    const parsed: unknown = JSON.parse(await native.getSamples(sinceMs));
    if (!Array.isArray(parsed)) return [];
    const out: NativeStepSample[] = [];
    for (const o of parsed) {
      if (!o || typeof o !== 'object') continue;
      const r = o as Record<string, unknown>;
      const s = { ts: r.t, counter: r.c, boot: r.b ?? -1, elapsed: r.e ?? -1, reason: typeof r.r === 'string' ? r.r : undefined };
      if (isSample(s)) out.push(s);
    }
    return out;
  } catch {
    return [];
  }
}

/** Forget every stored sample (sign-out). */
export async function clear(): Promise<void> {
  if (!native) return;
  try {
    await native.clear();
  } catch {
    // nothing stored
  }
}

export async function getStatus(): Promise<NativeStepsStatus | null> {
  if (!native) return null;
  try {
    return await native.getStatus();
  } catch {
    return null;
  }
}

/** The Recording API's state here (`unavailable` without the module or when it can't be checked). */
export async function recordingStatus(): Promise<RecordingStatus> {
  if (!native) return 'unavailable';
  try {
    const s = await native.recordingStatus();
    return (RECORDING_STATUSES as readonly string[]).includes(s) ? (s as RecordingStatus) : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/**
 * Subscribe to step recording (needs "Physical activity"; subscribing again changes nothing). Cheap — call it on every
 * launch and background run. `subscribedAt` stays the first successful subscription until `recordingUnsubscribe`.
 */
export async function recordingSubscribe(): Promise<RecordingSubscription> {
  if (!native) return { ok: false, subscribedAt: null, error: 'no module' };
  try {
    const r = await native.recordingSubscribe();
    return { ok: r?.ok === true, subscribedAt: validTime(r?.subscribedAt), error: typeof r?.error === 'string' ? r.error : null };
  } catch (e) {
    return { ok: false, subscribedAt: null, error: e instanceof Error ? e.message : 'failed' };
  }
}

/** Stop step recording (switch-off, sign-out): its data becomes unreadable and `subscribedAt` is forgotten. */
export async function recordingUnsubscribe(): Promise<boolean> {
  if (!native) return false;
  try {
    return (await native.recordingUnsubscribe()) === true;
  } catch {
    return false;
  }
}

/**
 * The Recording API's non-zero buckets over [startMs, lastMs] — pass `recordingRange()`'s fields as they are (both ends
 * inclusive; `lastMs` is already end − 1). Null when the read failed (no reading — never 0 steps); `[]` = nothing
 * counted.
 */
export async function recordingRead(startMs: number, lastMs: number, bucketMinutes: number): Promise<NativeRecordingBucket[] | null> {
  if (!native) return null;
  try {
    const parsed: unknown = JSON.parse(await native.recordingRead(startMs, lastMs, bucketMinutes));
    if (!Array.isArray(parsed)) return null;
    const out: NativeRecordingBucket[] = [];
    for (const b of parsed) {
      if (!Array.isArray(b) || b.length < 3) continue;
      const [start, end, steps] = b as unknown[];
      if (isFiniteNumber(start) && isFiniteNumber(end) && isFiniteNumber(steps) && steps > 0) out.push({ start, end, steps });
    }
    return out;
  } catch {
    return null;
  }
}

/** When the Recording API subscription began (epoch ms), null when not subscribed or unknown. */
export async function recordingSubscribedAt(): Promise<number | null> {
  if (!native) return null;
  try {
    return validTime(await native.recordingSubscribedAt());
  } catch {
    return null;
  }
}

/** What Health Connect can do for steps here (every field "no" without the module or when it can't be read). */
export async function healthFeatures(): Promise<HealthFeatures> {
  if (!native) return { ...NO_HEALTH_FEATURES };
  try {
    const f = await native.healthFeatures();
    return {
      stepTracking: f?.stepTracking === true,
      extension: isFiniteNumber(f?.extension) ? f.extension : 0,
      backgroundRead: f?.backgroundRead === 'available' ? 'available' : 'unavailable',
      backgroundGranted: f?.backgroundGranted === true,
      stepsGranted: f?.stepsGranted === true,
    };
  } catch {
    return { ...NO_HEALTH_FEATURES };
  }
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const validTime = (v: unknown): number | null => (isFiniteNumber(v) && v > 0 ? v : null);

function isSample(v: { ts?: unknown; counter?: unknown; boot?: unknown; elapsed?: unknown }): v is NativeStepSample {
  return (
    typeof v.ts === 'number' &&
    Number.isFinite(v.ts) &&
    typeof v.counter === 'number' &&
    Number.isFinite(v.counter) &&
    v.counter >= 0 &&
    typeof v.boot === 'number' &&
    typeof v.elapsed === 'number'
  );
}
