/**
 * Per-user, per-phone health sync state: connected or not, last sync, last error.
 *
 * Kept in a small JSON file in the app's documents folder (removed with the app — unlike the Keychain, which outlives a
 * reinstall while HealthKit permissions don't). Keyed by user id so a second account on the same phone starts fresh.
 * React reads it through `useHealthRecord` (useSyncExternalStore).
 */
import { File, Paths } from 'expo-file-system';
import { useSyncExternalStore } from 'react';

import type { HealthPlatform, HealthSource } from './types';

export interface HealthSyncRecord {
  /** The user connected this phone's health store and hasn't disconnected. */
  connected: boolean;
  platform: HealthPlatform;
  connectedAt?: string;
  /** Last successful sync (ISO). */
  lastSyncAt?: string;
  /** Last attempt, successful or not (ISO). */
  lastAttemptAt?: string;
  /** Friendly message from the last failed attempt (cleared on success). */
  lastError?: string | null;
  /** The last attempt found ÖRZA's permissions removed — offer "Reconnect". */
  needsReconnect?: boolean;
  /** The last successful sync found no data at all on the phone. */
  lastEmpty?: boolean;
  /** Days sent / updated by the last successful sync. */
  lastDaysSent?: number;
  lastDaysUpdated?: number;
  /** Source value the server accepted last time. */
  lastSource?: HealthSource;
}

interface FileShape {
  version: 1;
  users: Record<string, HealthSyncRecord>;
}

const FILE_NAME = 'orza-health-sync.json';
const EMPTY: HealthSyncRecord = { connected: false, platform: 'none' };

let cache: Record<string, HealthSyncRecord> | null = null;
let syncingUser: string | null = null;
const listeners = new Set<() => void>();

function file(): File | null {
  try {
    return new File(Paths.document, FILE_NAME);
  } catch {
    return null; // web preview — memory only
  }
}

function load(): Record<string, HealthSyncRecord> {
  if (cache) return cache;
  cache = {};
  try {
    const f = file();
    if (f?.exists) {
      const parsed = JSON.parse(f.textSync()) as Partial<FileShape>;
      if (parsed && parsed.version === 1 && parsed.users && typeof parsed.users === 'object') cache = { ...parsed.users };
    }
  } catch {
    // Unreadable or corrupt — start fresh; the next write replaces it.
  }
  return cache;
}

function persist() {
  try {
    const f = file();
    if (!f) return;
    const body: FileShape = { version: 1, users: cache ?? {} };
    if (!f.exists) f.create({ intermediates: true });
    f.write(JSON.stringify(body));
  } catch {
    // Storage full / unavailable: state still lives in memory for this run.
  }
}

function emit() {
  for (const l of listeners) l();
}

export function getHealthRecord(userId: string): HealthSyncRecord {
  return load()[userId] ?? EMPTY;
}

export function updateHealthRecord(userId: string, patch: Partial<HealthSyncRecord>): HealthSyncRecord {
  const all = load();
  const next = { ...(all[userId] ?? EMPTY), ...patch };
  cache = { ...all, [userId]: next };
  persist();
  emit();
  return next;
}

/** Whether a sync for `userId` is running right now (one at a time per app). */
export function isSyncing(userId: string) {
  return syncingUser === userId;
}

export function setSyncing(userId: string | null) {
  syncingUser = userId;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The stored record for `userId` plus whether a sync is in flight. Re-renders on every change. */
export function useHealthRecord(userId: string): { record: HealthSyncRecord; syncing: boolean } {
  const record = useSyncExternalStore(subscribe, () => getHealthRecord(userId));
  const syncing = useSyncExternalStore(subscribe, () => syncingUser === userId);
  return { record, syncing };
}
