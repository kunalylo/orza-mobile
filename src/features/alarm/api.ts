/**
 * Alarm screen data + actions. Loads every dose at the alarm's instant (`GET /meds/doses?at=`) — or, with no / an
 * unknown instant, everything due now plus the next dose (`GET /meds/doses`). Take / Snooze / Skip go through
 * `POST /meds/doses`; each one emits a dose event and refreshes the medicine screens underneath.
 *
 * Offline (no answer, or none within a few seconds — an alarm can't wait for a slow network): the doses come from the
 * alarm engine's data on this phone (`./offline`) with the downloaded photos, and Take / Snooze / Skip are queued on the
 * phone (`recordAlarmAction`) and sent as soon as ÖRZA is reachable again. A press whose POST fails for lack of a
 * connection is queued the same way, so it is never lost.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { isStaleDoseError, medsApi, medsKeys } from '@/features/meds/api';
import { emitDoseEvent } from '@/features/meds/events';
import { clockIn, doseKey, SNOOZE_MINUTES, withAction } from '@/features/meds/shared';
import type { DoseAction, DoseItem, DueResponse } from '@/features/meds/types';
import { recordAlarmAction } from '@/lib/alarms/sync';
import { doseAlarmKey } from '@/lib/alarms/types';
import { api, ApiError, errorMessage } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { toast } from '@/ui';

import { offlineAlarm } from './offline';

export interface AlarmData {
  /** `at`: the doses of one alarm instant; `due`: everything due right now. */
  mode: 'at' | 'due';
  now: string;
  doses: DoseItem[];
  next: DoseItem | null;
  /** Built from the data on this phone (no connection): actions are queued here. */
  offline?: boolean;
  /** Offline: the member's timezone from that data. */
  tz?: string;
}

export const isValidInstant = (at: string | undefined | null): at is string => !!at && !Number.isNaN(new Date(at).getTime());

/** No response at all (offline, DNS, timeout) — as opposed to an answer from ÖRZA. */
export const isNoConnection = (e: unknown) => e instanceof ApiError && e.status === 0;

/** How long the alarm waits for ÖRZA before showing the doses saved on this phone. */
const ONLINE_WAIT_MS = 4_500;

async function loadAlarm(at: string | null, signal?: AbortSignal): Promise<AlarmData> {
  if (isValidInstant(at)) {
    const r = await api.get<DueResponse>(`/meds/doses?at=${encodeURIComponent(at)}`, { signal });
    if (r.doses?.length) return { mode: 'at', now: r.now, doses: r.doses, next: null };
  }
  const r = await api.get<DueResponse>('/meds/doses', { signal });
  return { mode: 'due', now: r.now, doses: r.doses ?? [], next: r.next ?? null };
}

function fromPhone(userId: string | null, at: string | null): AlarmData | null {
  if (!userId) return null;
  try {
    const off = offlineAlarm(userId, isValidInstant(at) ? at : null);
    if (!off || (!off.doses.length && off.mode === 'at')) return null;
    return { mode: off.mode, now: off.now, doses: off.doses, next: null, offline: true, tz: off.tz };
  } catch {
    return null;
  }
}

/** The server's answer; the phone's data when there's no connection or no answer within `ONLINE_WAIT_MS`. */
async function loadWithFallback(userId: string | null, at: string | null, signal?: AbortSignal): Promise<AlarmData> {
  const online = loadAlarm(at, signal);
  // A late failure after the phone's data won must not surface as an unhandled rejection.
  online.catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const slow = new Promise<'slow'>((resolve) => {
    timer = setTimeout(() => resolve('slow'), ONLINE_WAIT_MS);
  });
  try {
    const first = await Promise.race([online, slow]);
    if (first !== 'slow') return first;
    return fromPhone(userId, at) ?? (await online);
  } catch (e) {
    const local = isNoConnection(e) ? fromPhone(userId, at) : null;
    if (local) return local;
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Kept outside `medsKeys` on purpose: the medicine screens invalidate those on every dose event, and the alarm must
 * keep showing what it opened with (handled doses collapse instead of disappearing).
 */
export function useAlarmDoses(at: string | null, userId: string | null) {
  return useQuery({
    queryKey: ['alarm', isValidInstant(at) ? at : 'due'] as const,
    queryFn: ({ signal }) => loadWithFallback(userId, at, signal),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 2,
  });
}

export type HandledDose = DoseItem & { gone?: boolean };

/** Queue a press on this phone (sent when ÖRZA is reachable). False when there's no member to queue it for. */
function queueOnPhone(d: DoseItem, action: DoseAction): boolean {
  return recordAlarmAction({
    key: doseAlarmKey(d.scheduled_for),
    action,
    doses: [{ medId: d.medication_id, scheduledFor: d.scheduled_for }],
    ...(action === 'snooze' ? { snoozeMinutes: SNOOZE_MINUTES } : {}),
    at: Date.now(),
  });
}

/**
 * Take / Snooze / Skip from the alarm. `handled` holds each dose's state after this session's action (the alarm
 * collapses it), `pendingFor` says which action is in flight. `offline`: queue every press on the phone.
 */
export function useAlarmActions(tz: string, offline = false) {
  const qc = useQueryClient();
  const [handled, setHandled] = useState<Record<string, HandledDose>>({});
  const [pending, setPending] = useState<Record<string, DoseAction>>({});
  const inflight = useRef(new Set<string>());

  const refreshScreens = (d: DoseItem, action: DoseAction) => {
    // Cancels a today GET already running — it may have read the dose before this POST committed.
    qc.invalidateQueries({ queryKey: medsKeys.todayAll() });
    qc.invalidateQueries({ queryKey: medsKeys.adherenceAll() }, { cancelRefetch: false });
    if (action === 'take') {
      // Stock goes down by one on "take".
      qc.invalidateQueries({ queryKey: medsKeys.list() }, { cancelRefetch: false });
      qc.invalidateQueries({ queryKey: medsKeys.detail(d.medication_id) }, { cancelRefetch: false });
    }
  };

  /** Saved on the phone instead of sent: the alarm collapses the dose as if it went through. */
  const queued = (d: DoseItem, action: DoseAction, quiet?: boolean): boolean => {
    if (!queueOnPhone(d, action)) {
      if (!quiet) {
        haptics.error();
        toast.error("Couldn't reach ÖRZA. Please try again.");
      }
      return false;
    }
    const updated = withAction(d, action);
    setHandled((h) => ({ ...h, [doseKey(d)]: updated }));
    if (!quiet) {
      if (action === 'take') toast.success(`${d.name} — marked as taken. It syncs when you're back online.`);
      else {
        haptics.soft();
        toast.info(
          action === 'snooze'
            ? `Snoozed — this phone rings again at ${clockIn(tz, new Date(updated.snooze_until!))}`
            : `${d.name} — skipped. It syncs when you're back online.`
        );
      }
    }
    return true;
  };

  /** Returns true when the dose is settled (acted on, queued on the phone, or found to be gone). */
  const act = async (d: DoseItem, action: DoseAction, opts: { quiet?: boolean } = {}): Promise<boolean> => {
    const key = doseKey(d);
    if (inflight.current.has(key)) return false;
    if (offline) return queued(d, action, opts.quiet);
    inflight.current.add(key);
    setPending((p) => ({ ...p, [key]: action }));
    try {
      const log = await medsApi.dose(d, action);
      const updated = withAction(d, action, log);
      setHandled((h) => ({ ...h, [key]: updated }));
      refreshScreens(d, action);
      emitDoseEvent({ type: 'dose-updated', medId: d.medication_id, at: d.scheduled_for });
      if (!opts.quiet) {
        if (action === 'take') toast.success(`${d.name} — marked as taken`);
        else if (action === 'snooze') {
          haptics.soft();
          toast.info(`Snoozed — we'll remind you again at ${clockIn(tz, new Date(updated.snooze_until!))}`);
        } else {
          haptics.soft();
          toast.info(`${d.name} — skipped`);
        }
      }
      return true;
    } catch (e) {
      // No connection: keep the press on the phone (sent later) rather than lose it.
      if (isNoConnection(e)) return queued(d, action, opts.quiet);
      if (isStaleDoseError(e)) {
        setHandled((h) => ({ ...h, [key]: { ...d, gone: true } }));
        emitDoseEvent({ type: 'meds-changed', medId: d.medication_id });
        if (!opts.quiet) toast.info(`${d.name} was changed or removed — nothing to do for this dose.`);
        return true;
      }
      if (!opts.quiet) {
        haptics.error();
        toast.error(errorMessage(e));
      }
      return false;
    } finally {
      inflight.current.delete(key);
      setPending((p) => {
        const next = { ...p };
        delete next[key];
        return next;
      });
    }
  };

  /** "Take all" — every open dose at once, one summary toast. */
  const takeAll = async (doses: DoseItem[]) => {
    const results = await Promise.all(doses.map((d) => act(d, 'take', { quiet: true })));
    const ok = results.filter(Boolean).length;
    if (ok === doses.length) toast.success(ok === 1 ? 'Marked as taken' : `All ${ok} marked as taken`);
    else {
      haptics.error();
      toast.error(ok ? `${ok} of ${doses.length} marked as taken — please try the rest again.` : "Couldn't reach ÖRZA. Please try again.");
    }
  };

  const pendingFor = (d: DoseItem): DoseAction | undefined => pending[doseKey(d)];
  const anyPending = Object.keys(pending).length > 0;
  return { act, takeAll, handled, pendingFor, anyPending };
}
