/**
 * "Count steps automatically" outside Today — the Health screen's Steps card and the Settings › Privacy & data row
 * (steps v2, `docs/notes/steps-v2.md` §6 "Health screen: the Steps switch card", P9, P19, U3, U4) — pure, so `npm run
 * test:steps` covers it; `features/health/StepsSwitch.tsx` renders it from `useTodaySteps()`.
 *
 * - The switch is on while the member agreed on this install (the steps disclosure, the Health screen's connect) and
 *   hasn't switched it off (P9); its subtitle names what counts (§6).
 * - Turning it on: the member's consents count again (`resume`), or — never agreed on this install — Today's ask (§2.2:
 *   its disclosure, or Settings / Health Connect / Play), whatever "Not now" folded on Today (P19: the switch keeps the
 *   way back).
 * - On with nothing counting (a permission taken away since): what gets it counting again.
 * - Turning it off: a confirmation sheet (`offSheet`) with the way to remove ÖRZA's access in the phone's own settings
 *   — the switch never revokes it (P9: Health Connect's revoke would take sleep, weight and resting heart rate too; the
 *   Health screen's Disconnect does that).
 * - §2.8: the "both ways" line (`bothWaysLine`).
 */
import type { CountingSource, StepsAskState } from './plan';
import { nothingCanCount, todayCard, type CardAction } from './todayCard';
import type { StepFeatures, StepsAccess } from './types';

export interface SwitchInputs {
  platform: 'android' | 'ios' | 'none';
  /** "Count steps automatically" isn't switched off (the member's `consent.off`). */
  on: boolean;
  /** The member agreed to some source on this install (`consent.store` / `consent.phone`). */
  agreed: boolean;
  /** The sources ON at the last read (§2.1). */
  sources: readonly CountingSource[];
  /** The phone's step sources and permissions (null until the first check finished). */
  access: StepsAccess | null;
  /** What Today asks (`StepsState.ask`: published while nothing counts — also while the switch is off). */
  ask: StepsAskState | null;
  /** Android: Health Connect's steps sheet was refused (prefs, per install). */
  hcRefused: boolean;
}

/**
 * - `counting`: a source is ON;
 * - `off`: the member switched it off;
 * - `setup`: never agreed on this install — switching on starts Today's ask;
 * - `checking`: agreed and on, the phone's state not known yet;
 * - `stopped`: agreed and on, but nothing can count now (a permission taken away since);
 * - `none`: nothing can count on this phone; `unsupported`: not a phone (the web build).
 */
export type SwitchState = 'counting' | 'off' | 'setup' | 'checking' | 'stopped' | 'none' | 'unsupported';

/** What switching on does: the member's consents count again, or one of Today's ask actions. */
export type SwitchOn = { type: 'resume' } | CardAction;

export interface StepsSwitchView {
  state: SwitchState;
  /** The switch's position. */
  checked: boolean;
  /** The switch can be used. */
  enabled: boolean;
  subtitle: string;
  /** What switching on does (null: it can't be switched on). */
  turnOn: SwitchOn | null;
  /** `stopped`: what gets it counting again (Today's ask). */
  fix: CardAction | null;
  /** `setup` / `stopped` after a Health Connect refusal: "Use this phone's motion sensor instead" (U2). */
  motion: CardAction | null;
}

const RESUME: SwitchOn = { type: 'resume' };

/** Today's ask (§2.2) as actions — never folded here (P19). */
function askActions(i: SwitchInputs): { cta: CardAction | null; motion: CardAction | null } {
  if (!i.access || !i.ask) return { cta: null, motion: null };
  const card = todayCard({
    platform: i.platform,
    isToday: true,
    access: i.access,
    busy: false,
    ask: i.ask,
    askFolded: false,
    sources: [],
    countingToday: false,
    healthEmpty: false,
    motionOffered: true,
    hcRefused: i.hcRefused,
  });
  return { cta: card.cta, motion: card.motion };
}

const isPhone = (x: CountingSource) => x !== 'store';

/** §6's subtitle for the sources ON. */
function countingSubtitle(platform: SwitchInputs['platform'], sources: readonly CountingSource[], f: StepFeatures | undefined): string {
  const store = sources.includes('store');
  if (platform === 'ios') {
    const motion = sources.includes('pedometer');
    if (store && motion) return 'From Apple Health and your iPhone’s motion sensor';
    return store ? 'From Apple Health' : 'Counted by your iPhone’s motion sensor';
  }
  if (!store) return 'Counted by this phone';
  // Health Connect counts this phone itself (14+), or the phone's own count is ON beside it: §6's line. Else (no step
  // counter, or the member agreed to Health Connect alone) it holds only what watches and apps share.
  return f?.stepTracking || sources.some(isPhone) ? 'From Health Connect — this phone and your watch' : 'From Health Connect — your watch and fitness apps';
}

/** The switch for the member's state (see the file header). */
export function switchView(i: SwitchInputs): StepsSwitchView {
  const base: StepsSwitchView = { state: 'off', checked: false, enabled: true, subtitle: '', turnOn: null, fix: null, motion: null };
  if (i.platform === 'none') {
    return { ...base, state: 'unsupported', enabled: false, subtitle: 'Steps count by themselves in the ÖRZA phone app' };
  }
  if (!i.sources.length && nothingCanCount(i.platform, i.access)) {
    return { ...base, state: 'none', enabled: false, subtitle: 'This phone can’t count steps — log them on Today' };
  }
  const ask = askActions(i);
  if (!i.on) {
    return { ...base, state: 'off', subtitle: 'Off — you log steps yourself', turnOn: i.agreed ? RESUME : (ask.cta ?? RESUME) };
  }
  if (i.sources.length) {
    return { ...base, state: 'counting', checked: true, subtitle: countingSubtitle(i.platform, i.sources, i.access?.features) };
  }
  if (!i.agreed) {
    return { ...base, state: 'setup', subtitle: 'Not on yet — you log steps yourself', turnOn: ask.cta ?? RESUME, motion: ask.motion };
  }
  if (!i.access) return { ...base, state: 'checking', checked: true, subtitle: 'On — checking this phone…' };
  return { ...base, state: 'stopped', checked: true, subtitle: 'On — but ÖRZA can’t read your steps right now', fix: ask.cta, motion: ask.motion };
}

/* ───────────────────────────── The off sheet (§6) ───────────────────────────── */

export interface OffSheetCopy {
  title: string;
  body: string;
  /** Where the phone itself keeps ÖRZA's access (null: nothing granted that ÖRZA knows of). */
  note: string | null;
  /** The note's button: Health Connect (Android) / ÖRZA's page in Settings — none for Apple Health (§6). */
  open: 'store_settings' | 'settings' | null;
}

/**
 * §6 "Off confirmation sheet": the title, the body and the platform note. Android: Health Connect's App permissions
 * when it is granted ("may keep counting this phone's steps" only where it counts the phone itself), else Physical
 * activity when the phone's counter is allowed. iPhone: Apple Health's path (no button), and Motion & Fitness in ÖRZA's
 * Settings page when the motion sensor counts.
 */
export function offSheet(platform: SwitchInputs['platform'], sources: readonly CountingSource[], access: StepsAccess | null): OffSheetCopy {
  const copy = {
    title: 'Stop counting steps automatically?',
    body: 'ÖRZA stops reading steps on this phone. Steps already saved stay in your account.',
  };
  const store = sources.includes('store') || access?.store === 'granted';
  if (platform === 'android') {
    if (store) {
      const keeps = access?.features?.stepTracking ? 'Health Connect may keep counting this phone’s steps for other apps. ' : '';
      return { ...copy, note: `${keeps}To remove ÖRZA’s access, open Health Connect › App permissions › ÖRZA.`, open: 'store_settings' };
    }
    if (sources.some(isPhone) || access?.phonePermission === 'granted') {
      return { ...copy, note: 'To remove ÖRZA’s access, turn off Physical activity in Settings › Apps › ÖRZA › Permissions.', open: 'settings' };
    }
    return { ...copy, note: null, open: null };
  }
  if (platform === 'ios') {
    const motion = sources.includes('pedometer');
    if (store && motion) {
      return {
        ...copy,
        note: 'To remove ÖRZA’s access, open Settings › Health › Data Access & Devices › ÖRZA, and turn off Motion & Fitness in Settings › ÖRZA.',
        open: 'settings',
      };
    }
    if (store) return { ...copy, note: 'To remove ÖRZA’s access, open Settings › Health › Data Access & Devices › ÖRZA.', open: null };
    if (motion) return { ...copy, note: 'To remove ÖRZA’s access, turn off Motion & Fitness in Settings › ÖRZA.', open: 'settings' };
  }
  return { ...copy, note: null, open: null };
}

/* ───────────────────────────── "Both ways" (§6, §2.8) ───────────────────────────── */

/**
 * §6's "both ways" line. Android 14+ only while Health Connect counts this phone for ÖRZA (its step counting starts
 * with a grant — before that the phone's steps aren't in Health Connect); Android otherwise: what ÖRZA reads there.
 * Null when not a phone.
 */
export function bothWaysLine(platform: SwitchInputs['platform'], f: StepFeatures | undefined, sources: readonly CountingSource[]): string | null {
  if (platform === 'ios') {
    return 'Your iPhone already saves its steps to Apple Health for every app you allow. ÖRZA reads them and never writes a second copy.';
  }
  if (platform !== 'android') return null;
  if (f?.stepTracking && sources.includes('store')) {
    return 'Your phone’s steps are in Health Connect, so other health apps you allow see them too. ÖRZA doesn’t add a second copy.';
  }
  return 'ÖRZA reads steps that Samsung Health, Fitbit and others share through Health Connect.';
}
