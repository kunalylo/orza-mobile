/**
 * "Add ÖRZA to my phone calendar" — writes the next 14 days of medicine doses (and reminders with Calendar switched on)
 * into a dedicated "ÖRZA" calendar on the phone, each event with an alert at its time, using the expo-calendar v57
 * object API (`createCalendar`, `ExpoCalendar`, `ExpoCalendarEvent`).
 *
 * - iOS: needs full calendar access (write-only can't create calendars); the calendar lives in the default source
 *   (iCloud / On My iPhone), falling back to the local source.
 * - Android: a calendar under a LOCAL account (not synced anywhere), owned by "ÖRZA".
 * - Re-sync is a diff against a map of server event id → phone event id (+ a signature), kept in a JSON file in the
 *   app's documents folder; the calendar id lives in SecureStore. If the map is lost but the calendar still exists, the
 *   calendar's upcoming events are wiped first, so a re-sync never duplicates events.
 * - Not available in Expo Go or on web (`phoneCalendarSupported`).
 */
import * as Calendar from 'expo-calendar';
import { File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { onDoseEvent } from '@/features/meds/events';
import { WEB_URL } from '@/lib/config';

import type { CalendarEvent } from './types';
import { addDays, parseDoseEventId, parseReminderEventId } from './utils';

export const CALENDAR_TITLE = 'ÖRZA';
const CALENDAR_NAME = 'orza_reminders';
const CALENDAR_COLOR = '#FF7A6A';
/** Days of doses and reminders written to the phone calendar. */
export const SYNC_DAYS = 14;
/** Re-sync quietly when the calendar screen opens and the last sync is older than this. */
export const AUTO_SYNC_AFTER_MS = 6 * 60 * 60 * 1000;

const LINK_KEY = 'orza.phoneCalendar';
const MAP_FILE = 'orza-phone-calendar.json';
const STORE_OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };
const BATCH = 6;

export const phoneCalendarSupported = Platform.OS === 'ios' || Platform.OS === 'android';

/* ───────────────────────────── Stale flag ───────────────────────────── */

let stale = false;
/** Called after reminder / medicine changes so the next calendar visit re-syncs the phone calendar. */
export function markPhoneCalendarStale() {
  stale = true;
}
export const isPhoneCalendarStale = () => stale;
// Any dose taken / skipped or medicine change makes the phone copy out of date.
onDoseEvent(() => {
  stale = true;
});

/* ───────────────────────────── Errors ───────────────────────────── */

export class PhoneCalendarError extends Error {
  readonly reason: 'unsupported' | 'permission' | 'create' | 'write';
  constructor(reason: PhoneCalendarError['reason'], message: string) {
    super(message);
    this.name = 'PhoneCalendarError';
    this.reason = reason;
  }
}

export function phoneCalendarMessage(e: unknown): string {
  if (e instanceof PhoneCalendarError) return e.message;
  return "Your phone's calendar didn't accept the changes. Please try again.";
}

/* ───────────────────────────── Permission ───────────────────────────── */

export type PhonePermission = 'granted' | 'undetermined' | 'denied' | 'blocked';

function toPermission(p: Calendar.PermissionResponse): PhonePermission {
  if (p.granted) return 'granted';
  if (p.status === 'undetermined') return 'undetermined';
  return p.canAskAgain ? 'denied' : 'blocked';
}

export async function getPhonePermission(): Promise<PhonePermission> {
  if (!phoneCalendarSupported) return 'blocked';
  try {
    return toPermission(await Calendar.getCalendarPermissions());
  } catch {
    return 'undetermined';
  }
}

export async function requestPhonePermission(): Promise<PhonePermission> {
  if (!phoneCalendarSupported) return 'blocked';
  try {
    return toPermission(await Calendar.requestCalendarPermissions());
  } catch {
    throw new PhoneCalendarError('unsupported', "Calendar access isn't available in this version of the app.");
  }
}

/* ───────────────────────────── Storage ───────────────────────────── */

export interface PhoneCalendarLink {
  calendarId: string;
  syncedAt: string | null;
  count: number;
}

interface SyncedEvent {
  id: string;
  sig: string;
  start: string;
}

interface SyncMap {
  calendarId: string;
  events: Record<string, SyncedEvent>;
}

export async function readLink(): Promise<PhoneCalendarLink | null> {
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
    return parsed && typeof parsed.calendarId === 'string' && parsed.events ? parsed : null;
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
    // Without the map the next sync wipes and rewrites the calendar's upcoming events (still no duplicates).
  }
}

/* ───────────────────────────── Calendar ───────────────────────────── */

async function getCalendarById(id: string): Promise<Calendar.ExpoCalendar | null> {
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

async function createOwnCalendar(tz: string): Promise<Calendar.ExpoCalendar> {
  if (Platform.OS === 'android') {
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
  // iOS: the default calendar's source first (iCloud / On My iPhone), then the local source.
  const sources: (string | undefined)[] = [];
  try {
    sources.push(Calendar.getDefaultCalendarSync().source?.id);
  } catch {
    // no default calendar
  }
  try {
    sources.push(Calendar.getSourcesSync().find((s) => s.type === Calendar.SourceType.LOCAL)?.id);
  } catch {
    // sources unavailable
  }
  sources.push(undefined); // let iOS pick
  let lastError: unknown = null;
  for (const sourceId of [...new Set(sources)]) {
    try {
      return await Calendar.createCalendar({ title: CALENDAR_TITLE, color: CALENDAR_COLOR, entityType: Calendar.EntityTypes.EVENT, ...(sourceId ? { sourceId } : {}) });
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError ?? new Error('createCalendar failed');
}

async function ensureCalendar(tz: string): Promise<{ calendar: Calendar.ExpoCalendar; created: boolean }> {
  const link = await readLink();
  const existing = (link && (await getCalendarById(link.calendarId))) || (await findOwnCalendar());
  if (existing) return { calendar: existing, created: false };
  try {
    return { calendar: await createOwnCalendar(tz), created: true };
  } catch {
    throw new PhoneCalendarError(
      'create',
      Platform.OS === 'ios'
        ? "Couldn't create the ÖRZA calendar. Check that iCloud Calendars or On My iPhone is available in Settings → Calendar → Accounts."
        : "Couldn't create the ÖRZA calendar on this phone. Please try again."
    );
  }
}

/** The linked calendar (still on the phone), if any. Clears a link whose calendar was deleted in the Calendar app. */
export async function linkedCalendar(): Promise<{ link: PhoneCalendarLink; calendar: Calendar.ExpoCalendar } | null> {
  const link = await readLink();
  if (!link) return null;
  const calendar = await getCalendarById(link.calendarId);
  if (!calendar) {
    await writeLink(null);
    writeMap(null);
    return null;
  }
  return { link, calendar };
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
      const [doseText, ...rest] = (e.subtitle || '').split(' · ');
      title = `💊 ${e.title}${doseText ? ` — ${doseText}` : ''}`;
      ring = e.status !== 'taken' && e.status !== 'skipped';
      const alarmPath = dose ? `/dashboard/alarm?med=${encodeURIComponent(dose.medicationId)}&at=${encodeURIComponent(dose.at)}` : '/dashboard/medicines';
      notes = [
        [doseText, ...rest].filter(Boolean).join(' · '),
        e.status === 'taken' ? 'Marked as taken in ÖRZA.' : e.status === 'skipped' ? 'Marked as skipped in ÖRZA.' : '',
        "Open ÖRZA to see the medicine's photos and mark the dose.",
        `${WEB_URL}${alarmPath}`,
      ]
        .filter(Boolean)
        .join('\n');
      if (dose && Platform.OS === 'ios') url = `orza://alarm?med=${encodeURIComponent(dose.medicationId)}&at=${encodeURIComponent(dose.at)}`;
    } else if (e.kind === 'reminder') {
      const reminderId = parseReminderEventId(e.id);
      const kind = reminderId ? calendarReminders.get(reminderId) : undefined;
      if (!kind) continue;
      title = `${KIND_EMOJI[kind] ?? KIND_EMOJI.custom} ${e.title}`;
      notes = [e.subtitle || '', 'A gentle nudge from ÖRZA.'].filter(Boolean).join('\n');
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

async function deleteEventById(id: string) {
  try {
    const ev = await Calendar.ExpoCalendarEvent.get(id);
    await ev.delete();
  } catch {
    // Already removed in the Calendar app.
  }
}

/** Remove every upcoming event in our own calendar (used when the id map was lost). */
async function wipeUpcoming(calendar: Calendar.ExpoCalendar, now: Date) {
  try {
    const list = await calendar.listEvents(new Date(now.getTime() - 86400000), new Date(now.getTime() + (SYNC_DAYS + 31) * 86400000));
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

export interface PhoneSyncResult {
  added: number;
  updated: number;
  removed: number;
  total: number;
  created: boolean;
}

/** The local-day range to fetch for a sync: today … today + 13. */
export function syncRange(today: string): { from: string; to: string } {
  return { from: today, to: addDays(today, SYNC_DAYS - 1) };
}

/**
 * Create (if needed) the ÖRZA calendar and bring its next 14 days in line with ÖRZA. Requires granted permission.
 * Events that already passed are left alone, so the phone keeps a short history.
 */
export async function syncPhoneCalendar(source: PhoneEventSource): Promise<PhoneSyncResult> {
  if (!phoneCalendarSupported) throw new PhoneCalendarError('unsupported', "Your phone's calendar isn't available here.");
  const permission = await getPhonePermission();
  if (permission !== 'granted') throw new PhoneCalendarError('permission', 'Allow ÖRZA to use your calendar first.');

  const now = new Date();
  const { calendar, created } = await ensureCalendar(source.tz);
  const desired = desiredEvents(source, now);
  const previous = await readMap();
  const known: Record<string, SyncedEvent> = previous && previous.calendarId === calendar.id ? { ...previous.events } : {};
  if (!created && (!previous || previous.calendarId !== calendar.id)) await wipeUpcoming(calendar, now);

  const next: Record<string, SyncedEvent> = {};
  let added = 0;
  let updated = 0;
  let removed = 0;
  let failed = 0;

  // Upcoming events ÖRZA no longer has are deleted; ones that already passed stay in the phone calendar as history
  // (and drop out of the map).
  const wanted = new Set(desired.map((d) => d.key));
  const outdated: SyncedEvent[] = [];
  for (const [key, ev] of Object.entries(known)) {
    if (wanted.has(key)) continue;
    if (Date.parse(ev.start) > now.getTime()) outdated.push(ev);
  }

  await inBatches(outdated, async (ev) => {
    await deleteEventById(ev.id);
    removed += 1;
  });

  await inBatches(desired, async (d) => {
    const have = known[d.key];
    try {
      if (have && have.sig === d.sig) {
        next[d.key] = have;
        return;
      }
      if (have) {
        try {
          const ev = await Calendar.ExpoCalendarEvent.get(have.id);
          await ev.update(d.details);
          next[d.key] = { id: have.id, sig: d.sig, start: d.start };
          updated += 1;
          return;
        } catch {
          // Deleted in the Calendar app — create it again below.
        }
      }
      const ev = await calendar.createEvent(d.details);
      next[d.key] = { id: ev.id, sig: d.sig, start: d.start };
      added += 1;
    } catch {
      failed += 1;
    }
  });

  writeMap({ calendarId: calendar.id, events: next });
  const total = Object.keys(next).length;
  await writeLink({ calendarId: calendar.id, syncedAt: now.toISOString(), count: total });
  stale = false;
  if (failed && !total) throw new PhoneCalendarError('write', "Your phone's calendar didn't accept the events. Please try again.");
  return { added, updated, removed, total, created };
}

/** Delete the ÖRZA calendar (and every event in it) from the phone and forget the link. */
export async function removePhoneCalendar(): Promise<void> {
  if (!phoneCalendarSupported) return;
  if ((await getPhonePermission()) !== 'granted') {
    throw new PhoneCalendarError('permission', 'Allow calendar access for ÖRZA in Settings to remove its calendar, or delete the ÖRZA calendar in your Calendar app.');
  }
  const link = await readLink();
  const calendar = (link && (await getCalendarById(link.calendarId))) || (await findOwnCalendar());
  if (calendar) {
    try {
      await calendar.delete();
    } catch {
      throw new PhoneCalendarError('write', "Couldn't remove the ÖRZA calendar. You can also delete it in your Calendar app.");
    }
  }
  await writeLink(null);
  writeMap(null);
}
