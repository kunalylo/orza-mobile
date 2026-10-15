/** Reports API shapes (web: `src/lib/reports.ts`, `GET /api/reports/daily|weekly`). Weights are kg in the data. */
import type { Targets } from '@/lib/types';

export interface Nutrients {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
}

export type ScoreKey = 'calories' | 'protein' | 'water' | 'steps' | 'fiber';

export interface ScorePart {
  key: ScoreKey;
  label: string;
  points: number;
  max: number;
  value: number;
  target: number;
  unit: string;
}

/** The slice of a logged meal the report shows. */
export interface ReportMeal {
  id: string;
  date: string;
  meal_type: string;
  description: string;
  items: { name: string }[];
  totals: Nutrients;
  created_at: string;
}

export interface DailyReport {
  date: string;
  is_today: boolean;
  totals: Nutrients;
  targets: Targets;
  meals: ReportMeal[];
  tracking: { water_glasses: number; steps: number; weight_kg?: number };
  /** 0–100: calories 35 · protein 25 · water 15 · steps 15 · fibre 10. */
  score: number;
  score_parts: ScorePart[];
  highlights: string[];
  suggestions: string[];
}

export interface WeeklyDay {
  date: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  water_glasses: number;
  steps: number;
  weight_kg?: number;
  meals_count: number;
  score: number;
}

export interface WeeklyReport {
  start: string;
  end: string;
  days: WeeklyDay[];
  /** Nutrition over logged days; water / steps over tracked days. */
  averages: { calories: number; protein_g: number; carbs_g: number; fat_g: number; fiber_g: number; water_glasses: number; steps: number };
  /** Logged days within ±10% of the calorie target. */
  adherence: number;
  logged_days: number;
  best_day: { date: string; score: number } | null;
  weight: { first: number; last: number; change: number; entries: number } | null;
  targets: Targets;
  summary: string;
}
