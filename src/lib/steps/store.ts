/**
 * Per-phone step-sync memory: per user and day, what this phone saved and what it last read from the server (so it
 * never lowers a count), the day's base (a member's edit / counting that began mid-day — `policy.ts`), whether a past
 * day's final count was saved, and the Android permission history ("blocked").
 *
 * A small JSON file in the app's documents folder (removed with the app), like the health sync store. Read
 * synchronously and cached; React reads it through `useStepsStore` (useSyncExternalStore).
 */
import { File, Paths } from 'expo-file-system';
import { useSyncExternalStore } from 'react';

import { addDays } from '../alarms/schedule';

import type { DayRecord } from './policy';

interface UserSteps {
  days: Record<string, DayRecord>;
}

interface FileShape {
  version: 1;
  /** Android "Physical activity": asked at least once / refused for good. */
  asked?: boolean;
  blocked?: boolean;
  users: Record<string, UserSteps>;
}

const FILE_NAME = 'orza-steps.json';
/** Day records older than this (relative to the newest one) are dropped. */
const KEEP_DAYS = 14;

let cache: FileShape | null = null;
let version = 0;
const listeners = new Set<() => void>();

function file(): File | null {
  try {
    return new File(Paths.document, FILE_NAME);
  } catch {
    return null; // web preview — memory only
  }
}

function load(): FileShape {
  if (cache) return cache;
  cache = { version: 1, users: {} };
  try {
    const f = file();
    if (f?.exists) {
      const parsed = JSON.parse(f.textSync()) as Partial<FileShape>;
      if (parsed && parsed.version === 1 && parsed.users && typeof parsed.users === 'object') {
        cache = { version: 1, asked: !!parsed.asked, blocked: !!parsed.blocked, users: { ...parsed.users } };
      }
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
    if (!f.exists) f.create({ intermediates: true });
    f.write(JSON.stringify(cache ?? { version: 1, users: {} }));
  } catch {
    // Storage full / unavailable: memory still holds it for this run.
  }
}

function changed() {
  version += 1;
  persist();
  for (const l of listeners) l();
}

function prune(days: Record<string, DayRecord>): Record<string, DayRecord> {
  const dates = Object.keys(days).sort();
  if (!dates.length) return days;
  const cutoff = addDays(dates[dates.length - 1], -KEEP_DAYS);
  const out: Record<string, DayRecord> = {};
  for (const d of dates) if (d >= cutoff) out[d] = days[d];
  return out;
}

/* ───────────────────────────── Per user ───────────────────────────── */

export function getDayRecord(userId: string, date: string): DayRecord | undefined {
  return load().users[userId]?.days[date];
}

export function updateDayRecord(userId: string, date: string, patch: Partial<DayRecord>) {
  const all = load();
  const user = all.users[userId] ?? { days: {} };
  const days = prune({ ...user.days, [date]: { ...user.days[date], ...patch } });
  cache = { ...all, users: { ...all.users, [userId]: { ...user, days } } };
  changed();
}

/** A past day's final count was saved (it is no longer read). */
export function markDayFinal(userId: string, date: string) {
  if (getDayRecord(userId, date)?.final) return;
  updateDayRecord(userId, date, { final: true });
}

/* ───────────────────────────── Android permission history ───────────────────────────── */

export function permissionHistory(): { asked: boolean; blocked: boolean } {
  const all = load();
  return { asked: !!all.asked, blocked: !!all.blocked };
}

export function setPermissionHistory(patch: { asked?: boolean; blocked?: boolean }) {
  const all = load();
  const next = { ...all, ...patch };
  if (next.asked === all.asked && next.blocked === all.blocked) return;
  cache = next;
  changed();
}

/* ───────────────────────────── React ───────────────────────────── */

export function subscribeStepsStore(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Re-renders whenever anything in the store changes. */
export function useStepsStoreVersion(): number {
  return useSyncExternalStore(subscribeStepsStore, () => version);
}

/** What this phone knows about `userId`'s `date` on the server (re-renders when it changes). */
export function useDayRecord(userId: string, date: string | null): DayRecord | undefined {
  return useSyncExternalStore(subscribeStepsStore, () => (date ? getDayRecord(userId, date) : undefined));
}
