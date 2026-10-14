/** Ask ÖRZA API calls + React Query hooks. */
import { useQuery, type QueryClient } from '@tanstack/react-query';

import { ApiError, api } from '@/lib/api';

import { AI_TIMEOUT_MS } from './ai';
import type { ChatSession, HistoryResponse, SendRequest, SendResponse, SessionsResponse } from './types';

export const chatKeys = {
  all: ['chat'] as const,
  sessions: ['chat', 'sessions'] as const,
  history: (id: string) => ['chat', 'history', id] as const,
};

export function fetchSessions() {
  return api.get<SessionsResponse>('/chat/sessions');
}

export function fetchHistory(id: string, signal?: AbortSignal) {
  return api.get<HistoryResponse>(`/chat/history?session_id=${encodeURIComponent(id)}`, { signal });
}

export function sendChat(body: SendRequest) {
  return api.post<SendResponse>('/chat/send', body, { timeoutMs: AI_TIMEOUT_MS });
}

export function deleteSession(id: string) {
  return api.del<{ ok: true }>(`/chat/sessions/${encodeURIComponent(id)}`);
}

export function useChatSessions() {
  return useQuery({ queryKey: chatKeys.sessions, queryFn: fetchSessions, select: (r) => r.sessions });
}

/** `onNotFound` runs when the conversation no longer exists (deleted on another device). */
export function useChatHistory(id: string | null, onNotFound?: (id: string) => void) {
  return useQuery({
    queryKey: chatKeys.history(id ?? '-'),
    queryFn: async ({ signal }) => {
      try {
        return await fetchHistory(id as string, signal);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404 && id && onNotFound) setTimeout(() => onNotFound(id), 0);
        throw e;
      }
    },
    enabled: !!id,
    // A conversation only changes when this phone (or another device) sends — don't refetch on every focus.
    staleTime: 60_000,
    retry: (count, e) => !(e instanceof ApiError && e.status === 404) && count < 2,
  });
}

/* ───────────────────────────── cache helpers ───────────────────────────── */

/** Put a session at the top of the cached list (new or just active). */
export function upsertSession(qc: QueryClient, session: ChatSession) {
  qc.setQueryData<SessionsResponse>(chatKeys.sessions, (old) => ({
    sessions: [session, ...(old?.sessions ?? []).filter((s) => s.id !== session.id)],
  }));
}

export function removeSessionFromCache(qc: QueryClient, id: string) {
  qc.setQueryData<SessionsResponse>(chatKeys.sessions, (old) => (old ? { sessions: old.sessions.filter((s) => s.id !== id) } : old));
  qc.removeQueries({ queryKey: chatKeys.history(id), exact: true });
}

/** Append a finished turn to the cached conversation so it is there when the chat is reopened. */
export function appendTurn(qc: QueryClient, res: SendResponse) {
  qc.setQueryData<HistoryResponse>(chatKeys.history(res.session_id), (old) => {
    const session = res.session ?? old?.session;
    if (!session) return old;
    const messages = old?.messages ?? [];
    const seen = new Set(messages.map((m) => m.id));
    const next = [...messages];
    if (!seen.has(res.user_message.id)) next.push(res.user_message);
    if (!seen.has(res.message.id)) next.push(res.message);
    const logged_meals = { ...(old?.logged_meals ?? {}) };
    if (res.logged_meal) logged_meals[res.logged_meal.id] = res.logged_meal;
    return { session, messages: next.slice(-200), logged_meals };
  });
}
