/**
 * Today dashboard API + React Query hooks (`GET /api/dashboard/today`, `POST /api/track/water|steps|weight`).
 * Request bodies match the web route handlers' zod schemas exactly (see docs/notes/B1b-snap-today.md).
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { toast } from '@/ui';

import { MAX_GLASSES, clamp } from './format';
import type { TodayData, TrackingDay, TrackingResponse, WeightResponse } from './types';

/** Starts with "dashboard" — meal mutations elsewhere already invalidate every query whose key begins with it. */
export const todayKeys = {
  all: ['dashboard', 'today'] as const,
  day: (date: string) => ['dashboard', 'today', date] as const,
};

/* ───────────────────────────── Query ───────────────────────────── */

/** `GET /api/dashboard/today?date=` — keeps the previous day on screen while the next one loads. */
export function useTodayDashboard(date: string) {
  return useQuery({
    queryKey: todayKeys.day(date),
    queryFn: ({ signal }) => api.get<TodayData>(`/dashboard/today?date=${encodeURIComponent(date)}`, { signal }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

/* ───────────────────────────── Cache helpers ───────────────────────────── */

/** Merge a fresh tracking row into the cached day (and its "last weigh-in" when a weight was saved). */
export function mergeTracking(qc: QueryClient, date: string, t: TrackingDay) {
  qc.setQueryData<TodayData>(todayKeys.day(date), (d) => {
    if (!d || d.date !== t.date) return d;
    const next: TodayData = { ...d, tracking: { ...d.tracking, ...t } };
    if (t.weight_kg != null && (!d.last_weight || t.date >= d.last_weight.date)) next.last_weight = { weight_kg: t.weight_kg, date: t.date };
    return next;
  });
}

/** Tracking writes in flight — the background refresh waits for them so it never shows a stale count. */
let activeWrites = 0;
let softTimer: ReturnType<typeof setTimeout> | undefined;

/** Refresh the insight / streak / week shortly after a tracking change (the visible numbers are already current). */
function scheduleSoftRefresh(qc: QueryClient, date: string) {
  clearTimeout(softTimer);
  softTimer = setTimeout(() => {
    if (activeWrites > 0) {
      scheduleSoftRefresh(qc, date);
      return;
    }
    void qc.invalidateQueries({ queryKey: todayKeys.day(date) });
  }, 900);
}

/* ───────────────────────────── Water ───────────────────────────── */

/**
 * Water glasses with optimistic taps. Each write sets the day's absolute count, so writes are serialised: at most one
 * request is in flight and taps made meanwhile collapse into a single follow-up write of the latest value — the server
 * always ends on what the card shows. A failure falls back to the last confirmed value, explains, and re-syncs.
 */
export function useWaterWriter(date: string, glasses: number) {
  const qc = useQueryClient();
  const [pending, setPending] = useState<number | null>(null);
  const busy = useRef(false);
  const queued = useRef<number | null>(null);
  const confirmed = useRef<TrackingDay | null>(null);
  const failure = useRef<unknown>(null);
  const value = pending ?? glasses;

  const send = (n: number) => {
    api
      .post<TrackingResponse>('/track/water', { glasses: n, date })
      .then(
        (res) => {
          confirmed.current = res.tracking;
          failure.current = null;
        },
        (e: unknown) => {
          failure.current = e;
        }
      )
      .finally(() => {
        const next = queued.current;
        queued.current = null;
        // A newer value is waiting; its outcome decides what the card shows.
        if (next != null) {
          send(next);
          return;
        }
        busy.current = false;
        activeWrites = Math.max(0, activeWrites - 1);
        if (confirmed.current) mergeTracking(qc, date, confirmed.current);
        setPending(null);
        if (failure.current) {
          toast.error(errorMessage(failure.current));
          void qc.invalidateQueries({ queryKey: todayKeys.day(date) });
        } else {
          scheduleSoftRefresh(qc, date);
        }
      });
  };

  const commit = (next: number) => {
    const n = clamp(Math.round(next), 0, MAX_GLASSES);
    if (n === value) return;
    setPending(n);
    // Don't let an older dashboard fetch land on top of the optimistic value.
    void qc.cancelQueries({ queryKey: todayKeys.day(date) });
    if (busy.current) {
      queued.current = n;
      return;
    }
    busy.current = true;
    activeWrites += 1;
    confirmed.current = null;
    failure.current = null;
    send(n);
  };

  return { value, commit, saving: pending != null };
}

/* ───────────────────────────── Steps & weight ───────────────────────────── */

/** `POST /api/track/steps {steps, date}` — the day's total. */
export function useLogSteps(date: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (steps: number) => api.post<TrackingResponse>('/track/steps', { steps: Math.round(steps), date }),
    onMutate: () => {
      activeWrites += 1;
    },
    onSuccess: ({ tracking }) => {
      mergeTracking(qc, date, tracking);
      scheduleSoftRefresh(qc, date);
    },
    onSettled: () => {
      activeWrites = Math.max(0, activeWrites - 1);
    },
  });
}

/** `POST /api/track/weight {weight_kg, date}` — also keeps the profile weight current (`user` comes back when it changed). */
export function useLogWeight(date: string) {
  const qc = useQueryClient();
  const { setUser } = useAuth();
  return useMutation({
    mutationFn: (weightKg: number) => api.post<WeightResponse>('/track/weight', { weight_kg: Math.round(weightKg * 10) / 10, date }),
    onMutate: () => {
      activeWrites += 1;
    },
    onSuccess: ({ tracking, user }) => {
      mergeTracking(qc, date, tracking);
      if (user) setUser(user);
      // Other cached days may show a different "last weigh-in" now — refetch them when they're next shown.
      void qc.invalidateQueries({ queryKey: todayKeys.all, refetchType: 'none' });
      void qc.invalidateQueries({ predicate: (q) => ['reports', 'goals', 'health'].includes(String(q.queryKey[0])), refetchType: 'none' });
      scheduleSoftRefresh(qc, date);
    },
    onSettled: () => {
      activeWrites = Math.max(0, activeWrites - 1);
    },
  });
}
