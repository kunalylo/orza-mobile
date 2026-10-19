/**
 * Session + user state for the app, and the React Query client.
 *
 * - The Bearer session token lives in SecureStore (`orza.session`); a small user snapshot (`orza.user`) lets the
 *   app open straight into the right place offline, then `/api/auth/me` refreshes it.
 * - `signIn` / `signUp` send `X-ORZA-Client: mobile` (+ URL-encoded `X-ORZA-Device`, `X-ORZA-Platform`) and get
 *   `{user, token}` (no cookies).
 * - Any authenticated 401 (expired / revoked session) signs out locally; the route guards in `app/_layout.tsx`
 *   then show the welcome screen, which forwards to sign-in with a notice.
 * - `signOut` → `POST /api/auth/logout` with the Bearer token, which revokes this app session and forgets the phone.
 *   Offline, the phone signs out anyway and keeps the token in `orza.session.unrevoked`; the next launch retries the
 *   logout, and the next sign-in sends it as the Bearer so the server replaces that session (web `startMobileSession`).
 * - After sign-in and on every return to the foreground the phone is registered (`POST /api/devices`).
 * - A deliberate sign-out (also after deleting the account) deletes the phone's ÖRZA calendar first (`clearPhoneCalendar`).
 * - A user copy that lands after sign-out, or that belongs to an earlier session (a `/auth/me` refresh or a mutation
 *   answer still in flight when the member signed out — and maybe into another account), is dropped: it never brings a
 *   user back on screen or writes their profile snapshot into the Keychain of a signed-out phone.
 */
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';

import { ApiError, api, deviceHeaderValue, getSessionToken, setSessionToken, setUnauthorizedHandler } from './api';
import { registerDevice, resetDeviceRegistration } from './device';
import { haptics } from './haptics';
import { KEYS, readSecure, readSecureJson, writeSecure, writeSecureJson } from './secure';
import type { AuthResponse, PublicUser } from './types';

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn' | 'unreachable';

export interface AuthContextValue {
  status: AuthStatus;
  user: PublicUser | null;
  /** True right after the server ended the session (401) — the sign-in screen explains it once. */
  sessionExpired: boolean;
  acknowledgeExpired: () => void;
  signIn: (email: string, password: string) => Promise<PublicUser>;
  signUp: (name: string, email: string, password: string) => Promise<PublicUser>;
  /**
   * Signs this phone out (always, even offline — the server session is then ended on the next launch or sign-in).
   * `everywhere: true` signs out every browser and phone; it needs the server, so it throws (and stays signed in)
   * when ÖRZA can't be reached.
   */
  signOut: (opts?: { everywhere?: boolean }) => Promise<void>;
  /** Re-read `/api/auth/me` (credits, targets, onboarding state…). */
  refresh: () => Promise<PublicUser | null>;
  /**
   * Replace the user with a fresher copy an endpoint returned (e.g. onboarding completion). Ignored once signed out, or
   * when the copy is of another account than the signed-in one (an answer to a request from an earlier session).
   */
  setUser: (user: PublicUser) => void;
  /** Boot retry after `unreachable`. */
  retry: () => void;
  /** A `retry` is in flight: the offline screen stays up with a busy button (never a blank screen). */
  retrying: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Snapshot kept in the Keychain: everything routing + first paint needs, minus bulky / private parts. */
function snapshotOf(user: PublicUser): PublicUser {
  return { ...user, memory: [], integrations: undefined };
}

/** The offline screen's "Try again" shows its spinner at least this long (offline, the request fails at once). */
const RETRY_MIN_MS = 700;

/** True when a request never got a real answer from ÖRZA (offline, timeout, server down) — worth retrying later. */
function unreachable(e: unknown): boolean {
  return !(e instanceof ApiError) || e.isNetwork || e.status >= 500;
}

/** Ends, on the server, a session this phone signed out of while offline (see `KEYS.unrevoked`). Never throws. */
async function revokeUnrevoked(): Promise<void> {
  const token = await readSecure(KEYS.unrevoked);
  if (!token) return;
  try {
    // `auth: false` + an explicit Bearer: a 401 here must not sign out whoever is signed in now.
    await api.post('/auth/logout', {}, { auth: false, headers: { Authorization: `Bearer ${token}` }, timeoutMs: 6_000 });
  } catch (e) {
    if (unreachable(e)) return; // try again next launch
  }
  await writeSecure(KEYS.unrevoked, null);
}

/** Sign-in / sign-up headers: the phone's name, plus any unrevoked old session so the server replaces it. */
async function signInHeaders(): Promise<Record<string, string>> {
  const unrevoked = await readSecure(KEYS.unrevoked);
  return { 'X-ORZA-Device': deviceHeaderValue(), ...(unrevoked ? { Authorization: `Bearer ${unrevoked}` } : {}) };
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 10 * 60_000,
        retry: (count, error) => {
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
          return count < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}

// React Query refetches stale queries when the app comes back to the foreground.
focusManager.setEventListener((setFocused) => {
  if (Platform.OS === 'web') return undefined;
  const sub = AppState.addEventListener('change', (s: AppStateStatus) => setFocused(s === 'active'));
  return () => sub.remove();
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUserState] = useState<PublicUser | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [bootKey, setBootKey] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const lastRefresh = useRef(0);
  /** Id of the user in state, readable synchronously by late answers (`setUser`). */
  const userId = useRef<string | null>(null);

  /** Puts a user in place (state + Keychain snapshot). Callers make sure it belongs to the current session. */
  const applyUser = useCallback((next: PublicUser) => {
    userId.current = next.id;
    setUserState(next);
    void writeSecureJson(KEYS.user, snapshotOf(next));
  }, []);

  /** `setUser` for screens and mutations: only a copy of the signed-in account, while a session exists. */
  const setUser = useCallback(
    (next: PublicUser) => {
      if (!getSessionToken() || userId.current !== next.id) return;
      applyUser(next);
    },
    [applyUser]
  );

  /** Forget the session on this phone (token, snapshot, cached data). */
  const clearLocal = useCallback(async () => {
    setSessionToken(null);
    resetDeviceRegistration();
    userId.current = null;
    setUserState(null);
    setStatus('signedOut');
    queryClient.clear();
    await Promise.all([
      writeSecure(KEYS.token, null),
      writeSecure(KEYS.user, null),
      // This account's alarms: cancel them and forget their cached data and photos (loaded on demand; never throws).
      import('./alarms/cleanup').then((m) => m.clearAlarmsOnSignOut()).catch(() => undefined),
    ]);
  }, [queryClient]);

  const refresh = useCallback(async (): Promise<PublicUser | null> => {
    const token = getSessionToken();
    if (!token) return null;
    try {
      const { user: me } = await api.get<{ user: PublicUser }>('/auth/me');
      // Signed out (or into another account) while this was in flight: that answer belongs to the old session.
      if (getSessionToken() !== token) return null;
      lastRefresh.current = Date.now();
      applyUser(me);
      return me;
    } catch {
      return null; // 401 is handled by the unauthorized handler; offline keeps the snapshot
    }
  }, [applyUser]);

  // 401 from any authenticated call → signed out, with a one-time notice.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setSessionExpired(true);
      void clearLocal();
    });
    return () => setUnauthorizedHandler(null);
  }, [clearLocal]);

  // Boot: token + snapshot from the Keychain, then confirm with the server.
  useEffect(() => {
    let cancelled = false;
    const started = Date.now();
    (async () => {
      const [token, snapshot] = await Promise.all([readSecure(KEYS.token), readSecureJson<PublicUser>(KEYS.user)]);
      if (cancelled) return;
      void revokeUnrevoked();
      if (!token) {
        setStatus('signedOut');
        return;
      }
      setSessionToken(token);
      if (snapshot?.id) {
        userId.current = snapshot.id;
        setUserState(snapshot);
        setStatus('signedIn');
        void refresh();
        void registerDevice();
        return;
      }
      try {
        const { user: me } = await api.get<{ user: PublicUser }>('/auth/me', { timeoutMs: 12_000 });
        if (cancelled || getSessionToken() !== token) return;
        lastRefresh.current = Date.now();
        applyUser(me);
        setStatus('signedIn');
        void registerDevice();
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 401) return; // handler already signed out
        if (bootKey > 0) {
          // A retry that failed again. Offline it fails at once: keep the busy button up long enough to be seen, and
          // buzz — the unchanged screen alone says nothing.
          await new Promise((r) => setTimeout(r, Math.max(0, RETRY_MIN_MS - (Date.now() - started))));
          if (cancelled) return;
          haptics.error();
        }
        setStatus('unreachable');
      }
    })().finally(() => {
      if (!cancelled) setRetrying(false);
    });
    return () => {
      cancelled = true;
    };
  }, [bootKey, applyUser, refresh]);

  // Foreground: re-register the phone (throttled) and refresh the user if it's been a while.
  useEffect(() => {
    if (status !== 'signedIn') return;
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      void registerDevice();
      if (Date.now() - lastRefresh.current > 5 * 60_000) void refresh();
    });
    return () => sub.remove();
  }, [status, refresh]);

  const finishAuth = useCallback(
    async (res: AuthResponse) => {
      if (!res?.token || !res.user) throw new ApiError('Something went wrong signing you in. Please try again.', { status: 500, code: 'bad_response' });
      setSessionToken(res.token);
      // Any unrevoked old session went along as the Bearer, and the server has replaced it.
      await Promise.all([writeSecure(KEYS.token, res.token), writeSecure(KEYS.unrevoked, null)]);
      queryClient.clear();
      lastRefresh.current = Date.now();
      applyUser(res.user);
      setSessionExpired(false);
      setStatus('signedIn');
      haptics.success();
      void registerDevice({ force: true });
      return res.user;
    },
    [applyUser, queryClient]
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      const headers = await signInHeaders();
      const res = await api.post<AuthResponse>('/auth/login', { email: email.trim().toLowerCase(), password }, { auth: false, headers });
      return finishAuth(res);
    },
    [finishAuth]
  );

  const signUp = useCallback(
    async (name: string, email: string, password: string) => {
      const headers = await signInHeaders();
      const res = await api.post<AuthResponse>(
        '/auth/register',
        { name: name.trim(), email: email.trim().toLowerCase(), password },
        { auth: false, headers }
      );
      return finishAuth(res);
    },
    [finishAuth]
  );

  const signOut = useCallback(
    async (opts: { everywhere?: boolean } = {}) => {
      haptics.firm();
      const token = getSessionToken();
      try {
        // Revokes this app session and forgets the phone (`everywhere`: every browser and phone of the account).
        await api.post('/auth/logout', opts.everywhere ? { everywhere: true } : {}, { timeoutMs: 6_000 });
      } catch (e) {
        // "Everywhere" only happens on the server: stay signed in so the screen can say it didn't work.
        if (opts.everywhere) throw e;
        // Offline: sign out here anyway and end the server session on the next launch or sign-in.
        if (token && unreachable(e)) await writeSecure(KEYS.unrevoked, token);
      }
      // The phone's ÖRZA calendar holds this account's medicine names and rings for its doses: delete it (best effort,
      // never throws, waits <= 4 s). Loaded on demand so expo-calendar stays out of start-up and lib/ has no static
      // feature import. Deliberate sign-out only: on a 401 expiry the per-user link just stays with its account.
      await import('@/features/calendar/deviceCalendar').then((m) => m.clearPhoneCalendar()).catch(() => undefined);
      setSessionExpired(false);
      await clearLocal();
    },
    [clearLocal]
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      sessionExpired,
      acknowledgeExpired: () => setSessionExpired(false),
      signIn,
      signUp,
      signOut,
      refresh,
      setUser,
      // Keeps `unreachable` on screen (status is not reset to `loading`, which renders nothing) until the boot answers.
      retry: () => {
        setRetrying(true);
        setBootKey((k) => k + 1);
      },
      retrying,
    }),
    [status, user, sessionExpired, signIn, signUp, signOut, refresh, setUser, retrying]
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthContext value={value}>{children}</AuthContext>
    </QueryClientProvider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = use(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** The signed-in user (null while signed out / loading). */
export function useUser(): PublicUser | null {
  return useAuth().user;
}

/** For member screens behind the route guard, where a user always exists. */
export function useSignedInUser(): PublicUser {
  const user = useAuth().user;
  if (!user) throw new Error('useSignedInUser used outside a signed-in route');
  return user;
}

/** First name for greetings ("there" when unknown). */
export function firstName(user: Pick<PublicUser, 'name'> | null | undefined): string {
  return (user?.name || '').trim().split(/\s+/)[0] || 'there';
}
