/**
 * Automatic steps — read, publish, save. No UI imports: it also runs headless, from the background task
 * (`lib/alarms/background.ts`) and from Apple Health's background delivery (`healthkitObserver.ios.ts`).
 *
 *   the member's consent (the gate) → access → read today (+ past days not final yet) → publish today's reading to
 *   Today → (own queue, never awaited by the UI) save each day through `POST /api/track/steps` (`save.syncDay`)
 *
 * - The gate (`docs/notes/steps-v2.md` §2.7, P8, P9; `plan.stepsGate`): nothing is read or saved for a member without
 *   their consent on this install (the steps disclosure, the Health screen's connect), nor while their "Count steps
 *   automatically" switch is off (`setAutoSteps`) — whatever the phone's permissions. Every source this phone runs is
 *   then switched off once (Android: the Recording API unsubscribed, the sampler stopped; iPhone: Apple Health's
 *   background delivery cleared), and Today gets what to ask (`StepsState.ask`, §2.2: "Continue" before a system
 *   prompt, "Turn on" when the permission is already there). With consent the readers read only the kinds agreed to,
 *   never before a shared phone's floor (M9), as far back as the sources ON reach, plus each base's count since its
 *   instant (M5, `ReadOptions.sinceAt`). A read that finishes after the member switched off / withdrew a kind is
 *   dropped; a save job stops before its next day. The member's answers: `agreeToSteps` (Today's disclosure, the Health
 *   screen's connect), `withdrawSteps` (its Disconnect), `setAutoSteps` (the switch), `foldStepsAsk` ("Not now", P19).
 * - `refreshSteps(member, opts)`: the read + publish is single-flight; a call during a run queues one follow-up run that
 *   keeps the most important reason (`plan.mergeReason`). Every native / health call is time-bounded.
 * - Saving runs on its own queue (the newest readings win, pending past days are kept): a slow network never holds up
 *   Today or the permission flow. One day is `save.syncDay` (I/O injected, tested): the day's number (`merge.dayValue`:
 *   its reading and its base), the plan (`policy.savePlan`: `auto` raises, `reconcile` corrects this phone's own earlier
 *   save of a past day), the server's answer (an edit marker this phone hasn't taken becomes the day's base, M5c2), and
 *   — a past day — final once settled (`plan.isFinal`, M7: 72 h after the day while a health store is ON, else an hour
 *   after it once a phone count read it whole). The member's own number is `saveManualSteps` (`manual` mode).
 * - iPhone: a number that comes from Apple Health isn't sent until the app-wide AI data consent ships (coordinator
 *   decision: the server's coach reads `tracking.steps`) — `SEND_APPLE_HEALTH_STEPS`. Today still shows it.
 * - `syncStepsInBackground()`: the same without UI — the session and member come from the Keychain, the member's
 *   profile (its time zone, M8) refreshed from the server first; Android reads stored counts only (no live sensor read),
 *   and at most `BACKGROUND_PAST_DAYS` past days per run.
 * - `clearStepsOnSignOut(userId)`: every source stops counting for the member and their day records go (P16); after an
 *   account deletion their consent record too (M9).
 */
import { AppState } from 'react-native';

import type { TodayData, TrackingDay } from '@/features/today/types';
import { api, ApiError, getSessionToken, setSessionToken } from '@/lib/api';
import { KEYS, readSecure, readSecureJson, userSnapshot, writeSecureJson } from '@/lib/secure';
import type { PublicUser } from '@/lib/types';

import { addDays, safeTimeZone, utcToZoned } from '../alarms/schedule';

import { autoCount } from './merge';
import {
  BACKGROUND_PAST_DAYS,
  HEALTH_EMPTY_DAYS,
  healthEmpty,
  mergeDays,
  mergeReason,
  NOT_NOW_MS,
  notNowActive,
  pendingPastDays,
  readConsent,
  shouldReadPast,
  sinceAtOf,
  stepsAsk,
  stepsGate,
  stillAllowed,
  type CountingSource,
  type StepsAskState,
  type StepsGate,
} from './plan';
import { countsAppleHealth } from './policy';
import { stepsReader } from './reader';
import { saveManualDay, syncDay, type SaveDeps, type StepsAnswer } from './save';
import { forgetServerObservations, markerOf, markerRowOf } from './serverSeen';
import { dayBounds } from './shared';
import {
  deleteUserDays,
  getDayRecord,
  getStepsConsent,
  grantStepsConsent,
  lastAutoSave,
  noteAutoSave,
  removeStepsConsent,
  stepsConsents,
  updateDayRecord,
  updateStepsConsent,
  withdrawStepsConsent,
} from './store';
import type { DayReading, ReadConsent, RefreshReason, StepsAccess } from './types';

export type { RefreshReason } from './types';

/**
 * iPhone: send numbers that come from Apple Health (HealthKit data) to the server. Off until the app-wide AI data
 * consent ships (coordinator decision, App Store 5.1.2(i) / 5.1.3: the server's coach builds its prompt from
 * `tracking.steps`) — or until the web leaves Apple Health days out of the coach. Then: true. Android is unaffected.
 */
const SEND_APPLE_HEALTH_STEPS = false;
const holdAppleHealth = stepsReader.platform === 'ios' && !SEND_APPLE_HEALTH_STEPS;

/** No consent: what the readers get to switch every source off. */
const NO_CONSENT: ReadConsent = { store: false, phone: false };

/* ───────────────────────────── Member ───────────────────────────── */

export interface StepsMember {
  id: string;
  /** IANA zone the member's days are counted in (their profile time zone, like the server). */
  timeZone: string;
}

export function stepsMemberOf(user: { id: string; profile?: { timezone?: string | null } | null }): StepsMember {
  return { id: user.id, timeZone: safeTimeZone(user.profile?.timezone) };
}

/** The member while the app UI runs (set by `useStepsAutoSync`); null in a headless background run. */
let foregroundMember: StepsMember | null = null;

export function bindStepsMember(member: StepsMember | null) {
  foregroundMember = member;
}

/* ───────────────────────────── Published state ───────────────────────────── */

/** Today's latest automatic reading: every source's (`merge.dayValue` makes the day's number with its base). */
export interface TodayReading {
  /** The member's today (YYYY-MM-DD). */
  date: string;
  /** When it was read. */
  at: number;
  day: DayReading;
}

export interface StepsState {
  /** Whose numbers these are (null before the first read / after sign-out). */
  userId: string | null;
  /** The phone's step sources and permissions (null until checked). */
  access: StepsAccess | null;
  /** What the member's consent lets ÖRZA read (null: nothing — no consent yet, or the switch is off). */
  consent: ReadConsent | null;
  /** The sources ON for the member at the last read (§2.1; empty: nothing counts). */
  on: CountingSource[];
  /** What Today asks the member for (§2.2; null: nothing — something counts, or nothing can on this phone). */
  ask: StepsAskState | null;
  /** P19: the member said "Not now — I'll log steps" less than 30 days ago — Today's ask stays folded. */
  notNow: boolean;
  /**
   * iPhone with Apple Health ON: it has no steps for today nor the 7 days before (§2.2) — Today offers "Log steps" and,
   * once, the iPhone's motion. Never "you denied": HealthKit can't tell.
   */
  healthEmpty: boolean;
  /** The member's today (YYYY-MM-DD) at the last read. */
  date: string | null;
  /** The last automatic reading of `date`; null when no source could read it (or nothing may be read). */
  today: TodayReading | null;
  /** A read is running. */
  reading: boolean;
}

const EMPTY: StepsState = {
  userId: null,
  access: null,
  consent: null,
  on: [],
  ask: null,
  notNow: false,
  healthEmpty: false,
  date: null,
  today: null,
  reading: false,
};
let state: StepsState = EMPTY;
const listeners = new Set<() => void>();

function setState(patch: Partial<StepsState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export function getStepsState(): StepsState {
  return state;
}

export function subscribeStepsState(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A permission answer arrived (the prompt / Settings): show it now, before the follow-up read finishes. */
export function publishStepsAccess(userId: string, access: StepsAccess) {
  if (state.userId === userId) setState({ access });
}

/* ───────────────────────────── Refresh ───────────────────────────── */

export interface RefreshOptions {
  reason: RefreshReason;
  /** A save went through — update the app's caches. */
  onSaved?: (date: string, tracking: TrackingDay) => void;
  /** A real read of a day's count on the server (before a save) — Today's number can follow it. */
  onServerSteps?: (date: string, steps: number) => void;
}

/** Reads closer together than this are skipped (Today's timer, focus and the app returning can coincide). */
const MIN_READ_GAP_MS = 5_000;
const SAVE_TIMEOUT_MS = 20_000;
const SERVER_READ_TIMEOUT_MS = 15_000;
/** Time bounds of the reader calls: one hung native / health call must never wedge every later refresh. */
export const ACCESS_TIMEOUT_MS = 6_000;
const PREPARE_TIMEOUT_MS = 6_000;
const READ_TIMEOUT_MS = 20_000;

/** Bumped on sign-out: runs in flight finish without publishing or saving anything. */
let epoch = 0;
/** The time zone this JS session last flagged the Recording API's re-subscription for (Android, once per session). */
let preparedFor: string | null = null;
/** The member every source was switched off for in this JS session (their gate closed): done once, not every read. */
let switchedOff: string | null = null;
let lastReadAt = 0;
/** When pending past days were last read (they are re-read every 30 min at most, see plan.shouldReadPast). */
let lastPastRead: { at: number; today: string } | null = null;
let reading: Promise<void> | null = null;
let queued: { member: StepsMember; opts: RefreshOptions } | null = null;

/** Read + publish (single-flight). Resolves when the run in flight — or this one — has published; saves go on after. */
export function refreshSteps(member: StepsMember, opts: RefreshOptions): Promise<void> {
  if (reading) {
    queued = { member, opts: { ...opts, reason: mergeReason(queued?.opts.reason, opts.reason) } };
    return reading;
  }
  const run = (async () => {
    try {
      await readAndPublish(member, opts);
    } catch {
      // Reader calls never throw and are bounded; this only guards the unexpected (the next refresh tries again).
    } finally {
      reading = null;
      const next = queued;
      queued = null;
      if (next) void refreshSteps(next.member, next.opts);
    }
  })();
  reading = run;
  return run;
}

async function readAndPublish(member: StepsMember, opts: RefreshOptions) {
  const myEpoch = epoch;
  const stale = () => myEpoch !== epoch;
  const now = Date.now();
  const sameMember = state.userId === member.id;
  if (sameMember && opts.reason !== 'permission' && now - lastReadAt < MIN_READ_GAP_MS) return;
  lastReadAt = now;

  const tz = safeTimeZone(member.timeZone);
  const today = utcToZoned(new Date(now), tz).date;
  const background = opts.reason === 'background';
  const notNow = notNowActive(getStepsConsent(member.id), now);
  setState(sameMember ? { reading: true, notNow } : { ...EMPTY, userId: member.id, notNow, reading: true });

  let job: SaveJob | null = null;
  try {
    const fresh = await within(stepsReader.access(), ACCESS_TIMEOUT_MS);
    if (stale()) return;
    if (fresh) setState({ access: fresh });
    // The access check timed out: the last one known (the gate then reads today only).
    const access = fresh ?? (sameMember ? state.access : null);
    const gate = stepsGate(stepsConsents(), member.id, access);
    if (!gate) {
      // P8 / P9: nothing is read or saved for this member — and nothing keeps counting for them on this phone.
      setState({ consent: null, on: [], ask: stepsAsk(access, null), healthEmpty: false, date: today, today: null });
      await switchOff(member.id, tz);
      return;
    }
    switchedOff = null;
    setState({ consent: gate.consent, on: gate.on, ask: stepsAsk(access, gate) });
    if (preparedFor !== tz) {
      // Once per JS session (and zone): Android subscribes to the Recording API again at the next read.
      await within(stepsReader.prepare(tz), PREPARE_TIMEOUT_MS);
      if (stale()) return;
      preparedFor = tz;
    }
    const recordOf = (date: string) => getDayRecord(member.id, date);
    const past = shouldReadPast(opts.reason, today, now, lastPastRead)
      ? pendingPastDays(today, recordOf, gate.maxBack, gate.coverFloor, tz, background ? BACKGROUND_PAST_DAYS : undefined)
      : [];
    if (past.length) lastPastRead = { at: now, today };
    const dates = [today, ...past];
    const read = await within(
      stepsReader.readDays(dates, { timeZone: tz, consent: gate.consent, coverFloor: gate.coverFloor, sinceAt: sinceAtOf(dates, recordOf), background }),
      READ_TIMEOUT_MS
    );
    if (stale()) return;
    // Switched off, or a kind withdrawn (Health disconnected), while this read ran: none of it is published or saved.
    const consentNow = readConsent(getStepsConsent(member.id));
    if (!stillAllowed(gate.consent, consentNow)) {
      setState({ today: null, healthEmpty: false });
      if (!consentNow) {
        // The read's own source decision may have come after the switch's: switch off once more.
        switchedOff = null;
        await switchOff(member.id, tz);
      }
      return;
    }
    if (read) {
      for (const r of read) rememberReading(member.id, r);
      const r = read.find((d) => d.date === today);
      setState({
        date: today,
        today: r && autoCount(r, true) ? { date: today, at: Date.now(), day: r } : null,
        healthEmpty: appleHealthEmpty(member.id, today, gate, access),
      });
      if (read.length) {
        job = { userId: member.id, epoch: myEpoch, consent: gate.consent, today, tz, days: read, storeOn: gate.storeOn, onSaved: opts.onSaved, onServerSteps: opts.onServerSteps };
      }
    } else if (state.date !== today) {
      // The read timed out: keep the last reading unless the day changed.
      setState({ date: today, today: null });
    }
  } finally {
    if (!stale()) setState({ reading: false });
  }

  if (job && getSessionToken() && !stale()) queueSave(job);
}

/**
 * The member's gate is closed (no consent, the switch off): every source this phone runs is switched off for them —
 * Android: the Recording API unsubscribed, the sampler stopped; iPhone: Apple Health's background delivery cleared.
 * Once per member and JS session (the readers then keep it so: nothing is turned on without a consent).
 */
async function switchOff(userId: string, tz: string) {
  preparedFor = null;
  if (switchedOff === userId) return;
  const done = await within(
    stepsReader.prepare(tz, { consent: NO_CONSENT }).then(() => true),
    PREPARE_TIMEOUT_MS
  );
  if (done) switchedOff = userId;
}

/**
 * §2.2: Apple Health has no steps for today and the 7 days before (iPhone, while it is ON for the member) — by the
 * latest reading of each day in this app run, else by its record (a final day noted without a store count).
 */
function appleHealthEmpty(userId: string, today: string, gate: StepsGate, access: StepsAccess | null): boolean {
  if (access?.features?.platform !== 'ios' || !gate.on.includes('store')) return false;
  const days: DayReading[] = [];
  for (let i = 0; i <= HEALTH_EMPTY_DAYS; i++) {
    const r = latestReading(userId, addDays(today, -i));
    if (r) days.push(r);
  }
  return healthEmpty(today, days, (date) => getDayRecord(userId, date));
}

/* ───────────────────────────── The switch (P9) ───────────────────────────── */

/**
 * "Count steps automatically" (Settings › Privacy & data, the Health screen). Off: nothing is read or saved for the
 * member from now on, and every source this phone runs for them stops (the Recording API unsubscribed, the sampler
 * stopped, Apple Health's background delivery cleared); steps already saved stay. On: the member's consents count again
 * (none yet: Today asks, §2.2 — no longer folded by an earlier "Not now"). The caller then refreshes (`refreshSteps`,
 * reason `permission`) so Today follows at once. Never throws.
 */
export async function setAutoSteps(userId: string, on: boolean): Promise<void> {
  const c = getStepsConsent(userId);
  if (!!c?.off !== !on) updateStepsConsent(userId, { off: on ? undefined : { at: Date.now() } });
  switchedOff = null;
  preparedFor = null;
  lastPastRead = null;
  if (on) {
    unfold(userId);
    return;
  }
  if (nextSave?.userId === userId) nextSave = null;
  if (state.userId === userId) setState({ consent: null, on: [], today: null, healthEmpty: false, ask: stepsAsk(state.access, null) });
  await switchOff(userId, foregroundMember?.id === userId ? foregroundMember.timeZone : 'UTC');
}

/* ───────────────────────────── The member's answers (R6) ───────────────────────────── */

/** "Not now" no longer folds Today's ask (the member agreed, or switched counting on). */
function unfold(userId: string) {
  if (getStepsConsent(userId)?.notNowUntil != null) updateStepsConsent(userId, { notNowUntil: undefined });
  if (state.userId === userId && state.notNow) setState({ notNow: false });
}

/**
 * `userId` agreed to ÖRZA reading `kind` for them (P8): Today's disclosure ("Continue" and the system prompt granted,
 * or "Turn on" when the permission was already there), the Health screen's connect (the store). Recorded per member on
 * this install (`plan.grantConsent`: a shared phone reads only from now on, M9); "Not now" no longer folds the ask; the
 * kind's history is read at the next run. `switchOn`: "Count steps automatically" goes back on too — Today's flows, where
 * the member asked to count; the Health screen's connect leaves the switch as the member set it. The caller then
 * refreshes (reason `permission`). Never throws.
 */
export async function agreeToSteps(userId: string, kind: keyof ReadConsent, opts: { switchOn?: boolean } = {}): Promise<void> {
  grantStepsConsent(userId, kind);
  unfold(userId);
  lastPastRead = null;
  if (opts.switchOn) await setAutoSteps(userId, true);
}

/**
 * `userId` withdrew `kind` (the Health screen's Disconnect: the store, P9): nothing of it is read or saved for them from
 * now on — a read in flight is dropped and a save job stops before its next day (`plan.stillAllowed`), and today's
 * published reading goes at once. The next read (the caller refreshes, reason `permission`) publishes what still counts
 * and switches the kind's sources off (iPhone: Apple Health's background delivery; with no consent left, every source).
 * The switch and the member's other consent stay. Never throws.
 */
export function withdrawSteps(userId: string, kind: keyof ReadConsent) {
  withdrawStepsConsent(userId, kind);
  lastPastRead = null;
  if (nextSave?.userId === userId && nextSave.consent[kind]) nextSave = null;
  if (state.userId === userId && state.consent?.[kind]) setState({ today: null, healthEmpty: false });
}

/**
 * P19: "Not now — I'll log steps" — Today's ask stays folded for 30 days for `userId` (the switch and the Health screen
 * keep the way back).
 */
export function foldStepsAsk(userId: string, now = Date.now()) {
  updateStepsConsent(userId, { notNowUntil: now + NOT_NOW_MS });
  if (state.userId === userId) setState({ notNow: true });
}

/* ───────────────────────────── Save queue ───────────────────────────── */

interface SaveJob {
  userId: string;
  epoch: number;
  /** The consent the days were read under: the job stops before a day once it no longer holds (`plan.stillAllowed`). */
  consent: ReadConsent;
  /** The member's today when the days were read. */
  today: string;
  /** The profile time zone the days were read in (kept on each saved day's record, M8). */
  tz: string;
  days: DayReading[];
  /** A health store is ON for the member (its past days settle 72 h after they end, M7). */
  storeOn: boolean;
  onSaved?: (date: string, tracking: TrackingDay) => void;
  onServerSteps?: (date: string, steps: number) => void;
}

let saving: Promise<void> | null = null;
let nextSave: SaveJob | null = null;

const sameConsent = (a: ReadConsent, b: ReadConsent) => a.store === b.store && a.phone === b.phone;

function queueSave(job: SaveJob) {
  if (saving) {
    const n = nextSave;
    // Days read under another consent never ride along (a kind withdrawn meanwhile); a store seen ON by either keeps
    // past days from settling early.
    const same = !!n && n.userId === job.userId && n.epoch === job.epoch && sameConsent(n.consent, job.consent);
    nextSave = same && n ? { ...job, days: mergeDays(n.days, job.days), storeOn: job.storeOn || n.storeOn } : job;
    return;
  }
  saving = (async () => {
    try {
      await runSave(job);
    } catch {
      // Network / storage trouble: the next refresh tries again.
    } finally {
      saving = null;
      const next = nextSave;
      nextSave = null;
      if (next) queueSave(next);
    }
  })();
}

/** Resolves when no read or save is running or waiting (or after `ms`). For the background task. */
export async function stepSavesSettled(ms: number): Promise<void> {
  const until = Date.now() + ms;
  while ((reading || saving || nextSave) && Date.now() < until) {
    await within(reading ?? saving ?? Promise.resolve(), Math.max(1, until - Date.now()));
  }
}

/* ───────────────────────────── Latest readings ───────────────────────────── */

/**
 * The latest reading of each day read in this app run (per member): the member's own number for a day becomes an edit
 * when something was counting it (M5c1, `save.applyManualSteps`); Apple Health's "no steps" looks back at them. Memory
 * only; cleared at sign-out.
 */
const readings = new Map<string, DayReading>();
const READINGS_KEPT = 64;

function rememberReading(userId: string, reading: DayReading) {
  const k = `${userId}|${reading.date}`;
  readings.delete(k);
  readings.set(k, reading);
  if (readings.size > READINGS_KEPT) {
    const oldest = readings.keys().next().value;
    if (oldest !== undefined) readings.delete(oldest);
  }
}

function latestReading(userId: string, date: string): DayReading | null {
  return readings.get(`${userId}|${date}`) ?? null;
}

/** The day the automatic queue is saving right now (a manual save waits for it, see `saveManualSteps`). */
let dayInFlight: Promise<unknown> | null = null;
/** A manual save (Edit / Log sheet) in progress: the automatic queue waits for it between days. */
let manualInFlight: Promise<unknown> | null = null;
/** How long a manual save waits for the automatic one in flight (it is time-bounded itself). */
const MANUAL_WAIT_MS = 25_000;

async function runSave(job: SaveJob) {
  const signedOut = () => job.epoch !== epoch;
  const deps = depsUntil(signedOut);
  const hold = holdAppleHealth ? countsAppleHealth : undefined;
  // Today first (what the member is looking at), then past days newest first.
  const days = [...job.days].sort((a, b) => (a.date === job.today ? -1 : b.date === job.today ? 1 : b.date.localeCompare(a.date)));
  for (const day of days) {
    if (manualInFlight) await within(manualInFlight, MANUAL_WAIT_MS + SAVE_TIMEOUT_MS);
    // Signed out, switched off, or a kind withdrawn since the read: nothing more is saved.
    if (signedOut() || !stillAllowed(job.consent, readConsent(getStepsConsent(job.userId)))) return;
    const isToday = day.date === job.today;
    // The save, then (a past day) final when settled — `syncDay` writes that to the day's record.
    const run = syncDay(deps, job.userId, day, isToday, job.storeOn, {
      tz: job.tz,
      onSaved: job.onSaved,
      onServerSteps: job.onServerSteps,
      stale: signedOut,
      hold,
    });
    dayInFlight = run;
    try {
      await run;
    } finally {
      if (dayInFlight === run) dayInFlight = null;
    }
  }
}

/* ───────────────────────────── Saving one day ───────────────────────────── */

/** A 4xx other than auth / rate limit / timeout won't succeed on a retry (e.g. a day the server sees as the future). */
const permanent = (e: unknown) => e instanceof ApiError && e.status >= 400 && e.status < 500 && ![401, 408, 429].includes(e.status);

/** The real store + API behind `save.ts`. */
const saveDeps: SaveDeps = {
  getRecord: getDayRecord,
  updateRecord: updateDayRecord,
  lastAutoSave,
  noteAutoSave,
  async fetchServerDay(date) {
    const d = await api.get<TodayData>(`/dashboard/today?date=${encodeURIComponent(date)}`, { timeoutMs: SERVER_READ_TIMEOUT_MS });
    if (d?.date !== date) return null;
    const steps = typeof d.tracking?.steps === 'number' ? d.tracking.steps : 0;
    // The edit marker comes with the modes (backend B2), with the row's last write; the old server's rows have none.
    const marker = markerOf(d.tracking);
    return marker === undefined ? { steps } : { steps, marker, ...markerRowOf(d.tracking) };
  },
  async postSteps(date, steps, mode, editRef, expect) {
    const body = { steps, date, mode, edit_ref: editRef, ...(expect != null ? { expect } : {}) };
    const res = await api.post<StepsAnswer>('/track/steps', body, { timeoutMs: SAVE_TIMEOUT_MS });
    if (!res?.tracking) throw new Error('The step save answered without the day');
    return res;
  },
  isPermanent: permanent,
  now: () => Date.now(),
};

/**
 * `saveDeps` whose writes to this phone's memory stop once `ended()` (the member signed out): a save still in flight
 * then never writes a day record back after sign-out deleted them (P16), nor the prefs' last-save time.
 */
function depsUntil(ended: () => boolean): SaveDeps {
  return {
    ...saveDeps,
    updateRecord: (userId, date, patch) => {
      if (!ended()) updateDayRecord(userId, date, patch);
    },
    noteAutoSave: (userId, at) => {
      if (!ended()) noteAutoSave(userId, at);
    },
  };
}

/**
 * What is known of `date` for a manual save with no reading of it at hand (M5c1): its end in the member's zone (the
 * member the app runs for), and whether something counts the member's steps here — a source ON for them (their consent,
 * the permission, the hardware: `plan.stepsGate`).
 */
function manualDayInfo(userId: string, date: string): { end: number | null; counting: boolean } {
  const member = foregroundMember?.id === userId ? foregroundMember : null;
  const mine = state.userId === userId;
  return { end: member ? dayBounds(date, member.timeZone).end : null, counting: mine && !!state.consent && state.on.length > 0 };
}

/**
 * The member's own number for a day (the Edit / Log sheet): `POST /api/track/steps` in `manual` mode, then the day's
 * base with the server's edit marker (`save.saveManualDay`: an edit when something was counting the day, by its latest
 * reading — or, with none at hand yet, by `manualDayInfo`; else a start). Serialised with the automatic queue: it
 * first waits (bounded) for an automatic save in flight, and the queue waits for it before its next day — on the old
 * server (no modes) an automatic save landing after the member's number would undo it.
 */
export function saveManualSteps(userId: string, date: string, steps: number): Promise<{ tracking: TrackingDay }> {
  const myEpoch = epoch;
  const run = (async () => {
    if (dayInFlight) await within(dayInFlight, MANUAL_WAIT_MS);
    const deps = depsUntil(() => myEpoch !== epoch);
    const { tracking } = await saveManualDay(deps, userId, date, steps, latestReading(userId, date), manualDayInfo(userId, date));
    return { tracking };
  })();
  const held = run.then(
    () => undefined,
    () => undefined
  );
  manualInFlight = held;
  void held.then(() => {
    if (manualInFlight === held) manualInFlight = null;
  });
  return run;
}

/* ───────────────────────────── Background ───────────────────────────── */

/** The member's profile is fetched again for a headless run at most this often (M8). */
const SNAPSHOT_FRESH_MS = 15 * 60_000;
/** `GET /api/auth/me` for a headless run: short — Apple Health's wake-up gives ÖRZA about 25 s. */
const ME_TIMEOUT_MS = 8_000;
/** When a headless run last had the member's profile from the server (memory: a new process fetches it again). */
let snapshotAt = 0;

/**
 * M8: the member as the server has them now (`GET /api/auth/me`, best effort, at most every 15 min) — the profile's time
 * zone decides which local days are read, and a past day saved under another zone is frozen. Written back to the
 * Keychain snapshot (unless the phone signed out or into another account meanwhile). Null: the snapshot as it is
 * (offline, slow, throttled); `signed-out`: the server ended the session (401) — nothing to save for anyone.
 */
async function refreshedMember(user: PublicUser, token: string): Promise<PublicUser | null | 'signed-out'> {
  if (Date.now() - snapshotAt < SNAPSHOT_FRESH_MS) return null;
  try {
    const { user: me } = await api.get<{ user: PublicUser }>('/auth/me', { timeoutMs: ME_TIMEOUT_MS });
    if (getSessionToken() !== token || me?.id !== user.id) return null;
    snapshotAt = Date.now();
    const kept = await readSecureJson<PublicUser>(KEYS.user);
    if (getSessionToken() === token && kept?.id === me.id) await writeSecureJson(KEYS.user, userSnapshot(me));
    return me;
  } catch (e) {
    return e instanceof ApiError && e.status === 401 ? 'signed-out' : null;
  }
}

/** The signed-in member: the app's own (UI running), or — headless — the Keychain session + a refreshed snapshot. */
async function resolveMember(): Promise<StepsMember | null> {
  if (foregroundMember) return getSessionToken() ? foregroundMember : null;
  let token = getSessionToken();
  if (!token) {
    // A running app without a session is signed out; only a headless run reads the Keychain.
    if (AppState.currentState === 'active') return null;
    const stored = await readSecure(KEYS.token);
    if (!stored) return null;
    if (!getSessionToken()) setSessionToken(stored);
    token = getSessionToken();
    if (!token) return null;
  }
  const user = await readSecureJson<PublicUser>(KEYS.user);
  if (!user?.id || user.is_admin) return null;
  const fresh = await refreshedMember(user, token);
  if (fresh === 'signed-out') return null;
  const me = fresh ?? user;
  return me.is_admin ? null : stepsMemberOf(me);
}

/**
 * From the periodic background task and Apple Health's background delivery: read and save without UI. Never throws;
 * true when it ran.
 */
export async function syncStepsInBackground(): Promise<boolean> {
  try {
    const member = await resolveMember();
    if (!member) return false;
    await refreshSteps(member, { reason: 'background' });
    await stepSavesSettled(60_000);
    return true;
  } catch {
    return false;
  }
}

/** `p`, or undefined after `ms` (or when it rejects). */
export function within<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(undefined), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(undefined);
      }
    );
  });
}

/* ───────────────────────────── Sign-out ───────────────────────────── */

/**
 * Sign-out of `userId` (null: whoever this module last read for). Nothing in flight publishes or saves any more, and
 * nothing it still does writes to this phone's memory (`depsUntil`); the member's day records are deleted (P16) — the
 * prefs keep their consent, so the same member signing in again isn't asked again (and their last automatic save's
 * time, M5c3). A run that is setting sources up gets a moment to finish (so it can't switch them back on), then every
 * source stops: the Recording API unsubscribed (the next member can't read this one's walking), the sampler stopped and
 * its samples forgotten, Apple Health's background delivery cleared. `accountDeleted`: the consent record and the last
 * save's time go too (the install keeps `formerConsent`, M9). Never throws.
 */
export async function clearStepsOnSignOut(userId?: string | null, opts: { accountDeleted?: boolean } = {}): Promise<void> {
  const id = userId ?? state.userId ?? foregroundMember?.id ?? null;
  epoch += 1;
  foregroundMember = null;
  preparedFor = null;
  switchedOff = null;
  snapshotAt = 0;
  lastReadAt = 0;
  lastPastRead = null;
  queued = null;
  nextSave = null;
  forgetServerObservations();
  readings.clear();
  setState(EMPTY);
  if (id) {
    try {
      deleteUserDays(id);
      if (opts.accountDeleted) removeStepsConsent(id);
    } catch {
      // storage trouble: the cache file holds them until the system purges it
    }
  }
  if (reading) await within(reading, 4_000);
  await within(stepsReader.reset(), 3_000);
}
