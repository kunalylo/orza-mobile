/**
 * Snap & Know types — field names identical to the web API (`E:\aylo\orza\src\lib\types.ts` Scan, `/api/meals/scan*`).
 */
import type { Meal, MealItem, MealType, Nutrients } from '@/features/meals/types';

/** An unconfirmed AI estimate of one photo (the photo itself is never stored). */
export interface Scan {
  id: string;
  user_id: string;
  items: MealItem[];
  totals: Nutrients;
  dish_name: string;
  notes?: string;
  /** 0..1 */
  confidence: number;
  confirmed: boolean;
  meal_id?: string;
  created_at: string;
}

/** `POST /api/meals/scan` */
export interface ScanResponse {
  scan: Scan;
  credits?: number;
}

/** `POST /api/meals/scan` body. */
export interface ScanInput {
  /** `data:image/jpeg;base64,…` */
  image: string;
  note?: string;
}

/** `POST /api/meals/scan/[id]/confirm` body. */
export interface ConfirmInput {
  id: string;
  meal_type?: MealType;
  date?: string;
  items?: MealItem[];
}

/** `POST /api/meals/scan/[id]/confirm` */
export interface ConfirmResponse {
  meal: Meal;
}

export type ScanPhase = 'idle' | 'ready' | 'scanning' | 'result' | 'logged';

/** Why the scan panel shows a problem instead of tips / results. */
export type ScanProblem =
  | { kind: 'ai_disabled'; message: string }
  | { kind: 'no_credits'; message: string }
  | { kind: 'rate_limited'; message: string }
  | { kind: 'permission'; message: string; blocked: boolean; source: 'camera' | 'library' }
  | { kind: 'error'; message: string; retry: boolean };
