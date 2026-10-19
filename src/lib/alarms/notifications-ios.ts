/**
 * iOS notification helpers for the alarm adapter (`adapter.ios.ts`): action categories, the alarm sound, notification
 * content (time-sensitive doses with the medicine photo attached), photo attachment copies, and permission mapping.
 *
 * Verified in expo-notifications 57.0.23 (build/*.d.ts + ios/*.swift — see docs/notes/C3-ios.md):
 * - a DATE trigger becomes `UNTimeIntervalNotificationTrigger(floor(ts / 1000) − now)`: an interval ≤ 0 throws, so
 *   nothing closer than `MIN_LEAD_MS` is scheduled; pending requests report the interval, not the instant, so `at`
 *   and a content signature travel in `data`;
 * - attachments are built with `try? UNNotificationAttachment(...)` while the request is made, and iOS MOVES the file
 *   into its own store — every notification gets its own temporary copy of the cached photo;
 * - a custom sound that isn't in the app bundle logs an error on every schedule — the bundled file is checked once;
 * - category action option `opensAppToForeground` is applied only when it is literally `true`.
 */
import { Directory, File, Paths } from 'expo-file-system';
import * as Notifications from 'expo-notifications';

import { ALARM_ACTION, ALARM_CATEGORY, type OrzaNotificationData } from '@/lib/notifications';

import type { AdapterStatus } from './adapter';
import { DEFAULT_SNOOZE_MINUTES } from './plan';
import type { AlarmPlanItem } from './types';

/** iOS keeps 64 pending local notifications; 4 stay free for Snoozes pressed before the next re-plan. */
export const IOS_MAX_PENDING = 60;
/** Don't schedule anything due sooner than this (the interval trigger must be > 0 after rounding down to seconds). */
export const MIN_LEAD_MS = 2_000;
/** Bundled by the expo-notifications config plugin (`sounds` in app.json); ≤ 30 s or iOS plays the default sound. */
export const ALARM_SOUND_FILE = 'orza_alarm.wav';

const KEY_RE = /^(dose|snooze|reminder|refill):/;
/** Notification identifiers the alarm engine owns (= plan keys). */
export const isAlarmKey = (id: string) => KEY_RE.test(id);

/* ───────────────────────────── Categories ───────────────────────────── */

let categories: Promise<void> | null = null;

async function registerCategories(): Promise<void> {
  const snooze = `Snooze ${DEFAULT_SNOOZE_MINUTES} min`;
  // Every action opens the app: with the app killed, iOS never hands a background action to JS (docs:
  // "If `false` and your app is killed … listeners will not be triggered"), and the native side completes the
  // response at once — a Take or Snooze would be silently lost. Opening the app makes all three reliable.
  const opens = { opensAppToForeground: true } as const;
  const options: Notifications.NotificationCategoryOptions = { previewPlaceholder: 'Medicine reminder' };
  await Notifications.setNotificationCategoryAsync(
    ALARM_CATEGORY.single,
    [
      { identifier: ALARM_ACTION.take, buttonTitle: 'Take', options: opens },
      { identifier: ALARM_ACTION.snooze, buttonTitle: snooze, options: opens },
      { identifier: ALARM_ACTION.skip, buttonTitle: 'Skip', options: { ...opens, isDestructive: true } },
    ],
    options
  );
  await Notifications.setNotificationCategoryAsync(
    ALARM_CATEGORY.group,
    [
      { identifier: ALARM_ACTION.take, buttonTitle: 'Take all', options: opens },
      { identifier: ALARM_ACTION.snooze, buttonTitle: `${snooze} (all)`, options: opens },
      { identifier: ALARM_ACTION.skip, buttonTitle: 'Skip all', options: { ...opens, isDestructive: true } },
    ],
    options
  );
}

/** Register the Take / Snooze / Skip categories once per launch (retried on the next call after a failure). */
export function ensureAlarmCategories(): Promise<void> {
  categories ??= registerCategories().catch(() => {
    categories = null;
  });
  return categories;
}

/* ───────────────────────────── Sound ───────────────────────────── */

let bundledSound: boolean | null = null;

/** `orza_alarm.wav` once the app bundle carries it, else the default sound. */
export function alarmSound(): string {
  if (bundledSound === null) {
    try {
      bundledSound = new File(Paths.bundle, ALARM_SOUND_FILE).exists;
    } catch {
      bundledSound = false;
    }
  }
  return bundledSound ? ALARM_SOUND_FILE : 'default';
}

/* ───────────────────────────── Attachments ───────────────────────────── */

const ATTACH_DIR = 'orza-alarm-attach';
const IMAGE_TYPES: Record<string, string> = { jpg: 'public.jpeg', jpeg: 'public.jpeg', png: 'public.png', gif: 'com.compuserve.gif' };
let copySeq = 0;

function attachDir(): Directory | null {
  try {
    const dir = new Directory(Paths.cache, ATTACH_DIR);
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    return dir;
  } catch {
    return null;
  }
}

const extOf = (uri: string) => /\.([a-z0-9]+)$/i.exec(uri.split(/[?#]/)[0])?.[1]?.toLowerCase() ?? '';

/** The first local photo of the item iOS can attach (JPEG / PNG / GIF — photos.ts normalises to JPEG). */
export function attachablePhoto(item: Pick<AlarmPlanItem, 'photos'>): string | null {
  for (const uri of item.photos ?? []) {
    if (typeof uri === 'string' && uri.startsWith('file:') && IMAGE_TYPES[extOf(uri)]) return uri;
  }
  return null;
}

/** photos.ts's cache folder (`Documents/orza-alarm-photos`). */
const PHOTO_DIR = 'orza-alarm-photos';

/**
 * The cached photo behind a URI — also when the URI was stored before an app update (iOS moves the app's container,
 * so an old absolute path in a pending notification's data no longer exists; the file is found by name instead).
 */
function locatePhoto(uri: string): File | null {
  try {
    const file = new File(uri);
    if (file.exists) return file;
    const name = uri.split(/[?#]/)[0].split('/').pop();
    if (!name) return null;
    const moved = new File(Paths.document, PHOTO_DIR, decodeURIComponent(name));
    return moved.exists ? moved : null;
  } catch {
    return null;
  }
}

export interface AttachmentCopy {
  file: File;
  attachment: Notifications.NotificationContentAttachmentIos;
}

/** A fresh copy of a cached photo for one notification (iOS moves it away). Null when the photo isn't there. */
export async function copyForAttachment(photoUri: string, key: string): Promise<AttachmentCopy | null> {
  const ext = extOf(photoUri);
  const typeHint = IMAGE_TYPES[ext];
  const dir = typeHint ? attachDir() : null;
  if (!dir) return null;
  try {
    const source = locatePhoto(photoUri);
    if (!source) return null;
    copySeq = (copySeq + 1) % 1_000_000;
    const safeKey = key.replace(/[^A-Za-z0-9_-]+/g, '_').slice(-80);
    const copy = new File(dir, `${Date.now().toString(36)}-${copySeq}-${safeKey}.${ext}`);
    await source.copy(copy, { overwrite: true });
    if (!copy.exists) return null;
    return { file: copy, attachment: { identifier: 'photo', url: copy.uri, type: null, typeHint } };
  } catch {
    return null;
  }
}

/** Delete a copy iOS didn't take (the request failed, or the attachment was rejected). */
export function discardCopy(copy: AttachmentCopy | null): void {
  if (!copy) return;
  try {
    if (copy.file.exists) copy.file.delete();
  } catch {
    // ignore
  }
}

/** Remove copies left behind by an interrupted run (anything still in the folder was never handed to iOS). */
export function sweepAttachmentCopies(): void {
  try {
    const dir = new Directory(Paths.cache, ATTACH_DIR);
    if (!dir.exists) return;
    for (const entry of dir.list()) {
      try {
        entry.delete();
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
}

/* ───────────────────────────── Content ───────────────────────────── */

function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** What a notification shows (a plan item, or a Snooze rebuilt from the notification it was pressed on). */
export interface ContentSource {
  title: string;
  body: string;
  ring: boolean;
  doses?: readonly unknown[];
}

const categoryOf = (item: Pick<ContentSource, 'ring' | 'doses'>): string | undefined =>
  item.ring && item.doses?.length ? (item.doses.length > 1 ? ALARM_CATEGORY.group : ALARM_CATEGORY.single) : undefined;

/** Everything that shows: a pending notification with the same signature is left alone. */
export function itemSignature(item: AlarmPlanItem, sound: string): string {
  return hash(
    JSON.stringify([
      2, // bump to re-add every notification after a content-format change
      item.at,
      item.kind,
      item.ring,
      item.title,
      item.body,
      item.path,
      sound,
      categoryOf(item) ?? '',
      attachablePhoto(item) ?? '',
      (item.doses ?? []).map((d) => [d.medId, d.scheduledFor]),
    ])
  );
}

export function notificationData(item: AlarmPlanItem, sig: string): OrzaNotificationData {
  const photo = attachablePhoto(item);
  return {
    orza: 1,
    key: item.key,
    kind: item.kind,
    ring: item.ring,
    at: item.at,
    sig,
    path: item.path,
    url: item.path,
    deepLink: item.deepLink,
    doses: (item.doses ?? []).map((d) => ({ medId: d.medId, scheduledFor: d.scheduledFor })),
    ...(photo ? { photo } : {}),
  };
}

/**
 * Doses and snoozes: time-sensitive (breaks through Focus / notification summary when the member allows it), the
 * alarm sound, Take / Snooze / Skip. Reminders and refill alerts: an ordinary notification with the default sound.
 */
export function buildContent(
  item: ContentSource,
  data: OrzaNotificationData,
  opts: { sound: string; attachment?: AttachmentCopy | null }
): Notifications.NotificationContentInput {
  const category = categoryOf(item);
  return {
    title: item.title,
    body: item.body,
    // Only plist-safe values (no undefined / null): iOS stores `data` as the request's userInfo.
    data: { ...data },
    sound: item.ring ? opts.sound : 'default',
    interruptionLevel: item.ring ? 'timeSensitive' : 'active',
    ...(category ? { categoryIdentifier: category } : {}),
    ...(opts.attachment ? { attachments: [opts.attachment.attachment] } : {}),
  };
}

export function dateTrigger(at: number): Notifications.DateTriggerInput {
  return { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at };
}

/* ───────────────────────────── Permission ───────────────────────────── */

/**
 * Alarms need full authorisation: provisional / ephemeral delivery is silent (Notification Center only), so it counts
 * as "not yet" (the system prompt can still upgrade it). Authorised with every way of showing switched off counts as
 * denied. Authorised with no sound, no banner and no lock screen — Notification Center only — is `silenced`: alarms
 * arrive unnoticed, so the phone must not claim to ring them. The time-sensitive switch isn't readable through
 * expo-notifications (`fullScreen` stays undefined).
 */
export function toAdapterStatus(p: Notifications.NotificationPermissionsStatus): AdapterStatus {
  const ios = p.ios;
  const s = ios?.status;
  const { AUTHORIZED, DENIED } = Notifications.IosAuthorizationStatus;
  if (s === AUTHORIZED || (s === undefined && p.granted)) {
    const unnoticed = !!ios && ios.allowsAlert === false && ios.allowsSound === false && ios.allowsDisplayOnLockScreen === false;
    const nothingShows = unnoticed && ios.allowsDisplayInNotificationCenter === false;
    if (nothingShows) return { notifications: 'denied', canAskNotifications: false };
    return { notifications: 'granted', canAskNotifications: false, ...(unnoticed ? { silenced: true } : {}) };
  }
  if (s === DENIED || (s === undefined && p.status === Notifications.PermissionStatus.DENIED)) {
    return { notifications: 'denied', canAskNotifications: false };
  }
  return { notifications: 'undetermined', canAskNotifications: p.canAskAgain !== false };
}
