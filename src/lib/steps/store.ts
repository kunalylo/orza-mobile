/**
 * Per-phone step-sync memory, in two small JSON files (shapes and rules: `storeData.ts`, tested):
 * - the prefs, in the documents folder (kept with the app): per install the Android permission history ("blocked"),
 *   Health Connect's first grant time and Apple Health's background setup; per member the steps consent (M9);
 * - the day records, in the cache folder (never backed up; the system may purge it — the server is the record of
 *   truth): per member and day, what this phone saved and read on the server, the day's base (`policy.ts`), whether a
 *   past day is final. A member's are deleted at sign-out (`deleteUserDays`).
 * The v1 file (`orza-steps.json`) is read once: its permission flags move to the prefs, and it is deleted.
 *
 * Read synchronously and cached; React reads it through `useDayRecord` / `useStepsConsent` (useSyncExternalStore).
 * On the web preview (no files) it lives in memory only.
 */
import { File, Paths } from 'expo-file-system';
import { useSyncExternalStore } from 'react';

import { grantConsent } from './plan';
import type { DayRecord } from './policy';
import {
  loadDays,
  loadPrefs,
  STEPS_FILES,
  withConsentPatch,
  withConsents,
  withDayRecord,
  withHcGrant,
  withoutConsent,
  withoutUserDays,
  type ConsentChoices,
  type StepsDays,
  type StepsPrefs,
} from './storeData';
import type { ReadConsent, StepsConsent } from './types';

type StepsFile = keyof typeof STEPS_FILES;

let prefsCache: StepsPrefs | null = null;
let daysCache: StepsDays | null = null;
let version = 0;
const listeners = new Set<() => void>();

function file(which: StepsFile): File | null {
  try {
    const { name, dir } = STEPS_FILES[which];
    return new File(dir === 'cache' ? Paths.cache : Paths.document, name);
  } catch {
    return null; // web preview — memory only
  }
}

/** The file's JSON; null when it is missing or unreadable (corrupt: start fresh — the next write replaces it). */
function readJson(which: StepsFile): unknown {
  try {
    const f = file(which);
    return f?.exists ? JSON.parse(f.textSync()) : null;
  } catch {
    return null;
  }
}

/** True when written. Storage full / unavailable: memory still holds it for this run. */
function writeJson(which: StepsFile, value: unknown): boolean {
  try {
    const f = file(which);
    if (!f) return false;
    if (!f.exists) f.create({ intermediates: true });
    f.write(JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function deleteFile(which: StepsFile) {
  try {
    const f = file(which);
    if (f?.exists) f.delete();
  } catch {
    // already gone
  }
}

function prefs(): StepsPrefs {
  if (prefsCache) return prefsCache;
  const stored = readJson('prefs');
  const { prefs: loaded, migrated } = loadPrefs(stored, stored == null ? readJson('legacy') : null);
  prefsCache = loaded;
  // The v1 file: once its flags are safely in the prefs, it goes (with its day records: health data in a backed-up
  // folder). A leftover one next to the prefs goes too.
  if (!migrated || writeJson('prefs', loaded)) deleteFile('legacy');
  return prefsCache;
}

function days(): StepsDays {
  if (!daysCache) daysCache = loadDays(readJson('days'));
  return daysCache;
}

function changed() {
  version += 1;
  for (const l of listeners) l();
}

function setPrefs(next: StepsPrefs) {
  if (next === prefs()) return;
  prefsCache = next;
  writeJson('prefs', next);
  changed();
}

function setDays(next: StepsDays) {
  if (next === days()) return;
  daysCache = next;
  writeJson('days', next);
  changed();
}

/* ───────────────────────────── Day records (per member) ───────────────────────────── */

export function getDayRecord(userId: string, date: string): DayRecord | undefined {
  return days().users[userId]?.[date];
}

export function updateDayRecord(userId: string, date: string, patch: Partial<DayRecord>) {
  setDays(withDayRecord(days(), userId, date, patch));
}

/** A past day's final count was saved (it is no longer read). */
export function markDayFinal(userId: string, date: string) {
  if (getDayRecord(userId, date)?.final) return;
  updateDayRecord(userId, date, { final: true });
}

/** Sign-out (P16): forget every day record of `userId` on this phone. */
export function deleteUserDays(userId: string) {
  setDays(withoutUserDays(days(), userId));
}

/* ───────────────────────────── Android permission history ───────────────────────────── */

export function permissionHistory(): { asked: boolean; blocked: boolean } {
  const p = prefs();
  return { asked: !!p.asked, blocked: !!p.blocked };
}

export function setPermissionHistory(patch: { asked?: boolean; blocked?: boolean }) {
  const p = prefs();
  const next = { ...p, ...patch };
  if (!!next.asked === !!p.asked && !!next.blocked === !!p.blocked) return;
  setPrefs(next);
}

/* ───────────────────────────── Consent (per member, M9) ───────────────────────────── */

/** Every member's steps consent on this install. */
export function stepsConsents(): Readonly<Record<string, StepsConsent>> {
  return prefs().consents;
}

export function getStepsConsent(userId: string): StepsConsent | undefined {
  return prefs().consents[userId];
}

/** `userId` agreed to ÖRZA reading `kind` (the steps disclosure; `plan.grantConsent`: the shared-phone flag). */
export function grantStepsConsent(userId: string, kind: keyof ReadConsent, at = Date.now()) {
  const p = prefs();
  setPrefs(withConsents(p, grantConsent(p.consents, userId, kind, at)));
}

/** The member's other steps choices: the switch (`off`), "Not now", the one-time motion offer (`withConsentPatch`). */
export function updateStepsConsent(userId: string, patch: ConsentChoices) {
  setPrefs(withConsentPatch(prefs(), userId, patch));
}

/** Account deletion: `userId`'s consent record goes too. */
export function removeStepsConsent(userId: string) {
  setPrefs(withoutConsent(prefs(), userId));
}

/* ───────────────────────────── Per install ───────────────────────────── */

/** S-H2: when ÖRZA first saw Health Connect's steps read granted on this install (null: not yet). */
export function hcGrantAt(): number | null {
  return prefs().hcGrantAt ?? null;
}

/** Health Connect's `READ_STEPS` seen granted now: kept only the first time. */
export function noteHcGrant(at = Date.now()) {
  setPrefs(withHcGrant(prefs(), at));
}

/** iPhone: Apple Health's background delivery of steps is configured (§4.3). */
export function hkBackground(): boolean {
  return !!prefs().hkBackground;
}

export function setHkBackground(on: boolean) {
  const p = prefs();
  if (!!p.hkBackground === on) return;
  setPrefs({ ...p, hkBackground: on });
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

/** `userId`'s steps consent on this install (re-renders when it changes). */
export function useStepsConsent(userId: string | null): StepsConsent | undefined {
  return useSyncExternalStore(subscribeStepsStore, () => (userId ? getStepsConsent(userId) : undefined));
}
