/**
 * Android safety net for the lock screen. The app shows over the lock screen only when an alarm's full-screen intent
 * opened it, and the alarm screen gives that up when it closes. If, a few seconds after the app starts or comes to the
 * front, it is shown over the lock screen with NO alarm screen open (the alarm's link got lost, the member has to sign
 * in again, …), it is released at once — the rest of the app must never stay reachable without unlocking.
 * No-op on iOS / web (the native module is missing there).
 */
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

import { getStatus, releaseLockScreen } from '../../../modules/orza-alarms';

import { anyAlarmOnScreen } from './presence';

/** Time for a cold start to route to the alarm screen. */
const GRACE_MS = 8_000;

export function useLockScreenGuard(enabled: boolean): void {
  useEffect(() => {
    if (Platform.OS !== 'android' || !enabled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const check = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (anyAlarmOnScreen()) return;
        void getStatus()
          .then((s) => {
            if (s?.overLockScreen && !anyAlarmOnScreen()) return releaseLockScreen();
            return false;
          })
          .catch(() => false);
      }, GRACE_MS);
    };
    check();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') check();
    });
    return () => {
      if (timer) clearTimeout(timer);
      sub.remove();
    };
  }, [enabled]);
}
