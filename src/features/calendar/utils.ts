/**
 * Pure date / grouping / insight helpers for the calendar screen, ported from the website's
 * `components/care/calendar/utils.ts`. All "dates" are local calendar days ("YYYY-MM-DD") in the user's timezone.
 */
import { addDaysISO as addDays, daysBetweenISO as daysBetween, formatTime12, MONTHS_LONG } from '@/features/meds/shared';

import type { CalendarEvent, CalendarEventKind } from './types';

export { addDays, daysBetween };

export const WEEKDAYS_MON_FIRST = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export const WEEKDAY_NAMES_MON_FIRST = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
export const KIND_ORDER: CalendarEventKind[] = ['medication', 'reminder', 'meal', 'external'];

/** Busy time (timed, "busy" events from the user's own calendar) at which a day counts as packed. */
export const BUSY_DAY_MINUTES = 240;

/* ───────────────────────────── Timezone maths ───────────────────────────── */

const formatters = new Map<string, Intl.DateTimeFormat | null>();
function formatterFor(tz: string): Intl.DateTimeFormat | null {
  if (!formatters.has(tz)) {
    try {
      formatters.set(
        tz,
        new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      );
    } catch {
      formatters.set(tz, null);
    }
  }
  return formatters.get(tz) ?? null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Local wall-clock parts of an instant in `tz`. */
export function zonedParts(instant: Date, tz: string): { date: string; time: string } {
  const f = formatterFor(tz);
  if (f) {
    const parts = f.formatToParts(instant);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    const hour = get('hour') === '24' ? '00' : get('hour').padStart(2, '0');
    return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${hour}:${get('minute')}` };
  }
  return {
    date: `${instant.getFullYear()}-${pad(instant.getMonth() + 1)}-${pad(instant.getDate())}`,
    time: `${pad(instant.getHours())}:${pad(instant.getMinutes())}`,
  };
}

/** Local day an ISO instant falls on in `tz`. */
export const localDate = (iso: string, tz: string) => zonedParts(new Date(iso), tz).date;

/** Offset of `tz` from UTC at an instant, in ms (IST → +19 800 000). */
function offsetMs(t: number, tz: string): number {
  const { date, time } = zonedParts(new Date(t), tz);
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const asUtc = Date.UTC(y, m - 1, d, h, mi);
  return asUtc - Math.floor(t / 60000) * 60000;
}

/** The instant a local wall-clock time ("HH:MM" on "YYYY-MM-DD") happens in `tz`. */
export function zonedToUtc(date: string, hhmm: string, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const first = offsetMs(guess, tz);
  let t = guess - first;
  const second = offsetMs(t, tz);
  if (second !== first) t = guess - second;
  return new Date(t);
}

/* ───────────────────────────── Grid ───────────────────────────── */

/** 0 = Sunday … 6 = Saturday */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Monday on or before `date`. */
export const mondayOf = (date: string) => addDays(date, -((weekdayOf(date) + 6) % 7));

export const monthOf = (date: string) => date.slice(0, 7);

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Dates shown in a Monday-first month grid: whole weeks covering the month (4–6 rows). */
export function monthGridDates(month: string): string[] {
  const first = `${month}-01`;
  const start = mondayOf(first);
  const lead = daysBetween(start, first);
  const weeks = Math.ceil((lead + daysInMonth(month)) / 7);
  return Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i));
}

/** The same day-of-month in another month (clamped: 31 Jan → 28/29 Feb). */
export function sameDayIn(month: string, date: string): string {
  const day = Math.min(Number(date.slice(8, 10)) || 1, daysInMonth(month));
  return `${month}-${pad(day)}`;
}

/* ───────────────────────────── Grouping ───────────────────────────── */

/** Local dates an event occupies (multi-day timed and all-day events span several). */
export function eventDates(e: CalendarEvent, tz: string): string[] {
  if (e.all_day) {
    const end = e.end && e.end > e.start ? e.end : addDays(e.start, 1);
    const n = Math.min(Math.max(1, daysBetween(e.start, end)), 62);
    return Array.from({ length: n }, (_, i) => addDays(e.start, i));
  }
  const startMs = Date.parse(e.start);
  if (Number.isNaN(startMs)) return [];
  const first = zonedParts(new Date(startMs), tz).date;
  if (!e.end) return [first];
  const endMs = Date.parse(e.end);
  if (!(endMs > startMs)) return [first];
  // Exclusive end: an event ending exactly at midnight doesn't occupy the next day.
  const last = zonedParts(new Date(endMs - 1), tz).date;
  const n = Math.min(Math.max(1, daysBetween(first, last) + 1), 62);
  return Array.from({ length: n }, (_, i) => addDays(first, i));
}

export function compareEvents(a: CalendarEvent, b: CalendarEvent): number {
  if (a.all_day !== b.all_day) return a.all_day ? -1 : 1;
  if (a.start !== b.start) return a.start < b.start ? -1 : 1;
  return KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.title.localeCompare(b.title);
}

/** Map of local date → events on that day (all-day first, then by start time). */
export function groupByDate(events: CalendarEvent[], tz: string): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    for (const d of eventDates(e, tz)) {
      const list = map.get(d);
      if (list) list.push(e);
      else map.set(d, [e]);
    }
  }
  for (const list of map.values()) list.sort(compareEvents);
  return map;
}

/** Distinct kinds on a day, in legend order (for the month grid dots). */
export function kindsOf(events: CalendarEvent[] | undefined): CalendarEventKind[] {
  if (!events?.length) return [];
  const set = new Set(events.map((e) => e.kind));
  return KIND_ORDER.filter((k) => set.has(k));
}

/* ───────────────────────────── Formatting ───────────────────────────── */

/** "8:00 am" */
export function formatTime(iso: string, tz: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return formatTime12(zonedParts(d, tz).time);
}

/** "10:00 am – 11:30 am" for your own calendar's events (others show just the start). */
export function formatTimeRange(e: CalendarEvent, tz: string, onDate?: string): string {
  if (e.all_day) return 'All day';
  const start = formatTime(e.start, tz);
  if (!e.end || e.kind !== 'external') return start;
  const startsToday = !onDate || localDate(e.start, tz) === onDate;
  const endsToday = !onDate || zonedParts(new Date(Date.parse(e.end) - 1), tz).date === onDate;
  return `${startsToday ? start : 'Earlier'} – ${endsToday ? formatTime(e.end, tz) : 'later'}`;
}

/** "October 2026" */
export function formatMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS_LONG[m - 1]} ${y}`;
}

/** "Thursday, 24 September" */
export function formatLongDate(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${WEEKDAY_NAMES_MON_FIRST[(weekdayOf(date) + 6) % 7]}, ${d} ${MONTHS_LONG[m - 1]}`;
}

/* ───────────────────────────── Busy-day insight ───────────────────────────── */

type Interval = [number, number];

function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = [...list].sort((a, b) => a[0] - b[0]);
  const out: Interval[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
    else out.push([iv[0], iv[1]]);
  }
  return out;
}

/** Busy blocks from the user's own calendar on `date`, clipped to the local day and merged. */
export function busyBlocks(events: CalendarEvent[], date: string, tz: string): Interval[] {
  const dayStart = zonedToUtc(date, '00:00', tz).getTime();
  const dayEnd = zonedToUtc(addDays(date, 1), '00:00', tz).getTime();
  const list: Interval[] = [];
  for (const e of events) {
    if (e.kind !== 'external' || e.all_day || e.busy === false || !e.end) continue;
    const s = Math.max(Date.parse(e.start), dayStart);
    const en = Math.min(Date.parse(e.end), dayEnd);
    if (en > s) list.push([s, en]);
  }
  return mergeIntervals(list);
}

export function busyMinutes(events: CalendarEvent[], date: string, tz: string): number {
  return Math.round(busyBlocks(events, date, tz).reduce((sum, [s, e]) => sum + (e - s), 0) / 60000);
}

export interface DayInsight {
  id: string;
  tone: 'energy' | 'cyan';
  title: string;
  body: string;
}

const hoursLabel = (min: number) => {
  const h = Math.round((min / 60) * 2) / 2;
  return `${h % 1 ? h.toFixed(1) : h} ${h === 1 ? 'hour' : 'hours'}`;
};

/**
 * Gentle, food-first nudges from the user's own calendar for one day:
 * - ≥ 4 h busy → "Busy day — plan a packed lunch"
 * - no free 30 minutes between 12:00 and 14:30 → eat before the first meeting in that window
 * - a medicine dose inside a busy block → keep the medicine with you
 */
export function dayInsights(events: CalendarEvent[], date: string, tz: string, now: Date = new Date()): DayInsight[] {
  const blocks = busyBlocks(events, date, tz);
  if (!blocks.length) return [];
  const out: DayInsight[] = [];
  const minutes = Math.round(blocks.reduce((sum, [s, e]) => sum + (e - s), 0) / 60000);
  const dayEnd = zonedToUtc(addDays(date, 1), '00:00', tz).getTime();
  if (dayEnd <= now.getTime()) return [];

  if (minutes >= BUSY_DAY_MINUTES) {
    out.push({
      id: 'busy',
      tone: 'energy',
      title: 'Busy day — plan a packed lunch',
      body: `About ${hoursLabel(minutes)} of this day is booked. Pack lunch and a snack the night before and keep water within reach, so a long day doesn't turn into skipped meals.`,
    });
  }

  const lunchStart = zonedToUtc(date, '12:00', tz).getTime();
  const lunchEnd = zonedToUtc(date, '14:30', tz).getTime();
  const inLunch = blocks.filter(([s, e]) => e > lunchStart && s < lunchEnd);
  if (inLunch.length) {
    let cursor = lunchStart;
    let longestGap = 0;
    for (const [s, e] of inLunch) {
      longestGap = Math.max(longestGap, s - cursor);
      cursor = Math.max(cursor, e);
    }
    longestGap = Math.max(longestGap, lunchEnd - cursor);
    if (longestGap < 30 * 60000) {
      const firstStart = inLunch[0][0];
      out.push({
        id: 'lunch',
        tone: 'energy',
        title: 'Meetings run through lunch',
        body:
          firstStart <= lunchStart
            ? "There's no 30-minute break between 12 and 2:30. Have a filling breakfast, and keep a snack you can eat between calls."
            : `There's no 30-minute break between 12 and 2:30. Eat something before ${formatTime(new Date(firstStart).toISOString(), tz)}, or keep a snack you can have between calls.`,
      });
    }
  }

  const clash = events.find(
    (e) =>
      e.kind === 'medication' &&
      (e.status === 'upcoming' || e.status === 'due' || e.status === 'snoozed') &&
      blocks.some(([s, en]) => {
        const t = Date.parse(e.start);
        return t >= s && t < en;
      })
  );
  if (clash) {
    out.push({
      id: `dose-${clash.id}`,
      tone: 'cyan',
      title: `Your ${formatTime(clash.start, tz)} dose falls in a busy stretch`,
      body: `Keep ${clash.title} with you so a meeting doesn't push the dose back.`,
    });
  }
  return out.slice(0, 3);
}

/* ───────────────────────────── Event ids ───────────────────────────── */

/** `med_<medicationId>_<iso>` → {medicationId, at}. Medication ids never contain "_" followed by an ISO date. */
export function parseDoseEventId(id: string): { medicationId: string; at: string } | null {
  const m = /^med_(.+)_(\d{4}-\d{2}-\d{2}T[^_]+)$/.exec(id);
  return m ? { medicationId: m[1], at: m[2] } : null;
}

/** `rem_<reminderId>_<iso>` → reminder id. */
export function parseReminderEventId(id: string): string | null {
  const m = /^rem_(.+)_(\d{4}-\d{2}-\d{2}T[^_]+)$/.exec(id);
  return m ? m[1] : null;
}
