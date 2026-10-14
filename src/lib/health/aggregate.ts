/**
 * Pure helpers shared by the Apple Health and Health Connect readers: local dates, value cleaning and
 * "sleep credited to the morning you woke up". No native imports — safe on every platform.
 */
import { HEALTH_METRICS, METRIC_INFO, type HealthDayInput, type HealthDayValues, type HealthMetric } from './types';

const pad = (n: number) => String(n).padStart(2, '0');

/** Device-local calendar day of an instant: `YYYY-MM-DD`. */
export function localDate(d: Date | number): string {
  const x = typeof d === 'number' ? new Date(d) : d;
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}

/** Local midnight `days - 1` days before today (so `days` = 30 covers today and the 29 days before it). */
export function rangeStart(days: number, now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1), 0, 0, 0, 0);
}

/** Every local date from `start` up to and including today. */
export function datesSince(start: Date, now = new Date()): string[] {
  const out: string[] = [];
  const last = localDate(now);
  for (let i = 0; i < 800; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const s = localDate(d);
    out.push(s);
    if (s >= last) break;
  }
  return out;
}

function roundTo(n: number, digits: number) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** A metric value in canonical units, rounded the way the server stores it, or undefined when missing / out of range. */
export function cleanMetric(metric: HealthMetric, value: number | null | undefined): number | undefined {
  if (value == null || !Number.isFinite(value)) return undefined;
  const info = METRIC_INFO[metric];
  const r = roundTo(value, info.digits);
  if (r < info.min || r > info.max) return undefined;
  return r;
}

/** Collects metric values per local date. */
export class DayCollector {
  private readonly days = new Map<string, HealthDayValues>();

  constructor(private readonly allowed: ReadonlySet<string>) {}

  /** Ignores dates outside the sync window and non-positive values (readers report "no data" as 0). */
  set(date: string, metric: HealthMetric, value: number | null | undefined) {
    if (!this.allowed.has(date) || value == null || !Number.isFinite(value) || value <= 0) return;
    const day = this.days.get(date) ?? {};
    day[metric] = value;
    this.days.set(date, day);
  }

  /** Cleaned rows, oldest first, only days with at least one usable value. */
  rows(): HealthDayInput[] {
    const out: HealthDayInput[] = [];
    for (const date of [...this.days.keys()].sort()) {
      const raw = this.days.get(date)!;
      const row: HealthDayInput = { date };
      let any = false;
      for (const m of HEALTH_METRICS) {
        const v = cleanMetric(m, raw[m]);
        if (v !== undefined) {
          row[m] = v;
          any = true;
        }
      }
      if (any) out.push(row);
    }
    return out;
  }
}

/* ───────────────────────────── Sleep ───────────────────────────── */

export interface SleepInterval {
  /** The app / device that recorded it (bundle id or Health Connect data origin). */
  source: string;
  /** Epoch ms. */
  start: number;
  end: number;
}

/** Asleep intervals closer than this belong to the same night. */
const SESSION_GAP_MS = 3 * 60 * 60 * 1000;

/**
 * Minutes asleep per wake-up date. Per source: overlapping intervals are merged (no double counting), merged pieces
 * are grouped into sessions (gaps ≤ 3 h) and each session's minutes go to the local date it ended on. Several sources
 * for the same night (phone + watch) never add up — the date keeps the largest source total, like the web importer.
 */
export function sleepMinutesByWakeDate(intervals: readonly SleepInterval[]): Map<string, number> {
  const bySource = new Map<string, [number, number][]>();
  for (const it of intervals) {
    if (!(it.end > it.start)) continue;
    const list = bySource.get(it.source) ?? [];
    list.push([it.start, it.end]);
    bySource.set(it.source, list);
  }

  const best = new Map<string, number>();
  for (const list of bySource.values()) {
    list.sort((a, b) => a[0] - b[0]);
    // Union of overlapping pieces.
    const merged: [number, number][] = [];
    for (const [s, e] of list) {
      const last = merged[merged.length - 1];
      if (last && s <= last[1]) last[1] = Math.max(last[1], e);
      else merged.push([s, e]);
    }
    // Sessions → wake-up date.
    const totals = new Map<string, number>();
    let sessionMs = 0;
    let sessionEnd = 0;
    const flush = () => {
      if (sessionMs > 0) {
        const date = localDate(sessionEnd);
        totals.set(date, (totals.get(date) ?? 0) + sessionMs / 60_000);
      }
      sessionMs = 0;
    };
    for (const [s, e] of merged) {
      if (sessionMs > 0 && s - sessionEnd > SESSION_GAP_MS) flush();
      sessionMs += e - s;
      sessionEnd = e;
    }
    flush();
    for (const [date, minutes] of totals) best.set(date, Math.max(best.get(date) ?? 0, minutes));
  }
  return best;
}
