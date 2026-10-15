/**
 * Small JSON files in the app's documents folder (expo-file-system `File` / `Paths`), used by the alarm engine for the
 * last good data (so a launch while offline still schedules), the plan bookkeeping and the action queue.
 * Not the Keychain: these can be larger than SecureStore likes, live and die with the app install, and are only
 * readable by this app. Every call is synchronous and never throws (storage trouble = empty / not saved).
 * Web preview: memory only.
 */
import { File, Paths } from 'expo-file-system';

import type { PlanDoseState, PlanMedication, PlanReminder, QuietHours } from './types';

const memory = new Map<string, string>();

function fileFor(name: string): File | null {
  try {
    return new File(Paths.document, name);
  } catch {
    return null;
  }
}

export function readJsonFile<T>(name: string): T | null {
  try {
    const f = fileFor(name);
    const text = f ? (f.exists ? f.textSync() : null) : (memory.get(name) ?? null);
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null; // unreadable or corrupt — start fresh, the next write replaces it
  }
}

export function writeJsonFile(name: string, value: unknown): void {
  try {
    const text = JSON.stringify(value);
    const f = fileFor(name);
    if (!f) {
      memory.set(name, text);
      return;
    }
    if (!f.exists) f.create({ intermediates: true });
    f.write(text);
  } catch {
    // storage full / unavailable — this run still has the data in memory
  }
}

export function deleteJsonFile(name: string): void {
  memory.delete(name);
  try {
    const f = fileFor(name);
    if (f?.exists) f.delete();
  } catch {
    // already gone
  }
}

/* ───────────────────────────── Alarm data cache ───────────────────────────── */

const CACHE_FILE = 'orza-alarms.json';

export interface AlarmSettings {
  tz: string;
  quietHours: QuietHours | null;
  remindersEnabled: boolean;
}

export interface AlarmCache {
  version: 1;
  userId: string;
  meds?: { at: number; list: PlanMedication[] };
  reminders?: { at: number; list: PlanReminder[] };
  settings?: { at: number } & AlarmSettings;
  /** Acted dose states per local day (`/api/meds/today`), with when they were fetched. */
  days: Record<string, { at: number; doses: PlanDoseState[] }>;
  /** What the last successful schedule call put on the phone. */
  scheduled?: { at: number; hash: string; count: number; coveredUntil: number; refills: { key: string; at: number }[] };
  /** Refill alerts that already went out (key → time), kept 3 days. */
  refillDelivered: Record<string, number>;
}

let cache: AlarmCache | null = null;

/** The cache for `userId` (a fresh one when there is none, or it belongs to another account). */
export function loadAlarmCache(userId: string): AlarmCache {
  if (cache?.userId === userId) return cache;
  const stored = readJsonFile<AlarmCache>(CACHE_FILE);
  cache =
    stored && stored.version === 1 && stored.userId === userId && stored.days && typeof stored.days === 'object'
      ? { ...stored, refillDelivered: stored.refillDelivered ?? {} }
      : { version: 1, userId, days: {}, refillDelivered: {} };
  return cache;
}

export function saveAlarmCache(next: AlarmCache): void {
  cache = next;
  writeJsonFile(CACHE_FILE, next);
}

export function deleteAlarmCache(): void {
  cache = null;
  deleteJsonFile(CACHE_FILE);
}
