/** Rebalance (compassionate rebalancing) — shapes of /api/compensation/* plus the form's choices. */
import type { IconName } from '@/ui';

export interface CompensationDay {
  /** YYYY-MM-DD */
  date: string;
  calorie_target: number;
  /** Negative kcal vs the usual target. */
  adjustment: number;
  focus: string;
  activity: string;
  meals: string[];
}

export interface CompensationSummary {
  usual_calories: number;
  floor_calories: number;
  /** Total gently trimmed from meals. */
  food_kcal: number;
  /** Total covered by added movement. */
  activity_kcal: number;
  /** Left to even out naturally. */
  released_kcal: number;
  avg_daily_trim: number;
  walk_minutes_per_day: number;
  extra_steps_per_day: number;
  /** First day after the plan (YYYY-MM-DD). */
  back_to_usual: string;
}

export interface RebalancePlan {
  id: string;
  user_id: string;
  occasion: string;
  description?: string;
  extra_calories: number;
  days: CompensationDay[];
  message: string;
  summary?: CompensationSummary;
  ai?: boolean;
  /** extra_calories was estimated from the description rather than entered. */
  estimated?: boolean;
  created_at: string;
}

/** GET /compensation */
export interface RebalanceListResponse {
  plans: RebalancePlan[];
  ai_enabled?: boolean;
  cost?: number;
}

/** POST /compensation/plan */
export interface RebalanceRequest {
  occasion: string;
  description?: string;
  extra_calories?: number;
  days?: number;
}

export interface RebalanceCreateResponse {
  plan: RebalancePlan;
  credits?: number;
  estimate?: { calories: number; matched: string[]; source: 'parsed' | 'default' };
  notice?: string;
}

export const OCCASIONS: { value: string; label: string; icon: IconName }[] = [
  { value: 'Wedding', label: 'Wedding', icon: 'mci:diamond-stone' },
  { value: 'Birthday', label: 'Birthday', icon: 'mci:cake-variant' },
  { value: 'Festival', label: 'Festival', icon: 'mci:star-four-points-outline' },
  { value: 'Party', label: 'Party', icon: 'mci:party-popper' },
  { value: 'Vacation', label: 'Vacation', icon: 'mci:airplane' },
  { value: 'Other', label: 'Other', icon: 'mci:pencil-outline' },
];

export const PLACEHOLDERS: Record<string, string> = {
  Wedding: 'e.g. Wedding buffet — paneer tikka, biryani, 2 gulab jamun',
  Birthday: 'e.g. 2 slices of chocolate cake, pizza and a cold drink',
  Festival: 'e.g. Diwali sweets — 3 kaju katli, samosa and chole bhature',
  Party: 'e.g. Fries, nachos, 2 slices of pizza and a mocktail',
  Vacation: 'e.g. Big hotel breakfast buffet and a seafood dinner',
  Other: 'e.g. Dinner out — butter chicken, 2 butter naan and dessert',
};

export const PRINCIPLES: { icon: IconName; title: string; body: string }[] = [
  { icon: 'mci:leaf', title: 'Gentle trims, never starving', body: 'At most 15% off your usual calories on any day — and never below a safe floor for your body.' },
  { icon: 'mci:shoe-print', title: 'A little extra movement', body: 'An easy walk, a dance session or the stairs — something you enjoy, never a punishment.' },
  { icon: 'mci:calendar-check', title: 'Back to your rhythm in 2–5 days', body: 'No skipped meals, no detoxes, no guilt. Just steady, kind choices.' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parseDay(date: string): Date | null {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

/** "Mon, 24 Sep" from YYYY-MM-DD. */
export function formatDayDate(date: string): string {
  const d = parseDay(date);
  return d ? `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}` : date;
}

/** "24 Sep" from YYYY-MM-DD. */
export function formatShortDate(date: string): string {
  const d = parseDay(date);
  return d ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}` : date;
}

/** "24 Sep 2026" from an ISO timestamp. */
export function createdLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

const CHIP_OCCASION = /^(wedding|birthday|festival|party|vacation)$/i;

/** "After the wedding" / "After my birthday" / the occasion as typed. */
export function resultTitle(occasion: string): string {
  const o = occasion.trim();
  if (CHIP_OCCASION.test(o)) return `After the ${o.toLowerCase()}`;
  if (/^(the|my|our|a|an|your)\s/i.test(o)) return `After ${o.charAt(0).toLowerCase()}${o.slice(1)}`;
  return o;
}

const MEAL_PREFIX = /^(breakfast|lunch|dinner|snack|evening snack)\s*[:\-–—]\s*/i;

/** "Lunch: Rajma with brown rice" → { label: "Lunch", text: "Rajma with brown rice" }. */
export function splitMeal(s: string): { label: string | null; text: string } {
  const m = s.match(MEAL_PREFIX);
  if (!m) return { label: null, text: s };
  const label = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
  return { label, text: s.slice(m[0].length) };
}
