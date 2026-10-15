/** Report display helpers + the weekly CSV (same wording and columns as the web's `src/components/reports/format.ts`). */
import { addDays, kgToUnit, weightUnit } from '@/features/goals/math';

import type { DailyReport, WeeklyReport } from './types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function parts(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  return { y, m, d, wd: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

export const weekdayShort = (date: string) => WEEKDAYS[parts(date).wd];
export const weekdayLong = (date: string) => WEEKDAYS_LONG[parts(date).wd];
export const dayOfMonth = (date: string) => Number(date.slice(8, 10));
/** "24 Sep" */
export const dayMonth = (date: string) => {
  const p = parts(date);
  return `${p.d} ${MONTHS[p.m - 1]}`;
};
/** "Wednesday, 24 September 2026" */
export const longDate = (date: string) => {
  const p = parts(date);
  return `${WEEKDAYS_LONG[p.wd]}, ${p.d} ${MONTHS_LONG[p.m - 1]} ${p.y}`;
};
export const monthTitle = (y: number, m: number) => `${MONTHS_LONG[m - 1]} ${y}`;

/** "Today" / "Yesterday" / "Mon, 22 Sep" (+ year when it isn't this year). */
export function dayLabel(date: string, today: string) {
  if (date === today) return 'Today';
  if (date === addDays(today, -1)) return 'Yesterday';
  const p = parts(date);
  const base = `${WEEKDAYS[p.wd]}, ${p.d} ${MONTHS[p.m - 1]}`;
  return date.slice(0, 4) !== today.slice(0, 4) ? `${base} ${p.y}` : base;
}

/** "18 – 24 Sep 2026", "28 Sep – 4 Oct 2026", "29 Dec 2025 – 4 Jan 2026". */
export function rangeLabel(start: string, end: string) {
  const s = parts(start);
  const e = parts(end);
  const endStr = `${e.d} ${MONTHS[e.m - 1]} ${e.y}`;
  const startStr = s.y !== e.y ? `${s.d} ${MONTHS[s.m - 1]} ${s.y}` : s.m !== e.m ? `${s.d} ${MONTHS[s.m - 1]}` : `${s.d}`;
  return `${startStr} – ${endStr}`;
}

export const MEAL_LABELS: Record<string, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };

/** Short friendly line under the day score (never a judgment of food). */
export function scoreMood(r: Pick<DailyReport, 'score' | 'meals' | 'tracking'>) {
  if (!r.meals.length && !r.tracking.water_glasses && !r.tracking.steps) return 'Nothing logged yet';
  if (r.score >= 80) return 'Beautifully balanced';
  if (r.score >= 60) return 'Nicely on track';
  if (r.score >= 35) return 'Building momentum';
  return 'Every day is a fresh start';
}

/* ───────────────────────────── CSV export ───────────────────────────── */

const csvCell = (v: string | number | null | undefined) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const weeklyCsvName = (w: Pick<WeeklyReport, 'start' | 'end'>) => `orza-weekly-${w.start}-to-${w.end}.csv`;

/** Weekly data as CSV (one row per day, then averages and targets). Weights in kg, or lb when `imperial`. */
export function weeklyCsv(w: WeeklyReport, imperial = false): string {
  const header = ['Date', 'Day', 'Calories (kcal)', 'Protein (g)', 'Carbs (g)', 'Fat (g)', 'Fibre (g)', 'Water (glasses)', 'Steps', `Weight (${weightUnit(imperial)})`, 'Meals logged', 'Day score'];
  const rows: (string | number | null | undefined)[][] = w.days.map((d) => [
    d.date,
    weekdayShort(d.date),
    d.calories,
    d.protein_g,
    d.carbs_g,
    d.fat_g,
    d.fiber_g,
    d.water_glasses,
    d.steps,
    d.weight_kg != null ? kgToUnit(d.weight_kg, imperial) : '',
    d.meals_count,
    d.meals_count ? d.score : '',
  ]);
  const a = w.averages;
  const t = w.targets;
  rows.push([]);
  rows.push(['Average (logged days)', '', a.calories, a.protein_g, a.carbs_g, a.fat_g, a.fiber_g, a.water_glasses, a.steps, w.weight ? kgToUnit(w.weight.last, imperial) : '', w.logged_days, '']);
  rows.push(['Daily target', '', t.calories, t.protein_g, t.carbs_g, t.fat_g, t.fiber_g, t.water_glasses, t.steps, '', '', '']);
  rows.push([]);
  rows.push(['Days within ±10% of calorie target', '', w.adherence]);
  rows.push(['Summary', '', w.summary]);
  rows.push(['Note', '', 'Self-logged wellness data from ÖRZA. Estimates only — not a medical record.']);
  // BOM so Excel opens the UTF-8 file (ÖRZA, ±) correctly.
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}
