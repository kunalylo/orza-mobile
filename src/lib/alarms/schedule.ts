/**
 * Schedule engine — a port of the website's `src/lib/care/schedule.ts` plus the date helpers it needs from
 * `src/lib/dates.ts` and the quiet-hours window from `components/care/reminders/shared.ts`, so the phone computes
 * exactly the instants the server's dispatcher would. Everything is in the member's profile timezone.
 *
 * Pure: no React Native imports (the alarm planner tests run it in Node). Formatters are cached per zone because
 * constructing `Intl.DateTimeFormat` is slow on Hermes and a week of alarms needs a few hundred conversions.
 */

export const DEFAULT_TZ = 'Asia/Kolkata';

/** The schedule fields the engine reads (web `Schedule`; `days` / `end_date` / `every_n_days` optional or null). */
export interface ScheduleLike {
  times: string[];
  days?: number[] | null;
  start_date: string;
  end_date?: string | null;
  every_n_days?: number | null;
}

export interface Occurrence {
  at: Date; // UTC instant
  iso: string; // at.toISOString()
  local_date: string; // YYYY-MM-DD
  local_time: string; // HH:MM
}

export const isHHMM = (s: unknown): s is string => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
export const isISODate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/* ───────────────────────────── Timezones ───────────────────────────── */

const zoneCache = new Map<string, boolean>();

/** True for an IANA zone this JS engine understands. */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz) return false;
  const known = zoneCache.get(tz);
  if (known !== undefined) return known;
  let ok = false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    ok = true;
  } catch {
    ok = false;
  }
  zoneCache.set(tz, ok);
  return ok;
}

/** `tz` when valid, else IST (the website's default). */
export function safeTimeZone(tz: string | null | undefined): string {
  return isValidTimeZone(tz) ? tz : DEFAULT_TZ;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    formatters.set(tz, f);
  }
  return f;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function zonedParts(tz: string, d: Date): ZonedParts {
  const parts = partsFormatter(safeTimeZone(tz)).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    // Some engines print midnight as "24" even with hourCycle h23.
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: WEEKDAYS.indexOf(get('weekday')),
  };
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Offset (minutes, local − UTC) of `tz` at instant `d`. */
export function tzOffsetMinutes(tz: string, d: Date): number {
  const p = zonedParts(tz, d);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(d.getTime() / 1000) * 1000) / 60000);
}

/** UTC instant for a local wall-clock date + "HH:MM" in `tz` (handles DST by re-checking the offset). */
export function zonedToUtc(date: string, time: string, tz: string = DEFAULT_TZ): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const off = tzOffsetMinutes(tz, new Date(guess));
  let utc = guess - off * 60000;
  const off2 = tzOffsetMinutes(tz, new Date(utc));
  if (off2 !== off) utc = guess - off2 * 60000;
  return new Date(utc);
}

/** Local { date: "YYYY-MM-DD", time: "HH:MM", weekday: 0-6 } of an instant in `tz`. */
export function utcToZoned(d: Date, tz: string = DEFAULT_TZ): { date: string; time: string; weekday: number } {
  const p = zonedParts(tz, d);
  return { date: `${p.year}-${pad2(p.month)}-${pad2(p.day)}`, time: `${pad2(p.hour)}:${pad2(p.minute)}`, weekday: p.weekday };
}

/* ───────────────────────────── Calendar days ───────────────────────────── */

/** Add days to a YYYY-MM-DD string (calendar arithmetic, timezone-free). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Days between two YYYY-MM-DD dates (b − a). */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

/* ───────────────────────────── Occurrences ───────────────────────────── */

/** Is `schedule` active on local calendar day `date`? */
export function activeOnDate(schedule: ScheduleLike, date: string): boolean {
  if (!isISODate(schedule.start_date)) return false;
  if (date < schedule.start_date) return false;
  if (schedule.end_date && date > schedule.end_date) return false;
  const n = Math.max(1, Math.floor(schedule.every_n_days || 1));
  if (n > 1 && daysBetween(schedule.start_date, date) % n !== 0) return false;
  if (schedule.days?.length) {
    const [y, m, d] = date.split('-').map(Number);
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (!schedule.days.includes(weekday)) return false;
  }
  return true;
}

/** Occurrences of `schedule` on local day `date` (sorted by time). Malformed times are ignored. */
export function occurrencesOnDate(schedule: ScheduleLike, date: string, tz: string = DEFAULT_TZ): Occurrence[] {
  if (!activeOnDate(schedule, date)) return [];
  return [...new Set((schedule.times || []).filter(isHHMM))].sort().map((time) => {
    const at = zonedToUtc(date, time, tz);
    return { at, iso: at.toISOString(), local_date: date, local_time: time };
  });
}

/** All occurrences with `from <= at < to` (UTC instants). Scans the local days that overlap the window. */
export function occurrencesBetween(schedule: ScheduleLike, from: Date, to: Date, tz: string = DEFAULT_TZ): Occurrence[] {
  if (to <= from) return [];
  const first = addDays(utcToZoned(from, tz).date, -1);
  const last = addDays(utcToZoned(to, tz).date, 1);
  const span = Math.min(daysBetween(first, last), 400); // hard cap
  const out: Occurrence[] = [];
  for (let i = 0; i <= span; i++) {
    for (const o of occurrencesOnDate(schedule, addDays(first, i), tz)) {
      if (o.at >= from && o.at < to) out.push(o);
    }
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/* ───────────────────────────── Quiet hours ───────────────────────────── */

export interface QuietHours {
  start: string;
  end: string;
}

/** The window when valid (HH:MM, start ≠ end), else null — like the web's `quietHoursOf`. */
export function validQuietHours(q: QuietHours | null | undefined): QuietHours | null {
  if (!q || !isHHMM(q.start) || !isHHMM(q.end) || q.start === q.end) return null;
  return { start: q.start, end: q.end };
}

/** Is local wall-clock `time` ("HH:MM") inside quiet hours? Handles windows that cross midnight (22:00 → 07:00). */
export function inQuietWindow(quiet: QuietHours | null | undefined, time: string): boolean {
  const q = validQuietHours(quiet);
  if (!q) return false;
  return q.start < q.end ? time >= q.start && time < q.end : time >= q.start || time < q.end;
}

/** Is instant `at` inside the quiet hours, read in `tz`? */
export function isQuietAt(quiet: QuietHours | null | undefined, at: Date, tz: string): boolean {
  if (!validQuietHours(quiet)) return false;
  return inQuietWindow(quiet, utcToZoned(at, tz).time);
}
