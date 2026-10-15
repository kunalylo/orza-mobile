/**
 * Meal log types — field names identical to the web API (`E:\aylo\orza\src\lib\types.ts`, `/api/meals/*`, `/api/foods/search`).
 */

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export type MealSource = 'photo' | 'text' | 'voice' | 'manual' | 'chat';

export interface Nutrients {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
}

/**
 * A meal item as the API returns it. MongoDB stores an item's missing optional values as `null` (food-list and
 * custom items have no `confidence`, many have no `grams`), so read them as `number | null | undefined`.
 */
export interface MealItem extends Nutrients {
  name: string;
  /** e.g. 2 */
  quantity: number;
  /** e.g. "roti", "katori", "plate", "g" */
  unit: string;
  grams?: number | null;
  /** 0..1 */
  confidence?: number | null;
}

/**
 * A meal item as clients send it (custom items, edits, scan confirmation). Optional numbers are left out rather than
 * sent as `null` (the server's zod schemas have rejected `null`), so a stored item goes through `fromDraft` first.
 */
export type MealItemInput = Omit<MealItem, 'grams' | 'confidence'> & {
  grams?: number;
  /** 0..1 */
  confidence?: number;
};

export interface Meal {
  id: string;
  user_id: string;
  /** YYYY-MM-DD */
  date: string;
  meal_type: MealType;
  source: MealSource;
  description: string;
  items: MealItem[];
  totals: Nutrients;
  notes?: string;
  created_at: string;
}

/** `GET /api/meals?date=` */
export interface MealsResponse {
  date?: string;
  meals: Meal[];
  totals: Nutrients;
}

/** `POST /api/meals/text` */
export interface TextLogResponse {
  meal: Meal;
  ai: boolean;
  unmatched: string[];
  credits?: number;
  notice?: string;
}

export type FoodDietMark = 'veg' | 'vegan' | 'egg' | 'nonveg';

/** One hit of `GET /api/foods/search?q=`. */
export interface FoodHit {
  key: string;
  name: string;
  serving: { unit: string; grams: number; label: string };
  per_serving: Nutrients;
  diet: FoodDietMark;
  category: string;
  restaurant_multiplier?: number;
}

/** `GET /api/credits/balance` (the bits the composer's cost hint needs). */
export interface AiStatus {
  ai_enabled: boolean;
  costs: Record<string, number>;
  credits: number;
}
