/**
 * The steps store's two files and what they hold (steps v2, `docs/notes/steps-v2.md` §2.7, P16) — pure, so
 * `npm run test:steps` covers them; `store.ts` reads and writes the files and keeps them in memory.
 *
 * - **Prefs** (`orza-steps-prefs.json`, the documents folder — kept, backed up): not health data. Per install: the
 *   Android "Physical activity" history (asked / refused for good), when ÖRZA first saw Health Connect's steps read
 *   granted (S-H2), whether Apple Health's background delivery is set up (§4.3). Per member: the steps consent (M9).
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
  /** Per member: their steps consent (M9). */
  consents: Record<string, StepsConsent>;
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
  return out;
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
    return { prefs: { version: 2, ...flags(prefs), consents }, migrated: false };
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

/** Account deletion: `userId`'s consent record removed (unchanged when there is none). */
export function withoutConsent(prefs: StepsPrefs, userId: string): StepsPrefs {
  if (!(userId in prefs.consents)) return prefs;
  const { [userId]: _gone, ...consents } = prefs.consents;
  return { ...prefs, consents };
}

/** S-H2: Health Connect's steps read seen granted at `at` — kept only the first time (unchanged after). */
export function withHcGrant(prefs: StepsPrefs, at: number): StepsPrefs {
  return prefs.hcGrantAt != null || !isTime(at) ? prefs : { ...prefs, hcGrantAt: at };
}
