/**
 * ÖRZA step sampler — Android native module (local Expo module, autolinked from ./modules).
 *
 * Records RAW readings of the phone's hardware step counter (Sensor.TYPE_STEP_COUNTER: steps since boot, reset at
 * every reboot) — on request, about hourly (less often in stricter standby buckets), just before and after midnight, at
 * boot / app update and at shutdown — in a 10-day ring buffer (never backed up), with the app closed too. Turning
 * readings into daily totals is pure TypeScript (`src/lib/steps/counter.ts`).
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

export interface NativeStepsStatus {
  available: boolean;
  permission: boolean;
  enabled: boolean;
  /** The periodic sample is set (none in the Restricted standby bucket). */
  armed: boolean;
  midnightArmed: boolean;
  /** Midnight samples are exact ("Alarms & reminders" allowed), else an inexact chain. */
  exactMidnight: boolean;
  /** App Standby bucket (10 active · 20 working set · 30 frequent · 40 rare · 45 restricted). */
  standbyBucket: number;
  samples: number;
  timeZone: string | null;
  bootCount: number;
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
