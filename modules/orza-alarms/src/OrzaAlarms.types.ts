/** Types of the Android `OrzaAlarms` native module (see android/src/main/java/expo/modules/orzaalarms). */

export type DoseAction = 'take' | 'skip' | 'snooze';

/** A dose inside an alarm: recorded with a Take / Snooze / Skip, its line shown in the expanded text. */
export interface NativeAlarmDose {
  medId: string;
  /** ISO UTC instant of the scheduled dose. */
  scheduledFor: string;
  /** "Metformin 500 mg" */
  label: string;
  /** "1 tablet · after food" (may be empty) */
  line: string;
}

/** One alarm, as `scheduleAll` / `scheduleOne` take it (JSON). */
export interface NativeAlarmItem {
  /** Stable id; the notification tag. `test:` prefix = a test alarm (no dose recorded, survives `scheduleAll`). */
  key: string;
  kind: 'dose' | 'reminder' | 'refill' | 'test';
  /** Epoch ms. */
  at: number;
  title: string;
  body: string;
  /** Alarm-style: alarm channel, rings (≤ 10 min), full screen over the lock screen, Take / Snooze / Skip. */
  ring: boolean;
  /** Opened on tap / full screen, e.g. `orza://alarm?at=…&med=…`. */
  deepLink: string;
  /** Local `file://` JPEGs, in display order (one per medicine for a multi-medicine alarm, at most 4 are used). */
  photos: string[];
  doses: NativeAlarmDose[];
  /** Key of the re-ring a native Snooze schedules (C1 `snoozeAlarmKey`). */
  snoozeKey?: string;
  /** Expanded text when no photo is available (one line per medicine). */
  details?: string;
}

export interface NativeAlarmStatus {
  /** App notifications allowed (POST_NOTIFICATIONS on 13+ and not turned off in Settings). */
  notificationsEnabled: boolean;
  /** The "Medicine alarms" channel isn't turned off. */
  alarmChannelEnabled: boolean;
  /**
   * The "Medicine alarms" channel is on but can't make a sound ("Silent", or its sound set to None): alarms only appear
   * in the shade. Missing on builds made before it was added.
   */
  alarmChannelSilenced?: boolean;
  /** The "Medicine alarms" channel may pop up on screen (needed for the full-screen alarm). Missing on older builds. */
  alarmChannelPopup?: boolean;
  remindersChannelEnabled: boolean;
  /** Android 12+: "Alarms & reminders" allowed; null below 12 (always exact). */
  exact: boolean | null;
  /** Android 14+: full-screen alarms allowed; null below 14 (always allowed). */
  fullScreen: boolean | null;
  sdkInt: number;
  /** Alarms pending on the phone. */
  scheduled: number;
  /** The app has `res/raw/orza_alarm` (else the phone's alarm tone rings). */
  customSound: boolean;
  /** The app is showing over the lock screen (opened by an alarm). */
  overLockScreen: boolean;
  /** Exempt from battery optimisation ("Unrestricted"). Missing on builds made before it was added. */
  batteryUnrestricted?: boolean;
}

export interface NativeScheduledAlarm {
  key: string;
  at: number;
  kind: string;
  ring: boolean;
}

/** An action pressed on an alarm notification, waiting for JS. */
export interface NativeRecordedAction {
  id: number;
  /** Key of the alarm it was pressed on. */
  key: string;
  action: DoseAction;
  doses: { medId: string; scheduledFor: string; label?: string; line?: string }[];
  snoozeMinutes?: number;
  /** Epoch ms when it was pressed. */
  at: number;
}

/** Event: an action was recorded natively — collect it with `takeNativeActions()`. */
export interface AlarmActionRecordedEvent {
  id: number;
  key: string;
  action: DoseAction;
}

/** Event: a ringing alarm was just posted while the app is in the foreground (only a heads-up shows then). */
export interface AlarmShownEvent {
  key: string;
  /** e.g. `orza://alarm?at=…&med=…` */
  deepLink: string;
  /** Epoch ms the alarm was scheduled for. */
  at: number;
}

export type OrzaAlarmsEvents = {
  onAlarmAction: (event: AlarmActionRecordedEvent) => void;
  onAlarmShown: (event: AlarmShownEvent) => void;
};
