/// <reference types="node" />
/**
 * Automatic step counting tests — `npm run test:steps` (this file and `steps-merge.test.ts`, the v2 merge rules).
 * Pure: the day math (`counter.ts`; the Recording API's buckets in `recording.ts`), the save / display rules
 * (`policy.ts`), the sync's scheduling decisions (`plan.ts`), saving one day (`save.ts`, run against a fake server +
 * store) and the save path's source pick (`shared.ts`) have no React Native imports.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { addDays, zonedToUtc } from '../../src/lib/alarms/schedule';
import {
  coversDayEnd,
  coversWholeDay,
  dailyStepCounts,
  dayComplete,
  dayStartMs,
  localDay,
  MAX_STEPS_PER_HOUR,
  stepsInRange,
  type StepSample,
} from '../../src/lib/steps/counter';
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
import { RECORDING_FRESH_MS, recordingDays, recordingRange, recordingSince, recordingWindow, type RecordingBucket } from '../../src/lib/steps/recording';
import { applyManualSteps, saveDay, type SaveDeps } from '../../src/lib/steps/save';
import { forgetServerObservations, observeServerSteps } from '../../src/lib/steps/serverSeen';
import { dayBounds, dayRanges, legacyDaySteps } from '../../src/lib/steps/shared';
import type { DayReading, DaySteps, SourceReading } from '../../src/lib/steps/types';

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

  test(`T1: more than ${MAX_STEPS_PER_HOUR} steps an hour is rejected; a big but possible hour is kept`, () => {
    assert.equal(MAX_STEPS_PER_HOUR, 15_000, 'C13: 250 steps a minute for a whole hour is beyond running cadence');
    const s = bootOf(10, ist('2026-10-19', '05:00'));
    assert.equal(totals([s(ist('2026-10-20', '10:00'), 0), s(ist('2026-10-20', '11:00'), 16_000)])['2026-10-20'], 0);
    assert.equal(totals([s(ist('2026-10-20', '10:00'), 0), s(ist('2026-10-20', '11:00'), 14_000)])['2026-10-20'], 14_000);
  });

  test('T1: a 15-min window holds at most 3 750 steps (3 800 rejected, 3 700 kept)', () => {
    const s = bootOf(10, ist('2026-10-19', '05:00'));
    assert.equal(totals([s(ist('2026-10-20', '10:00'), 0), s(ist('2026-10-20', '10:15'), 3_800)])['2026-10-20'], 0);
    assert.equal(totals([s(ist('2026-10-20', '10:00'), 0), s(ist('2026-10-20', '10:15'), 3_700)])['2026-10-20'], 3_700);
    // Shorter intervals are judged over 15 min too: 3 800 bunched into 5 min is still too many.
    assert.equal(totals([s(ist('2026-10-20', '10:00'), 0), s(ist('2026-10-20', '10:05'), 3_800)])['2026-10-20'], 0);
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

describe('source pick (the save path’s adapter until R5a)', () => {
  const D = '2026-10-20';
  const reading = (sources: SourceReading[]): DayReading => ({ date: D, ...dayBounds(D, IST), sources });
  const s = ist(D, '00:00');

  test('today: the higher count wins; a tie goes to the health store; a store 0 is no reading', () => {
    assert.deepEqual(legacyDaySteps(reading([{ source: 'health_connect', steps: 0, coverFrom: s }, { source: 'phone', steps: 10, coverFrom: s }]), true), {
      date: D,
      steps: 10,
      source: 'phone',
    });
    assert.deepEqual(legacyDaySteps(reading([{ source: 'health_connect', steps: 10, coverFrom: s }, { source: 'phone', steps: 10, coverFrom: s }]), true), {
      date: D,
      steps: 10,
      source: 'health_connect',
    });
    assert.equal(legacyDaySteps(reading([]), true), null);
  });

  test('the winner’s coverage after midnight is its partialFrom; its estimate and completeness come with it', () => {
    const from = ist(D, '07:00');
    assert.deepEqual(legacyDaySteps(reading([{ source: 'phone', counter: 'sampler', steps: 300, coverFrom: from, estimated: 40, complete: true }]), false), {
      date: D,
      steps: 300,
      source: 'phone',
      partialFrom: from,
      estimated: 40,
      complete: true,
    });
  });

  test('a past day follows the store, even below a higher phone count (C3)', () => {
    const day = reading([
      { source: 'apple_health', steps: 9_001, coverFrom: s, complete: true },
      { source: 'phone', counter: 'pedometer', steps: 9_500, coverFrom: s, complete: true },
    ]);
    assert.deepEqual(legacyDaySteps(day, false), { date: D, steps: 9_001, source: 'apple_health', complete: true });
    assert.equal(legacyDaySteps(day, true)?.steps, 9_500, 'today: the live tail');
  });

  test('day ranges: local midnight to midnight, today capped at now; day bounds are never capped', () => {
    const now = ist('2026-10-20', '15:00');
    const [today, yesterday] = dayRanges(['2026-10-20', '2026-10-19'], IST, now);
    assert.deepEqual(today, { start: ist('2026-10-20', '00:00'), end: now });
    assert.deepEqual(yesterday, { start: ist('2026-10-19', '00:00'), end: ist('2026-10-20', '00:00') });
    assert.deepEqual(dayBounds('2026-10-20', IST), { start: ist('2026-10-20', '00:00'), end: ist('2026-10-21', '00:00') });
    assert.deepEqual(dayBounds('2026-03-08', NY), { start: ny('2026-03-08', '00:00'), end: ny('2026-03-09', '00:00') });
    assert.equal(dayBounds('2026-03-08', NY).end - dayBounds('2026-03-08', NY).start, 23 * H);
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

/* ───────────────────────────── Steps v2: counter ───────────────────────────── */

/** The same reading, tagged with why the sampler took it (`shutdown`: the last one before a power-off). */
const tagged = (s: StepSample, reason: string): StepSample => ({ ...s, reason });

describe('dailyStepCounts — reboot gaps (T2, C10)', () => {
  // Boot 41 covers the 19th from the 18th's last reading; the phone reboots at 15:00 and boot 42 reads past midnight.
  const a = bootOf(41, ist('2026-10-18', '08:00'));
  const b = bootOf(42, ist('2026-10-19', '15:00'));
  const before = [a(ist('2026-10-18', '23:55'), 500), a(ist('2026-10-19', '09:00'), 1_000), tagged(a(ist('2026-10-19', '13:00'), 4_000), 'periodic')];
  const after = [b(ist('2026-10-19', '16:00'), 300), b(ist('2026-10-20', '00:05'), 2_000)];
  const the19th = (samples: StepSample[]) => {
    const d = dailyStepCounts(samples, IST).get('2026-10-19');
    assert.ok(d);
    return d;
  };

  test('a reboot with no shutdown reading before it may have lost steps: the day is not complete', () => {
    const d = the19th([...before, ...after]);
    assert.equal(coversDayEnd(d, IST), true, 'read up to its end …');
    assert.equal(d.uncertainGap, true);
    assert.equal(dayComplete(d, IST), false, '… but not final: it stays pending (saved raise-only)');
  });

  test('a shutdown reading just before the reboot: nothing was lost, the day is complete', () => {
    const d = the19th([...before, tagged(a(ist('2026-10-19', '14:50'), 4_100), 'shutdown'), ...after]);
    assert.equal(d.uncertainGap, false);
    assert.equal(dayComplete(d, IST), true);
    assert.equal(d.steps, dailyStepCounts([...before, ...after], IST).get('2026-10-19')!.steps + 100, 'the shutdown reading adds what it saw');
  });

  test('the gap marks every day it touches, and only those', () => {
    const c = bootOf(43, ist('2026-10-21', '00:30'));
    const days = dailyStepCounts([...before, ...after, b(ist('2026-10-20', '22:00'), 9_000), c(ist('2026-10-21', '09:00'), 700), c(ist('2026-10-22', '00:10'), 900)], IST);
    assert.equal(days.get('2026-10-20')?.uncertainGap, true, '22:00 → the 00:30 boot');
    assert.equal(days.get('2026-10-21')?.uncertainGap, true);
    assert.equal(dayComplete(days.get('2026-10-21')!, IST), false);
    assert.equal(days.get('2026-10-22')?.uncertainGap, false);
  });

  test('no boot clock: the gap runs from the last reading to the first one of the new boot', () => {
    const days = dailyStepCounts(
      [
        { ts: ist('2026-10-19', '20:00'), counter: 5_000, boot: 3, elapsed: -1 },
        { ts: ist('2026-10-20', '09:00'), counter: 700, boot: 4, elapsed: -1 },
        { ts: ist('2026-10-21', '00:05'), counter: 900, boot: 4, elapsed: -1 },
      ],
      IST
    );
    assert.equal(days.get('2026-10-19')?.uncertainGap, true);
    assert.equal(days.get('2026-10-20')?.uncertainGap, true);
  });

  test('no reboot (BOOT_COUNT moved, the boot clock kept running) → no gap; a counter restart is one', () => {
    const booted = ist('2026-10-18', '08:00');
    const [b41, b42] = [bootOf(41, booted), bootOf(42, booted)];
    const moved = dailyStepCounts([b41(ist('2026-10-19', '23:50'), 100), b41(ist('2026-10-20', '10:00'), 500), b42(ist('2026-10-20', '12:00'), 800), b42(ist('2026-10-21', '00:05'), 900)], IST);
    assert.equal(moved.get('2026-10-20')?.uncertainGap, false);
    assert.equal(dayComplete(moved.get('2026-10-20')!, IST), true);
    const s = bootOf(7, booted);
    const restarted = dailyStepCounts([s(ist('2026-10-19', '23:50'), 9_000), s(ist('2026-10-20', '10:00'), 9_400), s(ist('2026-10-20', '11:00'), 150), s(ist('2026-10-21', '00:05'), 300)], IST);
    assert.equal(restarted.get('2026-10-20')?.uncertainGap, true, 'steps before the restart are lost as with a reboot');
  });
});

describe('stepsInRange (T3)', () => {
  const s = bootOf(10, ist('2026-10-19', '05:00'));
  const samples = [s(ist('2026-10-20', '10:00'), 1_000), s(ist('2026-10-20', '11:00'), 2_000), s(ist('2026-10-20', '13:00'), 2_600)];

  test('a delta overlapping `from` (or `to`) is prorated by time', () => {
    assert.equal(stepsInRange(samples, IST, ist('2026-10-20', '10:30'), ist('2026-10-20', '13:00')), 500 + 600);
    assert.equal(stepsInRange(samples, IST, ist('2026-10-20', '10:00'), ist('2026-10-20', '10:15')), 250);
    assert.equal(stepsInRange(samples, IST, ist('2026-10-20', '12:00'), ist('2026-10-20', '20:00')), 300);
    assert.equal(stepsInRange(samples, IST, ist('2026-10-20', '13:00'), ist('2026-10-20', '20:00')), 0, 'nothing read after the last reading');
    assert.equal(stepsInRange(samples, IST, ist('2026-10-20', '08:00'), ist('2026-10-20', '10:00')), 0, 'before the first reading');
    assert.equal(stepsInRange([], IST, ist('2026-10-20', '00:00'), ist('2026-10-21', '00:00')), 0);
    assert.equal(stepsInRange(samples, IST, ist('2026-10-20', '12:00'), ist('2026-10-20', '12:00')), 0, 'an empty range');
  });

  test('the same rules as the day totals: glitches skipped, a reboot gap is 0 steps', () => {
    const glitch = [s(ist('2026-10-20', '10:00'), 1_000), s(ist('2026-10-20', '11:00'), 900_000), s(ist('2026-10-20', '12:00'), 1_500)];
    assert.equal(stepsInRange(glitch, IST, ist('2026-10-20', '10:00'), ist('2026-10-20', '12:00')), 500);
    const a = bootOf(41, ist('2026-10-19', '20:00'));
    const b = bootOf(42, ist('2026-10-20', '13:00'));
    const reboot = [a(ist('2026-10-20', '12:00'), 12_000), b(ist('2026-10-20', '14:00'), 600)];
    assert.equal(stepsInRange(reboot, IST, ist('2026-10-20', '12:00'), ist('2026-10-20', '13:00')), 0, 'the phone was off');
    assert.equal(stepsInRange(reboot, IST, ist('2026-10-20', '12:30'), ist('2026-10-20', '13:30')), 300);
  });

  test('a whole-day range equals dailyStepCounts (same rounding)', () => {
    const b10 = bootOf(10, ist('2026-10-20', '05:00'));
    const a = bootOf(41, ist('2026-10-19', '20:00'));
    const b = bootOf(42, ist('2026-10-21', '00:30'));
    const ny1 = bootOf(1, ny('2026-03-01', '08:00'));
    const sets: [StepSample[], string][] = [
      // first reading counted from boot, then an hour split across midnight
      [[b10(ist('2026-10-20', '23:00'), 5_000), b10(ist('2026-10-21', '01:00'), 5_240)], IST],
      // uneven splits (largest remainder)
      [[s(ist('2026-10-20', '23:55'), 1_000), s(ist('2026-10-21', '00:05'), 1_007), s(ist('2026-10-21', '00:20'), 1_008)], IST],
      [[s(ist('2026-10-20', '23:57'), 1_000), s(ist('2026-10-21', '00:04'), 1_007), s(ist('2026-10-21', '02:13'), 2_331)], IST],
      // a multi-day estimate
      [[s(ist('2026-10-20', '12:00'), 1_000), s(ist('2026-10-23', '12:00'), 73_001)], IST],
      // a reboot after midnight
      [[a(ist('2026-10-20', '06:00'), 1_000), a(ist('2026-10-20', '22:00'), 6_000), b(ist('2026-10-21', '06:30'), 300), b(ist('2026-10-21', '09:30'), 1_300)], IST],
      // New York spring forward
      [[ny1(ny('2026-03-07', '23:00'), 10_000), ny1(ny('2026-03-09', '01:00'), 12_501)], NY],
    ];
    for (const [list, tz] of sets) {
      const days = dailyStepCounts(list, tz);
      assert.ok(days.size > 0);
      for (const [date, d] of days) assert.equal(stepsInRange(list, tz, dayStartMs(date, tz), dayStartMs(addDays(date, 1), tz)), d.steps, `${tz} ${date}`);
    }
  });

  test('a New York DST day is measured in real time', () => {
    const n = bootOf(1, ny('2026-03-01', '08:00'));
    const spring = [n(ny('2026-03-07', '23:00'), 10_000), n(ny('2026-03-09', '01:00'), 12_500)];
    assert.equal(stepsInRange(spring, NY, dayStartMs('2026-03-08', NY), dayStartMs('2026-03-09', NY)), 2_300);
    // 00:00 → 04:00 on the 8th is 3 real hours (02:00–03:00 doesn't exist): 3 × 100.
    assert.equal(stepsInRange(spring, NY, ny('2026-03-08', '00:00'), ny('2026-03-08', '04:00')), 300);
    const f = bootOf(1, ny('2026-10-25', '08:00'));
    const fall = [f(ny('2026-10-31', '23:00'), 0), f(ny('2026-11-02', '01:00'), 2_700)];
    // 00:00 → 03:00 on 1 November is 4 real hours (01:00–02:00 happens twice): 4 × 100.
    assert.equal(stepsInRange(fall, NY, ny('2026-11-01', '00:00'), ny('2026-11-01', '03:00')), 400);
  });
});

/* ───────────────────────────── Steps v2: Recording API ───────────────────────────── */

const KTM = 'Asia/Kathmandu';
const DAY = 24 * H;
const QUARTER = 15 * MIN;

/**
 * What the Recording API answers for `recordingRange(from, to, minutes)`: buckets of `minutes` from the range start to
 * its last millisecond, non-zero ones only (as the native read returns them). `steps(start)` = a bucket's count.
 */
function fakeBuckets(from: number, to: number, minutes: number, steps: (start: number) => number): RecordingBucket[] {
  const range = recordingRange(from, to, minutes);
  assert.ok(range);
  const out: RecordingBucket[] = [];
  for (let start = range.startMs; start <= range.lastMs; start += minutes * MIN) {
    const n = steps(start);
    if (n > 0) out.push({ start, end: Math.min(start + minutes * MIN, range.lastMs + 1), steps: n });
  }
  return out;
}

const recording = (steps: number, coverFrom: number, complete: boolean) => ({ source: 'phone', counter: 'recording', steps, coverFrom, complete });

describe('recordingDays — 15-min buckets to local days (T4)', () => {
  /** 1 step every quarter-hour, but 10 in the one that ends at `midnight` and 1 000 in the one that starts there. */
  const marked = (midnight: number) => (start: number) => (start === midnight - QUARTER ? 10 : start === midnight ? 1_000 : 1);
  const cases: [zone: string, day: string, quarters: number][] = [
    [IST, '2026-10-20', 96],
    [KTM, '2026-10-20', 96],
    [NY, '2026-03-08', 92], // spring forward: 23 h
    [NY, '2026-11-01', 100], // fall back: 25 h
  ];
  for (const [tz, day, quarters] of cases) {
    test(`${tz} ${day}: ${quarters} quarter-hours, split exactly at local midnight`, () => {
      const next = addDays(day, 1);
      const s = dayStartMs(day, tz);
      const midnight = dayStartMs(next, tz);
      const e = dayStartMs(addDays(next, 1), tz);
      assert.equal((midnight - s) / QUARTER, quarters);
      const now = e + 2 * H;
      const days = recordingDays(fakeBuckets(s, now, 15, marked(midnight)), [day, next], tz, recordingWindow(s - DAY, now));
      assert.deepEqual(days.get(day), recording(quarters - 1 + 10, s, true));
      assert.deepEqual(days.get(next), recording((e - midnight) / QUARTER - 1 + 1_000, midnight, true), 'the hours after it belong to the day after');
    });
  }

  test('a bucket straddling midnight (never with recordingRange’s alignment) is split by time', () => {
    const midnight = dayStartMs('2026-10-21', IST);
    const days = recordingDays([{ start: midnight - 10 * MIN, end: midnight + 5 * MIN, steps: 300 }], ['2026-10-20', '2026-10-21'], IST, recordingWindow(midnight - 2 * DAY, midnight + 2 * H));
    assert.equal(days.get('2026-10-20')?.steps, 200);
    assert.equal(days.get('2026-10-21')?.steps, 100);
  });
});

describe('recordingRange (T5)', () => {
  test('the start is floored to a UTC quarter-hour; the end is the last millisecond (the read’s end is inclusive)', () => {
    assert.deepEqual(recordingRange(Date.parse('2026-10-20T10:07:31.500Z'), Date.parse('2026-10-20T12:00:00Z')), {
      startMs: Date.parse('2026-10-20T10:00:00Z'),
      lastMs: Date.parse('2026-10-20T12:00:00Z') - 1,
      bucketMinutes: 15,
    });
    assert.equal(recordingRange(Date.parse('2026-10-20T10:15:00Z'), Date.parse('2026-10-20T10:20:00Z'))?.startMs, Date.parse('2026-10-20T10:15:00Z'));
  });

  test('local midnights are already on a UTC quarter-hour in every real offset (+05:30, +05:45, +08:45, +13:45, DST)', () => {
    const zones: [string, string][] = [
      [IST, '2026-10-20'],
      [KTM, '2026-10-20'],
      ['Australia/Eucla', '2026-10-20'],
      ['Pacific/Chatham', '2026-10-20'],
      [NY, '2026-03-08'],
      [NY, '2026-11-01'],
    ];
    for (const [tz, day] of zones) {
      const s = dayStartMs(day, tz);
      assert.equal(recordingRange(s, s + DAY)?.startMs, s, `${tz} ${day}`);
    }
  });

  test('1-minute buckets (bases): floored to the minute; an empty range reads nothing', () => {
    assert.equal(recordingRange(Date.parse('2026-10-20T10:07:31.500Z'), Date.parse('2026-10-20T12:00:00Z'), 1)?.startMs, Date.parse('2026-10-20T10:07:00Z'));
    assert.equal(recordingRange(ist('2026-10-20', '10:00'), ist('2026-10-20', '10:00')), null);
    assert.equal(recordingRange(ist('2026-10-20', '10:00'), ist('2026-10-20', '09:00')), null);
  });
});

describe('recordingDays — the 10-day window (T6)', () => {
  const now = ist('2026-10-27', '12:00');

  test('the window runs from the later of the subscription and now − 10 days, to now', () => {
    assert.deepEqual(recordingWindow(ist('2026-10-01', '09:00'), now), { start: now - 10 * DAY, end: now });
    assert.deepEqual(recordingWindow(ist('2026-10-25', '14:10'), now), { start: ist('2026-10-25', '14:10'), end: now });
  });

  test('subscribed mid-day: the day before → null, that day → from the subscription, a day with no buckets → 0', () => {
    const sub = ist('2026-10-25', '14:10');
    const buckets: RecordingBucket[] = [
      { start: ist('2026-10-25', '13:00'), end: ist('2026-10-25', '13:15'), steps: 999 }, // before the window: never counts
      { start: ist('2026-10-25', '15:00'), end: ist('2026-10-25', '15:15'), steps: 400 },
      { start: ist('2026-10-27', '09:00'), end: ist('2026-10-27', '09:15'), steps: 50 },
      { start: ist('2026-10-27', '12:15'), end: ist('2026-10-27', '12:30'), steps: 70 }, // after now: never counts
    ];
    const days = recordingDays(buckets, ['2026-10-28', '2026-10-27', '2026-10-26', '2026-10-25', '2026-10-24'], IST, recordingWindow(sub, now));
    assert.equal(days.get('2026-10-28'), null, 'not started yet');
    assert.deepEqual(days.get('2026-10-27'), recording(50, dayStartMs('2026-10-27', IST), false));
    assert.deepEqual(days.get('2026-10-26'), recording(0, dayStartMs('2026-10-26', IST), true), 'covered, really 0');
    assert.deepEqual(days.get('2026-10-25'), recording(400, sub, true));
    assert.equal(days.get('2026-10-24'), null, 'before the subscription: no data, never 0');
  });

  test('older than 10 days → null; the day the window starts in is covered from there', () => {
    const days = recordingDays([], ['2026-10-17', '2026-10-16'], IST, recordingWindow(ist('2026-09-01', '09:00'), now));
    assert.equal(days.get('2026-10-16'), null);
    assert.deepEqual(days.get('2026-10-17'), recording(0, now - 10 * DAY, true));
  });

  test('a subscription time in the future (the clock moved back) reads nothing', () => {
    const days = recordingDays([{ start: ist('2026-10-27', '09:00'), end: ist('2026-10-27', '09:15'), steps: 50 }], ['2026-10-27'], IST, recordingWindow(now + H, now));
    assert.equal(days.get('2026-10-27'), null);
  });

  test(`a past day is complete only on a read ${RECORDING_FRESH_MS / MIN} min after it ended (freshness, C9.4)`, () => {
    const e = dayStartMs('2026-10-27', IST);
    const read = (t: number) => recordingDays([], ['2026-10-26'], IST, recordingWindow(e - 5 * DAY, t)).get('2026-10-26')?.complete;
    assert.equal(read(e + 30 * MIN), false);
    assert.equal(read(e + RECORDING_FRESH_MS), true);
  });
});

describe('recordingSince — 1-min buckets (T7)', () => {
  const day = '2026-10-20';
  const perMinute = fakeBuckets(ist(day, '08:00'), ist(day, '12:00'), 1, () => 1);

  test('`at` is floored to the minute and the sum covers [at, end)', () => {
    const at = ist(day, '09:30') + 40_000;
    assert.equal(recordingRange(at, ist(day, '11:00'), 1)?.startMs, ist(day, '09:30'));
    assert.equal(recordingSince(perMinute, at, ist(day, '11:00')), 90);
    assert.equal(recordingSince(perMinute, ist(day, '09:30'), ist(day, '09:31')), 1);
    assert.equal(recordingSince(perMinute, ist(day, '11:00'), ist(day, '11:00')), 0);
    assert.equal(recordingSince(perMinute, ist(day, '12:30'), ist(day, '13:00')), 0, 'nothing after the last bucket');
    assert.equal(recordingSince([], at, ist(day, '11:00')), 0);
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

  test('typed LOWER today with nothing counting: the day is that number, and counting that starts later builds on it', async () => {
    forgetServerObservations();
    const f = fakeSync(ist(D, '12:00'), { [D]: 1_200 });
    f.days.set(D, 900); // the sheet's POST
    applyManualSteps(f.deps, f.userId, D, 900, D, null);
    assert.equal(f.record(D)?.base, undefined, 'not frozen: nothing was counting');
    assert.equal(f.record(D)?.sent, 900);
    f.advance(H);
    // Health Connect gets connected and has the whole day: its higher count is saved.
    await saveDay(f.deps, f.userId, { date: D, steps: 5_000, source: 'health_connect', complete: false }, true);
    assert.equal(f.days.get(D), 5_000);
  });

  test('typed today, then this phone starts counting mid-day: its steps add on top of the typed number', async () => {
    forgetServerObservations();
    const f = fakeSync(ist(D, '12:00'));
    f.days.set(D, 900);
    applyManualSteps(f.deps, f.userId, D, 900, D, null);
    f.advance(H);
    const partialFrom = f.now();
    await saveDay(f.deps, f.userId, phoneDay(0, { partialFrom }), true);
    f.advance(H);
    await saveDay(f.deps, f.userId, phoneDay(700, { partialFrom }), true);
    assert.equal(f.days.get(D), 1_600);
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
