/**
 * Mounted once in the member layout (`src/app/(app)/_layout.tsx`): keeps the phone's alarms in step.
 *
 * Re-plans on: start (signed in), the member's timezone / "Gentle reminders" / quiet hours changing, return to the
 * foreground (at most every 15 min unless something changed, at once after a permission or phone-timezone change),
 * dose and medicine events (`features/meds/events`), alarm data events (`emitAlarmDataChanged` — reminders, quiet hours),
 * and Take / Snooze / Skip pressed on an alarm. Registers the hourly background refresh. A tap on an alarm opens its
 * screen (`/alarm?at=…&med=…`).
 */
import { useQueryClient } from '@tanstack/react-query';
import { router, type Href } from 'expo-router';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { onDoseEvent } from '@/features/meds/events';
import { useAuth } from '@/lib/auth';
import { deviceTimeZone } from '@/lib/device';

import { alarmAdapter } from './adapter';
import { registerAlarmBackgroundTask } from './background';
import { onAlarmDataChanged } from './events';
import {
  bindAlarmForeground,
  checkAlarmsOnForeground,
  getAlarmSyncState,
  noteAlarmDataChanged,
  noteAlarmDoseEvent,
  recordAlarmAction,
  requestAlarmSync,
  subscribeAlarmSyncState,
  type AlarmSyncState,
} from './sync';

export function useAlarmSync(): void {
  const { user, status } = useAuth();
  const queryClient = useQueryClient();
  const member = status === 'signedIn' && user && !user.is_admin ? user : null;
  const userId = member?.id ?? null;
  const tz = member?.profile?.timezone ?? '';
  const remindersOn = member?.preferences?.reminders !== false;
  const quiet = member?.integrations?.quiet_hours;
  const quietKey = quiet ? `${quiet.start}-${quiet.end}` : '';
  const startedFor = useRef<string | null>(null);

  // The engine's view of the signed-in member (fallback settings, React Query for refreshing after queued actions).
  useEffect(() => {
    bindAlarmForeground(member ? { user: member, queryClient } : null);
  }, [member, queryClient]);
  useEffect(() => () => bindAlarmForeground(null), []);

  // Start, then re-plan when the member's timezone, reminder preference or quiet hours change.
  useEffect(() => {
    if (!userId) return;
    const first = startedFor.current !== userId;
    startedFor.current = userId;
    if (!first) noteAlarmDataChanged();
    requestAlarmSync(first ? 'start' : 'data-changed', { force: first, delayMs: first ? 600 : 1500 });
  }, [userId, tz, remindersOn, quietKey]);

  // Hourly background refresh (the OS decides when).
  useEffect(() => {
    if (userId) void registerAlarmBackgroundTask();
  }, [userId]);

  // Events, foreground, alarm actions.
  useEffect(() => {
    if (!userId) return;
    let phoneTz = deviceTimeZone();
    const offDose = onDoseEvent((event) => {
      noteAlarmDoseEvent(event);
      requestAlarmSync('dose-event');
    });
    const offData = onAlarmDataChanged((change) => {
      noteAlarmDataChanged();
      requestAlarmSync(change === 'permission-changed' ? 'permission' : 'data-changed', { force: change === 'permission-changed' });
    });
    const offAction = alarmAdapter.onAction((event) => {
      if (event.action === 'open') {
        if (event.path) router.push(event.path as Href);
        return;
      }
      recordAlarmAction(event);
    });
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      const nowTz = deviceTimeZone();
      if (nowTz !== phoneTz) {
        phoneTz = nowTz;
        requestAlarmSync('timezone', { force: true, delayMs: 500 });
        return;
      }
      void checkAlarmsOnForeground();
    });
    return () => {
      offDose();
      offData();
      offAction();
      sub.remove();
    };
  }, [userId]);
}

/** Live alarm engine state for screens (scheduled count, doses silenced by quiet hours, permission, errors). */
export function useAlarmSyncState(): AlarmSyncState {
  return useSyncExternalStore(subscribeAlarmSyncState, getAlarmSyncState, getAlarmSyncState);
}
