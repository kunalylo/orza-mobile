/**
 * Ask ÖRZA conversation state. Server data lives in React Query (sessions list + each conversation's history);
 * this hook only keeps what the server doesn't know yet: the in-flight / failed message of the current view,
 * per-reply notices and which replies arrived during this visit (to animate them).
 */
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TextInput } from 'react-native';

import { ApiError, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { haptics } from '@/lib/haptics';
import type { PublicUser } from '@/lib/types';
import { toast } from '@/ui';

import { aiErrorInfo, invalidateMealQueries } from './ai';
import { appendTurn, chatKeys, deleteSession, removeSessionFromCache, sendChat, upsertSession, useChatHistory, useChatSessions } from './api';
import { MAX_MESSAGE } from './Composer';
import { dayKey } from './format';
import type { QuickAction, StarterPrompt } from './prompts';
import type { ChatSession, SendResponse, UIMessage } from './types';

/** An in-flight send. `view` identifies the conversation view it was sent from. */
type Pending = { view: number; sessionId: string | null; tempId: string };

export type HistoryState = 'idle' | 'loading' | 'error';

export function useConversation({ initialSessionId, initialDraft }: { initialSessionId?: string; initialDraft?: string }) {
  const qc = useQueryClient();
  const { user, setUser } = useAuth();

  const [activeId, setActiveId] = useState<string | null>(initialSessionId ?? null);
  const [view, setView] = useState(0);
  const [local, setLocal] = useState<UIMessage[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [notices, setNotices] = useState<Record<string, string>>({});
  const [fresh, setFresh] = useState<Record<string, true>>({});
  const [input, setInput] = useState(() => (initialDraft ?? '').slice(0, MAX_MESSAGE));
  const [composerError, setComposerError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Refs mirror state for async callbacks.
  const activeRef = useRef<string | null>(initialSessionId ?? null);
  const viewRef = useRef(0);
  const pendingRef = useRef<Pending | null>(null);
  /** The first-load auto-open already ran (or isn't needed). */
  const startedRef = useRef(!!initialSessionId);
  /** The user has sent something in this visit — the auto-open must not replace it. */
  const sentRef = useRef(false);
  const userRef = useRef<PublicUser | null>(user);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const bumpView = useCallback(() => {
    viewRef.current += 1;
    setView(viewRef.current);
  }, []);

  const startNew = useCallback(() => {
    bumpView();
    activeRef.current = null;
    setActiveId(null);
    setLocal([]);
    setComposerError(null);
  }, [bumpView]);

  const openSession = useCallback(
    (id: string, force = false) => {
      if (!force && id === activeRef.current) return;
      bumpView();
      activeRef.current = id;
      setActiveId(id);
      setLocal([]);
      setComposerError(null);
      if (force) void qc.invalidateQueries({ queryKey: chatKeys.history(id), exact: true });
    },
    [bumpView, qc],
  );

  // A conversation deleted on another device: say so once and start fresh.
  const onGone = useCallback(
    (id: string) => {
      if (activeRef.current !== id) return;
      toast.error("That conversation isn't available any more.");
      removeSessionFromCache(qc, id);
      startNew();
    },
    [qc, startNew],
  );

  const sessionsQ = useChatSessions();
  const historyQ = useChatHistory(activeId, onGone);

  // First load: today's most recent conversation, unless the user already started something.
  useEffect(() => {
    if (startedRef.current) return;
    if (!sessionsQ.data && !sessionsQ.isError) return;
    startedRef.current = true;
    if (viewRef.current !== 0 || activeRef.current || pendingRef.current || sentRef.current) return;
    const latest = sessionsQ.data?.[0];
    if (latest && dayKey(latest.updated_at) === dayKey(new Date().toISOString())) openSession(latest.id);
  }, [sessionsQ.data, sessionsQ.isError, openSession]);

  /* ───────── derived messages ───────── */

  const historyData = activeId ? historyQ.data : undefined;
  const messages = useMemo<UIMessage[]>(() => {
    const meals = historyData?.logged_meals ?? {};
    const server: UIMessage[] = (historyData?.messages ?? []).map((m) => ({
      ...m,
      loggedMeal: m.meta?.logged_meal_id ? (meals[m.meta.logged_meal_id] ?? null) : null,
      notice: notices[m.id],
      fresh: !!fresh[m.id],
    }));
    const ids = new Set(server.map((m) => m.id));
    return [...server, ...local.filter((m) => !ids.has(m.id))];
  }, [historyData, local, notices, fresh]);

  let historyState: HistoryState = 'idle';
  if (activeId && !historyData) historyState = historyQ.isError ? 'error' : 'loading';

  const showTyping = !!pending && (pending.view === view || (!!pending.sessionId && pending.sessionId === activeId));
  const busy = !!pending;

  /* ───────── sending ───────── */

  function applyUserUpdates(res: SendResponse) {
    const u = userRef.current;
    if (!u) return;
    let next = u;
    if (res.memory) next = { ...next, memory: res.memory };
    if (res.allergies) next = { ...next, profile: { ...next.profile, allergies: res.allergies } };
    if (typeof res.credits === 'number' && res.credits !== next.credits) next = { ...next, credits: res.credits };
    if (next !== u) {
      userRef.current = next;
      setUser(next);
    }
  }

  async function send(raw: string) {
    const text = raw.trim();
    if (!text || pendingRef.current) return;
    if (text.length > MAX_MESSAGE) {
      setComposerError('Please keep messages under 2,000 characters.');
      haptics.error();
      return;
    }
    const p: Pending = { view: viewRef.current, sessionId: activeRef.current, tempId: `tmp-${Date.now()}` };
    pendingRef.current = p;
    sentRef.current = true;
    setPending(p);
    setInput('');
    setComposerError(null);
    setLocal((ls) => [
      ...ls,
      {
        id: p.tempId,
        session_id: p.sessionId ?? '',
        user_id: userRef.current?.id ?? '',
        role: 'user',
        content: text,
        created_at: new Date().toISOString(),
        status: 'sending',
        fresh: true,
      },
    ]);

    try {
      const res = await sendChat(p.sessionId ? { message: text, session_id: p.sessionId } : { message: text });
      applyUserUpdates(res);
      if (res.session) upsertSession(qc, res.session);
      else void qc.invalidateQueries({ queryKey: chatKeys.sessions });
      appendTurn(qc, res);
      if (res.notice) setNotices((n) => ({ ...n, [res.message.id]: res.notice as string }));
      setFresh((f) => ({ ...f, [res.message.id]: true }));
      if (res.logged_meal) {
        void invalidateMealQueries(qc);
        haptics.success();
      } else {
        haptics.soft();
      }

      const here = viewRef.current === p.view || activeRef.current === res.session_id;
      if (!here) return;
      setLocal((ls) => ls.filter((m) => m.id !== p.tempId));
      if (activeRef.current !== res.session_id) {
        activeRef.current = res.session_id;
        setActiveId(res.session_id);
      }
    } catch (e) {
      haptics.error();
      const info = aiErrorInfo(e);
      const sameView = viewRef.current === p.view;
      if (info.field === 'message') {
        // A validation problem: give the text back so it can be edited.
        if (sameView) {
          setLocal((ls) => ls.filter((m) => m.id !== p.tempId));
          setInput((cur) => (cur.trim() ? cur : text));
          setComposerError(info.message);
        }
        return;
      }
      if (sameView) {
        setLocal((ls) =>
          ls.map((m) => (m.id === p.tempId ? { ...m, status: 'failed', failure: { message: info.message, needsCredits: info.needsCredits } } : m)),
        );
      }
      if (e instanceof ApiError && e.status === 404 && p.sessionId) {
        toast.error('This conversation was deleted. Start a new chat to keep going.');
        removeSessionFromCache(qc, p.sessionId);
      } else {
        toast.error(info.message, info.needsCredits ? 6000 : undefined);
      }
    } finally {
      pendingRef.current = null;
      setPending(null);
    }
  }

  function retry(m: UIMessage) {
    if (pendingRef.current) return;
    setLocal((ls) => ls.filter((x) => x.id !== m.id));
    void send(m.content);
  }

  /** Drop text into the composer (without overwriting a draft) and focus it. */
  function prefill(text: string) {
    setInput((cur) => (cur.trim() ? cur : text));
    setComposerError(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function runQuickAction(a: QuickAction) {
    if (a.prompt) void send(a.prompt);
    else if (a.prefill) prefill(a.prefill);
  }

  /** Questions send straight away; meal statements only fill the composer, so an example never logs a meal. */
  function pickStarter(s: StarterPrompt) {
    if (s.send) void send(s.text);
    else prefill(s.text);
  }

  /* ───────── deleting ───────── */

  async function removeSession(s: ChatSession) {
    setDeletingId(s.id);
    try {
      await deleteSession(s.id);
      removeSessionFromCache(qc, s.id);
      if (activeRef.current === s.id) startNew();
      haptics.success();
      toast.success('Conversation deleted');
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        removeSessionFromCache(qc, s.id);
        if (activeRef.current === s.id) startNew();
      } else {
        haptics.error();
        toast.error(errorMessage(e));
      }
    } finally {
      setDeletingId(null);
    }
  }

  const activeSession = sessionsQ.data?.find((s) => s.id === activeId) ?? historyData?.session ?? null;

  return {
    user,
    activeId,
    activeSession,
    sessions: sessionsQ.data,
    sessionsLoading: sessionsQ.isPending,
    sessionsError: sessionsQ.isError ? errorMessage(sessionsQ.error) : null,
    refetchSessions: () => void sessionsQ.refetch(),
    messages,
    historyState,
    retryHistory: () => (activeId ? openSession(activeId, true) : undefined),
    showTyping,
    busy,
    input,
    setInput: (v: string) => {
      setInput(v);
      if (composerError) setComposerError(null);
    },
    composerError,
    inputRef,
    send,
    retry,
    startNew,
    openSession,
    pickStarter,
    runQuickAction,
    removeSession,
    deletingId,
  };
}
