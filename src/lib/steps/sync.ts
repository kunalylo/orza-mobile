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
 * - Before each save the phone READS the server's current count (one GET per save; saves are throttled) and never
 *   lowers it. A real read lower than this phone's last save is the member's edit (website / another phone): it becomes
 *   the day's base and steps counted after it add on top (`policy.ts`); the Edit sheet on the phone does the same
 *   (`recordManualSteps`). Remaining race: a count saved elsewhere between that GET and the POST (about a second).
 * - Past days: up to 7 back, until a source read the whole day (`complete`) and its count is saved — then final.
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

import { mergeDays, mergeReason, pendingPastDays, shouldReadPast } from './plan';
import {
  clampSteps,
  editBase,
  editedOnServer,
  knownFloor,
  needsStartBase,
  postTarget,
  rebased,
  serverAllows,
  shouldPost,
  startBase,
  withBase,
  type AutoCount,
  type DayRecord,
} from './policy';
import { stepsReader } from './reader';
import { forgetServerObservations, observeServerSteps, serverObservation } from './serverSeen';
import { getDayRecord, markDayFinal, noteServerSteps, updateDayRecord } from './store';
import type { DaySteps, RefreshReason, StepsAccess } from './types';

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
  /** The last automatic reading for `date`, null when no automatic source could read it. */
  today: (DaySteps & { at: number }) | null;
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

  let days: DaySteps[] = [];
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
    const past = shouldReadPast(opts.reason, today, now, lastPastRead) ? pendingPastDays(today, (d) => !!getDayRecord(member.id, d)?.final) : [];
    if (past.length) lastPastRead = { at: now, today };
    const read = await within(
      stepsReader.readDays([today, ...past], { timeZone: tz, healthConnected, background: opts.reason === 'background' }),
      READ_TIMEOUT_MS
    );
    if (stale()) return;
    if (read) {
      days = read;
      const t = days.find((d) => d.date === today);
      setState({ date: today, today: t ? { ...t, at: Date.now() } : null });
    } else if (state.date !== today) {
      // The read timed out: keep the last reading unless the day changed.
      setState({ date: today, today: null });
    }
  } finally {
    if (!stale()) setState({ reading: false });
  }

  if (!getSessionToken() || stale() || !days.length) return;
  queueSave({ userId: member.id, epoch: myEpoch, today, days, onSaved: opts.onSaved });
}

/* ───────────────────────────── Save queue ───────────────────────────── */

interface SaveJob {
  userId: string;
  epoch: number;
  /** The member's today when the days were read. */
  today: string;
  days: DaySteps[];
  onSaved?: (date: string, tracking: TrackingDay) => void;
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

async function runSave(job: SaveJob) {
  const stale = () => job.epoch !== epoch;
  // Today first (what the member is looking at), then past days newest first.
  const days = [...job.days].sort((a, b) => (a.date === job.today ? -1 : b.date === job.today ? 1 : b.date.localeCompare(a.date)));
  for (const day of days) {
    if (stale()) return;
    const isToday = day.date === job.today;
    const ok = await saveDay(job.userId, day, isToday, job.onSaved, stale);
    if (stale()) return;
    if (!isToday && ok && day.complete) markDayFinal(job.userId, day.date);
  }
}

/* ───────────────────────────── Saving one day ───────────────────────────── */

/** The day's count on the server right now (`GET /dashboard/today?date=`), null when it answered for another day. */
async function fetchServerSteps(date: string): Promise<number | null> {
  const d = await api.get<TodayData>(`/dashboard/today?date=${encodeURIComponent(date)}`, { timeoutMs: SERVER_READ_TIMEOUT_MS });
  if (d?.date !== date) return null;
  return typeof d.tracking?.steps === 'number' ? d.tracking.steps : 0;
}

/** A 4xx other than auth / rate limit / timeout won't succeed on a retry (e.g. a day the server sees as the future). */
const permanent = (e: unknown) => e instanceof ApiError && e.status >= 400 && e.status < 500 && ![401, 408, 429].includes(e.status);

type ServerRead = { ok: true; steps: number | null } | { ok: false; retry: boolean };

/** A real read of the day's server count, remembered as an observation (`serverSeen`) and on the day's record. */
async function readServer(userId: string, date: string): Promise<ServerRead> {
  const requestedAt = Date.now();
  try {
    const steps = await fetchServerSteps(date);
    if (steps != null) {
      observeServerSteps(userId, date, steps, requestedAt);
      noteServerSteps(userId, date, steps);
    }
    return { ok: true, steps };
  } catch (e) {
    return { ok: false, retry: !permanent(e) };
  }
}

/** Accept the member's edit to `steps` (seen on the server, or made on this phone) as the day's base. */
function acceptEdit(userId: string, date: string, steps: number, auto: AutoCount | null): DayRecord | undefined {
  const now = Date.now();
  const n = clampSteps(steps);
  updateDayRecord(userId, date, { base: editBase(n, auto, now), sent: n, sentAt: now, sentSource: 'edited', server: n, serverAt: now });
  return getDayRecord(userId, date);
}

/**
 * Saves `day` when the policy says so. False when it should be retried later (offline, server error) — a past day is
 * only marked final after a true.
 */
async function saveDay(
  userId: string,
  day: DaySteps,
  isToday: boolean,
  onSaved: SaveJob['onSaved'],
  stale: () => boolean
): Promise<boolean> {
  let rec = getDayRecord(userId, day.date);

  // A real server read made after this phone's last save shows a lower count: the member set the day themselves.
  const seen = serverObservation(userId, day.date);
  if (seen && editedOnServer(rec, seen)) rec = acceptEdit(userId, day.date, seen.steps, day);

  // This phone began counting partway through the day: carry on from what was already saved that day.
  if (needsStartBase(day, rec)) {
    const server = await readServer(userId, day.date);
    if (stale()) return true;
    if (!server.ok) return !server.retry;
    rec = getDayRecord(userId, day.date);
    if (!rec?.base) {
      updateDayRecord(userId, day.date, { base: startBase(day, rec, server.steps, Date.now()) });
      rec = getDayRecord(userId, day.date);
    }
  }

  // The best source changed under a base: re-anchor it on the new one.
  const moved = rebased(rec?.base, day, Date.now());
  if (moved) {
    updateDayRecord(userId, day.date, { base: moved });
    rec = getDayRecord(userId, day.date);
  }

  const target = postTarget(day, rec, isToday);
  if (target == null) return true;
  if (rec?.base && rec.base.last !== target) {
    updateDayRecord(userId, day.date, { base: { ...rec.base, last: target } });
    rec = getDayRecord(userId, day.date);
  }
  if (!shouldPost(target, rec, Date.now(), !isToday)) return true;

  // Never lower the server's count: read it right before saving (one GET per save; saves are throttled).
  const server = await readServer(userId, day.date);
  if (stale()) return true;
  if (!server.ok) return !server.retry;
  rec = getDayRecord(userId, day.date);
  const fresh = serverObservation(userId, day.date);
  if (fresh && editedOnServer(rec, fresh)) {
    acceptEdit(userId, day.date, fresh.steps, day);
    return true; // the next run saves from the member's number
  }
  if (!serverAllows(target, server.steps) || target <= knownFloor(rec)) return true;

  const steps = clampSteps(target);
  try {
    const res = await api.post<{ tracking: TrackingDay }>('/track/steps', { steps, date: day.date }, { timeoutMs: SAVE_TIMEOUT_MS });
    if (stale()) return true;
    const saved = typeof res?.tracking?.steps === 'number' ? res.tracking.steps : steps;
    const at = Date.now();
    const source = withBase(day, rec?.base)?.source ?? day.source;
    updateDayRecord(userId, day.date, { sent: saved, sentAt: at, sentSource: source, server: saved, serverAt: at });
    if (res?.tracking) onSaved?.(day.date, res.tracking);
    return true;
  } catch (e) {
    return permanent(e);
  }
}

/**
 * The member typed the day's steps on this phone (the Edit / Log sheet) and the server took `steps`. On a past day,
 * with a count running today, or lower than what the day already had, it becomes the day's base: the member's number,
 * plus steps counted after it today (lower than the automatic count too — a bus ride counted as walking). A count
 * typed today with nothing counting is a plain save (counting that starts later adds on top of it).
 */
export function recordManualSteps(userId: string, date: string, steps: number, today: string) {
  const live = state.userId === userId && state.date === date && state.today?.date === date ? state.today : null;
  const n = clampSteps(steps);
  const now = Date.now();
  observeServerSteps(userId, date, n, now);
  if (date !== today || live || n < knownFloor(getDayRecord(userId, date))) {
    acceptEdit(userId, date, n, live);
    return;
  }
  updateDayRecord(userId, date, { server: n, serverAt: now });
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
  setState(EMPTY);
  if (reading) await within(reading, 4_000);
  await within(stepsReader.reset(), 3_000);
}
