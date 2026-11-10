/**
 * The AI consent endpoints (`docs/notes/ai-consent.md` §5): `PUT /api/settings/ai-consent {version}` (Allow) and
 * `DELETE` (Turn off). Both answer `{user}`; the caller puts it in place with `setUser(user, {aiConsent: true})`.
 */
import { AI_CONSENT_VERSION, AI_OUTDATED_LINE, AI_SAVE_FAILED_LINE, aiConsentState, isAiConsentOutdated } from '@/lib/aiConsent';
import { api, ApiError } from '@/lib/api';
import type { PublicUser } from '@/lib/types';

const SAVE_TIMEOUT_MS = 15_000;

/** Allow: the consent this app's sheet shows. Resolves only once the answer has it recorded. */
export async function allowAiConsent(): Promise<{ user: PublicUser }> {
  const res = await api.put<{ user: PublicUser }>('/settings/ai-consent', { version: AI_CONSENT_VERSION }, { timeoutMs: SAVE_TIMEOUT_MS });
  if (!res?.user?.id || aiConsentState(res.user) !== 'allowed') throw new Error('The AI consent was not recorded');
  return res;
}

/** Turn off (idempotent). Resolves only once the answer has no consent left. */
export async function withdrawAiConsent(): Promise<{ user: PublicUser }> {
  const res = await api.del<{ user: PublicUser }>('/settings/ai-consent', { timeoutMs: SAVE_TIMEOUT_MS });
  if (!res?.user?.id || aiConsentState(res.user) === 'allowed') throw new Error('The AI consent was not withdrawn');
  return res;
}

/** The line under a failed Allow / Turn off: offline or slow (the client's own words), an outdated app, or try again. */
export function consentSaveError(e: unknown): string {
  if (e instanceof ApiError && e.isNetwork) return e.message;
  if (isAiConsentOutdated(e)) return AI_OUTDATED_LINE;
  return AI_SAVE_FAILED_LINE;
}
