/**
 * React side of automatic step counting.
 *
 * - `useStepsAutoSync()` — mount once in the member layout: reads + saves on launch and on every return to the
 *   foreground (and starts the Android sampler once the permission is there).
 * - `useTodaySteps()` — the Today card: reads on focus, every minute while Today is visible and on return to the app;
 *   exposes the live reading, the permission state and `requestAccess` / `openSettings`.
 */
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { mergeTracking, todayKeys } from '@/features/today/api';
import type { TodayData } from '@/features/today/types';
import { useAuth, useSignedInUser } from '@/lib/auth';

import { safeTimeZone } from '../alarms/schedule';

import { openStepsSettings, stepsReader } from './reader';
import { useDayRecord } from './store';
import { bindStepsMember, getStepsState, refreshSteps, subscribeStepsState, type RefreshOptions, type RefreshReason, type StepsMember } from './sync';
import type { StepPermission } from './types';

/** Today's server count from React Query counts as current for this long (else the sync asks the server). */
const SERVER_FRESH_MS = 10 * 60_000;
/** Live refresh cadence while Today is on screen. */
const LIVE_EVERY_MS = 60_000;

function foregroundOptions(qc: QueryClient, reason: RefreshReason): RefreshOptions {
  return {
    reason,
    serverSteps: (date) => {
      const s = qc.getQueryState<TodayData>(todayKeys.day(date));
      const d = s?.data;
      if (!s || !d || d.date !== date || Date.now() - s.dataUpdatedAt > SERVER_FRESH_MS) return null;
      return typeof d.tracking?.steps === 'number' ? d.tracking.steps : 0;
    },
    onSaved: (date, tracking) => {
      // The numbers on screen are current now; reports chart the same steps — refetch them when next shown.
      mergeTracking(qc, date, tracking);
      void qc.invalidateQueries({ queryKey: ['reports'], refetchType: 'none' });
    },
  };
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

  /** One tap: the system prompt (when it can still show), then an immediate read. */
  const requestAccess = useCallback(async (): Promise<StepPermission> => {
    const result = await stepsReader.requestPermission();
    await refreshSteps({ id: userId, timeZone: tz }, foregroundOptions(qc, 'permission'));
    return result;
  }, [userId, tz, qc]);

  /** Re-check after Settings / the Health screen (no prompt). */
  const recheck = useCallback(() => refreshSteps({ id: userId, timeZone: tz }, foregroundOptions(qc, 'permission')), [userId, tz, qc]);

  return {
    platform: stepsReader.platform,
    permissionName: stepsReader.permissionName,
    settingsPath: stepsReader.settingsPath,
    /** Null until the first check finished. */
    access: mine ? s.access : null,
    healthConnected: mine ? s.healthConnected : false,
    /** The member's today at the last read. */
    date: mine ? s.date : null,
    /** Live automatic reading for `date` (null: no automatic source could read it). */
    reading: mine ? s.today : null,
    busy: mine && s.reading,
    /** What this phone saved / saw on the server for `date`. */
    record,
    requestAccess,
    recheck,
    openSettings: openStepsSettings,
  };
}
