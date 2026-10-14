/** Date / meal formatting for Ask ÖRZA (mirrors the web's components/chat/format.ts). */
import type { MealItem, MealType } from './types';

/** Local calendar key for grouping by day. */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function daysAgo(iso: string): number {
  const d = new Date(iso);
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const now = new Date();
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((b - a) / 86_400_000);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "9:41 pm" — built by hand so it reads the same on every Android / iOS Intl build. */
export function clockTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const h = d.getHours();
  const m = d.getMinutes();
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/** "Today", "Yesterday", "Mon, 12 Sep" (+ year when not this year). */
export function dayLabel(iso: string): string {
  const n = daysAgo(iso);
  if (n === 0) return 'Today';
  if (n === 1) return 'Yesterday';
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}${sameYear ? '' : ` ${d.getFullYear()}`}`;
}

/** Compact stamp for the sessions list: "9:41 pm", "Yesterday", "Mon", "12 Sep". */
export function sessionStamp(iso: string): string {
  const n = daysAgo(iso);
  if (n === 0) return clockTime(iso);
  if (n === 1) return 'Yesterday';
  const d = new Date(iso);
  if (n > 1 && n < 7) return WEEKDAYS[d.getDay()];
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${sameYear ? '' : ` ${String(d.getFullYear()).slice(2)}`}`;
}

/** "Today" / "Yesterday" / "Mon, 12 Sep" for a YYYY-MM-DD meal date. */
export function mealDateLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  return dayLabel(new Date(y, m - 1, d, 12).toISOString());
}

export const MEAL_TYPE_LABEL: Record<MealType, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };

function fmtQty(q: number): string {
  const whole = Math.floor(q);
  const frac = Math.round((q - whole) * 100) / 100;
  const f = frac === 0.5 ? '½' : frac === 0.25 ? '¼' : frac === 0.75 ? '¾' : frac ? String(Math.round(frac * 10) / 10).slice(1) : '';
  if (!whole && f) return f.startsWith('.') ? `0${f}` : f;
  return `${whole}${f}`;
}

const GENERIC_UNITS = new Set(['serving', 'servings', 'piece', 'pieces', 'pc', 'pcs', 'nos', 'no', 'item', 'unit', '']);

/** "2 × Paratha" or "Dal Tadka (1 katori)". */
export function itemLabel(i: Pick<MealItem, 'name' | 'quantity' | 'unit'>): string {
  const unit = (i.unit || '').trim();
  if (GENERIC_UNITS.has(unit.toLowerCase()) || unit.toLowerCase() === i.name.toLowerCase()) return `${fmtQty(i.quantity)} × ${i.name}`;
  return `${i.name} (${fmtQty(i.quantity)} ${unit})`;
}

/** 1234.5 → "1,235"; 12.34 → "12.3" (grams keep one decimal). */
export function formatNumber(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return '0';
  const factor = 10 ** digits;
  const rounded = Math.round(n * factor) / factor;
  const [int, dec] = String(Math.abs(rounded)).split('.');
  const withCommas = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${rounded < 0 ? '−' : ''}${withCommas}${dec ? `.${dec}` : ''}`;
}

/** Grams: whole numbers stay whole, otherwise one decimal. */
export function grams(n: number): string {
  return formatNumber(n, Number.isInteger(n) ? 0 : 1);
}
