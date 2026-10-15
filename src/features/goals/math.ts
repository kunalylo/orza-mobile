/**
 * Pure goal-planning maths — a faithful port of the web's `src/components/goals/goal-math.ts` and
 * `src/lib/domain/targets.ts` (`computeTargets`), so the live preview shows exactly what the server will save.
 * Weights are always kg and heights cm underneath; the unit helpers only change what people see and type.
 */
import type { ActivityLevel, GoalType, Profile, Targets } from '@/lib/types';

/* ───────────────────────────── numbers & dates ───────────────────────────── */

export function round(n: number, digits = 0): number {
  const f = 10 ** digits;
  return Math.round((Number(n) || 0) * f) / f;
}

export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** 1234 → "1,234" (Indian grouping when Intl is available). */
export function formatNumber(n: number): string {
  const v = Math.round(Number(n) || 0);
  try {
    return v.toLocaleString('en-IN');
  } catch {
    return String(v);
  }
}

/** Up to one decimal, Indian grouping: 70.4 → "70.4", 70 → "70". */
export function formatDecimal(n: number): string {
  const v = round(n, 1);
  try {
    return v.toLocaleString('en-IN', { maximumFractionDigits: 1 });
  } catch {
    return String(v);
  }
}

/** A typed number ("72,5" from a comma-decimal keyboard works too); NaN when empty or invalid. */
export function parseNum(s: string): number {
  const t = s.trim().replace(',', '.');
  if (t === '' || !/^-?\d*\.?\d*$/.test(t) || t === '.' || t === '-') return NaN;
  return Number(t);
}

const pad = (n: number) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function utcParts(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  return { y, m, d, wd: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Whole days between two YYYY-MM-DD dates (b − a). */
export function daysBetween(a: string, b: string): number {
  const p = utcParts(a);
  const q = utcParts(b);
  return Math.round((Date.UTC(q.y, q.m - 1, q.d) - Date.UTC(p.y, p.m - 1, p.d)) / 86_400_000);
}

/** "12 Mar 2027" */
export function formatLongDate(date: string): string {
  const p = utcParts(date);
  return `${p.d} ${MONTHS[p.m - 1]} ${p.y}`;
}

/** "24 Sep" */
export function formatShortDate(date: string): string {
  const p = utcParts(date);
  return `${p.d} ${MONTHS[p.m - 1]}`;
}

/** "Thu, 24 Sep" */
export function formatDayDate(date: string): string {
  const p = utcParts(date);
  return `${WEEKDAYS[p.wd]}, ${p.d} ${MONTHS[p.m - 1]}`;
}

export const DEFAULT_TZ = 'Asia/Kolkata';

/** Today as YYYY-MM-DD in the member's time zone (falls back to the phone's clock). */
export function todayInTz(tz?: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz || DEFAULT_TZ, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date());
    const get = (t: string) => Number(parts.find((x) => x.type === t)?.value);
    const y = get('year');
    const m = get('month');
    const d = get('day');
    if ([y, m, d].every(Number.isFinite)) return `${y}-${pad(m)}-${pad(d)}`;
  } catch {
    // fall through to the phone's clock
  }
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/* ───────────────────────────── targets (computeTargets) ───────────────────────────── */

const ACTIVITY: Record<ActivityLevel, number> = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9 };

export const DEFAULT_TARGETS: Targets = { calories: 2000, protein_g: 75, carbs_g: 250, fat_g: 65, fiber_g: 30, water_glasses: 8, steps: 8000 };

/** Mifflin–St Jeor BMR; null when the profile is incomplete. */
export function bmr(p: Profile): number | null {
  if (!p.weight_kg || !p.height_cm || !p.age) return null;
  const base = 10 * p.weight_kg + 6.25 * p.height_cm - 5 * p.age;
  const sexAdj = p.sex === 'male' ? 5 : p.sex === 'female' ? -161 : -78;
  return Math.round(base + sexAdj);
}

export function tdee(p: Profile): number | null {
  const b = bmr(p);
  if (b == null) return null;
  return Math.round(b * ACTIVITY[p.activity_level || 'light']);
}

/** Daily targets from a profile (1 kg ≈ 7700 kcal; never below 1200 kcal / BMR). */
export function computeTargets(p: Profile, opts: { goal?: GoalType; weeklyRateKg?: number } = {}): Targets & { bmr: number | null; tdee: number | null } {
  const goal = opts.goal || p.goal || 'maintain';
  const b = bmr(p);
  const t = tdee(p);
  if (t == null) return { ...DEFAULT_TARGETS, bmr: b, tdee: t };

  const rate = opts.weeklyRateKg ?? (goal === 'lose' ? -0.5 : goal === 'gain' ? 0.25 : 0);
  let calories = t + (rate * 7700) / 7;
  const floor = Math.max(1200, b ?? 1200);
  if (calories < floor) calories = floor;
  calories = Math.round(calories / 10) * 10;

  const weight = p.weight_kg || 65;
  const proteinPerKg = goal === 'lose' ? 1.4 : goal === 'gain' ? 1.6 : 1.1;
  const protein_g = Math.round(weight * proteinPerKg);
  const fat_g = Math.round((calories * 0.28) / 9);
  const carbs_g = Math.max(0, Math.round((calories - protein_g * 4 - fat_g * 9) / 4));
  const water_glasses = Math.max(8, Math.round((weight * 35) / 250));
  const steps = p.activity_level === 'sedentary' ? 7000 : p.activity_level === 'very_active' ? 12000 : 9000;

  return { calories, protein_g, carbs_g, fat_g, fiber_g: round(Math.max(25, (calories / 1000) * 14)), water_glasses, steps, bmr: b, tdee: t };
}

/* ───────────────────────────── goal maths ───────────────────────────── */

export const KCAL_PER_KG = 7700;
export const MAX_LOSS_PER_WEEK = 1;
export const MAX_GAIN_PER_WEEK = 0.5;
export const HEALTHY_BMI_FLOOR = 18.5;

export const LOSS_PACES = [
  { rate: 0.25, label: 'Gentle', note: 'Easiest to sustain' },
  { rate: 0.5, label: 'Steady', note: 'A balanced pace' },
  { rate: 0.75, label: 'Faster', note: 'Needs more focus' },
] as const;
export const GAIN_PACES = [{ rate: 0.25, label: 'Lean', note: 'Lean, steady gains — kind to your body' }] as const;

export const GOAL_LABEL: Record<GoalType, string> = { lose: 'Lose weight', maintain: 'Maintain', gain: 'Gain weight' };

export const ACTIVITY_OPTIONS: { value: ActivityLevel; label: string; hint: string }[] = [
  { value: 'sedentary', label: 'Sedentary', hint: 'Mostly sitting — desk work, little exercise' },
  { value: 'light', label: 'Lightly active', hint: 'Daily walks, light chores, exercise 1–2 days' },
  { value: 'moderate', label: 'Moderately active', hint: 'Exercise 3–5 days a week' },
  { value: 'active', label: 'Active', hint: 'Exercise most days of the week' },
  { value: 'very_active', label: 'Very active', hint: 'Physical work or hard training daily' },
];

export function defaultRate(goal: GoalType): number {
  return goal === 'lose' ? -0.5 : goal === 'gain' ? 0.25 : 0;
}

/** Normalises a requested pace to the goal's direction (loss negative, gain positive, maintain 0). */
export function signedRate(goal: GoalType, rate?: number | null): number {
  if (goal === 'maintain') return 0;
  const r = Math.abs(Number(rate) || 0);
  if (!r) return defaultRate(goal);
  return goal === 'lose' ? -r : r;
}

/** Closest offered pace to a stored weekly rate. */
export function nearestPace(goal: GoalType, rate?: number | null): number {
  const options: number[] = goal === 'gain' ? GAIN_PACES.map((p) => p.rate) : LOSS_PACES.map((p) => p.rate);
  const r = Math.abs(Number(rate) || 0);
  if (!r) return goal === 'gain' ? 0.25 : 0.5;
  return options.reduce((best, o) => (Math.abs(o - r) < Math.abs(best - r) ? o : best), options[0]);
}

/** Lowest weight inside the healthy BMI range for a height (rounded up to 0.5 kg). */
export function healthyFloorKg(heightCm: number): number {
  const m = heightCm / 100;
  return Math.ceil(HEALTHY_BMI_FLOOR * m * m * 2) / 2;
}

/* ─── units ─── */

export const KG_PER_LB = 0.45359237;
export const CM_PER_IN = 2.54;
export const MIN_WEIGHT_KG = 25;
export const MAX_WEIGHT_KG = 350;
export const MIN_HEIGHT_CM = 100;
export const MAX_HEIGHT_CM = 250;

export const isImperial = (units?: string | null) => units === 'imperial';
export const weightUnit = (imperial: boolean) => (imperial ? 'lb' : 'kg');

export function kgToUnit(kg: number, imperial: boolean): number {
  return imperial ? round(kg / KG_PER_LB, 1) : round(kg, 1);
}

export function unitToKg(value: number, imperial: boolean): number {
  return imperial ? round(value * KG_PER_LB, 1) : round(value, 1);
}

/** "70.4 kg" / "155.2 lb" */
export function formatWeight(kg: number, imperial: boolean): string {
  return `${formatDecimal(kgToUnit(kg, imperial))} ${weightUnit(imperial)}`;
}

/** A weekly pace in the user's unit, unsigned: "0.5 kg" / "1.1 lb". */
export function formatPace(kgPerWeek: number, imperial: boolean): string {
  const v = Math.abs(kgPerWeek);
  return imperial ? `${round(v / KG_PER_LB, 1)} lb` : `${round(v, 2)} kg`;
}

export function weightRange(imperial: boolean): { min: number; max: number } {
  return imperial ? { min: Math.ceil(MIN_WEIGHT_KG / KG_PER_LB), max: Math.floor(MAX_WEIGHT_KG / KG_PER_LB) } : { min: MIN_WEIGHT_KG, max: MAX_WEIGHT_KG };
}

export function cmToFeetInches(cm: number): { ft: number; inches: number } {
  const total = cm / CM_PER_IN;
  let ft = Math.floor(total / 12);
  let inches = Math.round(total - ft * 12);
  if (inches === 12) {
    ft += 1;
    inches = 0;
  }
  return { ft, inches };
}

export function feetInchesToCm(ft: number, inches: number): number {
  return round((ft * 12 + inches) * CM_PER_IN, 1);
}

/** Friendly validation message, or null when the goal is safe and consistent. Weights are kg. */
export function goalInputError(i: { goal: GoalType; current: number; target: number; rate: number; heightCm?: number; imperial?: boolean }): string | null {
  const { goal, current, target, rate, heightCm } = i;
  const imperial = !!i.imperial;
  const range = weightRange(imperial);
  const unit = weightUnit(imperial);
  if (!(current >= MIN_WEIGHT_KG && current <= MAX_WEIGHT_KG)) return `Enter a current weight between ${range.min} and ${range.max} ${unit}.`;
  if (!(target >= MIN_WEIGHT_KG && target <= MAX_WEIGHT_KG)) return `Enter a target weight between ${range.min} and ${range.max} ${unit}.`;
  if (goal === 'lose') {
    if (target >= current) return 'For weight loss, your target should be below your current weight.';
    if (rate < -MAX_LOSS_PER_WEEK) return `To keep things safe, ÖRZA plans weight loss at ${imperial ? 'about 2.2 lb' : '1 kg'} a week or less.`;
    if (heightCm && target < healthyFloorKg(heightCm)) {
      const floor = healthyFloorKg(heightCm);
      const shown = imperial ? `${Math.ceil(floor / KG_PER_LB)} lb` : `${floor} kg`;
      return `That target sits below the healthy range for your height. Try ${shown} or above — or check with your doctor first.`;
    }
  }
  if (goal === 'gain') {
    if (target <= current) return 'For weight gain, your target should be above your current weight.';
    if (rate > MAX_GAIN_PER_WEEK) return `To keep things safe, ÖRZA plans weight gain at ${imperial ? 'about 1.1 lb' : '0.5 kg'} a week or less.`;
  }
  return null;
}

export interface GoalPlan {
  targets: Targets;
  bmr: number | null;
  tdee: number | null;
  /** Planned weekly change after safety floors (negative = loss). */
  weeklyRate: number;
  /** True when the calorie floor made the pace gentler than requested. */
  paceAdjusted: boolean;
  weeks: number | null;
  targetDate: string | null;
  /** Set when a plan can't be made safely. */
  blocker: string | null;
}

/** Daily targets + timeline for a goal (`profile` already holds current weight, height, age, sex, activity). */
export function planGoal(opts: { profile: Profile; goal: GoalType; current: number; target: number; rate: number; today: string }): GoalPlan {
  const { profile, goal, current, target, today } = opts;
  const rate = signedRate(goal, opts.rate);
  const full = computeTargets({ ...profile, weight_kg: current }, { goal, weeklyRateKg: rate });
  const { bmr: b, tdee: t, ...targets } = full;

  let weeklyRate = rate;
  let paceAdjusted = false;
  let blocker: string | null = null;

  if (t != null && goal === 'lose') {
    const planned = Math.round((t + (rate * KCAL_PER_KG) / 7) / 10) * 10;
    if (targets.calories > planned) {
      weeklyRate = round(((targets.calories - t) * 7) / KCAL_PER_KG, 2);
      paceAdjusted = true;
      if (weeklyRate > -0.05) {
        blocker =
          "Your daily energy needs are already close to the safe minimum, so ÖRZA won't plan a calorie deficit. A maintain goal with more movement is a kinder place to start — or chat with a nutritionist.";
      }
    }
  }

  let weeks: number | null = null;
  let targetDate: string | null = null;
  if (goal !== 'maintain' && weeklyRate !== 0 && !blocker) {
    weeks = Math.max(1, Math.ceil(Math.abs(target - current) / Math.abs(weeklyRate)));
    targetDate = addDays(today, weeks * 7);
  }

  return { targets, bmr: b, tdee: t, weeklyRate, paceAdjusted, weeks, targetDate, blocker };
}

/* ───────────────────────────── progress (GoalOverview) ───────────────────────────── */

export type StatusTone = 'success' | 'info' | 'neutral';
export interface GoalStatus {
  tone: StatusTone;
  label: string;
  note: string;
}

export function progressFor(goal: { goal: GoalType; current_weight_kg: number; target_weight_kg: number }, latest: number): number {
  if (goal.goal === 'maintain') {
    const diff = Math.abs(latest - goal.target_weight_kg);
    return diff <= 1 ? 1 : clamp(1 - (diff - 1) / 3, 0, 1);
  }
  const total = goal.target_weight_kg - goal.current_weight_kg;
  if (!total) return 1;
  return clamp((latest - goal.current_weight_kg) / total, 0, 1);
}

/** Gentle, judgment-free read on progress vs the planned pace (same rules as the web). */
export function statusFor(
  goal: { goal: GoalType; current_weight_kg: number; target_weight_kg: number; weekly_rate_kg: number; created_at: string },
  latest: number,
  today: string,
  pct: number,
  imperial: boolean,
): GoalStatus {
  const since = goal.created_at.slice(0, 10);
  const weeks = Math.max(0, daysBetween(since, today) / 7);
  if (goal.goal === 'maintain') {
    const diff = Math.abs(latest - goal.target_weight_kg);
    return diff <= 1
      ? { tone: 'success', label: 'Holding steady', note: "You're right in your comfort zone. Keep your everyday rhythm going." }
      : { tone: 'info', label: 'Small drift', note: `${imperial ? 'A couple of pounds' : 'A kilo or two'} either way is normal — ÖRZA will nudge your daily targets gently.` };
  }
  if (pct >= 1) return { tone: 'success', label: 'Target reached', note: 'You made it. Celebrate — then consider a maintain goal to hold your progress.' };
  if (weeks < 1) return { tone: 'neutral', label: 'Just getting started', note: 'Weigh in once or twice a week, same time of day, for the clearest trend.' };
  const expected = goal.weekly_rate_kg * weeks;
  const actual = latest - goal.current_weight_kg;
  const ahead = goal.goal === 'lose' ? actual <= expected - 0.3 : actual >= expected + 0.3;
  const onTrack = Math.abs(actual - expected) <= 0.6;
  if (ahead) return { tone: 'success', label: 'Ahead of plan', note: "Lovely momentum. Make sure you're still eating enough to feel energised." };
  if (onTrack) return { tone: 'success', label: 'On track', note: 'Right where your plan expects you to be. Consistency is doing its job.' };
  return {
    tone: 'info',
    label: 'Taking its time',
    note: "Bodies aren't linear — water, sleep and stress all play a part. Keep going; the trend matters more than any single day.",
  };
}
