/**
 * Automatic steps — read, publish, save. No UI imports: it also runs headless from the background task.
 *
 *   access → (Android) arm the sampler → read today (+ yesterday and the day before, once per new day) →
 *   publish today's reading to Today → save each day through `POST /api/track/steps` per `policy.ts`
 *
 * - `refreshSteps(member, opts)`: single-flight (a call during a run queues one follow-up run).
 * - `syncStepsInBackground()`: the same from the alarm background task (`lib/alarms/background.ts`) — the session and
 *   member snapshot then come from the Keychain, and Android reads stored samples only (no live sensor read).
 * - Saving only ever raises a day's count (never below this phone's last save or a higher count already on the server)
 *   and is throttled for today (≥ 50 more steps or 10 min); past days are saved once per new day, retried until done.
 * - `clearStepsOnSignOut()`: stops the Android sampler and forgets its samples.
 */
import { AppState } from 'react-native';

import type { TodayData, TrackingDay } from '@/features/today/types';
import { api, ApiError, getSessionToken, setSessionToken } from '@/lib/api';
import { KEYS, readSecure, readSecureJson } from '@/lib/secure';
import type { PublicUser } from '@/lib/types';

import { addDays, safeTimeZone, utcToZoned } from '../alarms/schedule';
import { getHealthRecord } from '../health/store';

import { clampSteps, serverAllows, shouldPost } from './policy';
import { stepsReader } from './reader';
import { finalizedFor, getDayRecord, noteServerSteps, setFinalizedFor, updateDayRecord } from './store';
import type { DaySteps, StepsAccess } from './types';

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

/* ───────────────────────────── Refresh ───────────────────────────── */

export type RefreshReason = 'launch' | 'foreground' | 'today' | 'permission' | 'background';

export interface RefreshOptions {
  reason: RefreshReason;
  /** The day's count the app already holds from the server (Today's data) when fresh, else null. */
  serverSteps?: (date: string) => number | null;
  /** A save went through — update the app's caches. */
  onSaved?: (date: string, tracking: TrackingDay) => void;
}

/** Reads closer together than this are skipped (Today's timer, focus and the app returning can coincide). */
const MIN_READ_GAP_MS = 5_000;
const SAVE_TIMEOUT_MS = 20_000;

/** Bumped on sign-out: runs in flight finish without publishing or saving anything. */
let epoch = 0;
/** The time zone the Android sampler was last started with in this JS session. */
let preparedFor: string | null = null;
let lastReadAt = 0;
let running: Promise<void> | null = null;
let queued: { member: StepsMember; opts: RefreshOptions } | null = null;

export function refreshSteps(member: StepsMember, opts: RefreshOptions): Promise<void> {
  if (running) {
    queued = { member, opts };
    return running;
  }
  const run = (async () => {
    try {
      await runOnce(member, opts);
    } catch {
      // A reader never throws; this only guards against the unexpected (the next refresh tries again).
    } finally {
      running = null;
      const next = queued;
      queued = null;
      if (next) void refreshSteps(next.member, next.opts);
    }
  })();
  running = run;
  return run;
}

async function runOnce(member: StepsMember, opts: RefreshOptions) {
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

  let days: DaySteps[];
  const finalize = finalizedFor(member.id) !== today;
  try {
    const access = await stepsReader.access();
    if (stale()) return;
    setState({ access });
    if (access.phonePermission === 'granted' && preparedFor !== tz) {
      await stepsReader.prepare(tz);
      preparedFor = tz;
    }
    const dates = finalize ? [today, addDays(today, -1), addDays(today, -2)] : [today];
    days = await stepsReader.readDays(dates, { timeZone: tz, healthConnected, background: opts.reason === 'background' });
    if (stale()) return;
    const t = days.find((d) => d.date === today);
    setState({ date: today, today: t ? { ...t, at: Date.now() } : null });
  } finally {
    if (!stale()) setState({ reading: false });
  }

  if (!getSessionToken()) return;
  let pastDone = true;
  for (const day of days) {
    const past = day.date !== today;
    const ok = await saveDay(member.id, day, past, opts, stale);
    if (stale()) return;
    if (past && !ok) pastDone = false;
  }
  if (finalize && pastDone) setFinalizedFor(member.id, today);
}

/* ───────────────────────────── Saving ───────────────────────────── */

/** The day's count on the server right now (`GET /dashboard/today?date=`), null when it answered for another day. */
async function fetchServerSteps(date: string): Promise<number | null> {
  const d = await api.get<TodayData>(`/dashboard/today?date=${encodeURIComponent(date)}`, { timeoutMs: 15_000 });
  if (d?.date !== date) return null;
  return typeof d.tracking?.steps === 'number' ? d.tracking.steps : 0;
}

/** A 4xx other than auth / rate limit / timeout won't succeed on a retry (e.g. a day the server sees as the future). */
const permanent = (e: unknown) => e instanceof ApiError && e.status >= 400 && e.status < 500 && ![401, 408, 429].includes(e.status);

/** Saves `day` when the policy says so. False when it should be retried later (offline, server error). */
async function saveDay(userId: string, day: DaySteps, past: boolean, opts: RefreshOptions, stale: () => boolean): Promise<boolean> {
  const known = opts.serverSteps?.(day.date) ?? null;
  if (known != null) noteServerSteps(userId, day.date, known);
  if (!shouldPost(day.steps, getDayRecord(userId, day.date), Date.now(), past)) return true;

  // Never lower the server's count: check what it has unless the app's own data is fresh.
  let server = known;
  if (server == null) {
    try {
      server = await fetchServerSteps(day.date);
    } catch (e) {
      return permanent(e);
    }
    if (stale()) return true;
    if (server != null) noteServerSteps(userId, day.date, server);
  }
  if (!serverAllows(day.steps, server)) return true;

  const steps = clampSteps(day.steps);
  try {
    const res = await api.post<{ tracking: TrackingDay }>('/track/steps', { steps, date: day.date }, { timeoutMs: SAVE_TIMEOUT_MS });
    if (stale()) return true;
    const saved = typeof res?.tracking?.steps === 'number' ? res.tracking.steps : steps;
    const at = Date.now();
    updateDayRecord(userId, day.date, { sent: saved, sentAt: at, sentSource: day.source, server: saved, serverAt: at });
    if (res?.tracking) opts.onSaved?.(day.date, res.tracking);
    return true;
  } catch (e) {
    return permanent(e);
  }
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
    return true;
  } catch {
    return false;
  }
}

function within<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
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

/** Sign-out: nothing in flight publishes or saves; the Android sampler stops and forgets its samples. Never throws. */
export async function clearStepsOnSignOut(): Promise<void> {
  epoch += 1;
  foregroundMember = null;
  preparedFor = null;
  lastReadAt = 0;
  queued = null;
  setState(EMPTY);
  await within(stepsReader.reset(), 3_000);
}
