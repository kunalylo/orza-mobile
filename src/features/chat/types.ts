/** Ask ÖRZA — shapes of /api/chat/* (see E:\aylo\orza\src\app\api\chat). */

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export type MealSource = 'photo' | 'text' | 'voice' | 'manual' | 'chat';

export interface Nutrients {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
}

export interface MealItem extends Nutrients {
  name: string;
  quantity: number;
  unit: string;
  grams?: number;
  confidence?: number;
}

export interface Meal {
  id: string;
  user_id: string;
  date: string;
  meal_type: MealType;
  source: MealSource;
  description: string;
  items: MealItem[];
  totals: Nutrients;
  notes?: string;
  created_at: string;
}

export interface ChatSession {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  user_id: string;
  role: 'user' | 'assistant';
  content: string;
  meta?: { logged_meal_id?: string; ai?: boolean; remembered?: string[] };
  created_at: string;
}

/** GET /chat/sessions */
export interface SessionsResponse {
  sessions: ChatSession[];
}

/** GET /chat/history?session_id= */
export interface HistoryResponse {
  session: ChatSession;
  messages: ChatMessage[];
  logged_meals?: Record<string, Meal>;
}

/** POST /chat/send */
export interface SendRequest {
  message: string;
  session_id?: string;
}

export interface SendResponse {
  session_id: string;
  session?: ChatSession;
  user_message: ChatMessage;
  message: ChatMessage;
  logged_meal?: Meal;
  credits?: number;
  /** Full memory list — only when this turn taught ÖRZA something new. */
  memory?: string[];
  remembered?: string[];
  /** Updated profile allergies — only when this turn learned a new food allergy. */
  allergies?: string[];
  notice?: string;
}

/** A message on screen: server messages plus optimistic / failed local ones. */
export interface UIMessage extends ChatMessage {
  status?: 'sending' | 'failed';
  /** Why a local message failed (drives "Get credits" / "Retry"). */
  failure?: { message: string; needsCredits: boolean };
  loggedMeal?: Meal | null;
  notice?: string;
  /** Arrived during this visit — animate in (history renders statically). */
  fresh?: boolean;
}
