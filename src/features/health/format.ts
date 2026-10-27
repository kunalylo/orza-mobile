/** Display helpers for the Health screen (pure; same wording as the web page). */
import { SOURCE_LABELS, type HealthSource } from './types';

const intl = new Intl.NumberFormat('en-IN');

export const formatInt = (n: number) => intl.format(Math.round(n));

/** 432 → "7h 12m" */
export function formatSleep(minutes: number): string {
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r}m`;
  return r ? `${h}h ${r}m` : `${h}h`;
}

export const formatKg = (kg: number) => (Math.round(kg * 10) / 10).toFixed(1);

const pad = (n: number) => String(n).padStart(2, '0');

/** Local `YYYY-MM-DD` for a Date. */
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `YYYY-MM-DD` shifted by whole days (calendar arithmetic, DST-safe). */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return dateKey(new Date(y, m - 1, d + n));
}

/** Today in the user's time zone (falls back to the phone's). */
export function todayIn(timeZone: string | undefined): string {
  try {
    if (timeZone) {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      if (/^\d{4}-\d{2}-\d{2}$/.test(parts)) return parts;
    }
  } catch {
    // Unknown zone — use the phone's.
  }
  return dateKey(new Date());
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parts(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  return { y, m, d, wd: new Date(y, m - 1, d).getDay() };
}

/** "2026-09-24" → "24 Sep" (or "24 Sep 2025" with `withYear`). */
export function formatDay(date: string, withYear = false): string {
  const p = parts(date);
  return `${p.d} ${MONTHS[p.m - 1]}${withYear ? ` ${p.y}` : ''}`;
}

/** "Today", "Yesterday", "Mon 22 Sep" relative to the user's today. */
export function formatRelativeDay(date: string, today: string): string {
  if (date === today) return 'Today';
  if (date === addDays(today, -1)) return 'Yesterday';
  const p = parts(date);
  return `${WEEKDAYS[p.wd]} ${p.d} ${MONTHS[p.m - 1]}`;
}

/**
 * ISO instant → "just now", "5 min ago", "3 h ago", "2 days ago", or a date for anything older than a week. Whole units
 * that have passed (a sync 1 h 42 min ago is "1 h ago", not "2 h ago" — never older than it really is).
 */
export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) return 'just now';
  const min = Math.floor(s / 60);
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return d === 1 ? 'yesterday' : `${d} days ago`;
  const x = new Date(t);
  return `${x.getDate()} ${MONTHS[x.getMonth()]} ${x.getFullYear()}`;
}

export const sourceLabel = (s: HealthSource | string) => SOURCE_LABELS[s as HealthSource] ?? s;

/** Compact axis labels: 12500 → "13k", 1500 → "1.5k". */
export const compact = (v: number) =>
  Math.abs(v) >= 10_000 ? `${Math.round(v / 1000)}k` : Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(Math.round(v * 10) / 10);

/** "Nice" axis ticks covering [min, max] (1 / 2 / 2.5 / 5 × 10^n steps). */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0];
  if (max === min) {
    const pad2 = Math.abs(max) > 0 ? Math.abs(max) * 0.1 : 1;
    min -= pad2;
    max += pad2;
  }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return ticks;
}
