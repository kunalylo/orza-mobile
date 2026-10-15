/** Goals API calls + React Query hooks (goal, weigh-ins, targets). */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError, api } from '@/lib/api';

import type { GoalCalculateRequest, GoalCalculateResponse, GoalsActiveResponse, TrackWeightResponse, WeightPoint } from './types';

export const goalKeys = {
  all: ['goals'] as const,
  active: ['goals', 'active'] as const,
};

/** Insert or replace one day's weigh-in, keeping the list ascending. */
export function upsertWeight(points: WeightPoint[], date: string, weight_kg: number): WeightPoint[] {
  return [...points.filter((p) => p.date !== date), { date, weight_kg }].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export function useGoalsActive() {
  return useQuery({
    queryKey: goalKeys.active,
    queryFn: ({ signal }) => api.get<GoalsActiveResponse>('/goals/active', { signal }),
    // Weigh-ins are also logged from Today — revalidate whenever the screen opens.
    staleTime: 0,
  });
}

export function useCalculateGoal(today: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: GoalCalculateRequest) => api.post<GoalCalculateResponse>('/goals/calculate', body),
    onSuccess: (res) => {
      qc.setQueryData<GoalsActiveResponse>(goalKeys.active, (d) =>
        d
          ? {
              ...d,
              goal: res.goal,
              targets: res.user.targets,
              profile: res.user.profile,
              weights: upsertWeight(d.weights, d.today ?? today, res.goal.current_weight_kg),
            }
          : d,
      );
      // Reports and the Today dashboard score against the new targets.
      void qc.invalidateQueries({ queryKey: ['reports'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useLogWeight(today: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (weightKg: number) => api.post<TrackWeightResponse>('/track/weight', { weight_kg: weightKg }),
    onSuccess: (res, weightKg) => {
      const date = res?.tracking?.date || today;
      const kg = res?.tracking?.weight_kg ?? weightKg;
      qc.setQueryData<GoalsActiveResponse>(goalKeys.active, (d) =>
        d ? { ...d, weights: upsertWeight(d.weights, date, kg), profile: res.user ? res.user.profile : d.profile } : d,
      );
      void qc.invalidateQueries({ queryKey: ['reports'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

/**
 * Field-level message from a 400. The server's zod errors read `"<field>: <message>"` (code `validation`);
 * `ApiError.field` is used when the server names it directly.
 */
export function fieldError(e: unknown): { field: string; message: string } | null {
  if (!(e instanceof ApiError) || e.status !== 400) return null;
  if (e.field) return { field: e.field, message: e.message };
  const m = /^([a-z_]+): (.+)$/i.exec(e.message);
  if (!m) return null;
  const msg = m[2].trim();
  return { field: m[1], message: msg.charAt(0).toUpperCase() + msg.slice(1) };
}
