/** Credits API calls + React Query hooks (balance, history, "Request more credits"). */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, retryWhileUnreachable } from '@/lib/api';

import type { BalanceResponse, CreditRequestResponse, CreditRequestsResponse, TransactionsResponse } from './types';

export const creditKeys = {
  all: ['credits'] as const,
  balance: ['credits', 'balance'] as const,
  transactions: ['credits', 'transactions'] as const,
  requests: ['credits', 'requests'] as const,
};

export function useCreditBalance() {
  return useQuery({
    queryKey: creditKeys.balance,
    queryFn: ({ signal }) => api.get<BalanceResponse>('/credits/balance', { signal }),
    staleTime: 0,
    // Offline: the error card clears itself once ÖRZA can be reached again (no network listener — see lib/api).
    refetchInterval: retryWhileUnreachable,
  });
}

export function useCreditTransactions() {
  return useQuery({
    queryKey: creditKeys.transactions,
    queryFn: ({ signal }) => api.get<TransactionsResponse>('/credits/transactions', { signal }),
    staleTime: 0,
    refetchInterval: retryWhileUnreachable,
  });
}

/** A request the team hasn't handled yet keeps the "Request sent" state across visits. Non-critical. */
export function useCreditRequests() {
  return useQuery({
    queryKey: creditKeys.requests,
    queryFn: ({ signal }) => api.get<CreditRequestsResponse>('/credits/request', { signal }),
    retry: false,
  });
}

export function useRequestCredits() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (message: string) => api.post<CreditRequestResponse>('/credits/request', message ? { message } : {}),
    onSuccess: (res) =>
      qc.setQueryData<CreditRequestsResponse>(creditKeys.requests, (old) => ({
        requests: [res.request, ...(old?.requests ?? []).filter((r) => r.id !== res.request.id)].slice(0, 10),
        pending: res.request,
      })),
  });
}
