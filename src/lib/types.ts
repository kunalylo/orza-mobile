/**
 * The slice of the web app's data model the phone app reads (`E:\aylo\orza\src\lib\types.ts`).
 * Keep field names identical to the API — they are snake_case on purpose.
 */

export type Sex = 'male' | 'female' | 'other';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
export type GoalType = 'lose' | 'maintain' | 'gain';
export type Diet = 'vegetarian' | 'vegan' | 'eggetarian' | 'non_vegetarian' | 'jain';
export type Language = 'en' | 'hi' | 'hinglish';
export type HouseholdMode = 'individual' | 'couple' | 'caregiver' | 'family';
export type AdminRole = 'super' | 'sub';

export interface Profile {
  age?: number;
  sex?: Sex;
  height_cm?: number;
  weight_kg?: number;
  target_weight_kg?: number;
  activity_level?: ActivityLevel;
  goal?: GoalType;
  diet?: Diet;
  allergies?: string[];
  conditions?: string[];
  region?: string;
  language?: Language;
  household_mode?: HouseholdMode;
  lifestyle?: string;
  /** IANA zone, default Asia/Kolkata. */
  timezone?: string;
}

export interface Targets {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  water_glasses: number;
  steps: number;
}

export interface Preferences {
  units: 'metric' | 'imperial';
  reminders: boolean;
  weekly_report: boolean;
  tone: 'gentle' | 'direct';
  ai_training_opt_out?: boolean;
}

/** `GET /api/auth/me` → `{user}` (never includes the password hash or integration secrets). */
export interface PublicUser {
  id: string;
  email: string;
  name: string;
  created_at: string;
  updated_at: string;
  onboarding_complete: boolean;
  /** Staff account — uses the web admin console, never the member app. */
  is_admin?: boolean;
  admin_role?: AdminRole;
  credits: number;
  profile: Profile;
  targets: Targets;
  preferences: Preferences;
  memory: string[];
  integrations?: {
    health_token_preview?: string;
    health_token_created_at?: string;
    whatsapp_phone?: string;
    whatsapp_opt_in?: boolean;
    quiet_hours?: { start: string; end: string };
  };
}

/** `POST /api/auth/login|register` with `X-ORZA-Client: mobile`. */
export interface AuthResponse {
  user: PublicUser;
  token: string;
}

/** `POST /api/devices` → `{device}`. */
export interface AppDeviceView {
  id: string;
  platform: 'ios' | 'android';
  label: string;
  app_version: string;
  timezone: string;
  alarms_local: boolean;
  push_token_set: boolean;
  last_seen_at: string;
  created_at: string;
}
