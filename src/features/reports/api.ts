/** Reports API calls + React Query hooks (daily and weekly). */
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, retryWhileUnreachable } from '@/lib/api';

import type { DailyReport, WeeklyReport } from './types';

export const reportKeys = {
  all: ['reports'] as const,
  daily: (date: string) => ['reports', 'daily', date] as const,
  weekly: (end: string) => ['reports', 'weekly', end] as const,
};

const fetchDaily = (date: string, signal?: AbortSignal) => api.get<DailyReport>(`/reports/daily?date=${encodeURIComponent(date)}`, { signal });
const fetchWeekly = (end: string, signal?: AbortSignal) => api.get<WeeklyReport>(`/reports/weekly?end=${encodeURIComponent(end)}`, { signal });

/** The day's report; the previous day stays on screen (dimmed) while the next one loads. */
export function useDailyReport(date: string) {
  return useQuery({
    queryKey: reportKeys.daily(date),
    queryFn: ({ signal }) => fetchDaily(date, signal),
    placeholderData: keepPreviousData,
    // Meals, water and steps are logged on other screens — always revalidate when the report is opened.
    staleTime: 0,
    // Offline: the error card clears itself once ÖRZA can be reached again (no network listener — see lib/api).
    refetchInterval: retryWhileUnreachable,
  });
}

/** The 7 days ending on `end`; loads lazily (the first time the Weekly tab is opened). */
export function useWeeklyReport(end: string, enabled: boolean) {
  return useQuery({
    queryKey: reportKeys.weekly(end),
    queryFn: ({ signal }) => fetchWeekly(end, signal),
    placeholderData: keepPreviousData,
    staleTime: 0,
    refetchInterval: retryWhileUnreachable,
    enabled,
  });
}

/** The weekly report for `end`, from the cache when fresh, fetching it otherwise (for the CSV share). */
export function useEnsureWeekly() {
  const qc = useQueryClient();
  return (end: string) => qc.fetchQuery({ queryKey: reportKeys.weekly(end), queryFn: ({ signal }) => fetchWeekly(end, signal), staleTime: 30_000 });
}
