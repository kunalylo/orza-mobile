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
  DOSE_ALREADY_TAKEN,
  doseActionBody,
  doseRangeSpan,
  doseRingsUntil,
  isDoseAlreadyTaken,
  isPastRinging,
  MISSED_AFTER_MS,
  parseDoseRange,
  remainingSnoozeMinutes,
  ringsAt,
  snoozeEndOf,
  takenDoseLog,
} from '../../src/lib/alarms/doses';
import { planAlarms } from '../../src/lib/alarms/plan';
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
  test('take / skip right away: acted_at = the press, nothing about snoozes', () => {
    assert.deepEqual(doseActionBody(DOSE, 'take', { pressedAt: PRESS, now: PRESS + 300 }), {
      medication_id: 'm1',
      scheduled_for: '2026-11-01T02:30:00.000Z',
      action: 'take',
      acted_at: '2026-11-01T03:00:00.000Z',
    });
    const skip = doseActionBody(DOSE, 'skip', { pressedAt: PRESS, now: PRESS });
    assert.equal(skip.acted_at, iso(PRESS));
    assert.equal('snooze_until' in skip, false);
    assert.equal('snooze_minutes' in skip, false);
  });

  test('snooze right away: 10 min, ending 10 min after the press', () => {
    const b = doseActionBody(DOSE, 'snooze', { pressedAt: PRESS, now: PRESS + 400 });
    assert.equal(b.acted_at, iso(PRESS));
    assert.equal(b.snooze_until, iso(PRESS + 10 * MIN));
    assert.equal(b.snooze_minutes, 10);
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
    assert.equal(doseActionBody(DOSE, 'snooze', { pressedAt: PRESS, now: PRESS, snoozeMinutes: 30 }).snooze_until, iso(PRESS + 30 * MIN));
    assert.equal(doseActionBody(DOSE, 'snooze', { pressedAt: PRESS, now: PRESS, snoozeMinutes: 90 }).snooze_minutes, 60);
    assert.equal(doseActionBody(DOSE, 'snooze', { pressedAt: PRESS, now: PRESS, snoozeMinutes: 1 }).snooze_until, iso(PRESS + 5 * MIN));
    assert.equal(doseActionBody(DOSE, 'snooze', { pressedAt: PRESS, now: PRESS, snoozeMinutes: null }).snooze_minutes, 10);
    assert.equal(snoozeEndOf(PRESS), PRESS + 10 * MIN);
    assert.equal(remainingSnoozeMinutes(PRESS, 10, PRESS + 20 * MIN), 5);
    assert.equal(remainingSnoozeMinutes(NaN, 15, PRESS), 15);
  });

  test('no / unusable press time → now', () => {
    const now = PRESS + 5_000;
    assert.equal(doseActionBody(DOSE, 'take', { now }).acted_at, iso(now));
    assert.equal(doseActionBody(DOSE, 'take', { pressedAt: NaN, now }).acted_at, iso(now));
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
