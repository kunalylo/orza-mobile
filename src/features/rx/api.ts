/**
 * Prescriptions — API calls + React Query hooks (`/api/prescriptions…`): scan (AI), manual entry, apply (creates the
 * medicines + alarms), history and delete. Applying updates the medicine caches and emits a "meds-changed" event.
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { medsKeys, putMedication, useMedications } from '@/features/meds/api';
import { emitDoseEvent } from '@/features/meds/events';
import type { MedicationClient } from '@/features/meds/types';
import { mealKeys } from '@/features/meals/api';
import type { AiStatus } from '@/features/meals/types';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

import type { ApplyInput, ApplyResponse, ManualPrescriptionInput, PrescriptionClient } from './types';

/* ───────────────────────────── Keys ───────────────────────────── */

export const rxKeys = {
  all: ['rx'] as const,
  list: () => ['rx', 'list'] as const,
  detail: (id: string) => ['rx', 'detail', id] as const,
  /** The medicines one apply created (kept for the success screen). */
  created: (id: string) => ['rx', 'created', id] as const,
};

/** AI vision can take a while on a handwritten page; the photo travels inline. */
const SCAN_TIMEOUT_MS = 90_000;
const UPLOAD_TIMEOUT_MS = 60_000;

/* ───────────────────────────── Plain calls ───────────────────────────── */

export const rxApi = {
  list: () => api.get<{ prescriptions: PrescriptionClient[] }>('/prescriptions').then((r) => r.prescriptions ?? []),
  get: (id: string) => api.get<{ prescription: PrescriptionClient }>(`/prescriptions/${encodeURIComponent(id)}`).then((r) => r.prescription),
  scan: (image: string) =>
    api.post<{ prescription: PrescriptionClient; credits?: number }>('/prescriptions/scan', { image }, { timeoutMs: SCAN_TIMEOUT_MS }),
  create: (body: ManualPrescriptionInput) =>
    api
      .post<{ prescription: PrescriptionClient }>('/prescriptions', body, { timeoutMs: body.image ? UPLOAD_TIMEOUT_MS : undefined })
      .then((r) => r.prescription),
  apply: (id: string, body: ApplyInput) => api.post<ApplyResponse>(`/prescriptions/${encodeURIComponent(id)}/apply`, body, { timeoutMs: 45_000 }),
  remove: (id: string) => api.del<{ ok: boolean }>(`/prescriptions/${encodeURIComponent(id)}`),
};

/* ───────────────────────────── Cache helpers ───────────────────────────── */

function putPrescription(qc: QueryClient, rx: PrescriptionClient) {
  qc.setQueryData<PrescriptionClient[]>(rxKeys.list(), (list) => {
    if (!list) return list;
    const exists = list.some((p) => p.id === rx.id);
    return exists ? list.map((p) => (p.id === rx.id ? rx : p)) : [rx, ...list];
  });
  qc.setQueryData(rxKeys.detail(rx.id), rx);
}

const notFound = (e: unknown) => e instanceof ApiError && e.status === 404;

/* ───────────────────────────── Queries ───────────────────────────── */

export function usePrescriptions() {
  return useQuery({ queryKey: rxKeys.list(), queryFn: rxApi.list });
}

export function usePrescription(id: string | undefined) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: rxKeys.detail(id ?? ''),
    queryFn: () => rxApi.get(id!),
    enabled: !!id,
    initialData: () => (id ? qc.getQueryData<PrescriptionClient[]>(rxKeys.list())?.find((p) => p.id === id) : undefined),
    initialDataUpdatedAt: () => qc.getQueryState(rxKeys.list())?.dataUpdatedAt,
    retry: (count, error) => !notFound(error) && count < 2,
  });
}

/**
 * The medicines created from a prescription: what the apply call returned (this session), otherwise the
 * medicine list filtered by the prescription's `applied_medication_ids` (still there after a restart).
 */
export function useCreatedMedications(rx: PrescriptionClient | undefined) {
  const qc = useQueryClient();
  const fromApply = rx ? qc.getQueryData<MedicationClient[]>(rxKeys.created(rx.id)) : undefined;
  const meds = useMedications();
  if (fromApply) {
    // Prefer fresher copies (e.g. a pill photo added since) when the list has them.
    const byId = new Map((meds.data ?? []).map((m) => [m.id, m]));
    return { medications: fromApply.map((m) => byId.get(m.id) ?? m), query: meds };
  }
  const ids = new Set(rx?.applied_medication_ids ?? []);
  const medications = (meds.data ?? []).filter((m) => ids.has(m.id) || (!!rx && m.prescription_id === rx.id));
  return { medications, query: meds };
}

/* ───────────────────────────── Mutations ───────────────────────────── */

/** AI read of one prescription photo. Keeps the credit balance in the header in sync. */
export function useScanPrescription() {
  const qc = useQueryClient();
  const { user, setUser } = useAuth();
  return useMutation({
    mutationFn: (image: string) => rxApi.scan(image),
    onSuccess: (res) => {
      putPrescription(qc, res.prescription);
      if (typeof res.credits === 'number') {
        if (user && user.credits !== res.credits) setUser({ ...user, credits: res.credits });
        qc.setQueryData<AiStatus | null>(mealKeys.aiStatus, (old) => (old ? { ...old, credits: res.credits as number } : old));
      }
    },
  });
}

/** Manual entry (AI off, or the member prefers typing). */
export function useCreatePrescription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ManualPrescriptionInput) => rxApi.create(body),
    onSuccess: (rx) => putPrescription(qc, rx),
  });
}

/** Create the medicines + alarms from the reviewed rows. */
export function useApplyPrescription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; body: ApplyInput }) => rxApi.apply(v.id, v.body),
    onSuccess: (res) => {
      putPrescription(qc, res.prescription);
      qc.setQueryData(rxKeys.created(res.prescription.id), res.medications);
      for (const med of res.medications) putMedication(qc, med);
      qc.invalidateQueries({ queryKey: medsKeys.list() }, { cancelRefetch: false });
      qc.invalidateQueries({ queryKey: medsKeys.todayAll() }, { cancelRefetch: false });
      qc.invalidateQueries({ queryKey: medsKeys.adherenceAll() }, { cancelRefetch: false });
      emitDoseEvent({ type: 'meds-changed' });
    },
    onError: (e) => {
      // Already applied elsewhere (another device, a double tap) — refresh what we show.
      if (e instanceof ApiError && e.code === 'already_applied') {
        qc.invalidateQueries({ queryKey: rxKeys.all });
        qc.invalidateQueries({ queryKey: medsKeys.all });
      }
    },
  });
}

export function useDeletePrescription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      rxApi.remove(id).then(
        () => id,
        (e) => {
          if (notFound(e)) return id; // already gone — same outcome
          throw e;
        }
      ),
    onSuccess: (id) => {
      qc.setQueryData<PrescriptionClient[]>(rxKeys.list(), (list) => list?.filter((p) => p.id !== id));
      qc.removeQueries({ queryKey: rxKeys.detail(id) });
    },
  });
}
