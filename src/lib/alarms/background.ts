/**
 * Background refresh of the phone's alarms (expo-background-task, Android WorkManager / iOS BGTaskScheduler): every
 * hour or so — when the OS allows, with network — send queued alarm actions and re-plan the next 7 days, so alarms keep
 * coming even when the app isn't opened for days, and declare the phone active to the server.
 *
 * `TaskManager.defineTask` must run in the bundle's GLOBAL scope (v57 docs): when the OS launches the app just for the
 * task, no views are mounted, so Expo Router's route files (and anything only they import) never load. This module
 * therefore has to be imported by the app's entry file before `expo-router/entry` (see docs/notes/C1-engine.md); the
 * member layout imports it too (through `useAlarmSync`), which covers runs while the app is open.
 * The heavy sync code is loaded inside the task, so the entry stays light.
 */
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

export const ALARM_SYNC_TASK = 'orza-alarm-sync';
/** Minutes; the OS treats it as a minimum and often waits longer (iOS especially). */
const MIN_INTERVAL_MINUTES = 60;

const supported = Platform.OS === 'android' || Platform.OS === 'ios';

if (supported && !TaskManager.isTaskDefined(ALARM_SYNC_TASK)) {
  TaskManager.defineTask(ALARM_SYNC_TASK, async () => {
    try {
      const { syncAlarms } = await import('./sync');
      const r = await syncAlarms({ reason: 'background' });
      return r.ok || r.skipped === 'signed-out' ? BackgroundTask.BackgroundTaskResult.Success : BackgroundTask.BackgroundTaskResult.Failed;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

/** Register the periodic task (once; the OS keeps it across launches). Never throws; false when unavailable. */
export async function registerAlarmBackgroundTask(): Promise<boolean> {
  if (!supported) return false;
  try {
    if ((await BackgroundTask.getStatusAsync()) !== BackgroundTask.BackgroundTaskStatus.Available) return false;
    if (!(await TaskManager.isTaskRegisteredAsync(ALARM_SYNC_TASK))) {
      await BackgroundTask.registerTaskAsync(ALARM_SYNC_TASK, { minimumInterval: MIN_INTERVAL_MINUTES });
    }
    return true;
  } catch {
    return false;
  }
}

/** Stop the periodic task (sign-out). Never throws. */
export async function unregisterAlarmBackgroundTask(): Promise<void> {
  if (!supported) return;
  try {
    if (await TaskManager.isTaskRegisteredAsync(ALARM_SYNC_TASK)) await BackgroundTask.unregisterTaskAsync(ALARM_SYNC_TASK);
  } catch {
    // not registered / unavailable
  }
}
