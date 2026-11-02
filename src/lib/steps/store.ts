/**
 * Per-phone step-sync memory, in two small JSON files (shapes and rules: `storeData.ts`, tested):
 * - the prefs, in the documents folder (kept with the app): per install the Android permission history ("blocked"),
 *   Health Connect's first grant time, a Health Connect refusal from Today, Apple Health's background setup and whether a
 *   member who had agreed deleted their account; per member the steps consent (M9), when this phone last saved their
 *   steps automatically (M5c3) and when they last signed out here (M9);
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

import { fullBackfill, grantConsent } from './plan';
import type { DayRecord } from './policy';
import {
  loadDays,
  loadPrefs,
  STEPS_FILES,
  withConsentPatch,
  withAutoSave,
  withConsents,
  withDayRecord,
  withHcGrant,
  withHcRefused,
  withoutConsent,
  withoutConsentKind,
  withoutHcGrant,
  withoutUserDays,
  withSignOut,
  othersLeftAt,
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
  setPrefs(withConsents(p, grantConsent(p.consents, userId, kind, at, !!p.formerConsent)));
}

/** The member's other steps choices: the switch (`off`), "Not now", the one-time motion offer (`withConsentPatch`). */
export function updateStepsConsent(userId: string, patch: ConsentChoices) {
  setPrefs(withConsentPatch(prefs(), userId, patch));
}

/**
 * `userId` withdrew `kind` (the Health screen's Disconnect: the store): nothing of it is read for them from now on; the
 * rest of their record stays (`storeData.withoutConsentKind`; their last consent → the install's `formerConsent`).
 */
export function withdrawStepsConsent(userId: string, kind: keyof ReadConsent) {
  setPrefs(withoutConsentKind(prefs(), userId, kind));
}

/** Account deletion: `userId`'s consent record goes too (and their last-save time; the install keeps `formerConsent`). */
export function removeStepsConsent(userId: string) {
  setPrefs(withoutConsent(prefs(), userId));
}

/** M9: `userId`'s next consent reads each source's full history (the disclosure says so); false on a shared phone. */
export function stepsFullBackfill(userId: string): boolean {
  const p = prefs();
  return fullBackfill(p.consents, userId, !!p.formerConsent, othersLeftAt(p, userId));
}

/** `userId` signed out of ÖRZA on this phone (M9: a floor for every other member's reads, `otherMemberLeftAt`). */
export function noteSignOut(userId: string, at = Date.now()) {
  setPrefs(withSignOut(prefs(), userId, at));
}

/** M9: when another member than `userId` last left this phone (signed out, or deleted since); null: never. */
export function otherMemberLeftAt(userId: string): number | null {
  return othersLeftAt(prefs(), userId);
}

/** When this phone last had an automatic save of `userId`'s steps applied (null: never) — survives sign-out (M5c3). */
export function lastAutoSave(userId: string): number | null {
  return prefs().autoSavedAt?.[userId] ?? null;
}

export function noteAutoSave(userId: string, at = Date.now()) {
  setPrefs(withAutoSave(prefs(), userId, at));
}

/* ───────────────────────────── Per install ───────────────────────────── */

/** S-H2: when ÖRZA first saw Health Connect's steps read granted on this install (null: not yet). */
export function hcGrantAt(): number | null {
  return prefs().hcGrantAt ?? null;
}

/**
 * Health Connect's permissions were revoked in this process (the Health screen's Disconnect): Health Connect goes on
 * reporting them granted until the app process restarts (RNHC), so a sighting no longer counts as a grant until then.
 */
let hcRevokedThisRun = false;

/**
 * Health Connect's `READ_STEPS` seen granted now: kept only the first time. `explicit`: the member has just granted it
 * (a permission sheet answered) — noted even after a revoke in this process; a mere sighting (the readers' checks) isn't
 * then, as it may be the revoked grant still reported.
 */
export function noteHcGrant(at = Date.now(), explicit = false) {
  if (explicit) hcRevokedThisRun = false;
  else if (hcRevokedThisRun) return;
  setPrefs(withHcGrant(prefs(), at));
}

/** The Health screen's Disconnect revoked Health Connect: its first grant is forgotten, the next one is noted anew (S-H2). */
export function forgetHcGrant() {
  hcRevokedThisRun = true;
  setPrefs(withoutHcGrant(prefs()));
}

/**
 * Android (U2): Health Connect's steps sheet was refused from Today (a refusal or its two-refusal lockout — they look the
 * same): Today offers "Open Health Connect" and the phone's motion sensor instead of the sheet again.
 */
export function hcRefused(): boolean {
  return !!prefs().hcRefused;
}

/** Today's Health Connect steps sheet answered: refused (`true`) or granted (`false`). */
export function setHcRefused(refused: boolean) {
  setPrefs(withHcRefused(prefs(), refused));
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
