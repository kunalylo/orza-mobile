/**
 * Profile form model for Settings (port of the web's `settings/profile-draft.ts`): converts the stored (metric) profile
 * into editable strings in the user's units, and turns an edited draft back into a validated PUT /api/profile patch.
 * Pure — no React.
 */
import type { ActivityLevel, Diet, HouseholdMode, Language, Profile, PublicUser, Sex } from '@/lib/types';

import { PROFILE_LIMITS as L } from './options';

export type Units = 'metric' | 'imperial';

export interface ProfileDraft {
  units: Units;
  name: string;
  age: string;
  sex: Sex | '';
  height_cm: string;
  height_ft: string;
  height_in: string;
  /** kg or lb, per `units`. */
  weight: string;
  activity_level: ActivityLevel | '';
  diet: Diet | '';
  allergies: string[];
  region: string;
  language: Language | '';
  household_mode: HouseholdMode | '';
  lifestyle: string;
}

export type ProfileField = Exclude<keyof ProfileDraft, 'units'>;
export type DraftErrors = Partial<Record<ProfileField | 'height', string>>;
export interface ProfilePatch {
  name?: string;
  profile: Partial<Record<keyof Profile, unknown>>;
}

export const LB_PER_KG = 2.20462;
const CM_PER_IN = 2.54;

const round = (n: number, digits = 1) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

const str = (n: number | undefined, digits = 1) => (n == null ? '' : String(round(n, digits)));

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

export function toDraft(user: PublicUser, units: Units): ProfileDraft {
  const p = user.profile || {};
  const fi = p.height_cm != null ? cmToFeetInches(p.height_cm) : null;
  return {
    units,
    name: user.name || '',
    age: p.age != null ? String(p.age) : '',
    sex: p.sex || '',
    height_cm: str(p.height_cm),
    height_ft: fi ? String(fi.ft) : '',
    height_in: fi ? String(fi.inches) : '',
    weight: p.weight_kg == null ? '' : units === 'imperial' ? str(p.weight_kg * LB_PER_KG) : str(p.weight_kg),
    activity_level: p.activity_level || '',
    diet: p.diet || '',
    allergies: [...(p.allergies || [])],
    region: p.region || '',
    language: p.language || '',
    household_mode: p.household_mode || '',
    lifestyle: p.lifestyle || '',
  };
}

export const draftKey = (d: ProfileDraft) => JSON.stringify(d);

const REBASED_FIELDS = ['name', 'age', 'sex', 'weight', 'activity_level', 'diet', 'allergies', 'region', 'language', 'household_mode', 'lifestyle'] as const;
const HEIGHT_FIELDS = ['height_cm', 'height_ft', 'height_in'] as const;

/**
 * Moves a draft onto a fresher server copy: every field still equal to `from` (the copy it was edited from, or the copy
 * that was just sent) takes its value from `to`; fields edited since keep the edit. Height (cm / ft / in) moves as one
 * field. `from` and `to` must be in the draft's units.
 */
export function rebaseDraft(draft: ProfileDraft, from: ProfileDraft, to: ProfileDraft): ProfileDraft {
  const next: ProfileDraft = { ...draft };
  const same = (k: ProfileField) => JSON.stringify(draft[k]) === JSON.stringify(from[k]);
  const take = <K extends ProfileField>(k: K) => {
    next[k] = to[k];
  };
  for (const k of REBASED_FIELDS) if (same(k)) take(k);
  if (HEIGHT_FIELDS.every(same)) HEIGHT_FIELDS.forEach(take);
  return next;
}

const toNum = (s: string) => {
  const t = s.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};

/** Compare the draft with its baseline and build a validated patch containing only what changed. */
export function buildPatch(draft: ProfileDraft, base: ProfileDraft): { patch: ProfilePatch; errors: DraftErrors; changed: boolean } {
  const errors: DraftErrors = {};
  const patch: ProfilePatch = { profile: {} };
  const differs = (k: ProfileField) => JSON.stringify(draft[k]) !== JSON.stringify(base[k]);
  const imperial = draft.units === 'imperial';

  if (differs('name')) {
    const name = draft.name.trim();
    if (!name) errors.name = 'Please enter your name';
    else if (name.length > L.name.maxLength) errors.name = `Please keep your name under ${L.name.maxLength} characters`;
    else patch.name = name;
  }

  if (differs('age')) {
    const n = toNum(draft.age);
    if (n == null) errors.age = 'Enter your age';
    else if (!Number.isInteger(n)) errors.age = 'Age must be a whole number';
    else if (n < L.age.min || n > L.age.max) errors.age = `Age must be between ${L.age.min} and ${L.age.max}`;
    else patch.profile.age = n;
  }

  const heightChanged = imperial ? differs('height_ft') || differs('height_in') : differs('height_cm');
  if (heightChanged) {
    let cm: number | null;
    if (imperial) {
      const ft = toNum(draft.height_ft);
      const inches = toNum(draft.height_in) ?? 0;
      cm = ft == null ? null : Number.isNaN(ft) || Number.isNaN(inches) ? NaN : round((ft * 12 + inches) * CM_PER_IN, 1);
    } else {
      const n = toNum(draft.height_cm);
      cm = n == null ? null : round(n, 1);
    }
    if (cm == null) errors.height = 'Enter your height';
    else if (Number.isNaN(cm)) errors.height = 'Height must be a number';
    else if (cm < L.height_cm.min || cm > L.height_cm.max)
      errors.height = imperial ? 'Height must be between 3′4″ and 8′2″' : `Height must be between ${L.height_cm.min} and ${L.height_cm.max} cm`;
    else patch.profile.height_cm = cm;
  }

  if (differs('weight')) {
    const n = toNum(draft.weight);
    const kg = n == null || Number.isNaN(n) ? n : round(imperial ? n / LB_PER_KG : n, 1);
    if (kg == null) errors.weight = 'Enter your weight';
    else if (Number.isNaN(kg)) errors.weight = 'Weight must be a number';
    else if (kg < L.weight_kg.min || kg > L.weight_kg.max)
      errors.weight = imperial
        ? `Weight must be between ${Math.round(L.weight_kg.min * LB_PER_KG)} and ${Math.round(L.weight_kg.max * LB_PER_KG)} lb`
        : `Weight must be between ${L.weight_kg.min} and ${L.weight_kg.max} kg`;
    else patch.profile.weight_kg = kg;
  }

  for (const k of ['sex', 'activity_level', 'diet', 'language', 'household_mode'] as const) {
    if (differs(k)) patch.profile[k] = draft[k] || null;
  }

  if (differs('allergies')) patch.profile.allergies = draft.allergies;

  if (differs('region')) {
    const region = draft.region.trim();
    if (region.length > L.region.maxLength) errors.region = `Keep it under ${L.region.maxLength} characters`;
    else patch.profile.region = region || null;
  }

  if (differs('lifestyle')) {
    const lifestyle = draft.lifestyle.trim();
    if (lifestyle.length > L.lifestyle.maxLength) errors.lifestyle = `Keep it under ${L.lifestyle.maxLength} characters`;
    else patch.profile.lifestyle = lifestyle || null;
  }

  const changed = patch.name !== undefined || Object.keys(patch.profile).length > 0;
  return { patch, errors, changed };
}

/** Maps a server field path (`profile.age`, `name`, `profile.height_cm`…) to the draft's error key. */
export function draftErrorKey(path: string | undefined): keyof DraftErrors | null {
  if (!path) return null;
  const key = path.replace(/^profile\./, '').split('.')[0];
  if (key === 'height_cm') return 'height';
  if (key === 'weight_kg') return 'weight';
  const known: (keyof DraftErrors)[] = ['name', 'age', 'sex', 'activity_level', 'diet', 'allergies', 'region', 'language', 'household_mode', 'lifestyle'];
  return (known as string[]).includes(key) ? (key as keyof DraftErrors) : null;
}
