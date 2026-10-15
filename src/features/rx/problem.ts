/**
 * Why a prescription scan didn't work, in words for people — drives the problem panel on the capture screen
 * (manual entry, "Get more credits", "Try again").
 */
import { ApiError, errorMessage } from '@/lib/api';
import { PhotoError } from '@/lib/image';

export type RxProblemKind = 'ai_disabled' | 'ai_busy' | 'no_credits' | 'rate_limited' | 'offline' | 'photo' | 'error';

export interface RxProblem {
  kind: RxProblemKind;
  title: string;
  message: string;
}

function waitText(seconds?: number): string {
  if (!seconds || seconds <= 0) return 'in a minute';
  if (seconds < 90) return `in about ${Math.max(5, Math.round(seconds / 5) * 5)} seconds`;
  return `in about ${Math.round(seconds / 60)} minutes`;
}

export function rxProblem(e: unknown): RxProblem {
  if (e instanceof PhotoError) {
    return { kind: 'photo', title: "That photo didn't work", message: e.message };
  }
  if (e instanceof ApiError) {
    // Only `ai_disabled` means scanning is switched off. Other 503s are temporary — `ai_busy` (the AI provider is
    // rate-limiting for a moment) or a gateway hiccup — and stay retryable.
    if (e.code === 'ai_disabled') {
      return {
        kind: 'ai_disabled',
        title: "Scanning isn't available right now",
        message: e.message || "Prescription scanning isn't switched on yet. You can type the medicines from your prescription instead.",
      };
    }
    if (e.code === 'ai_busy') {
      return {
        kind: 'ai_busy',
        title: "ÖRZA's AI is busy",
        message: e.message || "ÖRZA's AI is busy right now. Please try again in a moment.",
      };
    }
    if (e.status === 402 || e.code === 'no_credits' || e.code === 'insufficient_credits') {
      return {
        kind: 'no_credits',
        title: "You're out of AI credits",
        message: e.message || 'Reading a prescription uses AI credits. You can still type the medicines in for free.',
      };
    }
    if (e.status === 429 || e.code === 'rate_limited') {
      return {
        kind: 'rate_limited',
        title: 'A short breather',
        message: `You've scanned a lot of photos in a short time. Please try again ${waitText(e.retryAfter)} — or type the medicines instead.`,
      };
    }
    if (e.isNetwork) {
      return { kind: 'offline', title: "You're offline", message: errorMessage(e) };
    }
    if (e.status === 400 || e.status === 413) {
      return { kind: 'photo', title: "That photo didn't work", message: errorMessage(e) };
    }
  }
  return { kind: 'error', title: "We couldn't read that prescription", message: errorMessage(e) };
}
