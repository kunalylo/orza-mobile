/**
 * Alarm screen data + actions. Loads every dose at the alarm's instant (`GET /meds/doses?at=`) — or, with no / an
 * unknown instant, everything due now plus the next dose (`GET /meds/doses`). Take / Snooze / Skip go through
 * `POST /meds/doses`; each one emits a dose event and refreshes the medicine screens underneath.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { medsApi, medsKeys } from '@/features/meds/api';
import { emitDoseEvent } from '@/features/meds/events';
import { clockIn, doseKey, withAction } from '@/features/meds/shared';
import type { DoseAction, DoseItem, DueResponse } from '@/features/meds/types';
import { api, ApiError, errorMessage } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { toast } from '@/ui';

export interface AlarmData {
  /** `at`: the doses of one alarm instant; `due`: everything due right now. */
  mode: 'at' | 'due';
  now: string;
  doses: DoseItem[];
  next: DoseItem | null;
}

export const isValidInstant = (at: string | undefined | null): at is string => !!at && !Number.isNaN(new Date(at).getTime());

async function loadAlarm(at: string | null, signal?: AbortSignal): Promise<AlarmData> {
  if (isValidInstant(at)) {
    const r = await api.get<DueResponse>(`/meds/doses?at=${encodeURIComponent(at)}`, { signal });
    if (r.doses?.length) return { mode: 'at', now: r.now, doses: r.doses, next: null };
  }
  const r = await api.get<DueResponse>('/meds/doses', { signal });
  return { mode: 'due', now: r.now, doses: r.doses ?? [], next: r.next ?? null };
}

/**
 * Kept outside `medsKeys` on purpose: the medicine screens invalidate those on every dose event, and the alarm must
 * keep showing what it opened with (handled doses collapse instead of disappearing).
 */
export function useAlarmDoses(at: string | null) {
  return useQuery({
    queryKey: ['alarm', isValidInstant(at) ? at : 'due'] as const,
    queryFn: ({ signal }) => loadAlarm(at, signal),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 2,
  });
}

/** The dose no longer exists on the server (medicine deleted, schedule changed, made SOS). */
const isStale = (e: unknown) =>
  e instanceof ApiError && (e.status === 404 || (e.status === 400 && /schedule/i.test(e.message)));

export type HandledDose = DoseItem & { gone?: boolean };

/**
 * Take / Snooze / Skip from the alarm. `handled` holds each dose's state after this session's action (the alarm
 * collapses it), `pendingFor` says which action is in flight.
 */
export function useAlarmActions(tz: string) {
  const qc = useQueryClient();
  const [handled, setHandled] = useState<Record<string, HandledDose>>({});
  const [pending, setPending] = useState<Record<string, DoseAction>>({});
  const inflight = useRef(new Set<string>());

  const refreshScreens = (d: DoseItem, action: DoseAction) => {
    qc.invalidateQueries({ queryKey: medsKeys.todayAll() }, { cancelRefetch: false });
    qc.invalidateQueries({ queryKey: medsKeys.adherenceAll() }, { cancelRefetch: false });
    if (action === 'take') {
      // Stock goes down by one on "take".
      qc.invalidateQueries({ queryKey: medsKeys.list() }, { cancelRefetch: false });
      qc.invalidateQueries({ queryKey: medsKeys.detail(d.medication_id) }, { cancelRefetch: false });
    }
  };

  /** Returns true when the dose is settled (acted on, or found to be gone). */
  const act = async (d: DoseItem, action: DoseAction, opts: { quiet?: boolean } = {}): Promise<boolean> => {
    const key = doseKey(d);
    if (inflight.current.has(key)) return false;
    inflight.current.add(key);
    setPending((p) => ({ ...p, [key]: action }));
    try {
      const log = await medsApi.dose(d, action);
      const updated = withAction(d, action, log);
      setHandled((h) => ({ ...h, [key]: updated }));
      emitDoseEvent({ type: 'dose-updated', medId: d.medication_id, at: d.scheduled_for });
      refreshScreens(d, action);
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
      if (isStale(e)) {
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
