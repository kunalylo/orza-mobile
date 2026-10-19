/**
 * Dose logs ÖRZA has just confirmed to this phone — a queued alarm action sent, Take / Snooze / Skip on the alarm or
 * Today screen — kept in the alarm cache until a later fetch of their day includes them. Without this, a plan made
 * while that refetch fails (flaky network, the server slow) or before it runs would use the older day log: a snooze
 * that already reached ÖRZA would lose its re-ring (the phone cancels alarms the plan doesn't carry) and a taken dose
 * could ring again.
 */
import { loadAlarmCache, saveAlarmCache, type AlarmCache } from './store';
import { isoOf, type PlanDoseState } from './types';

/** Long enough to cover yesterday's / today's logs; a fetch normally takes over within minutes. */
const KEEP_MS = 36 * 3_600_000;

/** What `POST /api/meds/doses` answers (`DoseLog`) — only the fields the planner reads. */
export interface SavedDoseLog {
  medication_id: string;
  scheduled_for: string;
  status: string;
  acted_at?: string | null;
  snooze_until?: string | null;
  /** Local date of the dose in the member's timezone (the day log it belongs to). */
  local_date?: string;
}

const keyOf = (medId: string, scheduledFor: string) => `${medId}|${Date.parse(scheduledFor)}`;

function trim(log: SavedDoseLog): PlanDoseState & { local_date?: string } {
  return {
    medication_id: log.medication_id,
    scheduled_for: isoOf(log.scheduled_for),
    status: log.status,
    ...(log.acted_at ? { acted_at: log.acted_at } : {}),
    ...(log.snooze_until ? { snooze_until: log.snooze_until } : {}),
    ...(log.local_date ? { local_date: log.local_date } : {}),
  };
}

/** Keep a log ÖRZA confirmed for `userId` (never throws). */
export function noteSavedDoseLog(userId: string | null | undefined, log: SavedDoseLog | null | undefined, now = Date.now()): void {
  if (!userId || !log?.medication_id || !log.scheduled_for || !Number.isFinite(Date.parse(log.scheduled_for))) return;
  try {
    const cache = loadAlarmCache(userId);
    const recent = { ...(cache.recent ?? {}) };
    recent[keyOf(log.medication_id, log.scheduled_for)] = { notedAt: now, log: trim(log) };
    for (const [k, r] of Object.entries(recent)) if (now - r.notedAt > KEEP_MS) delete recent[k];
    cache.recent = recent;
    saveAlarmCache(cache);
  } catch {
    // storage trouble: the next fetch brings the log anyway
  }
}

/**
 * Puts the kept logs into their day's cached logs (replacing what that day said about the dose) unless the day was
 * fetched after the log was saved — then the fetch has it and the kept copy is dropped. Runs after the day fetches.
 * `dateOf` gives a log's local date when the server didn't send one.
 */
export function mergeRecentDoseLogs(cache: AlarmCache, dateOf: (scheduledFor: string) => string, now = Date.now()): void {
  const recent = cache.recent;
  if (!recent) return;
  const next: NonNullable<AlarmCache['recent']> = {};
  for (const [k, r] of Object.entries(recent)) {
    if (!r?.log?.medication_id || now - r.notedAt > KEEP_MS) continue;
    const date = r.log.local_date || dateOf(r.log.scheduled_for);
    const day = cache.days[date];
    if (day && day.at > r.notedAt) continue; // fetched after it was saved: the day log has it
    const t = Date.parse(r.log.scheduled_for);
    const doses = (day?.doses ?? []).filter((d) => !(d.medication_id === r.log.medication_id && Date.parse(d.scheduled_for) === t));
    doses.push({
      medication_id: r.log.medication_id,
      scheduled_for: r.log.scheduled_for,
      status: r.log.status,
      ...(r.log.acted_at ? { acted_at: r.log.acted_at } : {}),
      ...(r.log.snooze_until ? { snooze_until: r.log.snooze_until } : {}),
    });
    cache.days[date] = { at: day?.at ?? 0, doses };
    next[k] = r;
  }
  cache.recent = Object.keys(next).length ? next : undefined;
}

/** The cached day logs with the kept ones merged in, as one list (the cache itself is left unchanged). */
export function cachedDoseLogs(cache: AlarmCache, dateOf: (scheduledFor: string) => string): PlanDoseState[] {
  const copy: AlarmCache = { ...cache, days: { ...cache.days } };
  mergeRecentDoseLogs(copy, dateOf);
  return Object.values(copy.days).flatMap((d) => d.doses);
}
