/**
 * Calendar — API calls + React Query hooks (GET /api/calendar, GET /api/calendar/events, POST/DELETE /api/calendar/token,
 * PUT/DELETE /api/calendar/external) and the phone-calendar sync (expo-calendar, see deviceCalendar.ts).
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { remindersApi } from '@/features/reminders/api';
import { api } from '@/lib/api';
import { useSignedInUser } from '@/lib/auth';

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
  phoneState: (userId: string) => ['calendar', 'phone', userId] as const,
  /** Mutation key shared by every phone-calendar sync, so a screen can tell one is already running. */
  phoneSync: () => ['calendar', 'phone', 'sync'] as const,
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

/**
 * One external-calendar state for the whole screen (as the website keeps it): GET /api/calendar only reports
 * connected / provider / preview, while the calendar's name and a failed refresh come from /calendar/events — so the
 * screen reads the events copy first. After connecting or disconnecting, every cached events range gets the new state
 * right away (and loses its imported events on disconnect), so an older range's `connected` / `error` / `name` never
 * outlives the change while the refetch runs — or if it fails.
 */
function setExternalState(qc: ReturnType<typeof useQueryClient>, external: ExternalCalendarState) {
  patchStatus(qc, { external });
  qc.setQueriesData<CalendarEventsResponse>({ queryKey: calendarKeys.eventsAll() }, (d) =>
    d ? { ...d, external, events: external.connected ? d.events : d.events.filter((e) => e.kind !== 'external') } : d
  );
  void qc.invalidateQueries({ queryKey: calendarKeys.eventsAll() });
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
    onSuccess: (res) => setExternalState(qc, res.external),
  });
}

export function useDisconnectExternal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: calendarApi.disconnectExternal,
    onSuccess: () => setExternalState(qc, { connected: false }),
  });
}

/* ───────────────────────────── Phone calendar ───────────────────────────── */

export interface PhoneCalendarState {
  supported: boolean;
  permission: PhonePermission;
  link: PhoneCalendarLink | null;
}

/** This account's view of the phone calendar — a calendar another account on this phone added shows as not added. */
async function readPhoneState(userId: string): Promise<PhoneCalendarState> {
  if (!phoneCalendarSupported) return { supported: false, permission: 'blocked', link: null };
  const permission = await getPhonePermission();
  const link = permission === 'granted' ? ((await linkedCalendar(userId))?.link ?? null) : await readLink(userId);
  return { supported: true, permission, link };
}

export function usePhoneCalendarState() {
  const userId = useSignedInUser().id;
  return useQuery({ queryKey: calendarKeys.phoneState(userId), queryFn: () => readPhoneState(userId), staleTime: 15_000, retry: false });
}

/**
 * Ask for access when needed, fetch the next 14 days + reminders, then write them into the ÖRZA calendar.
 * `ask: false` is the quiet re-sync when Calendar opens: it never prompts and only refreshes a calendar this account
 * already added. Every sync shares `calendarKeys.phoneSync()`, and they run one at a time (deviceCalendar.ts).
 */
export function usePhoneCalendarSync(tz: string, today: string) {
  const qc = useQueryClient();
  const userId = useSignedInUser().id;
  return useMutation({
    mutationKey: calendarKeys.phoneSync(),
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
      return syncPhoneCalendar({
        userId,
        onlyIfLinked: !ask,
        load: async () => {
          const [events, reminders] = await Promise.all([calendarApi.events(from, to), remindersApi.list()]);
          const calendarReminders = new Map(reminders.filter((r) => r.active && r.channels?.calendar).map((r) => [r.id, r.kind as string]));
          return { events: events.events, calendarReminders, tz: events.tz || tz };
        },
      });
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
