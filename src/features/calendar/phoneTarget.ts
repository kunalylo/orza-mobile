/**
 * Where "Add to my calendar" puts ÖRZA's events on an iPhone, how a re-sync changes them, and what the card says —
 * pure, so `npm run test:calendar` loads it in Node (`deviceCalendar.ts` makes the EventKit calls).
 *
 * Why (TestFlight build 3, a real iPhone: "Couldn't create the ÖRZA calendar…"): iOS adds a calendar only to an
 * account ("source") that allows it. Build 3 tried the default calendar's account, then the local "On My iPhone"
 * source, then "let iOS pick" (expo-calendar then uses the default calendar's account again). When the default
 * calendar is in a Google / Outlook / Yahoo / Exchange account (common in India) every try fails: those accounts don't
 * let apps add calendars, and iOS hides the local source while iCloud Calendars is on. The iCloud account, which does
 * allow it, was never tried. And with no ÖRZA calendar there was no way to add anything.
 *
 * Now (iPhone; Android is unchanged):
 * - Full access: the ÖRZA calendar goes into iCloud → On My iPhone → the default calendar's account → any other
 *   account with a calendar ÖRZA may change (never subscribed / birthdays / read-only ones) (`iosSourceOrder`).
 * - When no account takes it, or access is "Add Events Only" (iOS 17+ write-only: no new calendars, no reading), the
 *   events go into the member's DEFAULT calendar ("default" mode, `decideTarget`). They are tracked only by the sync
 *   map (event ids): updates and Remove touch exactly ÖRZA's events and nothing else.
 * - "Add Events Only" can't read, change or delete any event (expo-calendar's `ExpoCalendarEvent.get / update /
 *   delete` need full access, and so does EventKit). So a re-sync only ADDS events it never added (`planSync`):
 *   changed or stopped ones stay as they are and are counted as out of date ("stuck") until full access lets ÖRZA fix
 *   them; nothing is ever written twice. Without the map ÖRZA can't know what is already there, so it adds nothing.
 */

/* ───────────────────────────── Access ───────────────────────────── */

/** Calendar access: `writeOnly` is iOS 17+ "Add Events Only". */
export type PhoneAccess = 'full' | 'writeOnly';
export type PhonePermission = 'granted' | 'writeOnly' | 'undetermined' | 'denied' | 'blocked';

export interface PermissionLike {
  granted: boolean;
  status: string;
  canAskAgain: boolean;
}

/**
 * The member's calendar permission from expo-calendar's two checks: full access (`getCalendarPermissions()`, which
 * reports "Add Events Only" as denied for good) and write-only (`getCalendarPermissions(true)`, granted for both).
 */
export function phonePermissionFrom(full: PermissionLike, writeOnlyGranted: boolean): PhonePermission {
  if (full.granted) return 'granted';
  if (writeOnlyGranted) return 'writeOnly';
  if (full.status === 'undetermined') return 'undetermined';
  return full.canAskAgain ? 'denied' : 'blocked';
}

/** What a sync may do with this permission (`null`: nothing). */
export function accessFor(permission: PhonePermission): PhoneAccess | null {
  return permission === 'granted' ? 'full' : permission === 'writeOnly' ? 'writeOnly' : null;
}

/* ───────────────────────────── Where the ÖRZA calendar goes ───────────────────────────── */

export interface SourceInfo {
  id: string;
  /** expo-calendar `SourceType`: local, caldav, exchange, mobileme, subscribed, birthdays. */
  type: string;
  name: string;
}

export interface CalendarSourceInfo {
  sourceId?: string | null;
  allowsModifications: boolean;
}

const SKIPPED_SOURCE_TYPES = new Set(['subscribed', 'birthdays']);

export function isICloudSource(s: SourceInfo): boolean {
  return s.type === 'caldav' && s.name.trim().toLowerCase() === 'icloud';
}

/**
 * The accounts to try, in order, for the ÖRZA calendar on an iPhone: iCloud, On My iPhone (local), the default
 * calendar's account, then every other account that has a calendar ÖRZA may change. Subscribed and birthday sources
 * never take a calendar. Each account once.
 */
export function iosSourceOrder(sources: SourceInfo[], calendars: CalendarSourceInfo[], defaultSourceId?: string | null): SourceInfo[] {
  const usable = sources.filter((s) => !!s && typeof s.id === 'string' && s.id !== '' && !SKIPPED_SOURCE_TYPES.has(s.type));
  const out: SourceInfo[] = [];
  const add = (s: SourceInfo) => {
    if (!out.some((o) => o.id === s.id)) out.push(s);
  };
  usable.filter(isICloudSource).forEach(add);
  usable.filter((s) => s.type === 'local').forEach(add);
  if (defaultSourceId) {
    const known = sources.find((s) => s?.id === defaultSourceId);
    if (!known) add({ id: defaultSourceId, type: 'unknown', name: 'default calendar' });
    else if (!SKIPPED_SOURCE_TYPES.has(known.type)) add(known);
  }
  const writable = new Set(calendars.filter((c) => c.allowsModifications && c.sourceId).map((c) => c.sourceId as string));
  usable.filter((s) => writable.has(s.id)).forEach(add);
  return out;
}

/** One failed `createCalendar` try, for the single diagnostic line in development logs (never shown to members). */
export interface CreateAttempt {
  source: string;
  error: string;
}

export function sourceLabel(s: SourceInfo): string {
  return `${s.name || 'unnamed'} (${s.type})`;
}

export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message || e.name;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e) ?? String(e);
  } catch {
    return String(e);
  }
}

export function describeAttempts(attempts: CreateAttempt[]): string {
  if (!attempts.length) return "couldn't create the ÖRZA calendar: no calendar account to try";
  return `couldn't create the ÖRZA calendar: ${attempts.map((a) => `${a.source}: ${a.error}`).join(' | ')}`;
}

/* ───────────────────────────── Own calendar or the default one ───────────────────────────── */

/**
 * The link's `calendarId` when the events are in the member's default calendar: never a real calendar id, so nothing
 * (not even an older build) can take it for ÖRZA's own calendar and delete the member's calendar.
 */
export const DEFAULT_CALENDAR_KEY = 'orza:default-calendar';

export type TargetMode = 'own' | 'default';

export function linkMode(link: { calendarId: string }): TargetMode {
  return link.calendarId === DEFAULT_CALENDAR_KEY ? 'default' : 'own';
}

/**
 * Where a sync writes:
 * - `default`: the member's default calendar — the phone already holds ÖRZA's events there (from any account: it
 *   stays there until Remove), or access is "Add Events Only".
 * - `own`: the ÖRZA calendar — the linked one, one found by its title, or a new one (`iosSourceOrder`); on an iPhone
 *   `afterCreateFailed` decides what happens when no account takes it.
 * - `ownNeedsFullAccess`: this account's ÖRZA calendar is on the phone, but "Add Events Only" can't change it, and
 *   adding the events to the default calendar too would show every dose twice.
 *
 * `stored`: the link on this phone (`mine`: added by the signed-in account).
 */
export function decideTarget(access: PhoneAccess, stored: { mode: TargetMode; mine: boolean } | null): 'own' | 'default' | 'ownNeedsFullAccess' {
  if (stored?.mode === 'default') return 'default';
  if (access === 'writeOnly') return stored?.mode === 'own' && stored.mine ? 'ownNeedsFullAccess' : 'default';
  return 'own';
}

/** No account took the ÖRZA calendar: an iPhone falls back to the default calendar when it has one. */
export function afterCreateFailed(platform: 'ios' | 'android', defaultCalendarAvailable: boolean): 'default' | 'fail' {
  return platform === 'ios' && defaultCalendarAvailable ? 'default' : 'fail';
}

/* ───────────────────────────── Re-sync ───────────────────────────── */

export interface SyncedEvent {
  id: string;
  sig: string;
  start: string;
}

export interface WantedEvent {
  key: string;
  sig: string;
  start: string;
}

export interface SyncPlan {
  /** Carried over unchanged (the same, or out of date but not changeable, or history in the default calendar). */
  keep: Record<string, SyncedEvent>;
  /** Changed: update the event in place (full access only). */
  update: { key: string; have: SyncedEvent }[];
  /** Never added: create (the only write "Add Events Only" allows). */
  create: string[];
  /** Upcoming events ÖRZA no longer has: delete by id (full access only). */
  remove: SyncedEvent[];
  /** "Add Events Only": upcoming events in the calendar that are out of date and ÖRZA can't change or delete. */
  stuck: number;
}

/** Past events kept in the default calendar's map, so Remove deletes them too (the own calendar is deleted whole). */
export const DEFAULT_HISTORY_MS = 31 * 24 * 60 * 60 * 1000;

/**
 * The diff between what the phone has (`known`, from the sync map) and what ÖRZA wants now. A key in the map is never
 * created again, so nothing is written twice. `canEdit` false ("Add Events Only"): nothing is updated or deleted —
 * changed and stopped upcoming events stay in the map (still the phone's events) and count as `stuck`; when full
 * access comes back the next sync updates or deletes them. Past events: dropped from the map (they stay in the
 * calendar as history), or kept for `historyMs` (the default calendar) so Remove can delete them.
 */
export function planSync(input: {
  known: Record<string, SyncedEvent>;
  wanted: WantedEvent[];
  now: number;
  canEdit: boolean;
  historyMs: number;
}): SyncPlan {
  const { known, wanted, now, canEdit, historyMs } = input;
  const plan: SyncPlan = { keep: {}, update: [], create: [], remove: [], stuck: 0 };
  const wantedKeys = new Set(wanted.map((w) => w.key));

  for (const [key, ev] of Object.entries(known)) {
    if (wantedKeys.has(key)) continue;
    const start = Date.parse(ev.start);
    if (start > now) {
      if (canEdit) plan.remove.push(ev);
      else {
        plan.keep[key] = ev;
        plan.stuck += 1;
      }
    } else if (historyMs > 0 && now - start <= historyMs) {
      plan.keep[key] = ev;
    }
  }

  const seen = new Set<string>();
  for (const w of wanted) {
    if (seen.has(w.key)) continue; // the same event twice in the source
    seen.add(w.key);
    const have = Object.prototype.hasOwnProperty.call(known, w.key) ? known[w.key] : undefined;
    if (!have) plan.create.push(w.key);
    else if (have.sig === w.sig) plan.keep[w.key] = have;
    else if (canEdit) plan.update.push({ key: w.key, have });
    else {
      plan.keep[w.key] = have;
      if (Date.parse(have.start) > now) plan.stuck += 1;
    }
  }
  return plan;
}

/** ÖRZA's upcoming events in a map (the card's count; history left out). */
export function upcomingCount(events: Record<string, SyncedEvent>, now: number): number {
  return Object.values(events).filter((e) => Date.parse(e.start) > now).length;
}

/**
 * An event ÖRZA wrote on an iPhone: every one carries an `orza://` link (a dose, or the reminders screen). Used only
 * with full access when the sync map is gone, to find ÖRZA's own events in the default calendar and nothing else.
 */
export function isOrzaEventUrl(url: string | null | undefined): boolean {
  return typeof url === 'string' && /^orza:\/\//i.test(url.trim());
}

/* ───────────────────────────── Copy ───────────────────────────── */

const FULL_ACCESS_STEP = 'tap Open Settings, then Calendars › Full Access';

export const PHONE_CALENDAR_COPY = {
  /** iPhone: no account took the ÖRZA calendar and there is no default calendar either. */
  noCalendarIos:
    'Your iPhone has no calendar ÖRZA can add events to. Choose a default calendar in Settings › Apps › Calendar › Default Calendar (Settings › Calendar on iOS 17), then try again.',
  /** Android: unchanged. */
  createFailedAndroid: "Couldn't create the ÖRZA calendar on this phone. Please try again.",
  /** "Add Events Only" with this account's ÖRZA calendar on the phone: a sync can't change it. */
  ownNeedsFullAccess: `Calendar access for ÖRZA is “Add Events Only”, so ÖRZA can't update its calendar. To keep it up to date, ${FULL_ACCESS_STEP}.`,
  /** "Add Events Only" without the sync map: what's already in the calendar is unknown, so nothing is added. */
  writeOnlyUnknownEvents: `ÖRZA can't see the events it already added to your calendar, so it won't add them again (they could show twice). To fix it, ${FULL_ACCESS_STEP}, then tap Sync now.`,
  /** Card, not added yet, "Add Events Only". */
  writeOnlyBeforeAdd: `Calendar access for ÖRZA is “Add Events Only”, so the events go into your default calendar and ÖRZA can't change or remove them later. For events ÖRZA keeps up to date, ${FULL_ACCESS_STEP}.`,
  /** Card, added to the default calendar, "Add Events Only". */
  writeOnlyLinked: `Calendar access for ÖRZA is “Add Events Only”: ÖRZA adds new events to your default calendar but can't change or remove the ones it added. For events ÖRZA keeps up to date, ${FULL_ACCESS_STEP}.`,
  /** Card, added to the default calendar (no account took an ÖRZA calendar). */
  defaultCalendarNote: (title?: string | null) =>
    `Your iPhone didn't let ÖRZA add a calendar of its own, so the events are in your default calendar${title ? `, “${title}”` : ''}. Remove deletes only ÖRZA's events.`,
  /** Card, "Add Events Only": events in the calendar ÖRZA can't fix. */
  stuck: (n: number) =>
    `${n} of ÖRZA's events in your calendar ${n === 1 ? 'is' : 'are'} out of date (a dose or reminder changed or stopped).`,
  /** Toast after the first add to the default calendar. */
  addedToDefault: (n: number) => `Added ${n} event${n === 1 ? '' : 's'} to your default calendar.`,
  /** Remove, events in the default calendar: the confirmation, its button, the toast. */
  removeDefaultConfirm:
    "Remove ÖRZA's events from your calendar? Your own events, and your medicines and reminders in ÖRZA, stay as they are.",
  removeDefaultConfirmLabel: 'Remove events',
  removedFromDefault: "Removed ÖRZA's events from your calendar.",
  /** Remove without full access: ÖRZA's own calendar. */
  removeOwnNeedsAccess: 'Allow calendar access for ÖRZA in Settings to remove its calendar, or delete the ÖRZA calendar in your Calendar app.',
  removeOwnNeedsFullAccess: `ÖRZA needs Full Access to remove its calendar: ${FULL_ACCESS_STEP}, and tap Remove again. Or delete the ÖRZA calendar in your Calendar app.`,
  /** Remove without full access: events in the default calendar. */
  removeDefaultNeedsFullAccess: `ÖRZA needs Full Access to remove the events it added: ${FULL_ACCESS_STEP}, and tap Remove again. Or delete them in your Calendar app.`,
} as const;

/** Why Remove can't run without full access, for where the events are. */
export function removeBlockedMessage(mode: TargetMode, permission: PhonePermission): string {
  if (mode === 'default') return PHONE_CALENDAR_COPY.removeDefaultNeedsFullAccess;
  return permission === 'writeOnly' ? PHONE_CALENDAR_COPY.removeOwnNeedsFullAccess : PHONE_CALENDAR_COPY.removeOwnNeedsAccess;
}
