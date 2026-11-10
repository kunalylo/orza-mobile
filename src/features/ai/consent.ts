/**
 * The AI consent gate (`docs/notes/ai-consent.md` §3.3) — a small store, no React except the hooks.
 *
 * - `ensureAiConsent(feature)`: every AI entry point awaits it, after its own checks and before its request. True at
 *   once while the member's copy has a recorded consent (the API client's backstop is open). Otherwise the gate
 *   (`lib/aiConsent.runAiGate`): one `/auth/me` refresh (a consent given on another phone or the web is used without
 *   asking), then the one-time sheet — or nothing at all on an old server. Never throws; concurrent calls share one pass.
 * - `onAiRefusal(e, feature, retry)`: first line of each AI request's error handling. A `403 ai_consent_required` from
 *   the server clears the copy's consent (the server is the authority) and opens the sheet; after Allow, `retry` runs
 *   once. The backstop's own refusal (nothing was sent) runs the ordinary gate.
 * - `useAiDeclined(feature)`: the gate said no for that feature (Not now, or an old server) — the screen shows its line
 *   (`AiDeclinedNote`, Snap's and Prescriptions' panels). Any "go" clears them all.
 * - `AiConsentHost` (mounted once in the member layout) binds the signed-in member and renders the sheet. None of the
 *   six entry points sits inside another sheet, so one global sheet is safe.
 */
import { useSyncExternalStore } from 'react';

import { aiConsentState, isAiConsentRefusal, isLocalAiRefusal, runAiGate, type AiFeature } from '@/lib/aiConsent';
import { getAiConsentAllowed, NETWORK_MESSAGE } from '@/lib/api';
import { useUser } from '@/lib/auth';
import type { PublicUser } from '@/lib/types';
import { toast } from '@/ui';

import { allowAiConsent, consentSaveError } from './api';

/** What the host gives the gate: the member as the app has them now. */
export interface AiConsentHostBinding {
  user: () => PublicUser | null;
  /** `useAuth().refresh` (offline: null, the snapshot stays). */
  refresh: () => Promise<PublicUser | null>;
  setUser: (user: PublicUser, opts?: { aiConsent?: boolean }) => void;
}

export interface AiConsentPrompt {
  visible: boolean;
  /** What the sheet's first sentence is about. */
  feature: AiFeature;
  /** Allow is recording the consent: the sheet can't be dismissed meanwhile. */
  saving: boolean;
  /** Allow failed (offline, an outdated app…): the sheet stays open with this line. */
  error: string | null;
}

type Declined = 'declined' | 'unavailable';

/** `/auth/me` for the gate: short — the member is waiting on a button. */
const REFRESH_TIMEOUT_MS = 6_000;
/** The sheet's answer waits for its exit at most this long (in case its `onClosed` never comes). */
const CLOSE_WAIT_MS = 1_200;

let host: AiConsentHostBinding | null = null;
let prompt: AiConsentPrompt = { visible: false, feature: 'chat', saving: false, error: null };
let declines: Partial<Record<AiFeature, Declined>> = {};
/** Resolves the sheet's question (Allow saved → true; Not now, closed, back → false). */
let answer: ((allowed: boolean) => void) | null = null;
/** The sheet's answer, held until the sheet has gone (`aiConsentSheetClosed`). */
let closing: { resolve: (allowed: boolean) => void; allowed: boolean; timer: ReturnType<typeof setTimeout> } | null = null;
let pending: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of [...listeners]) l();
}

function setPrompt(patch: Partial<AiConsentPrompt>) {
  prompt = { ...prompt, ...patch };
  emit();
}

function setDeclines(next: Partial<Record<AiFeature, Declined>>) {
  declines = next;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** `p`, or null after `ms` (or when it rejects). */
function bounded<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(null);
      }
    );
  });
}

/* ───────────────────────────── Host ───────────────────────────── */

/** `AiConsentHost` binds the signed-in member; the returned function unbinds. */
export function bindAiConsentHost(binding: AiConsentHostBinding): () => void {
  host = binding;
  return () => {
    if (host === binding) host = null;
  };
}

/** Another member (or none): an open question is answered "no", and nothing declined carries over. */
export function resetAiConsent() {
  closeSheet(false);
  aiConsentSheetClosed();
  setDeclines({});
}

export function useAiConsentPrompt(): AiConsentPrompt {
  return useSyncExternalStore(subscribe, () => prompt, () => prompt);
}

/* ───────────────────────────── The gate ───────────────────────────── */

/**
 * Await before an AI request: true when it may go. False: Not now (the screen shows `useAiDeclined`'s line), an old
 * server, offline with an old snapshot (a toast says so), or no member. Never throws.
 */
export function ensureAiConsent(feature: AiFeature): Promise<boolean> {
  if (getAiConsentAllowed()) return Promise.resolve(true);
  return gate(feature, false);
}

function gate(feature: AiFeature, refused: boolean): Promise<boolean> {
  if (pending) return pending;
  const h = host;
  if (!h) return Promise.resolve(false);
  const run = (async () => {
    try {
      const outcome = await runAiGate(
        {
          allowed: getAiConsentAllowed,
          user: h.user,
          refresh: () => bounded(h.refresh(), REFRESH_TIMEOUT_MS),
          ask: () => openSheet(feature),
        },
        { refused }
      );
      if (outcome === 'go') {
        if (Object.keys(declines).length) setDeclines({});
        return true;
      }
      if (outcome === 'offline') toast.error(NETWORK_MESSAGE);
      else setDeclines({ ...declines, [feature]: outcome === 'unavailable' ? 'unavailable' : 'declined' });
      return false;
    } catch {
      return false;
    } finally {
      pending = null;
    }
  })();
  pending = run;
  return run;
}

/**
 * An AI request failed: true when it was the consent's refusal (the caller stops there — the sheet takes over, and
 * `retry` runs once after Allow). False for anything else.
 */
export function onAiRefusal(e: unknown, feature: AiFeature, retry?: () => void): boolean {
  if (!isAiConsentRefusal(e)) return false;
  const local = isLocalAiRefusal(e);
  if (!local) forgetConsent();
  void gate(feature, !local).then((ok) => {
    if (ok) retry?.();
  });
  return true;
}

/** The server refused: its record has no consent (withdrawn elsewhere, or a newer version) — so neither has the copy. */
function forgetConsent() {
  const u = host?.user();
  if (u?.ai_consent) host?.setUser({ ...u, ai_consent: null }, { aiConsent: true });
}

/* ───────────────────────────── The sheet ───────────────────────────── */

function openSheet(feature: AiFeature): Promise<boolean> {
  return new Promise((resolve) => {
    aiConsentSheetClosed();
    answer?.(false);
    answer = resolve;
    setPrompt({ visible: true, feature, saving: false, error: null });
  });
}

/**
 * The answer is given once the sheet has slid away (`aiConsentSheetClosed`): one modal at a time — after Allow, Snap
 * opens the camera or gallery, which iOS won't present over a sheet that is still closing.
 */
function closeSheet(allowed: boolean) {
  const a = answer;
  answer = null;
  if (prompt.visible || prompt.saving) setPrompt({ visible: false, saving: false });
  if (!a) return;
  aiConsentSheetClosed();
  closing = { resolve: a, allowed, timer: setTimeout(aiConsentSheetClosed, CLOSE_WAIT_MS) };
}

/** The sheet has gone (its `onClosed`): the gate gets its answer. */
export function aiConsentSheetClosed() {
  const c = closing;
  closing = null;
  if (!c) return;
  clearTimeout(c.timer);
  c.resolve(c.allowed);
}

/** Not now, the backdrop, the close button, Android back — "no" (ignored while Allow is saving). */
export function declineAiConsentSheet() {
  if (prompt.saving) return;
  closeSheet(false);
}

/** Allow: record the consent on the server; the action carries on once the copy has it. Never throws. */
export async function allowFromAiConsentSheet(): Promise<void> {
  const h = host;
  if (!h || prompt.saving || !prompt.visible) return;
  setPrompt({ saving: true, error: null });
  try {
    const { user } = await allowAiConsent();
    h.setUser(user, { aiConsent: true });
    // Signed out or into another account meanwhile: that copy wasn't taken, and nothing may go.
    if (!getAiConsentAllowed()) throw new Error('The AI consent is not in place');
    closeSheet(true);
  } catch (e) {
    if (prompt.visible) setPrompt({ saving: false, error: consentSaveError(e) });
  }
}

/* ───────────────────────────── Declined ───────────────────────────── */

/** Allowed from Settings: no screen keeps a declined line. */
export function clearAiDeclines() {
  if (Object.keys(declines).length) setDeclines({});
}

/**
 * The gate said no for `feature`: Not now (`declined`) or an old server (`unavailable`) — until the member's copy says
 * otherwise (allowed on the web or another phone, picked up by a refresh; a server that now knows the consent).
 */
export function useAiDeclined(feature: AiFeature): { declined: boolean; unavailable: boolean } {
  const d = useSyncExternalStore(
    subscribe,
    () => declines[feature] ?? null,
    () => declines[feature] ?? null
  );
  const state = aiConsentState(useUser());
  return { declined: d === 'declined' && state !== 'allowed', unavailable: d === 'unavailable' && state === 'unsupported' };
}
