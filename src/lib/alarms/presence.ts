/**
 * Which alarm screens are open right now. Two can stack when a second alarm rings while the first is still showing.
 * - The engine's `open` handler (`useAlarmSync`) skips an alarm whose screen is open AND in front (focused), so an
 *   alarm that rings again (a snooze, a second tap) doesn't stack a copy of itself. An alarm screen buried under
 *   another screen (the member went on to "Add a photo") doesn't count: the alarm opens again on top.
 * - Android: the app stops showing over the lock screen only when the LAST alarm screen closes.
 */

interface OpenAlarm {
  id: number;
  /** Normalised ISO instant of the alarm (`at` param), or null for "everything due now". */
  at: string | null;
  /** The test alarm's id (`test` param), or null. */
  test: string | null;
  /** The screen is the one in front. */
  focused: boolean;
}

export interface AlarmScreenPresence {
  /** The screen unmounted; true when it was the last alarm screen open. */
  close(): boolean;
  /** The screen came to the front / something was pushed over it. */
  setFocused(focused: boolean): void;
}

const open: OpenAlarm[] = [];
let seq = 0;

const normalise = (at: string | null | undefined): string | null => {
  if (!at) return null;
  const t = Date.parse(at);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

/** One query parameter of an in-app path (`/alarm?at=…&med=…`), decoded; null when absent. */
export function pathParam(path: string, name: string): string | null {
  const query = path.split('?')[1];
  if (!query) return null;
  for (const part of query.split('&')) {
    const eq = part.indexOf('=');
    const key = eq < 0 ? part : part.slice(0, eq);
    if (key !== name) continue;
    try {
      return decodeURIComponent((eq < 0 ? '' : part.slice(eq + 1)).replace(/\+/g, ' '));
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * The route an alarm opens (`/alarm?at=…&med=…`) with what the alarm screen needs to know about the alarm itself:
 * `ringing=1` when the ringing alarm raised it (not a tap — it then rings until the first press) and, for a medicine
 * alarm, `fired` = the time it rang for (epoch ms: its dose's time, or a snooze's end; `doses` `isMissedOnAlarm`). The
 * Android alarm's own notification links carry `fired` already (AlarmNotifier). Other routes are returned unchanged.
 */
export function alarmOpenPath(path: string, alarm: { ringing?: boolean; firedAt?: number | null }): string {
  if (!/^\/alarm(\?|$)/.test(path)) return path;
  const add: string[] = [];
  if (alarm.ringing && pathParam(path, 'ringing') === null) add.push('ringing=1');
  const fired = alarm.firedAt;
  const medicine = pathParam(path, 'test') === null;
  if (medicine && typeof fired === 'number' && Number.isSafeInteger(fired) && fired > 0 && pathParam(path, 'fired') === null) add.push(`fired=${fired}`);
  if (!add.length) return path;
  return `${path}${path.includes('?') ? '&' : '?'}${add.join('&')}`;
}

/** The alarm screen mounted (it is in front then). */
export function alarmScreenOpened(at: string | null | undefined, test: string | null | undefined): AlarmScreenPresence {
  const entry: OpenAlarm = { id: ++seq, at: normalise(at), test: test || null, focused: true };
  open.push(entry);
  return {
    close: () => {
      const i = open.findIndex((o) => o.id === entry.id);
      if (i >= 0) open.splice(i, 1);
      return open.length === 0;
    },
    setFocused: (focused: boolean) => {
      entry.focused = focused;
    },
  };
}

/** An alarm screen for this path (`/alarm?at=…` / `/alarm?test=…`) is showing, in front. */
export function isAlarmOnScreen(path: string): boolean {
  if (!/^\/alarm(\?|$)/.test(path) || !open.length) return false;
  const shown = open.filter((o) => o.focused);
  const test = pathParam(path, 'test');
  if (test) return shown.some((o) => o.test === test);
  const at = normalise(pathParam(path, 'at'));
  return at !== null && shown.some((o) => o.at === at);
}

export const anyAlarmOnScreen = (): boolean => open.length > 0;
