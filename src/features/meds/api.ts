/**
 * Medicines — API calls + React Query hooks (GET/POST/PATCH/DELETE /api/meds…, doses, today, adherence).
 * Every change updates the caches it can, invalidates the rest and emits a dose event for code outside React Query.
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { promptAlarmPermission } from '@/features/alarms/prompt';
import { alarmDoseSaved, alarmSnoozePressed } from '@/lib/alarms/bridge';
import { api, ApiError, errorMessage } from '@/lib/api';
import { useSignedInUser } from '@/lib/auth';
import { haptics } from '@/lib/haptics';
import { toast } from '@/ui';

import { emitDoseEvent, onDoseEvent, type DoseEvent } from './events';
import { clockIn, DEFAULT_TZ, doseKey, SNOOZE_MINUTES, sortMedications, todayIn, withAction } from './shared';
import type {
  AdherenceResponse,
  DoseAction,
  DoseItem,
  DoseLog,
  MedicationClient,
  MedicationCreateInput,
  MedicationPatchInput,
  TodayResponse,
} from './types';

/* ───────────────────────────── Keys ───────────────────────────── */

export const medsKeys = {
  all: ['meds'] as const,
  list: () => ['meds', 'list'] as const,
  detail: (id: string) => ['meds', 'detail', id] as const,
  today: (date: string) => ['meds', 'today', date] as const,
  todayAll: () => ['meds', 'today'] as const,
  adherence: (days: 7 | 30) => ['meds', 'adherence', days] as const,
  adherenceAll: () => ['meds', 'adherence'] as const,
};

/* ───────────────────────────── Plain calls ───────────────────────────── */

export const medsApi = {
  list: () => api.get<{ medications: MedicationClient[] }>('/meds').then((r) => r.medications ?? []),
  get: (id: string) => api.get<{ medication: MedicationClient }>(`/meds/${encodeURIComponent(id)}`).then((r) => r.medication),
  create: (body: MedicationCreateInput) =>
    // Up to four photos travel inline — give the upload more time than the default.
    api.post<{ medication: MedicationClient }>('/meds', body, { timeoutMs: 60_000 }).then((r) => r.medication),
  update: (id: string, body: MedicationPatchInput) =>
    api.patch<{ medication: MedicationClient }>(`/meds/${encodeURIComponent(id)}`, body).then((r) => r.medication),
  remove: (id: string) => api.del<{ ok: boolean }>(`/meds/${encodeURIComponent(id)}`),
  addPhoto: (id: string, image: string) =>
    api.post<{ medication: MedicationClient }>(`/meds/${encodeURIComponent(id)}/photos`, { image }, { timeoutMs: 45_000 }).then((r) => r.medication),
  removePhoto: (id: string, mediaId: string) =>
    api.del<{ medication: MedicationClient }>(`/meds/${encodeURIComponent(id)}/photos/${encodeURIComponent(mediaId)}`).then((r) => r.medication),
  today: (date: string) => api.get<TodayResponse>(`/meds/today?date=${encodeURIComponent(date)}`),
  adherence: (days: 7 | 30) => api.get<AdherenceResponse>(`/meds/adherence?days=${days}`),
  dose: (d: Pick<DoseItem, 'medication_id' | 'scheduled_for'>, action: DoseAction, snoozeMinutes = SNOOZE_MINUTES) =>
    api
      .post<{ dose: DoseLog }>('/meds/doses', {
        medication_id: d.medication_id,
        scheduled_for: d.scheduled_for,
        action,
        ...(action === 'snooze' ? { snooze_minutes: snoozeMinutes } : {}),
      })
      .then((r) => r.dose),
};

/* ───────────────────────────── Errors ───────────────────────────── */

/**
 * A dose action failed because the dose no longer exists on the server (medicine deleted, schedule changed or made
 * SOS — on another device, the web or by the scheduler): 404 "Medicine not found" / 400 "…isn't on this medicine's schedule".
 */
export const isStaleDoseError = (e: unknown) =>
  e instanceof ApiError && (e.status === 404 || (e.status === 400 && /schedule/i.test(e.message)));

/* ───────────────────────────── Time ───────────────────────────── */

export function useMedsTimezone(): string {
  const user = useSignedInUser();
  return user.profile?.timezone || DEFAULT_TZ;
}

/** Today's date in the user's timezone; rolls over at local midnight and when the app comes back. */
export function useLocalToday(tz: string): string {
  const [today, setToday] = useState(() => todayIn(tz));
  useEffect(() => {
    const check = () => setToday(todayIn(tz));
    check();
    const timer = setInterval(check, 60_000);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') check();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [tz]);
  return today;
}

/* ───────────────────────────── Queries ───────────────────────────── */

export function useMedications() {
  return useQuery({ queryKey: medsKeys.list(), queryFn: medsApi.list });
}

export function useMedication(id: string | undefined) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: medsKeys.detail(id ?? ''),
    queryFn: () => medsApi.get(id!),
    enabled: !!id,
    initialData: () => (id ? qc.getQueryData<MedicationClient[]>(medsKeys.list())?.find((m) => m.id === id) : undefined),
    initialDataUpdatedAt: () => qc.getQueryState(medsKeys.list())?.dataUpdatedAt,
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  });
}

/** Today's doses — refreshed every minute while the app is in front (due → missed, snoozes ending). */
export function useTodayDoses(date: string) {
  return useQuery({ queryKey: medsKeys.today(date), queryFn: () => medsApi.today(date), refetchInterval: 60_000 });
}

export function useAdherence(days: 7 | 30 = 7) {
  return useQuery({ queryKey: medsKeys.adherence(days), queryFn: () => medsApi.adherence(days) });
}

/* ───────────────────────────── Cache helpers ───────────────────────────── */

/** Events this module emitted itself — screens only refetch for changes made elsewhere (alarm, scheduler). */
const ownEvents = new WeakSet<DoseEvent>();

function emitOwn(event: DoseEvent) {
  ownEvents.add(event);
  emitDoseEvent(event);
}

/** Refresh medicine data when a dose or medicine changes outside this screen. */
export function useMedsEventRefresh() {
  const qc = useQueryClient();
  useEffect(
    () =>
      onDoseEvent((event) => {
        if (ownEvents.has(event)) return;
        qc.invalidateQueries({ queryKey: medsKeys.all }, { cancelRefetch: false });
      }),
    [qc]
  );
}

export function putMedication(qc: QueryClient, med: MedicationClient) {
  qc.setQueryData<MedicationClient[]>(medsKeys.list(), (list) => {
    if (!list) return list;
    const exists = list.some((m) => m.id === med.id);
    return sortMedications(exists ? list.map((m) => (m.id === med.id ? med : m)) : [...list, med]);
  });
  qc.setQueryData(medsKeys.detail(med.id), med);
}

function refreshDoses(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: medsKeys.todayAll() }, { cancelRefetch: false });
  qc.invalidateQueries({ queryKey: medsKeys.adherenceAll() }, { cancelRefetch: false });
}

/* ───────────────────────────── Mutations ───────────────────────────── */

/** Create (no id) or update a medicine. */
export function useSaveMedication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id?: string; create?: MedicationCreateInput; patch?: MedicationPatchInput }) =>
      v.id ? medsApi.update(v.id, v.patch ?? {}) : medsApi.create(v.create!),
    onSuccess: (med, v) => {
      // The member's first alarm medicine: make sure this phone may ring it (asks only when a permission is missing).
      if (!v.id && med.active !== false && !med.as_needed) {
        const before = qc.getQueryData<MedicationClient[]>(medsKeys.list());
        if (!before?.some((m) => m.id !== med.id && m.active !== false && !m.as_needed)) promptAlarmPermission('first-medicine');
      }
      putMedication(qc, med);
      refreshDoses(qc);
      emitOwn({ type: 'meds-changed', medId: med.id });
    },
  });
}

/** Pause / resume reminders. */
export function useSetMedicationActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; active: boolean }) => medsApi.update(v.id, { active: v.active }),
    onSuccess: (med) => {
      putMedication(qc, med);
      refreshDoses(qc);
      emitOwn({ type: 'meds-changed', medId: med.id });
    },
  });
}

export function useDeleteMedication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => medsApi.remove(id).then(() => id),
    onSuccess: (id) => {
      qc.setQueryData<MedicationClient[]>(medsKeys.list(), (list) => list?.filter((m) => m.id !== id));
      qc.removeQueries({ queryKey: medsKeys.detail(id) });
      refreshDoses(qc);
      emitOwn({ type: 'meds-changed', medId: id });
    },
  });
}

/** Photo add / remove / "show on alarm" for a saved medicine (applied immediately). */
export function useMedicationPhotos() {
  const qc = useQueryClient();
  const done = (med: MedicationClient) => {
    putMedication(qc, med);
    qc.invalidateQueries({ queryKey: medsKeys.todayAll() }, { cancelRefetch: false }); // doses carry photo_urls
    emitOwn({ type: 'meds-changed', medId: med.id });
  };
  const add = useMutation({ mutationFn: (v: { id: string; image: string }) => medsApi.addPhoto(v.id, v.image), onSuccess: done });
  const remove = useMutation({ mutationFn: (v: { id: string; mediaId: string }) => medsApi.removePhoto(v.id, v.mediaId), onSuccess: done });
  const makePrimary = useMutation({
    mutationFn: (v: { id: string; mediaId: string }) => medsApi.update(v.id, { primary_photo_id: v.mediaId }),
    onSuccess: done,
  });
  return { add, remove, makePrimary };
}

/**
 * Dose writes in flight per date, across every screen. Today's list refetches (cancelling any GET already running)
 * once the last write settles: a GET that started mid-write — the minute poll, another screen — may have read the
 * dose before the POST committed and would otherwise put a confirmed Take back to "due" until the next poll.
 */
const doseWrites = new Map<string, { inFlight: number; refetch: boolean }>();

/**
 * Take / Skip / Snooze with an optimistic update of today's list, haptics and toasts.
 * `pendingFor(dose)` tells which action is in flight for that dose.
 */
export function useDoseActions(date: string, tz: string) {
  const qc = useQueryClient();
  const [pending, setPending] = useState<Record<string, DoseAction>>({});
  const inflight = useRef(new Set<string>());

  const replaceDose = (key: string, next: DoseItem) =>
    qc.setQueryData<TodayResponse>(medsKeys.today(date), (old) =>
      old ? { ...old, doses: old.doses.map((x) => (doseKey(x) === key ? next : x)) } : old
    );

  const act = async (d: DoseItem, action: DoseAction): Promise<boolean> => {
    const key = doseKey(d);
    if (inflight.current.has(key)) return false;
    inflight.current.add(key);
    setPending((p) => ({ ...p, [key]: action }));
    const pressedAt = Date.now();
    // The phone's alarm rings again after the snooze even if the app is closed before the request (or the next alarm
    // sync) finishes.
    if (action === 'snooze') alarmSnoozePressed([{ medId: d.medication_id, scheduledFor: d.scheduled_for }], pressedAt + SNOOZE_MINUTES * 60_000);
    const writes = doseWrites.get(date) ?? { inFlight: 0, refetch: false };
    writes.inFlight += 1;
    doseWrites.set(date, writes);
    // The pressed Button already gave a tap; confirm with a success / soft tick once the server agrees.
    // Optimistic row in the same render as the pending state — waiting for cancelQueries first showed a spinner on the
    // old row for over a second on a slow phone before "Taken" appeared. A cancelled GET puts the cache back to how it
    // was when that GET started, so the row is applied again once the cancel has settled.
    const optimistic = withAction(d, action);
    replaceDose(key, optimistic);
    await qc.cancelQueries({ queryKey: medsKeys.today(date) });
    replaceDose(key, optimistic);
    try {
      const log = await medsApi.dose(d, action);
      // The alarm engine keeps the confirmed log (a failed refetch can't lose it) and drops older queued presses.
      alarmDoseSaved(log, pressedAt);
      const updated = withAction(d, action, log);
      replaceDose(key, updated);
      writes.refetch = true;
      if (action === 'take') toast.success(`${d.name} — marked as taken`); // success haptic comes with the toast
      else haptics.soft();
      if (action === 'skip') toast.info(`${d.name} — skipped`);
      else if (action === 'snooze') toast.info(`Snoozed — we'll remind you again at ${clockIn(tz, new Date(updated.snooze_until!))}`);
      emitOwn({ type: 'dose-updated', medId: d.medication_id, at: d.scheduled_for });
      qc.invalidateQueries({ queryKey: medsKeys.adherenceAll() }, { cancelRefetch: false });
      if (action === 'take') {
        // Stock goes down by one on "take".
        qc.invalidateQueries({ queryKey: medsKeys.list() }, { cancelRefetch: false });
        qc.invalidateQueries({ queryKey: medsKeys.detail(d.medication_id) }, { cancelRefetch: false });
      }
      return true;
    } catch (e) {
      replaceDose(key, d);
      if (isStaleDoseError(e)) {
        // Changed or removed elsewhere — drop the stale row now instead of failing every tap until the next poll.
        writes.refetch = true;
        qc.invalidateQueries({ queryKey: medsKeys.list() }, { cancelRefetch: false });
        qc.invalidateQueries({ queryKey: medsKeys.detail(d.medication_id) }, { cancelRefetch: false });
        emitOwn({ type: 'meds-changed', medId: d.medication_id });
        toast.info(`${d.name} was changed or removed — refreshing today's doses.`);
      } else {
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
      writes.inFlight -= 1;
      if (!writes.inFlight) {
        doseWrites.delete(date);
        if (writes.refetch) void qc.invalidateQueries({ queryKey: medsKeys.today(date) });
      }
    }
  };

  const pendingFor = (d: DoseItem): DoseAction | undefined => pending[doseKey(d)];
  return { act, pendingFor };
}
