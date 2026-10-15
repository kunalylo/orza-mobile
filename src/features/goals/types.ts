/** Goals API shapes (web: `src/app/api/goals/**`, `src/app/api/track/weight`, `src/components/goals/types.ts`). */
import type { GoalType, Profile, PublicUser, Targets } from '@/lib/types';

export interface Goal {
  id: string;
  user_id: string;
  active: boolean;
  goal: GoalType;
  current_weight_kg: number;
  target_weight_kg: number;
  /** Planned change per week, signed (negative = loss). */
  weekly_rate_kg: number;
  target_date?: string;
  bmr: number;
  tdee: number;
  targets: Targets;
  created_at: string;
}

export interface WeightPoint {
  date: string;
  weight_kg: number;
}

/** `GET /api/goals/active` */
export interface GoalsActiveResponse {
  goal: Goal | null;
  /** Last 120 days of weigh-ins, ascending. */
  weights: WeightPoint[];
  targets: Targets;
  profile: Profile;
  today?: string;
}

/** `POST /api/goals/calculate` body (weights in kg, height in cm). */
export interface GoalCalculateRequest {
  goal: GoalType;
  current_weight_kg: number;
  target_weight_kg: number;
  weekly_rate_kg: number;
  height_cm: number;
  age: number;
  sex?: Profile['sex'];
  activity_level: NonNullable<Profile['activity_level']>;
}

/** `POST /api/goals/calculate` */
export interface GoalCalculateResponse {
  goal: Goal;
  user: PublicUser;
  notice?: string;
}

export interface TrackingDay {
  id: string;
  user_id: string;
  date: string;
  water_glasses: number;
  steps: number;
  weight_kg?: number;
  updated_at: string;
}

/** `POST /api/track/weight` — `user` only when the profile weight changed. */
export interface TrackWeightResponse {
  tracking: TrackingDay;
  user?: PublicUser;
}
