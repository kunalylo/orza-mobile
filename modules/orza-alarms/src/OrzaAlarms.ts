/**
 * ÖRZA medicine alarms — Android native module (local Expo module, autolinked from ./modules).
 *
 * Exact alarms that ring with the app killed and the phone locked: an insistent alarm notification with the medicine
 * photos, a full-screen alarm over the lock screen, Take / Snooze 10 min / Skip that work offline (recorded natively,
 * collected with `takeNativeActions`), re-scheduled after a reboot. Reminders / refills are ordinary notifications.
 *
 * `requireOptionalNativeModule` → null where the module isn't built in (Expo Go, web, iOS, an old dev build): every
 * function then resolves to a harmless default and `isOrzaAlarmsAvailable()` is false.
 */
import { NativeModule, requireOptionalNativeModule } from 'expo';

import type {
  AlarmActionRecordedEvent,
  AlarmShownEvent,
  DoseAction,
  NativeAlarmItem,
  NativeAlarmStatus,
  NativeRecordedAction,
  NativeScheduledAlarm,
  OrzaAlarmsEvents,
} from './OrzaAlarms.types';

declare class OrzaAlarmsNativeModule extends NativeModule<OrzaAlarmsEvents> {
  scheduleAll(itemsJson: string): Promise<number>;
  scheduleOne(itemJson: string): Promise<boolean>;
  cancelAll(): Promise<void>;
  dismiss(key: string): Promise<void>;
  silenceRinging(): Promise<number>;
  getStatus(): Promise<NativeAlarmStatus>;
  getScheduled(): Promise<string>;
  takeNativeActions(): Promise<string>;
  openExactAlarmSettings(): Promise<boolean>;
  openFullScreenSettings(): Promise<boolean>;
  openNotificationSettings(): Promise<boolean>;
  openAppSettings(): Promise<boolean>;
  openBatterySettings?(): Promise<boolean>;
  releaseLockScreen(): Promise<boolean>;
  requestUnlock(): Promise<boolean>;
}

const native = requireOptionalNativeModule<OrzaAlarmsNativeModule>('OrzaAlarms');

/** The native module is in this build (Android dev / release build). */
export function isOrzaAlarmsAvailable(): boolean {
  return native != null;
}

/** Replaces every pending alarm with `items` (future ones only). Resolves with how many are pending. */
export async function scheduleAll(items: NativeAlarmItem[]): Promise<number> {
  if (!native) return 0;
  return native.scheduleAll(JSON.stringify(items));
}

/** Adds / replaces one alarm without touching the others (e.g. a `test:` alarm). */
export async function scheduleOne(item: NativeAlarmItem): Promise<boolean> {
  if (!native) return false;
  return native.scheduleOne(JSON.stringify(item));
}

/** Cancels every pending alarm and removes every ÖRZA alarm showing (sign-out, permission gone). */
export async function cancelAll(): Promise<void> {
  if (native) await native.cancelAll();
}

/** Removes alarm `key` if it is showing / ringing (handled elsewhere). Never cancels a pending alarm. */
export async function dismiss(key: string): Promise<void> {
  if (native) await native.dismiss(key);
}

/** Stops every ringing alarm; they stay in the shade with their buttons. Resolves with how many were silenced. */
export async function silenceRinging(): Promise<number> {
  if (!native) return 0;
  return native.silenceRinging();
}

export async function getStatus(): Promise<NativeAlarmStatus | null> {
  if (!native) return null;
  return native.getStatus();
}

/** Pending alarms, soonest first. */
export async function getScheduled(): Promise<NativeScheduledAlarm[]> {
  if (!native) return [];
  return parseArray(await native.getScheduled()).filter(
    (a): a is NativeScheduledAlarm => isRecord(a) && typeof a.key === 'string' && typeof a.at === 'number'
  );
}

/** Actions pressed on alarms that weren't collected yet; each is returned once. */
export async function takeNativeActions(): Promise<NativeRecordedAction[]> {
  if (!native) return [];
  return parseArray(await native.takeNativeActions()).filter(isRecordedAction);
}

/** Android 12+ "Alarms & reminders" (exact alarms) page; the app's info page below 12. */
export async function openExactAlarmSettings(): Promise<boolean> {
  return native ? native.openExactAlarmSettings() : false;
}

/** Android 14+ "Full-screen notifications" page; the app's notification settings below 14. */
export async function openFullScreenSettings(): Promise<boolean> {
  return native ? native.openFullScreenSettings() : false;
}

/** The "Medicine alarms" channel when only it is off, else the app's notification settings. */
export async function openNotificationSettings(): Promise<boolean> {
  return native ? native.openNotificationSettings() : false;
}

export async function openAppSettings(): Promise<boolean> {
  return native ? native.openAppSettings() : false;
}

/** The phone's battery-optimisation list (set ÖRZA to "Unrestricted"); the app's info page as a fallback. */
export async function openBatterySettings(): Promise<boolean> {
  if (!native) return false;
  if (typeof native.openBatterySettings === 'function') return native.openBatterySettings();
  return native.openAppSettings();
}

/**
 * The alarm screen is closing: stop showing the app over the lock screen (it only does for an alarm's full-screen
 * launch, and releases itself when the app goes to the background or after 10 min anyway).
 */
export async function releaseLockScreen(): Promise<boolean> {
  return native ? native.releaseLockScreen() : false;
}

/** Ask for the PIN / fingerprint (e.g. to open the rest of the app from the alarm). True once unlocked. */
export async function requestUnlock(): Promise<boolean> {
  return native ? native.requestUnlock() : true;
}

/** An action was recorded natively while JS runs — collect it with `takeNativeActions()`. */
export function addActionListener(listener: (event: AlarmActionRecordedEvent) => void): { remove(): void } {
  if (!native) return { remove: () => undefined };
  return native.addListener('onAlarmAction', listener);
}

/** A ringing alarm was posted while the app is in the foreground — open the alarm screen. */
export function addShownListener(listener: (event: AlarmShownEvent) => void): { remove(): void } {
  if (!native) return { remove: () => undefined };
  return native.addListener('onAlarmShown', listener);
}

/* ───────────────────────────── Parsing ───────────────────────────── */

const ACTIONS: readonly DoseAction[] = ['take', 'skip', 'snooze'];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function parseArray(json: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isRecordedAction(v: unknown): v is NativeRecordedAction {
  if (!isRecord(v)) return false;
  return (
    typeof v.key === 'string' &&
    typeof v.at === 'number' &&
    ACTIONS.includes(v.action as DoseAction) &&
    Array.isArray(v.doses) &&
    v.doses.every((d) => isRecord(d) && typeof d.medId === 'string' && typeof d.scheduledFor === 'string')
  );
}
