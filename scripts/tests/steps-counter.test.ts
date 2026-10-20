/// <reference types="node" />
/**
 * Automatic step counting tests — `npm run test:steps` (= `npx tsx --test scripts/tests/steps-counter.test.ts`).
 * Pure: the day math (`counter.ts`), the save / display rules (`policy.ts`), the sync's scheduling decisions
 * (`plan.ts`), saving one day (`save.ts`, run against a fake server + store) and the source pick (`shared.ts`) have no
 * React Native imports.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { zonedToUtc } from '../../src/lib/alarms/schedule';
import { coversDayEnd, coversWholeDay, dailyStepCounts, dayStartMs, localDay, MAX_STEPS_PER_HOUR, type StepSample } from '../../src/lib/steps/counter';
import { FINAL_DAYS, isFinalRead, mergeDays, mergeReason, PAST_READ_EVERY_MS, pendingPastDays, shouldReadPast } from '../../src/lib/steps/plan';
import {
  clampSteps,
  editBase,
  editedOnServer,
  MAX_DAY_STEPS,
  POST_MIN_INTERVAL_MS,
  postTarget,
  rebased,
  serverAllows,
  shouldPost,
  shownSteps,
  withBase,
  type DayRecord,
} from '../../src/lib/steps/policy';
import { applyManualSteps, saveDay, type SaveDeps } from '../../src/lib/steps/save';
import { forgetServerObservations, observeServerSteps } from '../../src/lib/steps/serverSeen';
import { bestOf, dayRanges } from '../../src/lib/steps/shared';
import type { DaySteps } from '../../src/lib/steps/types';

const IST = 'Asia/Kolkata';
const NY = 'America/New_York';
const H = 3_600_000;
const MIN = 60_000;

const at = (tz: string) => (date: string, time: string) => zonedToUtc(date, time, tz).getTime();
const ist = at(IST);
const ny = at(NY);

/** Samples of one boot: `boot` number, booted at `bootTs`. */
function bootOf(boot: number, bootTs: number) {
  return (ts: number, counter: number): StepSample => ({ ts, counter, boot, elapsed: ts - bootTs });
}

/** `{date: steps}` of the result, for compact asserts. */
function totals(samples: StepSample[], tz = IST): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [date, d] of dailyStepCounts(samples, tz)) out[date] = d.steps;
  return out;
}

const sum = (r: Record<string, number>) => Object.values(r).reduce((s, n) => s + n, 0);

/* ───────────────────────────── Counter ───────────────────────────── */

describe('dailyStepCounts — basics', () => {
  test('no samples → no days', () => {
    assert.equal(dailyStepCounts([], IST).size, 0);
  });

  test('one sample, phone booted earlier the same day → the counter is that day’s steps (from boot time)', () => {
    const s = bootOf(10, ist('2026-10-20', '07:00'));
    const days = dailyStepCounts([s(ist('2026-10-20', '10:00'), 1234)], IST);
    const d = days.get('2026-10-20');
    assert.ok(d);
    assert.equal(d.steps, 1234);
    assert.equal(d.coveredFrom, ist('2026-10-20', '07:00'));
    assert.equal(coversWholeDay(d, IST), false, 'steps before the boot (previous boot) are unknown');
  });

  test('one sample, phone booted on an earlier day → counting starts at the sample (0, partial)', () => {
    const s = bootOf(10, ist('2026-10-18', '07:00'));
    const days = dailyStepCounts([s(ist('2026-10-20', '10:00'), 50_000)], IST);
    const d = days.get('2026-10-20');
    assert.ok(d);
    assert.equal(d.steps, 0);
    assert.equal(d.coveredFrom, ist('2026-10-20', '10:00'));
    assert.equal(days.size, 1);
  });

  test('same boot: consecutive differences add up', () => {
    const s = bootOf(10, ist('2026-10-19', '06:00'));
    const r = totals([
      s(ist('2026-10-19', '23:30'), 8_000),
      s(ist('2026-10-20', '08:00'), 8_000),
      s(ist('2026-10-20', '10:00'), 10_000),
      s(ist('2026-10-20', '12:00'), 10_500),
      s(ist('2026-10-20', '19:45'), 14_321),
    ]);
    assert.equal(r['2026-10-20'], 6_321);
  });

  test('a day covered from before midnight covers the whole day', () => {
    const s = bootOf(10, ist('2026-10-19', '06:00'));
    const days = dailyStepCounts([s(ist('2026-10-19', '23:55'), 100), s(ist('2026-10-20', '00:05'), 100), s(ist('2026-10-20', '09:00'), 900)], IST);
    const d = days.get('2026-10-20');
    assert.ok(d);
    assert.equal(d.steps, 800);
    assert.equal(coversWholeDay(d, IST), true);
    assert.equal(d.estimated, false);
  });

  test('duplicate samples are counted once', () => {
    const s = bootOf(10, ist('2026-10-19', '06:00'));
    const a = s(ist('2026-10-20', '08:00'), 1_000);
    const b = s(ist('2026-10-20', '09:00'), 1_700);
    const c = s(ist('2026-10-20', '10:00'), 2_000);
    assert.deepEqual(totals([a, b, b, b, c, c]), totals([a, b, c]));
    assert.equal(totals([a, b, b, c])['2026-10-20'], 1_000);
    // Same counter at a later time (e.g. app read + alarm) adds nothing either.
    assert.equal(totals([a, b, s(ist('2026-10-20', '09:10'), 1_700), c])['2026-10-20'], 1_000);
  });

  test('order of the input does not matter', () => {
    const s = bootOf(10, ist('2026-10-19', '06:00'));
    const list = [
      s(ist('2026-10-20', '08:00'), 1_000),
      s(ist('2026-10-20', '09:00'), 1_700),
      s(ist('2026-10-20', '23:00'), 9_000),
      s(ist('2026-10-21', '01:00'), 9_400),
    ];
    assert.deepEqual(totals([list[3], list[1], list[0], list[2]]), totals(list));
  });

  test('invalid samples are ignored', () => {
    const s = bootOf(10, ist('2026-10-19', '06:00'));
    const r = totals([
      s(ist('2026-10-20', '08:00'), 1_000),
      { ts: NaN, counter: 5, boot: 10, elapsed: 1 },
      { ts: ist('2026-10-20', '08:30'), counter: -4, boot: 10, elapsed: 1 },
      s(ist('2026-10-20', '09:00'), 1_500),
    ]);
    assert.equal(r['2026-10-20'], 500);
  });
});

describe('dailyStepCounts — reboots and resets', () => {
  test('reboot: the new boot’s counter is the steps since boot, credited from boot time', () => {
    const a = bootOf(41, ist('2026-10-19', '20:00'));
    const b = bootOf(42, ist('2026-10-20', '13:00'));
    const days = dailyStepCounts(
      [a(ist('2026-10-20', '09:00'), 10_000), a(ist('2026-10-20', '12:00'), 12_000), b(ist('2026-10-20', '14:00'), 600), b(ist('2026-10-20', '18:00'), 1_600)],
      IST
    );
    assert.equal(days.get('2026-10-20')?.steps, 2_000 + 600 + 1_000);
  });

  test('reboot after midnight: steps since boot go to the new day; the off-time doesn’t read as a gap', () => {
    const a = bootOf(41, ist('2026-10-19', '20:00'));
    const b = bootOf(42, ist('2026-10-21', '00:30'));
    const days = dailyStepCounts(
      [a(ist('2026-10-20', '06:00'), 1_000), a(ist('2026-10-20', '22:00'), 6_000), b(ist('2026-10-21', '06:30'), 300), b(ist('2026-10-21', '09:30'), 1_300)],
      IST
    );
    assert.equal(days.get('2026-10-20')?.steps, 5_000);
    const d21 = days.get('2026-10-21');
    assert.ok(d21);
    assert.equal(d21.steps, 1_300);
    assert.equal(coversWholeDay(d21, IST), true);
  });

  test('reboot without boot numbers: detected from the boot instant (elapsed)', () => {
    const t0 = ist('2026-10-19', '20:00');
    const t1 = ist('2026-10-20', '13:00');
    const a = (ts: number, counter: number): StepSample => ({ ts, counter, boot: -1, elapsed: ts - t0 });
    const b = (ts: number, counter: number): StepSample => ({ ts, counter, boot: -1, elapsed: ts - t1 });
    // The new boot's counter (2 500) is HIGHER than the old one's last value — only the boot instant reveals the reboot.
    const r = totals([a(ist('2026-10-20', '09:00'), 1_000), a(ist('2026-10-20', '12:00'), 2_000), b(ist('2026-10-20', '15:00'), 2_500)]);
    assert.equal(r['2026-10-20'], 1_000 + 2_500);
  });

  test('reboot with no elapsed time known: counted from the previous reading', () => {
    const r = totals([
      { ts: ist('2026-10-20', '09:00'), counter: 5_000, boot: 3, elapsed: -1 },
      { ts: ist('2026-10-20', '12:00'), counter: 5_800, boot: 3, elapsed: -1 },
      { ts: ist('2026-10-20', '14:00'), counter: 700, boot: 4, elapsed: -1 },
    ]);
    assert.equal(r['2026-10-20'], 800 + 700);
  });

  test('counter restarted without a reboot (lower value, same boot): the new value counts', () => {
    const s = bootOf(7, ist('2026-10-19', '06:00'));
    const r = totals([s(ist('2026-10-20', '09:00'), 9_000), s(ist('2026-10-20', '10:00'), 9_400), s(ist('2026-10-20', '11:00'), 150)]);
    assert.equal(r['2026-10-20'], 400 + 150);
  });

  test('a wall-clock change within a boot neither loses nor doubles steps (boot clock decides order)', () => {
    const E = 50 * H; // booted two days earlier
    const s1: StepSample = { ts: ist('2026-10-20', '10:00'), counter: 1_000, boot: 5, elapsed: E };
    // 30 min later on the boot clock, but the wall clock was moved back an hour.
    const s2: StepSample = { ts: ist('2026-10-20', '09:30'), counter: 1_300, boot: 5, elapsed: E + 30 * MIN };
    const s3: StepSample = { ts: ist('2026-10-20', '10:30'), counter: 1_500, boot: 5, elapsed: E + 90 * MIN };
    assert.equal(totals([s1, s2, s3])['2026-10-20'], 500);
    assert.equal(totals([s3, s1, s2])['2026-10-20'], 500);
  });
});

describe('dailyStepCounts — midnight and long gaps', () => {
  test('a delta that spans midnight is split in proportion to time (IST)', () => {
    const s = bootOf(10, ist('2026-10-20', '05:00'));
    const days = dailyStepCounts([s(ist('2026-10-20', '23:00'), 5_000), s(ist('2026-10-21', '01:00'), 5_240)], IST);
    // The first reading: booted that same day → 5 000 since 05:00.
    assert.equal(days.get('2026-10-20')?.steps, 5_000 + 120);
    assert.equal(days.get('2026-10-21')?.steps, 120);
    assert.equal(days.get('2026-10-21')?.estimated, false);
  });

  test('uneven split rounds to whole steps that still add up', () => {
    const s = bootOf(10, ist('2026-10-19', '05:00'));
    const r = totals([s(ist('2026-10-20', '23:55'), 1_000), s(ist('2026-10-21', '00:05'), 1_007), s(ist('2026-10-21', '00:20'), 1_008)]);
    assert.equal(r['2026-10-20'] + r['2026-10-21'], 8);
    assert.ok(r['2026-10-20'] >= 3 && r['2026-10-20'] <= 4);
  });

  test('multi-day gap: spread over the days by time, flagged as an estimate, total kept', () => {
    const s = bootOf(10, ist('2026-10-19', '05:00'));
    const days = dailyStepCounts([s(ist('2026-10-20', '12:00'), 1_000), s(ist('2026-10-23', '12:00'), 73_000)], IST);
    const r: Record<string, number> = {};
    for (const [date, d] of days) r[date] = d.steps;
    assert.deepEqual(r, { '2026-10-20': 12_000, '2026-10-21': 24_000, '2026-10-22': 24_000, '2026-10-23': 12_000 });
    for (const date of ['2026-10-21', '2026-10-22', '2026-10-23']) assert.equal(days.get(date)?.estimated, true, date);
    assert.equal(sum(r), 72_000);
  });

  test('the same instants land on different days in different time zones', () => {
    // 18:00Z → 20:00Z is 23:30 → 01:30 in India, but all on one day in New York (14:00 → 16:00 EDT).
    const t0 = Date.parse('2026-10-20T18:00:00Z');
    const t1 = Date.parse('2026-10-20T20:00:00Z');
    const samples: StepSample[] = [
      { ts: t0, counter: 100, boot: 1, elapsed: 10 * 24 * H },
      { ts: t1, counter: 500, boot: 1, elapsed: 10 * 24 * H + 2 * H },
    ];
    assert.deepEqual(totals(samples, IST), { '2026-10-20': 100, '2026-10-21': 300 });
    assert.deepEqual(totals(samples, NY), { '2026-10-20': 400 });
  });

  test('DST spring forward (New York, 23-hour day) — split by real time', () => {
    assert.equal(dayStartMs('2026-03-09', NY) - dayStartMs('2026-03-08', NY), 23 * H);
    const s = bootOf(1, ny('2026-03-01', '08:00'));
    // 23:00 EST on the 7th → 01:00 EDT on the 9th = 25 real hours: 1 h + 23 h + 1 h.
    const r = totals([s(ny('2026-03-07', '23:00'), 10_000), s(ny('2026-03-09', '01:00'), 12_500)], NY);
    assert.deepEqual(r, { '2026-03-07': 100, '2026-03-08': 2_300, '2026-03-09': 100 });
  });

  test('DST fall back (New York, 25-hour day) — split by real time', () => {
    assert.equal(dayStartMs('2026-11-02', NY) - dayStartMs('2026-11-01', NY), 25 * H);
    const s = bootOf(1, ny('2026-10-25', '08:00'));
    const r = totals([s(ny('2026-10-31', '23:00'), 0), s(ny('2026-11-02', '01:00'), 2_700)], NY);
    assert.deepEqual(r, { '2026-10-31': 100, '2026-11-01': 2_500, '2026-11-02': 100 });
  });

  test('IST has no DST: every day is 24 h', () => {
    assert.equal(dayStartMs('2026-10-21', IST) - dayStartMs('2026-10-20', IST), 24 * H);
    assert.equal(localDay(dayStartMs('2026-10-20', IST), IST), '2026-10-20');
    assert.equal(localDay(dayStartMs('2026-10-20', IST) - 1, IST), '2026-10-19');
  });
});

describe('dailyStepCounts — absurd spikes', () => {
  test('a one-off glitch reading is ignored and counting carries on from the reading before it', () => {
    const s = bootOf(10, ist('2026-10-19', '05:00'));
    const r = totals([s(ist('2026-10-20', '10:00'), 1_000), s(ist('2026-10-20', '11:00'), 900_000), s(ist('2026-10-20', '12:00'), 1_500)]);
    assert.equal(r['2026-10-20'], 500);
  });

  test('a counter that really jumped carries on from the jump (the jump itself is not counted)', () => {
    const s = bootOf(10, ist('2026-10-19', '05:00'));
    const r = totals([s(ist('2026-10-20', '10:00'), 1_000), s(ist('2026-10-20', '11:00'), 2_000_000), s(ist('2026-10-20', '12:00'), 2_000_400)]);
    assert.equal(r['2026-10-20'], 400);
  });

  test(`more than ${MAX_STEPS_PER_HOUR} steps an hour is rejected; a big but possible hour is kept`, () => {
    const s = bootOf(10, ist('2026-10-19', '05:00'));
    assert.equal(totals([s(ist('2026-10-20', '10:00'), 0), s(ist('2026-10-20', '11:00'), 60_000)])['2026-10-20'], 0);
    assert.equal(totals([s(ist('2026-10-20', '10:00'), 0), s(ist('2026-10-20', '11:00'), 12_000)])['2026-10-20'], 12_000);
  });

  test('short intervals are judged over at least 15 min (a delayed reading can bunch steps)', () => {
    const s = bootOf(10, ist('2026-10-19', '05:00'));
    // 2 000 steps between readings 1 min apart: possible once a stale reading catches up → kept.
    assert.equal(totals([s(ist('2026-10-20', '10:00'), 0), s(ist('2026-10-20', '10:01'), 2_000)])['2026-10-20'], 2_000);
    // 13 000 in 5 min is a glitch.
    assert.equal(totals([s(ist('2026-10-20', '10:00'), 0), s(ist('2026-10-20', '10:05'), 13_000)])['2026-10-20'], 0);
  });

  test('a reboot whose new counter is absurd is skipped, later readings of that boot count', () => {
    const a = bootOf(1, ist('2026-10-19', '05:00'));
    const b = bootOf(2, ist('2026-10-20', '11:55'));
    const r = totals([a(ist('2026-10-20', '10:00'), 3_000), a(ist('2026-10-20', '11:00'), 3_500), b(ist('2026-10-20', '12:00'), 5_000_000), b(ist('2026-10-20', '13:00'), 5_000_800)]);
    assert.equal(r['2026-10-20'], 500 + 800);
  });
});

/* ───────────────────────────── Policy ───────────────────────────── */

describe('policy — when to save', () => {
  const now = Date.parse('2026-10-20T10:00:00Z');

  test('the first count of the day is saved at once', () => {
    assert.equal(shouldPost(12, undefined, now, false), true);
    assert.equal(shouldPost(0, undefined, now, false), false);
  });

  test('today: ≥ 50 more steps, or 10 min since the last save', () => {
    const rec = { sent: 1_000, sentAt: now - MIN };
    assert.equal(shouldPost(1_030, rec, now, false), false);
    assert.equal(shouldPost(1_050, rec, now, false), true);
    assert.equal(shouldPost(1_010, { sent: 1_000, sentAt: now - POST_MIN_INTERVAL_MS }, now, false), true);
  });

  test('never lowers what this phone saved, nor a higher count already on the server', () => {
    assert.equal(shouldPost(900, { sent: 1_000, sentAt: now - H }, now, false), false);
    assert.equal(shouldPost(900, { sent: 1_000, sentAt: now - H }, now, true), false);
    const typedOnWeb = { sent: 1_000, sentAt: now - H, server: 5_000 };
    assert.equal(shouldPost(4_000, typedOnWeb, now, false), false);
    assert.equal(shouldPost(5_100, typedOnWeb, now, false), true);
    assert.equal(serverAllows(5_000, 6_000), false);
    assert.equal(serverAllows(5_000, 5_000), false);
    assert.equal(serverAllows(5_001, 5_000), true);
    assert.equal(serverAllows(5_000, null), true);
  });

  test('a past day’s final count is saved whenever it is higher (no throttle)', () => {
    assert.equal(shouldPost(1_001, { sent: 1_000, sentAt: now }, now, true), true);
  });

  test('counts are clamped to the server’s limit', () => {
    assert.equal(clampSteps(150_000), MAX_DAY_STEPS);
    assert.equal(clampSteps(-5), 0);
    assert.equal(clampSteps(NaN), 0);
    assert.equal(clampSteps(10.6), 11);
    assert.equal(shouldPost(150_000, { sent: MAX_DAY_STEPS, sentAt: now - H }, now, false), false);
  });
});

describe('policy — what Today shows', () => {
  test('the live count when it is the highest', () => {
    assert.deepEqual(shownSteps({ steps: 3_000, source: 'phone' }, { sent: 2_500, sentSource: 'phone' }, 2_500), { steps: 3_000, source: 'phone' });
  });

  test('a higher count saved elsewhere (typed on the website) wins and is labelled as saved', () => {
    assert.deepEqual(shownSteps({ steps: 3_000, source: 'phone' }, { sent: 2_500, sentSource: 'phone' }, 8_000), { steps: 8_000, source: 'saved' });
  });

  test('this phone’s own save keeps its source; a tie favours the live reading', () => {
    assert.deepEqual(shownSteps(null, { sent: 2_500, sentSource: 'health_connect' }, 2_500), { steps: 2_500, source: 'health_connect' });
    assert.deepEqual(shownSteps({ steps: 2_500, source: 'apple_health' }, { sent: 2_500, sentSource: 'phone' }, 2_500), { steps: 2_500, source: 'apple_health' });
  });

  test('never drops below what this phone saved (a source briefly unreadable)', () => {
    assert.deepEqual(shownSteps({ steps: 1_200, source: 'phone' }, { sent: 4_000, sentSource: 'health_connect' }, null), { steps: 4_000, source: 'health_connect' });
  });

  test('nothing known → null', () => {
    assert.equal(shownSteps(null, undefined, null), null);
  });
});

/* ───────────────────────────── Sources ───────────────────────────── */

describe('source pick', () => {
  test('the higher count wins; a tie goes to the health store; unreadable sources are skipped', () => {
    assert.deepEqual(bestOf('2026-10-20', [{ source: 'health_connect', steps: null }, { source: 'phone', steps: 10 }]), { date: '2026-10-20', steps: 10, source: 'phone' });
    assert.deepEqual(bestOf('2026-10-20', [{ source: 'health_connect', steps: 10 }, { source: 'phone', steps: 10 }]), { date: '2026-10-20', steps: 10, source: 'health_connect' });
    assert.deepEqual(bestOf('2026-10-20', [{ source: 'apple_health', steps: 9_001 }, { source: 'phone', steps: 8_000, partialFrom: 5 }]), {
      date: '2026-10-20',
      steps: 9_001,
      source: 'apple_health',
    });
    assert.deepEqual(bestOf('2026-10-20', [{ source: 'phone', steps: 300, partialFrom: 5 }]), { date: '2026-10-20', steps: 300, source: 'phone', partialFrom: 5 });
    assert.equal(bestOf('2026-10-20', [{ source: 'phone', steps: null }]), null);
  });

  test('day ranges: local midnight to midnight, today capped at now', () => {
    const now = ist('2026-10-20', '15:00');
    const [today, yesterday] = dayRanges(['2026-10-20', '2026-10-19'], IST, now);
    assert.deepEqual(today, { start: ist('2026-10-20', '00:00'), end: now });
    assert.deepEqual(yesterday, { start: ist('2026-10-19', '00:00'), end: ist('2026-10-20', '00:00') });
  });
});

/* ───────────────────────────── Review fixes: counter ───────────────────────────── */

describe('dailyStepCounts — boot clock and wall clock', () => {
  test('BOOT_COUNT moved without a kernel reboot (elapsed kept growing): only the difference counts', () => {
    const booted = ist('2026-10-18', '08:00'); // one kernel boot …
    const a = bootOf(41, booted);
    const b = bootOf(42, booted); // … whose BOOT_COUNT moved (runtime restart / userspace reboot)
    const r = totals([a(ist('2026-10-20', '08:00'), 20_500), a(ist('2026-10-20', '10:00'), 21_000), b(ist('2026-10-20', '12:00'), 21_300)]);
    assert.equal(r['2026-10-20'], 500 + 300, 'not 21 300 phantom steps');
  });

  test('a real reboot with a higher boot number still counts the new boot from its start', () => {
    const a = bootOf(41, ist('2026-10-18', '08:00'));
    const b = bootOf(42, ist('2026-10-20', '11:00'));
    const r = totals([a(ist('2026-10-20', '08:00'), 20_500), a(ist('2026-10-20', '10:00'), 21_000), b(ist('2026-10-20', '12:00'), 400)]);
    assert.equal(r['2026-10-20'], 500 + 400);
  });

  test('a boot sample taken under a reset clock (2016) is re-anchored; no previous-boot counter is credited', () => {
    const a = bootOf(41, ist('2026-10-19', '20:00'));
    const b = bootOf(42, ist('2026-10-20', '13:00'));
    const resetClock: StepSample = { ts: Date.UTC(2016, 0, 1, 0, 0, 30), counter: 0, boot: 42, elapsed: 30_000 };
    const samples = [a(ist('2026-10-20', '09:00'), 9_000), a(ist('2026-10-20', '12:00'), 11_000), resetClock, b(ist('2026-10-20', '15:00'), 600), b(ist('2026-10-20', '18:00'), 1_600)];
    assert.deepEqual(totals(samples), { '2026-10-20': 2_000 + 1_600 });
    assert.deepEqual(totals([...samples].reverse()), { '2026-10-20': 2_000 + 1_600 });
  });

  test('without boot numbers, a reset-clock reading nothing can re-anchor is dropped', () => {
    const t0 = ist('2026-10-19', '20:00');
    const a = (ts: number, counter: number): StepSample => ({ ts, counter, boot: -1, elapsed: ts - t0 });
    const resetClock: StepSample = { ts: Date.UTC(2016, 0, 1, 0, 0, 30), counter: 0, boot: -1, elapsed: 30_000 };
    assert.deepEqual(totals([resetClock, a(ist('2026-10-20', '09:00'), 9_000), a(ist('2026-10-20', '12:00'), 11_000)]), { '2026-10-20': 2_000 });
  });

  test('a long gap that reaches today is flagged as an estimate (how many steps of the day)', () => {
    const s = bootOf(10, ist('2026-10-15', '08:00'));
    const days = dailyStepCounts([s(ist('2026-10-17', '22:00'), 40_000), s(ist('2026-10-20', '10:00'), 64_000)], IST);
    const today = days.get('2026-10-20');
    assert.ok(today);
    assert.equal(today.steps, 4_000);
    assert.equal(today.estimated, true);
    assert.equal(today.estimatedSteps, 4_000);
    assert.equal(days.get('2026-10-18')?.estimatedSteps, 9_600);
  });

  test('a past day is complete only once a reading after its midnight exists', () => {
    const s = bootOf(10, ist('2026-10-18', '08:00'));
    const before = dailyStepCounts([s(ist('2026-10-19', '09:00'), 1_000), s(ist('2026-10-19', '22:40'), 7_000)], IST).get('2026-10-19');
    assert.ok(before);
    assert.equal(coversDayEnd(before, IST), false, 'the midnight sample never came (OEM blocked the alarm)');
    const after = dailyStepCounts([s(ist('2026-10-19', '09:00'), 1_000), s(ist('2026-10-19', '23:55'), 7_000), s(ist('2026-10-20', '00:05'), 7_010)], IST).get(
      '2026-10-19'
    );
    assert.ok(after);
    assert.equal(coversDayEnd(after, IST), true);
  });
});

/* ───────────────────────────── Review fixes: policy ───────────────────────────── */

describe('policy — edits, mid-day starts, estimates', () => {
  const t = ist('2026-10-20', '18:00');
  const phone = (steps: number) => ({ steps, source: 'phone' as const });

  test('a lower server read made after this phone’s save is the member’s edit; older or higher reads are not', () => {
    const rec: DayRecord = { sent: 14_000, sentAt: t };
    assert.equal(editedOnServer(rec, { steps: 9_000, requestedAt: t + 1 }), true);
    assert.equal(editedOnServer(rec, { steps: 9_000, requestedAt: t - 1 }), false, 'requested before the save landed');
    assert.equal(editedOnServer(rec, { steps: 15_000, requestedAt: t + 1 }), false, 'another phone raised it');
    assert.equal(editedOnServer(undefined, { steps: 9_000, requestedAt: t + 1 }), false);
  });

  test('after an edit the day is the member’s number plus what is counted after it — lower than the automatic count too', () => {
    const base = editBase(9_000, phone(14_000), t);
    assert.deepEqual(withBase(phone(14_050), base), { steps: 9_050, source: 'edited' });
    assert.equal(postTarget({ date: '2026-10-20', ...phone(14_050) }, { base }, true), 9_050);
    // Shown: the member's number wins over this phone's earlier (higher) save.
    assert.deepEqual(shownSteps(phone(14_050), { sent: 9_000, sentSource: 'edited', base }, 9_000), { steps: 9_050, source: 'edited' });
  });

  test('an edited past day with nothing counting it stays at the member’s number (never auto-saved again)', () => {
    const base = editBase(3_000, null, t);
    assert.equal(postTarget({ date: '2026-10-18', ...phone(8_000) }, { base }, false), null);
    assert.deepEqual(withBase(null, base), { steps: 3_000, source: 'edited' });
  });

  test('the best source changing under a base re-anchors it (no double counting)', () => {
    const base = { ...editBase(9_000, phone(14_000), t), last: 9_200 };
    const hc = { steps: 15_000, source: 'health_connect' as const };
    assert.deepEqual(withBase(hc, base), { steps: 9_200, source: 'edited' });
    const moved = rebased(base, hc, t + H);
    assert.ok(moved);
    assert.equal(moved.auto, 15_000);
    assert.equal(moved.steps, 9_200);
    assert.deepEqual(withBase({ steps: 15_300, source: 'health_connect' }, moved), { steps: 9_500, source: 'edited' });
    assert.equal(rebased(base, phone(14_100), t), null, 'same source: nothing to do');
  });

  test('counting that starts mid-day adds on top of the count saved before it', () => {
    const base = { kind: 'start' as const, steps: 5_000, auto: 0, source: 'phone' as const, at: t, last: 5_000 };
    assert.deepEqual(withBase(phone(3_000), base), { steps: 8_000, source: 'phone' });
    assert.deepEqual(shownSteps(phone(3_000), { base, server: 5_000 }, 5_000), { steps: 8_000, source: 'phone' });
  });

  test('today never saves the estimated part of a reading; a past day saves all of it', () => {
    const day: DaySteps = { date: '2026-10-20', steps: 4_000, source: 'phone', estimated: 4_000 };
    assert.equal(postTarget(day, undefined, true), 0);
    assert.equal(postTarget(day, undefined, false), 4_000);
    assert.equal(postTarget({ ...day, steps: 6_500, estimated: 800 }, undefined, true), 5_700);
  });
});

/* ───────────────────────────── Review fixes: sync scheduling ───────────────────────────── */

describe('plan — queued runs and past days', () => {
  const now = ist('2026-10-20', '12:00');

  test('a queued run keeps the most important reason (a permission re-check is never dropped)', () => {
    assert.equal(mergeReason(undefined, 'today'), 'today');
    assert.equal(mergeReason('permission', 'today'), 'permission');
    assert.equal(mergeReason('permission', 'foreground'), 'permission');
    assert.equal(mergeReason('today', 'launch'), 'launch');
    assert.equal(mergeReason('background', 'permission'), 'permission');
  });

  test(`past days stay pending until final, up to ${FINAL_DAYS} back`, () => {
    const pending = pendingPastDays('2026-10-20', (d) => d === '2026-10-18');
    assert.equal(pending.length, FINAL_DAYS - 1);
    assert.equal(pending[0], '2026-10-19');
    assert.equal(pending.includes('2026-10-18'), false);
    assert.equal(pending[pending.length - 1], '2026-10-13');
    assert.equal(isFinalRead({ date: '2026-10-19', steps: 10, source: 'phone', complete: true }), true);
    assert.equal(isFinalRead({ date: '2026-10-19', steps: 10, source: 'phone' }), false, 'not read to its end');
    assert.equal(isFinalRead(undefined), false, 'no source could read it');
  });

  test('pending past days are re-read on launch, a permission change, a new day, else every 30 min', () => {
    const last = { at: now - 10 * MIN, today: '2026-10-20' };
    assert.equal(shouldReadPast('today', '2026-10-20', now, last), false);
    assert.equal(shouldReadPast('launch', '2026-10-20', now, last), true);
    assert.equal(shouldReadPast('permission', '2026-10-20', now, last), true);
    assert.equal(shouldReadPast('today', '2026-10-21', now, last), true);
    assert.equal(shouldReadPast('today', '2026-10-20', last.at + PAST_READ_EVERY_MS, last), true);
    assert.equal(shouldReadPast('background', '2026-10-20', now, null), true);
  });

  test('two waiting save jobs: newer readings win, past days only the older one read are kept', () => {
    const older: DaySteps[] = [
      { date: '2026-10-20', steps: 100, source: 'phone' },
      { date: '2026-10-19', steps: 5_000, source: 'phone', complete: true },
    ];
    const newer: DaySteps[] = [{ date: '2026-10-20', steps: 140, source: 'phone' }];
    assert.deepEqual(mergeDays(older, newer), [newer[0], older[1]]);
  });
});

/* ───────────────────────────── Review fixes: saving a day (fake server) ───────────────────────────── */

let fakeUsers = 0;

/** A fake server (`/track/steps`, `/dashboard/today`) + store + clock for `save.ts`. */
function fakeSync(start: number, server: Record<string, number> = {}) {
  const userId = `user-${++fakeUsers}`;
  let clock = start;
  let failure: unknown = null;
  const days = new Map(Object.entries(server));
  const records = new Map<string, DayRecord>();
  const posts: { date: string; steps: number }[] = [];
  const reads: string[] = [];
  const deps: SaveDeps = {
    getRecord: (u, d) => records.get(`${u}|${d}`),
    updateRecord: (u, d, patch) => {
      records.set(`${u}|${d}`, { ...records.get(`${u}|${d}`), ...patch });
    },
    async fetchServerSteps(date) {
      clock += 200;
      if (failure) throw failure;
      reads.push(date);
      return days.get(date) ?? 0;
    },
    async postSteps(date, steps) {
      clock += 300;
      if (failure) throw failure;
      days.set(date, steps);
      posts.push({ date, steps });
      return { date, steps, water_glasses: 0 };
    },
    isPermanent: (e) => e === 'permanent',
    now: () => clock,
  };
  return {
    userId,
    deps,
    days,
    posts,
    reads,
    record: (date: string) => records.get(`${userId}|${date}`),
    advance: (ms: number) => {
      clock += ms;
    },
    now: () => clock,
    fail: (e: unknown) => {
      failure = e;
    },
  };
}

describe('save — one day against the server', () => {
  const D = '2026-10-20';
  const phoneDay = (steps: number, extra: Partial<DaySteps> = {}): DaySteps => ({ date: D, steps, source: 'phone', ...extra });

  test('the first count of the day is saved; the server is read right before', async () => {
    forgetServerObservations();
    const f = fakeSync(ist(D, '09:00'));
    assert.equal(await saveDay(f.deps, f.userId, phoneDay(1_200), true), true);
    assert.deepEqual(f.posts, [{ date: D, steps: 1_200 }]);
    assert.deepEqual(f.reads, [D]);
    assert.equal(f.record(D)?.sent, 1_200);
  });

  test('this phone’s own saves never hide a higher count saved elsewhere since (no stale-cache overwrite)', async () => {
    forgetServerObservations();
    const f = fakeSync(ist(D, '17:58'));
    await saveDay(f.deps, f.userId, phoneDay(6_000), true);
    f.days.set(D, 9_000); // 18:00 — another phone / the website saved a higher count
    f.advance(3 * MIN);
    assert.equal(await saveDay(f.deps, f.userId, phoneDay(6_060), true), true);
    assert.equal(f.days.get(D), 9_000, 'never lowered');
    assert.equal(f.posts.length, 1);
    // Higher than the server again later: saved.
    f.advance(15 * MIN);
    await saveDay(f.deps, f.userId, phoneDay(9_100), true);
    assert.equal(f.days.get(D), 9_100);
  });

  test('a lower count set on the website after this phone’s save is kept; steps counted after it add on', async () => {
    forgetServerObservations();
    const f = fakeSync(ist(D, '12:00'));
    await saveDay(f.deps, f.userId, phoneDay(14_000), true);
    f.advance(MIN);
    f.days.set(D, 9_000); // the member corrects a bus ride on the website
    observeServerSteps(f.userId, D, 9_000, f.now()); // Today's dashboard fetch saw it
    f.advance(MIN);
    await saveDay(f.deps, f.userId, phoneDay(14_060), true);
    assert.equal(f.days.get(D), 9_000, 'the correction is not undone');
    assert.equal(f.record(D)?.base?.kind, 'edit');
    f.advance(5 * MIN);
    await saveDay(f.deps, f.userId, phoneDay(14_200), true);
    assert.equal(f.days.get(D), 9_140, 'the member’s number + 140 counted since');
    assert.deepEqual(
      f.posts.map((p) => p.steps),
      [14_000, 9_140],
      'never posted the old higher count again'
    );
  });

  test('an edit noticed only by the read before a save is accepted, not overwritten', async () => {
    forgetServerObservations();
    const f = fakeSync(ist(D, '12:00'));
    await saveDay(f.deps, f.userId, phoneDay(14_000), true);
    f.advance(MIN);
    f.days.set(D, 9_000);
    f.advance(MIN);
    await saveDay(f.deps, f.userId, phoneDay(14_060), true);
    assert.equal(f.days.get(D), 9_000);
    assert.equal(f.posts.length, 1);
    f.advance(5 * MIN);
    await saveDay(f.deps, f.userId, phoneDay(14_200), true);
    assert.equal(f.days.get(D), 9_140);
  });

  test('counting that starts mid-day adds on top of steps typed that morning', async () => {
    forgetServerObservations();
    const f = fakeSync(ist(D, '14:00'), { [D]: 5_000 });
    const partialFrom = ist(D, '14:00');
    await saveDay(f.deps, f.userId, phoneDay(0, { partialFrom }), true);
    assert.equal(f.record(D)?.base?.kind, 'start');
    assert.equal(f.days.get(D), 5_000);
    f.advance(5 * H);
    await saveDay(f.deps, f.userId, phoneDay(3_000, { partialFrom }), true);
    assert.equal(f.days.get(D), 8_000);
  });

  test('the member’s own number on this phone (Edit) stays the day’s count; counting adds on top', async () => {
    forgetServerObservations();
    const f = fakeSync(ist(D, '12:00'));
    await saveDay(f.deps, f.userId, phoneDay(12_000), true);
    f.advance(MIN);
    f.days.set(D, 9_000); // the sheet's POST
    applyManualSteps(f.deps, f.userId, D, 9_000, D, { steps: 12_100, source: 'phone' });
    f.advance(MIN);
    await saveDay(f.deps, f.userId, phoneDay(12_120), true);
    assert.equal(f.days.get(D), 9_000, '+20: not worth a save yet');
    f.advance(MIN);
    await saveDay(f.deps, f.userId, phoneDay(12_300), true);
    assert.equal(f.days.get(D), 9_200);
  });

  test('typing a higher count today with nothing counting is a plain save (no base)', () => {
    forgetServerObservations();
    const f = fakeSync(ist(D, '12:00'));
    applyManualSteps(f.deps, f.userId, D, 4_000, D, null);
    assert.equal(f.record(D)?.base, undefined);
    assert.equal(f.record(D)?.server, 4_000);
  });

  test('offline: retried later (false); a refusal a retry won’t fix is not retried (true)', async () => {
    forgetServerObservations();
    const f = fakeSync(ist(D, '12:00'));
    f.fail(new Error('Network request failed'));
    assert.equal(await saveDay(f.deps, f.userId, phoneDay(1_000), true), false);
    f.fail('permanent');
    assert.equal(await saveDay(f.deps, f.userId, phoneDay(1_000), false), true);
    assert.equal(f.posts.length, 0);
  });

  test('today leaves a long-gap estimate out; once the day is past its full count is saved', async () => {
    forgetServerObservations();
    const f = fakeSync(ist(D, '10:00'));
    await saveDay(f.deps, f.userId, phoneDay(4_000, { estimated: 4_000 }), true);
    assert.equal(f.posts.length, 0);
    f.advance(5 * H);
    await saveDay(f.deps, f.userId, phoneDay(6_000, { estimated: 4_000 }), true);
    assert.equal(f.days.get(D), 2_000, 'only what was really counted today');
    f.advance(10 * H);
    await saveDay(f.deps, f.userId, phoneDay(6_400, { estimated: 4_000, complete: true }), false);
    assert.equal(f.days.get(D), 6_400);
  });

  test('a stale run (signed out meanwhile) writes nothing', async () => {
    forgetServerObservations();
    const f = fakeSync(ist(D, '12:00'));
    let signedOut = false;
    const slow: SaveDeps = {
      ...f.deps,
      async fetchServerSteps(date) {
        signedOut = true;
        return f.deps.fetchServerSteps(date);
      },
    };
    assert.equal(await saveDay(slow, f.userId, phoneDay(1_000), true, { stale: () => signedOut }), true);
    assert.equal(f.posts.length, 0);
  });
});
