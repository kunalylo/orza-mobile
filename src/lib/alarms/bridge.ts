/**
 * How the medicine screens tell the alarm engine about dose presses without importing it — the engine imports the
 * medicine API, so a direct import from `features/meds/api` would be a require cycle. The engine (`./sync`) registers
 * its handlers when it loads (the app entry imports it through the background task); before that, calls do nothing.
 */
import type { SavedDoseLog } from './recent';

export interface AlarmDoseHandlers {
  /** Snooze pressed in the app: set the re-ring on this phone now, before the press reaches ÖRZA. */
  snoozed(doses: { medId: string; scheduledFor: string }[], until: number): void;
  /** ÖRZA confirmed a Take / Snooze / Skip done in the app, pressed at `pressedAt` (epoch ms). */
  saved(log: SavedDoseLog, pressedAt: number): void;
}

let handlers: AlarmDoseHandlers | null = null;

export function setAlarmDoseHandlers(next: AlarmDoseHandlers | null): void {
  handlers = next;
}

/** A dose was snoozed in the app (alarm screen, Today): it rings again on this phone at `until` (epoch ms). */
export function alarmSnoozePressed(doses: { medId: string; scheduledFor: string }[], until: number): void {
  try {
    handlers?.snoozed(doses, until);
  } catch {
    // the next alarm sync plans the re-ring anyway
  }
}

/** ÖRZA confirmed a dose action done in the app (`log` = the `POST /api/meds/doses` answer). */
export function alarmDoseSaved(log: SavedDoseLog, pressedAt: number): void {
  try {
    handlers?.saved(log, pressedAt);
  } catch {
    // the next alarm sync fetches it anyway
  }
}
