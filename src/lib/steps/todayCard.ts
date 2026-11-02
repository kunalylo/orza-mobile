/**
 * What Today's steps card offers (steps v2, `docs/notes/steps-v2.md` §2.2, §6, U1, U2) — pure, so `npm run test:steps`
 * covers it; `features/today/StepsCard.tsx` renders it from `useTodaySteps()`.
 *
 * - P7: "Log steps" whenever nothing counts today (`manual = !countingToday`), whatever the permission state; "Edit"
 *   while something does.
 * - P6: one disclosure sheet with one button — "Continue" right before the system prompt, or "Turn on" when the OS
 *   permission is already there (a second member on the phone, the switch was off: a consent screen, closable).
 * - P19: "Not now — I'll log steps" after a refusal (and on a "Turn on" ask) folds the ask for 30 days; never on a fresh
 *   first ask, where the system prompt hasn't been seen.
 * - §2.2: Android after a Health Connect refusal → "Open Health Connect" (its sheet stays shut after two refusals) and a
 *   separate "Use this phone's motion sensor instead" — never chained after the refusal; Android with the phone counting
 *   where Health Connect doesn't count it → "Include your watch or fitness app"; iPhone with Apple Health empty → "Use
 *   iPhone motion instead", once.
 * - §6: the disclosure's points and captions by path (`disclosureCopy`).
 * - U5: where Health Connect's steps came from (`originLabel`: "From Samsung Health", "From this phone"); the hint when
 *   the phone's time zone has another offset than the profile's (`zoneHint`: steps count by the profile's days, R8d).
 */
import { isValidTimeZone, safeTimeZone, tzOffsetMinutes } from '../alarms/schedule';

import type { CountingSource, StepsAskState } from './plan';
import type { StepsAccess, StepsAsk } from './types';

/**
 * Which disclosure the sheet shows (§6 "Points by path"):
 * - `hc`: Health Connect where it counts this phone itself (Android 14+, extension 20);
 * - `hc_add`: Health Connect beside the phone's own count ("Include your watch or fitness app", Android 9–13);
 * - `hc_watch`: Health Connect on a phone without a step counter (watches and apps only);
 * - `phone`: Physical activity, read through Google Play services' Recording API; `phone_sampler`: without it (the
 *   sampler);
 * - `healthkit`: Apple Health; `motion`: the iPhone's motion sensor when Apple Health has no steps; `ios_phone`: the
 *   iPhone's motion sensor first (no Apple Health on the device).
 */
export type DisclosurePath = 'hc' | 'hc_add' | 'hc_watch' | 'phone' | 'phone_sampler' | 'healthkit' | 'motion' | 'ios_phone';

export interface DisclosureSheet {
  /** The permission it is about (`useTodaySteps().requestAccess` / `turnOn`). */
  kind: StepsAsk;
  path: DisclosurePath;
  /** `continue`: the system prompt follows; `turn_on`: the OS permission is already there — the member's OK only. */
  variant: 'continue' | 'turn_on';
  /** The motion fallback (U2): Android after a Health Connect refusal, iPhone when Apple Health has no steps. */
  fallback?: boolean;
}

/** What a button on the card does. */
export type CardAction =
  | { type: 'sheet'; sheet: DisclosureSheet }
  /** The app's own Settings page (the phone's permission refused for good). */
  | { type: 'settings' }
  /** Health Connect (after a refusal: its sheet may not show again). */
  | { type: 'store_settings' }
  /** Google Play's Health Connect page (not installed / too old). */
  | { type: 'store_install' };

/**
 * - `checking`: the first check of the phone hasn't finished;
 * - `counting`: a source has today's steps;
 * - `waiting`: a source is ON but has nothing for today yet;
 * - `health_empty`: iPhone — Apple Health has no steps for today nor the 7 days before (§2.2);
 * - `asking`: nothing counts, Today asks (§2.2); `folded`: the member said "Not now";
 * - `none`: nothing can count on this phone; `unknown`: the phone's state isn't known (the check timed out).
 */
export type CardState = 'checking' | 'counting' | 'waiting' | 'health_empty' | 'asking' | 'folded' | 'none' | 'unknown';

export interface TodayCard {
  state: CardState;
  /** The full-width button (today only). */
  cta: CardAction | null;
  /** "Use this phone's motion sensor instead" (Android) / "Use iPhone motion instead" (iPhone, once). */
  motion: CardAction | null;
  /** Android: "Include your watch or fitness app". */
  watch: CardAction | null;
  /** "Not now — I'll log steps" (P19). */
  notNow: boolean;
  /** "Log steps" (P7: nothing counts the day). */
  log: boolean;
  /** "Edit" (something counts: the member's number, plus what is counted after it). */
  edit: boolean;
}

export interface CardInputs {
  platform: 'android' | 'ios' | 'none';
  /** The card shows the member's today (else a past day: only "Log steps" / "Edit"). */
  isToday: boolean;
  /** The phone's step sources and permissions (null until the first check finished). */
  access: StepsAccess | null;
  /** A read is running. */
  busy: boolean;
  /** What Today asks (`StepsState.ask`; null: something counts, or nothing can). */
  ask: StepsAskState | null;
  /** "Not now" folds the ask (P19). */
  askFolded: boolean;
  /** The sources ON for the member (§2.1). */
  sources: readonly CountingSource[];
  /** Some source has a reading for today. */
  countingToday: boolean;
  /** iPhone with Apple Health ON: it has no steps for today nor the 7 days before. */
  healthEmpty: boolean;
  /** iPhone: the one-time motion offer was made. */
  motionOffered: boolean;
  /** Android: Health Connect's steps sheet was refused from Today (prefs, per install). */
  hcRefused: boolean;
}

const sheet = (s: DisclosureSheet): CardAction => ({ type: 'sheet', sheet: s });

/** The phone's own counter: Android's Recording API / sampler (S-A2, S-A4), the iPhone's CMPedometer. */
const isPhone = (x: CountingSource) => x !== 'store';

/** Android Physical activity: Play services' Recording API counts (or will), else the sampler. */
function phonePath(a: StepsAccess): DisclosurePath {
  if (a.features?.platform === 'ios') return 'ios_phone';
  return a.recording === undefined || a.recording === 'available' ? 'phone' : 'phone_sampler';
}

/** Health Connect's disclosure for this phone (§6 / U1: the watch copies where Health Connect doesn't count it). */
function hcPath(a: StepsAccess): DisclosurePath {
  const f = a.features;
  if (!f?.counter) return 'hc_watch';
  return f.stepTracking ? 'hc' : 'hc_add';
}

/**
 * The phone's own counter as a fallback (U2): its sheet ("Continue" → the prompt; "Turn on" when it is allowed already),
 * or Settings when the permission is refused for good. Null without a counter.
 */
function motionAction(a: StepsAccess, path: DisclosurePath): CardAction | null {
  if (!a.phoneAvailable || a.phonePermission === 'unavailable') return null;
  if (a.phonePermission === 'blocked') return { type: 'settings' };
  return sheet({ kind: 'phone', path, variant: a.phonePermission === 'granted' ? 'turn_on' : 'continue', fallback: true });
}

/** Health Connect from a button (the ask, the watch button): Play, then Health Connect after a refusal, else its sheet. */
function hcAction(a: StepsAccess, hcRefused: boolean, path: DisclosurePath): CardAction {
  if (a.store === 'granted') return sheet({ kind: 'hc', path, variant: 'turn_on' });
  if (a.store === 'needs_install') return { type: 'store_install' };
  if (hcRefused) return { type: 'store_settings' };
  return sheet({ kind: 'hc', path, variant: 'continue' });
}

/** Today's ask (§2.2) as the card's buttons. */
function askButtons(a: StepsAccess, ask: StepsAskState, hcRefused: boolean): Pick<TodayCard, 'cta' | 'motion' | 'notNow'> {
  const { kind, granted } = ask;
  if (kind === 'phone') {
    const path = phonePath(a);
    if (granted) return { cta: sheet({ kind, path, variant: 'turn_on' }), motion: null, notNow: true };
    if (a.phonePermission === 'blocked') return { cta: { type: 'settings' }, motion: null, notNow: true };
    return { cta: sheet({ kind, path, variant: 'continue' }), motion: null, notNow: a.phonePermission === 'denied' };
  }
  if (kind === 'healthkit') {
    return { cta: sheet({ kind, path: 'healthkit', variant: granted ? 'turn_on' : 'continue' }), motion: null, notNow: granted };
  }
  const cta = granted ? sheet({ kind, path: hcPath(a), variant: 'turn_on' }) : hcAction(a, hcRefused, hcPath(a));
  // After a refusal: the phone's motion sensor, as its own button (never chained after the refusal).
  const motion = cta.type === 'store_settings' ? motionAction(a, phonePath(a)) : null;
  return { cta, motion, notNow: cta.type !== 'sheet' || cta.sheet.variant === 'turn_on' };
}

/**
 * Nothing could ever count here: the platform has no source, or the phone says none (§2.2 `none`). False while the
 * phone's state isn't known.
 */
export function nothingCanCount(platform: CardInputs['platform'], a: StepsAccess | null): boolean {
  if (platform === 'none') return true;
  return !!a && (a.firstAsk === 'none' || (!a.firstAsk && !a.phoneAvailable));
}

/** What Today's steps card offers for the day on screen (see the file header). */
export function todayCard(i: CardInputs): TodayCard {
  const none: TodayCard = { state: 'unknown', cta: null, motion: null, watch: null, notNow: false, log: false, edit: false };
  if (!i.access && i.busy) return { ...none, state: 'checking' };
  const autoOn = i.sources.length > 0;
  if (!i.isToday) {
    const edit = autoOn;
    return { ...none, state: autoOn ? 'waiting' : 'unknown', edit, log: !edit };
  }
  const a = i.access;
  if (i.countingToday) return { ...none, state: 'counting', edit: true, watch: a ? watchButton(i, a) : null };
  const manual = { ...none, log: true };
  if (!a) return manual;
  if (autoOn) {
    if (i.platform === 'ios' && i.healthEmpty && i.sources.includes('store') && !i.sources.includes('pedometer')) {
      // Offered once — and again only as "Turn on" once Motion & Fitness is allowed (in Settings) without the member's
      // OK: there is no other way to give it.
      const offer = !i.motionOffered || a.phonePermission === 'granted';
      return { ...manual, state: 'health_empty', motion: offer ? motionAction(a, 'motion') : null };
    }
    return { ...manual, state: 'waiting', watch: watchButton(i, a) };
  }
  if (i.ask) {
    if (i.askFolded) return { ...manual, state: 'folded' };
    return { ...manual, state: 'asking', ...askButtons(a, i.ask, i.hcRefused) };
  }
  return { ...manual, state: nothingCanCount(i.platform, i.access) ? 'none' : 'unknown' };
}

/**
 * Android, "Include your watch or fitness app" (§2.2): the phone's own counter is ON, Health Connect isn't, and Health
 * Connect doesn't count this phone itself (on Android 14+ with extension 20 it would replace the phone's count, S-A3 —
 * a member there who refused it isn't asked again from here).
 */
function watchButton(i: CardInputs, a: StepsAccess): CardAction | null {
  const f = a.features;
  if (i.platform !== 'android' || !f || f.stepTracking || !f.counter || f.store === 'unavailable') return null;
  if (i.sources.includes('store') || !i.sources.some(isPhone)) return null;
  return hcAction(a, i.hcRefused, 'hc_add');
}

/* ───────────────────────────── The disclosure (§6) ───────────────────────────── */

/** A point's picture: what is read (the store / a watch / the phone), shared, the history, the account, the switch. */
export type PointIcon = 'store' | 'watch' | 'phone' | 'share' | 'history' | 'saved' | 'off';

export interface DisclosureCopy {
  title: string;
  points: { icon: PointIcon; text: string }[];
  /** Under the points: what comes next (the system prompt) — null for "Turn on" (none follows). */
  caption: string | null;
  /** The sheet's one button (P6). */
  button: 'Continue' | 'Turn on';
}

const SAVED = 'Only each day’s total is saved to your ÖRZA account — on Today, your reports and the website. Never where you go.';
const OFF = 'Turn it off any time in Settings › Privacy & data.';
const HC_CAPTION = 'Next, Health Connect shows what ÖRZA would like to read.';
const ACTIVITY_CAPTION = 'Next, your phone asks to allow “Physical activity”.';
const MOTION_CAPTION = 'Next, your iPhone asks to allow “Motion & Fitness”.';

/** What each path reads (its first points), the history it brings at a full backfill (days; 0: none), its caption. */
const PATHS: Record<DisclosurePath, { read: { icon: PointIcon; text: string }[]; history: number; caption: string }> = {
  hc: {
    read: [
      { icon: 'store', text: 'ÖRZA reads your daily step total from Health Connect — this phone’s steps plus any watch or fitness app you use with it.' },
      { icon: 'share', text: 'Health Connect then keeps this phone’s steps, so other health apps you allow can use them too.' },
    ],
    history: 30,
    caption: HC_CAPTION,
  },
  hc_add: {
    read: [
      {
        icon: 'watch',
        text: 'ÖRZA also reads your daily step total from Health Connect, where your watch or fitness app shares it — Samsung Health, Fitbit and others.',
      },
    ],
    history: 30,
    caption: HC_CAPTION,
  },
  hc_watch: {
    read: [
      {
        icon: 'watch',
        text: 'ÖRZA reads your daily step total from Health Connect, where your watch or fitness app shares it — Samsung Health, Fitbit and others. This phone has no step counter of its own.',
      },
    ],
    history: 30,
    caption: HC_CAPTION,
  },
  // The Recording API and the sampler count from the moment they start: no history to bring in.
  phone: {
    read: [{ icon: 'phone', text: 'Your phone counts steps with a low-power motion sensor, and Google Play services keeps them for ÖRZA — even when ÖRZA is closed.' }],
    history: 0,
    caption: ACTIVITY_CAPTION,
  },
  phone_sampler: {
    read: [{ icon: 'phone', text: 'Your phone counts steps with a low-power motion sensor, and ÖRZA checks it through the day — even when ÖRZA is closed.' }],
    history: 0,
    caption: ACTIVITY_CAPTION,
  },
  healthkit: {
    read: [{ icon: 'store', text: 'ÖRZA reads your daily step total from Apple Health — your iPhone and Apple Watch counted once, just like the Health app.' }],
    history: 30,
    caption: 'Next, Apple Health shows what ÖRZA would like to read.',
  },
  motion: {
    read: [
      {
        icon: 'phone',
        text: 'Apple Health has no steps for ÖRZA, so your iPhone’s motion sensor can count them instead (the last 7 days, without a watch).',
      },
    ],
    history: 7,
    caption: MOTION_CAPTION,
  },
  ios_phone: {
    read: [{ icon: 'phone', text: 'Your iPhone counts your steps with its low-power motion sensor (without a watch).' }],
    history: 7,
    caption: MOTION_CAPTION,
  },
};

/**
 * §6: the disclosure for `path`. `fullBackfill` (M9: the member's consent reads each source's history — not on a shared
 * phone) adds "Your steps from the last 30 days come in too." (7 for the iPhone's motion; none for Android's phone
 * counter, which counts from the moment it starts). "Turn on": the same points, no "Next…" caption.
 */
export function disclosureCopy(path: DisclosurePath, variant: DisclosureSheet['variant'], fullBackfill: boolean): DisclosureCopy {
  const p = PATHS[path];
  const history = fullBackfill && p.history > 0 ? [{ icon: 'history' as const, text: `Your steps from the last ${p.history} days come in too.` }] : [];
  return {
    title: 'Count your steps automatically',
    points: [...p.read, ...history, { icon: 'saved', text: SAVED }, { icon: 'off', text: OFF }],
    caption: variant === 'continue' ? p.caption : null,
    button: variant === 'continue' ? 'Continue' : 'Turn on',
  };
}

/* ───────────────────────────── U5: labels and hints ───────────────────────────── */

/**
 * Health Connect's record origins (package names) the card names (§6, U5). `android` is Health Connect's own count of
 * this phone's steps (on-device step tracking, Android 14+).
 */
const ORIGIN_NAMES: Readonly<Record<string, string>> = {
  android: 'this phone',
  'com.sec.android.app.shealth': 'Samsung Health',
  'com.fitbit.FitbitMobile': 'Fitbit',
  'com.google.android.apps.fitness': 'Google Fit',
  'com.garmin.android.apps.connectmobile': 'Garmin Connect',
  'com.ouraring.oura': 'Oura',
  'com.withings.wiscale2': 'Withings',
};

/**
 * U5: "From Samsung Health" / "From Fitbit" / "From this phone" when one known app made up Health Connect's day total;
 * null (the card keeps "From Health Connect") for several apps — Health Connect's priority list decided — or an
 * unknown one.
 */
export function originLabel(origins: readonly string[] | undefined): string | null {
  const apps = [...new Set((origins ?? []).filter((o) => typeof o === 'string' && !!o))];
  if (apps.length !== 1) return null;
  const name = ORIGIN_NAMES[apps[0]];
  return name ? `From ${name}` : null;
}

/**
 * U5 (R8d): the phone's time zone has another UTC offset than the profile's at `at` — steps (and Today) count by the
 * profile's days, so a walk late in the phone's evening may land on the profile's next day. Null when the offsets
 * match (another name for the same zone included) or the phone's zone isn't known.
 */
export function zoneHint(profileTz: string, deviceTz: string | null | undefined, at: number): { profile: string; device: string } | null {
  if (!deviceTz || !isValidTimeZone(deviceTz)) return null;
  const profile = safeTimeZone(profileTz);
  if (profile === deviceTz) return null;
  const when = new Date(at);
  return tzOffsetMinutes(profile, when) === tzOffsetMinutes(deviceTz, when) ? null : { profile, device: deviceTz };
}
