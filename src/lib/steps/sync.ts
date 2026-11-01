/**
 * Automatic steps — read, publish, save. No UI imports: it also runs headless from the background task.
 *
 *   access → (Android) arm the sampler → read today (+ past days whose final count isn't saved yet) → publish today's
 *   reading to Today → (own queue, never awaited by the UI) save each day through `POST /api/track/steps` per `policy.ts`
 *
 * - `refreshSteps(member, opts)`: the read + publish is single-flight; a call during a run queues one follow-up run that
 *   keeps the most important reason (`plan.mergeReason`). Every native / health call is time-bounded.
 * - Saving runs on its own queue (the newest readings win, pending past days are kept): a slow network never holds up
 *   Today or the permission flow.
 * - Saving one day is `save.ts` (I/O injected, tested): `POST /api/track/steps` in the server's modes (`auto` raises
 *   only, `reconcile` corrects this phone's own earlier save of a past day, `manual` is the member's number and sets
 *   the day's edit marker). The member's edit (website / another phone: a marker this phone hasn't taken) becomes the
 *   day's base, anchored at its instant, and what the sources count after it adds on top (`merge.dayValue`,
 *   `policy.savePlan`); the Edit sheet on the phone does the same (`saveManualSteps`). Until the server answers with
 *   the modes (the old production server), each save READS the server's count first and never lowers it, and a real
 *   read lower than this phone's last save is the edit.
 * - Past days: up to 7 back, until settled (`plan.isFinal`, M7: 72 h after the day while a health store is connected,
 *   else an hour after it once a phone count read it whole) and saved — then final (`save.syncDay`: not on a run that
 *   failed or took an edit whose steps since aren't saved yet).
 * - `syncStepsInBackground()`: the same from the alarm background task (`lib/alarms/background.ts`) — the session and
 *   member snapshot then come from the Keychain, and Android reads stored samples only (no live sensor read).
 * - `clearStepsOnSignOut()`: stops the Android sampler and forgets its samples.
 */
import { AppState } from 'react-native';

import type { TodayData, TrackingDay } from '@/features/today/types';
import { api, ApiError, getSessionToken, setSessionToken } from '@/lib/api';
import { KEYS, readSecure, readSecureJson } from '@/lib/secure';
import type { PublicUser } from '@/lib/types';

import { safeTimeZone, utcToZoned } from '../alarms/schedule';
import { getHealthRecord } from '../health/store';

import { BACKGROUND_PAST_DAYS, mergeDays, mergeReason, pendingPastDays, shouldReadPast } from './plan';
import { stepsReader } from './reader';
import { saveManualDay, syncDay, type SaveDeps, type StepsAnswer } from './save';
import { forgetServerObservations, markerOf, markerRowOf } from './serverSeen';
import { dayBounds, legacyDaySteps } from './shared';
import { getDayRecord, lastAutoSave, noteAutoSave, updateDayRecord } from './store';
import type { DayReading, DaySteps, RefreshReason, StepsAccess } from './types';

export type { RefreshReason } from './types';

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

export interface StepsState {
  /** Whose numbers these are (null before the first read / after sign-out). */
  userId: string | null;
  /** The phone counter's availability + permission (null until checked). */
  access: StepsAccess | null;
  /** The member connected Apple Health / Health Connect in ÖRZA (its steps count too). */
  healthConnected: boolean;
  /** The member's today (YYYY-MM-DD) at the last read. */
  date: string | null;
  /**
   * The last automatic reading for `date` (the winning source's, plus every source's: `day`), null when no automatic
   * source could read it.
   */
  today: (DaySteps & { at: number; day: DayReading }) | null;
  /** A read is running. */
  reading: boolean;
}

const EMPTY: StepsState = { userId: null, access: null, healthConnected: false, date: null, today: null, reading: false };
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
/** Past days read back (the old 7: CMPedometer's history) until R5a reads `plan.lookbackDays(plan.sourcesOn(…))`. */
const PAST_DAYS = 7;

/** Bumped on sign-out: runs in flight finish without publishing or saving anything. */
let epoch = 0;
/** The time zone the Android sampler was last started with in this JS session. */
let preparedFor: string | null = null;
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
  const healthConnected = getHealthRecord(member.id).connected;
  setState(sameMember ? { reading: true, healthConnected } : { ...EMPTY, userId: member.id, healthConnected, reading: true });

  let days: DayReading[] = [];
  try {
    const access = await within(stepsReader.access(), ACCESS_TIMEOUT_MS);
    if (stale()) return;
    if (access) setState({ access });
    if (access?.phonePermission === 'granted' && preparedFor !== tz) {
      await within(stepsReader.prepare(tz), PREPARE_TIMEOUT_MS);
      if (stale()) {
        // Signed out while the sampler was starting: undo it (unless someone already signed in again).
        if (!foregroundMember) void within(stepsReader.reset(), 3_000);
        return;
      }
      preparedFor = tz;
    }
    const past = shouldReadPast(opts.reason, today, now, lastPastRead)
      ? pendingPastDays(today, (d) => getDayRecord(member.id, d), PAST_DAYS, null, tz, opts.reason === 'background' ? BACKGROUND_PAST_DAYS : undefined)
      : [];
    if (past.length) lastPastRead = { at: now, today };
    const read = await within(
      stepsReader.readDays([today, ...past], { timeZone: tz, healthConnected, background: opts.reason === 'background' }),
      READ_TIMEOUT_MS
    );
    if (stale()) return;
    if (read) {
      days = read;
      for (const r of read) rememberReading(member.id, r);
      // Today's winner in the shape Today's card still takes (until U1), with the whole reading for the day's number.
      const r = read.find((d) => d.date === today);
      const t = r ? legacyDaySteps(r, true) : null;
      setState({ date: today, today: r && t ? { ...t, at: Date.now(), day: r } : null });
    } else if (state.date !== today) {
      // The read timed out: keep the last reading unless the day changed.
      setState({ date: today, today: null });
    }
  } finally {
    if (!stale()) setState({ reading: false });
  }

  if (!getSessionToken() || stale() || !days.length) return;
  queueSave({ userId: member.id, epoch: myEpoch, today, tz, days, storeOn: healthConnected, onSaved: opts.onSaved, onServerSteps: opts.onServerSteps });
}

/* ───────────────────────────── Save queue ───────────────────────────── */

interface SaveJob {
  userId: string;
  epoch: number;
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

function queueSave(job: SaveJob) {
  if (saving) {
    const same = nextSave && nextSave.userId === job.userId && nextSave.epoch === job.epoch;
    nextSave = same && nextSave ? { ...job, days: mergeDays(nextSave.days, job.days) } : job;
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
 * when something was counting it (M5c1, `save.applyManualSteps`). Memory only; cleared at sign-out.
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
  const stale = () => job.epoch !== epoch;
  // Today first (what the member is looking at), then past days newest first.
  const days = [...job.days].sort((a, b) => (a.date === job.today ? -1 : b.date === job.today ? 1 : b.date.localeCompare(a.date)));
  for (const day of days) {
    if (manualInFlight) await within(manualInFlight, MANUAL_WAIT_MS + SAVE_TIMEOUT_MS);
    if (stale()) return;
    const isToday = day.date === job.today;
    // The save, then (a past day) final when settled — `syncDay` writes that to the day's record.
    const run = syncDay(saveDeps, job.userId, day, isToday, job.storeOn, { tz: job.tz, onSaved: job.onSaved, onServerSteps: job.onServerSteps, stale });
    dayInFlight = run;
    try {
      await run;
    } finally {
      if (dayInFlight === run) dayInFlight = null;
    }
    if (stale()) return;
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
 * What is known of `date` for a manual save with no reading of it at hand (M5c1): its end in the member's zone (the
 * member the app runs for), and whether something counts the member's steps here — a health store connected, or the
 * phone's counter allowed (Today's card offers Edit on the same grounds).
 */
function manualDayInfo(userId: string, date: string): { end: number | null; counting: boolean } {
  const member = foregroundMember?.id === userId ? foregroundMember : null;
  const mine = state.userId === userId;
  const phone = !!state.access?.phoneAvailable && state.access.phonePermission === 'granted';
  return { end: member ? dayBounds(date, member.timeZone).end : null, counting: mine && (state.healthConnected || phone) };
}

/**
 * The member's own number for a day (the Edit / Log sheet): `POST /api/track/steps` in `manual` mode, then the day's
 * base with the server's edit marker (`save.saveManualDay`: an edit when something was counting the day, by its latest
 * reading — or, with none at hand yet, by `manualDayInfo`; else a start). Serialised with the automatic queue: it
 * first waits (bounded) for an automatic save in flight, and the queue waits for it before its next day — on the old
 * server (no modes) an automatic save landing after the member's number would undo it.
 */
export function saveManualSteps(userId: string, date: string, steps: number): Promise<{ tracking: TrackingDay }> {
  const run = (async () => {
    if (dayInFlight) await within(dayInFlight, MANUAL_WAIT_MS);
    const { tracking } = await saveManualDay(saveDeps, userId, date, steps, latestReading(userId, date), manualDayInfo(userId, date));
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

/* ───────────────────────────── Background / sign-out ───────────────────────────── */

/** The signed-in member: the app's own (UI running), or — headless — the Keychain session + snapshot. */
async function resolveMember(): Promise<StepsMember | null> {
  if (foregroundMember) return getSessionToken() ? foregroundMember : null;
  if (!getSessionToken()) {
    // A running app without a session is signed out; only a headless run reads the Keychain.
    if (AppState.currentState === 'active') return null;
    const token = await readSecure(KEYS.token);
    if (!token) return null;
    if (!getSessionToken()) setSessionToken(token);
  }
  const user = await readSecureJson<PublicUser>(KEYS.user);
  if (!user?.id || user.is_admin) return null;
  return stepsMemberOf(user);
}

/** From the periodic background task: read and save without UI. Never throws; true when it ran. */
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

/**
 * Sign-out: nothing in flight publishes or saves; a run that is starting the sampler gets a moment to finish (so it
 * can't switch it back on afterwards), then the Android sampler stops and forgets its samples. Never throws.
 */
export async function clearStepsOnSignOut(): Promise<void> {
  epoch += 1;
  foregroundMember = null;
  preparedFor = null;
  lastReadAt = 0;
  lastPastRead = null;
  queued = null;
  nextSave = null;
  forgetServerObservations();
  readings.clear();
  setState(EMPTY);
  if (reading) await within(reading, 4_000);
  await within(stepsReader.reset(), 3_000);
}
