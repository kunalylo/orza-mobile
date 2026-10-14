/** Rebalance API calls + React Query hooks. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { AI_TIMEOUT_MS } from '@/features/chat/ai';
import { ApiError, api } from '@/lib/api';

import type { RebalanceCreateResponse, RebalanceListResponse, RebalanceRequest } from './types';

export const rebalanceKeys = {
  list: ['rebalance', 'plans'] as const,
};

export function useRebalancePlans() {
  return useQuery({ queryKey: rebalanceKeys.list, queryFn: ({ signal }) => api.get<RebalanceListResponse>('/compensation', { signal }) });
}

export function useCreatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: RebalanceRequest) => api.post<RebalanceCreateResponse>('/compensation/plan', req, { timeoutMs: AI_TIMEOUT_MS }),
    onSuccess: (res) =>
      qc.setQueryData<RebalanceListResponse>(rebalanceKeys.list, (old) =>
        old ? { ...old, plans: [res.plan, ...old.plans.filter((p) => p.id !== res.plan.id)].slice(0, 20) } : old,
      ),
  });
}

export function useDeletePlan() {
  const qc = useQueryClient();
  return useMutation({
    // Already gone (deleted on another device) counts as deleted.
    mutationFn: (id: string) =>
      api.del<{ ok: true }>(`/compensation/${encodeURIComponent(id)}`).then(
        () => id,
        (e: unknown) => {
          if (e instanceof ApiError && e.status === 404) return id;
          throw e;
        },
      ),
    onSuccess: (id) =>
      qc.setQueryData<RebalanceListResponse>(rebalanceKeys.list, (old) => (old ? { ...old, plans: old.plans.filter((p) => p.id !== id) } : old)),
  });
}
