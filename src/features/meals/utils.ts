/**
 * Pure helpers for the meal log — labels, the user's calendar day, portions, nutrient maths and food-list limits.
 * Mirrors the web's `components/meals/meal-utils.ts`, `lib/dates.ts` and `lib/nutrition/limits.ts`.
 */
import type { IconName } from '@/ui';
import { colors } from '@/theme';
import type { Diet } from '@/lib/types';

import type { FoodDietMark, FoodHit, MealItem, MealSource, MealType, Nutrients } from './types';

/* ───────────────────────────── Labels ───────────────────────────── */

export const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

export const MEAL_LABEL: Record<MealType, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snacks' };
export const MEAL_SINGULAR: Record<MealType, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };
export const MEAL_ICON: Record<MealType, IconName> = {
  breakfast: 'mci:weather-sunset-up',
  lunch: 'sun',
  dinner: 'moon',
  snack: 'mci:cookie-outline',
};
/** Accent per meal group (icon tile tint + ink). */
export const MEAL_TONE: Record<MealType, { bg: string; fg: string }> = {
  breakfast: { bg: colors.energyBg, fg: colors.energyInk },
  lunch: { bg: colors.cyan50, fg: colors.cyan700 },
  dinner: { bg: colors.violet50, fg: colors.violet600 },
  snack: { bg: 'rgba(20,20,20,0.05)', fg: colors.muted },
};

export const SOURCE_LABEL: Record<MealSource, string> = { photo: 'Photo', text: 'Typed', voice: 'Voice', manual: 'Food list', chat: 'Chat' };
export const SOURCE_ICON: Record<MealSource, IconName> = {
  photo: 'camera',
  text: 'type',
  voice: 'mic',
  manual: 'list',
  chat: 'message-circle',
};

export const isMealType = (s: unknown): s is MealType => typeof s === 'string' && (MEAL_TYPES as string[]).includes(s);

/** Used only when /api/credits/balance can't be reached (mirrors CREDIT_COSTS). */
export const FALLBACK_COSTS = { scan: 2, meal_text: 1 } as const;

/* ───────────────────────────── Numbers ───────────────────────────── */

export const ZERO_NUTRIENTS: Nutrients = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 };

export function round(n: number, places = 0): number {
  const f = 10 ** places;
  return Math.round((Number(n) || 0) * f) / f;
}

/** 1234 → "1,234" (Indian grouping when Intl is available). */
export function formatNumber(n: number): string {
  const v = Math.round(Number(n) || 0);
  try {
    return v.toLocaleString('en-IN');
  } catch {
    return String(v);
  }
}

export function sumNutrients(list: Partial<Nutrients>[]): Nutrients {
  const t = list.reduce<Nutrients>(
    (a, n) => ({
      calories: a.calories + (Number(n.calories) || 0),
      protein_g: a.protein_g + (Number(n.protein_g) || 0),
      carbs_g: a.carbs_g + (Number(n.carbs_g) || 0),
      fat_g: a.fat_g + (Number(n.fat_g) || 0),
      fiber_g: a.fiber_g + (Number(n.fiber_g) || 0),
    }),
    { ...ZERO_NUTRIENTS }
  );
  return {
    calories: Math.round(t.calories),
    protein_g: round(t.protein_g, 1),
    carbs_g: round(t.carbs_g, 1),
    fat_g: round(t.fat_g, 1),
    fiber_g: round(t.fiber_g, 1),
  };
}

const FRACTIONS: Record<string, string> = { '0.25': '¼', '0.5': '½', '0.75': '¾' };

/** 0.5 → "½", 1.5 → "1½", 2 → "2", 1.33 → "1.33". */
export function fmtQty(q: number): string {
  const n = round(Number(q) || 0, 2);
  const whole = Math.floor(n);
  const frac = round(n - whole, 2);
  const sym = FRACTIONS[String(frac)];
  if (sym) return whole ? `${whole}${sym}` : sym;
  return String(n);
}

/** "2 roti · 80 g" */
export function itemPortion(i: Pick<MealItem, 'quantity' | 'unit' | 'grams'>): string {
  const base = `${fmtQty(i.quantity)} ${i.unit}`;
  return i.grams && i.unit.toLowerCase() !== 'g' ? `${base} · ${Math.round(i.grams)} g` : base;
}

export const macroLine = (n: Pick<Nutrients, 'protein_g' | 'carbs_g' | 'fat_g'>) =>
  `P ${round(n.protein_g, 1)} · C ${round(n.carbs_g, 1)} · F ${round(n.fat_g, 1)}`;

/* ───────────────────────────── Days (in the user's timezone) ───────────────────────────── */

export const DEFAULT_TZ = 'Asia/Kolkata';

const pad = (n: number) => String(n).padStart(2, '0');

function partsInTz(tz: string | undefined, d = new Date()): { y: number; m: number; d: number; h: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz || DEFAULT_TZ,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(d);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const out = { y: get('year'), m: get('month'), d: get('day'), h: get('hour') % 24 };
    if ([out.y, out.m, out.d, out.h].every(Number.isFinite)) return out;
  } catch {
    // fall through to the phone's own clock
  }
  return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), h: d.getHours() };
}

/** "YYYY-MM-DD" today in `tz`. */
export function todayInTz(tz?: string): string {
  const p = partsInTz(tz);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

export function hourInTz(tz?: string): number {
  return partsInTz(tz).h;
}

/** A real calendar day in YYYY-MM-DD form (rejects e.g. 2025-02-31). */
export function isRealDay(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
];

/** "Today", "Yesterday", or e.g. "Mon, 21 Sep" (with the year when it isn't this year). */
export function formatDayLabel(date: string, today: string): string {
  if (date === today) return 'Today';
  if (date === addDays(today, -1)) return 'Yesterday';
  const [y, m, d] = date.split('-').map(Number);
  const wd = WEEKDAYS_SHORT[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const base = `${wd}, ${d} ${MONTHS_SHORT[m - 1]}`;
  return y !== Number(today.slice(0, 4)) ? `${base} ${y}` : base;
}

/** "8:05 pm" in the user's timezone ("" if the phone can't format it). */
export function formatTime(iso: string, tz?: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: tz || DEFAULT_TZ });
  } catch {
    return '';
  }
}

/** Same windows as the server's guessMealType. */
export function guessMealType(tz?: string): MealType {
  const h = hourInTz(tz);
  if (h >= 5 && h < 11) return 'breakfast';
  if (h >= 11 && h < 16) return 'lunch';
  if (h >= 19 || h < 2) return 'dinner';
  return 'snack';
}

/* ───────────────────────────── Food list limits (web lib/nutrition/limits.ts) ───────────────────────────── */

export const ITEM_LIMITS = {
  quantity: 100,
  grams: 5000,
  calories: 5000,
  protein_g: 500,
  carbs_g: 1000,
  fat_g: 500,
  fiber_g: 200,
} as const;

/** Most servings of one food logged as a single item. */
export const MAX_SERVINGS = 20;
export const MAX_ITEMS = 20;

/** Largest number of servings of `food` that fits one item (same maths as the server). */
export function maxServingsFor(food: Pick<FoodHit, 'serving' | 'per_serving' | 'restaurant_multiplier'>, restaurant = false): number {
  const p = food.per_serving;
  const m = restaurant ? Math.max(1, Number(food.restaurant_multiplier) || 1) : 1;
  const kcal = (Number(p?.calories) || 0) * m;
  const fat = (Number(p?.fat_g) || 0) + ((Number(p?.calories) || 0) * (m - 1)) / 9;
  let max: number = MAX_SERVINGS;
  const cap = (limit: number, perServing: number) => {
    if (perServing > 0) max = Math.min(max, limit / perServing);
  };
  cap(ITEM_LIMITS.grams, Number(food.serving?.grams) || 0);
  cap(ITEM_LIMITS.calories, kcal);
  cap(ITEM_LIMITS.protein_g, Number(p?.protein_g) || 0);
  cap(ITEM_LIMITS.carbs_g, Number(p?.carbs_g) || 0);
  cap(ITEM_LIMITS.fat_g, fat);
  cap(ITEM_LIMITS.fiber_g, Number(p?.fiber_g) || 0);
  return Math.max(0.01, Math.floor(max * 100 + 1e-9) / 100);
}

/** Preview of what `POST /api/meals/manual` will log (restaurant extra energy is booked as fat). */
export function foodNutrients(food: FoodHit, qty: number, restaurant: boolean): Nutrients {
  const p = food.per_serving;
  let calories = (Number(p.calories) || 0) * qty;
  let fat = (Number(p.fat_g) || 0) * qty;
  const m = restaurant ? Number(food.restaurant_multiplier) || 1 : 1;
  if (m > 1) {
    const extra = calories * (m - 1);
    calories += extra;
    fat += extra / 9;
  }
  return {
    calories: Math.round(calories),
    protein_g: round((Number(p.protein_g) || 0) * qty, 1),
    carbs_g: round((Number(p.carbs_g) || 0) * qty, 1),
    fat_g: round(fat, 1),
    fiber_g: round((Number(p.fiber_g) || 0) * qty, 1),
  };
}

/* ───────────────────────────── Diet & quick picks ───────────────────────────── */

export function dietAllowsFood(diet: Diet | undefined | null, food: FoodDietMark): boolean {
  if (diet === 'vegan') return food === 'vegan';
  if (diet === 'vegetarian' || diet === 'jain') return food === 'vegan' || food === 'veg';
  if (diet === 'eggetarian') return food !== 'nonveg';
  return true;
}

type Allergen = 'dairy' | 'gluten' | 'egg' | 'peanut' | 'tree_nut' | 'soy' | 'sesame' | 'mustard' | 'fish' | 'shellfish';

/** Search shortcuts, in order of popularity, with the allergen groups they belong to. */
const QUICK_PICKS: { label: string; diet: FoodDietMark; allergens?: Allergen[] }[] = [
  { label: 'Roti', diet: 'vegan', allergens: ['gluten'] },
  { label: 'Dal', diet: 'vegan' },
  { label: 'Rice', diet: 'vegan' },
  { label: 'Poha', diet: 'vegan' },
  { label: 'Idli', diet: 'vegan' },
  { label: 'Dosa', diet: 'vegan' },
  { label: 'Paneer', diet: 'veg', allergens: ['dairy'] },
  { label: 'Chai', diet: 'veg', allergens: ['dairy'] },
  { label: 'Egg', diet: 'egg', allergens: ['egg'] },
  { label: 'Banana', diet: 'vegan' },
  { label: 'Curd', diet: 'veg', allergens: ['dairy'] },
  { label: 'Upma', diet: 'vegan', allergens: ['gluten'] },
  { label: 'Oats', diet: 'vegan' },
  { label: 'Sprouts', diet: 'vegan' },
  { label: 'Apple', diet: 'vegan' },
];

/** Free-text allergy → allergen group (a compact copy of the web's `lib/allergens.ts` aliases). */
const ALLERGY_ALIASES: [RegExp, Allergen][] = [
  [/peanut|groundnut|\bmoong ?phali\b|\bmung ?fali\b|\bshengdana\b/, 'peanut'],
  [/\btree ?nuts?\b|almond|cashew|walnut|pistachio|\bpista\b|hazelnut|\bnuts?\b|\bdry ?fruits?\b|\bbadam\b|\bkaju\b/, 'tree_nut'],
  [/dairy|lactose|\bmilk\b|\bdoodh\b|\bdudh\b|paneer|\bcurd\b|\bdahi\b|\bcasein\b|\bwhey\b/, 'dairy'],
  [/gluten|wheat|celiac|coeliac|\bgehu?n?\b|\batta\b|\bmaida\b/, 'gluten'],
  [/\bsoy|\bsoya\b|\btofu\b/, 'soy'],
  [/\beggs?\b|\banda\b|\bande\b/, 'egg'],
  [/shellfish|\bprawns?\b|\bshrimps?\b|\bcrabs?\b|\blobsters?\b|\bjhinga\b|seafood/, 'shellfish'],
  [/\bfish\b|seafood|\bmachh?li\b/, 'fish'],
  [/sesame|\btil\b|gingelly/, 'sesame'],
  [/mustard|\bsarson\b/, 'mustard'],
];

export function quickPicksFor(diet: Diet | undefined | null, allergies: string[] | undefined | null, count = 10): string[] {
  const entries = (Array.isArray(allergies) ? allergies : [])
    .flatMap((a) => String(a ?? '').toLowerCase().split(/,|;|\/|\band\b|&|\+/))
    .map((a) => a.trim())
    .filter((a) => a && !/^(none|no|nil|na|nothing)$/.test(a));
  const groups = new Set<Allergen>();
  for (const a of entries) for (const [re, g] of ALLERGY_ALIASES) if (re.test(a)) groups.add(g);
  return QUICK_PICKS.filter((p) => {
    if (!dietAllowsFood(diet, p.diet)) return false;
    if (p.allergens?.some((g) => groups.has(g))) return false;
    const label = p.label.toLowerCase();
    return !entries.some((a) => a.includes(label) || (a.length >= 3 && label.includes(a.replace(/s$/, ''))));
  })
    .slice(0, count)
    .map((p) => p.label);
}

export const DIET_MARK: Record<FoodDietMark, { color: string; label: string }> = {
  veg: { color: colors.success, label: 'Vegetarian' },
  vegan: { color: colors.success, label: 'Vegan' },
  egg: { color: colors.warning, label: 'Contains egg' },
  nonveg: { color: colors.error, label: 'Non-vegetarian' },
};
