/**
 * Calendar — API calls + React Query hooks (GET /api/calendar, GET /api/calendar/events, POST/DELETE /api/calendar/token,
 * PUT/DELETE /api/calendar/external) and the phone-calendar sync (expo-calendar, see deviceCalendar.ts).
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { remindersApi } from '@/features/reminders/api';
import { api } from '@/lib/api';

import {
  getPhonePermission,
  linkedCalendar,
  PhoneCalendarError,
  phoneCalendarSupported,
  readLink,
  removePhoneCalendar,
  requestPhonePermission,
  syncPhoneCalendar,
  syncRange,
  type PhoneCalendarLink,
  type PhonePermission,
} from './deviceCalendar';
import type { CalendarEventsResponse, CalendarStatusResponse, CalendarTokenResponse, ExternalCalendarState, ExternalConnectResponse } from './types';

/* ───────────────────────────── Keys ───────────────────────────── */

export const calendarKeys = {
  all: ['calendar'] as const,
  status: () => ['calendar', 'status'] as const,
  eventsAll: () => ['calendar', 'events'] as const,
  events: (from: string, to: string) => ['calendar', 'events', from, to] as const,
  phone: () => ['calendar', 'phone'] as const,
};

/* ───────────────────────────── Plain calls ───────────────────────────── */

export const calendarApi = {
  status: () => api.get<CalendarStatusResponse>('/calendar'),
  events: (from: string, to: string) =>
    api.get<CalendarEventsResponse>(`/calendar/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { timeoutMs: 30_000 }),
  createToken: () => api.post<CalendarTokenResponse>('/calendar/token'),
  revokeToken: () => api.del<{ ok: boolean }>('/calendar/token'),
  connectExternal: (url: string) => api.put<ExternalConnectResponse>('/calendar/external', { url }, { timeoutMs: 30_000 }),
  disconnectExternal: () => api.del<{ ok: boolean }>('/calendar/external'),
};

/* ───────────────────────────── Queries ───────────────────────────── */

export function useCalendarEvents(from: string, to: string) {
  return useQuery({
    queryKey: calendarKeys.events(from, to),
    queryFn: () => calendarApi.events(from, to),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

export function useCalendarStatus() {
  return useQuery({ queryKey: calendarKeys.status(), queryFn: calendarApi.status, staleTime: 60_000 });
}

/* ───────────────────────────── Feed + external ───────────────────────────── */

function patchStatus(qc: ReturnType<typeof useQueryClient>, patch: Partial<CalendarStatusResponse>) {
  qc.setQueryData<CalendarStatusResponse>(calendarKeys.status(), (s) => (s ? { ...s, ...patch } : s));
}

/** Create (or rotate) the private feed link. */
export function useFeedToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: calendarApi.createToken,
    onSuccess: (res) => patchStatus(qc, { feed: { feed_url: res.feed_url, webcal_url: res.webcal_url }, is_local: res.is_local }),
  });
}

export function useRevokeFeed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: calendarApi.revokeToken,
    onSuccess: () => patchStatus(qc, { feed: null }),
  });
}

export function useConnectExternal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (url: string) => calendarApi.connectExternal(url),
    onSuccess: (res) => {
      patchStatus(qc, { external: res.external });
      void qc.invalidateQueries({ queryKey: calendarKeys.eventsAll() });
    },
  });
}

export function useDisconnectExternal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: calendarApi.disconnectExternal,
    onSuccess: () => {
      const off: ExternalCalendarState = { connected: false };
      patchStatus(qc, { external: off });
      void qc.invalidateQueries({ queryKey: calendarKeys.eventsAll() });
    },
  });
}

/* ───────────────────────────── Phone calendar ───────────────────────────── */

export interface PhoneCalendarState {
  supported: boolean;
  permission: PhonePermission;
  link: PhoneCalendarLink | null;
}

async function readPhoneState(): Promise<PhoneCalendarState> {
  if (!phoneCalendarSupported) return { supported: false, permission: 'blocked', link: null };
  const permission = await getPhonePermission();
  const link = permission === 'granted' ? ((await linkedCalendar())?.link ?? null) : await readLink();
  return { supported: true, permission, link };
}

export function usePhoneCalendarState() {
  return useQuery({ queryKey: calendarKeys.phone(), queryFn: readPhoneState, staleTime: 15_000, retry: false });
}

/** Ask for access when needed, fetch the next 14 days + reminders, then write them into the ÖRZA calendar. */
export function usePhoneCalendarSync(tz: string, today: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ask = true }: { ask?: boolean } = {}) => {
      let permission = await getPhonePermission();
      if (permission !== 'granted' && ask && permission !== 'blocked') permission = await requestPhonePermission();
      if (permission !== 'granted') {
        throw new PhoneCalendarError(
          'permission',
          permission === 'blocked'
            ? 'Calendar access is off for ÖRZA. Turn it on in Settings, then try again.'
            : 'ÖRZA needs access to your calendar to add your doses and reminders.'
        );
      }
      const { from, to } = syncRange(today);
      const [events, reminders] = await Promise.all([calendarApi.events(from, to), remindersApi.list()]);
      const calendarReminders = new Map(reminders.filter((r) => r.active && r.channels?.calendar).map((r) => [r.id, r.kind as string]));
      return syncPhoneCalendar({ events: events.events, calendarReminders, tz: events.tz || tz });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: calendarKeys.phone() }),
  });
}

export function useRemovePhoneCalendar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: removePhoneCalendar,
    onSettled: () => qc.invalidateQueries({ queryKey: calendarKeys.phone() }),
  });
}
