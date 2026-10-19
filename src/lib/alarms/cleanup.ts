/**
 * Sign-out (or session expiry): this account's alarms must not keep ringing, and its medicine names / photos must not
 * stay on the phone for the next account. Cancels every pending alarm, forgets the cached data, photos and queued
 * actions, and stops the background refresh. The server forgets the device itself on logout, so nothing is declared.
 * Called from `clearLocal` in lib/auth.tsx (dynamic import). Never throws; waits at most a few seconds.
 */
import { alarmAdapter } from './adapter';
import { unregisterAlarmBackgroundTask } from './background';
import { clearAlarmPhotos } from './photos';
import { clearDoseQueue } from './queue';
import { deleteAlarmCache, deleteJsonFile, TEST_ALARM_FILE } from './store';
import { resetAlarmEngine } from './sync';

function within<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(undefined), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(undefined);
      }
    );
  });
}

export async function clearAlarmsOnSignOut(): Promise<void> {
  resetAlarmEngine(); // runs in flight finish without scheduling anything
  await within(alarmAdapter.cancelAll(), 4_000);
  clearDoseQueue();
  deleteAlarmCache();
  deleteJsonFile(TEST_ALARM_FILE);
  clearAlarmPhotos();
  await within(unregisterAlarmBackgroundTask(), 3_000);
}
