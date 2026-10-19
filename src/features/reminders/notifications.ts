/**
 * Notification permission on this phone (expo-notifications) — check / ask. The alarms and reminder notifications
 * themselves are scheduled on the phone by the alarm engine (`@/lib/alarms`); every permission request here tells it
 * to re-plan at once (the Android 13 dialog doesn't trigger an AppState change).
 * Android 13+ shows the permission prompt only once a notification channel exists: the alarm module
 * (`modules/orza-alarms`) creates its channels at start-up; builds without it get the same "Reminders" channel here.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';

import { emitAlarmDataChanged } from '@/lib/alarms/events';

import { isOrzaAlarmsAvailable } from '../../../modules/orza-alarms';

export type NotificationPermission = 'granted' | 'undetermined' | 'denied' | 'blocked' | 'unsupported';

/** Android channel for reminder notifications — the alarm module's own "Reminders" channel (one channel, not two). */
export const REMINDERS_CHANNEL_ID = 'orza_reminders';

const PERMISSION_KEY = ['notifications', 'permission'] as const;

function toState(p: Notifications.NotificationPermissionsStatus): NotificationPermission {
  if (p.granted) return 'granted';
  const iosStatus = p.ios?.status;
  if (iosStatus === Notifications.IosAuthorizationStatus.PROVISIONAL || iosStatus === Notifications.IosAuthorizationStatus.EPHEMERAL) return 'granted';
  if (p.status === 'undetermined') return 'undetermined';
  return p.canAskAgain ? 'denied' : 'blocked';
}

async function ensureAndroidChannel() {
  // The native alarm module made its channels at start-up (re-creating one never changes its importance or sound).
  if (Platform.OS !== 'android' || isOrzaAlarmsAvailable()) return;
  try {
    await Notifications.setNotificationChannelAsync(REMINDERS_CHANNEL_ID, {
      name: 'Reminders',
      description: 'Meal, water and weigh-in reminders and refill alerts from ÖRZA',
      importance: Notifications.AndroidImportance.DEFAULT,
      lightColor: '#FF7A6A',
    });
  } catch {
    // The prompt may not show without a channel; the status check still works.
  }
}

export async function readNotificationPermission(): Promise<NotificationPermission> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return 'unsupported';
  try {
    return toState(await Notifications.getPermissionsAsync());
  } catch {
    return 'unsupported';
  }
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return 'unsupported';
  await ensureAndroidChannel();
  try {
    return toState(await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } }));
  } catch {
    return 'unsupported';
  } finally {
    // Granted or not: the alarm engine schedules (or clears) this phone's alarms straight away.
    emitAlarmDataChanged('permission-changed');
  }
}

/** Live permission state — re-read whenever the app comes back to the front (e.g. from Settings). */
export function useNotificationPermission() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: PERMISSION_KEY, queryFn: readNotificationPermission, staleTime: 5_000, retry: false });
  const [asking, setAsking] = useState(false);
  const status = query.data ?? null;

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void qc.invalidateQueries({ queryKey: PERMISSION_KEY });
    });
    return () => sub.remove();
  }, [qc]);

  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: PERMISSION_KEY }), [qc]);

  const request = useCallback(async (): Promise<NotificationPermission> => {
    if (status === 'blocked') {
      void Linking.openSettings();
      return 'blocked';
    }
    setAsking(true);
    try {
      const next = await requestNotificationPermission();
      qc.setQueryData(PERMISSION_KEY, next);
      return next;
    } finally {
      setAsking(false);
    }
  }, [qc, status]);

  return { status, asking, request, refresh };
}
