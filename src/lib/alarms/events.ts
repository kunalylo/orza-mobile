/**
 * "Something the alarms depend on changed" — for data outside the medicine dose events (`features/meds/events`):
 * reminders created / edited / switched, quiet hours, the "Gentle reminders" preference, notification permission.
 * The alarm sync (`useAlarmSync`) re-plans shortly after (debounced).
 */

export type AlarmDataChange = 'reminders-changed' | 'quiet-hours-changed' | 'preferences-changed' | 'permission-changed';

type Listener = (change: AlarmDataChange) => void;

const listeners = new Set<Listener>();

/** Call after a reminder, quiet-hours or reminder-preference change is saved (or permission changed). */
export function emitAlarmDataChanged(change: AlarmDataChange = 'reminders-changed'): void {
  for (const listener of [...listeners]) {
    try {
      listener(change);
    } catch {
      // one bad listener must not break the others
    }
  }
}

/** Subscribe; returns the unsubscribe function. */
export function onAlarmDataChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
