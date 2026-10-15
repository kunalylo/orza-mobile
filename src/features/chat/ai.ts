/**
 * Shared handling for ÖRZA's AI endpoints (chat, recipes, rebalance): friendly error descriptions and the
 * cache refresh after something logged a meal.
 */
import type { QueryClient } from '@tanstack/react-query';

import { ApiError, errorMessage, validationField } from '@/lib/api';

import { DAY_SUMMARY_ROOTS } from '@/features/meals/api';

/** Server AI calls give up after 45 s; leave room for the database writes around them. */
export const AI_TIMEOUT_MS = 65_000;

export interface AiErrorInfo {
  message: string;
  /** Server code (`no_credits`, `ai_disabled`, `rate_limited`, `network`, `timeout`, `validation`, …). */
  code: string;
  /** Validation errors name the offending field — show the message next to it. */
  field?: string;
  /** 402 — offer a way to the Credits screen. */
  needsCredits: boolean;
  /** Worth trying again (offline, timeout, busy, server hiccup). */
  retryable: boolean;
}

export function aiErrorInfo(e: unknown): AiErrorInfo {
  if (e instanceof ApiError) {
    const needsCredits = e.status === 402 || e.code === 'no_credits';
    const invalid = validationField(e);
    let message = invalid?.message ?? e.message;
    if (e.code === 'ai_disabled' || e.status === 503) message = e.message || "ÖRZA's AI isn't available right now. Please try again later.";
    if (needsCredits && !message) message = "You're out of AI credits. Manual logging stays free.";
    return {
      message: message || errorMessage(e),
      code: e.code,
      field: invalid?.field,
      needsCredits,
      retryable: e.isNetwork || e.status === 429 || e.status >= 500,
    };
  }
  return { message: errorMessage(e), code: 'unknown', needsCredits: false, retryable: true };
}

/**
 * After a chat reply or a recipe logged a meal (on a day we may not know): refresh every cached meal-log day
 * (`['meals','day',date]`) and the screens that summarise the day — the same roots the meal log refreshes.
 */
export function invalidateMealQueries(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    predicate: (q) => (q.queryKey[0] === 'meals' && q.queryKey[1] === 'day') || DAY_SUMMARY_ROOTS.includes(String(q.queryKey[0])),
  });
}
