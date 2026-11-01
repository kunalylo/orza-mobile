/**
 * Dose wire rules — PURE (no React Native imports; `npm run test:alarms` runs this file in Node). Shared by the medicine
 * screens, the alarm screen, the offline action queue and the alarm sync. Contract: web `SPEC.md` (web batch 1).
 *
 * - `POST /api/meds/doses` body (`doseActionBody`): `acted_at` = the moment the member pressed, and for a snooze
 *   `snooze_until` = that moment + the snooze length — ÖRZA records both (clamped), so a press that reaches it late
 *   (offline, the app asleep) keeps its own time. `snooze_minutes` is still sent, as the minutes LEFT of that snooze
 *   (at least 5): an older server ignores the two new fields and starts the snooze when the request arrives.
 * - 409 `dose_already_taken` (`isDoseAlreadyTaken`): a Skip / Snooze over a dose that was already taken — the dose IS
 *   taken; nothing to retry, nothing to show as an error.
 * - `GET /api/meds/doses?from=&to=` (`doseRangeSpan`, `parseDoseRange`): the recorded actions of up to 14 local days in
 *   one request. An older server answers it like `GET /api/meds/doses` (due now: no `from` / `to` in the answer) — or with
 *   400 / 404 — and the caller falls back to one `/api/meds/today?date=` per day.
 * - Missed (`doseRingsUntil`, `isPastRinging`): ÖRZA counts an unanswered dose as missed 60 min after its time (web
 *   `MISSED_AFTER_MIN`, `doseStatus`), a snoozed one 60 min after its snooze ended (web `doseHistoryBetween`). Past that
 *   a dose no longer RINGS anywhere on the phone — it shows as missed instead (never silently dropped).
 */
import { DEFAULT_SNOOZE_MINUTES } from './plan';
import { isoOf, type DoseActionKind, type PlanDoseState } from './types';

/** Web `MISSED_AFTER_MIN`: an unanswered dose is "missed" this long after its time (or after its snooze ended). */
export const MISSED_AFTER_MS = 60 * 60_000;
/** Error code of the 409 for a Skip / Snooze over a dose already taken (web `DOSE_ALREADY_TAKEN`). */
export const DOSE_ALREADY_TAKEN = 'dose_already_taken';
/** Most local days one `GET /api/meds/doses?from=&to=` may span (web `MAX_RANGE_DAYS`). */
export const MAX_RANGE_DAYS = 14;
/** The server's snooze limits (`snooze_minutes` 5–60). */
export const MIN_SNOOZE_MINUTES = 5;
export const MAX_SNOOZE_MINUTES = 60;

const MINUTE = 60_000;

/** A snooze length within the server's 5–60 min (default 10). */
export function snoozeMinutesOf(minutes: number | undefined | null): number {
  const m = typeof minutes === 'number' && Number.isFinite(minutes) ? Math.round(minutes) : DEFAULT_SNOOZE_MINUTES;
  return Math.min(MAX_SNOOZE_MINUTES, Math.max(MIN_SNOOZE_MINUTES, m));
}

/** When a snooze pressed at `pressedAt` (epoch ms) ends. */
export const snoozeEndOf = (pressedAt: number, minutes?: number | null) => pressedAt + snoozeMinutesOf(minutes) * MINUTE;

/**
 * Minutes of a snooze pressed at `pressedAt` still to run at `now` (whole minutes, within the server's 5–60): what an
 * older server is asked for — it starts the snooze when the request arrives.
 */
export function remainingSnoozeMinutes(pressedAt: number, minutes: number | undefined | null, now: number): number {
  const total = snoozeMinutesOf(minutes);
  const left = Number.isFinite(pressedAt) ? Math.round((pressedAt + total * MINUTE - now) / MINUTE) : total;
  return Math.min(MAX_SNOOZE_MINUTES, Math.max(MIN_SNOOZE_MINUTES, Math.min(total, left)));
}

/* ───────────────────────────── POST /api/meds/doses ───────────────────────────── */

export interface DoseActionBody {
  medication_id: string;
  scheduled_for: string;
  action: DoseActionKind;
  /** When the member pressed (ISO, UTC "Z"). */
  acted_at: string;
  /** Snooze only: the minutes still to run when sent (older servers). */
  snooze_minutes?: number;
  /** Snooze only: when it ends (ISO, UTC "Z") — wins over `snooze_minutes` on a current server. */
  snooze_until?: string;
}

/**
 * The body for an action pressed at `pressedAt` and sent at `now` (default: right away). The snooze ends
 * `snoozeMinutes` (default 10) after the press, however late it is sent.
 */
export function doseActionBody(
  dose: { medication_id: string; scheduled_for: string },
  action: DoseActionKind,
  opts: { pressedAt?: number; snoozeMinutes?: number | null; now?: number } = {}
): DoseActionBody {
  const now = typeof opts.now === 'number' && Number.isFinite(opts.now) ? opts.now : Date.now();
  const pressedAt = typeof opts.pressedAt === 'number' && Number.isFinite(opts.pressedAt) ? opts.pressedAt : now;
  return {
    medication_id: dose.medication_id,
    scheduled_for: dose.scheduled_for,
    action,
    acted_at: new Date(pressedAt).toISOString(),
    ...(action === 'snooze'
      ? {
          snooze_minutes: remainingSnoozeMinutes(pressedAt, opts.snoozeMinutes, now),
          snooze_until: new Date(snoozeEndOf(pressedAt, opts.snoozeMinutes)).toISOString(),
        }
      : {}),
  };
}

/** ÖRZA refused a Skip / Snooze because the dose is already taken (409 `dose_already_taken`). Duck-typed `ApiError`. */
export function isDoseAlreadyTaken(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const { status, code } = e as { status?: unknown; code?: unknown };
  return status === 409 && code === DOSE_ALREADY_TAKEN;
}

/** The dose log the phone keeps for a dose ÖRZA says is taken (no `acted_at`: when it was taken isn't known here). */
export function takenDoseLog(medId: string, scheduledFor: string): PlanDoseState {
  return { medication_id: medId, scheduled_for: isoOf(scheduledFor), status: 'taken' };
}

/* ───────────────────────────── GET /api/meds/doses?from=&to= ───────────────────────────── */

/** One recorded action as `?from=&to=` returns it. */
export interface RangeDose {
  medication_id: string;
  scheduled_for: string;
  local_date?: string;
  local_time?: string;
  status: string;
  acted_at?: string | null;
  snooze_until?: string | null;
}

export interface DoseRangeResponse {
  from?: string;
  to?: string;
  now?: string;
  doses?: RangeDose[];
}

const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Calendar days from `a` to `b` (YYYY-MM-DD, timezone-free). */
function daysFrom(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/**
 * The one range to ask for so every date in `dates` is covered (first … last; the days between come along), or null
 * when there's nothing to fetch or it would span more than MAX_RANGE_DAYS (the caller then fetches day by day).
 */
export function doseRangeSpan(dates: readonly string[]): { from: string; to: string } | null {
  const sorted = dates.filter(isDate).sort();
  if (!sorted.length) return null;
  const from = sorted[0];
  const to = sorted[sorted.length - 1];
  return daysFrom(from, to) + 1 > MAX_RANGE_DAYS ? null : { from, to };
}

/**
 * The answer to `?from=&to=` as each local day's acted dose states (every day of the range, empty when nothing was
 * recorded), or null when it isn't the range answer — an older server answers with "due now" (no `from` / `to`).
 * `dateOf` gives a dose's local date when the server didn't send one.
 */
export function parseDoseRange(
  res: unknown,
  span: { from: string; to: string },
  dateOf: (scheduledFor: string) => string
): Record<string, PlanDoseState[]> | null {
  if (!res || typeof res !== 'object') return null;
  const r = res as DoseRangeResponse;
  if (r.from !== span.from || r.to !== span.to || !Array.isArray(r.doses)) return null;
  const days: Record<string, PlanDoseState[]> = {};
  for (let d = span.from, i = 0; d <= span.to && i <= MAX_RANGE_DAYS; i++) {
    days[d] = [];
    d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  }
  for (const x of r.doses) {
    if (!x || typeof x.medication_id !== 'string' || !x.medication_id || typeof x.scheduled_for !== 'string') continue;
    if (!Number.isFinite(Date.parse(x.scheduled_for))) continue;
    if (x.status !== 'taken' && x.status !== 'skipped' && x.status !== 'snoozed') continue;
    const date = isDate(x.local_date) ? x.local_date : dateOf(x.scheduled_for);
    const list = days[date];
    if (!list) continue; // outside the asked days
    list.push({
      medication_id: x.medication_id,
      scheduled_for: isoOf(x.scheduled_for),
      status: x.status,
      ...(x.acted_at ? { acted_at: x.acted_at } : {}),
      ...(x.snooze_until ? { snooze_until: x.snooze_until } : {}),
    });
  }
  return days;
}

/* ───────────────────────────── Missed ───────────────────────────── */

/** The fields of a dose (`DoseItem`) the missed rule reads. */
export interface DoseWhen {
  scheduled_for: string;
  status?: string;
  snooze_until?: string | null;
}

/**
 * Until when this dose may still ring (epoch ms): 60 min after its time, or after its snooze ended when that is later
 * (web `scheduledUntilMissed`, its `openUntil`). NaN for an unreadable time.
 */
export function doseRingsUntil(d: DoseWhen): number {
  const at = Date.parse(d.scheduled_for);
  const snoozeEnd = d.snooze_until ? Date.parse(d.snooze_until) : NaN;
  return Math.max(at, Number.isFinite(snoozeEnd) ? snoozeEnd : -Infinity) + MISSED_AFTER_MS;
}

/**
 * A dose that is missed on ÖRZA's terms at `now` (taken / skipped never are): the server says "missed", or it is
 * more than 60 min past its time / its snooze's end. It no longer rings — it shows as missed.
 */
export function isPastRinging(d: DoseWhen, now: number): boolean {
  if (d.status === 'taken' || d.status === 'skipped') return false;
  if (d.status === 'missed') return true;
  if (d.status === 'snoozed' || d.status === 'upcoming') return false;
  const until = doseRingsUntil(d);
  return Number.isFinite(until) && now > until;
}

/** An alarm that fires at `at` (a dose time, or a snooze's end) `now` still rings — no more than 60 min late. */
export const ringsAt = (at: number, now: number) => now - at <= MISSED_AFTER_MS;
