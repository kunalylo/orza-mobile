/** Recipes API calls + React Query hooks. */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { AI_TIMEOUT_MS, invalidateMealQueries } from '@/features/chat/ai';
import type { Meal } from '@/features/chat/types';
import { api } from '@/lib/api';

import type { GenerateRequest, GenerateResponse, Recipe, RecipesResponse } from './types';

export const recipeKeys = {
  all: ['recipes'] as const,
  list: ['recipes', 'list'] as const,
  detail: (id: string) => ['recipes', 'detail', id] as const,
};

export function useRecipes() {
  return useQuery({ queryKey: recipeKeys.list, queryFn: ({ signal }) => api.get<RecipesResponse>('/recipes', { signal }) });
}

/** One recipe — shown straight from the list cache while the fresh copy loads. */
export function useRecipe(id: string) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: recipeKeys.detail(id),
    queryFn: async ({ signal }) => (await api.get<{ recipe: Recipe }>(`/recipes/${encodeURIComponent(id)}`, { signal })).recipe,
    enabled: !!id,
    initialData: () => qc.getQueryData<RecipesResponse>(recipeKeys.list)?.recipes.find((r) => r.id === id),
    initialDataUpdatedAt: () => qc.getQueryState(recipeKeys.list)?.dataUpdatedAt,
  });
}

/** Write a changed / new recipe into every cache that shows it. */
export function putRecipe(qc: QueryClient, recipe: Recipe) {
  qc.setQueryData<RecipesResponse>(recipeKeys.list, (old) =>
    old ? { ...old, recipes: [recipe, ...old.recipes.filter((r) => r.id !== recipe.id)].sort((a, b) => b.created_at.localeCompare(a.created_at)) } : old,
  );
  qc.setQueryData(recipeKeys.detail(recipe.id), recipe);
}

function dropRecipe(qc: QueryClient, id: string) {
  // The detail cache is left to expire on its own: the open detail screen is still mounted while it navigates back.
  qc.setQueryData<RecipesResponse>(recipeKeys.list, (old) => (old ? { ...old, recipes: old.recipes.filter((r) => r.id !== id) } : old));
}

export function useGenerateRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: GenerateRequest) => api.post<GenerateResponse>('/recipes/generate', req, { timeoutMs: AI_TIMEOUT_MS }),
    onSuccess: (res) => putRecipe(qc, res.recipe),
  });
}

export function useToggleSave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (r: Pick<Recipe, 'id' | 'saved'>) =>
      api.post<{ recipe: Recipe }>(`/recipes/${encodeURIComponent(r.id)}/save`, { saved: !r.saved }).then((x) => x.recipe),
    onSuccess: (recipe) => putRecipe(qc, recipe),
  });
}

export function useDeleteRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: true }>(`/recipes/${encodeURIComponent(id)}`).then(() => id),
    onSuccess: (id) => dropRecipe(qc, id),
  });
}

/** "Log 1 serving" — a manual meal with the recipe's per-serving nutrition (free, no AI). */
export function useLogServing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (r: Recipe) =>
      api.post<{ meal: Meal }>('/meals/manual', {
        items: [
          {
            name: r.title.slice(0, 80),
            quantity: 1,
            unit: 'serving',
            calories: r.nutrition.calories,
            protein_g: r.nutrition.protein_g,
            carbs_g: r.nutrition.carbs_g,
            fat_g: r.nutrition.fat_g,
            fiber_g: r.nutrition.fiber_g,
          },
        ],
      }),
    onSuccess: () => invalidateMealQueries(qc),
  });
}
