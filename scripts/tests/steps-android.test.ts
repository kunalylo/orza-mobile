/// <reference types="node" />
/**
 * Android step sources (`docs/notes/steps-v2.md` §2.1 S-A1…S-A4, S-H1/S-H2, S-R3/S-R4, M5f, M9) — `npm run test:steps`
 * runs this file next to the other steps tests. Pure: `androidSources.ts` holds every decision of
 * `reader.android.ts` (which phone counter runs, what Health Connect and the Recording API are asked for each day,
 * and how their answers become a day's readings); the reader only does the native calls.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { addDays, zonedToUtc } from '../../src/lib/alarms/schedule';
import {
  assembleDays,
  dayPlans,
  featuresOf,
  HC_PHONE_ORIGINS,
  hcAnswers,
  hcAsks,
  hcRanges,
  hcReading,
  phonePlan,
  recordingReadings,
  recordingTotalsRange,
  recordingWindowFor,
  samplerReadings,
  sinceRange,
  storeAccessOf,
  withSince,
  type DayPlan,
  type HcAnswer,
} from '../../src/lib/steps/androidSources';
import { dailyStepCounts, dayStartMs, stepsInRange, type StepSample } from '../../src/lib/steps/counter';
import { dayValue } from '../../src/lib/steps/merge';
import { firstAsk } from '../../src/lib/steps/plan';
import { RECORDING_KEEP_MS, recordingRange, type RecordingBucket } from '../../src/lib/steps/recording';
import type { SourceReading } from '../../src/lib/steps/types';

const IST = 'Asia/Kolkata';
const H = 3_600_000;
const ist = (date: string, time: string) => zonedToUtc(date, time, IST).getTime();

/** A past day (D) and today (T), read at 10:00 on T. */
const D = '2026-10-20';
const T = '2026-10-21';
const S = dayStartMs(D, IST);
const E = dayStartMs(T, IST);
const TS = E;
const TE = dayStartMs(addDays(T, 1), IST);
const NOW = ist(T, '10:00');

const planOf = (days: DayPlan[], date: string) => {
  const p = days.find((d) => d.date === date);
  assert.ok(p, `no plan for ${date}`);
  return p;
};

describe('dayPlans — what each day may be read over (M9)', () => {
  test('no floor: the whole day, today up to now', () => {
    const days = dayPlans([T, D], IST, NOW, null);
    assert.deepEqual(planOf(days, D), { date: D, start: S, end: E, read: { from: S, to: E } });
    assert.deepEqual(planOf(days, T), { date: T, start: TS, end: TE, read: { from: TS, to: NOW } });
  });

  test('a shared phone: from the consent on; a day that ended by then is not read at all', () => {
    const floor = ist(T, '07:30');
    const days = dayPlans([T, D], IST, NOW, floor);
    assert.deepEqual(planOf(days, T).read, { from: floor, to: NOW });
    assert.equal(planOf(days, D).read, null);
    assert.equal(planOf(dayPlans([D], IST, NOW, E), D).read, null, 'a day ending exactly at the floor');
  });
});

describe('phonePlan — which of the phone’s counters runs (S-A2, S-A3, S-A4)', () => {
  const SUB = ist('2026-10-15', '09:00');

  test('phone sources OFF (no consent, S-A3, no permission): nothing runs; a subscription is removed', () => {
    assert.deepEqual(phonePlan(false, 'available', null, false), { mode: 'off', unsubscribe: false });
    assert.deepEqual(phonePlan(false, 'available', SUB, false), { mode: 'off', unsubscribe: true });
  });

  test('Recording API available: subscribe when there is no subscription (or on prepare), else read it', () => {
    assert.deepEqual(phonePlan(true, 'available', null, false), { mode: 'subscribe', unsubscribe: false });
    assert.deepEqual(phonePlan(true, 'available', SUB, false), { mode: 'recording', unsubscribe: false });
    assert.deepEqual(phonePlan(true, 'available', SUB, true), { mode: 'subscribe', unsubscribe: false });
  });

  test('Play services missing or disabled: the sampler, and the dead subscription goes', () => {
    for (const status of ['missing', 'disabled'] as const) {
      assert.deepEqual(phonePlan(true, status, SUB, false), { mode: 'sampler', unsubscribe: true }, status);
      assert.deepEqual(phonePlan(true, status, null, false), { mode: 'sampler', unsubscribe: false }, status);
    }
  });

  test('Play services updating / not answering while subscribed: the API is ON but unread this run (no stale sampler)', () => {
    for (const status of ['update_required', 'unavailable'] as const) {
      assert.deepEqual(phonePlan(true, status, SUB, false), { mode: 'unread', unsubscribe: false }, status);
      assert.deepEqual(phonePlan(true, status, null, false), { mode: 'sampler', unsubscribe: false }, `${status}, never subscribed`);
    }
  });

  test('no step counter: nothing (S-R5)', () => {
    assert.deepEqual(phonePlan(true, 'no_sensor', null, false), { mode: 'off', unsubscribe: false });
  });
});

describe('featuresOf / storeAccessOf — what this phone has (§2.2)', () => {
  test('Health Connect’s SDK status → the store; extension 20 → stepTracking; Today asks accordingly', () => {
    assert.deepEqual(featuresOf('available', true, true), { platform: 'android', store: 'available', stepTracking: true, counter: true });
    assert.equal(firstAsk(featuresOf('available', true, true)), 'hc');
    assert.equal(firstAsk(featuresOf('available', false, true)), 'phone');
    assert.equal(featuresOf('needs_install', false, false).store, 'installable');
    assert.equal(featuresOf('needs_update', false, false).store, 'installable');
    assert.equal(firstAsk(featuresOf('needs_install', false, false)), 'hc');
    assert.equal(firstAsk(featuresOf('unsupported', false, false)), 'none');
  });

  test('the store’s steps access', () => {
    assert.equal(storeAccessOf('available', true), 'granted');
    assert.equal(storeAccessOf('available', false), 'not_granted');
    assert.equal(storeAccessOf('needs_install', false), 'needs_install');
    assert.equal(storeAccessOf('needs_update', false), 'needs_install');
    assert.equal(storeAccessOf('unsupported', false), 'unavailable');
  });
});

describe('Health Connect — what is asked (S-A1, S-H2, M5)', () => {
  const days = dayPlans([T, D], IST, NOW, null);

  test('each day’s total over its read range; nothing for a day that may not be read', () => {
    const asks = hcAsks(days, null);
    assert.deepEqual(
      asks.map((a) => [a.date, a.total, a.preGrant, a.since]),
      [
        [T, { start: TS, end: NOW }, null, null],
        [D, { start: S, end: E }, null, null],
      ]
    );
    assert.deepEqual(hcAsks(dayPlans([T, D], IST, NOW, ist(T, '07:30')), null).map((a) => a.date), [T]);
  });

  test('S-H2: the first grant’s day also asks for the part before the grant; other days don’t', () => {
    const grant = ist(T, '08:00');
    const asks = hcAsks(days, grant);
    assert.deepEqual(asks.find((a) => a.date === T)?.preGrant, { start: TS, end: grant });
    assert.equal(asks.find((a) => a.date === D)?.preGrant, null);
    assert.equal(hcAsks(days, TS).find((a) => a.date === T)?.preGrant, null, 'a grant at midnight sees the whole day');
  });

  test('a base’s count since its instant, on today and past days alike (S-R4); none when the base is at or before the range', () => {
    const at = ist(D, '15:00');
    const asks = hcAsks(days, null, { [D]: at, [T]: TS });
    assert.deepEqual(asks.find((a) => a.date === D)?.since, { at, range: { start: at, end: E } });
    assert.equal(asks.find((a) => a.date === T)?.since, null);
    const late = hcAsks(days, null, { [D]: E + H });
    assert.deepEqual(late.find((a) => a.date === D)?.since, { at: E + H, range: null }, 'nothing can be counted after the day');
  });

  test('one batch of ranges, answered back in order; a skipped read answers nothing', () => {
    const grant = ist(T, '08:00');
    const at = ist(D, '15:00');
    const asks = hcAsks(days, grant, { [D]: at });
    const ranges = hcRanges(asks);
    assert.deepEqual(ranges, [
      { start: TS, end: NOW },
      { start: TS, end: grant },
      { start: S, end: E },
      { start: at, end: E },
    ]);
    const total = (steps: number) => ({ steps, origins: [] });
    const answers = hcAnswers(asks, [total(1), total(2), total(3), null]);
    assert.deepEqual(answers, [
      { total: total(1), preGrant: total(2), since: null },
      { total: total(3), preGrant: null, since: null },
    ]);
    assert.deepEqual(hcAnswers(asks, null), [null, null]);
  });
});

describe('Health Connect — its readings (S-H1, S-H2, M4, M5f)', () => {
  const days = dayPlans([T, D], IST, NOW, null);
  const opts: { grantAt: number | null; stepTracking: boolean; now: number } = { grantAt: null, stepTracking: false, now: NOW };
  const total = (steps: number, origins: string[] = []) => ({ steps, origins });
  const read = (date: string, answer: HcAnswer | null, o = opts, sinceAt?: Record<string, number>) => {
    const ask = hcAsks(days, o.grantAt, sinceAt).find((a) => a.date === date);
    assert.ok(ask);
    return hcReading(planOf(days, date), ask, answer, o);
  };

  test('a count → the whole day; complete once the day is over', () => {
    assert.deepEqual(read(D, { total: total(8_000) }), {
      reading: { source: 'health_connect', steps: 8_000, coverFrom: S, complete: true },
      unread: false,
    });
    assert.equal(read(T, { total: total(900) }).reading?.complete, false);
  });

  test('S-H1: 0 is “nothing synced” — no reading, but the store was read', () => {
    assert.deepEqual(read(D, { total: total(0) }), { reading: null, unread: false });
  });

  test('M5f: a failed or skipped read is not “no data” — the day is marked unread', () => {
    assert.deepEqual(read(D, { total: null }), { reading: null, unread: true });
    assert.deepEqual(read(D, null), { reading: null, unread: true }, 'skipped (background without the permission)');
  });

  test('M4: it holds this phone’s steps when HC counts the phone itself (stepTracking) or a phone recorder wrote the day', () => {
    assert.equal(read(D, { total: total(8_000) }, { ...opts, stepTracking: true }).reading?.includesPhone, true);
    for (const origin of ['android', 'com.sec.android.app.shealth', 'com.google.android.apps.fitness']) {
      assert.ok(HC_PHONE_ORIGINS.has(origin), origin);
      assert.equal(read(D, { total: total(8_000, ['com.strava', origin]) }).reading?.includesPhone, true, origin);
    }
    const strava = read(D, { total: total(4_000, ['com.strava']) }).reading;
    assert.equal(strava?.includesPhone, undefined, 'a running app’s workouts never stand for the phone’s whole day');
    assert.deepEqual(strava?.origins, ['com.strava'], 'the apps come with it (labels)');
  });

  test('S-H2: on the first grant’s day, covered from the grant when HC had nothing before it; from midnight when it had', () => {
    const grantAt = ist(T, '08:00');
    const o = { ...opts, grantAt };
    assert.equal(read(T, { total: total(600), preGrant: total(0) }, o).reading?.coverFrom, grantAt);
    assert.equal(read(T, { total: total(2_600), preGrant: total(2_000) }, o).reading?.coverFrom, TS);
    assert.equal(read(T, { total: total(600), preGrant: null }, o).reading?.coverFrom, grantAt, 'unknown before → the grant (claims less)');
    assert.equal(read(D, { total: total(8_000) }, o).reading?.coverFrom, S, 'other days: whole');
  });

  test('a shared phone (M9): covered from the floor', () => {
    const floor = ist(T, '07:30');
    const plans = dayPlans([T], IST, NOW, floor);
    const ask = hcAsks(plans, null)[0];
    assert.deepEqual(ask.total, { start: floor, end: NOW });
    assert.equal(hcReading(plans[0], ask, { total: total(500) }, opts).reading?.coverFrom, floor);
  });

  test('the count since a base: measured for that very instant; nothing after the day → 0; a failed query → none', () => {
    const at = ist(D, '15:00');
    const since = (answer: HcAnswer, sinceAt: Record<string, number>) => read(D, answer, opts, sinceAt).reading?.since;
    assert.deepEqual(since({ total: total(8_000), since: total(3_000) }, { [D]: at }), { at, steps: 3_000 });
    assert.deepEqual(since({ total: total(8_000) }, { [D]: E + H }), { at: E + H, steps: 0 });
    assert.equal(since({ total: total(8_000), since: null }, { [D]: at }), undefined);
  });
});

/* ───────────────────────────── The phone ───────────────────────────── */

const BOOT = ist('2026-10-18', '08:00');
const sample = (date: string, time: string, counter: number): StepSample => {
  const ts = ist(date, time);
  return { ts, counter, boot: 1, elapsed: ts - BOOT };
};
/** One boot all along: D has 1 900 + 2 000 + 3 000 + 500 steps, plus its shares of the deltas across both midnights. */
const SAMPLES: StepSample[] = [
  sample('2026-10-19', '23:00', 1_000),
  sample(D, '00:10', 1_100),
  sample(D, '09:00', 3_000),
  sample(D, '12:00', 5_000),
  sample(D, '18:00', 8_000),
  sample(D, '23:55', 8_500),
  sample(T, '00:05', 8_600),
  sample(T, '09:50', 9_400),
];

describe('the sampler (S-A4)', () => {
  test('no floor, no base: the day counts as before (dailyStepCounts)', () => {
    const days = dayPlans([T, D], IST, NOW, null);
    const out = samplerReadings(SAMPLES, days, IST);
    const d = dailyStepCounts(SAMPLES, IST).get(D);
    assert.ok(d);
    assert.deepEqual(out.get(D), { source: 'phone', counter: 'sampler', steps: d.steps, coverFrom: S, complete: true });
    assert.deepEqual(out.get(T), { source: 'phone', counter: 'sampler', steps: 850, coverFrom: TS, complete: false });
  });

  test('a shared phone (M9): only steps from the floor on, covered from it; a day whose samples end before it → none', () => {
    const floor = ist(D, '12:00');
    const days = dayPlans([T, D], IST, ist(T, '10:00'), floor);
    const out = samplerReadings(SAMPLES, days, IST);
    assert.deepEqual(out.get(D), { source: 'phone', counter: 'sampler', steps: 3_000 + 500 + 50, coverFrom: floor, complete: true });
    const late = dayPlans([T], IST, NOW, ist(T, '09:55'));
    assert.equal(samplerReadings(SAMPLES, late, IST).get(T), undefined, 'no reading after 09:50 yet');
  });

  test('the count since a base (S-R4 alike): over [at, end) with the same day split; none when it covers only later', () => {
    const days = dayPlans([T, D], IST, NOW, null);
    const at = ist(D, '18:00');
    const out = samplerReadings(SAMPLES, days, IST, { [D]: at, [T]: TS - H });
    assert.deepEqual(out.get(D)?.since, { at, steps: 550 });
    assert.equal(out.get(D)?.since?.steps, stepsInRange(SAMPLES, IST, at, E));
    assert.equal(out.get(T)?.since, undefined, 'a base before the coverage: all of the count is after it');
  });
});

describe('the Recording API (S-A2, S-R3, S-R4)', () => {
  const SUB = ist('2026-10-15', '09:00');
  const days = dayPlans([T, D], IST, NOW, null);
  const window = recordingWindowFor(SUB, NOW, null);
  const BUCKETS: RecordingBucket[] = [
    { start: ist(D, '09:00'), end: ist(D, '09:15'), steps: 500 },
    { start: ist(D, '18:00'), end: ist(D, '18:15'), steps: 700 },
    { start: ist(T, '08:00'), end: ist(T, '08:15'), steps: 300 },
  ];

  test('the window: the subscription, now − 10 days, a shared phone’s floor — whichever is latest', () => {
    assert.deepEqual(window, { start: SUB, end: NOW });
    assert.deepEqual(recordingWindowFor(NOW - 30 * 24 * H, NOW, null), { start: NOW - RECORDING_KEEP_MS, end: NOW });
    assert.deepEqual(recordingWindowFor(SUB, NOW, ist(T, '07:30')), { start: ist(T, '07:30'), end: NOW });
  });

  test('one 15-min read from the earliest day read (or the window’s start) to now', () => {
    assert.deepEqual(recordingTotalsRange(days, window), recordingRange(S, NOW));
    const fresh = recordingWindowFor(ist(T, '07:07'), NOW, null);
    assert.deepEqual(recordingTotalsRange(days, fresh), recordingRange(ist(T, '07:07'), NOW));
    assert.equal(recordingTotalsRange(dayPlans([D], IST, NOW, E), window), null, 'no day to read');
  });

  test('buckets → day readings', () => {
    const { readings, unread } = recordingReadings(BUCKETS, days, IST, window);
    assert.deepEqual(readings.get(D), { source: 'phone', counter: 'recording', steps: 1_200, coverFrom: S, complete: true });
    assert.deepEqual(readings.get(T), { source: 'phone', counter: 'recording', steps: 300, coverFrom: TS, complete: false });
    assert.equal(unread.size, 0);
  });

  test('a failed read is no reading — and unread for each day the window reaches (M5f), not for days before it', () => {
    const old = '2026-10-14';
    const { readings, unread } = recordingReadings(null, dayPlans([T, D, old], IST, NOW, null), IST, window);
    assert.equal(readings.size, 0);
    assert.deepEqual([...unread].sort(), [D, T]);
  });

  test('a past day’s base: its 1-min count since the base, so the edit counts on (S-R4)', () => {
    const at = ist(D, '15:00');
    const plan = planOf(days, D);
    const ask = sinceRange(plan, S, at);
    assert.deepEqual(ask, { at, range: { start: at, end: E } });
    const range = recordingRange(at, E, 1);
    assert.equal(range?.startMs, at);
    const reading = withSince(recordingReadings(BUCKETS, days, IST, window).readings.get(D) as SourceReading, { at, steps: 700 });
    const day = assembleDays([plan], { phone: new Map([[D, reading]]) })[0];
    const v = dayValue(day, { kind: 'edit', steps: 5_000, at }, false);
    assert.ok(v);
    assert.deepEqual({ steps: v.steps, basis: v.basis, sinceUnknown: v.sinceUnknown }, { steps: 5_700, basis: 'edit', sinceUnknown: false });
    const blind = assembleDays([plan], { phone: recordingReadings(BUCKETS, days, IST, window).readings })[0];
    assert.equal(dayValue(blind, { kind: 'edit', steps: 5_000, at }, false)?.sinceUnknown, true, 'without it: a lower bound');
  });

  test('sinceRange: no base, or one at or before the coverage → nothing to ask; after the day → 0', () => {
    const plan = planOf(days, D);
    assert.equal(sinceRange(plan, S, undefined), null);
    assert.equal(sinceRange(plan, ist(D, '16:00'), ist(D, '15:00')), null);
    assert.deepEqual(sinceRange(plan, S, E), { at: E, range: null });
    assert.equal(sinceRange({ ...plan, read: null }, S, ist(D, '15:00')), null);
  });
});

describe('assembleDays — the day’s readings (M5f)', () => {
  const days = dayPlans([T, D], IST, NOW, null);
  const hc = (steps: number): SourceReading => ({ source: 'health_connect', steps, coverFrom: S, complete: true });
  const rec = (steps: number): SourceReading => ({ source: 'phone', counter: 'recording', steps, coverFrom: S, complete: true });

  test('every source’s reading, in the day’s bounds', () => {
    const out = assembleDays(days, { hc: new Map([[D, { reading: hc(8_000), unread: false }]]), phone: new Map([[D, rec(7_500)]]) });
    assert.deepEqual(out, [
      { date: T, start: TS, end: TE, sources: [] },
      { date: D, start: S, end: E, sources: [hc(8_000), rec(7_500)] },
    ]);
  });

  test('a store ON but unread, or the Recording API ON but unread → storeUnread (raise only, never final)', () => {
    const out = assembleDays(days, {
      hc: new Map([[T, { reading: null, unread: true }]]),
      phone: new Map([[D, rec(7_500)]]),
      phoneUnread: new Set([D]),
    });
    assert.equal(out[0].storeUnread, true);
    assert.equal(out[1].storeUnread, true);
    assert.equal(assembleDays(days, {})[1].storeUnread, undefined);
  });

  test('a day that may not be read (M9 floor) has no sources and is not unread', () => {
    const floored = dayPlans([D], IST, NOW, ist(T, '07:30'));
    assert.deepEqual(assembleDays(floored, { phoneUnread: new Set([D]) }), [{ date: D, start: S, end: E, sources: [] }]);
  });
});
