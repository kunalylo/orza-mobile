/**
 * Notification permission on this phone (expo-notifications). Reminders are delivered by ÖRZA's server today;
 * scheduling alarms on the phone itself is Phase C — this only checks / asks for permission.
 * Android 13+ shows the permission prompt only once a notification channel exists, so one is created first.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';

export type NotificationPermission = 'granted' | 'undetermined' | 'denied' | 'blocked' | 'unsupported';

/** Android channel for reminder notifications (Phase C's local alarms can reuse or add their own). */
export const REMINDERS_CHANNEL_ID = 'reminders';

const PERMISSION_KEY = ['notifications', 'permission'] as const;

function toState(p: Notifications.NotificationPermissionsStatus): NotificationPermission {
  if (p.granted) return 'granted';
  const iosStatus = p.ios?.status;
  if (iosStatus === Notifications.IosAuthorizationStatus.PROVISIONAL || iosStatus === Notifications.IosAuthorizationStatus.EPHEMERAL) return 'granted';
  if (p.status === 'undetermined') return 'undetermined';
  return p.canAskAgain ? 'denied' : 'blocked';
}

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync(REMINDERS_CHANNEL_ID, {
      name: 'Reminders',
      description: 'Meal, water and weigh-in reminders from ÖRZA',
      importance: Notifications.AndroidImportance.HIGH,
      lightColor: '#FF7A6A',
      vibrationPattern: [0, 250, 150, 250],
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
