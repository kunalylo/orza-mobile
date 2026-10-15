/**
 * Notification plumbing shared by the whole app (iOS + Android, expo-notifications):
 *
 * - **Foreground behaviour** (`installNotificationHandling`, idempotent): a notification arriving while the app is open
 *   shows as a banner with sound — except a ringing medicine alarm while a member's alarm engine is listening: then
 *   the alarm screen opens instead (the sound still plays and it stays in Notification Center / the shade).
 * - **Taps and action buttons**: ONE response subscription for the app — live responses plus the one that launched it
 *   (`getLastNotificationResponse`, read once at install and on every return to the foreground), de-duplicated, held
 *   back until somebody subscribes (`subscribeNotificationResponses`), then cleared natively so it isn't handled twice.
 * - **Routes**: `notificationPath(data)` turns a notification's `path` / `url` / `orza://` link into an in-app route.
 *
 * Android: native alarm channels, the full-screen alarm and its buttons belong to C2's module (`modules/orza-alarms`);
 * anything Android shows through expo-notifications still gets the foreground behaviour and routing from here once
 * `installNotificationHandling()` runs (the iOS adapter calls it; the app root should call it too).
 */
import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';

/** Action button ids on alarm notifications (iOS categories; shared so any platform maps them the same way). */
export const ALARM_ACTION = {
  take: 'orza.take',
  snooze: 'orza.snooze',
  skip: 'orza.skip',
} as const;

/** iOS category ids (no ":" or "-" — the docs warn categories may not work otherwise). */
export const ALARM_CATEGORY = {
  /** One medicine: Take / Snooze 10 min / Skip. */
  single: 'orzadose',
  /** Several medicines due together: Take all / Snooze all / Skip all. */
  group: 'orzadoses',
} as const;

export type OrzaNotificationKind = 'dose' | 'reminder' | 'refill';

/** `content.data` of every notification the alarm engine schedules. */
export interface OrzaNotificationData {
  orza: 1;
  /** Plan key = notification identifier (`dose:<iso>`, `snooze:…`, `reminder:…`, `refill:…`). */
  key: string;
  kind: OrzaNotificationKind;
  /** Alarm-style (doses, snoozes). */
  ring: boolean;
  /** Epoch ms it is due. */
  at: number;
  /** Content signature — an unchanged pending notification isn't re-added. */
  sig?: string;
  /** In-app route (`/alarm?at=…&med=…`, `/meals`, …). */
  path: string;
  /** Same as `path` (the docs' convention for routing a tapped notification). */
  url: string;
  /** `orza://…` form of `path`. */
  deepLink: string;
  /** Doses the alarm covers (dose / snooze alarms). */
  doses: { medId: string; scheduledFor: string }[];
  /** Local cached photo (`file://…/orza-alarm-photos/<id>.jpg`) — re-attached to a snooze. */
  photo?: string;
}

const KINDS: readonly string[] = ['dose', 'reminder', 'refill'];

/** The alarm engine's data on a notification, or null for anything else. */
export function readOrzaData(data: unknown): OrzaNotificationData | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.orza !== 1 || typeof d.key !== 'string' || !d.key || typeof d.kind !== 'string' || !KINDS.includes(d.kind)) return null;
  const path = notificationPath(d) ?? '/';
  const doses = Array.isArray(d.doses)
    ? d.doses.flatMap((x): { medId: string; scheduledFor: string }[] => {
        if (!x || typeof x !== 'object') return [];
        const { medId, scheduledFor } = x as Record<string, unknown>;
        return typeof medId === 'string' && medId && typeof scheduledFor === 'string' && scheduledFor ? [{ medId, scheduledFor }] : [];
      })
    : [];
  const at = typeof d.at === 'number' ? d.at : Number(d.at);
  return {
    orza: 1,
    key: d.key,
    kind: d.kind as OrzaNotificationKind,
    ring: d.ring === true,
    at: Number.isFinite(at) ? at : 0,
    ...(typeof d.sig === 'string' ? { sig: d.sig } : {}),
    path,
    url: path,
    deepLink: typeof d.deepLink === 'string' ? d.deepLink : `orza://${path.replace(/^\/+/, '')}`,
    doses,
    ...(typeof d.photo === 'string' && d.photo ? { photo: d.photo } : {}),
  };
}

/** `/x` (not `//x`) stays; `orza://x` → `/x`; anything else (web links, junk) → null. */
function toInAppPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v || v.length > 2048) return null;
  if (/^orza:\/\//i.test(v)) {
    const rest = v.replace(/^orza:\/\/+/i, '');
    return rest ? `/${rest}` : '/';
  }
  return /^\/(?!\/)/.test(v) ? v : null;
}

/** The in-app route a notification opens: `data.path`, else `data.url`, else `data.deepLink`. */
export function notificationPath(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  return toInAppPath(d.path) ?? toInAppPath(d.url) ?? toInAppPath(d.deepLink);
}

/* ───────────────────────────── Foreground ───────────────────────────── */

/**
 * Shows a ringing alarm in the app (opens the alarm screen). Returns true when it did — the banner is then left out.
 * Set by the alarm adapter while the member's alarm engine listens.
 */
export type InAppAlarmPresenter = (data: OrzaNotificationData, notification: Notifications.Notification) => boolean;

let presenter: InAppAlarmPresenter | null = null;

/** Register the in-app alarm presenter (one at a time). Returns the function that removes it. */
export function setInAppAlarmPresenter(fn: InAppAlarmPresenter): () => void {
  presenter = fn;
  return () => {
    if (presenter === fn) presenter = null;
  };
}

const SHOW: Notifications.NotificationBehavior = {
  shouldShowBanner: true,
  shouldShowList: true,
  shouldPlaySound: true,
  shouldSetBadge: false,
};

const PRESENTED_IN_APP: Notifications.NotificationBehavior = {
  shouldShowBanner: false,
  shouldShowList: true,
  shouldPlaySound: true,
  shouldSetBadge: false,
};

async function handleNotification(notification: Notifications.Notification): Promise<Notifications.NotificationBehavior> {
  const data = readOrzaData(notification.request.content.data);
  if (data?.ring && presenter && AppState.currentState === 'active') {
    let shown = false;
    try {
      shown = presenter(data, notification);
    } catch {
      shown = false;
    }
    if (shown) return PRESENTED_IN_APP;
  }
  return SHOW;
}

/* ───────────────────────────── Responses ───────────────────────────── */

export type NotificationResponseListener = (response: Notifications.NotificationResponse, receivedAt: number) => void;

const listeners = new Set<NotificationResponseListener>();
/** Responses not handed out yet (nobody listening — cold start before sign-in finished — or the next tick). */
const backlog: { response: Notifications.NotificationResponse; receivedAt: number }[] = [];
const MAX_BACKLOG = 20;
/** Ids of responses already taken in (live listener and `getLastNotificationResponse` report the same one). */
const seen: string[] = [];
const MAX_SEEN = 100;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

const responseId = (r: Notifications.NotificationResponse) =>
  `${r.notification.request.identifier}|${r.actionIdentifier}|${r.notification.date}`;

function clearLast(): void {
  try {
    Notifications.clearLastNotificationResponse();
  } catch {
    // not available on this platform
  }
}

function dispatch(response: Notifications.NotificationResponse, receivedAt: number): void {
  for (const listener of [...listeners]) {
    try {
      listener(response, receivedAt);
    } catch {
      // one listener's failure must not hide the response from the others
    }
  }
}

function takeIn(response: Notifications.NotificationResponse | null | undefined): void {
  if (!response?.notification?.request) return;
  const id = responseId(response);
  if (seen.includes(id)) return;
  seen.push(id);
  if (seen.length > MAX_SEEN) seen.splice(0, seen.length - MAX_SEEN);
  backlog.push({ response, receivedAt: Date.now() });
  if (backlog.length > MAX_BACKLOG) backlog.splice(0, backlog.length - MAX_BACKLOG);
  scheduleBacklogFlush();
}

function checkLastResponse(): void {
  try {
    takeIn(Notifications.getLastNotificationResponse());
  } catch {
    // not available on this platform
  }
}

/** Hand queued responses to the subscribers on the next tick (never inside a render / effect, so navigation is ready). */
function scheduleBacklogFlush(): void {
  if (flushTimer || !backlog.length || !listeners.size) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    if (!listeners.size || !backlog.length) return;
    const items = backlog.splice(0);
    clearLast();
    for (const { response, receivedAt } of items) dispatch(response, receivedAt);
  }, 0);
}

/**
 * Taps and action-button presses on notifications — live ones, the one that launched the app, and any that came in
 * before the first subscriber (handed over on the next tick). Returns the unsubscribe function.
 */
export function subscribeNotificationResponses(listener: NotificationResponseListener): () => void {
  installNotificationHandling();
  listeners.add(listener);
  checkLastResponse();
  scheduleBacklogFlush();
  return () => {
    listeners.delete(listener);
  };
}

/* ───────────────────────────── Install ───────────────────────────── */

let installed = false;

/**
 * Set the foreground handler and start listening for responses. Idempotent; safe to call at module scope and from a
 * headless (background-task) launch. No-op on web.
 */
export function installNotificationHandling(): void {
  if (installed || (Platform.OS !== 'ios' && Platform.OS !== 'android')) return;
  installed = true;
  try {
    Notifications.setNotificationHandler({ handleNotification });
  } catch {
    // module unavailable (should not happen in a dev / release build)
  }
  try {
    // Listener first, then the stored response: one arriving in between is caught by one of them (and de-duplicated).
    Notifications.addNotificationResponseReceivedListener((response) => takeIn(response));
    checkLastResponse();
    AppState.addEventListener('change', (state) => {
      if (state === 'active') checkLastResponse();
    });
  } catch {
    // ignore
  }
}
