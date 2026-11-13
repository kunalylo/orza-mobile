/**
 * "Add ÖRZA to my phone calendar" — writes the next 14 days of medicine doses (and reminders with Calendar switched on)
 * into the phone's calendar, each event with an alert at its time, using the expo-calendar v57 object API
 * (`createCalendar`, `ExpoCalendar`, `ExpoCalendarEvent`).
 *
 * - iOS, full access: a dedicated "ÖRZA" calendar in the first account that takes it — iCloud, On My iPhone (only
 *   without iCloud Calendars, which hides it), the default calendar's account, then any other account with a calendar
 *   ÖRZA may change (`iosSourceOrder` in `./phoneTarget`). When none does, the events go into the member's default
 *   calendar instead ("default" mode). The calendar can sync to iCloud / Google, so medicine events name no medicine
 *   ("💊 Medicine time · ÖRZA", `./phoneEvents`). Events to change or delete are found in a listing (`findEvents`).
 * - iOS 17+ "Add Events Only" (write-only) access: no calendar can be created or read, so the events go into the
 *   default calendar and a re-sync only adds events it never added (`planSync`): changed or stopped ones can't be
 *   changed or deleted and are counted as out of date until full access comes back.
 * - Android: a calendar under a LOCAL account (not synced anywhere), owned by "ÖRZA"; events keep the medicine's name.
 * - Re-sync is a diff against a map of server event id → phone event id (+ a signature), kept in a JSON file in the
 *   app's documents folder; the calendar id (or `DEFAULT_CALENDAR_KEY` for the default calendar) lives in SecureStore.
 *   If the map is lost: ÖRZA's own calendar has its upcoming events wiped first; in the default calendar only ÖRZA's
 *   events (`isOrzaEvent`) are deleted (full access) — with "Add Events Only" nothing is added, since ÖRZA can't see
 *   what's there (`planCleanup`). A re-sync never duplicates events and never touches the member's own events.
 * - The link and the map name the ÖRZA account that added the calendar: another account signed in on the same phone
 *   sees "not added" (and never auto-syncs into it); if it adds the calendar it takes it over (wipe + rewrite; with
 *   full access the other account's events in the default calendar are deleted). A deliberate sign-out deletes ÖRZA's
 *   calendar or ÖRZA's events (`clearPhoneCalendar`; an iPhone without full access keeps the link and the map).
 * - Syncs, removal and the sign-out clean-up run one at a time (`serialized`), so two syncs never create the same
 *   events twice.
 * - Not available in Expo Go or on web (`phoneCalendarSupported`).
 */
import * as Calendar from 'expo-calendar';
import { File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { onDoseEvent } from '@/features/meds/events';
import { ApiError, errorMessage } from '@/lib/api';
import { WEB_URL } from '@/lib/config';

import { medicineEventText } from './phoneEvents';
import {
  accessFor,
  afterCreateFailed,
  decideTarget,
  DEFAULT_CALENDAR_KEY,
  DEFAULT_HISTORY_MS,
  defaultIsNew,
  describeAttempts,
  errorText,
  iosSourceOrder,
  isOrzaEvent,
  linkMode,
  listWindow,
  ORZA_REMINDER_NOTE,
  PHONE_CALENDAR_COPY,
  phonePermissionFrom,
  planCleanup,
  planSync,
  removeBlockedMessage,
  sourceLabel,
  upcomingCount,
  type CreateAttempt,
  type PhoneAccess,
  type PhonePermission,
  type SourceInfo,
  type StoredTarget,
  type SyncedEvent,
  type TargetMode,
} from './phoneTarget';
import type { CalendarEvent } from './types';
import { addDays, parseDoseEventId, parseReminderEventId } from './utils';

export type { PhonePermission, TargetMode } from './phoneTarget';

export const CALENDAR_TITLE = 'ÖRZA';
const CALENDAR_NAME = 'orza_reminders';
const CALENDAR_COLOR = '#FF7A6A';
/** Days of doses and reminders written to the phone calendar. */
export const SYNC_DAYS = 14;
/** Re-sync quietly when the calendar screen opens and the last sync is older than this. */
export const AUTO_SYNC_AFTER_MS = 6 * 60 * 60 * 1000;

const DAY_MS = 86400000;
const LINK_KEY = 'orza.phoneCalendar';
const MAP_FILE = 'orza-phone-calendar.json';
const STORE_OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };
const BATCH = 6;

export const phoneCalendarSupported = Platform.OS === 'ios' || Platform.OS === 'android';

/* ───────────────────────────── Stale flag ───────────────────────────── */

/**
 * Kept in a marker file as well as in memory: Android often ends the app in the background, and a flag that lived
 * only in memory was lost with it — the next Calendar visit (within 6 h of the last sync) then left a deleted
 * reminder / medicine ringing from the phone calendar.
 */
const STALE_FILE = 'orza-phone-calendar.stale';
let stale: boolean | null = null; // null: not read from disk yet

function staleFile(): File | null {
  try {
    return new File(Paths.document, STALE_FILE);
  } catch {
    return null; // web preview — memory only
  }
}

function setStale(value: boolean) {
  if (stale === value) return;
  stale = value;
  try {
    const f = staleFile();
    if (!f) return;
    if (value && !f.exists) f.create();
    else if (!value && f.exists) f.delete();
  } catch {
    // Storage unavailable: the in-memory flag still covers this run.
  }
}

/** Called after reminder / medicine changes so the next calendar visit re-syncs the phone calendar. */
export function markPhoneCalendarStale() {
  setStale(true);
}
export function isPhoneCalendarStale(): boolean {
  if (stale === null) {
    try {
      stale = !!staleFile()?.exists;
    } catch {
      stale = false;
    }
  }
  return stale;
}
// Any dose taken / skipped or medicine change makes the phone copy out of date.
onDoseEvent(() => {
  setStale(true);
});

/* ───────────────────────────── One write at a time ───────────────────────────── */

let queue: Promise<unknown> = Promise.resolve();

/**
 * Runs phone-calendar writes one after another (sync, remove, sign-out clean-up). A second sync started while one is
 * running — e.g. the Calendar screen reopened during an auto-sync — waits, then reads the map the first one wrote,
 * instead of creating the same events again from the old map (they would ring twice and never be cleaned up).
 */
function serialized<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.catch(() => undefined).then(work);
  queue = run;
  return run;
}

/* ───────────────────────────── Errors ───────────────────────────── */

export class PhoneCalendarError extends Error {
  /**
   * `unlinked`: a quiet re-sync found the calendar removed (or added by another account) and left it alone.
   * `writeOnly`: "Add Events Only" access and ÖRZA can't tell what it already added, so it added nothing.
   */
  readonly reason: 'unsupported' | 'permission' | 'create' | 'write' | 'unlinked' | 'writeOnly';
  constructor(reason: PhoneCalendarError['reason'], message: string) {
    super(message);
    this.name = 'PhoneCalendarError';
    this.reason = reason;
  }
}

export function phoneCalendarMessage(e: unknown): string {
  if (e instanceof PhoneCalendarError) return e.message;
  // Fetching the doses / reminders failed (offline, server down) — not the phone's calendar.
  if (e instanceof ApiError) return errorMessage(e);
  return "Your phone's calendar didn't accept the changes. Please try again.";
}

/* ───────────────────────────── Permission ───────────────────────────── */

/**
 * Full access, or (iPhone, iOS 17+) "Add Events Only". expo-calendar's full-access check reports "Add Events Only"
 * as denied for good, so the write-only check tells the two apart.
 */
export async function getPhonePermission(): Promise<PhonePermission> {
  if (!phoneCalendarSupported) return 'blocked';
  try {
    const full = await Calendar.getCalendarPermissions();
    let writeOnly = false;
    if (!full.granted && Platform.OS === 'ios' && full.status !== 'undetermined') {
      try {
        writeOnly = (await Calendar.getCalendarPermissions(true)).granted;
      } catch {
        writeOnly = false;
      }
    }
    return phonePermissionFrom(full, writeOnly);
  } catch {
    return 'undetermined';
  }
}

/**
 * Asks for full access (it's what lets ÖRZA create its calendar and keep the events up to date). With "Add Events
 * Only" already chosen, iOS may offer the member the upgrade, or answer at once with the current access.
 */
export async function requestPhonePermission(): Promise<PhonePermission> {
  if (!phoneCalendarSupported) return 'blocked';
  try {
    const res = await Calendar.requestCalendarPermissions();
    if (res.granted) return 'granted';
  } catch {
    throw new PhoneCalendarError('unsupported', "Calendar access isn't available in this version of the app.");
  }
  return getPhonePermission();
}

/* ───────────────────────────── Storage ───────────────────────────── */

export interface PhoneCalendarLink {
  /** The ÖRZA account that added (and syncs) the calendar on this phone. */
  userId: string;
  /** ÖRZA's own calendar, or `DEFAULT_CALENDAR_KEY` when the events are in the member's default calendar. */
  calendarId: string;
  syncedAt: string | null;
  count: number;
  /** Default calendar (full access): its name, for the card. */
  calendarTitle?: string;
  /** "Add Events Only": upcoming events ÖRZA added that are out of date and that it can't change. */
  stuck?: number;
}

interface SyncMap {
  /** Whose doses / reminders the mapped events are — a map of another account is never diffed against. */
  userId: string;
  calendarId: string;
  events: Record<string, SyncedEvent>;
}

/** The stored link, whoever added it (or a link saved before links named their account, with no `userId`). */
async function readStoredLink(): Promise<(Omit<PhoneCalendarLink, 'userId'> & { userId?: string }) | null> {
  if (!phoneCalendarSupported) return null;
  try {
    const raw = await SecureStore.getItemAsync(LINK_KEY, STORE_OPTIONS);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PhoneCalendarLink;
    return parsed && typeof parsed.calendarId === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

/** The link `userId` made on this phone. Another account's link (or an old one that names no account) counts as none. */
export async function readLink(userId: string): Promise<PhoneCalendarLink | null> {
  const link = await readStoredLink();
  return link && link.userId === userId ? { ...link, userId } : null;
}

async function writeLink(link: PhoneCalendarLink | null) {
  try {
    if (link) await SecureStore.setItemAsync(LINK_KEY, JSON.stringify(link), STORE_OPTIONS);
    else await SecureStore.deleteItemAsync(LINK_KEY, STORE_OPTIONS);
  } catch {
    // Keychain unavailable — the calendar is found again by its title next time.
  }
}

function mapFile() {
  return new File(Paths.document, MAP_FILE);
}

async function readMap(): Promise<SyncMap | null> {
  try {
    const file = mapFile();
    if (!file.exists) return null;
    const parsed = JSON.parse(await file.text()) as SyncMap;
    return parsed && typeof parsed.calendarId === 'string' && typeof parsed.userId === 'string' && parsed.events ? parsed : null;
  } catch {
    return null;
  }
}

function writeMap(map: SyncMap | null) {
  try {
    const file = mapFile();
    if (!map) {
      if (file.exists) file.delete();
      return;
    }
    file.write(JSON.stringify(map));
  } catch {
    // Without the map the next sync wipes and rewrites ÖRZA's upcoming events (still no duplicates).
  }
}

/* ───────────────────────────── Calendar ───────────────────────────── */

async function getCalendarById(id: string): Promise<Calendar.ExpoCalendar | null> {
  if (id === DEFAULT_CALENDAR_KEY) return null; // the member's calendar, never ÖRZA's own
  try {
    return await Calendar.ExpoCalendar.get(id);
  } catch {
    return null;
  }
}

async function findOwnCalendar(): Promise<Calendar.ExpoCalendar | null> {
  try {
    const all = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
    return (
      all.find(
        (c) =>
          c.title === CALENDAR_TITLE &&
          c.allowsModifications &&
          (Platform.OS !== 'android' || c.name === CALENDAR_NAME || c.source?.isLocalAccount === true)
      ) ?? null
    );
  } catch {
    return null;
  }
}

/** iPhone: the ÖRZA calendar in the first account that takes it (`iosSourceOrder`). Throws when none does. */
async function createIosCalendar(): Promise<Calendar.ExpoCalendar> {
  const attempts: CreateAttempt[] = [];
  let sources: SourceInfo[] = [];
  try {
    sources = Calendar.getSourcesSync().flatMap((s) => (s?.id ? [{ id: s.id, type: String(s.type ?? ''), name: String(s.name ?? '') }] : []));
  } catch (e) {
    attempts.push({ source: 'list of accounts', error: errorText(e) });
  }
  let calendars: { sourceId?: string; allowsModifications: boolean }[] = [];
  try {
    calendars = (await Calendar.getCalendars(Calendar.EntityTypes.EVENT)).map((c) => ({ sourceId: c.source?.id, allowsModifications: !!c.allowsModifications }));
  } catch (e) {
    attempts.push({ source: 'list of calendars', error: errorText(e) });
  }
  let defaultSourceId: string | undefined;
  try {
    defaultSourceId = Calendar.getDefaultCalendarSync().source?.id;
  } catch (e) {
    attempts.push({ source: 'default calendar', error: errorText(e) });
  }
  for (const source of iosSourceOrder(sources, calendars, defaultSourceId)) {
    try {
      return await Calendar.createCalendar({ title: CALENDAR_TITLE, color: CALENDAR_COLOR, entityType: Calendar.EntityTypes.EVENT, sourceId: source.id });
    } catch (e) {
      attempts.push({ source: sourceLabel(source), error: errorText(e) });
    }
  }
  // One line for development logs: the real reason of every try (never shown to members).
  if (__DEV__) console.warn(`[ÖRZA phone calendar] ${describeAttempts(attempts)}`);
  throw new Error(describeAttempts(attempts));
}

function createAndroidCalendar(tz: string): Promise<Calendar.ExpoCalendar> {
  return Calendar.createCalendar({
    title: CALENDAR_TITLE,
    color: CALENDAR_COLOR,
    name: CALENDAR_NAME,
    source: { isLocalAccount: true, name: CALENDAR_TITLE, type: Calendar.SourceType.LOCAL },
    ownerAccount: CALENDAR_TITLE,
    accessLevel: Calendar.CalendarAccessLevel.OWNER,
    timeZone: tz,
    isVisible: true,
    isSynced: true,
  });
}

function defaultCalendarOrNull(): Calendar.ExpoCalendar | null {
  try {
    return Platform.OS === 'ios' ? Calendar.getDefaultCalendarSync() : null;
  } catch {
    return null;
  }
}

/** Where a sync writes (see `decideTarget`). */
interface SyncTarget {
  mode: TargetMode;
  /** The map's and the link's `calendarId`. */
  key: string;
  /** New events are created here: ÖRZA's calendar, or the default calendar (a virtual one with "Add Events Only"). */
  calendar: Calendar.ExpoCalendar;
  /** No ÖRZA events were on the phone there before this sync (a new calendar, or the first use of the default one). */
  created: boolean;
  /** Full access: events can be read, changed and deleted. */
  canEdit: boolean;
  /** Default calendar with full access: its name. */
  title?: string;
}

function defaultTarget(calendar: Calendar.ExpoCalendar, access: PhoneAccess, created: boolean): SyncTarget {
  let title: string | undefined;
  if (access === 'full') {
    try {
      title = calendar.title || undefined;
    } catch {
      title = undefined;
    }
  }
  return { mode: 'default', key: DEFAULT_CALENDAR_KEY, calendar, created, canEdit: access === 'full', title };
}

function noDefaultCalendar(): never {
  throw new PhoneCalendarError('create', PHONE_CALENDAR_COPY.noCalendarIos);
}

/** ÖRZA's calendar already on the phone (whichever account added it — adding it again takes it over), a new one, or the default calendar. */
async function resolveTarget(stored: Awaited<ReturnType<typeof readStoredLink>>, userId: string, access: PhoneAccess, tz: string): Promise<SyncTarget> {
  const storedTarget: StoredTarget | null = stored ? { mode: linkMode(stored), mine: stored.userId === userId } : null;
  const step = decideTarget(access, storedTarget);
  if (step === 'ownNeedsFullAccess') throw new PhoneCalendarError('permission', PHONE_CALENDAR_COPY.ownNeedsFullAccess);
  if (step === 'default') {
    const calendar = defaultCalendarOrNull();
    if (!calendar) noDefaultCalendar();
    return defaultTarget(calendar, access, defaultIsNew(storedTarget));
  }

  const existing = (stored && (await getCalendarById(stored.calendarId))) || (await findOwnCalendar());
  if (existing) return { mode: 'own', key: existing.id, calendar: existing, created: false, canEdit: true };
  try {
    const calendar = Platform.OS === 'android' ? await createAndroidCalendar(tz) : await createIosCalendar();
    return { mode: 'own', key: calendar.id, calendar, created: true, canEdit: true };
  } catch {
    const fallback = defaultCalendarOrNull();
    if (afterCreateFailed(Platform.OS === 'ios' ? 'ios' : 'android', !!fallback) === 'default' && fallback) {
      return defaultTarget(fallback, access, true);
    }
    if (Platform.OS === 'ios') noDefaultCalendar();
    throw new PhoneCalendarError('create', PHONE_CALENDAR_COPY.createFailedAndroid);
  }
}

/**
 * `userId`'s link, if ÖRZA's events are still on the phone (needs full access to check). Clears a link whose own
 * calendar was deleted in the Calendar app; a link to the default calendar stays (its events are tracked by id).
 */
export async function linkedCalendar(userId: string): Promise<PhoneCalendarLink | null> {
  const link = await readLink(userId);
  if (!link) return null;
  if (linkMode(link) === 'default') return link;
  const calendar = await getCalendarById(link.calendarId);
  if (!calendar) {
    await writeLink(null);
    writeMap(null);
    return null;
  }
  return link;
}

/* ───────────────────────────── Events ───────────────────────────── */

export interface PhoneEventSource {
  /** Medicine doses + reminders from GET /api/calendar/events. */
  events: CalendarEvent[];
  /** Reminders with Calendar switched on: id → kind (for the title emoji). */
  calendarReminders: Map<string, string>;
  tz: string;
}

const KIND_EMOJI: Record<string, string> = { meal: '🍽️', water: '💧', weight: '⚖️', custom: '🔔' };

interface DesiredEvent {
  key: string;
  start: string;
  details: {
    title: string;
    notes: string;
    startDate: Date;
    endDate: Date;
    timeZone: string;
    url?: string;
    alarms: Calendar.Alarm[];
  };
  sig: string;
}

function alarmsFor(ring: boolean): Calendar.Alarm[] {
  if (!ring) return [];
  return [Platform.OS === 'android' ? { relativeOffset: 0, method: Calendar.AlarmMethod.ALERT } : { relativeOffset: 0 }];
}

/** Turn API events into phone events: future doses (all) + reminders with Calendar switched on. */
function desiredEvents({ events, calendarReminders, tz }: PhoneEventSource, now: Date): DesiredEvent[] {
  const out: DesiredEvent[] = [];
  for (const e of events) {
    if (e.all_day) continue;
    const startMs = Date.parse(e.start);
    if (Number.isNaN(startMs) || startMs <= now.getTime()) continue;
    const endMs = e.end ? Math.max(Date.parse(e.end) || 0, startMs + 5 * 60000) : startMs + 15 * 60000;
    let title: string;
    let notes: string;
    let url: string | undefined;
    let ring = true;

    if (e.kind === 'medication') {
      const dose = parseDoseEventId(e.id);
      ring = e.status !== 'taken' && e.status !== 'skipped';
      const alarmPath = dose ? `/dashboard/alarm?med=${encodeURIComponent(dose.medicationId)}&at=${encodeURIComponent(dose.at)}` : '/dashboard/medicines';
      // iPhone: no medicine name or details (the calendar can sync to iCloud). The new text changes the signature, so
      // the next sync rewrites the upcoming events an older build wrote with names.
      ({ title, notes } = medicineEventText(e, Platform.OS === 'ios' ? 'ios' : 'android', `${WEB_URL}${alarmPath}`));
      // The orza:// link opens the dose, and marks the event as ÖRZA's (`isOrzaEvent`).
      if (dose && Platform.OS === 'ios') url = `orza://alarm?med=${encodeURIComponent(dose.medicationId)}&at=${encodeURIComponent(dose.at)}`;
    } else if (e.kind === 'reminder') {
      const reminderId = parseReminderEventId(e.id);
      const kind = reminderId ? calendarReminders.get(reminderId) : undefined;
      if (!kind) continue;
      title = `${KIND_EMOJI[kind] ?? KIND_EMOJI.custom} ${e.title}`;
      notes = [e.subtitle || '', ORZA_REMINDER_NOTE].filter(Boolean).join('\n');
      if (Platform.OS === 'ios') url = 'orza://reminders';
    } else {
      continue;
    }

    const details = {
      title,
      notes,
      startDate: new Date(startMs),
      endDate: new Date(endMs),
      timeZone: tz,
      ...(url ? { url } : {}),
      alarms: alarmsFor(ring),
    };
    out.push({ key: e.id, start: e.start, details, sig: [title, notes, startMs, endMs, tz, url ?? '', ring ? 1 : 0].join('|') });
  }
  return out;
}

async function inBatches<T>(items: T[], run: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += BATCH) {
    await Promise.all(items.slice(i, i + BATCH).map(run));
  }
}

type FoundEvents = Map<string, Calendar.ExpoCalendarEvent>;

/**
 * iPhone, full access: ÖRZA's mapped `events` found in a listing of `calendars` (when omitted, every calendar ÖRZA may
 * change — the default calendar can have changed since the events were added). A listed event's `id` is the id
 * `createEvent` returned (EventKit's calendarItemIdentifier), while `ExpoCalendarEvent.get(id)` looks events up with
 * EventKit's `event(withIdentifier:)`, which takes the event's other identifier and may not find it: a changed dose
 * would then be added a second time, and Remove would leave the event ringing. Android: empty (`get` by id works
 * there, as before).
 */
async function findEvents(events: SyncedEvent[], calendars?: Calendar.ExpoCalendar[]): Promise<FoundEvents> {
  const found: FoundEvents = new Map();
  const window = Platform.OS === 'ios' ? listWindow(events) : null;
  if (!window) return found;
  let list = calendars;
  if (!list) {
    try {
      list = (await Calendar.getCalendars(Calendar.EntityTypes.EVENT)).filter((c) => c.allowsModifications);
    } catch {
      return found;
    }
  }
  const ids = new Set(events.map((e) => e.id));
  for (const calendar of list) {
    try {
      for (const ev of await calendar.listEvents(new Date(window.from), new Date(window.to))) {
        if (ev.id && ids.has(ev.id) && !found.has(ev.id)) found.set(ev.id, ev);
      }
    } catch {
      // This calendar can't be listed: its events are looked up by id.
    }
  }
  return found;
}

/** The event with this id: from the listing, else looked up by id. Throws when it's gone. */
async function eventById(id: string, found: FoundEvents): Promise<Calendar.ExpoCalendarEvent> {
  return found.get(id) ?? (await Calendar.ExpoCalendarEvent.get(id));
}

async function deleteEventById(id: string, found: FoundEvents = new Map()) {
  try {
    const ev = await eventById(id, found);
    await ev.delete();
  } catch {
    // Already removed in the Calendar app.
  }
}

/** Full access: delete these mapped events (wherever they are now). */
async function deleteMapped(events: SyncedEvent[]) {
  const found = await findEvents(events);
  await inBatches(events, (ev) => deleteEventById(ev.id, found));
}

/** Remove every upcoming event in our own calendar (used when the id map was lost). */
async function wipeUpcoming(calendar: Calendar.ExpoCalendar, now: Date) {
  try {
    const list = await calendar.listEvents(new Date(now.getTime() - DAY_MS), new Date(now.getTime() + (SYNC_DAYS + 31) * DAY_MS));
    await inBatches(list, async (ev) => {
      try {
        await ev.delete();
      } catch {
        // ignore
      }
    });
  } catch {
    // Listing failed — carry on; the map is rebuilt from scratch.
  }
}

/**
 * Full access, ÖRZA's events in the default calendar that the map doesn't know of (e.g. ÖRZA was reinstalled, or an
 * id changed when the calendar synced): delete only ÖRZA's events (`isOrzaEvent`: its orza:// link, or the words ÖRZA
 * writes on each one) in the default calendar from `from` on. The member's own events are never changed, and nothing
 * about them is kept.
 */
async function wipeOrzaEvents(from: Date, now: Date) {
  try {
    const calendar = defaultCalendarOrNull();
    if (!calendar || calendar.title === CALENDAR_TITLE) return;
    const list = await calendar.listEvents(from, new Date(now.getTime() + (SYNC_DAYS + 31) * DAY_MS));
    await inBatches(
      list.filter((ev) => isOrzaEvent(ev)),
      async (ev) => {
        try {
          await ev.delete();
        } catch {
          // ignore
        }
      }
    );
  } catch {
    // Listing failed — nothing deleted.
  }
}

/**
 * Full access: delete ÖRZA's events in the default calendar — the mapped ones by id (wherever they are now), then any
 * other ÖRZA event there in the last 31 days and the weeks ahead (`wipeOrzaEvents`).
 */
async function removeDefaultEvents(map: SyncMap | null, now: Date) {
  if (map && linkMode(map) === 'default') await deleteMapped(Object.values(map.events));
  await wipeOrzaEvents(new Date(now.getTime() - DEFAULT_HISTORY_MS), now);
}

export interface PhoneSyncResult {
  added: number;
  updated: number;
  removed: number;
  total: number;
  created: boolean;
  /** `default`: the events are in the member's default calendar. */
  mode: TargetMode;
  /** "Add Events Only": upcoming events out of date that ÖRZA can't change. */
  stuck: number;
}

/** The local-day range to fetch for a sync: today … today + 13. */
export function syncRange(today: string): { from: string; to: string } {
  return { from: today, to: addDays(today, SYNC_DAYS - 1) };
}

export interface PhoneSyncOptions {
  /** The signed-in account — the link and the map are saved under it. */
  userId: string;
  /** Quiet re-sync: only refresh a calendar this account added and that is still on the phone — never create one. */
  onlyIfLinked?: boolean;
  /** Fetches the doses + reminders to write. Runs when this sync's turn comes, so it never writes older data than a sync before it. */
  load: () => Promise<PhoneEventSource>;
}

/**
 * Create (if needed) the ÖRZA calendar (or use the default calendar) and bring its next 14 days in line with ÖRZA.
 * Requires full or "Add Events Only" access. Events that already passed are left alone, so the phone keeps a short
 * history. Waits for any sync already running.
 */
export function syncPhoneCalendar(opts: PhoneSyncOptions): Promise<PhoneSyncResult> {
  return serialized(async () => {
    // Cleared before loading, so a dose / reminder change made while this sync runs marks the copy stale again.
    setStale(false);
    try {
      return await runSync(opts);
    } catch (e) {
      setStale(true);
      throw e;
    }
  });
}

async function runSync({ userId, onlyIfLinked, load }: PhoneSyncOptions): Promise<PhoneSyncResult> {
  if (!phoneCalendarSupported) throw new PhoneCalendarError('unsupported', "Your phone's calendar isn't available here.");
  const access = accessFor(await getPhonePermission());
  if (!access) throw new PhoneCalendarError('permission', 'Allow ÖRZA to use your calendar first.');
  // A quiet re-sync queued behind "Remove" or a sign-out must not put the calendar back. ("Add Events Only" can't
  // look the calendar up, so it trusts the link.)
  if (onlyIfLinked && !(access === 'full' ? await linkedCalendar(userId) : await readLink(userId))) {
    throw new PhoneCalendarError('unlinked', "ÖRZA isn't in your phone's calendar any more. Tap Add to my calendar to add it again.");
  }

  const source = await load();
  const now = new Date();
  const stored = await readStoredLink();
  const target = await resolveTarget(stored, userId, access, source.tz);
  const desired = desiredEvents(source, now);
  const previous = await readMap();
  // Only this account's map of this calendar is diffed against; anything else (lost map, another account's events)
  // is cleared first so nothing is duplicated or left behind (`planCleanup`).
  const mine = previous && previous.userId === userId && previous.calendarId === target.key ? previous : null;
  const cleanup = planCleanup({
    mine: !!mine,
    created: target.created,
    target: target.mode,
    access,
    leftover: previous && !mine ? linkMode(previous) : null,
  });
  if (cleanup.refuse) throw new PhoneCalendarError('writeOnly', PHONE_CALENDAR_COPY.writeOnlyUnknownEvents);
  if (cleanup.deleteLeftover && previous) await deleteMapped(Object.values(previous.events));
  if (cleanup.wipeOwn) await wipeUpcoming(target.calendar, now);
  if (cleanup.wipeMarked) await wipeOrzaEvents(new Date(now.getTime() - DAY_MS), now);

  const plan = planSync({
    known: mine ? mine.events : {},
    wanted: desired.map((d) => ({ key: d.key, sig: d.sig, start: d.start })),
    now: now.getTime(),
    canEdit: target.canEdit,
    historyMs: target.mode === 'default' ? DEFAULT_HISTORY_MS : 0,
  });
  const byKey = new Map(desired.map((d) => [d.key, d]));
  const next: Record<string, SyncedEvent> = { ...plan.keep };
  let added = 0;
  let updated = 0;
  let removed = 0;
  let failed = 0;

  const create = async (d: DesiredEvent) => {
    try {
      const ev = await target.calendar.createEvent(d.details);
      next[d.key] = { id: ev.id, sig: d.sig, start: d.start };
      added += 1;
    } catch {
      failed += 1;
    }
  };

  // iPhone: the events to change or delete, found in a listing (`findEvents`); ÖRZA's calendar, or (default calendar)
  // every calendar ÖRZA may change. Only when there's something to change or delete.
  const found = await findEvents([...plan.remove, ...plan.update.map((u) => u.have)], target.mode === 'own' ? [target.calendar] : undefined);

  // Upcoming events ÖRZA no longer has are deleted; ones that already passed stay in the phone calendar as history.
  await inBatches(plan.remove, async (ev) => {
    await deleteEventById(ev.id, found);
    removed += 1;
  });

  await inBatches(plan.update, async ({ key, have }) => {
    const d = byKey.get(key);
    if (!d) return;
    try {
      const ev = await eventById(have.id, found);
      await ev.update(d.details);
      next[key] = { id: have.id, sig: d.sig, start: d.start };
      updated += 1;
    } catch {
      // Deleted in the Calendar app — create it again.
      await create(d);
    }
  });

  await inBatches(plan.create, async (key) => {
    const d = byKey.get(key);
    if (d) await create(d);
  });

  const total = upcomingCount(next, now.getTime());
  const writeFailed = failed > 0 && total === 0;
  // A first try at the default calendar that wrote nothing leaves no link behind (nothing of ÖRZA's is there).
  if (writeFailed && target.mode === 'default' && target.created) {
    throw new PhoneCalendarError('write', "Your phone's calendar didn't accept the events. Please try again.");
  }
  writeMap({ userId, calendarId: target.key, events: next });
  await writeLink({
    userId,
    calendarId: target.key,
    syncedAt: now.toISOString(),
    count: total,
    ...(target.title ? { calendarTitle: target.title } : {}),
    ...(plan.stuck ? { stuck: plan.stuck } : {}),
  });
  if (writeFailed) throw new PhoneCalendarError('write', "Your phone's calendar didn't accept the events. Please try again.");
  return { added, updated, removed, total, created: target.created, mode: target.mode, stuck: plan.stuck };
}

/**
 * Delete the ÖRZA calendar (and every event in it) — or, in the default calendar, exactly ÖRZA's events — from the
 * phone and forget the link. Needs full access. Waits for a running sync.
 */
export function removePhoneCalendar(): Promise<void> {
  return serialized(async () => {
    if (!phoneCalendarSupported) return;
    const permission = await getPhonePermission();
    const link = await readStoredLink();
    const mode: TargetMode = link ? linkMode(link) : 'own';
    if (permission !== 'granted') throw new PhoneCalendarError('permission', removeBlockedMessage(mode, permission));
    if (mode === 'default') {
      await removeDefaultEvents(await readMap(), new Date());
    } else {
      const calendar = (link && (await getCalendarById(link.calendarId))) || (await findOwnCalendar());
      if (calendar) {
        try {
          await calendar.delete();
        } catch {
          throw new PhoneCalendarError('write', "Couldn't remove the ÖRZA calendar. You can also delete it in your Calendar app.");
        }
      }
    }
    await writeLink(null);
    writeMap(null);
  });
}

/** How long sign-out waits for the clean-up (a sync in progress finishes first); the rest carries on in the background. */
const CLEAR_WAIT_MS = 4000;

/**
 * Deliberate sign-out: delete the ÖRZA calendar (or ÖRZA's events in the default calendar) this phone was given — its
 * medicine names (Android) and dose times must not stay in the Calendar app, or keep ringing, for whoever uses the
 * phone next — and forget the link and the map. Best effort: never throws. Without full access ÖRZA can't delete them
 * (they can still be deleted in the Calendar app): Android forgets the link and the map; an iPhone keeps them (they
 * name the account, so another account sees "not added"): forgotten, the same account adding ÖRZA again — with "Add
 * Events Only" into the default calendar — would write every event a second time, and full access could no longer
 * find them. Not for a 401 session expiry — there the link simply stays with its account (see `readLink`).
 */
export async function clearPhoneCalendar(): Promise<void> {
  if (!phoneCalendarSupported) return;
  const work = serialized(async () => {
    setStale(false);
    const [link, map] = await Promise.all([readStoredLink(), readMap()]);
    const granted = !!(link || map) && (await getPhonePermission()) === 'granted';
    if ((link || map) && !granted && Platform.OS === 'ios') return;
    if (granted) {
      const inDefault = link ? linkMode(link) === 'default' : map?.calendarId === DEFAULT_CALENDAR_KEY;
      if (inDefault) {
        await removeDefaultEvents(map, new Date());
      } else {
        const calendar = (link && (await getCalendarById(link.calendarId))) || (map && (await getCalendarById(map.calendarId)));
        try {
          await calendar?.delete();
        } catch {
          // Left on the phone — it can be deleted in the Calendar app; the next account to add ÖRZA wipes it.
        }
      }
    }
    await writeLink(null);
    writeMap(null);
  }).catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([work, new Promise<void>((resolve) => (timer = setTimeout(resolve, CLEAR_WAIT_MS)))]);
  clearTimeout(timer);
}
