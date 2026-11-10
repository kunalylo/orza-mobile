/**
 * Health sync: read the last 30 days from Apple Health / Health Connect on this phone and upload daily aggregates to
 * `POST /api/health/import` (the same pipeline the website's Apple Health importer uses — raw samples never leave the
 * phone).
 *
 * - `syncHealth(userId, opts)` — one sync; never throws, returns an outcome and records it in the per-user store.
 * - `useHealthSync()` — everything the Health screen needs: availability, connect / disconnect / sync now, state.
 * - `useHealthAutoSync()` — mount once (signed-in area): syncs on launch and whenever the app returns to the
 *   foreground, at most every 3 hours, only after the user connected.
 *
 * Steps v2 (`docs/notes/steps-v2.md` §0.5, §5): the import carries sleep, resting heart rate and weight — never steps
 * (`aggregate.importRows`; the bridges no longer read them for it). Steps reach the account only through the steps sync
 * (`lib/steps`, `POST /api/track/steps`), for a member who agreed and with "Count steps automatically" on. Connecting
 * is that agreement for the store's steps (`consent.store`, P8); Disconnect withdraws it at once and, on Android,
 * revokes every ÖRZA permission in Health Connect (P9).
 */
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { serverKnowsAiConsent } from '@/lib/aiConsent';
import { api, ApiError, errorMessage } from '@/lib/api';
import { useAuth, useSignedInUser } from '@/lib/auth';
import { forgetHcGrant, noteHcGrant, setHcRefused } from '@/lib/steps/store';
import { agreeToSteps, stepsMemberOf, withdrawSteps } from '@/lib/steps/sync';
import { refreshStepsNow } from '@/lib/steps/useSteps';

import { importRows } from './aggregate';
import { healthBridge } from './bridge';
import { getHealthRecord, isSyncing, setSyncing, updateHealthRecord, useHealthRecord, type HealthSyncRecord } from './store';
import {
  AUTO_RETRY_AFTER_FAILURE_MS,
  AUTO_SYNC_INTERVAL_MS,
  HealthNotAuthorizedError,
  importMetrics,
  iphoneSendsHealthData,
  SYNC_DAYS,
  type HealthAvailability,
  type HealthDayInput,
  type HealthSource,
} from './types';

export { healthBridge };

/** React Query roots. `['health', 'days', from, to]` is the Health screen's data. */
export const healthKeys = {
  all: ['health'] as const,
  days: (from: string, to: string) => ['health', 'days', from, to] as const,
};

/** Screens whose numbers move when synced steps / weight land (they mirror into daily tracking). */
const DEPENDENT_ROOTS = new Set(['health', 'today', 'dashboard', 'summary', 'reports', 'insights', 'tracking', 'goals']);

export interface HealthWriteResponse {
  ok: true;
  days_updated: number;
  skipped: number;
}

export type HealthSyncOutcome =
  | { status: 'synced'; daysSent: number; daysUpdated: number; skipped: number }
  | { status: 'empty' }
  | { status: 'skipped'; reason: 'not_connected' | 'busy' | 'recent' | 'unsupported' }
  | { status: 'error'; message: string; notAuthorized: boolean };

/* ───────────────────────────── Upload ───────────────────────────── */

/**
 * The server's import schema currently accepts only `apple_health` | `csv` (backend change requested to add
 * `health_connect`). Health Connect tries its own value first and, if the server refuses the source, falls back to
 * `apple_health` — the closest phone health store, which never overwrites a CSV import — for the rest of this run.
 */
let androidSourceFallback: HealthSource | null = null;
const FALLBACK_SOURCE: HealthSource = 'apple_health';

const sourceRejected = (e: unknown) => e instanceof ApiError && e.status === 400 && /^source\b/i.test(e.message);

async function uploadDays(days: HealthDayInput[]): Promise<{ res: HealthWriteResponse; source: HealthSource }> {
  const preferred = healthBridge.source;
  const first = preferred === 'health_connect' && androidSourceFallback ? androidSourceFallback : preferred;
  try {
    const res = await api.post<HealthWriteResponse>('/health/import', { source: first, days }, { timeoutMs: 45_000 });
    return { res, source: first };
  } catch (e) {
    if (first !== 'health_connect' || !sourceRejected(e)) throw e;
    androidSourceFallback = FALLBACK_SOURCE;
    const res = await api.post<HealthWriteResponse>('/health/import', { source: FALLBACK_SOURCE, days }, { timeoutMs: 45_000 });
    return { res, source: FALLBACK_SOURCE };
  }
}

function readErrorMessage(e: unknown): string {
  if (e instanceof ApiError) return errorMessage(e);
  if (e instanceof HealthNotAuthorizedError) {
    return healthBridge.platform === 'android'
      ? 'Health Connect access is turned off for ÖRZA. Reconnect to keep your data flowing.'
      : 'Apple Health needs your OK for what ÖRZA reads. Tap Reconnect to keep your data flowing.';
  }
  return `We couldn’t read from ${healthBridge.name}. Please try again.`;
}

export function invalidateHealthDependents(qc: QueryClient) {
  return qc.invalidateQueries({ predicate: (q) => DEPENDENT_ROOTS.has(String(q.queryKey[0])) });
}

/* ───────────────────────────── One sync ───────────────────────────── */

export interface SyncOptions {
  /** `auto` respects the 3-hour throttle; `manual` / `connect` always run. */
  reason: 'auto' | 'manual' | 'connect';
  /**
   * The server's `{user}` answers carry `ai_consent` (`aiConsent.serverKnowsAiConsent` of the member's copy): an
   * iPhone's weight goes only then (`health/types.iphoneSendsHealthData`).
   */
  aiConsentKnown: boolean;
  queryClient?: QueryClient;
}

function isDue(record: HealthSyncRecord, now = Date.now()) {
  const last = record.lastSyncAt ? Date.parse(record.lastSyncAt) : 0;
  if (now - last < AUTO_SYNC_INTERVAL_MS) return false;
  const attempt = record.lastAttemptAt ? Date.parse(record.lastAttemptAt) : 0;
  if (record.lastError && now - attempt < AUTO_RETRY_AFTER_FAILURE_MS) return false;
  return true;
}

export async function syncHealth(userId: string, opts: SyncOptions): Promise<HealthSyncOutcome> {
  const record = getHealthRecord(userId);
  if (!record.connected) return { status: 'skipped', reason: 'not_connected' };
  if (isSyncing(userId)) return { status: 'skipped', reason: 'busy' };
  if (opts.reason === 'auto' && !isDue(record)) return { status: 'skipped', reason: 'recent' };

  setSyncing(userId);
  const startedAt = new Date().toISOString();
  try {
    if ((await healthBridge.availability()) !== 'available') {
      updateHealthRecord(userId, { lastAttemptAt: startedAt });
      return { status: 'skipped', reason: 'unsupported' };
    }
    // Never steps (§0.5): they go through the steps sync alone. On an iPhone no weight either for a server that doesn't
    // know the AI consent (`importMetrics`).
    const days = importRows(await healthBridge.readDays(SYNC_DAYS), importMetrics(healthBridge.platform, iphoneSendsHealthData(opts.aiConsentKnown)));
    if (!days.length) {
      updateHealthRecord(userId, {
        lastAttemptAt: startedAt,
        lastSyncAt: startedAt,
        lastError: null,
        needsReconnect: false,
        lastEmpty: true,
        lastDaysSent: 0,
        lastDaysUpdated: 0,
      });
      return { status: 'empty' };
    }
    const { res, source } = await uploadDays(days);
    updateHealthRecord(userId, {
      lastAttemptAt: startedAt,
      lastSyncAt: new Date().toISOString(),
      lastError: null,
      needsReconnect: false,
      lastEmpty: false,
      lastDaysSent: days.length,
      lastDaysUpdated: res.days_updated,
      lastSource: source,
    });
    if (opts.queryClient) void invalidateHealthDependents(opts.queryClient);
    return { status: 'synced', daysSent: days.length, daysUpdated: res.days_updated, skipped: res.skipped };
  } catch (e) {
    const message = readErrorMessage(e);
    const notAuthorized = e instanceof HealthNotAuthorizedError;
    updateHealthRecord(userId, { lastAttemptAt: startedAt, lastError: message, needsReconnect: notAuthorized });
    return { status: 'error', message, notAuthorized };
  } finally {
    setSyncing(null);
  }
}

/* ───────────────────────────── Hooks ───────────────────────────── */

/** Syncs on mount and on every return to the foreground (throttled to every 3 h). Mount once in the signed-in area. */
export function useHealthAutoSync() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const userId = user && !user.is_admin ? user.id : null;
  const aiConsentKnown = serverKnowsAiConsent(user);

  useEffect(() => {
    if (!userId) return undefined;
    const run = () => void syncHealth(userId, { reason: 'auto', aiConsentKnown, queryClient: qc });
    run();
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') run();
    });
    return () => sub.remove();
  }, [userId, aiConsentKnown, qc]);
}

export type ConnectResult =
  | { status: 'connected'; outcome: HealthSyncOutcome }
  | { status: 'denied' }
  | { status: 'unavailable'; availability: HealthAvailability }
  | { status: 'error'; message: string };

export interface DisconnectResult {
  /**
   * The store took away every ÖRZA permission (Android: Health Connect). False on iPhone — HealthKit has no such call:
   * the member removes ÖRZA in Settings › Health › Data Access & Devices (the screen says so) — or when Health Connect
   * didn't answer. Either way ÖRZA stopped reading at once (the import is off, the steps consent withdrawn).
   */
  revoked: boolean;
}

/** State + actions for the Health screen. */
export function useHealthSync() {
  const user = useSignedInUser();
  const qc = useQueryClient();
  const { record, syncing } = useHealthRecord(user.id);
  const [availability, setAvailability] = useState<HealthAvailability | 'checking'>('checking');
  const [connecting, setConnecting] = useState(false);

  const recheck = useCallback(async () => {
    const a = await healthBridge.availability();
    setAvailability(a);
    return a;
  }, []);

  // Check now, and again when returning from the Play Store / Settings.
  useEffect(() => {
    let alive = true;
    const check = () => {
      void healthBridge.availability().then((a) => {
        if (alive) setAvailability(a);
      });
    };
    check();
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') check();
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  /**
   * `onlyIfGranted`: don't show the permission sheet — connect only if ÖRZA can already read something (the person just
   * allowed it in Health Connect's settings), otherwise report `denied`.
   *
   * Connected = the member's consent to ÖRZA counting their steps from the store too (`consent.store`, P8 — the card
   * says so); "Count steps automatically" stays as the member set it. Today then reads at once.
   */
  const connect = useCallback(async (opts?: { onlyIfGranted?: boolean }): Promise<ConnectResult> => {
    setConnecting(true);
    try {
      const a = await recheck();
      if (a !== 'available') return { status: 'unavailable', availability: a };
      let granted: boolean;
      if (opts?.onlyIfGranted) granted = await healthBridge.hasAccess();
      else {
        const r = await healthBridge.requestAccess();
        granted = r.granted;
        if (healthBridge.platform === 'android') {
          const steps = r.metrics.includes('steps');
          // U2 / U3: Today's card follows this answer like its own sheet's — Steps refused (or Health Connect's lockout
          // after two refusals) → "Open Health Connect" rather than a sheet that may never show; allowed → cleared.
          setHcRefused(!steps);
          // S-H2: the member's own grant of Health Connect's steps (noted even right after a Disconnect in this process).
          if (steps) noteHcGrant(Date.now(), true);
        }
      }
      if (!granted) return { status: 'denied' };
      updateHealthRecord(user.id, {
        connected: true,
        platform: healthBridge.platform,
        connectedAt: new Date().toISOString(),
        lastError: null,
        needsReconnect: false,
        lastEmpty: false,
      });
      if (!user.is_admin) {
        await agreeToSteps(user.id, 'store');
        void refreshStepsNow(stepsMemberOf(user), qc);
      }
      const outcome = await syncHealth(user.id, { reason: 'connect', aiConsentKnown: serverKnowsAiConsent(user), queryClient: qc });
      return { status: 'connected', outcome };
    } catch (e) {
      return { status: 'error', message: e instanceof ApiError ? errorMessage(e) : `We couldn’t open ${healthBridge.name}. Please try again.` };
    } finally {
      setConnecting(false);
    }
  }, [qc, recheck, user]);

  /**
   * Stop syncing: the import stops, and steps from the store stop at once (`consent.store` withdrawn — Health Connect
   * goes on answering until the app restarts, so the consent is what stops the reads; the phone's own counter goes on
   * if the member agreed to it). Android: every ÖRZA permission in Health Connect is revoked (P9) and its first grant
   * forgotten, so the next grant's day is measured again (S-H2). iPhone: nothing to revoke (`revoked: false`). Never
   * throws.
   */
  const disconnect = useCallback(async (): Promise<DisconnectResult> => {
    updateHealthRecord(user.id, { connected: false, lastError: null, needsReconnect: false, lastEmpty: false });
    withdrawSteps(user.id, 'store');
    const revoked = await healthBridge.revokeAll();
    if (revoked) forgetHcGrant();
    if (!user.is_admin) void refreshStepsNow(stepsMemberOf(user), qc);
    return { revoked };
  }, [qc, user]);

  const syncNow = useCallback(() => syncHealth(user.id, { reason: 'manual', aiConsentKnown: serverKnowsAiConsent(user), queryClient: qc }), [qc, user]);

  return {
    platform: healthBridge.platform,
    name: healthBridge.name,
    availability,
    record,
    connected: record.connected,
    syncing,
    connecting,
    connect,
    disconnect,
    syncNow,
    recheck,
    openManage: healthBridge.openManage,
    hasAccess: healthBridge.hasAccess,
    openStore: healthBridge.openStore,
  };
}
