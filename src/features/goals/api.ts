/** Goals API calls + React Query hooks (goal, weigh-ins, targets). */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, retryWhileUnreachable } from '@/lib/api';

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
    // Offline: the error card clears itself once ÖRZA can be reached again (no network listener — see lib/api).
    refetchInterval: retryWhileUnreachable,
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

