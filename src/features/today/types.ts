/**
 * Today dashboard types — field names identical to the web API (`GET /api/dashboard/today`, `POST /api/track/*`,
 * `E:\aylo\orza\src\lib\types.ts` TrackingDay / Goal, `components/today/types.ts`).
 */
import type { GoalType, PublicUser, Targets } from '@/lib/types';

import type { Meal, MealType, Nutrients } from '@/features/meals/types';

export interface TrackingDay {
  id?: string;
  user_id?: string;
  /** YYYY-MM-DD */
  date: string;
  water_glasses: number;
  steps: number;
  weight_kg?: number;
  updated_at?: string;
}

export interface Goal {
  id: string;
  user_id: string;
  active: boolean;
  goal: GoalType;
  current_weight_kg: number;
  target_weight_kg: number;
  /** Planned change per week (negative = loss). */
  weekly_rate_kg: number;
  target_date?: string;
  bmr: number;
  tdee: number;
  targets: Targets;
  created_at: string;
}

export interface WeekDay {
  date: string;
  calories: number;
  meals: number;
}

/** `GET /api/dashboard/today?date=` */
export interface TodayData {
  date: string;
  /** The user's current day in their timezone (upper bound for date navigation). */
  today: string;
  targets: Targets;
  totals: Nutrients;
  meals: Meal[];
  tracking: TrackingDay;
  remaining: { calories: number; protein_g: number };
  streak: number;
  insight: string;
  goal: Goal | null;
  week: WeekDay[];
  last_weight: { weight_kg: number; date: string } | null;
}

/** `POST /api/track/water|steps` */
export interface TrackingResponse {
  tracking: TrackingDay;
}

/** `POST /api/track/weight` — `user` when the profile weight changed. */
export interface WeightResponse {
  tracking: TrackingDay;
  user?: PublicUser;
}

/** Today groups meals in eating order (snacks before dinner), like the web. */
export const MEAL_ORDER: MealType[] = ['breakfast', 'lunch', 'snack', 'dinner'];
