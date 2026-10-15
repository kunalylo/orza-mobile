/**
 * Reminders — API calls + React Query hooks (GET/POST/PATCH/DELETE /api/reminders, GET /api/integrations,
 * PUT /api/integrations/quiet-hours, PUT /api/integrations/whatsapp, POST …/whatsapp/test, PUT /api/settings/preferences).
 * Every reminder change also refreshes the calendar (it shows reminders) and marks the phone calendar for a re-sync.
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { markPhoneCalendarStale } from '@/features/calendar/deviceCalendar';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { PublicUser } from '@/lib/types';

import { DEFAULT_CHANNELS, sortReminders, type ReminderPreset } from './shared';
import type { IntegrationsView, QuietHours, ReminderInput, ReminderView, WhatsAppTestResponse } from './types';

/* ───────────────────────────── Keys ───────────────────────────── */

export const remindersKeys = {
  all: ['reminders'] as const,
  list: () => ['reminders', 'list'] as const,
  integrations: () => ['integrations'] as const,
};

/* ───────────────────────────── Plain calls ───────────────────────────── */

const idPath = (id: string) => `/reminders/${encodeURIComponent(id)}`;

export const remindersApi = {
  list: () => api.get<{ reminders: ReminderView[] }>('/reminders').then((r) => sortReminders(r.reminders ?? [])),
  create: (body: Omit<ReminderInput, 'body'> & { body?: string }) => api.post<{ reminder: ReminderView }>('/reminders', body).then((r) => r.reminder),
  update: (id: string, body: Partial<ReminderInput>) => api.patch<{ reminder: ReminderView }>(idPath(id), body).then((r) => r.reminder),
  remove: (id: string) => api.del<{ ok: boolean }>(idPath(id)),
  integrations: () => api.get<IntegrationsView>('/integrations'),
  quietHours: (next: QuietHours | null) => api.put<IntegrationsView>('/integrations/quiet-hours', next ?? { start: null, end: null }),
  whatsapp: (phone: string | null, optIn: boolean) => api.put<IntegrationsView>('/integrations/whatsapp', { phone, opt_in: optIn }),
  whatsappTest: () => api.post<WhatsAppTestResponse>('/integrations/whatsapp/test'),
  resume: () => api.put<{ user: PublicUser }>('/settings/preferences', { reminders: true }),
};

/* ───────────────────────────── Queries ───────────────────────────── */

export function useReminders() {
  return useQuery({ queryKey: remindersKeys.list(), queryFn: remindersApi.list });
}

export function useIntegrations() {
  return useQuery({ queryKey: remindersKeys.integrations(), queryFn: remindersApi.integrations, staleTime: 30_000 });
}

/* ───────────────────────────── Cache helpers ───────────────────────────── */

function putReminder(qc: QueryClient, r: ReminderView) {
  qc.setQueryData<ReminderView[]>(remindersKeys.list(), (list) => {
    if (!list) return [r];
    const rest = list.filter((x) => x.id !== r.id);
    return sortReminders([...rest, r]);
  });
}

function afterChange(qc: QueryClient) {
  // The calendar shows reminders; the phone calendar copies the ones with Calendar switched on.
  void qc.invalidateQueries({ queryKey: ['calendar'] });
  markPhoneCalendarStale();
}

/* ───────────────────────────── Mutations ───────────────────────────── */

/** Create (no id) or update a reminder from the sheet. */
export function useSaveReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: ReminderInput }) =>
      id ? remindersApi.update(id, input) : remindersApi.create({ ...input, body: input.body || undefined }),
    onSuccess: (r) => {
      putReminder(qc, r);
      afterChange(qc);
    },
  });
}

/** Switch a reminder on / off with an optimistic update (rolled back on failure). */
export function useToggleReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ reminder, active }: { reminder: ReminderView; active: boolean }) => remindersApi.update(reminder.id, { active }),
    onMutate: async ({ reminder, active }) => {
      await qc.cancelQueries({ queryKey: remindersKeys.list() });
      putReminder(qc, { ...reminder, active });
      return { previous: reminder };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) putReminder(qc, ctx.previous);
    },
    onSuccess: (r) => {
      putReminder(qc, r);
      afterChange(qc);
    },
  });
}

export function useDeleteReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => remindersApi.remove(id).then(() => id),
    onSuccess: (id) => {
      qc.setQueryData<ReminderView[]>(remindersKeys.list(), (list) => list?.filter((x) => x.id !== id));
      afterChange(qc);
    },
    onError: (e) => {
      // Already gone on the server — drop it here too.
      if (e instanceof ApiError && e.status === 404) void qc.invalidateQueries({ queryKey: remindersKeys.list() });
    },
  });
}

/** One-tap preset. WhatsApp is pre-ticked (except for water) when the user has WhatsApp ready, like the website. */
export function useAddPreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ preset, whatsappReady }: { preset: ReminderPreset; whatsappReady: boolean }) =>
      remindersApi.create({
        kind: preset.kind,
        title: preset.title,
        ...(preset.body ? { body: preset.body } : {}),
        schedule: { times: preset.times, days: preset.days },
        channels: { ...DEFAULT_CHANNELS, whatsapp: whatsappReady && preset.kind !== 'water' },
        active: true,
      }),
    onSuccess: (r) => {
      putReminder(qc, r);
      afterChange(qc);
    },
  });
}

export function useQuietHours() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (next: QuietHours | null) => remindersApi.quietHours(next),
    onSuccess: (view) => qc.setQueryData(remindersKeys.integrations(), view),
  });
}

export function useSaveWhatsApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ phone, optIn }: { phone: string | null; optIn: boolean }) => remindersApi.whatsapp(phone, optIn),
    onSuccess: (view) => qc.setQueryData(remindersKeys.integrations(), view),
  });
}

export function useWhatsAppTest() {
  return useMutation({ mutationFn: remindersApi.whatsappTest });
}

/** Turn "Gentle reminders" back on (Settings preference) — keeps the signed-in user in sync. */
export function useResumeReminders() {
  const qc = useQueryClient();
  const { setUser } = useAuth();
  return useMutation({
    mutationFn: remindersApi.resume,
    onSuccess: (res) => {
      if (res.user) setUser(res.user);
      qc.setQueryData<IntegrationsView>(remindersKeys.integrations(), (v) => (v ? { ...v, reminders_enabled: true } : v));
    },
  });
}
