/**
 * Alarm sync — keeps the alarms on this phone in step with the member's medicines, dose logs, reminders and settings.
 *
 *   flush queued actions → status → data (fresh, else the last good copy) → plan → dismiss handled → photos →
 *   adapter.schedule (skipped when the plan is unchanged) → declare `alarms_local` to the server
 *
 * - Works headless (background task, no React): the session token and member snapshot then come from the Keychain.
 * - Offline: plans from the cached data (`orza-alarms.json`), so a launch without network still schedules; with no
 *   cache at all, whatever is already scheduled stays.
 * - Single-flight (a call during a run queues one follow-up run) + `requestAlarmSync` debounce.
 * - `alarms_local: true` (the server then stops medicine Web Push to this member's browsers) only once alarms really are
 *   scheduled and can show: notifications granted, exact alarms not denied (Android), a real adapter, ≥ 1 alarm.
 *   Everything else declares false. Sign-out cleanup lives in `./cleanup`.
 */
import type { QueryClient } from '@tanstack/react-query';
import { AppState } from 'react-native';

import type { DoseEvent } from '@/features/meds/events';
import { medsApi } from '@/features/meds/api';
import type { DoseItem, MedicationClient } from '@/features/meds/types';
import type { IntegrationsView, ReminderView } from '@/features/reminders/types';
import { api, ApiError, errorMessage, getSessionToken, setSessionToken } from '@/lib/api';
import { registerDevice } from '@/lib/device';
import { KEYS, readSecure, readSecureJson } from '@/lib/secure';
import type { PublicUser } from '@/lib/types';

import { alarmAdapter, type AdapterStatus, type AlarmActionEvent, type NativeAlarmAction } from './adapter';
import { attachAlarmPhotos } from './photos';
import { MAX_HORIZON_DAYS, PHOTOS_PER_MEDICINE, planAlarms, planHash, type AlarmPlan } from './plan';
import { enqueueDoseActions, flushDoseQueue, pendingDoseActions } from './queue';
import { addDays, safeTimeZone, utcToZoned, validQuietHours } from './schedule';
import { loadAlarmCache, saveAlarmCache, type AlarmCache, type AlarmSettings } from './store';
import type { PendingDoseAction, PlanDoseState, PlanMedication, PlanReminder, QuietDose } from './types';

/* ───────────────────────────── Tunables ───────────────────────────── */

/** Foreground returns re-sync at most this often unless something changed. */
export const FOREGROUND_THROTTLE_MS = 15 * 60_000;
/** An identical plan is still re-sent to the platform after this long (cheap insurance against lost alarms). */
const RESCHEDULE_EVERY_MS = 6 * 3_600_000;
const DAY_MS = 86_400_000;
const DAY_FETCH_CONCURRENCY = 3;
const REFILL_DELIVERED_KEEP_MS = 3 * DAY_MS;
const NO_STATUS: AdapterStatus = { notifications: 'undetermined', canAskNotifications: false };

/* ───────────────────────────── Public types ───────────────────────────── */

export type SyncReason = 'start' | 'foreground' | 'dose-event' | 'data-changed' | 'timezone' | 'background' | 'permission' | 'action' | 'manual';

export interface SyncOptions {
  reason: SyncReason;
  /** Re-send the plan to the platform even when it is unchanged. */
  force?: boolean;
}

export interface SyncResult {
  ok: boolean;
  reason: SyncReason;
  /** Why nothing was (re)scheduled. */
  skipped?: 'signed-out' | 'unsupported' | 'no-permission' | 'unchanged' | 'stale';
  scheduled: number;
  /** Planned from cached data (some or all requests failed). */
  offline?: boolean;
  error?: string;
}

export interface AlarmSyncState {
  running: boolean;
  lastAttemptAt: number | null;
  /** Last run that planned and scheduled (or confirmed) the alarms. */
  lastSyncAt: number | null;
  /** Alarms pending on the phone after the last successful run. */
  scheduled: number;
  /** Every alarm before this instant is scheduled (epoch ms). */
  coveredUntil: number | null;
  /** Doses that won't ring because they fall inside quiet hours (screens show a warning). */
  quietDoses: QuietDose[];
  quietReminders: number;
  status: AdapterStatus | null;
  /** This build can ring alarms on the phone (false on the stubs / web). */
  supported: boolean;
  /** What the phone last declared to the server. */
  alarmsLocal: boolean;
  /** The last plan used cached data. */
  offline: boolean;
  error: string | null;
}

const INITIAL_STATE: AlarmSyncState = {
  running: false,
  lastAttemptAt: null,
  lastSyncAt: null,
  scheduled: 0,
  coveredUntil: null,
  quietDoses: [],
  quietReminders: 0,
  status: null,
  supported: alarmAdapter.maxScheduled > 0,
  alarmsLocal: false,
  offline: false,
  error: null,
};

/* ───────────────────────────── Module state ───────────────────────────── */

/** Bumped by `resetAlarmEngine` (sign-out): a run from before must not schedule or write anything. */
let epoch = 0;
/** The signed-in member while the app UI runs (set by `useAlarmSync`). Null in a headless background run. */
let foreground: { user: PublicUser; queryClient: QueryClient | null } | null = null;
let lastScheduled: { hash: string; at: number; statusKey: string; count: number } | null = null;
let lastStatusKey: string | null = null;
let lastTz: string | null = null;
const dirty = { all: false, lists: false, dates: new Set<string>() };

let state: AlarmSyncState = INITIAL_STATE;
const stateListeners = new Set<() => void>();

function setState(patch: Partial<AlarmSyncState>) {
  state = { ...state, ...patch };
  for (const l of [...stateListeners]) {
    try {
      l();
    } catch {
      // ignore
    }
  }
}

export function getAlarmSyncState(): AlarmSyncState {
  return state;
}

export function subscribeAlarmSyncState(listener: () => void): () => void {
  stateListeners.add(listener);
  return () => {
    stateListeners.delete(listener);
  };
}

/** The app UI's signed-in member and React Query client (null when the member area unmounts). */
export function bindAlarmForeground(ctx: { user: PublicUser; queryClient: QueryClient | null } | null): void {
  foreground = ctx;
}

/* ───────────────────────────── Dirty marks ───────────────────────────── */

/** A dose / medicine changed: the affected day's logs (or everything) must be fetched again. */
export function noteAlarmDoseEvent(event: DoseEvent): void {
  if (event.type === 'dose-updated' && event.at && Number.isFinite(Date.parse(event.at))) {
    dirty.dates.add(utcToZoned(new Date(event.at), lastTz ?? safeTimeZone(foreground?.user.profile?.timezone)).date);
  } else {
    dirty.all = true;
  }
}

/** Reminders / quiet hours / the reminder preference changed: fetch them again. */
export function noteAlarmDataChanged(): void {
  dirty.lists = true;
}

const isDirty = () => dirty.all || dirty.lists || dirty.dates.size > 0;

/* ───────────────────────────── Triggers ───────────────────────────── */

let inflight: Promise<SyncResult> | null = null;
let again: SyncOptions | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let requested: SyncOptions | null = null;

/** Run a sync now (single-flight: a call during a run returns it and queues one follow-up run). */
export function syncAlarms(opts: SyncOptions): Promise<SyncResult> {
  if (inflight) {
    again = { reason: opts.reason, force: !!(again?.force || opts.force) };
    return inflight;
  }
  const run = runSync(opts).finally(() => {
    if (inflight === run) inflight = null;
    if (again) {
      const next = again;
      again = null;
      void syncAlarms(next);
    }
  });
  inflight = run;
  return run;
}

/** Debounced sync: several triggers within `delayMs` (default 1.5 s) become one run. */
export function requestAlarmSync(reason: SyncReason, opts: { force?: boolean; delayMs?: number } = {}): void {
  requested = { reason: requested && reason === 'foreground' ? requested.reason : reason, force: !!(requested?.force || opts.force) };
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const next = requested;
    requested = null;
    if (next) void syncAlarms(next);
  }, opts.delayMs ?? 1500);
}

/**
 * The app came back to the front: hand over actions pressed while it was away, re-plan when the permission changed,
 * something is dirty or the last sync is older than 15 min; otherwise just send any queued actions.
 */
export async function checkAlarmsOnForeground(): Promise<void> {
  const userId = foreground?.user.id;
  if (!userId) return;
  const native = await alarmAdapter.takeNativeActions().catch((): NativeAlarmAction[] => []);
  if (native.length) {
    enqueueDoseActions(userId, native.map(fromNative));
    requestAlarmSync('action', { delayMs: 300 });
    return;
  }
  const status = await alarmAdapter.status().catch(() => null);
  if (status && lastStatusKey !== null && JSON.stringify(status) !== lastStatusKey) {
    requestAlarmSync('permission', { force: true, delayMs: 300 });
    return;
  }
  if (isDirty() || Date.now() - (state.lastSyncAt ?? 0) > FOREGROUND_THROTTLE_MS) {
    requestAlarmSync('foreground', { delayMs: 800 });
  } else if (pendingDoseActions(userId).length) {
    void flushDoseQueue({ userId, queryClient: foreground?.queryClient ?? null });
  }
}

/** Take / Snooze / Skip pressed on an alarm while the app runs: queue it, send it and re-plan. */
export function recordAlarmAction(event: AlarmActionEvent): void {
  const userId = foreground?.user.id;
  if (!userId || event.action === 'open' || !event.doses.length) return;
  const action = event.action;
  enqueueDoseActions(
    userId,
    event.doses.map((d) => ({ medId: d.medId, scheduledFor: d.scheduledFor, action, snoozeMinutes: event.snoozeMinutes, createdAt: event.at }))
  );
  requestAlarmSync('action', { delayMs: 300 });
}

/** Ask for notification permission, then re-plan (the alarms can only be scheduled once it's granted). */
export async function requestAlarmPermission(): Promise<AdapterStatus> {
  const status = await alarmAdapter.requestNotifications().catch(() => NO_STATUS);
  requestAlarmSync('permission', { force: true, delayMs: 300 });
  return status;
}

/** Forget everything in memory (sign-out). Runs already in flight finish without scheduling or writing. */
export function resetAlarmEngine(): void {
  epoch += 1;
  if (timer) clearTimeout(timer);
  timer = null;
  requested = null;
  again = null;
  lastScheduled = null;
  lastStatusKey = null;
  lastTz = null;
  dirty.all = false;
  dirty.lists = false;
  dirty.dates.clear();
  setState({ ...INITIAL_STATE });
}

/* ───────────────────────────── The run ───────────────────────────── */

const fromNative = (a: NativeAlarmAction): PendingDoseAction => ({
  medId: a.medId,
  scheduledFor: a.scheduledFor,
  action: a.action,
  snoozeMinutes: a.snoozeMinutes,
  createdAt: a.at,
});

interface Session {
  userId: string;
  user: PublicUser | null;
}

/** The signed-in member: the app's own state, or (headless) the Keychain session + snapshot. */
async function resolveSession(): Promise<Session | null> {
  if (foreground) return getSessionToken() ? { userId: foreground.user.id, user: foreground.user } : null;
  if (!getSessionToken()) {
    // A running app without a session is signed out; only a headless run reads the Keychain.
    if (AppState.currentState === 'active') return null;
    const token = await readSecure(KEYS.token);
    if (!token) return null;
    if (!getSessionToken()) setSessionToken(token);
  }
  const user = await readSecureJson<PublicUser>(KEYS.user);
  return user?.id ? { userId: user.id, user } : null;
}

async function declare(alarmsLocal: boolean, reason: SyncReason, stale: () => boolean) {
  // Signed out meanwhile: the device registration was reset for the next account — don't leave this one's claim in it.
  if (stale() || !getSessionToken()) return;
  setState({ alarmsLocal });
  const registration = registerDevice({ alarmsLocal });
  // A headless run must finish the request before the OS ends the task; the app doesn't need to wait.
  if (reason === 'background') await registration;
}

async function runSync(opts: SyncOptions): Promise<SyncResult> {
  const myEpoch = epoch;
  const stale = () => myEpoch !== epoch;
  const result = (r: Omit<SyncResult, 'reason'>): SyncResult => {
    const out = { ...r, reason: opts.reason };
    if (!stale()) setState({ running: false, error: out.error ?? null });
    return out;
  };
  setState({ running: true, lastAttemptAt: Date.now() });

  try {
    const session = await resolveSession();
    if (stale()) return result({ ok: false, skipped: 'stale', scheduled: 0 });
    if (!session) return result({ ok: false, skipped: 'signed-out', scheduled: 0 });
    const { userId } = session;
    const queryClient = foreground?.queryClient ?? null;

    // 1. Actions pressed while JS wasn't running, then everything queued goes to the server.
    const native = await alarmAdapter.takeNativeActions().catch((): NativeAlarmAction[] => []);
    if (stale()) return result({ ok: false, skipped: 'stale', scheduled: 0 });
    if (native.length) enqueueDoseActions(userId, native.map(fromNative));
    await flushDoseQueue({ userId, queryClient });

    // 2. Can this phone ring alarms at all?
    const status = await alarmAdapter.status().catch(() => NO_STATUS);
    if (stale()) return result({ ok: false, skipped: 'stale', scheduled: 0 });
    const statusKey = JSON.stringify(status);
    setState({ status, supported: alarmAdapter.maxScheduled > 0 });
    if (alarmAdapter.maxScheduled <= 0) {
      lastStatusKey = statusKey;
      await declare(false, opts.reason, stale);
      return result({ ok: true, skipped: 'unsupported', scheduled: 0 });
    }

    // 3. Data: fresh where possible, the last good copy otherwise.
    const cache = loadAlarmCache(userId);
    const loaded = await loadData(session, cache, stale);
    if (stale()) return result({ ok: false, skipped: 'stale', scheduled: 0 });
    if ('error' in loaded) {
      setState({ offline: true });
      return result({ ok: false, offline: true, scheduled: state.scheduled, error: loaded.error });
    }
    const { data } = loaded;
    lastTz = data.settings.tz;

    // 4. Plan.
    const now = Date.now();
    recordDeliveredRefills(cache, now);
    const plan = planAlarms({
      now,
      tz: data.settings.tz,
      meds: data.meds,
      doseStates: data.doseStates,
      pending: pendingDoseActions(userId),
      reminders: data.reminders,
      remindersEnabled: data.settings.remindersEnabled,
      quietHours: data.settings.quietHours,
      horizonDays: MAX_HORIZON_DAYS,
      maxItems: alarmAdapter.maxScheduled,
      refillDelivered: Object.keys(cache.refillDelivered),
    });
    setState({ quietDoses: plan.quietDoses, quietReminders: plan.quietReminders, offline: data.offline });

    // 5. Alarms still showing for doses handled elsewhere (Today screen, website, another phone).
    for (const key of plan.settledKeys) await alarmAdapter.dismiss(key).catch(() => undefined);

    // 6. Without permission nothing can show: clear the phone's alarms and say so to the server.
    if (status.notifications !== 'granted') {
      await alarmAdapter.cancelAll().catch(() => undefined);
      if (stale()) return result({ ok: false, skipped: 'stale', scheduled: 0 });
      lastScheduled = null;
      lastStatusKey = statusKey;
      saveAlarmCache({ ...cache, scheduled: undefined });
      setState({ scheduled: 0, coveredUntil: null, lastSyncAt: now });
      await declare(false, opts.reason, stale);
      return result({ ok: true, skipped: 'no-permission', scheduled: 0, offline: data.offline });
    }

    // 7. Photos (never blocks: missing ones are simply left out this time).
    await attachAlarmPhotos(plan.items, { keepIds: photoIdsToKeep(data.meds), budgetMs: opts.reason === 'background' ? 20_000 : 25_000 });
    if (stale()) return result({ ok: false, skipped: 'stale', scheduled: 0 });

    // 8. Schedule — unless the very same plan is already on the phone.
    const hash = planHash(plan.items);
    const unchanged =
      !opts.force && !!lastScheduled && lastScheduled.hash === hash && lastScheduled.statusKey === statusKey && now - lastScheduled.at < RESCHEDULE_EVERY_MS;
    let scheduled = lastScheduled?.count ?? 0;
    if (!unchanged) {
      try {
        scheduled = (await alarmAdapter.schedule(plan.items)).scheduled;
      } catch (e) {
        if (stale()) return result({ ok: false, skipped: 'stale', scheduled: 0 });
        lastScheduled = null;
        await declare(false, opts.reason, stale);
        return result({ ok: false, scheduled: 0, error: errorMessage(e, "Couldn't set the alarms on this phone.") });
      }
      if (stale()) {
        // Signed out while scheduling: take them off again.
        await alarmAdapter.cancelAll().catch(() => undefined);
        return result({ ok: false, skipped: 'stale', scheduled: 0 });
      }
      lastScheduled = { hash, at: now, statusKey, count: scheduled };
      cache.scheduled = { at: now, hash, count: scheduled, coveredUntil: plan.coveredUntil, refills: refillsOf(plan) };
    }
    lastStatusKey = statusKey;
    saveAlarmCache(cache);
    setState({ scheduled, coveredUntil: plan.coveredUntil, lastSyncAt: now });

    // 9. Tell the server whether this phone rings the medicine alarms (it then skips their Web Push).
    await declare(status.exact !== false && scheduled > 0, opts.reason, stale);
    return result({ ok: true, scheduled, offline: data.offline, ...(unchanged ? { skipped: 'unchanged' as const } : {}) });
  } catch (e) {
    return result({ ok: false, scheduled: state.scheduled, error: errorMessage(e, "Couldn't update the alarms.") });
  }
}

/* ───────────────────────────── Data ───────────────────────────── */

interface LoadedData {
  meds: PlanMedication[];
  reminders: PlanReminder[];
  settings: AlarmSettings;
  doseStates: PlanDoseState[];
  offline: boolean;
}

const trimMed = (m: MedicationClient): PlanMedication => ({
  id: m.id,
  name: m.name,
  strength: m.strength,
  dose: m.dose,
  timing: m.timing,
  for_person: m.for_person,
  instructions: m.instructions,
  photo_ids: (m.photo_ids ?? []).slice(0, PHOTOS_PER_MEDICINE),
  photo_urls: (m.photo_urls ?? []).slice(0, PHOTOS_PER_MEDICINE),
  schedule: m.schedule,
  as_needed: m.as_needed,
  active: m.active,
  stock: m.stock,
  created_at: m.created_at,
});

const trimReminder = (r: ReminderView): PlanReminder => ({
  id: r.id,
  kind: r.kind,
  title: r.title,
  body: r.body,
  schedule: r.schedule,
  channels: r.channels,
  active: r.active,
});

const isActed = (d: Pick<DoseItem, 'status' | 'acted_at'>) => !!d.acted_at || d.status === 'taken' || d.status === 'skipped' || d.status === 'snoozed';

const actedStates = (doses: DoseItem[]): PlanDoseState[] =>
  doses.filter(isActed).map((d) => ({
    medication_id: d.medication_id,
    scheduled_for: d.scheduled_for,
    status: d.status,
    ...(d.snooze_until ? { snooze_until: d.snooze_until } : {}),
    ...(d.acted_at ? { acted_at: d.acted_at } : {}),
  }));

function settingsFromUser(user: PublicUser | null): AlarmSettings {
  return {
    tz: safeTimeZone(user?.profile?.timezone),
    quietHours: validQuietHours(user?.integrations?.quiet_hours ?? null),
    remindersEnabled: user?.preferences?.reminders !== false,
  };
}

const isUnauthorized = (r: PromiseSettledResult<unknown>) => r.status === 'rejected' && r.reason instanceof ApiError && r.reason.status === 401;

/** How old a day's cached dose logs may be before they're fetched again. */
function dayMaxAge(date: string, today: string): number {
  if (date === today) return 0;
  if (date < today) return 30 * 60_000; // yesterday: snoozes across midnight, dismissals
  if (date === addDays(today, 1)) return 60 * 60_000;
  return 6 * 3_600_000;
}

async function loadData(session: Session, cache: AlarmCache, stale: () => boolean): Promise<{ data: LoadedData } | { error: string }> {
  const now = Date.now();
  // Taken now; put back when the refetch fails (an event arriving meanwhile marks things dirty again on its own).
  const listsWereDirty = dirty.lists;
  dirty.lists = false;
  const [medsR, remindersR, settingsR] = await Promise.allSettled([
    medsApi.list(),
    api.get<{ reminders?: ReminderView[] }>('/reminders'),
    api.get<IntegrationsView>('/integrations'),
  ]);
  if (stale()) return { error: 'stale' };
  if (listsWereDirty && (remindersR.status === 'rejected' || settingsR.status === 'rejected')) dirty.lists = true;
  // The session is over: the app's 401 handler signs out (and clears the alarms). A headless run just stops — it never
  // cancels medicine alarms on its own.
  if ([medsR, remindersR, settingsR].some(isUnauthorized)) return { error: 'Please sign in again.' };

  let offline = false;
  let meds: PlanMedication[];
  if (medsR.status === 'fulfilled') {
    meds = medsR.value.map(trimMed);
    cache.meds = { at: now, list: meds };
  } else if (cache.meds) {
    meds = cache.meds.list;
    offline = true;
  } else {
    return { error: errorMessage(medsR.reason) };
  }

  let reminders: PlanReminder[];
  if (remindersR.status === 'fulfilled') {
    reminders = (remindersR.value?.reminders ?? []).map(trimReminder);
    cache.reminders = { at: now, list: reminders };
  } else {
    reminders = cache.reminders?.list ?? [];
    offline = true;
  }

  let settings: AlarmSettings;
  if (settingsR.status === 'fulfilled' && settingsR.value) {
    const v = settingsR.value;
    settings = {
      tz: safeTimeZone(v.timezone || session.user?.profile?.timezone),
      quietHours: validQuietHours(v.quiet_hours),
      remindersEnabled: v.reminders_enabled !== false,
    };
    // The day logs are per local date of the profile timezone: a new timezone starts them afresh.
    if (cache.settings && cache.settings.tz !== settings.tz) cache.days = {};
    cache.settings = { at: now, ...settings };
  } else {
    settings = cache.settings ? { tz: cache.settings.tz, quietHours: cache.settings.quietHours, remindersEnabled: cache.settings.remindersEnabled } : settingsFromUser(session.user);
    offline = true;
  }

  // Dose logs per local day: yesterday (mornings only), today … the horizon's last day.
  const local = utcToZoned(new Date(now), settings.tz);
  const today = local.date;
  const lastDay = utcToZoned(new Date(now + MAX_HORIZON_DAYS * DAY_MS), settings.tz).date;
  const dates: string[] = local.time < '12:00' ? [addDays(today, -1)] : [];
  for (let d = today; d <= lastDay && dates.length < MAX_HORIZON_DAYS + 3; d = addDays(d, 1)) dates.push(d);
  const dirtyAll = dirty.all;
  const toFetch = dates.filter((d) => {
    const entry = cache.days[d];
    return !entry || dirtyAll || dirty.dates.has(d) || now - entry.at >= dayMaxAge(d, today);
  });
  dirty.all = false;
  for (const d of toFetch) dirty.dates.delete(d);
  let next = 0;
  const worker = async () => {
    while (next < toFetch.length) {
      const date = toFetch[next++];
      try {
        const res = await medsApi.today(date);
        cache.days[date] = { at: now, doses: actedStates(res.doses ?? []) };
      } catch {
        dirty.dates.add(date); // try again next time
        if (date === today) offline = true;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(DAY_FETCH_CONCURRENCY, toFetch.length) }, worker));
  if (stale()) return { error: 'stale' };
  for (const d of Object.keys(cache.days)) if (!dates.includes(d)) delete cache.days[d];
  for (const d of [...dirty.dates]) if (!dates.includes(d)) dirty.dates.delete(d); // outside the window: nothing to fetch

  const doseStates = dates.flatMap((d) => cache.days[d]?.doses ?? []);
  return { data: { meds, reminders, settings, doseStates, offline } };
}

/** Refill alerts the last schedule put on the phone whose time has come = delivered (once per local day). */
function recordDeliveredRefills(cache: AlarmCache, now: number) {
  const delivered = { ...cache.refillDelivered };
  for (const r of cache.scheduled?.refills ?? []) if (r.at <= now) delivered[r.key] = r.at;
  for (const [key, at] of Object.entries(delivered)) if (now - at > REFILL_DELIVERED_KEEP_MS) delete delivered[key];
  cache.refillDelivered = delivered;
  if (cache.scheduled) cache.scheduled = { ...cache.scheduled, refills: cache.scheduled.refills.filter((r) => r.at > now) };
}

const refillsOf = (plan: AlarmPlan) => plan.items.filter((i) => i.kind === 'refill').map((i) => ({ key: i.key, at: i.at }));

/** Photos worth keeping on the phone: every active medicine's alarm photos (even past the cap / horizon). */
function photoIdsToKeep(meds: PlanMedication[]): string[] {
  return meds.filter((m) => m.active !== false).flatMap((m) => (m.photo_ids ?? []).slice(0, PHOTOS_PER_MEDICINE));
}
