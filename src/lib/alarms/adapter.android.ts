/**
 * Android alarm adapter (step C2): the plan becomes exact alarms in the local `orza-alarms` native module
 * (modules/orza-alarms) — they ring offline, with the app killed and the phone locked, and come back after a reboot.
 *
 * - Doses and snoozes (`ring`): "Medicine alarms" channel (alarm volume, the ÖRZA tone, vibration), rings until
 *   answered (at most 10 min, then it stays silently in the shade), full-screen alarm over the lock screen opening
 *   `orza://alarm?at=…`, the medicine photos (BigPicture: one photo per medicine, up to 4), Take / Snooze 10 min / Skip.
 * - Reminders and refill alerts: an ordinary "Reminders" notification that opens its screen.
 * - Take / Snooze / Skip work with the app killed: the module records them (and schedules the snooze re-ring under
 *   `snoozeAlarmKey`), the engine collects them with `takeNativeActions()` — or right away through `onAction` while JS
 *   runs (each action is handed over exactly once, whichever path collects it first).
 * - Tapping an alarm opens its deep link through React Native's Linking (expo-router navigates). An `open` action is
 *   emitted only when a ringing alarm fires while the app is in the foreground (Android then shows just a heads-up,
 *   no full-screen alarm), so the engine opens the alarm screen — as on iOS.
 * - Actions pressed in the shade while the app is open are confirmed with a toast (as on iOS).
 * - Builds without the module (Expo Go, an older dev build) get the no-op adapter: `maxScheduled` 0, so the engine
 *   never declares `alarmsLocal: true` and the server keeps sending the medicine Web Push.
 *
 * Contract: see `./adapter.ts`. Platform file: imports only TYPES from './adapter'.
 */
import * as Notifications from 'expo-notifications';
import { AppState, Linking } from 'react-native';

import * as OrzaAlarms from '../../../modules/orza-alarms';
import type { AlarmShownEvent, NativeAlarmItem, NativeRecordedAction } from '../../../modules/orza-alarms';

import type { AdapterStatus, AlarmActionEvent, NativeAlarmAction, PlatformAdapter, ScheduleResult, SettingsKind } from './adapter';
import { createNoopAdapter } from './noop';
import { DEFAULT_SNOOZE_MINUTES } from './plan';
import { snoozeAlarmKey, type AlarmPlanItem, type DoseActionKind } from './types';

export type { AdapterStatus, AlarmActionEvent, NativeAlarmAction, PlatformAdapter, ScheduleResult, SettingsKind } from './adapter';

/** Pending alarms kept on the phone (Android allows 500 per app; the inexact fallback uses 2 per alarm). */
const MAX_SCHEDULED = 200;
/** Photos in a multi-medicine alarm (one per medicine) / a single medicine (front + back). */
const MULTI_PHOTOS = 4;
const SINGLE_PHOTOS = 2;

/** The plan item as the native module takes it. */
export function toNativeAlarm(item: AlarmPlanItem): NativeAlarmItem {
  const doses = item.doses ?? [];
  let photos: string[];
  if (doses.length > 1) {
    photos = doses
      .map((d) => d.photos[0])
      .filter((uri): uri is string => !!uri)
      .slice(0, MULTI_PHOTOS);
  } else if (doses.length === 1 && doses[0].photos.length) {
    photos = doses[0].photos.slice(0, SINGLE_PHOTOS);
  } else {
    photos = item.photos.slice(0, SINGLE_PHOTOS);
  }

  let details: string | undefined;
  if (doses.length > 1) {
    details = doses.map((d) => `• ${d.label}${d.line ? ` — ${d.line}` : ''}`).join('\n');
  } else if (doses.length === 1) {
    details = [item.body, doses[0].instructions?.trim()].filter((s): s is string => !!s).join('\n');
  }

  const medIds = [...new Set(doses.map((d) => d.medId))];
  return {
    key: item.key,
    kind: item.kind,
    at: item.at,
    title: item.title,
    body: item.body,
    ring: item.ring,
    deepLink: item.deepLink,
    photos,
    doses: doses.map((d) => ({ medId: d.medId, scheduledFor: d.scheduledFor, label: d.label, line: d.line })),
    ...(doses.length && item.ring ? { snoozeKey: snoozeAlarmKey(doses[0].scheduledFor, medIds) } : {}),
    ...(details ? { details } : {}),
  };
}

function toEvent(a: NativeRecordedAction): AlarmActionEvent {
  return {
    key: a.key,
    action: a.action,
    doses: a.doses.map((d) => ({ medId: d.medId, scheduledFor: d.scheduledFor })),
    ...(a.snoozeMinutes ? { snoozeMinutes: a.snoozeMinutes } : {}),
    at: a.at,
  };
}

/** `orza://alarm?at=…` → `/alarm?at=…` (the in-app route of a deep link); undefined for anything else. */
export function pathOfDeepLink(deepLink: string): string | undefined {
  const m = /^orza:\/\/(.+)$/.exec(deepLink);
  return m ? `/${m[1].replace(/^\/+/, '')}` : undefined;
}

/** A Take / Snooze / Skip pressed in the shade while the app is open: say it went through. */
async function confirm(action: DoseActionKind, count: number): Promise<void> {
  if (AppState.currentState !== 'active' || count < 1) return;
  try {
    const { toast } = await import('@/ui/Toast');
    const many = count > 1;
    if (action === 'take') toast.success(many ? `Marked ${count} medicines as taken` : 'Marked as taken');
    else if (action === 'skip') toast.info(many ? `Skipped ${count} medicines` : 'Dose skipped');
    else toast.info(`Snoozed — ringing again in ${DEFAULT_SNOOZE_MINUTES} minutes`);
  } catch {
    // no toast — the action still went through
  }
}

function toNativeActions(recorded: NativeRecordedAction[]): NativeAlarmAction[] {
  return recorded.flatMap((a) =>
    a.doses.map((d) => ({
      medId: d.medId,
      scheduledFor: d.scheduledFor,
      action: a.action,
      ...(a.snoozeMinutes ? { snoozeMinutes: a.snoozeMinutes } : {}),
      at: a.at,
    }))
  );
}

async function readStatus(): Promise<AdapterStatus> {
  const [perm, native] = await Promise.all([
    Notifications.getPermissionsAsync().catch(() => null),
    OrzaAlarms.getStatus().catch(() => null),
  ]);
  const appEnabled = native ? native.notificationsEnabled : !!perm?.granted;
  const channelOn = native ? native.alarmChannelEnabled : true;
  const granted = appEnabled && channelOn;
  let notifications: AdapterStatus['notifications'];
  if (granted) notifications = 'granted';
  else if (!appEnabled && perm?.status === 'undetermined') notifications = 'undetermined';
  else notifications = 'denied';
  const status: AdapterStatus = {
    notifications,
    // A blocked "Medicine alarms" channel can only be turned back on in Settings.
    canAskNotifications: !granted && channelOn && !appEnabled && perm?.canAskAgain !== false,
  };
  if (native && native.exact !== null) status.exact = native.exact;
  if (native && native.fullScreen !== null) status.fullScreen = native.fullScreen;
  return status;
}

function createAndroidAdapter(): PlatformAdapter {
  const listeners = new Set<(event: AlarmActionEvent) => void>();
  let subscriptions: { remove(): void }[] = [];
  let draining = false;
  let drainAgain = false;

  const emit = (event: AlarmActionEvent) => {
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch {
        // One listener's failure must not lose the event for the others.
      }
    }
  };

  /** A ringing alarm fired while the app is in the foreground: open the alarm screen. */
  const opened = (e: AlarmShownEvent) => {
    const path = pathOfDeepLink(e.deepLink);
    if (!path || !listeners.size) return;
    emit({ key: e.key, action: 'open', doses: [], path, at: Date.now() });
  };

  /** A native action was recorded: collect everything waiting and hand it to the listeners (once). */
  const deliver = async () => {
    if (draining) {
      drainAgain = true;
      return;
    }
    draining = true;
    try {
      do {
        drainAgain = false;
        // Nobody listening → leave them for the engine's next `takeNativeActions()`.
        if (!listeners.size) return;
        const recorded = await OrzaAlarms.takeNativeActions().catch((): NativeRecordedAction[] => []);
        for (const action of recorded) {
          emit(toEvent(action));
          void confirm(action.action, action.doses.length);
        }
      } while (drainAgain);
    } finally {
      draining = false;
    }
  };

  return {
    name: 'android',
    maxScheduled: MAX_SCHEDULED,

    async schedule(items: AlarmPlanItem[]): Promise<ScheduleResult> {
      const scheduled = await OrzaAlarms.scheduleAll(items.slice(0, MAX_SCHEDULED).map(toNativeAlarm));
      return { scheduled };
    },

    cancelAll: () => OrzaAlarms.cancelAll(),

    dismiss: (key: string) => OrzaAlarms.dismiss(key),

    status: readStatus,

    async requestNotifications(): Promise<AdapterStatus> {
      await Notifications.requestPermissionsAsync().catch(() => null);
      return readStatus();
    },

    async openSettings(kind: SettingsKind): Promise<void> {
      let opened: boolean;
      if (kind === 'notifications') opened = await OrzaAlarms.openNotificationSettings().catch(() => false);
      else if (kind === 'exactAlarms') opened = await OrzaAlarms.openExactAlarmSettings().catch(() => false);
      else if (kind === 'fullScreen') opened = await OrzaAlarms.openFullScreenSettings().catch(() => false);
      else opened = await OrzaAlarms.openAppSettings().catch(() => false);
      if (!opened) await Linking.openSettings().catch(() => undefined);
    },

    async takeNativeActions(): Promise<NativeAlarmAction[]> {
      return toNativeActions(await OrzaAlarms.takeNativeActions());
    },

    onAction(listener: (event: AlarmActionEvent) => void): () => void {
      listeners.add(listener);
      // Actions recorded while nobody listened (JS just started) are collected by the engine's own sync.
      if (!subscriptions.length) {
        subscriptions = [OrzaAlarms.addActionListener(() => void deliver()), OrzaAlarms.addShownListener(opened)];
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size && subscriptions.length) {
          for (const sub of subscriptions) sub.remove();
          subscriptions = [];
        }
      };
    },
  };
}

export const alarmAdapter: PlatformAdapter = OrzaAlarms.isOrzaAlarmsAvailable() ? createAndroidAdapter() : createNoopAdapter('android');
