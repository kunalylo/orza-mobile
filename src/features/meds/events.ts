/**
 * In-app "a dose changed" signal. Emit after any dose is taken / snoozed / skipped or a medicine is
 * added, edited or deleted, so other screens (Today's medicines card, the alarm screen, the local
 * alarm scheduler in Phase C) can refresh. Screens that use React Query should also invalidate
 * their queries; this is for code that lives outside a query (schedulers, timers).
 */

export type DoseEvent =
  | { type: "dose-updated"; medId?: string; at?: string }
  | { type: "meds-changed"; medId?: string };

type Listener = (event: DoseEvent) => void;

const listeners = new Set<Listener>();

export function emitDoseEvent(event: DoseEvent): void {
  for (const listener of [...listeners]) {
    try {
      listener(event);
    } catch {
      // one bad listener must not break the others
    }
  }
}

/** Subscribe; returns the unsubscribe function (use it as a useEffect cleanup). */
export function onDoseEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
