/**
 * React side of automatic step counting (steps v2, `docs/notes/steps-v2.md` §2.2, §6).
 *
 * - `useStepsAutoSync()` — mount once in the member layout: reads + saves on launch and on every return to the
 *   foreground.
 * - `useTodaySteps()` — the Today card: reads on focus, every minute while Today is visible and on return to the app;
 *   the live reading, what counts (`sources`), what Today asks (`ask`: "Continue" before a system prompt, "Turn on" when
 *   the permission is already there) and the member's answers — `requestAccess(kind)`, `turnOn()`, `notNow()`,
 *   `motionInstead()`, `setAutoSteps(on)`.
 * - `useStepsSwitch()` — "Count steps automatically" for Settings › Privacy & data and the Health screen (no reads of
 *   its own).
 * - `refreshStepsNow(member, qc)` — a read right after a consent changed elsewhere (the Health screen's connect /
 *   disconnect), so Today follows at once.
 * Nothing is read or saved for a member without their consent on this install (P8) or with the switch off (P9): the
 * consent is recorded here, by the member's own answers (`sync.agreeToSteps`) — an OS permission alone is none.
 */
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { mergeServerSteps, mergeTracking } from '@/features/today/api';
import { useAuth, useSignedInUser } from '@/lib/auth';

import { safeTimeZone } from '../alarms/schedule';
import { healthBridge } from '../health/bridge';

import { dayValue } from './merge';
import { consentKindOf, type CountingSource } from './plan';
import { openStepsSettings, stepsReader } from './reader';
import { stepsFullBackfill, subscribeStepsStore, updateStepsConsent, useDayRecord, useStepsConsent } from './store';
import {
  ACCESS_TIMEOUT_MS,
  agreeToSteps,
  bindStepsMember,
  foldStepsAsk,
  getStepsState,
  publishStepsAccess,
  refreshSteps,
  setAutoSteps,
  subscribeStepsState,
  within,
  type RefreshOptions,
  type RefreshReason,
  type StepsMember,
} from './sync';
import type { PhoneCounter, StepPermission, StepsAsk } from './types';

/** Live refresh cadence while Today is on screen. */
const LIVE_EVERY_MS = 60_000;

const NO_SOURCES: readonly CountingSource[] = [];

/**
 * The sync never trusts Today's cached data to decide a save (this phone's own saves keep that cache looking fresh): it
 * reads the server right before saving. A save updates the caches here.
 */
function foregroundOptions(qc: QueryClient, reason: RefreshReason): RefreshOptions {
  return {
    reason,
    onSaved: (date, tracking) => {
      // The numbers on screen are current now; reports chart the same steps — refetch them when next shown.
      mergeTracking(qc, date, tracking);
      void qc.invalidateQueries({ queryKey: ['reports'], refetchType: 'none' });
    },
    onServerSteps: (date, steps) => mergeServerSteps(qc, date, steps),
  };
}

/**
 * A read for `member` now (reason `permission`: never skipped as too soon, past days included) — after a consent, the
 * switch or a permission changed. Resolves once it published; saves go on after.
 */
export function refreshStepsNow(member: StepsMember, qc: QueryClient): Promise<void> {
  return refreshSteps(member, foregroundOptions(qc, 'permission'));
}

/** Mount once in the signed-in area. Skips admins. */
export function useStepsAutoSync() {
  const { user, status } = useAuth();
  const qc = useQueryClient();
  const member = status === 'signedIn' && user && !user.is_admin ? user : null;
  const id = member?.id ?? null;
  const tz = safeTimeZone(member?.profile?.timezone);

  useEffect(() => {
    if (!id) {
      bindStepsMember(null);
      return undefined;
    }
    const m: StepsMember = { id, timeZone: tz };
    bindStepsMember(m);
    const run = (reason: RefreshReason) => void refreshSteps(m, foregroundOptions(qc, reason));
    run('launch');
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') run('foreground');
    });
    return () => sub.remove();
  }, [id, tz, qc]);

  useEffect(() => () => bindStepsMember(null), []);
}

/** Everything the Today steps card needs. */
export function useTodaySteps() {
  const user = useSignedInUser();
  const qc = useQueryClient();
  const s = useSyncExternalStore(subscribeStepsState, getStepsState);
  const userId = user.id;
  const tz = safeTimeZone(user.profile?.timezone);
  const mine = s.userId === userId;
  const record = useDayRecord(userId, mine ? s.date : null);
  const consent = useStepsConsent(userId);
  const fullBackfill = useSyncExternalStore(subscribeStepsStore, () => stepsFullBackfill(userId));

  useFocusEffect(
    useCallback(() => {
      const m: StepsMember = { id: userId, timeZone: tz };
      const run = () => {
        // Timers keep running for a while in the background on Android; a sensor read there would only time out.
        if (AppState.currentState !== 'active') return;
        void refreshSteps(m, foregroundOptions(qc, 'today'));
      };
      run();
      const timer = setInterval(run, LIVE_EVERY_MS);
      const sub = AppState.addEventListener('change', (next) => {
        if (next === 'active') run();
      });
      return () => {
        clearInterval(timer);
        sub.remove();
      };
    }, [userId, tz, qc])
  );

  /** A read now, in the background — never waiting on a run already in flight (its saves can take a while). */
  const refresh = useCallback(() => {
    void refreshStepsNow({ id: userId, timeZone: tz }, qc);
  }, [userId, tz, qc]);

  /** A permission answer arrived: shown at once, then a read. */
  const afterAnswer = useCallback(async () => {
    const access = await within(stepsReader.access(), ACCESS_TIMEOUT_MS);
    if (access) publishStepsAccess(userId, access);
    refresh();
  }, [userId, refresh]);

  /**
   * "Continue" on the disclosure (§6): the system prompt for `kind` (default the phone's own counter; Android `hc`:
   * Health Connect's Steps + background; iPhone `healthkit`: Apple Health's StepCount, `granted` = the sheet answered).
   * Granted → this member's consent to that kind (`plan.consentKindOf`), "Count steps automatically" back on, "Not now"
   * cleared. The answer is shown at once; the read follows in the background. A refusal records nothing.
   */
  const requestAccess = useCallback(
    async (kind: StepsAsk = 'phone'): Promise<StepPermission> => {
      const result = await stepsReader.requestPermission(kind);
      if (result === 'granted') await agreeToSteps(userId, consentKindOf(kind), { switchOn: true });
      await afterAnswer();
      return result;
    },
    [userId, afterAnswer]
  );

  /**
   * "Turn on" (§2.2: the permission for `kind` is already there — a second member on the phone, or after the switch was
   * off): the member's consent only, no system prompt. `kind` defaults to what Today asks; with no ask known, only the
   * switch goes back on (the member's earlier consents count again).
   */
  const turnOn = useCallback(
    async (kind?: StepsAsk) => {
      const st = getStepsState();
      const k = kind ?? (st.userId === userId ? st.ask?.kind : undefined);
      if (k) await agreeToSteps(userId, consentKindOf(k), { switchOn: true });
      else await setAutoSteps(userId, true);
      refresh();
    },
    [userId, refresh]
  );

  /** "Count steps automatically" on / off (P9; off: every source stops for the member at once). */
  const switchAutoSteps = useCallback(
    async (on: boolean) => {
      await setAutoSteps(userId, on);
      refresh();
    },
    [userId, refresh]
  );

  /** P19: "Not now — I'll log steps" folds the ask for 30 days (`askFolded`). */
  const notNow = useCallback(() => foldStepsAsk(userId), [userId]);

  /** iPhone: the one-time "Use iPhone motion instead" has been offered (the card shows it no more). */
  const markMotionOffered = useCallback(() => updateStepsConsent(userId, { motionOffered: true }), [userId]);

  /**
   * The motion fallback (§2.2, U2): "Use this phone's motion sensor instead" (Android, after a Health Connect refusal) /
   * "Use iPhone motion instead" (Apple Health has no steps; offered once — marked here). Then like `requestAccess('phone')`.
   */
  const motionInstead = useCallback(async (): Promise<StepPermission> => {
    if (stepsReader.platform === 'ios') markMotionOffered();
    return requestAccess('phone');
  }, [markMotionOffered, requestAccess]);

  /** Re-check after Settings / the Health screen (no prompt). */
  const recheck = useCallback(() => refresh(), [refresh]);

  const access = mine ? s.access : null;
  const sources = mine ? s.on : NO_SOURCES;
  const today = mine ? s.today : null;

  return {
    platform: stepsReader.platform,
    permissionName: stepsReader.permissionName,
    settingsPath: stepsReader.settingsPath,
    /** "Apple Health" / "Health Connect". */
    storeName: healthBridge.name,
    /** Null until the first check finished. */
    access,
    /** §2.2: what this phone asks first (null until checked). */
    firstAsk: access?.firstAsk ?? null,
    /** The health store's steps access (null until checked). */
    store: access?.store ?? null,
    /** The member connected Apple Health / Health Connect on the Health screen (the v1 card's wording, until U1). */
    healthConnected: mine ? s.healthConnected : false,
    /** What the member's consent lets ÖRZA read now (null: no consent on this install, or the switch is off). */
    consent: mine ? s.consent : null,
    /** The sources ON at the last read (§2.1; empty: nothing counts for the member). */
    sources,
    /** The phone's own counter that is ON (`recording` / `sampler` — "approximate" — / `pedometer`), or null. */
    counter: (sources.find((x) => x !== 'store') as PhoneCounter | undefined) ?? null,
    /** Some source counted today (P7: "Log steps" whenever none does — U1's `manual = !countingToday`). */
    countingToday: !!today && today.date === s.date,
    /** What Today asks (§2.2): `granted` → "Turn on" (consent only, closable); else "Continue", then the prompt. */
    ask: mine ? s.ask : null,
    /** P19: "Not now" folds the ask (30 days). */
    askFolded: mine && s.notNow,
    /** iPhone with Apple Health ON: it has no steps for today nor the 7 days before (§2.2). */
    healthEmpty: mine && s.healthEmpty,
    /** "Count steps automatically" is on (the member hasn't switched it off). */
    autoOn: !consent?.off,
    /** iPhone: the one-time motion offer was made. */
    motionOffered: !!consent?.motionOffered,
    /** M9: the next consent brings each source's full history (the disclosure's "Your steps from the last 30 days…"). */
    fullBackfill,
    /** The member's today at the last read. */
    date: mine ? s.date : null,
    /** Live automatic reading for `date`: every source's (null: no automatic source could read it, or none may). */
    reading: today,
    /** The day's number for `date` (M5: the live reading with the day's base, `merge.dayValue`); null without a reading. */
    value: today ? dayValue(today.day, record?.base, true) : null,
    busy: mine && s.reading,
    /** What this phone saved / saw on the server for `date`. */
    record,
    requestAccess,
    turnOn,
    setAutoSteps: switchAutoSteps,
    notNow,
    motionInstead,
    markMotionOffered,
    recheck,
    /** The app's own Settings page (a blocked phone permission). */
    openSettings: openStepsSettings,
    /** Health Connect's settings (Android: "Open Health Connect") / the app's Settings page (iPhone). */
    openStoreSettings: healthBridge.openManage,
    /** Google Play's Health Connect page (Android, `store` = `needs_install`). */
    openStoreInstall: healthBridge.openStore,
  };
}

/**
 * "Count steps automatically" (P9) outside Today — Settings › Privacy & data and the Health screen's Steps card. Reads
 * nothing itself: `sources` is the last read's (the app reads at launch and on every return).
 */
export function useStepsSwitch() {
  const user = useSignedInUser();
  const qc = useQueryClient();
  const userId = user.id;
  const tz = safeTimeZone(user.profile?.timezone);
  const consent = useStepsConsent(userId);
  const s = useSyncExternalStore(subscribeStepsState, getStepsState);
  const mine = s.userId === userId;

  /** Off: every source stops for the member at once, nothing more is read or saved; on: their consents count again. */
  const setOn = useCallback(
    async (on: boolean) => {
      await setAutoSteps(userId, on);
      void refreshStepsNow({ id: userId, timeZone: tz }, qc);
    },
    [userId, tz, qc]
  );

  return {
    platform: stepsReader.platform,
    /** "Apple Health" / "Health Connect". */
    storeName: healthBridge.name,
    /** The switch: on unless the member switched it off. */
    on: !consent?.off,
    /** The member agreed to some source on this install (the steps disclosure, the Health screen's connect). */
    agreed: !!(consent?.store || consent?.phone),
    /** The sources ON at the last read (the subtitle, §6: Health Connect / this phone / Apple Health / iPhone motion / off). */
    sources: mine ? s.on : NO_SOURCES,
    setOn,
    /** The off sheet's "Open Health Connect" (Android) / the app's Settings page (iPhone). */
    openStoreSettings: healthBridge.openManage,
  };
}
