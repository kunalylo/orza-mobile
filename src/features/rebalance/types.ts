/** Rebalance (compassionate rebalancing) — shapes of /api/compensation/* plus the form's choices and pure texts. */
import type { IconName } from '@/ui';

import { formatNumber } from '../chat/format';

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
  {
    icon: 'mci:leaf',
    title: 'Gentle trims, never starving',
    body: 'At most 15% off your usual calories on any day, and never below a safe floor for your body — if your target is already at or under it, meals stay as they are.',
  },
  { icon: 'mci:shoe-print', title: 'A little extra movement', body: 'An easy walk, a dance session or the stairs — something you enjoy, never a punishment.' },
  { icon: 'mci:calendar-check', title: 'Back to your rhythm in 2–5 days', body: 'No skipped meals, no detoxes, no guilt. Just steady, kind choices.' },
];

/* ───────────────────────────── The safe floor (web RebalancePlanView) ───────────────────────────── */

type FloorFields = Pick<CompensationSummary, 'usual_calories' | 'floor_calories'>;

/**
 * No room for even a 10 kcal trim above the safety floor (web `noRoomToTrim`): the usual target is already at, or
 * under, the floor — "never below {floor} kcal" next to days at the usual target would contradict itself.
 */
export const isAtFloor = (s: FloorFields) => s.usual_calories - s.floor_calories < 10;

/** …and clearly under it (web `belowSafeFloor`, e.g. a hand-set 1,400 with a floor of 1,700). */
export const isBelowFloor = (s: FloorFields) => s.floor_calories - s.usual_calories >= 10;

/** The "Gentle trim" tile: value + note (`avgTrim` kcal/day, over `days` days). */
export function trimTile(s: FloorFields | undefined, avgTrim: number, days: number): { v: string; note: string } {
  const atFloor = !!s && isAtFloor(s);
  const belowFloor = !!s && isBelowFloor(s);
  return {
    v: avgTrim > 0 ? `~${formatNumber(avgTrim)} kcal/day` : atFloor ? 'None' : 'None needed',
    note: belowFloor ? 'Already below your safe minimum' : atFloor ? 'Already at your safe minimum' : `Over ${days} day${days === 1 ? '' : 's'}, no skipped meals`,
  };
}

/**
 * The note under "ÖRZA says": why meals aren't trimmed (at / below the floor) and / or the calories left to even out
 * naturally — null when there's nothing to say. Same wording as the web.
 */
export function floorNote(s: CompensationSummary | undefined): string | null {
  if (!s) return null;
  const atFloor = isAtFloor(s);
  if (!atFloor && !(s.released_kcal > 0)) return null;
  const released = `the last ~${formatNumber(s.released_kcal)} kcal is simply left to even out naturally over the week.`;
  if (!atFloor) {
    return `Trims stay within a gentle range (never below ${formatNumber(s.floor_calories)} kcal a day) and walks stay comfortable, so ${released}`;
  }
  const lead = isBelowFloor(s)
    ? `Your usual ${formatNumber(s.usual_calories)} kcal is already below the safe floor for your body (${formatNumber(s.floor_calories)} kcal), so ÖRZA won't trim further`
    : `Your usual ${formatNumber(s.usual_calories)} kcal already sits at your body's safe floor, so ÖRZA doesn't trim meals`;
  return s.released_kcal > 0 ? `${lead}, and walks stay comfortable — ${released}` : `${lead} — a little extra movement balances this instead.`;
}

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
