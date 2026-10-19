/**
 * Platform adapter — how a plan becomes alarms on this phone.
 *
 * Picking the platform: Metro resolves `./adapter` to `adapter.android.ts` on Android and `adapter.ios.ts` on iOS (React
 * Native platform extensions); this file is the fallback for every other target (web preview) and the one TypeScript
 * reads for types. Each platform file exports `alarmAdapter: PlatformAdapter`; the platform files import only TYPES
 * from here (`import type` — erased at build time, so the platform file never imports itself at runtime) and shared
 * runtime helpers from `./noop`.
 *
 * Contract for C2 (Android native module) and C3 (iOS notifications):
 * - `schedule(items)` REPLACES the whole pending set: an item whose key is already scheduled is updated, a pending
 *   alarm whose key is missing is cancelled. Items arrive sorted by time and capped at `maxScheduled`. It never touches
 *   alarms / notifications that are already showing. `items[].photos` / `doses[].photos` are local `file://` URIs in
 *   the app's documents folder — iOS moves an attachment into its own store, so attach a COPY, never the cached file.
 *   `ring: true` (doses, snoozes) = alarm-style: Android exact alarm + full-screen alarm with the photos, sound and
 *   vibration; iOS time-sensitive notification with the photos and Take / Snooze 10 min / Skip. `ring: false`
 *   (reminders, refills) = an ordinary notification. Tapping opens `deepLink` (`orza://alarm?at=…&med=…`).
 *   Android also keeps alarms that are already due but haven't been delivered yet (Doze / inexact delay).
 * - `dismiss(key)` removes that alarm if it is showing / ringing (the doses were handled elsewhere) — and one that is
 *   already due but hasn't been delivered yet. No-op otherwise; never cancels a future one.
 * - `snoozeNow(item)` adds / replaces ONE alarm right away (the re-ring of a dose snoozed in the app), leaving the rest.
 * - `refreshShowing(items)` re-shows alarms still showing whose doses were partly handled, with only the open doses
 *   (Android; iOS can't change a delivered notification — the engine filters its actions instead).
 * - Take / Snooze / Skip pressed on an alarm: the platform dismisses it and, for Snooze, schedules the re-ring itself
 *   at `now + snoozeMinutes` under `snoozeAlarmKey(scheduledFor, medIds)` (so it rings even offline and the next plan
 *   replaces it instead of doubling it) — for the doses `setActionFilter`'s filter leaves (doses already taken /
 *   skipped are never snoozed or skipped again). It then reports the action: `onAction` while JS runs, otherwise it
 *   records it natively and hands it over with `takeNativeActions()` (Android; iOS returns []). The engine queues it,
 *   sends it to `POST /api/meds/doses` (now or when back online) and re-plans.
 * - `status()` REJECTS when the permission can't be read (the engine then leaves the alarms alone).
 * - `maxScheduled` 0 means "can't ring alarms" (the stubs): the engine then declares `alarmsLocal: false`.
 */
import type { AlarmPlanItem, DoseActionKind } from './types';

export type NotificationsPermission = 'granted' | 'denied' | 'undetermined';

export interface AdapterStatus {
  notifications: NotificationsPermission;
  /** Android 12+: exact alarms allowed (SCHEDULE_EXACT_ALARM). Undefined where it doesn't apply. */
  exact?: boolean;
  /** Android 14+: full-screen alarms allowed (USE_FULL_SCREEN_INTENT). iOS: time-sensitive allowed. */
  fullScreen?: boolean;
  /**
   * Notifications are allowed but alarms can't be heard or seen as they arrive: Android "Medicine alarms" channel set
   * to Silent / no sound; iOS sounds, banners and the lock screen all off (Notification Center only). Alarms are still
   * scheduled (they appear in the list), but the phone doesn't claim to ring them (`alarmsLocal` false).
   */
  silenced?: boolean;
  /** Android: the "Medicine alarms" channel may pop up on screen (heads-up / full-screen alarm). */
  popup?: boolean;
  /** The system permission prompt can still be shown (false → only the phone's Settings can turn it on). */
  canAskNotifications: boolean;
}

export type SettingsKind = 'notifications' | 'exactAlarms' | 'fullScreen' | 'app';

/** An action recorded natively while the JS app wasn't running. */
export interface NativeAlarmAction {
  medId: string;
  scheduledFor: string;
  action: DoseActionKind;
  snoozeMinutes?: number;
  /** Epoch ms when it was pressed. */
  at: number;
}

export interface AlarmActionEvent {
  /** Key of the alarm it was pressed on. */
  key: string;
  /** `open` = the alarm / notification body was tapped. */
  action: DoseActionKind | 'open';
  /** The doses the action applies to (every dose of the alarm, or the one medicine it was pressed for). */
  doses: DoseRef[];
  snoozeMinutes?: number;
  /** In-app route to open (`open`), e.g. `/alarm?at=…&med=…`. */
  path?: string;
  /**
   * `open` raised by the alarm itself while ÖRZA is in the foreground (not a tap): the alarm is still ringing, so the
   * alarm screen leaves it ringing until the member's first press instead of dismissing it on open.
   */
  ringing?: boolean;
  /** Epoch ms when it was pressed. */
  at: number;
}

export type DoseRef = { medId: string; scheduledFor: string };

/** Which of these doses an action pressed on an alarm may still apply to (snooze / skip: not those already handled). */
export type ActionDoseFilter = (action: DoseActionKind, doses: DoseRef[]) => DoseRef[];

/**
 * Receives Take / Snooze / Skip and `open`. For `open`, return true when the alarm is (now) on screen in the app — iOS
 * then leaves out the banner of an alarm ringing in the foreground; anything else shows it.
 */
export type AlarmActionListener = (event: AlarmActionEvent) => boolean | void;

export interface ScheduleResult {
  /** Alarms now pending on the phone. */
  scheduled: number;
}

export interface PlatformAdapter {
  readonly name: 'android' | 'ios' | 'none';
  /** How many alarms the platform keeps pending (iOS ~60 of its 64; 0 = can't ring alarms). */
  readonly maxScheduled: number;
  schedule(items: AlarmPlanItem[]): Promise<ScheduleResult>;
  /** Adds / replaces one alarm now without touching the others (a dose snoozed in the app rings again). */
  snoozeNow(item: AlarmPlanItem): Promise<void>;
  cancelAll(): Promise<void>;
  dismiss(key: string): Promise<void>;
  /** Alarms showing whose doses were partly handled: re-shown with only the open doses (Android). */
  refreshShowing(items: AlarmPlanItem[]): Promise<void>;
  /** Rejects when the permission can't be read right now. */
  status(): Promise<AdapterStatus>;
  requestNotifications(): Promise<AdapterStatus>;
  openSettings(kind: SettingsKind): Promise<void>;
  /** Actions pressed while JS wasn't running; returned once (the platform forgets them). */
  takeNativeActions(): Promise<NativeAlarmAction[]>;
  /** Actions pressed while JS runs. Returns the unsubscribe function. */
  onAction(listener: AlarmActionListener): () => void;
  /** The engine's filter for the doses an action pressed on an alarm still applies to (null: all of them). */
  setActionFilter(filter: ActionDoseFilter | null): void;
}

export { alarmAdapter } from './noop';
