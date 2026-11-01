/// <reference types="node" />
/**
 * Dose wire rules (web batch 1) — part of `npm run test:alarms`. Pure: `src/lib/alarms/doses.ts`, the plan's
 * `doseCoveredUntil` and the alarm screen's date text (`doseDayText`, `asTaken` in `features/meds/shared`).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { asTaken, doseDayText } from '../../src/features/meds/shared';
import type { DoseItem } from '../../src/features/meds/types';
import {
  DELAYED_PRESS_MS,
  DOSE_ALREADY_TAKEN,
  doseActionBody,
  doseRangeSpan,
  doseRingsUntil,
  firedAtOf,
  isDoseAlreadyTaken,
  isMissedOnAlarm,
  isOlderThan,
  isPastRinging,
  MISSED_AFTER_MS,
  parseDoseRange,
  remainingSnoozeMinutes,
  ringsAt,
  snoozeEndOf,
  takenDoseLog,
} from '../../src/lib/alarms/doses';
import { planAlarms } from '../../src/lib/alarms/plan';
import { alarmOpenPath, pathParam } from '../../src/lib/alarms/presence';
import { utcToZoned, zonedToUtc } from '../../src/lib/alarms/schedule';
import type { PlanMedication, PlanReminder } from '../../src/lib/alarms/types';

const IST = 'Asia/Kolkata';
const MIN = 60_000;
const H = 60 * MIN;
const PRESS = Date.parse('2026-11-01T03:00:00.000Z'); // 08:30 IST
const DOSE = { medication_id: 'm1', scheduled_for: '2026-11-01T02:30:00.000Z' };
const iso = (ms: number) => new Date(ms).toISOString();
const dateIST = (s: string) => utcToZoned(new Date(s), IST).date;

describe('POST /api/meds/doses body', () => {
  // A press sent right away goes on ÖRZA's clock (no acted_at / snooze_until): a phone clock that is off — days behind,
  // or an hour fast — must not change when a dose counts as taken or how long a snooze lasts on the server.
  test('take / skip sent right away: no acted_at (ÖRZA records its own time), nothing about snoozes', () => {
    assert.deepEqual(doseActionBody(DOSE, 'take', { pressedAt: PRESS, now: PRESS + 300 }), {
      medication_id: 'm1',
      scheduled_for: '2026-11-01T02:30:00.000Z',
      action: 'take',
    });
    const skip = doseActionBody(DOSE, 'skip', { pressedAt: PRESS, now: PRESS });
    assert.equal('acted_at' in skip, false);
    assert.equal('snooze_until' in skip, false);
    assert.equal('snooze_minutes' in skip, false);
  });

  test('snooze sent right away: only snooze_minutes = 10 (the server starts it on arrival)', () => {
    const b = doseActionBody(DOSE, 'snooze', { pressedAt: PRESS, now: PRESS + 400 });
    assert.equal('acted_at' in b, false);
    assert.equal('snooze_until' in b, false);
    assert.equal(b.snooze_minutes, 10);
  });

  test('the live case: a phone clock days behind pressing Take / Snooze on the Today screen sends no phone time', () => {
    const behind = PRESS - 5 * 24 * H; // the phone's clock (pressedAt and now both come from it)
    const take = doseActionBody(DOSE, 'take', { pressedAt: behind, now: behind + 1_000 });
    assert.equal('acted_at' in take, false);
    const snooze = doseActionBody(DOSE, 'snooze', { pressedAt: behind, now: behind + 1_000 });
    assert.equal('snooze_until' in snooze, false);
    assert.equal(snooze.snooze_minutes, 10);
  });

  test('delayed below DELAYED_PRESS_MS still counts as right away; a clock that went back too', () => {
    assert.equal(DELAYED_PRESS_MS, 30_000);
    assert.equal('acted_at' in doseActionBody(DOSE, 'take', { pressedAt: PRESS, now: PRESS + DELAYED_PRESS_MS - 1 }), false);
    assert.equal('acted_at' in doseActionBody(DOSE, 'take', { pressedAt: PRESS, now: PRESS - 5 * MIN }), false);
    assert.equal(doseActionBody(DOSE, 'take', { pressedAt: PRESS, now: PRESS + DELAYED_PRESS_MS }).acted_at, iso(PRESS));
  });

  test('take / skip sent late (queued offline / app asleep): acted_at = the press', () => {
    assert.deepEqual(doseActionBody(DOSE, 'take', { pressedAt: PRESS, now: PRESS + 3 * MIN }), {
      medication_id: 'm1',
      scheduled_for: '2026-11-01T02:30:00.000Z',
      action: 'take',
      acted_at: '2026-11-01T03:00:00.000Z',
    });
    const skip = doseActionBody(DOSE, 'skip', { pressedAt: PRESS, now: PRESS + 2 * H });
    assert.equal(skip.acted_at, iso(PRESS));
    assert.equal('snooze_until' in skip, false);
    assert.equal('snooze_minutes' in skip, false);
  });

  test('snooze sent late (queued offline / app asleep): snooze_until stays press + 10; snooze_minutes = what is left, ≥ 5', () => {
    const three = doseActionBody(DOSE, 'snooze', { pressedAt: PRESS, now: PRESS + 3 * MIN });
    assert.equal(three.snooze_until, iso(PRESS + 10 * MIN));
    assert.equal(three.acted_at, iso(PRESS));
    assert.equal(three.snooze_minutes, 7);
    const eight = doseActionBody(DOSE, 'snooze', { pressedAt: PRESS, now: PRESS + 8 * MIN });
    assert.equal(eight.snooze_until, iso(PRESS + 10 * MIN));
    assert.equal(eight.snooze_minutes, 5); // the server's minimum (older servers start it on arrival)
  });

  test('snooze length: clamped to the server 5–60, default 10', () => {
    const late = PRESS + MIN; // sent a minute after the press: snooze_until is sent
    assert.equal(doseActionBody(DOSE, 'snooze', { pressedAt: PRESS, now: late, snoozeMinutes: 30 }).snooze_until, iso(PRESS + 30 * MIN));
    assert.equal(doseActionBody(DOSE, 'snooze', { pressedAt: PRESS, now: PRESS, snoozeMinutes: 90 }).snooze_minutes, 60);
    assert.equal(doseActionBody(DOSE, 'snooze', { pressedAt: PRESS, now: late, snoozeMinutes: 1 }).snooze_until, iso(PRESS + 5 * MIN));
    assert.equal(doseActionBody(DOSE, 'snooze', { pressedAt: PRESS, now: PRESS, snoozeMinutes: 1 }).snooze_minutes, 5);
    assert.equal(doseActionBody(DOSE, 'snooze', { pressedAt: PRESS, now: PRESS, snoozeMinutes: null }).snooze_minutes, 10);
    assert.equal(snoozeEndOf(PRESS), PRESS + 10 * MIN);
    assert.equal(remainingSnoozeMinutes(PRESS, 10, PRESS + 20 * MIN), 5);
    assert.equal(remainingSnoozeMinutes(NaN, 15, PRESS), 15);
  });

  test('no / unusable press time → sent as right away (no acted_at)', () => {
    const now = PRESS + 5_000;
    assert.equal('acted_at' in doseActionBody(DOSE, 'take', { now }), false);
    assert.equal('acted_at' in doseActionBody(DOSE, 'take', { pressedAt: NaN, now }), false);
    assert.equal(doseActionBody(DOSE, 'snooze', { pressedAt: NaN, now }).snooze_minutes, 10);
  });
});

describe('409 dose_already_taken', () => {
  test('only the 409 with its code', () => {
    assert.equal(isDoseAlreadyTaken({ status: 409, code: DOSE_ALREADY_TAKEN, message: 'Telma is already marked as taken…' }), true);
    assert.equal(isDoseAlreadyTaken({ status: 409, code: 'conflict' }), false);
    assert.equal(isDoseAlreadyTaken({ status: 400, code: DOSE_ALREADY_TAKEN }), false);
    assert.equal(isDoseAlreadyTaken(new Error('x')), false);
    assert.equal(isDoseAlreadyTaken(null), false);
    assert.equal(isDoseAlreadyTaken('dose_already_taken'), false);
  });

  test('the taken log kept for the planner (normalised instant, no acted_at)', () => {
    assert.deepEqual(takenDoseLog('m1', '2026-11-01T08:00:00+05:30'), { medication_id: 'm1', scheduled_for: '2026-11-01T02:30:00.000Z', status: 'taken' });
  });

  test('asTaken: the row reads "Taken" without a made-up time', () => {
    const d: DoseItem = {
      medication_id: 'm1',
      name: 'Telma',
      dose: '1 tablet',
      timing: 'any',
      form: 'tablet',
      photo_urls: [],
      scheduled_for: DOSE.scheduled_for,
      local_date: '2026-11-01',
      local_time: '08:00',
      status: 'snoozed',
      snooze_until: '2026-11-01T02:40:00.000Z',
      acted_at: '2026-11-01T02:30:30.000Z',
    };
    const t = asTaken(d);
    assert.equal(t.status, 'taken');
    assert.equal(t.acted_at, undefined);
    assert.equal(t.snooze_until, undefined);
    assert.equal(t.name, 'Telma');
  });
});

describe('GET /api/meds/doses?from=&to=', () => {
  test('one span over the days to fetch, ≤ 14 days', () => {
    assert.equal(doseRangeSpan([]), null);
    assert.deepEqual(doseRangeSpan(['2026-11-01']), { from: '2026-11-01', to: '2026-11-01' });
    assert.deepEqual(doseRangeSpan(['2026-11-08', '2026-10-31', '2026-11-03']), { from: '2026-10-31', to: '2026-11-08' });
    assert.deepEqual(doseRangeSpan(['2026-10-25', '2026-11-07']), { from: '2026-10-25', to: '2026-11-07' }); // 14 days
    assert.equal(doseRangeSpan(['2026-10-25', '2026-11-08']), null); // 15 days → day by day
    assert.equal(doseRangeSpan(['junk']), null);
  });

  const span = { from: '2026-10-31', to: '2026-11-02' };

  test('every day of the span, acted logs only, grouped by local date', () => {
    const days = parseDoseRange(
      {
        from: '2026-10-31',
        to: '2026-11-02',
        now: '2026-11-01T03:00:00.000Z',
        doses: [
          { medication_id: 'm1', scheduled_for: '2026-11-01T02:30:00.000Z', local_date: '2026-11-01', local_time: '08:00', status: 'taken', acted_at: '2026-11-01T02:31:00.000Z' },
          {
            medication_id: 'm2',
            scheduled_for: '2026-10-31T15:30:00.000Z',
            local_date: '2026-10-31',
            local_time: '21:00',
            status: 'snoozed',
            acted_at: '2026-10-31T15:31:00.000Z',
            snooze_until: '2026-10-31T15:41:00.000Z',
          },
          { medication_id: 'm3', scheduled_for: '2026-11-01T02:30:00.000Z', local_date: '2026-11-01', status: 'missed' },
          { medication_id: 'm4', scheduled_for: '2026-11-05T02:30:00.000Z', local_date: '2026-11-05', status: 'taken' },
          { medication_id: '', scheduled_for: '2026-11-01T02:30:00.000Z', status: 'taken' },
        ],
      },
      span,
      dateIST
    );
    assert.deepEqual(Object.keys(days ?? {}).sort(), ['2026-10-31', '2026-11-01', '2026-11-02']);
    assert.deepEqual(days?.['2026-11-01'], [
      { medication_id: 'm1', scheduled_for: '2026-11-01T02:30:00.000Z', status: 'taken', acted_at: '2026-11-01T02:31:00.000Z' },
    ]);
    assert.deepEqual(days?.['2026-10-31'], [
      { medication_id: 'm2', scheduled_for: '2026-10-31T15:30:00.000Z', status: 'snoozed', acted_at: '2026-10-31T15:31:00.000Z', snooze_until: '2026-10-31T15:41:00.000Z' },
    ]);
    assert.deepEqual(days?.['2026-11-02'], []);
  });

  test('no local_date → the member timezone decides; the instant is normalised', () => {
    const days = parseDoseRange(
      { from: span.from, to: span.to, doses: [{ medication_id: 'm1', scheduled_for: '2026-10-31T20:00:00+00:00', status: 'skipped' }] },
      span,
      dateIST
    );
    // 20:00Z = 01:30 IST on 1 Nov
    assert.deepEqual(days?.['2026-11-01'], [{ medication_id: 'm1', scheduled_for: '2026-10-31T20:00:00.000Z', status: 'skipped' }]);
    assert.deepEqual(days?.['2026-10-31'], []);
  });

  test('an older server answers "due now" (no from / to): not a range answer → day by day', () => {
    assert.equal(parseDoseRange({ now: '2026-11-01T03:00:00.000Z', doses: [], next: null }, span, dateIST), null);
    assert.equal(parseDoseRange({ from: '2026-10-30', to: span.to, doses: [] }, span, dateIST), null);
    assert.equal(parseDoseRange({ from: span.from, to: span.to }, span, dateIST), null);
    assert.equal(parseDoseRange(null, span, dateIST), null);
    assert.equal(parseDoseRange('nope', span, dateIST), null);
  });
});

describe('missed: no ringing past 60 min (web MISSED_AFTER_MIN)', () => {
  const at = Date.parse(DOSE.scheduled_for);
  const due = { scheduled_for: DOSE.scheduled_for, status: 'due' };

  test('an unanswered dose rings up to 60 min after its time', () => {
    assert.equal(MISSED_AFTER_MS, 60 * MIN);
    assert.equal(isPastRinging(due, at + 59 * MIN), false);
    assert.equal(isPastRinging(due, at + 60 * MIN), false);
    assert.equal(isPastRinging(due, at + 61 * MIN), true);
    assert.equal(doseRingsUntil(due), at + 60 * MIN);
  });

  test('ÖRZA says missed → missed; taken / skipped / snoozed / upcoming never', () => {
    assert.equal(isPastRinging({ ...due, status: 'missed' }, at), true);
    assert.equal(isPastRinging({ ...due, status: 'taken' }, at + 5 * H), false);
    assert.equal(isPastRinging({ ...due, status: 'skipped' }, at + 5 * H), false);
    assert.equal(isPastRinging({ ...due, status: 'snoozed', snooze_until: iso(at + 5 * H) }, at + 4 * H), false);
    assert.equal(isPastRinging({ ...due, status: 'upcoming' }, at - H), false);
  });

  test('a snooze that ended counts from its end (the dose was hours ago)', () => {
    const lapsed = { ...due, snooze_until: iso(at + 3 * H) };
    assert.equal(doseRingsUntil(lapsed), at + 4 * H);
    assert.equal(isPastRinging(lapsed, at + 3 * H + 30 * MIN), false);
    assert.equal(isPastRinging(lapsed, at + 4 * H + MIN), true);
  });

  test('the live case: 27 Oct 21:00 doses seen on 1 Nov are missed, never rung', () => {
    const old = { scheduled_for: zonedToUtc('2026-10-27', '21:00', IST).toISOString(), status: 'due' };
    const now = zonedToUtc('2026-11-01', '02:39', IST).getTime();
    assert.equal(isPastRinging(old, now), true);
    assert.equal(ringsAt(Date.parse(old.scheduled_for), now), false);
  });

  test('ringsAt: a late native alarm still rings within the hour', () => {
    assert.equal(ringsAt(at, at + 45 * MIN), true);
    assert.equal(ringsAt(at, at + 60 * MIN), true);
    assert.equal(ringsAt(at, at + 60 * MIN + 1), false);
  });
});

describe('alarm screen: missed, judged with the alarm that opened it', () => {
  const at = Date.parse(DOSE.scheduled_for); // 08:00 IST
  // ÖRZA never heard of the snooze (pressed on the notification with the app closed, dropped once its 10 min were up):
  // 65 min after the dose its answer says "missed".
  const missed = { ...DOSE, status: 'missed' };
  const due = { ...DOSE, status: 'due' };

  test('the re-ring of a snooze pressed at 8:55 (fired 9:05) still rings at 9:05 — not missed, not silenced', () => {
    const fired = at + 65 * MIN;
    assert.equal(isMissedOnAlarm(missed, at + 65 * MIN + 20_000, { at: fired, medId: 'm1' }), false);
    assert.equal(isMissedOnAlarm(missed, at + 65 * MIN + 20_000, { at: fired }), false); // a group alarm (no medicine)
    // …until 60 min after the snooze's end, like ÖRZA's own rule.
    assert.equal(isMissedOnAlarm(missed, fired + 60 * MIN, { at: fired }), false);
    assert.equal(isMissedOnAlarm(missed, fired + 61 * MIN, { at: fired }), true);
  });

  test('without the alarm (opened in the app, an older link): ÖRZA decides, as before', () => {
    assert.equal(isMissedOnAlarm(missed, at + 65 * MIN), true);
    assert.equal(isMissedOnAlarm(missed, at + 65 * MIN, null), true);
    assert.equal(isMissedOnAlarm(due, at + 61 * MIN), true);
    assert.equal(isMissedOnAlarm(due, at + 30 * MIN), false);
  });

  test('another medicine of that time is still judged by ÖRZA (the re-ring is for m1 only)', () => {
    const other = { medication_id: 'm2', scheduled_for: DOSE.scheduled_for, status: 'missed' };
    assert.equal(isMissedOnAlarm(other, at + 66 * MIN, { at: at + 65 * MIN, medId: 'm1' }), true);
  });

  test('the live case: a phone clock days behind rings 27 Oct doses on 1 Nov — still missed, silenced', () => {
    const old = { medication_id: 'm1', scheduled_for: zonedToUtc('2026-10-27', '21:00', IST).toISOString(), status: 'missed' };
    const serverNow = zonedToUtc('2026-11-01', '02:39', IST).getTime();
    assert.equal(isMissedOnAlarm(old, serverNow, { at: Date.parse(old.scheduled_for), medId: 'm1' }), true);
  });

  test('taken / skipped / snoozed never show as missed, whatever rang', () => {
    for (const status of ['taken', 'skipped']) assert.equal(isMissedOnAlarm({ ...DOSE, status }, at + 5 * H, null), false);
    assert.equal(isMissedOnAlarm({ ...DOSE, status: 'snoozed', snooze_until: iso(at + 5 * H) }, at + 4 * H, null), false);
  });

  test('the `fired` link parameter: epoch ms digits only', () => {
    assert.equal(firedAtOf(String(at)), at);
    for (const bad of [null, undefined, '', '0', '-5', 'abc', '12.5', '1e12', `${at}x`, '99999999999999999']) assert.equal(firedAtOf(bad), null, String(bad));
  });

  test('alarm links opened by the engine carry ringing=1 and fired=<its time>', () => {
    const path = `/alarm?at=${encodeURIComponent(DOSE.scheduled_for)}&med=m1`;
    const fired = at + 65 * MIN;
    const opened = alarmOpenPath(path, { ringing: true, firedAt: fired });
    assert.equal(pathParam(opened, 'ringing'), '1');
    assert.equal(pathParam(opened, 'fired'), String(fired));
    assert.equal(pathParam(opened, 'at'), DOSE.scheduled_for);
    assert.equal(pathParam(opened, 'med'), 'm1');
    // A tap: no ringing, still its time. Unknown time: nothing added.
    const tapped = alarmOpenPath(path, { firedAt: fired });
    assert.equal(pathParam(tapped, 'ringing'), null);
    assert.equal(pathParam(tapped, 'fired'), String(fired));
    assert.equal(alarmOpenPath(path, { firedAt: NaN }), path);
    assert.equal(alarmOpenPath('/alarm', { ringing: true, firedAt: fired }), `/alarm?ringing=1&fired=${fired}`);
    // Only the alarm screen; a test alarm gets ringing only (it records nothing).
    assert.equal(alarmOpenPath('/meals', { ringing: true, firedAt: fired }), '/meals');
    assert.equal(alarmOpenPath('/alarm?test=t1', { ringing: true, firedAt: fired }), '/alarm?test=t1&ringing=1');
  });
});

describe('alarm screen date', () => {
  test('today: nothing; yesterday / tomorrow; else weekday + date (+ year)', () => {
    assert.equal(doseDayText('2026-11-01', '2026-11-01'), '');
    assert.equal(doseDayText('2026-10-31', '2026-11-01'), 'yesterday');
    assert.equal(doseDayText('2026-11-02', '2026-11-01'), 'tomorrow');
    assert.equal(doseDayText('2026-10-27', '2026-11-01'), 'on Tue, 27 Oct');
    assert.equal(doseDayText('2025-12-30', '2026-01-02'), 'on Tue, 30 Dec 2025');
    assert.equal(doseDayText('', '2026-11-01'), '');
  });
});

describe('alarms_local_until (plan.doseCoveredUntil)', () => {
  const NOW = Date.parse('2026-10-15T00:00:00.000Z');
  const med = (id: string, times: string[]): PlanMedication => ({
    id,
    name: `Med ${id}`,
    dose: '1 tablet',
    photo_ids: [],
    photo_urls: [],
    as_needed: false,
    active: true,
    created_at: '2026-01-01T00:00:00.000Z',
    schedule: { times, days: [], start_date: '2026-01-01' },
  });
  const water: PlanReminder = {
    id: 'w',
    kind: 'water',
    title: 'Water',
    active: true,
    channels: { push: true, whatsapp: false, calendar: false },
    schedule: { times: ['11:00', '15:00'], days: [], start_date: '2026-01-01' },
  };

  test('nothing cut → null (no limit)', () => {
    const p = planAlarms({ now: NOW, tz: IST, meds: [med('m1', ['08:00', '20:00'])] });
    assert.equal(p.doseCoveredUntil, null);
  });

  test('the cap cuts the medicine alarms → the first one left out', () => {
    const p = planAlarms({ now: NOW, tz: IST, meds: [med('m1', ['08:00', '14:00', '20:00'])], maxItems: 10 });
    const rang = p.items.filter((i) => i.ring);
    assert.equal(rang.length, 10);
    // 15 Oct 08:00 … 18 Oct 08:00 = 10 doses; the 11th (18 Oct 14:00) is the first left out.
    assert.equal(p.doseCoveredUntil, zonedToUtc('2026-10-18', '14:00', IST).getTime());
  });

  test('only reminders cut → the doses are still covered (null), coveredUntil is not', () => {
    const p = planAlarms({ now: NOW, tz: IST, meds: [med('m1', ['08:00'])], reminders: [water], maxItems: 8 });
    assert.equal(p.items.filter((i) => i.ring).length, 7);
    assert.equal(p.doseCoveredUntil, null);
    assert.ok(p.coveredUntil < p.horizonEnd);
  });
});

describe('ages on the phone clock (isOlderThan)', () => {
  const T = Date.parse('2026-11-02T01:00:00.000Z');
  const MIN = 60_000;

  test('younger than the limit → fresh; at / past it → old', () => {
    assert.equal(isOlderThan(T, 15 * MIN, T + 14 * MIN), false);
    assert.equal(isOlderThan(T, 15 * MIN, T + 15 * MIN), true);
    assert.equal(isOlderThan(T, 15 * MIN, T + 3 * 3_600_000), true);
  });

  test("a limit of 0 (today's dose logs) → always fetched again", () => {
    assert.equal(isOlderThan(T, 0, T), true);
  });

  test('the device case: clock set back 75 min after a fetch — the copy from "the future" is old, not fresh', () => {
    // A negative age used to pass `now - at >= max` as false: no day logs re-read, no foreground sync, an unchanged plan
    // kept, until the clock caught up.
    assert.equal(isOlderThan(T, 30 * MIN, T - 75 * MIN), true);
    assert.equal(isOlderThan(T, 6 * 3_600_000, T - 1), true);
  });

  test('no / unusable time → old', () => {
    assert.equal(isOlderThan(null, 15 * MIN, T), true);
    assert.equal(isOlderThan(undefined, 15 * MIN, T), true);
    assert.equal(isOlderThan(Number.NaN, 15 * MIN, T), true);
  });
});
