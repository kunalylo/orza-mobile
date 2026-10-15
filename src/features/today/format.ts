/**
 * Labels and unit helpers for the Today screen (web `components/today/format.ts`).
 * `date` values are calendar days ("YYYY-MM-DD") in the user's timezone.
 */
import { MONTHS_LONG, addDays } from '@/features/meals/utils';

const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const parts = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return { y, m, d, wd: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
};

/** "Tuesday, 23 September" */
export function formatLong(date: string): string {
  const p = parts(date);
  return `${WEEKDAYS_LONG[p.wd]}, ${p.d} ${MONTHS_LONG[p.m - 1]}`;
}

/** "Tuesday" */
export const weekdayLong = (date: string) => WEEKDAYS_LONG[parts(date).wd];

/** "Tue" */
export const weekdayShort = (date: string) => WEEKDAYS_SHORT[parts(date).wd];

export const dayOfMonth = (date: string) => parts(date).d;

/** "Today" / "Yesterday" / "Sun, 21 Sep" */
export function relativeDay(date: string, today: string): string {
  if (date === today) return 'Today';
  if (date === addDays(today, -1)) return 'Yesterday';
  const p = parts(date);
  return `${WEEKDAYS_SHORT[p.wd]}, ${p.d} ${MONTHS_LONG[p.m - 1].slice(0, 3)}`;
}

export function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  if (hour >= 17 && hour < 23) return 'Good evening';
  return 'Hello';
}

/* ───────────────────────────── Units ───────────────────────────── */

export const KG_PER_LB = 0.45359237;
export const kgToDisplay = (kg: number, imperial: boolean) => (imperial ? Math.round((kg / KG_PER_LB) * 10) / 10 : Math.round(kg * 10) / 10);
export const displayToKg = (v: number, imperial: boolean) => (imperial ? Math.round(v * KG_PER_LB * 10) / 10 : Math.round(v * 10) / 10);

/** 1750 → "1.75 L", 500 → "500 ml" */
export const formatMl = (ml: number) => (ml >= 1000 ? `${(ml / 1000).toFixed(ml % 1000 === 0 ? 0 : 2).replace(/0$/, '')} L` : `${ml} ml`);

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/* ───────────────────────────── Limits (server zod schemas) ───────────────────────────── */

export const MAX_GLASSES = 40;
export const MAX_STEPS = 100_000;
export const MIN_KG = 20;
export const MAX_KG = 400;
