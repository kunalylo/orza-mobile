/// <reference types="node" />
/**
 * Steps v2 save plan, display and sync scheduling (`docs/notes/steps-v2.md` §2.4–§2.7) — `npm run test:steps` runs
 * this file next to `steps-counter.test.ts` and `steps-merge.test.ts`. Pure: `policy.ts` and `plan.ts` have no React
 * Native imports.
 *
 * T23–T26: what the phone saves (`policy.savePlan`, M6) and which number Today shows (`policy.shownSteps`).
 * T27–T33: when a past day is final (M7), how far back days are read, the zone freeze (M8), the shared-phone backfill
 * (M9), what Today asks first and which sources are ON (§2.1, §2.2), Apple Health's "no steps" state (`plan.ts`).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { addDays, zonedToUtc } from '../../src/lib/alarms/schedule';
import { dayStartMs } from '../../src/lib/steps/counter';
import { baseForEdit, dayValue, type DayValue } from '../../src/lib/steps/merge';
import {
  BACKGROUND_PAST_DAYS,
  backfill,
  firstAsk,
  grantConsent,
  healthEmpty,
  isFinal,
  LOOKBACK_DAYS,
  lookbackDays,
  pendingPastDays,
  SETTLE_PHONE_MS,
  SETTLE_STORE_MS,
  sourcesOn,
  zoneFrozen,
  type SourceInputs,
} from '../../src/lib/steps/plan';
import { POST_MIN_CHANGE, POST_MIN_INTERVAL_MS, savePlan, saveTarget, shownSteps, type DayRecord } from '../../src/lib/steps/policy';
import type { DayBase, DayReading, SourceReading, StepFeatures } from '../../src/lib/steps/types';

const IST = 'Asia/Kolkata';
const H = 3_600_000;
const MIN = 60_000;
const ist = (date: string, time: string) => zonedToUtc(date, time, IST).getTime();

const D = '2026-10-20';
const S = dayStartMs(D, IST);

/** Day `date` (IST) read with `sources`. */
const dayOf = (sources: SourceReading[], date = D): DayReading => ({
  date,
  start: dayStartMs(date, IST),
  end: dayStartMs(addDays(date, 1), IST),
  sources,
});

const hc = (steps: number, coverFrom = S, extra: Partial<SourceReading> = {}): SourceReading => ({ source: 'health_connect', steps, coverFrom, ...extra });
const recording = (steps: number, coverFrom = S, extra: Partial<SourceReading> = {}): SourceReading => ({
  source: 'phone',
  counter: 'recording',
  steps,
  coverFrom,
  ...extra,
});
const sampler = (steps: number, coverFrom = S, extra: Partial<SourceReading> = {}): SourceReading => ({
  source: 'phone',
  counter: 'sampler',
  steps,
  coverFrom,
  ...extra,
});

const pedometer = (steps: number, coverFrom = S, extra: Partial<SourceReading> = {}): SourceReading => ({
  source: 'phone',
  counter: 'pedometer',
  steps,
  coverFrom,
  ...extra,
});
const health = (steps: number, coverFrom = S): SourceReading => ({ source: 'apple_health', steps, coverFrom });

/** A source's count after a base's `at` (what the reader measures for `ReadOptions.sinceAt`). */
const after = (at: number, steps: number, estimated?: number) => ({ since: { at, steps, ...(estimated != null ? { estimated } : {}) } });

/** The day's value (M5) for a reading and base — the input of the save plan and the display. */
const value = (sources: SourceReading[], isToday: boolean, base?: DayBase | null): DayValue | null => dayValue(dayOf(sources), base, isToday);

/** A plan in one line: `<mode> <steps>[ expect <n>] ref <editRef>`. */
const plan = (p: ReturnType<typeof savePlan>) => (p ? `${p.mode} ${p.steps}${p.expect != null ? ` expect ${p.expect}` : ''} ref ${p.editRef}` : null);

/* ───────────────────────────── T23: estimates ───────────────────────────── */

describe('savePlan — today never saves the estimated part (T23, M3 / R7)', () => {
  const now = ist(D, '18:00');
  const edit: DayBase = { kind: 'edit', steps: 9_000, at: ist(D, '15:00'), editRef: 'm1' };
  const typed: DayBase = { kind: 'start', steps: 6_000, at: ist(D, '09:00') };

  test('no base: today saves the real steps only; a past day saves all of it', () => {
    assert.equal(saveTarget(value([sampler(6_500, S, { estimated: 800 })], true), true), 5_700);
    assert.equal(plan(savePlan(value([sampler(6_500, S, { estimated: 800 })], true), undefined, true, now)), 'auto 5700 ref null');
    assert.equal(plan(savePlan(value([sampler(6_500, S, { estimated: 800 })], false), undefined, false, now)), 'auto 6500 ref null');
  });

  test('a day that is all estimate: nothing today, all of it once past', () => {
    assert.equal(savePlan(value([sampler(4_000, S, { estimated: 4_000 })], true), undefined, true, now), null);
    assert.equal(plan(savePlan(value([sampler(4_000, S, { estimated: 4_000 })], false), undefined, false, now)), 'auto 4000 ref null');
  });

  test('with an edit: the member’s number plus what was really counted after it', () => {
    const v = value([sampler(12_000, S, { estimated: 3_000, ...after(edit.at, 800, 500) })], true, edit);
    assert.equal(v?.steps, 9_800);
    assert.equal(plan(savePlan(v, { server: 9_000, editRef: 'm1' }, true, now)), 'auto 9300 ref m1');
    const past = value([sampler(12_000, S, { estimated: 3_000, ...after(edit.at, 800, 500) })], false, edit);
    assert.equal(plan(savePlan(past, { server: 9_300, autoSent: 9_300, editRef: 'm1' }, false, now)), 'auto 9800 ref m1');
  });

  test('with a start: the typed number plus the real steps counted since', () => {
    const v = value([sampler(1_000, ist(D, '13:00'), { estimated: 300 })], true, typed);
    assert.equal(v?.basis, 'start');
    assert.equal(v?.steps, 7_000);
    assert.equal(plan(savePlan(v, { server: 6_000 }, true, now)), 'auto 6700 ref null');
  });

  test('an estimate never makes a save that lowers today’s server count (no reconcile today)', () => {
    const rec: DayRecord = { server: 5_000, autoSent: 5_000, autoAt: now - H, serverModes: true };
    assert.equal(savePlan(value([sampler(5_200, S, { estimated: 400 })], true), rec, true, now), null);
  });
});

/* ───────────────────────────── T24: today ───────────────────────────── */

describe('savePlan — today: raise only, throttled (T24, M6)', () => {
  const now = ist(D, '12:00');
  const v = (steps: number) => value([recording(steps)], true);

  test('the first count of the day is saved at once (nothing saved yet)', () => {
    assert.equal(plan(savePlan(v(12), undefined, true, now)), 'auto 12 ref null');
    assert.equal(plan(savePlan(v(12), { server: 0 }, true, now)), 'auto 12 ref null');
    assert.equal(savePlan(v(0), undefined, true, now), null, 'nothing above the known floor');
    assert.equal(savePlan(null, undefined, true, now), null, 'no reading, no base');
  });

  test(`≥ ${POST_MIN_CHANGE} steps more, or ${POST_MIN_INTERVAL_MS / MIN} min since the last save`, () => {
    const rec: DayRecord = { autoSent: 1_000, autoAt: now - MIN, server: 1_000 };
    assert.equal(savePlan(v(1_030), rec, true, now), null);
    assert.equal(plan(savePlan(v(1_050), rec, true, now)), 'auto 1050 ref null');
    assert.equal(plan(savePlan(v(1_010), { ...rec, autoAt: now - POST_MIN_INTERVAL_MS }, true, now)), 'auto 1010 ref null');
  });

  test('the known floor is the higher of the server’s count and this phone’s last save', () => {
    const typedOnWeb: DayRecord = { autoSent: 1_000, autoAt: now - H, server: 5_000 };
    assert.equal(savePlan(v(4_000), typedOnWeb, true, now), null, 'never below a higher count saved elsewhere');
    assert.equal(plan(savePlan(v(5_100), typedOnWeb, true, now)), 'auto 5100 ref null');
    assert.equal(savePlan(v(900), { autoSent: 1_000, autoAt: now - H }, true, now), null, 'never below this phone’s own save');
  });

  test('the edit marker this phone knows goes with the save (edit_ref); an unseen one is taken first', () => {
    const rec: DayRecord = { autoSent: 1_000, autoAt: now - H, server: 1_000, editRef: '2026-10-20T03:00:00.000Z' };
    assert.equal(plan(savePlan(v(1_200), rec, true, now)), 'auto 1200 ref 2026-10-20T03:00:00.000Z');
    assert.equal(plan(savePlan(v(1_200), rec, true, now, '2026-10-20T03:00:00.000Z')), 'auto 1200 ref 2026-10-20T03:00:00.000Z');
    assert.equal(savePlan(v(1_200), rec, true, now, '2026-10-20T05:00:00.000Z'), null, 'a newer marker: the edit first (M5c2)');
    assert.equal(plan(savePlan(v(1_200), rec, true, now, null)), 'auto 1200 ref 2026-10-20T03:00:00.000Z', 'no marker read: not a new edit');
  });

  test('counts are clamped to the server’s limit', () => {
    assert.equal(plan(savePlan(v(150_000), undefined, true, now)), 'auto 100000 ref null');
    assert.equal(savePlan(v(150_000), { autoSent: 100_000, autoAt: now - H, server: 100_000 }, true, now), null);
  });
});

/* ───────────────────────────── T25: past days ───────────────────────────── */

describe('savePlan — a past day: raise at once, or reconcile this phone’s own save (T25, M6)', () => {
  const now = ist(addDays(D, 1), '09:00');
  const store = (steps: number) => value([hc(steps, S, { complete: true })], false);
  /** This phone's last automatic save came from Health Connect's whole-day count. */
  const byHc: DayRecord['autoBy'] = { source: 'health_connect', coverFrom: S };

  test('higher → auto, at once (no throttle)', () => {
    assert.equal(plan(savePlan(store(12_001), { autoSent: 12_000, autoAt: now - MIN, server: 12_000, serverModes: true }, false, now)), 'auto 12001 ref null');
  });

  test('lower, and the server still holds this phone’s last automatic save → reconcile (expect it)', () => {
    const rec: DayRecord = { autoSent: 12_000, autoAt: now - 10 * H, server: 12_000, serverModes: true, editRef: 'm1', autoBy: byHc };
    assert.equal(plan(savePlan(store(11_500), rec, false, now)), 'reconcile 11500 expect 12000 ref m1');
  });

  test('lower, and the server holds somebody else’s number → nothing', () => {
    const rec: DayRecord = { autoSent: 12_000, autoAt: now - 10 * H, server: 11_800, serverModes: true };
    assert.equal(savePlan(store(11_500), rec, false, now), null);
    assert.equal(savePlan(store(11_500), { server: 11_800, serverModes: true }, false, now), null, 'never saved automatically by this phone');
  });

  test('a server without the modes (no `applied` seen) → never reconcile', () => {
    assert.equal(savePlan(store(11_500), { autoSent: 12_000, autoAt: now - 10 * H, server: 12_000 }, false, now), null);
    assert.equal(savePlan(store(11_500), { autoSent: 12_000, autoAt: now - 10 * H, server: 12_000, serverModes: false }, false, now), null);
  });

  test('an unseen edit marker → nothing (the edit first)', () => {
    const rec: DayRecord = { autoSent: 12_000, autoAt: now - 10 * H, server: 12_000, serverModes: true };
    assert.equal(savePlan(store(11_500), rec, false, now, '2026-10-21T02:00:00.000Z'), null);
  });

  test('an edit made after the day ended → nothing, ever (M5d)', () => {
    const late = baseForEdit(7_000, now, dayOf([hc(8_000)]), 'm2');
    const v = value([hc(9_000)], false, late);
    assert.equal(v?.fixed, true);
    assert.equal(savePlan(v, { server: 7_000, editRef: 'm2', serverModes: true }, false, now), null);
    assert.equal(saveTarget(v, false), null);
  });

  test('equal → nothing', () => {
    assert.equal(savePlan(store(12_000), { autoSent: 12_000, autoAt: now - 10 * H, server: 12_000, serverModes: true }, false, now), null);
  });

  test('an edit whose count since can’t be seen is a lower bound → raise only, never a reconcile', () => {
    // 10:00 the member typed 3 000 while the Recording API counted; today's reads (with `since`) saved 10 000. The
    // next morning the past day is read without a count since 10:00: 3 000 is not the day.
    const edit: DayBase = { kind: 'edit', steps: 3_000, at: ist(D, '10:00'), editRef: 'm1' };
    // That save was the edit + the Recording API's count since 10:00.
    const autoBy: DayRecord['autoBy'] = { source: 'phone', counter: 'recording', coverFrom: edit.at };
    const rec: DayRecord = { base: edit, editRef: 'm1', autoSent: 10_000, autoAt: ist(D, '22:00'), server: 10_000, serverModes: true, autoBy };
    const blind = value([recording(10_000, S, { complete: true })], false, edit);
    assert.equal(blind?.sinceUnknown, true);
    assert.equal(savePlan(blind, rec, false, now), null);
    // With the count since 10:00 it is the day again: a raise, or a reconcile of this phone's own save.
    assert.equal(plan(savePlan(value([recording(10_400, S, after(ist(D, '10:00'), 7_400))], false, edit), rec, false, now)), 'auto 10400 ref m1');
    assert.equal(plan(savePlan(value([recording(9_800, S, after(ist(D, '10:00'), 6_800))], false, edit), rec, false, now)), 'reconcile 9800 expect 10000 ref m1');
  });

  test('a health store that is ON but wasn’t read this run → nothing for a past day (§2.9); today still raises', () => {
    // A background run without READ_HEALTH_DATA_IN_BACKGROUND: only the Recording API's 9 200 (HC had 11 000).
    const unread = (isToday: boolean) => dayValue({ ...dayOf([recording(9_200, S, { complete: true })]), storeUnread: true }, null, isToday);
    const rec: DayRecord = { autoSent: 11_000, autoAt: now - 10 * H, server: 11_000, serverModes: true };
    assert.equal(savePlan(unread(false), rec, false, now), null, 'no reconcile to the phone’s count');
    assert.equal(savePlan(unread(false), { server: 8_000, serverModes: true }, false, now), null, 'no raise either: the store decides a past day');
    assert.equal(plan(savePlan(unread(true), { server: 8_000, serverModes: true }, true, now)), 'auto 9200 ref null');
  });

  test('the run that may make the day final checks once more: `auto` even below the count last seen (another phone may have lowered it)', () => {
    // This phone's 9 100 was answered "not_higher" (12 000: the other phone's live tail), which that phone reconciled
    // to 9 000 since.
    const rec: DayRecord = { autoSent: 8_000, autoAt: now - 12 * H, server: 12_000, serverModes: true };
    const mine = value([recording(9_100, S, { complete: true })], false);
    assert.equal(savePlan(mine, rec, false, now), null, 'not on every run');
    assert.equal(plan(savePlan(mine, rec, false, now, undefined, { settling: true })), 'auto 9100 ref null');
    assert.equal(plan(savePlan(mine, { ...rec, autoSent: 9_100, server: 9_100 }, false, now, undefined, { settling: true })), 'auto 9100 ref null', 'even its own number');
    // Not on the old server (no reconcile there, and its read before each save guards it), not for nothing to save.
    assert.equal(savePlan(mine, { ...rec, serverModes: false }, false, now, undefined, { settling: true }), null);
    assert.equal(savePlan(value([recording(0, S, { complete: true })], false), rec, false, now, undefined, { settling: true }), null);
    // A reconcile still comes first; today is never settling.
    const byRecording: DayRecord['autoBy'] = { source: 'phone', counter: 'recording', coverFrom: S };
    assert.equal(
      plan(savePlan(mine, { autoSent: 12_000, autoAt: now - 12 * H, server: 12_000, serverModes: true, autoBy: byRecording }, false, now, undefined, { settling: true })),
      'reconcile 9100 expect 12000 ref null'
    );
    assert.equal(savePlan(value([recording(9_100)], true), { ...rec, autoAt: now - H }, true, now, undefined, { settling: true }), null);
  });
});

describe('savePlan — a reconcile replaces only what made this phone’s own save (R/U review, M4, M6)', () => {
  // Nov 1's live tail: 9 000 saved at 23:30 from the Recording API (Health Connect held 4 000: a Fitbit worn part of the
  // day — not this phone's steps). Read again after midnight.
  const now = ist(addDays(D, 1), '00:40');
  const byRecording: DayRecord['autoBy'] = { source: 'phone', counter: 'recording', coverFrom: S };
  const mine = (autoBy: DayRecord['autoBy']): DayRecord => ({ autoSent: 9_000, autoAt: ist(D, '23:30'), server: 9_000, serverModes: true, autoBy });
  const partial = (sources: SourceReading[]) => dayValue({ ...dayOf(sources), phonePartial: true }, null, false);

  test('the phone counter that made the save can’t see the day any more → Health Connect without the phone’s steps never lowers it', () => {
    // Switched off and on after midnight (a new subscription), Play services gone (a fresh sampler), or a day older than
    // the Recording API's 10 days: Health Connect's 4 000 alone.
    assert.equal(savePlan(value([hc(4_000, S, { complete: true })], false), mine(byRecording), false, now), null);
    assert.equal(savePlan(partial([hc(4_000, S, { complete: true })]), mine(byRecording), false, now), null);
    // The same counter re-subscribed: it sees the day only from 20:00 → nothing either.
    assert.equal(savePlan(value([recording(600, ist(D, '20:00'), { complete: true })], false), mine(byRecording), false, now), null);
  });

  test('the phone counter ON but blind for the day is a lower bound even when the store made the save (it may have counted more)', () => {
    const byHc: DayRecord['autoBy'] = { source: 'health_connect', coverFrom: S };
    assert.equal(savePlan(partial([hc(4_000, S, { complete: true })]), mine(byHc), false, now), null);
    // Raises still go through.
    assert.equal(plan(savePlan(partial([hc(9_400, S, { complete: true })]), mine(byHc), false, now)), 'auto 9400 ref null');
  });

  test('re-read whole by what made it → reconcile; a store holding the phone’s steps from as early → reconcile (M4)', () => {
    assert.equal(plan(savePlan(value([recording(8_800, S, { complete: true })], false), mine(byRecording), false, now)), 'reconcile 8800 expect 9000 ref null');
    const samsung = hc(8_500, S, { includesPhone: true, complete: true });
    assert.equal(plan(savePlan(value([samsung], false), mine(byRecording), false, now)), 'reconcile 8500 expect 9000 ref null');
    assert.equal(plan(savePlan(partial([samsung]), mine(byRecording), false, now)), 'reconcile 8500 expect 9000 ref null', 'the phone blind: the store has its steps');
    // iPhone: the motion fallback's live tail, Apple Health the next morning (§2.9).
    const byPedometer: DayRecord['autoBy'] = { source: 'phone', counter: 'pedometer', coverFrom: S };
    assert.equal(plan(savePlan(value([health(8_700)], false), mine(byPedometer), false, now)), 'reconcile 8700 expect 9000 ref null');
  });

  test('the store that made the save withdrawn (Disconnect): the phone’s own count never lowers it', () => {
    const byStore: DayRecord['autoBy'] = { source: 'health_connect', coverFrom: S };
    assert.equal(savePlan(value([recording(7_000, S, { complete: true })], false), mine(byStore), false, now), null);
    const byHealth: DayRecord['autoBy'] = { source: 'apple_health', coverFrom: S };
    assert.equal(savePlan(value([pedometer(7_000, S, { complete: true })], false), mine(byHealth), false, now), null);
  });

  test('a save whose origin isn’t known (a record from before this rule) is never reconciled; raises still are', () => {
    assert.equal(savePlan(value([hc(8_500, S, { includesPhone: true, complete: true })], false), mine(undefined), false, now), null);
    assert.equal(plan(savePlan(value([hc(9_500, S, { includesPhone: true, complete: true })], false), mine(undefined), false, now)), 'auto 9500 ref null');
  });

  test('the plan names what its number comes from (kept on the record when applied)', () => {
    assert.deepEqual(savePlan(value([recording(9_500, S, { complete: true })], false), mine(byRecording), false, now)?.by, byRecording);
    const typed: DayBase = { kind: 'start', steps: 6_000, at: ist(D, '09:00') };
    assert.equal(savePlan(value([], false, typed), { server: 5_000, serverModes: true }, false, now)?.by, null, 'the base alone: no source');
  });
});

/* ───────────────────────────── T26: display ───────────────────────────── */

describe('shownSteps — what Today shows (T26, §2.4)', () => {
  const live = (sources: SourceReading[], base?: DayBase) => value(sources, true, base);

  test('today: the higher of the day’s number and the server’s; a tie → the live label', () => {
    assert.deepEqual(shownSteps(live([recording(3_000)]), { server: 2_500 }, 2_500, true), { steps: 3_000, source: 'phone', approximate: false });
    assert.deepEqual(shownSteps(live([recording(3_000)]), undefined, 8_000, true), { steps: 8_000, source: 'saved', approximate: false }, 'typed higher on the website');
    assert.deepEqual(shownSteps(live([hc(2_500)]), undefined, 2_500, true), { steps: 2_500, source: 'health_connect', approximate: false });
  });

  test('today: the winner’s label — the sampler is “approximate”; the store wins a tie', () => {
    assert.deepEqual(shownSteps(live([sampler(4_000)]), undefined, null, true), { steps: 4_000, source: 'phone', approximate: true });
    assert.deepEqual(shownSteps(live([hc(4_000), sampler(4_000)]), undefined, null, true), { steps: 4_000, source: 'health_connect', approximate: false });
    assert.deepEqual(shownSteps(value([{ source: 'apple_health', steps: 4_100, coverFrom: S }], true), undefined, 4_000, true), {
      steps: 4_100,
      source: 'apple_health',
      approximate: false,
    });
  });

  test('today: an edit is “Edited by you”, whichever number is higher', () => {
    const edit: DayBase = { kind: 'edit', steps: 9_000, at: ist(D, '12:00'), editRef: 'm1' };
    const day = live([recording(14_050, S, after(edit.at, 50))], edit);
    assert.deepEqual(shownSteps(day, { base: edit, server: 9_000 }, 9_000, true), { steps: 9_050, source: 'edited', approximate: false });
    assert.deepEqual(shownSteps(day, { base: edit }, 9_500, true), { steps: 9_500, source: 'edited', approximate: false });
    // No reading published (yet): the server's number, still the member's.
    assert.deepEqual(shownSteps(null, { base: edit, server: 9_000 }, 9_000, true), { steps: 9_000, source: 'edited', approximate: false });
  });

  test('today: a start shows the counting source; the start alone (nothing counted yet) is “Saved”', () => {
    const typed: DayBase = { kind: 'start', steps: 5_000, at: ist(D, '09:00') };
    assert.deepEqual(shownSteps(live([recording(3_000, ist(D, '14:00'))], typed), { base: typed, server: 5_000 }, 5_000, true), {
      steps: 8_000,
      source: 'phone',
      approximate: false,
    });
    assert.deepEqual(shownSteps(live([], typed), { base: typed, server: 5_000 }, 5_000, true), { steps: 5_000, source: 'saved', approximate: false });
  });

  test('today offline: the last known server count (or this phone’s save) — never drops below it', () => {
    assert.deepEqual(shownSteps(live([recording(1_200)]), { server: 4_000, autoSent: 4_000 }, null, true), { steps: 4_000, source: 'saved', approximate: false });
    assert.deepEqual(shownSteps(live([recording(1_200)]), { autoSent: 4_000 }, undefined, true), { steps: 4_000, source: 'saved', approximate: false });
    assert.deepEqual(shownSteps(live([recording(5_000)]), { server: 4_000 }, null, true), { steps: 5_000, source: 'phone', approximate: false });
  });

  test('a past day: the server’s count (the reconciled truth), even when the day’s number differs', () => {
    const past = value([hc(9_000, S, { complete: true })], false);
    assert.deepEqual(shownSteps(past, { server: 9_500 }, 9_500, false), { steps: 9_500, source: 'saved', approximate: false });
    assert.deepEqual(shownSteps(past, { server: 9_500 }, 8_000, false), { steps: 8_000, source: 'saved', approximate: false }, 'the fresh server read wins');
    assert.deepEqual(shownSteps(past, undefined, 9_000, false), { steps: 9_000, source: 'health_connect', approximate: false }, 'equal → its label');
    const edit: DayBase = { kind: 'edit', steps: 7_000, at: ist(addDays(D, 1), '09:00') };
    assert.deepEqual(shownSteps(null, { base: edit }, 7_000, false), { steps: 7_000, source: 'edited', approximate: false });
  });

  test('a past day offline: the day’s number; else the last known count', () => {
    const past = value([hc(9_000, S, { complete: true })], false);
    assert.deepEqual(shownSteps(past, { server: 9_500 }, null, false), { steps: 9_000, source: 'health_connect', approximate: false });
    assert.deepEqual(shownSteps(null, { server: 9_500 }, null, false), { steps: 9_500, source: 'saved', approximate: false });
  });

  test('nothing known → null', () => {
    assert.equal(shownSteps(null, undefined, null, true), null);
    assert.equal(shownSteps(null, undefined, undefined, false), null);
  });
});

/* ───────────────────────────── T27–T28: when a past day is final ───────────────────────────── */

const E = dayStartMs(addDays(D, 1), IST);

describe('isFinal — a store is ON: final 72 h after the day ends (T27, M7)', () => {
  const past = dayOf([hc(9_000, S, { complete: true })]);

  test('pending until e + 72 h (a watch’s late sync is still caught), then final', () => {
    assert.equal(isFinal(past, undefined, E + H, true), false);
    assert.equal(isFinal(past, undefined, E + SETTLE_STORE_MS - 1, true), false);
    assert.equal(isFinal(past, undefined, E + SETTLE_STORE_MS, true), true);
    assert.equal(SETTLE_STORE_MS, 72 * H);
  });

  test('a day with no data is final at e + 72 h too', () => {
    assert.equal(isFinal(dayOf([]), undefined, E + 71 * H, true), false);
    assert.equal(isFinal(dayOf([]), undefined, E + 72 * H, true), true);
  });

  test('a complete phone count doesn’t settle it early while a store is ON (a CMPedometer 0 neither)', () => {
    assert.equal(isFinal(dayOf([hc(9_000), recording(9_100, S, { complete: true })]), undefined, E + 2 * H, true), false);
    assert.equal(isFinal(dayOf([pedometer(0, S, { complete: true })]), undefined, E + 2 * H, true), false);
  });

  test('today is never final; a day already final stays final', () => {
    assert.equal(isFinal(past, undefined, ist(D, '23:59'), true), false);
    assert.equal(isFinal(past, { final: true }, E + H, true), true);
  });

  test('final only once saved: the sync marks the record after an ok save, then the day is no longer pending', () => {
    const records: Record<string, DayRecord> = {};
    const today = addDays(D, 4);
    assert.ok(pendingPastDays(today, (d) => records[d], 30, null, IST).includes(D));
    records[D] = { autoSent: 9_000, final: true };
    assert.equal(pendingPastDays(today, (d) => records[d], 30, null, IST).includes(D), false);
  });
});

describe('isFinal — phone only (T28, M7)', () => {
  test(`final when the winner is complete and t ≥ e + ${SETTLE_PHONE_MS / MIN} min`, () => {
    const day = dayOf([sampler(8_000, S, { complete: true })]);
    assert.equal(isFinal(day, undefined, E + SETTLE_PHONE_MS - 1, false), false);
    assert.equal(isFinal(day, undefined, E + SETTLE_PHONE_MS, false), true);
    assert.equal(isFinal(dayOf([recording(8_000, S, { complete: true })]), undefined, E + SETTLE_PHONE_MS, false), true);
    assert.equal(isFinal(dayOf([pedometer(0, S, { complete: true })]), undefined, E + SETTLE_PHONE_MS, false), true, 'a real 0');
  });

  test('an uncertain reboot gap (not complete) is never final before 72 h', () => {
    const gap = dayOf([sampler(8_000, S, { complete: false })]);
    assert.equal(isFinal(gap, undefined, E + SETTLE_PHONE_MS, false), false);
    assert.equal(isFinal(gap, undefined, E + 71 * H, false), false);
    assert.equal(isFinal(gap, undefined, E + 72 * H, false), true);
  });

  test('no reading: final at e + 72 h', () => {
    assert.equal(isFinal(dayOf([]), undefined, E + 71 * H, false), false);
    assert.equal(isFinal(dayOf([]), undefined, E + 72 * H, false), true);
  });

  test('the winner decides: a complete sampler beaten by an incomplete Recording API count is not final yet', () => {
    const day = dayOf([sampler(8_000, S, { complete: true }), recording(8_100, S, { complete: false })]);
    assert.equal(isFinal(day, undefined, E + 2 * H, false), false);
  });
});

describe('isFinal — never on a count that may be missing steps', () => {
  test('a health store that is ON but wasn’t read this run: not final, not even after 72 h', () => {
    const unread: DayReading = { ...dayOf([recording(9_200, S, { complete: true })]), storeUnread: true };
    assert.equal(isFinal(unread, undefined, E + 2 * H, false), false);
    assert.equal(isFinal(unread, undefined, E + 80 * H, true), false);
    assert.equal(isFinal(unread, { final: true }, E + 2 * H, true), true, 'a day already final stays so');
  });

  test('an edit whose count since can’t be seen: not final before 72 h (a later read may have it), then final', () => {
    const at = ist(D, '10:00');
    const edit: DayBase = { kind: 'edit', steps: 3_000, at, editRef: 'm1' };
    const day = dayOf([recording(10_000, S, { complete: true })]);
    assert.equal(isFinal(day, { base: edit }, E + 2 * H, false), false);
    assert.equal(isFinal(dayOf([recording(10_000, S, { complete: true, ...after(at, 7_000) })]), { base: edit }, E + 2 * H, false), true);
    assert.equal(isFinal(day, { base: edit }, E + SETTLE_STORE_MS, false), true);
  });
});

/* ───────────────────────────── T29–T30: which past days are read ───────────────────────────── */

describe('lookback and pending past days (T29)', () => {
  const today = '2026-10-31';

  test('lookback per source: a store 30 days, the Recording API 9, the sampler 9, CMPedometer 7 — the largest ON one', () => {
    assert.deepEqual(LOOKBACK_DAYS, { store: 30, recording: 9, sampler: 9, pedometer: 7 });
    assert.equal(lookbackDays(['store']), 30);
    assert.equal(lookbackDays(['recording']), 9);
    assert.equal(lookbackDays(['sampler']), 9);
    assert.equal(lookbackDays(['pedometer']), 7);
    assert.equal(lookbackDays(['pedometer', 'store']), 30);
    assert.equal(lookbackDays([]), 0, 'nothing ON → no past day');
  });

  test('every past day up to the lookback, newest first — never today', () => {
    const pending = pendingPastDays(today, () => undefined, 30, null, IST);
    assert.equal(pending.length, 30);
    assert.equal(pending[0], addDays(today, -1));
    assert.equal(pending[29], addDays(today, -30));
    assert.equal(pending.includes(today), false);
  });

  test(`a background run reads at most ${BACKGROUND_PAST_DAYS} past days: the newest pending ones`, () => {
    const all = pendingPastDays(today, () => undefined, 30, null, IST, BACKGROUND_PAST_DAYS);
    assert.deepEqual(
      all,
      [1, 2, 3, 4, 5, 6, 7].map((i) => addDays(today, -i))
    );
    const final: DayRecord = { final: true };
    const someFinal = pendingPastDays(today, (d) => (d >= addDays(today, -2) ? final : undefined), 30, null, IST, BACKGROUND_PAST_DAYS);
    assert.deepEqual(
      someFinal,
      [3, 4, 5, 6, 7, 8, 9].map((i) => addDays(today, -i))
    );
  });

  test('no day that ended before the coverage floor (M9: a shared phone)', () => {
    const floor = ist(addDays(today, -3), '13:00');
    assert.deepEqual(
      pendingPastDays(today, () => undefined, 30, floor, IST),
      [1, 2, 3].map((i) => addDays(today, -i)),
      'the consent day itself is read (from the floor)'
    );
    const atMidnight = dayStartMs(addDays(today, -2), IST);
    assert.deepEqual(
      pendingPastDays(today, () => undefined, 30, atMidnight, IST),
      [1, 2].map((i) => addDays(today, -i))
    );
    assert.deepEqual(pendingPastDays(today, () => undefined, 30, ist(today, '08:00'), IST), [], 'consented today');
  });
});

describe('the zone freeze (T30, M8)', () => {
  const today = '2026-10-31';
  const LONDON = 'Europe/London';
  const records: Record<string, DayRecord> = {
    [addDays(today, -1)]: { autoSent: 8_000, tz: IST },
    [addDays(today, -2)]: { server: 3_000, tz: IST },
    [addDays(today, -3)]: { autoSent: 5_000, tz: LONDON },
  };

  test('a day saved under Asia/Kolkata is not re-read after the profile moves to Europe/London', () => {
    assert.deepEqual(
      pendingPastDays(today, (d) => records[d], 3, null, LONDON),
      [addDays(today, -2), addDays(today, -3)],
      'saved under IST → frozen; nothing saved → still read'
    );
    assert.deepEqual(pendingPastDays(today, (d) => records[d], 3, null, IST), [addDays(today, -1), addDays(today, -2)]);
    assert.equal(zoneFrozen(records[addDays(today, -1)], LONDON), true);
    assert.equal(zoneFrozen({ autoSent: 8_000 }, LONDON), false, 'no zone stored (an old record)');
    assert.equal(zoneFrozen(undefined, LONDON), false);
  });

  test('today is re-read: never final, whatever zone its record was saved under', () => {
    const now = zonedToUtc(today, '10:00', LONDON).getTime();
    const londonToday: DayReading = { date: today, start: dayStartMs(today, LONDON), end: dayStartMs(addDays(today, 1), LONDON), sources: [] };
    assert.equal(isFinal(londonToday, { autoSent: 4_000, tz: IST }, now, false), false);
  });
});

/* ───────────────────────────── T31: the shared-phone backfill ───────────────────────────── */

describe('backfill on a shared phone (T31, M9)', () => {
  const t1 = ist(D, '09:00');
  const t2 = ist(addDays(D, 3), '19:30');
  const t3 = ist(addDays(D, 5), '08:00');

  test('the first member on the install → a full backfill (each source’s lookback)', () => {
    const c = grantConsent({}, 'amy', 'store', t1);
    assert.deepEqual(c.amy, { store: { at: t1 }, sharedAtConsent: false });
    assert.equal(backfill(c, 'amy'), null);
  });

  test('a second member → only from their consent', () => {
    const c = grantConsent(grantConsent({}, 'amy', 'store', t1), 'ben', 'phone', t2);
    assert.deepEqual(c.ben, { phone: { at: t2 }, sharedAtConsent: true });
    assert.equal(backfill(c, 'ben'), t2);
    assert.equal(backfill(c, 'amy'), null, 'the first member is unchanged');
    // A later consent to the other kind keeps the floor at the first one.
    assert.equal(backfill(grantConsent(c, 'ben', 'store', t3), 'ben'), t2);
  });

  test('the same member returning → unchanged (not asked again, no new floor)', () => {
    const c = grantConsent(grantConsent({}, 'amy', 'store', t1), 'ben', 'phone', t2);
    assert.equal(grantConsent(c, 'amy', 'store', t3), c, 'already agreed: nothing to write');
    const again = grantConsent(c, 'amy', 'phone', t3);
    assert.deepEqual(again.amy, { store: { at: t1 }, phone: { at: t3 }, sharedAtConsent: false });
    assert.equal(backfill(again, 'amy'), null);
  });

  test('a member who agreed and has since deleted their account still makes the install a shared one', () => {
    // Amy agreed, then deleted her account (her record removed, the install remembers that someone had agreed).
    const c = grantConsent({}, 'cat', 'store', t3, true);
    assert.deepEqual(c.cat, { store: { at: t3 }, sharedAtConsent: true });
    assert.equal(backfill(c, 'cat'), t3, 'no backfill of the phone’s history: it was Amy’s walking');
    assert.equal(grantConsent({}, 'cat', 'store', t3, false).cat.sharedAtConsent, false);
    // Decided once: a member who already agreed keeps their flag.
    assert.equal(grantConsent(grantConsent({}, 'amy', 'store', t1), 'amy', 'phone', t2, true).amy.sharedAtConsent, false);
  });

  test('a member who only said “Not now” has no consent record; no consent → no floor', () => {
    const c = grantConsent({ amy: { notNowUntil: t1, sharedAtConsent: false } }, 'ben', 'store', t2);
    assert.equal(c.ben.sharedAtConsent, false);
    assert.equal(grantConsent({ amy: { off: { at: t1 }, store: { at: t1 }, sharedAtConsent: false } }, 'ben', 'store', t2).ben.sharedAtConsent, true, 'switched off still agreed once');
    assert.equal(backfill({}, 'amy'), null);
  });
});

/* ───────────────────────────── T32: what Today asks, which sources are ON ───────────────────────────── */

describe('firstAsk and which sources are ON (T32, §2.1, §2.2)', () => {
  const android = (f: Partial<StepFeatures> = {}): StepFeatures => ({ platform: 'android', store: 'available', stepTracking: false, counter: true, ...f });
  const iphone = (f: Partial<StepFeatures> = {}): StepFeatures => ({ platform: 'ios', store: 'available', counter: true, ...f });
  const all: SourceInputs = { consent: { store: true, phone: true }, storeGranted: true, phoneGranted: true, recordingReady: true };

  test('Android 14+ that counts steps in Health Connect → hc', () => {
    assert.equal(firstAsk(android({ stepTracking: true })), 'hc');
    assert.equal(firstAsk(android({ stepTracking: true, counter: false })), 'hc');
  });

  test('no stepTracking and a step counter → phone (Health Connect waiting to be installed / updated too)', () => {
    assert.equal(firstAsk(android()), 'phone');
    assert.equal(firstAsk(android({ store: 'installable' })), 'phone');
    assert.equal(firstAsk(android({ store: 'unavailable' })), 'phone');
    assert.equal(firstAsk(android({ stepTracking: true, store: 'installable' })), 'phone', 'HC must be available to count the phone');
  });

  test('no counter, Health Connect available or installable → hc (watches and apps only)', () => {
    assert.equal(firstAsk(android({ counter: false })), 'hc');
    assert.equal(firstAsk(android({ counter: false, store: 'installable' })), 'hc');
  });

  test('neither → none (Log steps only)', () => {
    assert.equal(firstAsk(android({ counter: false, store: 'unavailable' })), 'none');
    assert.equal(firstAsk({ platform: 'none', store: 'unavailable', counter: false }), 'none');
  });

  test('iPhone: Apple Health first; Motion only without HealthKit', () => {
    assert.equal(firstAsk(iphone()), 'healthkit');
    assert.equal(firstAsk(iphone({ store: 'unavailable' })), 'phone');
    assert.equal(firstAsk(iphone({ store: 'unavailable', counter: false })), 'none');
  });

  test('S-A3: Health Connect ON on a stepTracking phone turns every phone source off', () => {
    assert.deepEqual(sourcesOn(android({ stepTracking: true }), all), ['store']);
    assert.deepEqual(sourcesOn(android({ stepTracking: true }), { ...all, storeGranted: false }), ['recording'], 'HC refused: the phone');
    assert.deepEqual(sourcesOn(android({ stepTracking: true }), { ...all, consent: { store: false, phone: true } }), ['recording']);
    assert.deepEqual(sourcesOn(android(), all), ['store', 'recording'], 'Android 9–13 with HC: both');
  });

  test('the Recording API when usable, else the sampler (S-A2, S-A4)', () => {
    assert.deepEqual(sourcesOn(android(), { ...all, recordingReady: false }), ['store', 'sampler']);
    assert.deepEqual(sourcesOn(android(), { ...all, recordingReady: undefined }), ['store', 'sampler']);
  });

  test('nothing is ON without this member’s consent, the permission, or the hardware', () => {
    assert.deepEqual(sourcesOn(android(), { ...all, consent: { store: false, phone: false } }), []);
    assert.deepEqual(sourcesOn(android(), { ...all, phoneGranted: false }), ['store']);
    assert.deepEqual(sourcesOn(android({ counter: false }), all), ['store']);
    assert.deepEqual(sourcesOn(android({ store: 'installable' }), all), ['recording']);
    assert.deepEqual(sourcesOn(iphone(), all), ['store', 'pedometer']);
    assert.deepEqual(sourcesOn(iphone(), { ...all, consent: { store: true, phone: false } }), ['store']);
    assert.deepEqual(sourcesOn({ platform: 'none', store: 'unavailable', counter: false }, all), []);
    assert.equal(lookbackDays(sourcesOn(android({ stepTracking: true }), all)), 30);
  });
});

/* ───────────────────────────── T33: Apple Health with no steps ───────────────────────────── */

describe('healthEmpty (T33, §2.2)', () => {
  const today = '2026-10-31';
  /** Today and the 7 days before it, read with `sources(i)` (i = days back). */
  const week = (sources: (i: number) => SourceReading[]) => [0, 1, 2, 3, 4, 5, 6, 7].map((i) => dayOf(sources(i), addDays(today, -i)));

  test('7 past days and today without an Apple Health count → true (a 0 is no count, M0)', () => {
    assert.equal(healthEmpty(today, week(() => [])), true);
    assert.equal(healthEmpty(today, week(() => [health(0)])), true);
    assert.equal(healthEmpty(today, week(() => [pedometer(4_000)])), true, 'the phone’s own count doesn’t fill Health');
  });

  test('any value → false', () => {
    assert.equal(healthEmpty(today, week((i) => (i === 5 ? [health(120)] : []))), false);
    assert.equal(healthEmpty(today, week((i) => (i === 0 ? [health(15)] : []))), false);
  });

  test('a day that wasn’t read → not proven empty', () => {
    assert.equal(healthEmpty(today, week(() => []).slice(0, 7)), false);
    assert.equal(healthEmpty(today, []), false);
  });

  test('days no longer read (final): empty when Apple Health had nothing for them when they went final', () => {
    // The first run after consent read 30 days and made days 4–30 back final; later runs read today and days 1–3 only.
    const recent = week(() => []).slice(0, 4);
    const records: Record<string, DayRecord> = {};
    for (let i = 4; i <= 7; i++) records[addDays(today, -i)] = { final: true, noStore: true };
    assert.equal(healthEmpty(today, recent, (d) => records[d]), true);
    records[addDays(today, -6)] = { final: true, autoSent: 4_000 };
    assert.equal(healthEmpty(today, recent, (d) => records[d]), false, 'Health had that day');
    records[addDays(today, -6)] = { noStore: true };
    assert.equal(healthEmpty(today, recent, (d) => records[d]), false, 'not final: it should have been read');
    assert.equal(healthEmpty(today, recent), false, 'without the records: not proven');
  });
});
