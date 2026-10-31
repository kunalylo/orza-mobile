/// <reference types="node" />
/**
 * Steps v2 merge rules (`docs/notes/steps-v2.md` §2.3) — `npm run test:steps` runs this file next to
 * `steps-counter.test.ts`. Pure: `merge.ts` has no React Native imports.
 *
 * T8–T15: which source decides a day (M0–M4), Health Connect's first-grant coverage (S-H2), the shared-phone coverage
 * floor (M9). T16–T22: the day's base (M5) — time-anchored edits and starts, how a base is made.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { addDays, zonedToUtc } from '../../src/lib/alarms/schedule';
import { dayStartMs } from '../../src/lib/steps/counter';
import {
  applyCoverFloor,
  autoCount,
  baseForEdit,
  baseFromMarker,
  counted,
  dayValue,
  hcCoverFrom,
  implicitStart,
  phoneWinner,
  type DayValue,
} from '../../src/lib/steps/merge';
import type { DayBase, DayReading, SourceReading } from '../../src/lib/steps/types';

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

/** A source's count after a base's `at` (what the reader measures for `ReadOptions.sinceAt`). */
const after = (at: number, steps: number, estimated?: number) => ({ since: { at, steps, ...(estimated != null ? { estimated } : {}) } });

/** The day's value in one line: `<basis> <steps>[ (~estimated)] [← winner][ fixed]`. */
const val = (v: DayValue | null) =>
  v ? `${v.basis} ${v.steps}${v.estimated ? ` (~${v.estimated})` : ''}${v.winner ? ` ← ${v.winner.source}${v.winner.counter ? `/${v.winner.counter}` : ''}` : ''}${v.fixed ? ' fixed' : ''}` : null;

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

/* ───────────────────────────── M5: bases ───────────────────────────── */

const MIN = 60_000;

describe('counted — what the sources counted after a base’s instant (M5)', () => {
  const at = ist(D, '15:00');

  test('each source’s own count after `at`: as measured for that very `at`, or all of it when it covers only later', () => {
    assert.equal(pick(counted(dayOf([recording(12_000, S, after(at, 700))]), at, true)), 'phone/recording 700');
    assert.equal(pick(counted(dayOf([recording(900, ist(D, '16:00'))]), at, true)), 'phone/recording 900');
    // Measured for another instant (the base moved since the read), or not at all: the source can't tell.
    assert.equal(counted(dayOf([recording(12_000, S, after(at - MIN, 700))]), at, true), null);
    assert.equal(counted(dayOf([recording(12_000)]), at, true), null);
    // Never more than the source's own day count.
    assert.equal(pick(counted(dayOf([recording(500, S, after(at, 650))]), at, true)), 'phone/recording 500');
  });

  test('the M3 / M4 selection over those counts: today the higher, a past day the store’s', () => {
    const day = dayOf([hc(9_000, S, after(at, 400)), recording(9_500, S, after(at, 600))]);
    assert.equal(pick(counted(day, at, true)), 'phone/recording 600');
    assert.equal(pick(counted(day, at, false)), 'health_connect 400');
    // A store's 0 after `at` is nothing synced yet (M0): the phone's count stands.
    assert.equal(pick(counted(dayOf([hc(9_000, S, after(at, 0)), recording(9_500, S, after(at, 600))]), at, false)), 'phone/recording 600');
  });

  test('nothing can be counted after the day ended', () => {
    assert.equal(counted(dayOf([hc(9_000, S, after(E, 0))]), E, false), null);
    assert.equal(counted(dayOf([recording(300)]), E + H, false), null);
  });
});

describe('dayValue — an edit counts on in time, not in value (T16, T17, M5a, C4)', () => {
  const at = ist(D, '15:00');
  const edit: DayBase = { kind: 'edit', steps: 9_000, at, editRef: null };

  test('no base → the automatic count (M5e)', () => {
    assert.equal(val(dayValue(dayOf([hc(5_000), recording(5_200)]), null, true)), 'auto 5200 ← phone/recording');
    assert.equal(val(dayValue(dayOf([sampler(10_000, S, { estimated: 9_000 })]), undefined, false)), 'auto 10000 (~9000) ← phone/sampler');
    assert.equal(dayValue(dayOf([hc(0)]), null, true), null);
  });

  test('T16 (C4a): phone and Health Connect take turns as the best source over 10 reads; the day grows by the steps since the edit', () => {
    // What each source counted since 15:00 (the edit) at each read: the lead changes hands on every read.
    const phoneSince = [100, 100, 500, 520, 700, 700, 950, 1_000, 1_100, 1_300];
    const hcSince = [50, 200, 300, 600, 650, 800, 900, 1_050, 1_080, 1_350];
    const values: number[] = [];
    const leaders: string[] = [];
    for (let i = 0; i < 10; i++) {
      const day = dayOf([hc(11_950 + hcSince[i], S, after(at, hcSince[i])), recording(12_000 + phoneSince[i], S, after(at, phoneSince[i]))]);
      const v = dayValue(day, edit, true);
      assert.equal(v?.basis, 'edit');
      assert.equal(v?.steps, 9_000 + Math.max(phoneSince[i], hcSince[i]));
      values.push(v?.steps ?? 0);
      leaders.push(v?.winner?.source ?? 'none');
    }
    assert.deepEqual(leaders.slice(0, 4), ['phone', 'health_connect', 'phone', 'health_connect']);
    assert.ok(
      values.every((n, i) => i === 0 || n >= values[i - 1]),
      `never goes down: ${values.join(', ')}`
    );
    assert.equal(values[values.length - 1], 10_350, 'not frozen at 9 100 (a base re-anchored on every switch)');
    // Read the next morning, the store's count since the edit decides (M4).
    const lastPair = dayOf([hc(13_030, S, after(at, 1_080)), recording(13_100, S, after(at, 1_100))]);
    assert.equal(val(dayValue(lastPair, edit, false)), 'edit 10080 ← health_connect');
  });

  test('a source that can’t say what it counted after the edit adds nothing (never its whole day, never a difference of values)', () => {
    assert.equal(val(dayValue(dayOf([hc(12_300), recording(12_400)]), edit, true)), 'edit 9000');
    assert.equal(val(dayValue(dayOf([recording(12_400, S, after(at - MIN, 400))]), edit, true)), 'edit 9000');
    // Coverage that starts after the edit: all of its steps came after it.
    assert.equal(val(dayValue(dayOf([recording(700, ist(D, '16:00'))]), edit, true)), 'edit 9700 ← phone/recording');
  });

  test('the estimate in what was counted comes with it (today’s save leaves it out); unknown → the reading’s own', () => {
    assert.equal(val(dayValue(dayOf([sampler(12_000, S, { estimated: 3_000, ...after(at, 800, 500) })]), edit, true)), 'edit 9800 (~500) ← phone/sampler');
    // The count since the edit has no estimate of its own: at most the reading's, so it never passes as real.
    assert.equal(val(dayValue(dayOf([sampler(12_000, S, { estimated: 300, ...after(at, 800) })]), edit, true)), 'edit 9800 (~300) ← phone/sampler');
    assert.equal(val(dayValue(dayOf([sampler(12_000, S, { estimated: 3_000, ...after(at, 800) })]), edit, true)), 'edit 9800 (~800) ← phone/sampler');
  });

  test('T17 (C4b): a watch backfill stamped before the edit is not added (13 000, not 16 000)', () => {
    // 15:00: Health Connect says 8 000 (the watch last synced at 10:00); the member types 11 000.
    const typed = baseForEdit(11_000, at, dayOf([hc(8_000)]), '2026-10-20T09:30:00.000Z');
    assert.equal(typed.kind, 'edit');
    // 18:00: the watch syncs 10:00–18:00 = 5 000 steps, 3 000 of them before 15:00 — HC 13 000, 2 000 after the edit.
    const evening = dayOf([hc(13_000, S, after(at, 2_000))]);
    assert.equal(val(dayValue(evening, typed, true)), 'edit 13000 ← health_connect');
    assert.equal(val(dayValue(evening, typed, false)), 'edit 13000 ← health_connect', 'the next morning too');
  });

  test('the day is clamped to the server’s limit', () => {
    assert.equal(dayValue(dayOf([recording(99_000, S, after(at, 95_000))]), edit, true)?.steps, 100_000);
  });
});

describe('dayValue — a start: counting adds on, a higher whole-day count replaces it (T18, M5b)', () => {
  const typedAt = ist(D, '09:00');
  const grant = ist(D, '14:00');

  test('T18: 6 000 typed at 09:00 and Health Connect from 14:00 → 6 000 + HC since 09:00', () => {
    // Nothing counted at 09:00 → a START.
    const typed = baseForEdit(6_000, typedAt, dayOf([]), null);
    assert.deepEqual(typed, { kind: 'start', steps: 6_000, at: typedAt, editRef: null });
    // HC granted at 14:00 with nothing before it (on-device counting only): covered from the grant, all of it after 09:00.
    const evening = dayOf([hc(6_100, hcCoverFrom({ start: S, end: E }, grant, 0))]);
    assert.equal(val(dayValue(evening, typed, true)), 'start 12100 ← health_connect');
    assert.equal(val(dayValue(evening, typed, false)), 'start 12100 ← health_connect', 'and once the day is past');
  });

  test('T18: with whole-day HC history (a watch) of 12 000 → 12 000', () => {
    const typed = baseForEdit(6_000, typedAt, dayOf([]), null);
    // 7 000 of the watch's steps were before 09:00: 6 000 + the 5 000 since is lower than the whole day.
    const watch = dayOf([hc(12_000, hcCoverFrom({ start: S, end: E }, grant, 7_000), after(typedAt, 5_000))]);
    assert.equal(val(dayValue(watch, typed, true)), 'auto 12000 ← health_connect');
    assert.equal(val(dayValue(watch, typed, false)), 'auto 12000 ← health_connect');
  });

  test('compared by real steps: a mostly estimated whole day doesn’t replace it (C7); a tie → the whole-day count', () => {
    const typed: DayBase = { kind: 'start', steps: 6_000, at: typedAt };
    const guess = dayOf([sampler(10_000, S, { estimated: 9_000, ...after(typedAt, 600, 0) })]);
    assert.equal(val(dayValue(guess, typed, false)), 'start 6600 ← phone/sampler');
    assert.equal(val(dayValue(dayOf([recording(6_600, S, after(typedAt, 600))]), typed, true)), 'auto 6600 ← phone/recording');
  });

  test('nothing counted after it → the start alone, until a whole-day count is higher', () => {
    const typed: DayBase = { kind: 'start', steps: 6_000, at: typedAt };
    assert.equal(val(dayValue(dayOf([]), typed, true)), 'start 6000');
    assert.equal(val(dayValue(dayOf([hc(6_500, S, after(typedAt, 0))]), typed, true)), 'auto 6500 ← health_connect');
  });
});

describe('baseForEdit — the member’s number saved on this phone (T19, M5c1)', () => {
  const at = ist(D, '15:00');

  test('something was counting at that instant → an edit', () => {
    assert.deepEqual(baseForEdit(9_000, at, dayOf([recording(12_000)]), 'm1'), { kind: 'edit', steps: 9_000, at, editRef: 'm1' });
    assert.equal(baseForEdit(9_000, at, dayOf([hc(8_000)]), null).kind, 'edit');
    assert.equal(baseForEdit(0, at, dayOf([recording(0)]), null).kind, 'edit', 'a phone’s covered 0 is counting (nothing walked)');
    assert.equal(baseForEdit(9_000, at, dayOf([sampler(4_000, at)]), null).kind, 'edit', 'covered from that very instant');
  });

  test('nothing was counting → a start', () => {
    assert.equal(baseForEdit(9_000, at, dayOf([]), null).kind, 'start');
    assert.equal(baseForEdit(9_000, at, null, null).kind, 'start', 'no reading at all');
    assert.equal(baseForEdit(9_000, at, dayOf([hc(0)]), null).kind, 'start', 'a store 0 is nothing synced, not counting');
    assert.equal(baseForEdit(9_000, at, dayOf([recording(300, ist(D, '16:00'))]), null).kind, 'start', 'a source covering only later');
  });

  test('the number is clamped to the server’s limit; the marker is kept (null when the server gave none)', () => {
    assert.equal(baseForEdit(250_000, at, dayOf([]), null).steps, 100_000);
    assert.equal(baseForEdit(-4, at, dayOf([]), null).steps, 0);
    assert.equal(baseForEdit(9_000, at, dayOf([]), undefined).editRef, null);
  });
});

describe('baseFromMarker — an edit seen on the server (T20, M5c2)', () => {
  const now = ist(D, '18:00');
  const day = dayOf([hc(10_000)]);
  const at16 = '2026-10-20T10:30:00.000Z'; // 16:00 IST

  test('a new marker → the edit at the marker’s instant, with the server’s count and the marker as its ref', () => {
    assert.deepEqual(baseFromMarker(at16, 7_500, day, now, null), { kind: 'edit', steps: 7_500, at: ist(D, '16:00'), editRef: at16 });
    assert.deepEqual(baseFromMarker(at16, 7_500, day, now, 'an older marker'), { kind: 'edit', steps: 7_500, at: ist(D, '16:00'), editRef: at16 });
  });

  test('the instant is clamped to [day start, now]; one that doesn’t parse is now', () => {
    assert.equal(baseFromMarker('2026-10-19T12:00:00.000Z', 7_500, day, now, null)?.at, S, 'set before the day began');
    assert.equal(baseFromMarker('2026-10-20T14:00:00.000Z', 7_500, day, now, null)?.at, now, 'a server clock ahead of the phone');
    assert.equal(baseFromMarker('not a date', 7_500, day, now, null)?.at, now);
  });

  test('a marker this phone already knows (its own edit’s, or one taken before), or none → no new base', () => {
    assert.equal(baseFromMarker(at16, 7_500, day, now, at16), null);
    assert.equal(baseFromMarker(null, 7_500, day, now, at16), null);
    assert.equal(baseFromMarker(undefined, 7_500, day, now, null), null);
    assert.equal(baseFromMarker('', 7_500, day, now, null), null);
  });

  test('the same test as on the phone: nothing counting at the marker’s instant → a start', () => {
    const lateGrant = dayOf([hc(3_000, ist(D, '14:00'))]);
    assert.equal(baseFromMarker('2026-10-20T04:30:00.000Z', 6_000, lateGrant, now, null)?.kind, 'start', '10:00 IST');
    assert.equal(baseFromMarker(at16, 6_000, lateGrant, now, null)?.kind, 'edit');
  });

  test('the edit then counts on from the marker', () => {
    const base = baseFromMarker(at16, 7_500, day, now, null);
    assert.equal(val(dayValue(dayOf([hc(10_900, S, after(ist(D, '16:00'), 900))]), base, true)), 'edit 8400 ← health_connect');
  });
});

describe('an edit made after the day ended stays the member’s number (T21, M5d)', () => {
  const nextMorning = ist(addDays(D, 1), '09:00');

  test('its value is the edit forever, and it is fixed (nothing is saved automatically)', () => {
    const base = baseForEdit(7_000, nextMorning, dayOf([hc(8_000)]), 'm1');
    assert.equal(base.kind, 'edit');
    assert.equal(val(dayValue(dayOf([hc(8_000)]), base, false)), 'edit 7000 fixed');
    // A watch syncs that day late (stamped before the edit): still 7 000.
    assert.equal(val(dayValue(dayOf([hc(9_500, S, after(nextMorning, 0))]), base, false)), 'edit 7000 fixed');
    // The same from the website: a marker after the day's end.
    const web = baseFromMarker('2026-10-21T05:00:00.000Z', 7_000, dayOf([hc(8_000)]), ist(addDays(D, 1), '12:00'), null);
    assert.equal(web?.kind, 'edit');
    assert.equal(val(dayValue(dayOf([hc(9_500)]), web, false)), 'edit 7000 fixed');
  });

  test('an edit made while the day ran keeps counting once it is past', () => {
    const at = ist(D, '20:00');
    const base = baseForEdit(7_000, at, dayOf([hc(8_000)]), 'm1');
    assert.equal(val(dayValue(dayOf([hc(8_600, S, after(at, 600))]), base, false)), 'edit 7600 ← health_connect');
  });

  test('typed for a past day nothing counted → a start: a later whole-day count replaces it once higher', () => {
    const typed = baseForEdit(7_000, nextMorning, dayOf([]), 'm1');
    assert.equal(typed.kind, 'start');
    assert.equal(val(dayValue(dayOf([]), typed, false)), 'start 7000');
    assert.equal(val(dayValue(dayOf([hc(6_000)]), typed, false)), 'start 7000');
    assert.equal(val(dayValue(dayOf([hc(9_000)]), typed, false)), 'auto 9000 ← health_connect');
  });
});

describe('implicitStart — counting began partway through a day that already had steps (T22, M5c3)', () => {
  const from = ist(D, '13:00');

  test('a re-subscribe the same day (server 5 000, new coverage from 13:00) → 5 000 + counted since 13:00', () => {
    const day = dayOf([recording(800, from)]);
    const base = implicitStart(day, true, { server: 5_000 });
    assert.deepEqual(base, { kind: 'start', steps: 5_000, at: from });
    assert.equal(val(dayValue(day, base, true)), 'start 5800 ← phone/recording');
    assert.equal(val(dayValue(dayOf([recording(2_600, from)]), base, true)), 'start 7600 ← phone/recording', 'later that day');
  });

  test('only with no base, no automatic save of the day by this phone, a partial winner and a count on the server', () => {
    const day = dayOf([recording(800, from)]);
    assert.equal(implicitStart(day, true, { server: 5_000, base: { kind: 'edit', steps: 4_000, at: S } }), null);
    assert.equal(implicitStart(day, true, { server: 5_000, autoSent: 800 }), null);
    assert.equal(implicitStart(day, true, { server: 0 }), null);
    assert.equal(implicitStart(day, true, {}), null);
    assert.equal(implicitStart(dayOf([recording(800)]), true, { server: 5_000 }), null, 'a whole-day winner');
    assert.equal(implicitStart(dayOf([]), true, { server: 5_000 }), null, 'nothing counts');
  });

  test('the winner decides: a whole-day store on a past day, a partial phone count today', () => {
    const both = dayOf([hc(4_000), recording(4_500, from)]);
    assert.equal(implicitStart(both, false, { server: 5_000 }), null);
    assert.deepEqual(implicitStart(both, true, { server: 5_000 }), { kind: 'start', steps: 5_000, at: from });
  });

  test('a shared phone’s consent day (M9) becomes a start at the consent', () => {
    const consent = ist(D, '13:00');
    const range = applyCoverFloor({ start: S, end: E }, consent) ?? assert.fail('the consent day has a range');
    // The reader reads each source over the floored range, so it is covered from the consent.
    const day = dayOf([recording(1_200, range.start)]);
    const base = implicitStart(day, true, { server: 3_000 });
    assert.deepEqual(base, { kind: 'start', steps: 3_000, at: consent });
    assert.equal(val(dayValue(day, base, true)), 'start 4200 ← phone/recording');
  });
});
