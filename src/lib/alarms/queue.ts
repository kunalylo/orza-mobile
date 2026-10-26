/**
 * Dose actions pressed on an alarm (Take / Snooze / Skip) that still have to reach ÖRZA — the app may have been dead
 * or offline when they were pressed. Persisted in a JSON file, one entry per dose (the newest action wins), and sent
 * to `POST /api/meds/doses` (same body as the medicine screens, via `medsApi.dose`) whenever the engine runs.
 *
 * - Idempotent on the server: the dose log is an upsert and "take" lowers the stock only once.
 * - Kept on network trouble / 5xx / 401 / 408 / 429 (sent later, in order); dropped on any other 4xx (the dose or the
 *   medicine changed — `isStaleDoseError` — or the action is invalid), and after 72 h.
 * - A snooze that couldn't be sent before its 10 minutes were up is dropped: the phone already re-rang it, and sending
 *   it late would make the server start a fresh snooze (and the phone ring again later).
 * - A snooze sent later than it was pressed asks only for the minutes still left (the server starts the snooze when it
 *   receives it and can't take the press time): otherwise a Snooze pressed with the app asleep and synced 8 min later
 *   would re-ring 18 min after the press instead of 10 (the plan follows the server's `snooze_until`). At least 5 min —
 *   the server's minimum.
 * - A snooze / skip is checked against ÖRZA first (`GET /api/meds/doses?at=`): it is dropped when the dose was taken or
 *   skipped meanwhile (the server would overwrite that — a taken dose turning "snoozed" rings again and invites a second
 *   dose), or when ÖRZA's log is clearly newer than the press (`pendingWins`).
 * - An action done in the app for the same dose (`supersedeQueuedDose`) replaces older queued entries.
 * - Every log ÖRZA confirms is kept for the planner (`./recent`) until a fetch of its day includes it.
 * After anything was sent: React Query's medicine data is invalidated (when the app is running) and a dose event is
 * emitted, so screens and the alarm plan refresh.
 */
import type { QueryClient } from '@tanstack/react-query';

import { medsApi, medsKeys } from '@/features/meds/api';
import { emitDoseEvent } from '@/features/meds/events';
import type { DoseItem, DueResponse } from '@/features/meds/types';
import { api, ApiError } from '@/lib/api';

import { DEFAULT_SNOOZE_MINUTES, pendingWins, serverDoseState } from './plan';
import { noteSavedDoseLog } from './recent';
import { deleteJsonFile, readJsonFile, writeJsonFile } from './store';
import { isoOf, type PendingDoseAction } from './types';

const QUEUE_FILE = 'orza-alarm-queue.json';
const MAX_AGE_MS = 72 * 3_600_000;
const MAX_ENTRIES = 200;
const MIN_SNOOZE_MINUTES = 5;
const MAX_SNOOZE_MINUTES = 60;

/** Minutes of a queued snooze still to run at `now` (to the nearest whole minute, within the server's 5–60). */
export function remainingSnoozeMinutes(a: Pick<PendingDoseAction, 'snoozeMinutes' | 'createdAt'>, now: number): number {
  const total = a.snoozeMinutes ?? DEFAULT_SNOOZE_MINUTES;
  const left = Number.isFinite(a.createdAt) ? Math.round((a.createdAt + total * 60_000 - now) / 60_000) : total;
  return Math.min(MAX_SNOOZE_MINUTES, Math.max(MIN_SNOOZE_MINUTES, Math.min(total, left)));
}

interface QueueFile {
  version: 1;
  userId: string;
  actions: PendingDoseAction[];
}

let queue: QueueFile | null = null;

const doseId = (a: Pick<PendingDoseAction, 'medId' | 'scheduledFor'>) => `${a.medId}:${isoOf(a.scheduledFor)}`;

function load(userId: string): QueueFile {
  if (queue?.userId === userId) return queue;
  const stored = readJsonFile<QueueFile>(QUEUE_FILE);
  queue =
    stored && stored.version === 1 && stored.userId === userId && Array.isArray(stored.actions)
      ? { ...stored, actions: stored.actions.filter((a) => a && typeof a.medId === 'string' && typeof a.scheduledFor === 'string') }
      : { version: 1, userId, actions: [] };
  return queue;
}

function save(next: QueueFile) {
  queue = next;
  if (next.actions.length) writeJsonFile(QUEUE_FILE, next);
  else deleteJsonFile(QUEUE_FILE);
}

/** Actions not yet confirmed by the server (the planner overlays them on the dose logs). */
export function pendingDoseActions(userId: string): PendingDoseAction[] {
  return [...load(userId).actions];
}

/** Queue actions for `userId` (one per dose; a newer action replaces an older one for the same dose). */
export function enqueueDoseActions(userId: string, actions: PendingDoseAction[]): void {
  if (!actions.length) return;
  const q = load(userId);
  const byDose = new Map(q.actions.map((a) => [doseId(a), a]));
  for (const a of actions) {
    if (!a?.medId || !Number.isFinite(Date.parse(a.scheduledFor))) continue;
    const entry: PendingDoseAction = {
      medId: a.medId,
      scheduledFor: isoOf(a.scheduledFor),
      action: a.action,
      ...(a.action === 'snooze' ? { snoozeMinutes: Math.min(60, Math.max(5, Math.round(a.snoozeMinutes ?? DEFAULT_SNOOZE_MINUTES))) } : {}),
      createdAt: Number.isFinite(a.createdAt) ? a.createdAt : Date.now(),
    };
    const prev = byDose.get(doseId(entry));
    if (!prev || prev.createdAt <= entry.createdAt) byDose.set(doseId(entry), entry);
  }
  const actionsSorted = [...byDose.values()].sort((a, b) => a.createdAt - b.createdAt).slice(-MAX_ENTRIES);
  save({ ...q, actions: actionsSorted });
}

/**
 * The member acted on this dose in the app (alarm / Today screen) and ÖRZA confirmed it: queued actions for it pressed
 * before `pressedAt` are out of date — sending them later would overwrite the newer one.
 */
export function supersedeQueuedDose(userId: string, medId: string, scheduledFor: string, pressedAt: number): void {
  if (!userId || !medId) return;
  const q = load(userId);
  const id = doseId({ medId, scheduledFor });
  const kept = q.actions.filter((a) => doseId(a) !== id || a.createdAt > pressedAt);
  if (kept.length !== q.actions.length) save({ ...q, actions: kept });
}

/** Forget every queued action (sign-out). */
export function clearDoseQueue(): void {
  queue = null;
  deleteJsonFile(QUEUE_FILE);
}

/** Worth sending again later: no answer, a server error, the session (401), a timeout or a rate limit. */
function keepForLater(e: unknown): boolean {
  if (!(e instanceof ApiError)) return true;
  return e.isNetwork || e.status >= 500 || e.status === 401 || e.status === 408 || e.status === 429;
}

export interface FlushResult {
  sent: number;
  dropped: number;
  kept: number;
}

let flushing: Promise<FlushResult> | null = null;

/** Send the queued actions in order. Single-flight; never throws. */
export function flushDoseQueue(opts: { userId: string; queryClient?: QueryClient | null }): Promise<FlushResult> {
  if (flushing) return flushing;
  const run = doFlush(opts).finally(() => {
    if (flushing === run) flushing = null;
  });
  flushing = run;
  return run;
}

async function doFlush({ userId, queryClient }: { userId: string; queryClient?: QueryClient | null }): Promise<FlushResult> {
  const result: FlushResult = { sent: 0, dropped: 0, kept: 0 };
  const q = load(userId);
  if (!q.actions.length) return result;
  const sentEvents: { medId: string; at: string }[] = [];
  const done = new Set<PendingDoseAction>();

  // ÖRZA's doses at an instant, fetched once per instant; null = couldn't be checked (sent anyway — the server decides).
  const atInstant = new Map<string, DoseItem[] | null>();
  const serverDoses = async (scheduledFor: string): Promise<DoseItem[] | null> => {
    const cached = atInstant.get(scheduledFor);
    if (cached !== undefined) return cached;
    let doses: DoseItem[] | null;
    try {
      doses = (await api.get<DueResponse>(`/meds/doses?at=${encodeURIComponent(scheduledFor)}`, { timeoutMs: 15_000 })).doses ?? [];
    } catch (e) {
      if (keepForLater(e)) throw e;
      doses = null;
    }
    atInstant.set(scheduledFor, doses);
    return doses;
  };

  for (const a of q.actions) {
    const now = Date.now();
    const snoozeOver = a.action === 'snooze' && now - a.createdAt > (a.snoozeMinutes ?? DEFAULT_SNOOZE_MINUTES) * 60_000;
    if (now - a.createdAt > MAX_AGE_MS || snoozeOver) {
      done.add(a);
      result.dropped++;
      continue;
    }
    try {
      if (a.action !== 'take') {
        const t = Date.parse(a.scheduledFor);
        const log = (await serverDoses(a.scheduledFor))?.find((d) => d.medication_id === a.medId && Date.parse(d.scheduled_for) === t);
        const server = log ? serverDoseState(log) : null;
        if (server && !pendingWins(a, server)) {
          // Taken / skipped meanwhile, or done again later elsewhere: sending it would undo that.
          done.add(a);
          result.dropped++;
          sentEvents.push({ medId: a.medId, at: a.scheduledFor });
          continue;
        }
      }
      const minutes = a.action === 'snooze' ? remainingSnoozeMinutes(a, Date.now()) : (a.snoozeMinutes ?? DEFAULT_SNOOZE_MINUTES);
      const log = await medsApi.dose({ medication_id: a.medId, scheduled_for: a.scheduledFor }, a.action, minutes);
      noteSavedDoseLog(userId, log);
      done.add(a);
      result.sent++;
      sentEvents.push({ medId: a.medId, at: a.scheduledFor });
    } catch (e) {
      if (keepForLater(e)) break; // offline / server trouble: the rest waits too, in order
      done.add(a); // the dose or medicine changed, or the action is invalid — nothing to retry
      result.dropped++;
    }
  }

  // Re-read: actions may have been queued while this was sending.
  const current = load(userId);
  const remaining = current.actions.filter((a) => !done.has(a));
  result.kept = remaining.length;
  save({ ...current, actions: remaining });

  if (result.sent || result.dropped) {
    if (queryClient) void queryClient.invalidateQueries({ queryKey: medsKeys.all }, { cancelRefetch: false });
    if (sentEvents.length) for (const ev of sentEvents) emitDoseEvent({ type: 'dose-updated', medId: ev.medId, at: ev.at });
    else emitDoseEvent({ type: 'meds-changed' });
  }
  return result;
}
