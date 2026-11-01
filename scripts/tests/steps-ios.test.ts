/// <reference types="node" />
/**
 * iPhone step sources (`docs/notes/steps-v2.md` §2.1 S-I1/S-I2, §2.2, §4.3, M0, M5, M5f, M9) — `npm run test:steps`
 * runs this file next to the other steps tests. Pure: `iosSources.ts` holds every decision of `reader.ios.ts` (what
 * Apple Health and CMPedometer are asked for each day, how their answers become a day's readings, when Apple Health's
 * background delivery is set up); the reader only does the native calls.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { addDays, zonedToUtc } from '../../src/lib/alarms/schedule';
import { dayStartMs } from '../../src/lib/steps/counter';
import {
  askAnswers,
  askRanges,
  backgroundChange,
  healthAsks,
  healthReading,
  iosDays,
  iosFeatures,
  iosStoreAccess,
  PEDOMETER_KEEP_MS,
  pedometerAsks,
  pedometerReading,
  readingsByDate,
  type DayAsk,
} from '../../src/lib/steps/iosSources';
import { dayValue } from '../../src/lib/steps/merge';
import { firstAsk, healthEmpty, isFinal, lookbackDays, SETTLE_PHONE_MS, SETTLE_STORE_MS, sourcesOn } from '../../src/lib/steps/plan';
import { dayPlans, type DayPlan } from '../../src/lib/steps/shared';
import type { DayReading, SourceReading } from '../../src/lib/steps/types';

const IST = 'Asia/Kolkata';
const H = 3_600_000;
const MIN = 60_000;
const ist = (date: string, time: string) => zonedToUtc(date, time, IST).getTime();

/** A past day (D) and today (T), read at 10:00 on T. */
const D = '2026-10-20';
const T = '2026-10-21';
const S = dayStartMs(D, IST);
const E = dayStartMs(T, IST);
const TS = E;
const NOW = ist(T, '10:00');

const planOf = (days: DayPlan[], date: string) => {
  const p = days.find((d) => d.date === date);
  assert.ok(p, `no plan for ${date}`);
  return p;
};
const askOf = (asks: DayAsk[], date: string) => {
  const a = asks.find((x) => x.date === date);
  assert.ok(a, `no ask for ${date}`);
  return a;
};

/* ───────────────────────────── §2.1 / §2.2 ───────────────────────────── */

describe('what this iPhone has (§2.2) and which sources are ON (S-I1, S-I2)', () => {
  test('Apple Health available → Today asks Apple Health first; without it, the motion sensor; else nothing', () => {
    assert.deepEqual(iosFeatures(true, true), { platform: 'ios', store: 'available', counter: true });
    assert.equal(firstAsk(iosFeatures(true, true)), 'healthkit');
    assert.equal(firstAsk(iosFeatures(true, false)), 'healthkit');
    assert.equal(firstAsk(iosFeatures(false, true)), 'phone', 'no HealthKit (Expo Go, a restricted device): Motion');
    assert.equal(firstAsk(iosFeatures(false, false)), 'none');
  });

  test('the store access: granted = the StepCount sheet was answered (HealthKit hides a refusal); never "install"', () => {
    assert.equal(iosStoreAccess(true, true), 'granted');
    assert.equal(iosStoreAccess(true, false), 'not_granted');
    assert.equal(iosStoreAccess(false, true), 'unavailable');
    assert.equal(iosStoreAccess(false, false), 'unavailable');
  });

  test('CMPedometer only with the member’s phone consent (the fallback offer); the lookbacks 30 / 7', () => {
    const f = iosFeatures(true, true);
    const both = { consent: { store: true, phone: true }, storeGranted: true, phoneGranted: true };
    assert.deepEqual(sourcesOn(f, { ...both, consent: { store: true, phone: false } }), ['store']);
    assert.deepEqual(sourcesOn(f, both), ['store', 'pedometer']);
    assert.deepEqual(sourcesOn(f, { ...both, storeGranted: false }), ['pedometer'], 'sheet never answered: Health is not ON');
    assert.deepEqual(sourcesOn(f, { ...both, phoneGranted: false }), ['store']);
    assert.equal(lookbackDays(['store', 'pedometer']), 30);
    assert.equal(lookbackDays(['pedometer']), 7);
  });
});

/* ───────────────────────────── Asks ───────────────────────────── */

describe('Apple Health asks (S-I1, M5, M9)', () => {
  test('every day that may be read: its whole range, today up to now (HealthKit keeps the history from before the grant)', () => {
    const asks = healthAsks(dayPlans([T, D], IST, NOW));
    assert.deepEqual(askOf(asks, T), { date: T, total: { start: TS, end: NOW }, since: null });
    assert.deepEqual(askOf(asks, D), { date: D, total: { start: S, end: E }, since: null });
  });

  test('a base’s count since its instant, today and past days; none when the source only covers from it', () => {
    const at = { [D]: ist(D, '14:00'), [T]: ist(T, '08:00') };
    const asks = healthAsks(dayPlans([T, D], IST, NOW), at);
    assert.deepEqual(askOf(asks, D).since, { at: at[D], range: { start: at[D], end: E } });
    assert.deepEqual(askOf(asks, T).since, { at: at[T], range: { start: at[T], end: NOW } });
    assert.equal(askOf(healthAsks(dayPlans([D], IST, NOW), { [D]: S }), D).since, null, 'a base at midnight: all of it is since');
    assert.deepEqual(askOf(healthAsks(dayPlans([T], IST, NOW), { [T]: NOW + MIN }), T).since, { at: NOW + MIN, range: null }, 'nothing after it yet: 0');
  });

  test('M9: a shared iPhone reads nothing from before the member’s consent', () => {
    const floor = ist(T, '09:00');
    const days = dayPlans([T, D], IST, NOW, floor);
    assert.equal(planOf(days, D).read, null);
    const asks = healthAsks(days, { [T]: ist(T, '08:00') });
    assert.equal(asks.length, 1, 'no ask for a day that ended before the floor');
    assert.deepEqual(asks[0], { date: T, total: { start: floor, end: NOW }, since: null });
  });
});

describe('CMPedometer asks (S-I2: it keeps 7 days)', () => {
  test('only days that start at most 7 days back; a base’s count since, like Apple Health', () => {
    const dates = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => addDays(T, -i));
    const asks = pedometerAsks(dayPlans(dates, IST, NOW), NOW);
    assert.deepEqual(
      asks.map((a) => a.date),
      dates.slice(0, 7),
      'today and 6 past days (the 7th started 7 days 10 h ago)'
    );
    for (const a of asks) assert.ok(NOW - a.total.start <= PEDOMETER_KEEP_MS);
    const since = pedometerAsks(dayPlans([D], IST, NOW), NOW, { [D]: ist(D, '14:00') });
    assert.deepEqual(since[0].since, { at: ist(D, '14:00'), range: { start: ist(D, '14:00'), end: E } });
  });

  test('a shared iPhone’s floor inside the 7 days: read from it', () => {
    const floor = ist(addDays(T, -7), '12:00');
    const asks = pedometerAsks(dayPlans([addDays(T, -7)], IST, NOW, floor), NOW);
    assert.deepEqual(asks.map((a) => a.total.start), [floor]);
  });
});

describe('askRanges / askAnswers — one batch per source, answered back per day', () => {
  const asks: DayAsk[] = [
    { date: T, total: { start: TS, end: NOW }, since: { at: TS + H, range: { start: TS + H, end: NOW } } },
    { date: D, total: { start: S, end: E }, since: { at: E, range: null } },
  ];

  test('per ask its total, then its since range when there is one', () => {
    assert.deepEqual(askRanges(asks), [
      { start: TS, end: NOW },
      { start: TS + H, end: NOW },
      { start: S, end: E },
    ]);
  });

  test('answers back in order; a skipped / failed batch → every answer null', () => {
    assert.deepEqual(askAnswers(asks, [5_000, 1_200, 8_000]), [
      { total: 5_000, since: 1_200 },
      { total: 8_000, since: null },
    ]);
    assert.deepEqual(askAnswers(asks, [null, null, 8_000]), [
      { total: null, since: null },
      { total: 8_000, since: null },
    ]);
    assert.deepEqual(askAnswers(asks, null), [null, null]);
  });
});

/* ───────────────────────────── Readings ───────────────────────────── */

describe('Apple Health readings (S-I1, M0, M5f)', () => {
  const days = dayPlans([T, D], IST, NOW);
  const past = planOf(days, D);
  const today = planOf(days, T);
  const ask = (day: DayPlan, at?: number) => askOf(healthAsks([day], at == null ? undefined : { [day.date]: at }), day.date);

  test('a count → the store’s reading over the whole day (complete once it ended)', () => {
    assert.deepEqual(healthReading(past, ask(past), { total: 8_000.4, since: null }, NOW), {
      reading: { source: 'apple_health', steps: 8_000, coverFrom: S, complete: true },
      unread: false,
    });
    assert.deepEqual(healthReading(today, ask(today), { total: 3_000, since: null }, NOW).reading, {
      source: 'apple_health',
      steps: 3_000,
      coverFrom: TS,
      complete: false,
    });
  });

  test('0 = no steps for ÖRZA (none recorded, or the read was refused — HealthKit hides which): no reading, not unread', () => {
    assert.deepEqual(healthReading(past, ask(past), { total: 0, since: null }, NOW), { reading: null, unread: false });
  });

  test('a failed query (the phone locked: the store is encrypted) or a skipped read → unread, never "no data"', () => {
    assert.deepEqual(healthReading(past, ask(past), { total: null, since: null }, NOW), { reading: null, unread: true });
    assert.deepEqual(healthReading(past, ask(past), null, NOW), { reading: null, unread: true });
  });

  test('since: measured for the base’s very instant; 0 when nothing can follow it; unknown when that query failed', () => {
    const at = ist(D, '14:00');
    assert.deepEqual(healthReading(past, ask(past, at), { total: 8_000, since: 2_500 }, NOW).reading?.since, { at, steps: 2_500 });
    const late = askOf(healthAsks([today], { [T]: NOW + MIN }), T);
    assert.deepEqual(healthReading(today, late, { total: 3_000, since: null }, NOW).reading?.since, { at: NOW + MIN, steps: 0 });
    const blind = healthReading(past, ask(past, at), { total: 8_000, since: null }, NOW).reading;
    assert.ok(blind);
    assert.equal(blind.since, undefined);
    const value = dayValue({ date: D, start: S, end: E, sources: [blind] }, { kind: 'edit', steps: 6_000, at }, false);
    assert.equal(value?.sinceUnknown, true, 'a lower bound: it may raise the day, never lower or settle it');
  });

  test('a shared iPhone’s floor: covered from it', () => {
    const floor = ist(T, '09:00');
    const day = planOf(dayPlans([T], IST, NOW, floor), T);
    assert.equal(healthReading(day, ask(day), { total: 900, since: null }, NOW).reading?.coverFrom, floor);
  });
});

describe('CMPedometer readings (S-I2, M0, M7)', () => {
  const days = dayPlans([T, D], IST, NOW);
  const past = planOf(days, D);
  const today = planOf(days, T);
  const ask = (day: DayPlan, at?: number) => askOf(pedometerAsks([day], NOW, at == null ? undefined : { [day.date]: at }), day.date);

  test('a phone reading, a real 0 included (it counted the time)', () => {
    assert.deepEqual(pedometerReading(today, ask(today), { total: 0, since: null }, NOW), {
      reading: { source: 'phone', counter: 'pedometer', steps: 0, coverFrom: TS, complete: false },
      unread: false,
    });
  });

  test('complete (may settle a phone-only past day, M7) an hour after the day ended', () => {
    assert.equal(pedometerReading(past, ask(past), { total: 7_000, since: null }, E + SETTLE_PHONE_MS - MIN).reading?.complete, false);
    assert.equal(pedometerReading(past, ask(past), { total: 7_000, since: null }, E + SETTLE_PHONE_MS).reading?.complete, true);
  });

  test('a failed query → unread (the same lower bound as Android’s Recording API)', () => {
    assert.deepEqual(pedometerReading(past, ask(past), { total: null, since: null }, NOW), { reading: null, unread: true });
    assert.deepEqual(pedometerReading(past, ask(past), null, NOW), { reading: null, unread: true });
  });

  test('since', () => {
    const at = ist(D, '18:00');
    assert.deepEqual(pedometerReading(past, ask(past, at), { total: 7_000, since: 1_000.6 }, NOW).reading?.since, { at, steps: 1_001 });
    assert.equal(pedometerReading(past, ask(past, at), { total: 7_000, since: null }, NOW).reading?.since, undefined);
  });
});

/* ───────────────────────────── The day ───────────────────────────── */

describe('the day readings (iosDays)', () => {
  const days = dayPlans([T, D], IST, NOW);
  const health = (steps: number, coverFrom = S): SourceReading => ({ source: 'apple_health', steps, coverFrom, complete: true });
  const motion = (steps: number, coverFrom = S): SourceReading => ({ source: 'phone', counter: 'pedometer', steps, coverFrom, complete: true });

  test('Apple Health first, then the motion sensor; unread when either source that is ON wasn’t read', () => {
    const out = iosDays(days, {
      health: new Map([[D, { reading: health(8_000), unread: false }]]),
      phone: new Map([
        [D, { reading: motion(8_700), unread: false }],
        [T, { reading: null, unread: true }],
      ]),
    });
    assert.deepEqual(out[1], { date: D, start: S, end: E, sources: [health(8_000), motion(8_700)] });
    assert.equal(out[0].storeUnread, true);
    const locked = iosDays(days, { health: new Map([[D, { reading: null, unread: true }]]) });
    assert.equal(locked[1].storeUnread, true);
    assert.equal(locked[0].storeUnread, undefined);
  });

  test('a day that may not be read (M9) has no sources and is never unread', () => {
    const floored = dayPlans([D], IST, NOW, ist(T, '09:00'));
    assert.deepEqual(iosDays(floored, { health: new Map([[D, { reading: null, unread: true }]]) }), [{ date: D, start: S, end: E, sources: [] }]);
  });

  test('merge: a past day follows Apple Health even when the motion sensor counted more (C3, T9); today the higher (M3)', () => {
    const [today, past] = iosDays(days, {
      health: new Map([
        [D, { reading: health(8_000), unread: false }],
        [T, { reading: { ...health(3_000, TS), complete: false }, unread: false }],
      ]),
      phone: new Map([
        [D, { reading: motion(8_700), unread: false }],
        [T, { reading: { ...motion(3_400, TS), complete: false }, unread: false }],
      ]),
    });
    assert.equal(dayValue(past, null, false)?.steps, 8_000);
    assert.equal(dayValue(today, null, true)?.steps, 3_400);
  });

  test('M7: an unread Apple Health day is never final, not even after 72 h; a motion-only 0 is not final while Health is ON', () => {
    const late = E + SETTLE_STORE_MS + H;
    const unread = iosDays(dayPlans([D], IST, late), { health: new Map([[D, { reading: null, unread: true }]]) })[0];
    assert.equal(isFinal(unread, undefined, late, true), false);
    const zero = iosDays(dayPlans([D], IST, E + 2 * H), { phone: new Map([[D, { reading: motion(0), unread: false }]]) })[0];
    assert.equal(isFinal(zero, undefined, E + 2 * H, true), false);
    assert.equal(isFinal(zero, undefined, E + 2 * H, false), true, 'motion only: settled an hour after midnight');
  });

  test('readingsByDate: each ask’s answer read per day', () => {
    const asks = healthAsks(days);
    const map = readingsByDate(days, asks, askAnswers(asks, askRanges(asks).map(() => 1_000)), healthReading, NOW);
    assert.equal(map.get(D)?.reading?.steps, 1_000);
    assert.equal(map.get(T)?.reading?.coverFrom, TS);
  });
});

/* ───────────────────────────── Health empty (§2.2) ───────────────────────────── */

describe('healthEmpty with Apple Health unread (R4)', () => {
  const today = '2026-10-31';
  const week = (unreadAt?: number): DayReading[] =>
    [0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
      const date = addDays(today, -i);
      const day: DayReading = { date, start: dayStartMs(date, IST), end: dayStartMs(addDays(date, 1), IST), sources: [] };
      return i === unreadAt ? { ...day, storeUnread: true } : day;
    });

  test('a week read with no Apple Health count → empty; one day the store couldn’t be read (locked) → not proven', () => {
    assert.equal(healthEmpty(today, week()), true);
    assert.equal(healthEmpty(today, week(0)), false);
    assert.equal(healthEmpty(today, week(5)), false);
  });
});

/* ───────────────────────────── Background delivery (§4.3) ───────────────────────────── */

describe('Apple Health background delivery follows the store being ON (§4.3)', () => {
  test('set up once when the store comes ON, cleared once when it goes OFF, otherwise left alone', () => {
    assert.equal(backgroundChange(true, false), 'configure');
    assert.equal(backgroundChange(true, true), null, 'configuring again would drop the JS observer');
    assert.equal(backgroundChange(false, true), 'clear');
    assert.equal(backgroundChange(false, false), null);
  });
});
