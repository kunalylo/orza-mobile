/**
 * Which alarm screens are open right now. Two can stack when a second alarm rings while the first is still showing.
 * - The engine's `open` handler (`useAlarmSync`) skips an alarm whose screen is already open, so an alarm that rings
 *   again (a snooze, a second tap) doesn't stack a copy of itself.
 * - Android: the app stops showing over the lock screen only when the LAST alarm screen closes.
 */

interface OpenAlarm {
  id: number;
  /** Normalised ISO instant of the alarm (`at` param), or null for "everything due now". */
  at: string | null;
  /** The test alarm's id (`test` param), or null. */
  test: string | null;
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

/** The alarm screen mounted: returns its `close()`, which says whether it was the last alarm screen open. */
export function alarmScreenOpened(at: string | null | undefined, test: string | null | undefined): () => boolean {
  const entry: OpenAlarm = { id: ++seq, at: normalise(at), test: test || null };
  open.push(entry);
  return () => {
    const i = open.findIndex((o) => o.id === entry.id);
    if (i >= 0) open.splice(i, 1);
    return open.length === 0;
  };
}

/** An alarm screen for this path (`/alarm?at=…` / `/alarm?test=…`) is already showing. */
export function isAlarmOnScreen(path: string): boolean {
  if (!/^\/alarm(\?|$)/.test(path) || !open.length) return false;
  const test = pathParam(path, 'test');
  if (test) return open.some((o) => o.test === test);
  const at = normalise(pathParam(path, 'at'));
  return at !== null && open.some((o) => o.at === at);
}

export const anyAlarmOnScreen = (): boolean => open.length > 0;
