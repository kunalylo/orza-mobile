/**
 * Settings API calls + React Query hooks. Every write answers with the fresh `{user}`, which goes straight into
 * `useAuth().setUser` so headers, Today and every other screen stay in sync.
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { ApiError, api, validationField } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Preferences, PublicUser, Targets } from '@/lib/types';

import type { ProfilePatch } from './profileDraft';

export interface UserResponse {
  user: PublicUser;
}

export interface ProfileResponse extends UserResponse {
  targets_recomputed: boolean;
}

export const accountKeys = {
  profile: ['account', 'profile'] as const,
};

/* ───────────────────────────── Errors ───────────────────────────── */

/**
 * An API error split for a settings form: a validation 400 (see `validationField`) gives its whole field path
 * (e.g. `profile.age`, `new_password`) and the message without the prefix; any other API error gives just its message.
 */
export function splitFieldError(e: unknown): { field?: string; message: string } | null {
  if (!(e instanceof ApiError)) return null;
  const v = validationField(e);
  return v ? { field: v.path, message: v.message } : { message: e.message };
}

/* ───────────────────────────── Sync ───────────────────────────── */

/**
 * Keeps the signed-in user fresh while Settings is open (the Keychain snapshot leaves out `memory`).
 * Screens read the user from `useSignedInUser()`; this query only reports loading / error / refreshing.
 */
export function useAccountSync() {
  const { setUser } = useAuth();
  return useQuery({
    queryKey: accountKeys.profile,
    queryFn: async ({ signal }) => {
      const res = await api.get<UserResponse>('/profile', { signal });
      setUser(res.user);
      return res.user.id;
    },
    staleTime: 15_000,
  });
}

/* ───────────────────────────── Writes ───────────────────────────── */

export function useSaveProfile() {
  const { setUser } = useAuth();
  return useMutation({
    mutationFn: (body: ProfilePatch | { profile: { timezone: string } }) => api.put<ProfileResponse>('/profile', body),
    onSuccess: (res) => setUser(res.user),
  });
}

/** "Reset to recommended": ÖRZA's targets for the current profile and goal. */
export function useResetTargets() {
  const { setUser } = useAuth();
  return useMutation({
    mutationFn: () => api.put<ProfileResponse>('/profile', { recompute_targets: true }),
    onSuccess: (res) => setUser(res.user),
  });
}

export function useSaveTargets() {
  const { setUser } = useAuth();
  return useMutation({
    mutationFn: (body: Partial<Targets>) => api.put<UserResponse>('/settings/targets', body),
    onSuccess: (res) => setUser(res.user),
  });
}

export function useSavePreference() {
  const { setUser } = useAuth();
  return useMutation({
    mutationFn: (body: Partial<Preferences>) => api.put<UserResponse>('/settings/preferences', body),
    onSuccess: (res) => setUser(res.user),
  });
}

export function useSaveMemory() {
  const { setUser } = useAuth();
  return useMutation({
    mutationFn: (memory: string[]) => api.put<UserResponse>('/settings/memory', { memory }),
    onSuccess: (res) => setUser(res.user),
  });
}

/** Why a password change failed, aimed at a field when possible. */
export class PasswordChangeError extends Error {
  constructor(
    message: string,
    readonly field?: 'current' | 'next',
    readonly expired = false
  ) {
    super(message);
    this.name = 'PasswordChangeError';
  }
}

/**
 * POST /api/account/password. A wrong current password is a 401 with `code: "wrong_password"`, which the shared client
 * does not treat as a lost session. A real expired session (`code: "unauthorized"`) signs out as usual and is also
 * reported with `expired`.
 */
async function changePassword(current: string, next: string): Promise<void> {
  try {
    await api.post('/account/password', { current_password: current, new_password: next });
  } catch (e) {
    if (!(e instanceof ApiError)) throw new PasswordChangeError("We couldn't change your password. Please try again.");
    if (e.status === 401) {
      if (e.code === 'wrong_password') throw new PasswordChangeError('Current password is incorrect', 'current');
      throw new PasswordChangeError('Your session ended. Please sign in again to change your password.', undefined, true);
    }
    if (e.status === 429) throw new PasswordChangeError(e.message || 'Too many attempts. Please wait a few minutes and try again.');
    const split = splitFieldError(e);
    if (split?.field === 'current_password') throw new PasswordChangeError(split.message, 'current');
    if (split?.field === 'new_password') throw new PasswordChangeError(split.message, 'next');
    throw new PasswordChangeError(e.message || "We couldn't change your password. Please try again.");
  }
}

export function useChangePassword() {
  return useMutation({
    mutationFn: ({ current, next }: { current: string; next: string }) => changePassword(current, next),
  });
}

/** DELETE /api/account {confirm:"DELETE"} — the caller signs this phone out afterwards. */
export function useDeleteAccount() {
  return useMutation({
    mutationFn: () => api.del<{ ok: true }>('/account', { body: { confirm: 'DELETE' }, timeoutMs: 45_000 }),
  });
}

/* ───────────────────────────── Export ───────────────────────────── */

function localDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export type ExportResult = { status: 'shared'; bytes: number } | { status: 'saved'; bytes: number; uri: string };

/**
 * GET /api/account/export → writes `orza-data-YYYY-MM-DD.json` to the cache folder and opens the share sheet
 * (Save to Files / Drive / email…). Throws ApiError (offline, timeout, server) or a plain Error for file problems.
 */
export async function exportMyData(): Promise<ExportResult> {
  const data = await api.get<unknown>('/account/export', { timeoutMs: 60_000 });
  if (!data || typeof data !== 'object') throw new ApiError("We couldn't prepare your data. Please try again.", { status: 500, code: 'bad_export' });
  const text = JSON.stringify(data, null, 2);

  const file = new File(Paths.cache, `orza-data-${localDate()}.json`);
  file.create({ overwrite: true });
  file.write(text);
  const bytes = file.size || text.length;

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: 'Save your ÖRZA data' });
    return { status: 'shared', bytes };
  }
  return { status: 'saved', bytes, uri: file.uri };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
