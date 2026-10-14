/** Health screen data: `GET /api/health/days` (merged per day across every source). */
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { healthKeys } from '@/lib/health/sync';

import type { HealthDaysResponse } from './types';

export { healthKeys };

export const healthApi = {
  days: (from: string, to: string, signal?: AbortSignal) =>
    api.get<HealthDaysResponse>(`/health/days?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { signal }),
};

/** Days `from`..`to` (inclusive). Switching ranges keeps the previous charts on screen while the next range loads. */
export function useHealthDays(from: string, to: string) {
  return useQuery({
    queryKey: healthKeys.days(from, to),
    queryFn: ({ signal }) => healthApi.days(from, to, signal),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}
