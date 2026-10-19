/// <reference types="node" />
/**
 * Automatic step counting tests — `npm run test:steps` (= `npx tsx --test scripts/tests/steps-counter.test.ts`).
 * Pure: the day math (`counter.ts`), the save / display rules (`policy.ts`) and the source pick (`shared.ts`) have no
 * React Native imports.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { zonedToUtc } from '../../src/lib/alarms/schedule';
import { coversWholeDay, dailyStepCounts, dayStartMs, localDay, MAX_STEPS_PER_HOUR, type StepSample } from '../../src/lib/steps/counter';
import { clampSteps, MAX_DAY_STEPS, POST_MIN_INTERVAL_MS, serverAllows, shouldPost, shownSteps } from '../../src/lib/steps/policy';
import { bestOf, dayRanges } from '../../src/lib/steps/shared';

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
