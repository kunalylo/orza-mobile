/**
 * Snap & Know API (`POST /api/meals/scan`, `POST /api/meals/scan/[id]/confirm`) + React Query mutations.
 * Request bodies match the web route handlers' zod schemas exactly (see docs/notes/B1b-snap-today.md).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api, ApiError, errorMessage } from '@/lib/api';
import { PhotoError, PhotoPermissionError } from '@/lib/image';

import { invalidateDaySummaries, upsertMealInCache } from '@/features/meals/api';

import type { ConfirmInput, ConfirmResponse, ScanInput, ScanProblem, ScanResponse } from './types';
import { SCAN_TIMEOUT_MS } from './utils';

/** `POST /api/meals/scan` — costs credits; the caller syncs the returned balance. */
export function useScanMeal() {
  return useMutation({
    mutationFn: (input: ScanInput) => {
      const note = input.note?.trim();
      return api.post<ScanResponse>('/meals/scan', note ? { image: input.image, note } : { image: input.image }, { timeoutMs: SCAN_TIMEOUT_MS });
    },
    retry: false,
  });
}

/** `POST /api/meals/scan/[id]/confirm` — logs the reviewed scan; the new meal lands in the meal-log cache straight away. */
export function useConfirmScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: ConfirmInput) => api.post<ConfirmResponse>(`/meals/scan/${encodeURIComponent(id)}/confirm`, body, { timeoutMs: 30_000 }),
    onSuccess: ({ meal }) => {
      upsertMealInCache(qc, meal);
      // The day's log, Today, reports and other day summaries refetch.
      invalidateDaySummaries(qc, meal.date);
    },
  });
}

/** Map anything thrown while picking / preparing / scanning to the panel the Snap screen shows. */
export function scanProblem(e: unknown): ScanProblem {
  if (e instanceof PhotoPermissionError) {
    const what = e.source === 'camera' ? 'camera' : 'photos';
    return {
      kind: 'permission',
      source: e.source,
      blocked: e.status === 'blocked',
      message:
        e.status === 'blocked'
          ? `ÖRZA needs access to your ${what} to snap a meal. You can turn it on in Settings.`
          : e.source === 'camera'
            ? 'ÖRZA needs camera access to take a photo of your meal.'
            : 'ÖRZA needs photo access to choose a picture of your meal.',
    };
  }
  if (e instanceof PhotoError) return { kind: 'error', message: e.message, retry: false };
  if (e instanceof ApiError) {
    if (e.code === 'ai_disabled' || e.status === 503) {
      return { kind: 'ai_disabled', message: e.code === 'ai_disabled' ? e.message : "Photo scanning isn't available right now. You can type or speak your meal instead." };
    }
    if (e.status === 402 || e.code === 'no_credits' || e.code === 'insufficient_credits') return { kind: 'no_credits', message: e.message };
    if (e.status === 429 || e.code === 'rate_limited') return { kind: 'rate_limited', message: e.message };
    // 422 no_food / 400 bad photo: try another photo; network / timeout / 5xx: the same photo can be retried.
    return { kind: 'error', message: errorMessage(e), retry: e.status !== 422 && e.status !== 400 };
  }
  return { kind: 'error', message: errorMessage(e, "We couldn't read that photo. Please try another."), retry: false };
}
