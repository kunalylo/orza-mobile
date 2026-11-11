/**
 * App-wide AI consent (`docs/notes/ai-consent.md`; App Store 5.1.2(i), Google Play User Data and Health Connect): the
 * first time a member starts an AI feature, a one-time sheet names OpenAI and what is sent, with Allow / Not now. AI
 * requests wait until the account has a recorded consent; the rest of the app works without it.
 *
 * Pure (types only), so `npm run test:ai` loads it in Node:
 * - the consent record: `users.ai_consent = {version, at}` on the server, in every `{user}` answer (`null`: none; the
 *   field missing: an old server) — `aiConsentState`, `serverKnowsAiConsent`;
 * - the gate every AI entry point awaits (`features/ai/consent.ts` `ensureAiConsent`): `gateStep`, `runAiGate`;
 * - the backstop in `lib/api.ts` (it refuses these paths while there is no recorded consent): `AI_PATHS`, `isAiPath`;
 * - a refusal (`403 ai_consent_required`, the server's or the backstop's) and `409 ai_consent_outdated`, duck-typed on
 *   `{status, code}`;
 * - every string the sheet, the declined notes and Settings › Privacy & data show (§4; the user reviews them).
 */

import type { AiConsent } from './types';

/** The consent text this app shows. A material change to what is sent (a new data type, provider or purpose) bumps it here and on the server together. */
export const AI_CONSENT_VERSION = 1;

/** Where a member starts an AI request (one per route, §2). */
export type AiFeature = 'chat' | 'meal_text' | 'snap' | 'recipe' | 'rebalance' | 'rx';
export const AI_FEATURES: readonly AiFeature[] = ['chat', 'meal_text', 'snap', 'recipe', 'rebalance', 'rx'];

/** What the consent copy is for: an AI feature's first use, or Settings › Privacy & data › AI features. */
export type ConsentContext = AiFeature | 'settings';

/** Any user copy: `PublicUser`, the Keychain snapshot, a test's fake. */
export interface AiConsentUser {
  ai_consent?: AiConsent | null;
}

/**
 * - `allowed`: a recorded consent at or above `version`.
 * - `ask`: none (`null`), malformed, or an older version — the sheet asks.
 * - `unsupported`: the field is missing — an old server (or a snapshot saved before this build): never ask, never send.
 */
export type AiConsentState = 'allowed' | 'ask' | 'unsupported';

export function aiConsentState(user: AiConsentUser | null | undefined, version: number = AI_CONSENT_VERSION): AiConsentState {
  if (!user || user.ai_consent === undefined) return 'unsupported';
  const c: unknown = user.ai_consent;
  if (!c || typeof c !== 'object') return 'ask';
  const v = (c as { version?: unknown }).version;
  return typeof v === 'number' && Number.isFinite(v) && v >= version ? 'allowed' : 'ask';
}

/** The server knows about AI consent (its `{user}` answers carry the field, `null` included). */
export function serverKnowsAiConsent(user: AiConsentUser | null | undefined): boolean {
  return aiConsentState(user) !== 'unsupported';
}

/* ───────────────────────────── The gate (§3.3) ───────────────────────────── */

export type GateStep = 'go' | 'refresh' | 'ask' | 'unavailable';

/**
 * The gate's next step for a user copy in `state`:
 * - `refused` (the server answered 403 `ai_consent_required`): ask — the cache is out of date, never trust it then;
 * - allowed: go;
 * - not yet refreshed: re-read `/auth/me` first — a consent given on another phone or on the web is then used without
 *   asking again (and an old snapshot learns the server knows consent);
 * - after the refresh: ask, or `unavailable` on an old server.
 */
export function gateStep(state: AiConsentState, { refreshed, refused }: { refreshed: boolean; refused: boolean }): GateStep {
  if (refused) return 'ask';
  if (state === 'allowed') return 'go';
  if (!refreshed) return 'refresh';
  return state === 'ask' ? 'ask' : 'unavailable';
}

/** What `runAiGate` needs from the app (`features/ai/consent.ts`; fakes in the tests). */
export interface GateDeps {
  /** The backstop's answer (`lib/api.ts`): the user in state has a recorded consent. The final word on "go". */
  allowed: () => boolean;
  /** The user copy in state. */
  user: () => AiConsentUser | null;
  /** Still the member the gate started for: false once they signed out or another account signed in. */
  current: () => boolean;
  /** `/auth/me` (time-bounded by the caller): the fresh copy, now in state — or null when ÖRZA couldn't answer. */
  refresh: () => Promise<AiConsentUser | null>;
  /** The consent sheet: true once Allow saved the consent on the server (and the copy in state has it). */
  ask: () => Promise<boolean>;
}

/**
 * - `go`: the request may go (the backstop is open);
 * - `declined`: Not now, closed, Android back — or Allow couldn't save (offline);
 * - `unavailable`: an old server — no sheet, no request;
 * - `offline`: an old snapshot and no answer from ÖRZA — it can't tell, so nothing is sent;
 * - `gone`: the member signed out (or another account signed in) while the gate waited — nothing is sent or shown: the
 *   next member's sheet and consent are never theirs.
 */
export type GateOutcome = 'go' | 'declined' | 'unavailable' | 'offline' | 'gone';

/**
 * One pass of the gate (§3.3). A copy that says "allowed" while the backstop is closed is not trusted (it is out of
 * step for a moment), and the sheet's "true" counts only once the backstop opened: the gate never says "go" to a
 * request the backstop would refuse — a refusal's retry can't loop.
 */
export async function runAiGate(deps: GateDeps, { refused = false }: { refused?: boolean } = {}): Promise<GateOutcome> {
  if (!refused && deps.allowed()) return 'go';
  const stateOf = (u: AiConsentUser | null) => {
    const s = aiConsentState(u);
    return s === 'allowed' && !deps.allowed() ? 'ask' : s;
  };
  let state = stateOf(deps.user());
  let refreshed = false;
  let answered = true;
  for (;;) {
    const step = gateStep(state, { refreshed, refused });
    if (step === 'go') return 'go';
    if (step === 'refresh') {
      const me = await deps.refresh();
      if (!deps.current()) return 'gone';
      answered = !!me;
      state = stateOf(me ?? deps.user());
      refreshed = true;
      continue;
    }
    if (step === 'unavailable') return answered ? 'unavailable' : 'offline';
    const allowed = await deps.ask();
    if (!deps.current()) return 'gone';
    return allowed && deps.allowed() ? 'go' : 'declined';
  }
}

/* ───────────────────────────── The backstop's paths ───────────────────────────── */

/** The six routes that call OpenAI (web `aiJSON`'s only callers, §2). */
export const AI_PATHS = ['/chat/send', '/meals/text', '/meals/scan', '/recipes/generate', '/compensation/plan', '/prescriptions/scan'] as const;

/**
 * A request path is one of `AI_PATHS` — `/api/…` or not, absolute or relative, ignoring the query, the hash, a trailing
 * slash, doubled slashes and case (the backstop refuses rather than guesses). `/meals/scan/<id>/confirm`,
 * `/prescriptions/<id>/apply` and `/recipes/<id>/save` are not AI.
 */
export function isAiPath(path: string): boolean {
  let p = String(path ?? '').trim();
  const abs = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*(.*)$/i.exec(p);
  if (abs) p = abs[1];
  p = p.split(/[?#]/)[0].replace(/\/{2,}/g, '/').replace(/\/+$/, '').toLowerCase();
  if (!p.startsWith('/')) p = `/${p}`;
  if (p.startsWith('/api/')) p = p.slice(4);
  return (AI_PATHS as readonly string[]).includes(p);
}

/* ───────────────────────────── Refusals ───────────────────────────── */

export const AI_CONSENT_REQUIRED = 'ai_consent_required';
export const AI_CONSENT_OUTDATED = 'ai_consent_outdated';

/** The backstop's own refusal carries `data: AI_LOCAL_REFUSAL` (nothing left the phone). */
export const AI_LOCAL_REFUSAL = { local: true } as const;

/** The server's words for its 403 (the backstop uses them too). */
export const AI_REFUSAL_MESSAGE = 'Allow ÖRZA’s AI features in the app to use this.';

type Coded = { status?: unknown; code?: unknown; data?: unknown };
const coded = (e: unknown): Coded | null => (e && typeof e === 'object' ? (e as Coded) : null);

/** `403 ai_consent_required` — the server's (the account has no consent) or the backstop's. Show the sheet. */
export function isAiConsentRefusal(e: unknown): boolean {
  const c = coded(e);
  return c?.status === 403 && c.code === AI_CONSENT_REQUIRED;
}

/** The backstop refused before `fetch`: nothing reached the server (so its cache isn't known to be wrong). */
export function isLocalAiRefusal(e: unknown): boolean {
  const data = coded(e)?.data;
  return isAiConsentRefusal(e) && !!data && typeof data === 'object' && (data as { local?: unknown }).local === true;
}

/** `409 ai_consent_outdated` on Allow: this app's sheet is older than the server's consent version — update the app. */
export function isAiConsentOutdated(e: unknown): boolean {
  const c = coded(e);
  return c?.status === 409 && c.code === AI_CONSENT_OUTDATED;
}

/* ───────────────────────────── Copy (§4) ───────────────────────────── */

/** `features/ai/AiConsentSheet.tsx` maps these to icons (camera, message-circle, chef hat, file-text, lock). */
export type ConsentPointIcon = 'meals' | 'chat' | 'recipes' | 'rx' | 'never';

export interface ConsentCopy {
  eyebrow: string;
  title: string;
  /** The feature's first sentence (none from Settings), then who runs it and what is sent. */
  lead: string;
  points: { icon: ConsentPointIcon; text: string }[];
  /** Under the points. */
  after: string[];
  /** Opens the website's privacy policy at `AI_PRIVACY_PATH`. */
  link: string;
  allow: 'Allow';
  notNow: 'Not now';
}

/** The website's privacy policy, AI section (opened in the in-app browser). */
export const AI_PRIVACY_PATH = '/privacy#ai-processing';

const FIRST: Record<AiFeature, string> = {
  chat: 'Ask ÖRZA answers with AI.',
  meal_text: 'ÖRZA reads typed and spoken meals with AI.',
  snap: 'Snap & Know reads your meal photo with AI.',
  recipe: 'ÖRZA writes new recipes with AI.',
  rebalance: 'ÖRZA personalises rebalance plans with AI.',
  rx: 'ÖRZA reads prescription photos with AI.',
};

const WHO = 'These features are run by OpenAI, our AI provider. When you use one, ÖRZA sends OpenAI only what that request needs:';

/** The phone's step and weight sources, as the coach's prompt can carry them (5.1.3(i): name the health data). */
const HEALTH_SOURCES: Record<'ios' | 'android', string> = {
  ios: 'Steps can come from Apple Health or your iPhone’s motion sensor, and weight from Apple Health.',
  android: 'Steps can come from Health Connect or this phone, and weight from Health Connect.',
};

const OFF_ANY_TIME = 'Turn AI features off any time in Settings › Privacy & data.';

/** The consent sheet (and the Settings manage sheet's points). */
export function consentCopy(context: ConsentContext, platform: 'ios' | 'android'): ConsentCopy {
  const first = context === 'settings' ? null : FIRST[context];
  return {
    eyebrow: 'AI features',
    title: 'Allow ÖRZA’s AI features?',
    lead: first ? `${first} ${WHO}` : WHO,
    points: [
      { icon: 'meals', text: 'Meals — your meal photo, or the words you type or say, with your diet, region and language.' },
      {
        icon: 'chat',
        text: `Ask ÖRZA — your message and the chat so far, your first name and everything in your profile (including age, sex, weight, diet, allergies and health notes), your targets, what ÖRZA remembers, and today’s meals, water and steps. ${HEALTH_SOURCES[platform]}`,
      },
      { icon: 'recipes', text: 'Recipes and rebalance plans — what you ask for or ate, with your diet, allergies and foods you avoid (including those you told Ask ÖRZA), region, goal and targets; recipes add your household setting and recent recipe titles, rebalance plans your first name.' },
      { icon: 'rx', text: 'Prescription scans — the prescription photo and the allergies you listed.' },
      // The account's and the saved ones: a photo or a message can show anything (a prescription shows its medicines).
      { icon: 'never', text: 'Never your account’s email, password or phone number, your saved medicines and alarms, or your sleep and heart rate.' },
    ],
    after: [
      'ÖRZA shares this only to answer you — never for ads, and it’s never sold.',
      'Everything else works without AI: the food list, medicines and alarms, steps, water and weight.',
      ...(context === 'settings' ? [] : [OFF_ANY_TIME]),
    ],
    link: 'How ÖRZA uses AI',
    allow: 'Allow',
    notNow: 'Not now',
  };
}

const DECLINED: Record<AiFeature, string> = {
  chat: 'Ask ÖRZA needs AI features. Your earlier chats are still here.',
  meal_text: 'Typing or speaking a meal needs AI features. You can still add foods from the food list.',
  snap: 'Snap & Know needs AI features. You can still log your meal from the food list.',
  recipe: 'New recipes need AI features. Your saved recipes are still here.',
  rebalance: 'New rebalance plans need AI features. Your earlier plans are still here.',
  rx: 'Reading a prescription needs AI features. You can type the medicines instead.',
};

/** After Not now: why the feature waits, and what still works (next to an "Allow AI features" button). */
export function declinedLine(feature: AiFeature): string {
  return DECLINED[feature];
}

/** The button that asks again. */
export const ALLOW_AI_LABEL = 'Allow AI features';

/** An old server (no `ai_consent` field): no sheet, no AI request. */
export const AI_UNAVAILABLE = 'ÖRZA’s AI features aren’t ready for this app yet. Please try again later.';

/** A refusal shown where the feature isn't known (`chat/ai.aiErrorInfo` without one). */
export const AI_NEEDED_LINE = 'This needs ÖRZA’s AI features. You can allow them in Settings › Privacy & data.';

/** Allow answered 409: the server's consent version is newer than this app's sheet. */
export const AI_OUTDATED_LINE = 'This version of ÖRZA can’t turn on AI features. Please update the app.';
/** Allow or Turn off failed with an answer (offline / timeout use the API client's own lines). */
export const AI_SAVE_FAILED_LINE = 'Couldn’t save your choice. Please try again.';

/** Settings › Privacy & data › AI features: the row's subtitle. */
export function aiSettingsSubtitle(state: AiConsentState): string {
  if (state === 'allowed') return 'On · run by OpenAI';
  if (state === 'ask') return 'Off · ÖRZA asks before the first use';
  return 'Not available yet';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The manage sheet's status line: "On since 10 Nov 2026" (the phone's calendar day), "Off"; null on an old server. */
export function aiStatusLine(user: AiConsentUser | null | undefined): string | null {
  const state = aiConsentState(user);
  if (state === 'unsupported') return null;
  if (state === 'ask') return 'Off';
  const d = new Date(user?.ai_consent?.at ?? '');
  return Number.isNaN(d.getTime()) ? 'On' : `On since ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** The manage sheet's turn-off confirm. */
export const AI_TURN_OFF = {
  button: 'Turn off AI features',
  title: 'Turn off AI features?',
  body: 'Ask ÖRZA, Snap & Know, typed and spoken meals, recipes, rebalance plans and prescription scans stop in the app and on the website until you allow them again. Your meals, chats and plans stay.',
  confirm: 'Turn off',
  cancel: 'Keep on',
} as const;

export const AI_TOASTS = {
  /** "In the app": the website doesn't ask yet (`docs/notes/ai-consent.md` §11 Q1). */
  off: 'AI features are off. ÖRZA will ask before using them again.',
  /** Allow from Settings only (the sheet's Allow just carries on with the action). */
  on: 'AI features are on.',
} as const;
