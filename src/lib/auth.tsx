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
  /** Replace the user with a fresher copy an endpoint returned (e.g. onboarding completion). */
  setUser: (user: PublicUser) => void;
  /** Boot retry after `unreachable`. */
  retry: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Snapshot kept in the Keychain: everything routing + first paint needs, minus bulky / private parts. */
function snapshotOf(user: PublicUser): PublicUser {
  return { ...user, memory: [], integrations: undefined };
}

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
  const lastRefresh = useRef(0);

  const applyUser = useCallback((next: PublicUser) => {
    setUserState(next);
    void writeSecureJson(KEYS.user, snapshotOf(next));
  }, []);

  /** Forget the session on this phone (token, snapshot, cached data). */
  const clearLocal = useCallback(async () => {
    setSessionToken(null);
    resetDeviceRegistration();
    setUserState(null);
    setStatus('signedOut');
    queryClient.clear();
    await Promise.all([writeSecure(KEYS.token, null), writeSecure(KEYS.user, null)]);
  }, [queryClient]);

  const refresh = useCallback(async (): Promise<PublicUser | null> => {
    try {
      const { user: me } = await api.get<{ user: PublicUser }>('/auth/me');
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
        setUserState(snapshot);
        setStatus('signedIn');
        void refresh();
        void registerDevice();
        return;
      }
      try {
        const { user: me } = await api.get<{ user: PublicUser }>('/auth/me', { timeoutMs: 12_000 });
        if (cancelled) return;
        lastRefresh.current = Date.now();
        applyUser(me);
        setStatus('signedIn');
        void registerDevice();
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 401) return; // handler already signed out
        setStatus('unreachable');
      }
    })();
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
      setUser: applyUser,
      retry: () => {
        setStatus('loading');
        setBootKey((k) => k + 1);
      },
    }),
    [status, user, sessionExpired, signIn, signUp, signOut, refresh, applyUser]
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
