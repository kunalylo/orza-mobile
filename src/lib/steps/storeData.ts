/**
 * The steps store's two files and what they hold (steps v2, `docs/notes/steps-v2.md` §2.7, P16) — pure, so
 * `npm run test:steps` covers them; `store.ts` reads and writes the files and keeps them in memory.
 *
 * - **Prefs** (`orza-steps-prefs.json`, the documents folder — kept, backed up): not health data. Per install: the
 *   Android "Physical activity" history (asked / refused for good), when ÖRZA first saw Health Connect's steps read
 *   granted (S-H2), whether Apple Health's background delivery is set up (§4.3), whether a member who had agreed has
 *   deleted their account or withdrawn every consent (M9). Per member: the steps consent (M9), and when this phone last saved their steps
 *   automatically (a time, no steps: M5c3).
 * - **Day records** (`orza-steps-days.json`, the cache folder — out of iCloud / Android backups, and the system may
 *   purge it): per member and day, what this phone saved and saw on the server (`policy.DayRecord`). Safe to lose: the
 *   server is the record of truth (its edit marker and modes). Deleted per member at sign-out.
 * - The **v1 file** (`orza-steps.json`, documents): only its permission flags are kept; its day records (the old shape,
 *   and health data in a backed-up folder) are dropped, and `store.ts` deletes the file.
 */
import { addDays } from '../alarms/schedule';

import type { DayRecord } from './policy';
import type { StepsConsent } from './types';

/** Where each file lives: `document` is kept and backed up; `cache` is never backed up and may be purged. */
export const STEPS_FILES = {
  prefs: { name: 'orza-steps-prefs.json', dir: 'document' },
  days: { name: 'orza-steps-days.json', dir: 'cache' },
  legacy: { name: 'orza-steps.json', dir: 'document' },
} as const;

/** A member's day records older than this (days before their newest one) are dropped: the longest lookback is 30. */
export const KEEP_DAYS = 35;

export interface StepsPrefs {
  version: 2;
  /** Android "Physical activity": asked at least once / refused for good. */
  asked?: boolean;
  blocked?: boolean;
  /** S-H2: when ÖRZA first saw Health Connect's `READ_STEPS` granted on this install (epoch ms). */
  hcGrantAt?: number;
  /** iPhone: Apple Health's background delivery of steps is configured (the observer subscribes at launch). */
  hkBackground?: boolean;
  /**
   * Android (U2): Health Connect's steps sheet was refused from Today — a refusal, or its lockout after two (the app's,
   * so per install). Today then offers "Open Health Connect" and the phone's motion sensor instead of asking again;
   * cleared by a grant from Today.
   */
  hcRefused?: boolean;
  /**
   * A member who had agreed deleted their account (their consent record is gone) or withdrew every consent (the Health
   * screen's Disconnect, R6): a later first consent — theirs too — is still a shared phone's (M9): the phone's history
   * holds that member's walking.
   */
  formerConsent?: boolean;
  /** Per member: their steps consent (M9). */
  consents: Record<string, StepsConsent>;
  /**
   * Per member: when this phone last had an automatic save of their steps applied (epoch ms; any day — a time, no
   * steps). It outlives the day records (deleted at sign-out, the cache purged): a start made with no record of the
   * day never counts again what such a save may hold (M5c3).
   */
  autoSavedAt?: Record<string, number>;
}

export interface StepsDays {
  version: 2;
  /** Per member, per local date (YYYY-MM-DD): what this phone knows of the day on the server. */
  users: Record<string, Record<string, DayRecord>>;
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isTime = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A consent's `{at}`, or nothing. */
function stamp(x: unknown): { at: number } | undefined {
  return isObject(x) && isTime(x.at) ? { at: x.at } : undefined;
}

/** A member's consent record as stored, keeping only well-formed fields (a malformed one never reads as consent). */
function consentOf(x: unknown): StepsConsent | null {
  if (!isObject(x)) return null;
  const out: StepsConsent = { sharedAtConsent: x.sharedAtConsent === true };
  const store = stamp(x.store);
  const phone = stamp(x.phone);
  const off = stamp(x.off);
  if (store) out.store = store;
  if (phone) out.phone = phone;
  if (off) out.off = off;
  if (isTime(x.notNowUntil)) out.notNowUntil = x.notNowUntil;
  if (typeof x.motionOffered === 'boolean') out.motionOffered = x.motionOffered;
  return out;
}

/** The per-install flags a prefs file (or the v1 file) holds. */
function flags(x: Record<string, unknown>): Omit<StepsPrefs, 'version' | 'consents'> {
  const out: Omit<StepsPrefs, 'version' | 'consents'> = {};
  if (typeof x.asked === 'boolean') out.asked = x.asked;
  if (typeof x.blocked === 'boolean') out.blocked = x.blocked;
  if (isTime(x.hcGrantAt)) out.hcGrantAt = x.hcGrantAt;
  if (typeof x.hkBackground === 'boolean') out.hkBackground = x.hkBackground;
  if (x.hcRefused === true) out.hcRefused = true;
  if (x.formerConsent === true) out.formerConsent = true;
  return out;
}

/** The per-member times of the last automatic save, keeping only well-formed ones (none → undefined). */
function savedTimes(x: unknown): Record<string, number> | undefined {
  if (!isObject(x)) return undefined;
  const out: Record<string, number> = {};
  for (const [userId, at] of Object.entries(x)) if (userId && isTime(at)) out[userId] = at;
  return Object.keys(out).length ? out : undefined;
}

const emptyPrefs = (): StepsPrefs => ({ version: 2, consents: {} });

/**
 * The prefs from the prefs file's JSON (`prefs`; null / unreadable: none), else from the v1 file's (`legacy`): only
 * its Android permission flags (`migrated`: the v1 file was read — the store writes the prefs and deletes it). Else
 * empty.
 */
export function loadPrefs(prefs: unknown, legacy: unknown): { prefs: StepsPrefs; migrated: boolean } {
  if (isObject(prefs) && prefs.version === 2) {
    const consents: Record<string, StepsConsent> = {};
    if (isObject(prefs.consents)) {
      for (const [userId, raw] of Object.entries(prefs.consents)) {
        const c = consentOf(raw);
        if (userId && c) consents[userId] = c;
      }
    }
    const autoSavedAt = savedTimes(prefs.autoSavedAt);
    return { prefs: { version: 2, ...flags(prefs), consents, ...(autoSavedAt ? { autoSavedAt } : {}) }, migrated: false };
  }
  if (isObject(legacy) && legacy.version === 1) {
    const out = emptyPrefs();
    if (legacy.asked === true) out.asked = true;
    if (legacy.blocked === true) out.blocked = true;
    return { prefs: out, migrated: true };
  }
  return { prefs: emptyPrefs(), migrated: false };
}

/** The day records from the days file's JSON (null / unreadable / another version: none — the server has the truth). */
export function loadDays(json: unknown): StepsDays {
  const out: StepsDays = { version: 2, users: {} };
  if (!isObject(json) || json.version !== 2 || !isObject(json.users)) return out;
  for (const [userId, raw] of Object.entries(json.users)) {
    if (!userId || !isObject(raw)) continue;
    const days: Record<string, DayRecord> = {};
    for (const [date, rec] of Object.entries(raw)) if (DATE.test(date) && isObject(rec)) days[date] = rec as DayRecord;
    if (Object.keys(days).length) out.users[userId] = days;
  }
  return out;
}

/** A member's day records within `KEEP_DAYS` of their newest. */
function pruned(days: Record<string, DayRecord>): Record<string, DayRecord> {
  const dates = Object.keys(days).sort();
  if (!dates.length) return days;
  const cutoff = addDays(dates[dates.length - 1], -KEEP_DAYS);
  if (dates[0] >= cutoff) return days;
  const out: Record<string, DayRecord> = {};
  for (const d of dates) if (d >= cutoff) out[d] = days[d];
  return out;
}

/** `patch` merged into `userId`'s record of `date` (a field set to undefined is removed); old days pruned. */
export function withDayRecord(all: StepsDays, userId: string, date: string, patch: Partial<DayRecord>): StepsDays {
  const mine = all.users[userId] ?? {};
  const rec: Record<string, unknown> = { ...mine[date], ...patch };
  for (const k of Object.keys(rec)) if (rec[k] === undefined) delete rec[k];
  return { ...all, users: { ...all.users, [userId]: pruned({ ...mine, [date]: rec as DayRecord }) } };
}

/** Sign-out (P16): every day record of `userId` deleted (unchanged when there is none). */
export function withoutUserDays(all: StepsDays, userId: string): StepsDays {
  if (!(userId in all.users)) return all;
  const { [userId]: _gone, ...users } = all.users;
  return { ...all, users };
}

/** The install's consent records replaced (`plan.grantConsent` makes the next ones). */
export function withConsents(prefs: StepsPrefs, consents: Record<string, StepsConsent>): StepsPrefs {
  return consents === prefs.consents ? prefs : { ...prefs, consents };
}

/** The member's choices beside consent (P9 / P19 / §2.2) that `withConsentPatch` sets. */
export type ConsentChoices = Partial<Pick<StepsConsent, 'off' | 'notNowUntil' | 'motionOffered'>>;

/**
 * `patch` merged into `userId`'s consent record: the switch (`off`), "Not now" (`notNowUntil`), the one-time motion
 * offer; a field set to undefined is removed. A member without a record gets one with no consent in it
 * (`plan.grantConsent` decides the shared-phone flag at their first consent).
 */
export function withConsentPatch(prefs: StepsPrefs, userId: string, patch: ConsentChoices): StepsPrefs {
  const next: Record<string, unknown> = { ...(prefs.consents[userId] ?? { sharedAtConsent: false }), ...patch };
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
  return { ...prefs, consents: { ...prefs.consents, [userId]: next as unknown as StepsConsent } };
}

/**
 * Account deletion: `userId`'s consent record and last-save time removed (unchanged when there is neither). A member
 * who had agreed leaves `formerConsent` behind (no id, no data): the next member's first consent is a shared phone's.
 */
export function withoutConsent(prefs: StepsPrefs, userId: string): StepsPrefs {
  const mine = prefs.consents[userId];
  const saved = !!prefs.autoSavedAt && userId in prefs.autoSavedAt;
  if (!mine && !saved) return prefs;
  const { [userId]: _gone, ...consents } = prefs.consents;
  const { [userId]: _savedAt, ...autoSavedAt } = prefs.autoSavedAt ?? {};
  const { autoSavedAt: _all, ...rest } = prefs;
  return {
    ...rest,
    ...(mine && (mine.store || mine.phone) ? { formerConsent: true } : {}),
    consents,
    ...(Object.keys(autoSavedAt).length ? { autoSavedAt } : {}),
  };
}

/**
 * `userId` withdrew `kind` (the Health screen's Disconnect: the store, R6): its stamp goes, nothing of that kind is read
 * for them; their other consent and choices (the switch, "Not now", the motion offer, `sharedAtConsent`) stay.
 * Unchanged when they hadn't agreed to it. Their last consent withdrawn → `formerConsent` (M9: their walking stays in
 * the phone's history, so the next first consent on this install — theirs too — reads from the consent on).
 */
export function withoutConsentKind(prefs: StepsPrefs, userId: string, kind: 'store' | 'phone'): StepsPrefs {
  const mine = prefs.consents[userId];
  if (!mine?.[kind]) return prefs;
  const next: StepsConsent = { ...mine };
  delete next[kind];
  const left = !!(next.store || next.phone);
  return { ...prefs, ...(left ? {} : { formerConsent: true }), consents: { ...prefs.consents, [userId]: next } };
}

/**
 * S-H2 after a revoke (the Health screen's Disconnect, R6): Health Connect's first grant forgotten, so the next grant's
 * day is measured again — Health Connect may not have counted this phone in between (unchanged when none is known).
 */
export function withoutHcGrant(prefs: StepsPrefs): StepsPrefs {
  if (prefs.hcGrantAt == null) return prefs;
  const { hcGrantAt: _gone, ...rest } = prefs;
  return rest;
}

/** This phone's automatic save of `userId`'s steps was applied at `at` (kept only when later than the one known). */
export function withAutoSave(prefs: StepsPrefs, userId: string, at: number): StepsPrefs {
  const known = prefs.autoSavedAt?.[userId];
  if (!userId || !isTime(at) || (known != null && known >= at)) return prefs;
  return { ...prefs, autoSavedAt: { ...prefs.autoSavedAt, [userId]: at } };
}

/** S-H2: Health Connect's steps read seen granted at `at` — kept only the first time (unchanged after). */
export function withHcGrant(prefs: StepsPrefs, at: number): StepsPrefs {
  return prefs.hcGrantAt != null || !isTime(at) ? prefs : { ...prefs, hcGrantAt: at };
}

/** U2: Health Connect's steps refused from Today (`refused`), or granted since (the note goes; unchanged when so already). */
export function withHcRefused(prefs: StepsPrefs, refused: boolean): StepsPrefs {
  if (!!prefs.hcRefused === refused) return prefs;
  if (refused) return { ...prefs, hcRefused: true };
  const { hcRefused: _gone, ...rest } = prefs;
  return rest;
}
