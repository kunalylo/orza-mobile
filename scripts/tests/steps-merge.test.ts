/// <reference types="node" />
/**
 * Steps v2 merge rules (`docs/notes/steps-v2.md` §2.3) — `npm run test:steps` runs this file next to
 * `steps-counter.test.ts`. Pure: `merge.ts` has no React Native imports.
 *
 * T8–T15: which source decides a day (M0–M4), Health Connect's first-grant coverage (S-H2), the shared-phone coverage
 * floor (M9).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { addDays, zonedToUtc } from '../../src/lib/alarms/schedule';
import { dayStartMs } from '../../src/lib/steps/counter';
import { applyCoverFloor, autoCount, hcCoverFrom, phoneWinner } from '../../src/lib/steps/merge';
import type { DayReading, SourceReading } from '../../src/lib/steps/types';

const IST = 'Asia/Kolkata';
const H = 3_600_000;
const ist = (date: string, time: string) => zonedToUtc(date, time, IST).getTime();

const D = '2026-10-20';
const S = dayStartMs(D, IST);
const E = dayStartMs(addDays(D, 1), IST);

/** Day `date` (IST) read with `sources`. */
const dayOf = (sources: SourceReading[], date = D): DayReading => ({
  date,
  start: dayStartMs(date, IST),
  end: dayStartMs(addDays(date, 1), IST),
  sources,
});

const hc = (steps: number, coverFrom = S, extra: Partial<SourceReading> = {}): SourceReading => ({ source: 'health_connect', steps, coverFrom, ...extra });
const health = (steps: number, coverFrom = S): SourceReading => ({ source: 'apple_health', steps, coverFrom });
const phone =
  (counter: 'recording' | 'sampler' | 'pedometer') =>
  (steps: number, coverFrom = S, extra: Partial<SourceReading> = {}): SourceReading => ({ source: 'phone', counter, steps, coverFrom, ...extra });
const recording = phone('recording');
const sampler = phone('sampler');
const pedometer = phone('pedometer');

/** The winner's count and who it came from, for compact asserts. */
const pick = (r: SourceReading | null) => (r ? `${r.source}${r.counter ? `/${r.counter}` : ''} ${r.steps}${r.estimated ? ` (~${r.estimated})` : ''}` : null);

/* ───────────────────────────── M3: today ───────────────────────────── */

describe('merge — today: the live tail (T8, M3)', () => {
  test('today shows the higher of the store and the phone; a tie gets the store’s label', () => {
    assert.equal(pick(autoCount(dayOf([hc(5_000), recording(5_200)]), true)), 'phone/recording 5200');
    assert.equal(pick(autoCount(dayOf([hc(5_200), recording(5_000)]), true)), 'health_connect 5200');
    assert.equal(pick(autoCount(dayOf([hc(5_000), recording(5_000)]), true)), 'health_connect 5000', 'tie → the store');
    assert.equal(pick(autoCount(dayOf([health(7_000), pedometer(7_000)]), true)), 'apple_health 7000');
  });

  test('the order the sources are listed in never matters', () => {
    assert.equal(pick(autoCount(dayOf([recording(5_000), hc(5_000)]), true)), 'health_connect 5000');
    assert.equal(pick(autoCount(dayOf([recording(5_200), hc(5_000)]), true)), 'phone/recording 5200');
  });

  test('the winner’s own flags come with it', () => {
    const live = recording(5_200, ist(D, '13:00'), { complete: false });
    assert.deepEqual(autoCount(dayOf([hc(5_000), live]), true), live);
  });
});

/* ───────────────────────────── M4: past days ───────────────────────────── */

describe('merge — past days follow the store (T9, T10, M4, C3)', () => {
  test('T9: the store wins a past day it covers from as early as the phone, even when the phone is higher', () => {
    // Samsung Health (watch prioritised) 8 000, the sampler 8 700 on a bumpy ride: the day is what Samsung Health shows.
    assert.equal(pick(autoCount(dayOf([hc(8_000), sampler(8_700)]), false)), 'health_connect 8000');
    assert.equal(pick(autoCount(dayOf([health(8_000), pedometer(8_700)]), false)), 'apple_health 8000');
    // The same readings today: the live tail takes the phone's higher count.
    assert.equal(pick(autoCount(dayOf([hc(8_000), sampler(8_700)]), true)), 'phone/sampler 8700');
    // A phone that only covers part of the day can't overrule a whole-day store either.
    assert.equal(pick(autoCount(dayOf([hc(8_000), recording(9_000, ist(D, '06:00'))]), false)), 'health_connect 8000');
  });

  test('T10: on the store’s partial first day (HC granted at 14:00, nothing before) the larger by real steps wins', () => {
    const grant = ist(D, '14:00');
    const firstDay = hc(4_000, hcCoverFrom({ start: S, end: E }, grant, 0));
    assert.equal(firstDay.coverFrom, grant);
    assert.equal(pick(autoCount(dayOf([firstDay, recording(9_000)]), false)), 'phone/recording 9000', 'the whole-day phone count');
    assert.equal(pick(autoCount(dayOf([firstDay, recording(3_500)]), false)), 'health_connect 4000');
    // A whole-day phone count that is mostly an estimate loses to the real partial store count.
    assert.equal(pick(autoCount(dayOf([firstDay, sampler(9_000, S, { estimated: 6_000 })]), false)), 'health_connect 4000');
    // Equal real steps: the store.
    assert.equal(pick(autoCount(dayOf([firstDay, recording(4_000)]), false)), 'health_connect 4000');
  });

  test('a store that covers less of the day than the phone does not get the past day by default', () => {
    // Recording subscribed at 08:00, HC on-device from 14:00: both partial, the earlier coverage decides by real steps.
    assert.equal(pick(autoCount(dayOf([hc(4_000, ist(D, '14:00')), recording(7_000, ist(D, '08:00'))]), false)), 'phone/recording 7000');
    // HC covering from 08:00 too (the same instant): store-authoritative again.
    assert.equal(pick(autoCount(dayOf([hc(4_000, ist(D, '08:00')), recording(7_000, ist(D, '08:00'))]), false)), 'health_connect 4000');
  });
});

/* ───────────────────────────── M0: null and 0 ───────────────────────────── */

describe('merge — null and 0 (T11, M0)', () => {
  test('a store 0 is no data; a phone-only day is the phone’s', () => {
    assert.equal(autoCount(dayOf([hc(0)]), true), null);
    assert.equal(autoCount(dayOf([health(0)]), false), null);
    assert.equal(pick(autoCount(dayOf([hc(0), recording(300)]), false)), 'phone/recording 300');
    assert.equal(pick(autoCount(dayOf([sampler(4_321)]), false)), 'phone/sampler 4321');
    assert.equal(autoCount(dayOf([]), true), null);
  });

  test('a phone source keeps a real 0 for time it covered (a day without walking)', () => {
    assert.equal(pick(autoCount(dayOf([recording(0)]), false)), 'phone/recording 0');
    assert.equal(pick(autoCount(dayOf([hc(0), recording(0)]), true)), 'phone/recording 0');
  });

  test('unusable readings never win: not finite, negative; counts are rounded, estimates kept within the count', () => {
    assert.equal(autoCount(dayOf([hc(Number.NaN), recording(-5)]), true), null);
    assert.equal(pick(autoCount(dayOf([hc(Number.POSITIVE_INFINITY), recording(99.6)]), true)), 'phone/recording 100');
    assert.equal(pick(autoCount(dayOf([sampler(1_000, S, { estimated: 5_000 })]), false)), 'phone/sampler 1000 (~1000)');
    assert.equal(pick(autoCount(dayOf([sampler(1_000, S, { estimated: -3 })]), false)), 'phone/sampler 1000');
  });
});

/* ───────────────────────────── C7: estimates ───────────────────────────── */

describe('merge — an estimate never beats a real reading (T12, C7)', () => {
  const guess = sampler(10_000, S, { estimated: 9_000 });

  test('store 4 000 vs the sampler’s 10 000 with 9 000 estimated → 4 000, today and on a past day', () => {
    assert.equal(pick(autoCount(dayOf([hc(4_000), guess]), true)), 'health_connect 4000');
    assert.equal(pick(autoCount(dayOf([hc(4_000), guess]), false)), 'health_connect 4000');
    // Even where M4 lets the phone compete (the store covers less of the day), only real steps count.
    assert.equal(pick(autoCount(dayOf([hc(4_000, ist(D, '14:00')), guess]), false)), 'health_connect 4000');
  });

  test('a sampler-only estimated day → its whole count, the estimate flagged', () => {
    assert.equal(pick(autoCount(dayOf([guess]), false)), 'phone/sampler 10000 (~9000)');
    assert.equal(pick(autoCount(dayOf([guess]), true)), 'phone/sampler 10000 (~9000)', 'today keeps the flag: the save leaves it out');
  });
});

/* ───────────────────────────── S-H2 ───────────────────────────── */

describe('hcCoverFrom — Health Connect’s first-grant day (T13, S-H2)', () => {
  const day = { start: S, end: E };
  const grant = ist(D, '14:00');

  test('nothing in HC before the grant → covered from the grant (on-device counting starts then)', () => {
    assert.equal(hcCoverFrom(day, grant, 0), grant);
    assert.equal(hcCoverFrom(day, grant, null), grant, 'an empty pre-grant read is 0 (S-H1)');
  });

  test('another writer had data before the grant → the whole day', () => {
    assert.equal(hcCoverFrom(day, grant, 1), S);
    assert.equal(hcCoverFrom(day, grant, 2_500), S);
  });

  test('days without the grant in them are whole days', () => {
    assert.equal(hcCoverFrom(day, null, 0), S);
    assert.equal(hcCoverFrom(day, undefined, 0), S);
    assert.equal(hcCoverFrom(day, ist('2026-10-19', '14:00'), 0), S, 'granted the day before');
    assert.equal(hcCoverFrom(day, E, 0), S, 'granted at the next midnight');
    assert.equal(hcCoverFrom(day, ist('2026-10-22', '09:00'), 0), S, 'a day before the grant: other writers only');
    assert.equal(hcCoverFrom(day, S, 0), S, 'granted at midnight');
  });
});

/* ───────────────────────────── M1 ───────────────────────────── */

describe('merge — phone sources compare, never add (T14, M1)', () => {
  test('Recording 5 000 and the sampler 5 100 → 5 100 (one sensor, never 10 100)', () => {
    assert.equal(pick(phoneWinner([recording(5_000), sampler(5_100)])), 'phone/sampler 5100');
    assert.equal(pick(autoCount(dayOf([recording(5_000), sampler(5_100)]), true)), 'phone/sampler 5100');
    assert.equal(pick(autoCount(dayOf([recording(5_000), sampler(5_100)]), false)), 'phone/sampler 5100');
  });

  test('compared by real steps: the estimate never decides; a tie prefers the exact counter', () => {
    assert.equal(pick(phoneWinner([recording(5_000), sampler(5_400, S, { estimated: 600 })])), 'phone/recording 5000');
    assert.equal(pick(phoneWinner([sampler(5_000), recording(5_000)])), 'phone/recording 5000');
    assert.equal(pick(phoneWinner([sampler(5_000), pedometer(5_000)])), 'phone/pedometer 5000');
    assert.equal(pick(phoneWinner([sampler(5_600, S, { estimated: 600 }), sampler(5_000)])), 'phone/sampler 5000', 'the less estimated');
  });

  test('the store is never a phone source; nothing usable → null', () => {
    assert.equal(phoneWinner([hc(9_000)]), null);
    assert.equal(phoneWinner([]), null);
    assert.equal(pick(phoneWinner([hc(9_000), recording(10)])), 'phone/recording 10');
  });

  test('the winner’s flags come with it (coverage, estimate, complete)', () => {
    const late = sampler(6_000, ist(D, '07:10'), { estimated: 200, complete: true });
    assert.deepEqual(phoneWinner([recording(5_000, S, { complete: false }), late]), late);
  });
});

/* ───────────────────────────── M9 ───────────────────────────── */

describe('applyCoverFloor — a shared phone (T15, M9)', () => {
  const day = { start: S, end: E };
  const consent = ist(D, '13:00');

  test('no floor (first member on the install): the whole day', () => {
    assert.deepEqual(applyCoverFloor(day, null), day);
    assert.deepEqual(applyCoverFloor(day, undefined), day);
    assert.deepEqual(applyCoverFloor(day, ist('2026-10-01', '09:00')), day, 'a floor before the day');
  });

  test('the consent day is covered from the consent; a day ending before it → no reading', () => {
    assert.deepEqual(applyCoverFloor(day, consent), { start: consent, end: E });
    assert.equal(applyCoverFloor({ start: dayStartMs('2026-10-19', IST), end: S }, consent), null);
    assert.equal(applyCoverFloor(day, E), null, 'consent at the next midnight');
    assert.deepEqual(applyCoverFloor({ start: E, end: E + 24 * H }, consent), { start: E, end: E + 24 * H }, 'later days are whole');
  });
});
