/**
 * Meal log API + React Query hooks (`/api/meals/*`, `/api/foods/search`, `/api/credits/balance`).
 * Request bodies match the web route handlers' zod schemas exactly (see docs/notes/B1a-meals-voice.md).
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { api, ApiError, retryWhileUnreachable } from '@/lib/api';
import { useAuth } from '@/lib/auth';

import type { AiStatus, FoodHit, Meal, MealItemInput, MealsResponse, MealType, TextLogResponse } from './types';
import { sumNutrients } from './utils';

export const mealKeys = {
  all: ['meals'] as const,
  days: ['meals', 'day'] as const,
  day: (date: string) => ['meals', 'day', date] as const,
  aiStatus: ['meals', 'ai-status'] as const,
  foods: (q: string) => ['meals', 'foods', q.toLowerCase()] as const,
};

/**
 * AI calls can take a while. The server gives its AI 45 s, then falls back to its free parser and still logs the meal,
 * so the phone must wait longer than that (+ auth, credits, fallback, DB, network) or it would report a failure for a
 * meal that does get logged — and a retry would log it twice. Same headroom as chat / recipes.
 */
const AI_TIMEOUT_MS = 75_000;

/* ───────────────────────────── Cache helpers ───────────────────────────── */

const byCreated = (a: Meal, b: Meal) => a.created_at.localeCompare(b.created_at);

function withMeals(meals: Meal[], prev?: MealsResponse): MealsResponse {
  return { ...prev, meals, totals: sumNutrients(meals.map((m) => m.totals)) };
}

/** Put a new / changed meal into its day's cached list (and out of any other day). */
export function upsertMealInCache(qc: QueryClient, meal: Meal) {
  qc.setQueriesData<MealsResponse>({ queryKey: mealKeys.days }, (old) => {
    if (!old) return old;
    if (!old.meals.some((m) => m.id === meal.id)) return old;
    return withMeals(
      old.meals.filter((m) => m.id !== meal.id || m.date === meal.date),
      old
    );
  });
  qc.setQueryData<MealsResponse>(mealKeys.day(meal.date), (old) => {
    if (!old) return old;
    const exists = old.meals.some((m) => m.id === meal.id);
    const next = exists ? old.meals.map((m) => (m.id === meal.id ? meal : m)) : [...old.meals, meal];
    return withMeals(next.sort(byCreated), old);
  });
}

export function removeMealFromCache(qc: QueryClient, id: string) {
  qc.setQueriesData<MealsResponse>({ queryKey: mealKeys.days }, (old) =>
    old && old.meals.some((m) => m.id === id) ? withMeals(old.meals.filter((m) => m.id !== id), old) : old
  );
}

/** Find a meal in any cached day. */
export function findCachedMeal(qc: QueryClient, id: string): Meal | undefined {
  for (const [, data] of qc.getQueriesData<MealsResponse>({ queryKey: mealKeys.days })) {
    const hit = data?.meals.find((m) => m.id === id);
    if (hit) return hit;
  }
  return undefined;
}

/** Query-key roots of the screens outside the meal log that summarise a day (Today, reports…). */
export const DAY_SUMMARY_ROOTS: readonly string[] = ['today', 'dashboard', 'summary', 'reports', 'insights'];

/** After a meal on `date` changed: refetch that day's log and every screen that summarises the day. */
export function invalidateDaySummaries(qc: QueryClient, date: string) {
  void qc.invalidateQueries({ queryKey: mealKeys.day(date) });
  void qc.invalidateQueries({ predicate: (q) => DAY_SUMMARY_ROOTS.includes(String(q.queryKey[0])) });
}

/* ───────────────────────────── Queries ───────────────────────────── */

/** `GET /api/meals?date=` — one day's meals + totals. */
export function useMealsDay(date: string) {
  return useQuery({
    queryKey: mealKeys.day(date),
    queryFn: async ({ signal }) => {
      const res = await api.get<MealsResponse>(`/meals?date=${encodeURIComponent(date)}`, { signal });
      const meals = Array.isArray(res?.meals) ? [...res.meals].sort(byCreated) : [];
      return withMeals(meals, res);
    },
    // Offline: the "couldn't load your meals" card clears itself once ÖRZA can be reached again.
    refetchInterval: retryWhileUnreachable,
  });
}

/** Whether ÖRZA's AI is on + credit costs; `null` while unknown (callers rely on the API's own errors). */
export function useAiStatus(): AiStatus | null {
  const q = useQuery({
    queryKey: mealKeys.aiStatus,
    queryFn: async ({ signal }) => {
      const r = await api.get<Partial<AiStatus>>('/credits/balance', { signal });
      if (typeof r?.ai_enabled !== 'boolean') return null;
      return { ai_enabled: r.ai_enabled, costs: r.costs || {}, credits: Number(r.credits) || 0 } satisfies AiStatus;
    },
    staleTime: 5 * 60_000,
    retry: 1,
  });
  return q.data ?? null;
}

/** `GET /api/foods/search?q=` — pass an already-debounced term ("" = idle). */
export function useFoodSearch(term: string) {
  const q = term.trim().slice(0, 60);
  return useQuery({
    queryKey: mealKeys.foods(q),
    queryFn: async ({ signal }) => {
      const r = await api.get<{ foods: FoodHit[] }>(`/foods/search?q=${encodeURIComponent(q)}`, { signal });
      return Array.isArray(r?.foods) ? r.foods : [];
    },
    enabled: q.length > 0,
    staleTime: 5 * 60_000,
  });
}

/* ───────────────────────────── Mutations ───────────────────────────── */

export interface LogTextInput {
  text: string;
  date: string;
  meal_type?: MealType;
  source: 'text' | 'voice';
}

/** `POST /api/meals/text` — type or speak a meal. Keeps the header's credit balance in sync. */
export function useLogMealText() {
  const qc = useQueryClient();
  const { user, setUser, refresh } = useAuth();
  return useMutation({
    mutationFn: (input: LogTextInput) =>
      api.post<TextLogResponse>(
        '/meals/text',
        { text: input.text, date: input.date, meal_type: input.meal_type ?? null, source: input.source },
        { timeoutMs: AI_TIMEOUT_MS }
      ),
    onSuccess: (res) => {
      upsertMealInCache(qc, res.meal);
      if (typeof res.credits === 'number' && user && user.credits !== res.credits) setUser({ ...user, credits: res.credits });
      if (typeof res.credits === 'number') {
        qc.setQueryData<AiStatus | null>(mealKeys.aiStatus, (old) => (old ? { ...old, credits: res.credits as number } : old));
      }
      invalidateDaySummaries(qc, res.meal.date);
    },
    onError: (e, input) => {
      if (!(e instanceof ApiError)) return;
      // Text the AI found no food in can still use a credit once the daily refunds are used up.
      if (e.code === 'no_items' || e.status === 402) void refresh().catch(() => {});
      // No answer (timeout / dropped connection): the server may still have finished — logged the meal and spent a
      // credit. Refetch the day (also on reconnect, as it's now stale) and the balance, so the list shows it before
      // anyone retries.
      if (e.isNetwork) {
        invalidateDaySummaries(qc, input.date);
        void qc.invalidateQueries({ queryKey: mealKeys.aiStatus });
        void refresh().catch(() => {});
      }
    },
  });
}

export type AddFoodInput =
  | { date: string; meal_type: MealType; food_key: string; quantity: number; restaurant: boolean }
  | { date: string; meal_type: MealType; items: MealItemInput[] };

/** `POST /api/meals/manual` — from the food list (by key + servings) or custom items. Always free. */
export function useAddManualMeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AddFoodInput) => api.post<{ meal: Meal }>('/meals/manual', input),
    onSuccess: ({ meal }) => {
      upsertMealInCache(qc, meal);
      invalidateDaySummaries(qc, meal.date);
    },
  });
}

/** `PATCH /api/meals/[id]` — move to another meal and/or replace items (totals recomputed by the server). */
export function useUpdateMeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; meal_type?: MealType; items?: MealItemInput[] }) => {
      const body: { meal_type?: MealType; items?: MealItemInput[] } = {};
      if (input.meal_type) body.meal_type = input.meal_type;
      if (input.items) body.items = input.items;
      return api.patch<{ meal: Meal }>(`/meals/${encodeURIComponent(input.id)}`, body);
    },
    onSuccess: ({ meal }) => {
      upsertMealInCache(qc, meal);
      invalidateDaySummaries(qc, meal.date);
    },
  });
}

/** `DELETE /api/meals/[id]` — removed from the list straight away, restored if the server refuses. */
export function useDeleteMeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (meal: Pick<Meal, 'id' | 'date'>) => api.del<{ ok: boolean }>(`/meals/${encodeURIComponent(meal.id)}`),
    onMutate: async (meal) => {
      await qc.cancelQueries({ queryKey: mealKeys.day(meal.date) });
      const previous = qc.getQueryData<MealsResponse>(mealKeys.day(meal.date));
      removeMealFromCache(qc, meal.id);
      return { previous };
    },
    onError: (e, meal, ctx) => {
      // Already gone on the server (404) — keep it out of the list.
      if (e instanceof ApiError && e.status === 404) return;
      if (ctx?.previous) qc.setQueryData(mealKeys.day(meal.date), ctx.previous);
    },
    onSettled: (_res, _e, meal) => invalidateDaySummaries(qc, meal.date),
  });
}
