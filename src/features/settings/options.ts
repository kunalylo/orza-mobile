/**
 * Option lists, labels and limits for Settings — copied from the web (`src/components/account/options.ts`,
 * `src/lib/onboarding.ts`, `src/lib/domain/targets.ts`) so the phone validates exactly like the API.
 */
import type { ActivityLevel, Diet, GoalType, HouseholdMode, Language, Preferences, Sex, Targets } from '@/lib/types';

export interface Option<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

export const SEX_OPTIONS: Option<Sex>[] = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'other', label: 'Other' },
];

export const ACTIVITY_OPTIONS: Option<ActivityLevel>[] = [
  { value: 'sedentary', label: 'Mostly sitting', hint: 'Desk job, little exercise' },
  { value: 'light', label: 'Lightly active', hint: 'Walks, 1–3 workouts a week' },
  { value: 'moderate', label: 'Moderately active', hint: '3–5 workouts a week' },
  { value: 'active', label: 'Very active', hint: '6–7 workouts a week' },
  { value: 'very_active', label: 'Athlete / physical job', hint: 'Hard training or manual work daily' },
];

export const DIET_OPTIONS: Option<Diet>[] = [
  { value: 'vegetarian', label: 'Vegetarian' },
  { value: 'eggetarian', label: 'Eggetarian' },
  { value: 'non_vegetarian', label: 'Non-vegetarian' },
  { value: 'vegan', label: 'Vegan' },
  { value: 'jain', label: 'Jain' },
];

export const LANGUAGE_OPTIONS: Option<Language>[] = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'Hindi' },
  { value: 'hinglish', label: 'Hinglish' },
];

export const HOUSEHOLD_OPTIONS: Option<HouseholdMode>[] = [
  { value: 'individual', label: 'Just me', hint: 'Individual' },
  { value: 'couple', label: 'Me and my partner', hint: 'Couple' },
  { value: 'family', label: 'My family', hint: 'Family' },
  { value: 'caregiver', label: 'Someone I care for', hint: 'Caregiver' },
];

/** Same values the onboarding flow stores, so chips line up with existing profiles. */
export const ALLERGY_SUGGESTIONS: Option<string>[] = [
  { value: 'peanuts', label: 'Peanuts' },
  { value: 'tree nuts', label: 'Tree nuts' },
  { value: 'dairy', label: 'Dairy / lactose' },
  { value: 'gluten', label: 'Gluten' },
  { value: 'soy', label: 'Soy' },
  { value: 'eggs', label: 'Eggs' },
  { value: 'fish', label: 'Fish' },
  { value: 'shellfish', label: 'Shellfish' },
  { value: 'sesame', label: 'Sesame' },
];

export const LIFESTYLE_SUGGESTIONS = ['Desk job', 'Night shifts', 'Travel often', 'Fasting days', 'Eat out a lot'];

export const GOAL_LABELS: Record<GoalType, string> = {
  lose: 'Lose weight',
  maintain: 'Maintain weight',
  gain: 'Gain weight or muscle',
};

export const OUTSIDE_INDIA = 'Outside India';

export const INDIAN_REGIONS = [
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chhattisgarh',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
  'Andaman and Nicobar Islands',
  'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi',
  'Jammu and Kashmir',
  'Ladakh',
  'Lakshadweep',
  'Puducherry',
] as const;

/** Shown before searching (onboarding's featured list). */
export const FEATURED_REGIONS = [
  'Maharashtra',
  'Delhi',
  'Karnataka',
  'Tamil Nadu',
  'Uttar Pradesh',
  'Gujarat',
  'West Bengal',
  'Telangana',
  'Punjab',
  'Kerala',
  OUTSIDE_INDIA,
];

export const ALL_REGIONS: string[] = [...INDIAN_REGIONS, OUTSIDE_INDIA];

export const labelOf = <T extends string>(options: Option<T>[], value?: T | null | '') =>
  options.find((o) => o.value === value)?.label ?? '';

/** Server-side validation ranges for profile numbers (metric). */
export const PROFILE_LIMITS = {
  age: { min: 13, max: 100 },
  height_cm: { min: 100, max: 250 },
  weight_kg: { min: 25, max: 350 },
  allergies: { maxItems: 20, maxLength: 40 },
  region: { maxLength: 60 },
  lifestyle: { maxLength: 300 },
  name: { maxLength: 60 },
} as const;

/* ───────────────────────────── Targets ───────────────────────────── */

export type TargetKey = keyof Targets;

export const TARGET_FIELDS: { key: TargetKey; label: string; unit: string; min: number; max: number }[] = [
  { key: 'calories', label: 'Calories', unit: 'kcal', min: 1000, max: 6000 },
  { key: 'protein_g', label: 'Protein', unit: 'g', min: 20, max: 400 },
  { key: 'carbs_g', label: 'Carbs', unit: 'g', min: 20, max: 900 },
  { key: 'fat_g', label: 'Fat', unit: 'g', min: 10, max: 300 },
  { key: 'fiber_g', label: 'Fiber', unit: 'g', min: 5, max: 100 },
  { key: 'water_glasses', label: 'Water', unit: 'glasses', min: 1, max: 30 },
  { key: 'steps', label: 'Steps', unit: 'steps', min: 1000, max: 50000 },
];

export const DEFAULT_TARGETS: Targets = {
  calories: 2000,
  protein_g: 75,
  carbs_g: 250,
  fat_g: 65,
  fiber_g: 30,
  water_glasses: 8,
  steps: 8000,
};

/* ───────────────────────────── Preferences ───────────────────────────── */

export const DEFAULT_PREFERENCES: Preferences = {
  units: 'metric',
  reminders: true,
  weekly_report: true,
  tone: 'gentle',
  ai_training_opt_out: false,
};

export const TONE_COPY: Record<Preferences['tone'], string> = {
  gentle: 'Warm encouragement and no pressure — ÖRZA celebrates small wins.',
  direct: 'Straight talk and clear next steps, still kind and judgment-free.',
};

/* ───────────────────────────── Memory & account ───────────────────────────── */

export const MEMORY_MAX_ITEMS = 30;
export const MEMORY_MAX_LENGTH = 200;

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export const DELETE_WORD = 'DELETE';

export const WHAT_GETS_DELETED = [
  'Your profile, targets, preferences and everything ÖRZA remembers',
  'Every meal, photo scan, water, step and weight entry',
  'Chats, goals, rebalance plans and saved recipes',
  'Medicines and their photos, prescriptions, dose history, reminders and synced health data',
  'Your AI credits, credit history and credit requests',
];

/** "1,234" the Indian way (matches the web's formatNumber). */
export function formatNumber(n: number): string {
  try {
    return Math.round(n).toLocaleString('en-IN');
  } catch {
    return String(Math.round(n));
  }
}
