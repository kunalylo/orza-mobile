/**
 * iOS alarm adapter (step C3): the plan becomes local notifications scheduled on the phone itself — they fire offline,
 * with the app killed and the phone locked.
 *
 * - Doses and snoozes: time-sensitive notifications with the medicine photo attached, the alarm sound and
 *   Take / Snooze 10 min / Skip (Take all / … when several medicines are due together). Reminders and refill alerts:
 *   ordinary notifications. Tapping opens the alarm screen / the reminder's screen.
 * - `schedule(items)` diffs against what is pending (identifier = plan key): removes ours that left the plan, keeps
 *   those whose content signature is unchanged, adds / replaces the rest — at most 60 (iOS keeps 64).
 * - Take / Snooze / Skip open the app (iOS doesn't run JS for a background action when the app was killed). The
 *   adapter dismisses the notification, schedules a Snooze's re-ring itself (now + 10 min, `snoozeAlarmKey`, same
 *   texts and photo — so it rings even offline), confirms with a toast and reports the action through `onAction`; the
 *   engine queues it for `POST /api/meds/doses` and re-plans. `takeNativeActions()` is always empty on iOS.
 * - A ringing alarm that fires while the app is open shows the alarm screen instead of a banner (sound still plays).
 *
 * Contract: `./adapter.ts`. Platform files import only TYPES from `./adapter` (Metro resolves `./adapter` to this file).
 */
import * as Notifications from 'expo-notifications';
import { Linking } from 'react-native';

import {
  ALARM_ACTION,
  installNotificationHandling,
  notificationPath,
  readOrzaData,
  setInAppAlarmPresenter,
  subscribeNotificationResponses,
  type OrzaNotificationData,
} from '@/lib/notifications';

import type { ActionDoseFilter, AdapterStatus, AlarmActionEvent, AlarmActionListener, DoseRef, PlatformAdapter, ScheduleResult } from './adapter';
import {
  IOS_MAX_PENDING,
  MIN_LEAD_MS,
  alarmSound,
  attachablePhoto,
  buildContent,
  copyForAttachment,
  dateTrigger,
  discardCopy,
  ensureAlarmCategories,
  isAlarmKey,
  itemSignature,
  notificationData,
  sweepAttachmentCopies,
  toAdapterStatus,
  type AttachmentCopy,
  type ContentSource,
} from './notifications-ios';
import { DEFAULT_SNOOZE_MINUTES } from './plan';
import { snoozeAlarmKey, type AlarmPlanItem, type DoseActionKind } from './types';

export type { AdapterStatus, AlarmActionEvent, NativeAlarmAction, PlatformAdapter, ScheduleResult, SettingsKind } from './adapter';

/** A Snooze scheduled here that the next plan doesn't carry yet (a run that started before it was queued) is kept. */
const NATIVE_SNOOZE_GRACE_MS = 90_000;
/** A pending alarm of ours this close to its time is about to fire — a re-plan never cancels it. */
const IMMINENT_MS = 5_000;
/** A tap held back (no member signed in yet) older than this no longer navigates. */
const OPEN_MAX_AGE_MS = 2 * 60_000;
const NO_STATUS: AdapterStatus = { notifications: 'undetermined', canAskNotifications: false };

const doseRefId = (d: DoseRef) => `${d.medId}|${Date.parse(d.scheduledFor)}`;

// Foreground behaviour + the response subscription from the first import on (the member layout imports the engine
// at launch, so the tap / action that launched the app is seen); the action buttons are registered on every launch.
installNotificationHandling();
void ensureAlarmCategories();

/* ───────────────────────────── Serial queue ───────────────────────────── */

let chain: Promise<unknown> = Promise.resolve();

/** schedule / cancelAll / snooze never interleave (each reads the pending set, then changes it). */
function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.catch(() => undefined);
  return run;
}

/* ───────────────────────────── Scheduling ───────────────────────────── */

/** Schedule one notification at `at`. The photo is a nice-to-have: if the request fails with it, it goes without. */
async function addNotification(identifier: string, at: number, source: ContentSource, data: OrzaNotificationData, photo: string | null, sound: string): Promise<boolean> {
  let copy: AttachmentCopy | null = null;
  try {
    if (photo) copy = await copyForAttachment(photo, identifier);
    try {
      await Notifications.scheduleNotificationAsync({ identifier, content: buildContent(source, data, { sound, attachment: copy }), trigger: dateTrigger(at) });
      return true;
    } catch (e) {
      if (!copy) throw e;
      discardCopy(copy);
      copy = null;
      await Notifications.scheduleNotificationAsync({ identifier, content: buildContent(source, data, { sound }), trigger: dateTrigger(at) });
      return true;
    }
  } catch {
    return false;
  } finally {
    discardCopy(copy); // iOS moved it away if it took it; anything left is ours to delete
  }
}

/** Pending notifications the alarm engine owns: identifier → their data. */
async function pendingOurs(): Promise<Map<string, OrzaNotificationData | null>> {
  const out = new Map<string, OrzaNotificationData | null>();
  for (const r of await Notifications.getAllScheduledNotificationsAsync()) {
    if (isAlarmKey(r.identifier)) out.set(r.identifier, readOrzaData(r.content.data));
  }
  return out;
}

/** Snoozes this adapter scheduled itself: notification id → when. */
const nativeSnoozes = new Map<string, number>();

async function scheduleItems(items: AlarmPlanItem[]): Promise<ScheduleResult> {
  await ensureAlarmCategories();
  sweepAttachmentCopies();
  const sound = alarmSound();
  const now = Date.now();
  const wanted: AlarmPlanItem[] = [];
  const keys = new Set<string>();
  for (const item of [...items].sort((a, b) => a.at - b.at)) {
    if (wanted.length >= IOS_MAX_PENDING) break;
    if (!item?.key || keys.has(item.key) || !Number.isFinite(item.at)) continue;
    keys.add(item.key);
    // Due within MIN_LEAD_MS: too close to schedule again — the pending one (if any) is left to fire.
    if (item.at - now < MIN_LEAD_MS) continue;
    wanted.push(item);
  }
  // Snoozed doses the plan rings: a snooze this adapter scheduled for them is superseded (no double ring).
  const plannedSnoozes = new Set<string>();
  for (const item of wanted) for (const d of item.doses ?? []) if (d.snoozed) plannedSnoozes.add(doseRefId(d));

  const pending = await pendingOurs();
  for (const [id, data] of pending) {
    if (keys.has(id)) continue;
    // About to fire (the plan was computed a moment before its time): never cancel it at the last second.
    if (typeof data?.at === 'number' && data.at - now < IMMINENT_MS) continue;
    const madeAt = nativeSnoozes.get(id);
    const covered = !!data?.doses.length && data.doses.every((d) => plannedSnoozes.has(doseRefId(d)));
    if (madeAt !== undefined && now - madeAt < NATIVE_SNOOZE_GRACE_MS && !covered) continue;
    nativeSnoozes.delete(id);
    await Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined);
  }

  let scheduled = 0;
  let failed = 0;
  for (const item of wanted) {
    const sig = itemSignature(item, sound);
    if (pending.has(item.key) && pending.get(item.key)?.sig === sig) {
      scheduled++;
      continue;
    }
    if (await addNotification(item.key, item.at, item, notificationData(item, sig), attachablePhoto(item), sound)) {
      scheduled++;
      nativeSnoozes.delete(item.key); // the plan owns it now
    } else {
      failed++;
    }
  }
  if (failed && !scheduled) throw new Error("Couldn't set the alarms on this phone.");
  return { scheduled };
}

async function cancelEverything(): Promise<void> {
  nativeSnoozes.clear();
  for (const id of (await pendingOurs()).keys()) {
    await Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined);
  }
  // Shown ones too (sign-out: this account's medicine names must not stay on the lock screen).
  const shown = await Notifications.getPresentedNotificationsAsync().catch((): Notifications.Notification[] => []);
  for (const n of shown) {
    if (isAlarmKey(n.request.identifier)) await Notifications.dismissNotificationAsync(n.request.identifier).catch(() => undefined);
  }
  sweepAttachmentCopies();
}

/* ───────────────────────────── Actions ───────────────────────────── */

const actionListeners = new Set<AlarmActionListener>();
let stopResponses: (() => void) | null = null;
let stopPresenter: (() => void) | null = null;

/** True when a listener handled it (for `open`: the alarm is on screen). */
function emit(event: AlarmActionEvent): boolean {
  let handled = false;
  for (const listener of [...actionListeners]) {
    try {
      if (listener(event) === true) handled = true;
    } catch {
      // the other listeners still get it
    }
  }
  return handled;
}

function actionOf(identifier: string): DoseActionKind | null {
  if (identifier === ALARM_ACTION.take) return 'take';
  if (identifier === ALARM_ACTION.snooze) return 'snooze';
  if (identifier === ALARM_ACTION.skip) return 'skip';
  return null;
}

/**
 * Re-ring snoozed doses at `from + 10 min` under the key the next plan uses (one alarm per scheduled time). `partial`:
 * some doses of the alarm were left out (already handled) — its texts would name them, so neutral ones are used until
 * the next plan replaces the re-ring.
 */
function scheduleSnooze(data: OrzaNotificationData, content: Notifications.NotificationContent, from: number, partial = false): Promise<void> {
  return serial(async () => {
    const at = from + DEFAULT_SNOOZE_MINUTES * 60_000;
    if (at - Date.now() < MIN_LEAD_MS) return; // pressed long ago (held back): the engine drops such a snooze too
    await ensureAlarmCategories();
    const byTime = new Map<string, DoseRef[]>();
    for (const d of data.doses) byTime.set(d.scheduledFor, [...(byTime.get(d.scheduledFor) ?? []), d]);
    const body = content.body ?? '';
    const source = (doses: DoseRef[]): ContentSource =>
      partial
        ? {
            title: doses.length === 1 ? '💊 Time for your medicine' : `💊 Time for ${doses.length} medicines`,
            body: 'Snoozed dose',
            ring: true,
            doses,
          }
        : {
            title: content.title || '💊 Time for your medicine',
            body: /snoozed/i.test(body) ? body : body ? `${body} · snoozed` : 'Snoozed dose',
            ring: true,
            doses,
          };
    for (const [scheduledFor, doses] of byTime) {
      const key = snoozeAlarmKey(
        scheduledFor,
        doses.map((d) => d.medId)
      );
      // No `sig`: the next plan's version always replaces this one.
      const snoozeData: OrzaNotificationData = {
        orza: 1,
        key,
        kind: 'dose',
        ring: true,
        at,
        path: data.path,
        url: data.path,
        deepLink: data.deepLink,
        doses,
        ...(data.photo ? { photo: data.photo } : {}),
      };
      if (await addNotification(key, at, source(doses), snoozeData, data.photo ?? null, alarmSound())) nativeSnoozes.set(key, Date.now());
    }
  });
}

async function confirm(action: DoseActionKind, count: number): Promise<void> {
  try {
    const { toast } = await import('@/ui/Toast');
    const many = count > 1;
    if (count < 1) toast.info('Already handled — nothing to change');
    else if (action === 'take') toast.success(many ? `Marked ${count} medicines as taken` : 'Marked as taken');
    else if (action === 'skip') toast.info(many ? `Skipped ${count} medicines` : 'Dose skipped');
    else toast.info(`Snoozed — ringing again in ${DEFAULT_SNOOZE_MINUTES} minutes`);
  } catch {
    // no toast — the action still went through
  }
}

function handleResponse(response: Notifications.NotificationResponse, receivedAt: number): void {
  const request = response.notification.request;
  const content = request.content;
  const data = readOrzaData(content.data);

  if (response.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) {
    const path = data?.path ?? notificationPath(content.data);
    if (!path || Date.now() - receivedAt > OPEN_MAX_AGE_MS) return;
    emit({ key: data?.key ?? request.identifier, action: 'open', doses: data?.doses ?? [], path, at: receivedAt });
    return;
  }

  const action = actionOf(response.actionIdentifier);
  if (!action || !data?.doses.length) return;
  void Notifications.dismissNotificationAsync(request.identifier).catch(() => undefined);
  // Doses already taken / skipped (one medicine of the group taken in the app, …) are never snoozed or skipped again.
  const doses = openDoses(action, data.doses);
  if (doses.length) {
    if (action === 'snooze') {
      void scheduleSnooze({ ...data, doses }, content, receivedAt, doses.length < data.doses.length).catch(() => undefined);
    }
    emit({
      key: data.key,
      action,
      doses,
      ...(action === 'snooze' ? { snoozeMinutes: DEFAULT_SNOOZE_MINUTES } : {}),
      at: receivedAt,
    });
  }
  void confirm(action, doses.length);
}

let actionFilter: ActionDoseFilter | null = null;

function openDoses(action: DoseActionKind, doses: DoseRef[]): DoseRef[] {
  if (!actionFilter) return doses;
  try {
    return actionFilter(action, doses);
  } catch {
    return doses;
  }
}

/**
 * A ringing alarm fired while the app is open: the engine's listener opens the alarm screen. True (no banner, the
 * sound still plays) only when the listener says the alarm is on screen now; otherwise the banner shows.
 */
function presentInApp(data: OrzaNotificationData): boolean {
  // Dose alarms — and the "Test alarm" (no doses, `test:` key), which opens its demo alarm screen.
  if (!actionListeners.size || (!data.doses.length && !data.key.startsWith('test:'))) return false;
  return emit({ key: data.key, action: 'open', doses: data.doses, path: data.path, ringing: true, at: Date.now() });
}

/* ───────────────────────────── Adapter ───────────────────────────── */

export const alarmAdapter: PlatformAdapter = {
  name: 'ios',
  maxScheduled: IOS_MAX_PENDING,

  schedule: (items) => serial(() => scheduleItems(items)),

  // A dose snoozed in the app: its re-ring is set now (kept through a re-plan that doesn't carry it yet).
  snoozeNow: (item) =>
    serial(async () => {
      if (!item?.key || !Number.isFinite(item.at) || item.at - Date.now() < MIN_LEAD_MS) return;
      await ensureAlarmCategories();
      const sound = alarmSound();
      const sig = itemSignature(item, sound);
      if (await addNotification(item.key, item.at, item, notificationData(item, sig), attachablePhoto(item), sound)) {
        nativeSnoozes.set(item.key, Date.now());
      }
    }),

  cancelAll: () => serial(cancelEverything),

  dismiss: async (key) => {
    await Notifications.dismissNotificationAsync(key).catch(() => undefined);
  },

  // A delivered notification can't be changed on iOS; its actions are filtered instead (`setActionFilter`).
  refreshShowing: async () => undefined,

  // Rejects when the permission can't be read: the engine must not take that for "not allowed".
  status: async () => toAdapterStatus(await Notifications.getPermissionsAsync()),

  requestNotifications: async () => {
    try {
      await ensureAlarmCategories();
      const current = toAdapterStatus(await Notifications.getPermissionsAsync());
      if (current.notifications === 'granted' || !current.canAskNotifications) return current;
      return toAdapterStatus(await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } }));
    } catch {
      return { ...NO_STATUS };
    }
  },

  // iOS has one settings page per app (Notifications → Allow / Sounds / Time Sensitive live under it); deep links
  // into its sub-pages aren't public API.
  openSettings: async () => {
    await Linking.openSettings().catch(() => undefined);
  },

  // Every action opens the app, so JS always sees it through onAction.
  takeNativeActions: async () => [],

  setActionFilter: (filter) => {
    actionFilter = filter;
  },

  onAction: (listener) => {
    actionListeners.add(listener);
    if (!stopResponses) {
      stopResponses = subscribeNotificationResponses(handleResponse);
      stopPresenter = setInAppAlarmPresenter(presentInApp);
    }
    return () => {
      actionListeners.delete(listener);
      if (actionListeners.size) return;
      stopResponses?.();
      stopResponses = null;
      stopPresenter?.();
      stopPresenter = null;
    };
  },
};
