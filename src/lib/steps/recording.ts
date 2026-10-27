/**
 * The Recording API on mobile (Google Play services `LocalRecordingClient`, read by `modules/orza-steps`): its step
 * buckets turned into the member's days. Pure — no React Native imports — so `npm run test:steps` runs it in Node.
 *
 * - Day totals come from 15-minute buckets aligned to UTC quarter-hours (`recordingRange`). Every real UTC offset is a
 *   multiple of 15 min (+05:30 India, +05:45 Nepal, DST days too), so a bucket never straddles a profile-zone
 *   midnight; one that does anyway is split by time. Never Google's sample `bucketByTime(1, DAYS)`: those are rolling
 *   24-h windows, not local days (S-R1, S-R6). A base's "counted since" uses 1-minute buckets (S-R4).
 * - The read's time range is inclusive at both ends: it ends at `end − 1` (S-R2).
 * - The API keeps 10 days and has nothing from before ÖRZA subscribed, so only data inside
 *   W = [max(subscribedAt, now − 10 d), now] counts. A day entirely before W has no reading (null, never 0); a day
 *   straddling W's start is covered from there; a day inside W with no buckets is a real 0 (S-R3).
 * - Its numbers are never filtered (no MAX_STEPS_PER_HOUR): they are the platform's own (C13).
 */
import { addDays, safeTimeZone } from '../alarms/schedule';

import { dayStartMs } from './counter';
import type { SourceReading } from './types';

/** One bucket of the native read: steps counted in [start, end) (epoch ms). The read returns non-zero buckets only. */
export interface RecordingBucket {
  start: number;
  end: number;
  steps: number;
}

/** What to ask the native read for: [startMs, lastMs] — both inclusive — in buckets of `bucketMinutes`. */
export interface RecordingRange {
  startMs: number;
  lastMs: number;
  bucketMinutes: number;
}

/** Day totals are read in buckets of this many minutes (S-R1). */
export const RECORDING_BUCKET_MINUTES = 15;
/** How much history the API keeps. */
export const RECORDING_KEEP_MS = 10 * 24 * 3_600_000;
/**
 * A past day is `complete` on a read at least this long after it ended: how soon steps reach a read isn't documented
 * (C9.4) — re-check after the device tests (§8.2).
 */
export const RECORDING_FRESH_MS = 60 * 60_000;

const MIN_MS = 60_000;

/**
 * The native read range for the instants [start, end): the start floored to a UTC multiple of `bucketMinutes` (a
 * quarter-hour; a minute for bases) so the buckets line up with local midnights, and the end given as its last
 * millisecond (the read's end is inclusive — the native side passes `lastMs` as is). Null when there is nothing to read.
 */
export function recordingRange(start: number, end: number, bucketMinutes = RECORDING_BUCKET_MINUTES): RecordingRange | null {
  if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) return null;
  const minutes = Math.max(1, Math.round(bucketMinutes));
  const size = minutes * MIN_MS;
  return { startMs: Math.floor(start / size) * size, lastMs: end - 1, bucketMinutes: minutes };
}

/** The instants whose data counts: from the later of the subscription and now − 10 days, to now (S-R3). */
export function recordingWindow(subscribedAt: number, now: number): { start: number; end: number } {
  return { start: Math.max(subscribedAt, now - RECORDING_KEEP_MS), end: now };
}

const validBucket = (b: RecordingBucket) => Number.isFinite(b.start) && Number.isFinite(b.end) && Number.isFinite(b.steps) && b.steps > 0;

/** The part of bucket `b` inside [from, to), prorated by time (a zero-length bucket counts whole when it lies inside). */
function share(b: RecordingBucket, from: number, to: number): number {
  if (!(b.end > b.start)) return b.start >= from && b.start < to ? b.steps : 0;
  const overlap = Math.min(b.end, to) - Math.max(b.start, from);
  if (overlap <= 0) return 0;
  return overlap >= b.end - b.start ? b.steps : (b.steps * overlap) / (b.end - b.start);
}

/**
 * The Recording API's reading for each of `dates` (local days in `timeZone`) from 15-min `buckets`, within `window`
 * (`recordingWindow`): null for a day outside it, else the day's steps from `coverFrom` (the day's start, or the
 * window's start on the day it falls in). `complete` once the read is RECORDING_FRESH_MS past the day's end.
 */
export function recordingDays(
  buckets: readonly RecordingBucket[],
  dates: readonly string[],
  timeZone: string,
  window: { start: number; end: number }
): Map<string, SourceReading | null> {
  const tz = safeTimeZone(timeZone);
  const open = window.end > window.start;
  // Data outside the window never counts (it can't be there, or is older than the API's history and partly gone).
  const inWindow = buckets.filter((b) => validBucket(b) && b.end > window.start && b.start < window.end);
  const out = new Map<string, SourceReading | null>();
  for (const date of dates) {
    const s = dayStartMs(date, tz);
    const e = dayStartMs(addDays(date, 1), tz);
    if (!open || e <= window.start || s >= window.end) {
      out.set(date, null);
      continue;
    }
    const steps = inWindow.reduce((sum, b) => sum + share(b, s, e), 0);
    out.set(date, {
      source: 'phone',
      counter: 'recording',
      steps: Math.round(steps),
      coverFrom: Math.max(s, window.start),
      complete: window.end >= e + RECORDING_FRESH_MS,
    });
  }
  return out;
}

/**
 * Steps from 1-min `buckets` during [at, end), `at` floored to the minute like `recordingRange(at, end, 1)` (S-R4): a
 * base's "counted since" (M5). The API has nothing from before the subscription, so the sum never reaches before the
 * source's coverage.
 */
export function recordingSince(buckets: readonly RecordingBucket[], at: number, end: number): number {
  const from = Math.floor(at / MIN_MS) * MIN_MS;
  if (!(end > from)) return 0;
  let sum = 0;
  for (const b of buckets) if (validBucket(b)) sum += share(b, from, end);
  return Math.round(sum);
}
