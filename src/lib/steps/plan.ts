/**
 * Scheduling decisions of the step sync (`sync.ts`) — pure, so `npm run test:steps` covers them (steps v2,
 * `docs/notes/steps-v2.md` §2.1, §2.2, §2.6, §2.7):
 * - which reason a queued run keeps, and how two pending save jobs combine;
 * - which past days are still read: a day is final once settled (M7: 72 h after it ends while a health store is ON —
 *   a watch syncs late; a phone-only day an hour after it ends once its count is complete), within the largest
 *   lookback of the sources that are ON, never before a shared phone's coverage floor (M9), and never a day saved under
 *   another profile time zone (M8: after a zone change only today is recomputed);
 * - the shared-phone backfill (M9): the first member to agree on an install gets each source's full history, a later
 *   member only what was counted from their own consent on;
 * - what Today asks first and which sources are ON (§2.1, §2.2, S-A3: on Android 14+ Health Connect counts the phone
 *   itself, so the phone's own sources go off); Apple Health's "no steps" state (§2.2).
 */
import { addDays } from '../alarms/schedule';

import { dayStartMs } from './counter';
import { autoCount, dayValue, storeReading } from './merge';
import type { DayRecord } from './policy';
import type { DayReading, FirstAsk, PhoneCounter, ReadConsent, RefreshReason, StepFeatures, StepsAccess, StepsAsk, StepsConsent } from './types';

const MIN = 60_000;
const H = 60 * MIN;

/** M7: a day a health store reads is final this long after it ends (late watch syncs, C6) — any day, at the latest. */
export const SETTLE_STORE_MS = 72 * H;
/** M7: a phone-only day is final this long after it ends, once its count is complete. */
export const SETTLE_PHONE_MS = 60 * MIN;
/** Pending past days are read again at most this often (plus on launch, a permission change and a new day). */
export const PAST_READ_EVERY_MS = 30 * MIN;

/** A kind of source that can be ON (§2.1): the health store, or one of the phone's own counters. */
export type CountingSource = 'store' | PhoneCounter;

/**
 * How many past days each source can still read: Health Connect 30 (its limit from before the first grant) and Apple
 * Health 30, the Recording API 9 (it keeps 10), the sampler 9 (its ring buffer keeps 10), CMPedometer 7.
 */
export const LOOKBACK_DAYS: Readonly<Record<CountingSource, number>> = { store: 30, recording: 9, sampler: 9, pedometer: 7 };
/** A background run reads at most this many past days (the newest pending ones). */
export const BACKGROUND_PAST_DAYS = 7;
/** Apple Health "has no steps" when it has none for today and this many days before it (§2.2). */
export const HEALTH_EMPTY_DAYS = 7;

const PRIORITY: Record<RefreshReason, number> = { today: 0, background: 1, foreground: 2, launch: 3, permission: 4 };

/** A run queued behind a running one keeps the more important reason (a permission re-check is never lost). */
export function mergeReason(queued: RefreshReason | undefined, next: RefreshReason): RefreshReason {
  if (!queued) return next;
  return PRIORITY[queued] > PRIORITY[next] ? queued : next;
}

/** Read the pending past days on this run? (Throttled: each read can mean a few health-store queries.) */
export function shouldReadPast(
  reason: RefreshReason,
  today: string,
  now: number,
  last: { at: number; today: string } | null
): boolean {
  if (reason === 'launch' || reason === 'permission' || !last || last.today !== today) return true;
  return now - last.at >= PAST_READ_EVERY_MS;
}

/**
 * Two save jobs waiting for the same slot: the newer readings win; days only the older one read (past days) are kept,
 * so a newer today-only run never drops a pending final count.
 */
export function mergeDays<T extends { date: string }>(older: readonly T[], newer: readonly T[]): T[] {
  const dates = new Set(newer.map((d) => d.date));
  return [...newer, ...older.filter((d) => !dates.has(d.date))];
}

/* ───────────────────────────── M7: final ───────────────────────────── */

/**
 * M7: may this run's reading of a past day make it final (no longer read) once its save went through — or there was
 * nothing to save? `storeOn`: a health store is ON for the member.
 * - Never today (the day hasn't ended); a day already final stays so.
 * - Any day: 72 h after it ended, whether it had data or not.
 * - A store ON: not before (a watch's late sync still counts, and a phone count — a CMPedometer 0 too — doesn't
 *   settle it early).
 * - Phone only: when the winning count is complete (the sampler: read past midnight with no uncertain reboot gap; the
 *   Recording API: read an hour after the day ended; CMPedometer: always) and the day ended an hour ago.
 * - Never on a read that may be missing steps: a health store that is ON but wasn't read (`storeUnread`) — not even
 *   after 72 h; the day's base with a count since it that a source couldn't give (`sinceUnknown`) — not before 72 h.
 */
export function isFinal(day: DayReading, rec: DayRecord | undefined, now: number, storeOn: boolean): boolean {
  if (rec?.final) return true;
  if (!(now >= day.end) || day.storeUnread) return false;
  if (now >= day.end + SETTLE_STORE_MS) return true;
  if (storeOn || dayValue(day, rec?.base, false)?.sinceUnknown) return false;
  return !!autoCount(day, false)?.complete && now >= day.end + SETTLE_PHONE_MS;
}

/** The record patch that makes `day` final: noting whether the read that settled it had a health-store count. */
export function finalPatch(day: DayReading): Partial<DayRecord> {
  return storeReading(day.sources) ? { final: true } : { final: true, noStore: true };
}

/* ───────────────────────────── Which past days are read ───────────────────────────── */

/** The largest lookback (days) among the sources that are ON; 0 when none is. */
export function lookbackDays(on: readonly CountingSource[]): number {
  return on.reduce((n, x) => Math.max(n, LOOKBACK_DAYS[x] ?? 0), 0);
}

/** M8: a day saved automatically under another profile time zone than `tz` is frozen (treated as final). */
export function zoneFrozen(rec: DayRecord | undefined, tz: string): boolean {
  return rec?.tz != null && rec.tz !== tz && rec.autoSent != null;
}

/**
 * The past days to read (newest first): up to `maxBack` days back (`lookbackDays`), skipping days already final
 * (`recordOf(date).final`) or frozen under another zone (M8), and stopping at days that ended by the coverage floor
 * (M9, `backfill`; null: none). At most `limit` days (a background run: `BACKGROUND_PAST_DAYS`). `tz`: the profile
 * time zone.
 */
export function pendingPastDays(
  today: string,
  recordOf: (date: string) => DayRecord | undefined,
  maxBack: number,
  coverFloor: number | null | undefined,
  tz: string,
  limit = Infinity
): string[] {
  const out: string[] = [];
  for (let i = 1; i <= maxBack && out.length < limit; i++) {
    const date = addDays(today, -i);
    // Older days ended earlier still: none of them is this member's.
    if (coverFloor != null && dayStartMs(addDays(date, 1), tz) <= coverFloor) break;
    const rec = recordOf(date);
    if (!rec?.final && !zoneFrozen(rec, tz)) out.push(date);
  }
  return out;
}

/* ───────────────────────────── M9: consent and backfill ───────────────────────────── */

const agreed = (c: StepsConsent | undefined) => !!(c?.store || c?.phone);

/**
 * `userId` agreed at `at` to ÖRZA reading `kind` (the steps disclosure): the install's consent records with it added
 * (unchanged when already agreed). At the member's first consent, `sharedAtConsent` = another member on this install
 * already agreed — a shared phone: nothing from before this consent is read for them (`backfill`). That includes a
 * member who agreed and has since deleted their account (`formerConsent`, the prefs' install flag: their record is
 * gone, their walking is still in the phone's history). A member coming back keeps their record, so neither flag nor
 * floor moves.
 */
export function grantConsent(
  consents: Readonly<Record<string, StepsConsent>>,
  userId: string,
  kind: keyof ReadConsent,
  at: number,
  formerConsent = false
): Record<string, StepsConsent> {
  const mine = consents[userId];
  if (mine?.[kind]) return consents as Record<string, StepsConsent>;
  const shared =
    mine && agreed(mine) ? mine.sharedAtConsent : formerConsent || Object.entries(consents).some(([id, c]) => id !== userId && agreed(c));
  return { ...consents, [userId]: { ...mine, [kind]: { at }, sharedAtConsent: shared } };
}

/**
 * M9, the coverage floor for `userId`: null — a full backfill, each source to its lookback (the first member on the
 * install); else the instant of their first consent (a shared phone: steps before it may be someone else's).
 */
export function backfill(consents: Readonly<Record<string, StepsConsent>>, userId: string): number | null {
  const mine = consents[userId];
  if (!mine?.sharedAtConsent) return null;
  const ats = [mine.store?.at, mine.phone?.at].filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
  return ats.length ? Math.min(...ats) : null;
}

/* ───────────────────────────── §2.1, §2.2: what counts, what Today asks ───────────────────────────── */

/**
 * §2.2: the one permission Today asks for first.
 * - Android: Health Connect when it counts this phone itself (14+, extension 20); else Physical activity when the phone
 *   has a step counter; else Health Connect for a watch or an app (available, or installable from Play); else none.
 * - iPhone: Apple Health; Motion only when HealthKit isn't there.
 */
export function firstAsk(f: StepFeatures): FirstAsk {
  if (f.platform === 'ios') return f.store === 'available' ? 'healthkit' : f.counter ? 'phone' : 'none';
  if (f.platform !== 'android') return 'none';
  if (f.store === 'available' && f.stepTracking) return 'hc';
  if (f.counter) return 'phone';
  return f.store === 'unavailable' ? 'none' : 'hc';
}

/** What decides which sources are ON for a member, beside the phone's features. */
export interface SourceInputs {
  /** This member's consents (M9). */
  consent: ReadConsent;
  /** Health Connect's `READ_STEPS` granted / Apple Health's StepCount sheet answered. */
  storeGranted: boolean;
  /** Physical activity (always granted below Android 10) / Motion & Fitness granted. */
  phoneGranted: boolean;
  /** Android: the Recording API is usable (status `available` and the subscription went through). */
  recordingReady?: boolean;
}

/**
 * §2.1: the sources that are ON (store first). The store with this member's consent and its grant; the phone's counter
 * with consent, permission and the hardware — on Android the Recording API when usable, else the sampler, and none
 * at all while Health Connect counts this phone itself (S-A3: one source, the one other apps see).
 */
export function sourcesOn(f: StepFeatures, s: SourceInputs): CountingSource[] {
  if (f.platform === 'none') return [];
  const store = s.consent.store && s.storeGranted && f.store === 'available';
  const phone = s.consent.phone && s.phoneGranted && f.counter;
  const out: CountingSource[] = store ? ['store'] : [];
  if (f.platform === 'ios') return phone ? [...out, 'pedometer'] : out;
  if (!phone || (store && f.stepTracking)) return out;
  return [...out, s.recordingReady ? 'recording' : 'sampler'];
}

/* ───────────────────────────── The consent gate (P8, P9, T40) ───────────────────────────── */

/**
 * What this member's consent record lets ÖRZA read now: each kind only with its own consent (the steps disclosure, the
 * Health screen's connect), nothing at all while "Count steps automatically" is off. Null: nothing may be read — no
 * consent yet ("Not now" and the motion offer are none), or the switch is off. OS permissions belong to the phone; this
 * is the member's.
 */
export function readConsent(c: StepsConsent | null | undefined): ReadConsent | null {
  if (!c || c.off) return null;
  const store = !!c.store;
  const phone = !!c.phone;
  return store || phone ? { store, phone } : null;
}

/**
 * A read made under `before` may still be published and saved: every kind it read is still allowed (`after`: the
 * member's consent now — a switch turned off, Health disconnected while the read ran → false).
 */
export function stillAllowed(before: ReadConsent, after: ReadConsent | null): boolean {
  return !!after && (!before.store || after.store) && (!before.phone || after.phone);
}

/** The step sync's gate for one member: what it may read now, and how. */
export interface StepsGate {
  /** The kinds the member agreed to (the readers read nothing else). */
  consent: ReadConsent;
  /** The sources ON now (§2.1; empty while the phone's state is unknown — the access check timed out). */
  on: CountingSource[];
  /** Past days read back: the largest lookback of the sources ON (0: today only). */
  maxBack: number;
  /** A health store is ON (M7: its past days settle 72 h after they end) — while unknown, the store's consent. */
  storeOn: boolean;
  /** M9: no source reads before this instant (a shared phone); null: a full backfill. */
  coverFloor: number | null;
}

/**
 * The gate (T40): null — nothing is read or saved for `userId` (no consent of theirs on this install, or the switch is
 * off), whatever the phone's permissions. Else the sources ON (`sourcesOn` with the phone's `access`), how far back to
 * read and the shared phone's floor (`backfill`). `access` null / without features: the phone's state isn't known
 * (the check timed out) — today only, and a store consent counts as a store ON (a past day never settles early).
 */
export function stepsGate(
  consents: Readonly<Record<string, StepsConsent>>,
  userId: string,
  access: StepsAccess | null | undefined
): StepsGate | null {
  const consent = readConsent(consents[userId]);
  if (!consent) return null;
  const coverFloor = backfill(consents, userId);
  const f = access?.features;
  if (!access || !f) return { consent, on: [], maxBack: 0, storeOn: consent.store, coverFloor };
  const on = sourcesOn(f, {
    consent,
    storeGranted: access.store === 'granted',
    phoneGranted: access.phonePermission === 'granted',
    recordingReady: access.recordingReady,
  });
  return { consent, on, maxBack: lookbackDays(on), storeOn: on.includes('store'), coverFloor };
}

/** What Today asks the member for (§2.2): the kind, and whether the OS permission for it is already there. */
export interface StepsAskState {
  kind: StepsAsk;
  /**
   * The OS permission is already granted (a second member on the phone, or the switch was off): the sheet is a plain
   * consent screen, "Turn on", and may be closed — no system prompt follows. False: "Continue", then the prompt (or
   * Settings, when it can't show any more).
   */
  granted: boolean;
}

/**
 * §2.2: what Today asks — the phone's `firstAsk` — while nothing counts for the member (`gate` null: no consent / the
 * switch off; or consent with nothing ON, a permission revoked since). Null: something counts, nothing can count on
 * this phone (`none`), or the phone's state isn't known yet. iPhone: `granted` = the StepCount sheet was answered.
 */
export function stepsAsk(access: StepsAccess | null | undefined, gate: StepsGate | null): StepsAskState | null {
  const kind = access?.firstAsk;
  if (!access || !kind || kind === 'none' || (gate && gate.on.length > 0)) return null;
  return { kind, granted: kind === 'phone' ? access.phonePermission === 'granted' : access.store === 'granted' };
}

/**
 * M5 / S-R4 (`ReadOptions.sinceAt`): per date, its base's instant (`recordOf(date).base.at`) — each source then also
 * reports what it counted after it. Dates without a base are left out.
 */
export function sinceAtOf(dates: readonly string[], recordOf: (date: string) => DayRecord | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const date of dates) {
    const at = recordOf(date)?.base?.at;
    if (typeof at === 'number' && Number.isFinite(at)) out[date] = at;
  }
  return out;
}

/**
 * §2.2, iPhone: Apple Health has no steps for today nor any of the `HEALTH_EMPTY_DAYS` days before it (`days`: their
 * readings; a 0 is no count, M0). A past day no longer read (final, M7 — after the first run only the newest few are)
 * counts by its record (`recordOf`): final with no store count when it settled (`noStore`). Then Today offers "Log
 * steps" and, once, the iPhone's motion — never "you denied": HealthKit hides a denied read as no data. A day neither
 * read nor settled that way isn't proof: false — nor is a day read while Apple Health couldn't be (`storeUnread`: the
 * phone was locked, a query failed; R4).
 */
export function healthEmpty(today: string, days: readonly DayReading[], recordOf?: (date: string) => DayRecord | undefined): boolean {
  const byDate = new Map(days.map((d) => [d.date, d]));
  for (let i = 0; i <= HEALTH_EMPTY_DAYS; i++) {
    const date = addDays(today, -i);
    const day = byDate.get(date);
    if (day) {
      if (day.storeUnread || storeReading(day.sources)) return false;
      continue;
    }
    const rec = i > 0 ? recordOf?.(date) : undefined;
    if (!rec?.final || !rec.noStore) return false;
  }
  return true;
}
