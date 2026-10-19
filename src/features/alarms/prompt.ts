/**
 * First-run alarm prompt — "let ÖRZA ring your medicine alarms on this phone". Asked for right after the member adds
 * their first alarm medicine or applies a prescription, only when notifications aren't allowed yet (or, on Android,
 * exact alarm times are off), at most once a day after "Not now". The sheet (`AlarmPermissionPrompt`, mounted in the
 * member layout) explains why, then shows the system prompt (or the phone's Settings when it can't be shown any more).
 * No React here: the medicine / prescription mutations call `promptAlarmPermission()`.
 */
import { alarmAdapter, type AdapterStatus } from '@/lib/alarms/adapter';
import { readJsonFile, writeJsonFile } from '@/lib/alarms/store';

export type AlarmPromptReason = 'first-medicine' | 'prescription';

export interface AlarmPromptState {
  visible: boolean;
  reason: AlarmPromptReason;
  status: AdapterStatus | null;
}

const FILE = 'orza-alarm-prompt.json';
const SNOOZE_MS = 24 * 3_600_000;
/** Let the medicine form / prescription screen close before the sheet slides up. */
const SHOW_DELAY_MS = 900;

let state: AlarmPromptState = { visible: false, reason: 'first-medicine', status: null };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

function set(next: Partial<AlarmPromptState>) {
  state = { ...state, ...next };
  for (const l of [...listeners]) l();
}

export const getAlarmPrompt = () => state;
export function subscribeAlarmPrompt(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Something the alarms need is missing: notifications, or (Android 12+) exact alarm times. */
export const alarmPermissionMissing = (s: AdapterStatus | null): boolean => !!s && (s.notifications !== 'granted' || s.exact === false);

/** Ask (after a short delay) when this phone can ring alarms but a permission is missing. Never throws. */
export function promptAlarmPermission(reason: AlarmPromptReason): void {
  if (alarmAdapter.maxScheduled <= 0 || state.visible) return;
  const last = readJsonFile<{ dismissedAt?: number }>(FILE)?.dismissedAt ?? 0;
  if (Date.now() - last < SNOOZE_MS) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void alarmAdapter
      .status()
      .then((status) => {
        if (alarmPermissionMissing(status)) set({ visible: true, reason, status });
      })
      .catch(() => undefined);
  }, SHOW_DELAY_MS);
}

/** Close the sheet; `notNow` = don't ask again for a day. */
export function closeAlarmPrompt(notNow: boolean): void {
  if (notNow) writeJsonFile(FILE, { dismissedAt: Date.now() });
  set({ visible: false });
}

/** The sheet's own permission reads (after the system prompt / Settings). */
export function updateAlarmPromptStatus(status: AdapterStatus | null): void {
  set({ status });
}
