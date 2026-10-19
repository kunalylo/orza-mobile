/// <reference types="node" />
/**
 * Alarm planner tests — `npm run test:alarms` (= `npx tsx --test scripts/tests/alarm-plan.test.ts`).
 * Pure: the planner and schedule port have no React Native imports.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { CONTINUE_NOTE, latestDoseStates, pendingWins, planAlarms, planHash, REFILL_SOON_MS, snoozeAlarmItem, withInAppSnoozes, type PlanInput } from '../../src/lib/alarms/plan';
import { inQuietWindow, occurrencesBetween, utcToZoned, zonedToUtc } from '../../src/lib/alarms/schedule';
import { snoozeAlarmKey, type PlanMedication, type PlanReminder } from '../../src/lib/alarms/types';

const IST = 'Asia/Kolkata';
const NY = 'America/New_York';
const H = 3_600_000;
const MIN = 60_000;

/** 2026-10-15 is a Thursday. 00:00Z = 05:30 IST. */
const NOW = Date.parse('2026-10-15T00:00:00.000Z');
const ist = (date: string, time: string) => zonedToUtc(date, time, IST).getTime();
const iso = (ms: number) => new Date(ms).toISOString();

function med(over: Partial<PlanMedication> & { id: string }): PlanMedication {
  return {
    name: `Med ${over.id}`,
    dose: '1 tablet',
    timing: 'after_food',
    photo_ids: [],
    photo_urls: [],
    as_needed: false,
    active: true,
    created_at: '2026-01-01T00:00:00.000Z',
    ...over,
    schedule: over.schedule ?? { times: ['08:00'], days: [], start_date: '2026-01-01' },
  };
}

function reminder(over: Partial<PlanReminder> & { id: string }): PlanReminder {
  return {
    kind: 'water',
    title: 'Drink a glass of water',
    active: true,
    channels: { push: true, whatsapp: false, calendar: false },
    ...over,
    schedule: over.schedule ?? { times: ['11:00'], days: [], start_date: '2026-01-01' },
  };
}

const plan = (input: Partial<PlanInput>) => planAlarms({ now: NOW, tz: IST, meds: [], ...input });
const doseAts = (p: ReturnType<typeof planAlarms>) => p.items.filter((i) => i.kind === 'dose').map((i) => iso(i.at));

describe('schedules', () => {
  test('daily, two times, IST — keys, links, texts', () => {
    const p = plan({
      horizonDays: 1,
      meds: [med({ id: 'm1', name: 'Metformin', strength: '500 mg', for_person: 'Mom', schedule: { times: ['20:00', '08:00'], days: [], start_date: '2026-01-01' } })],
    });
    assert.deepEqual(doseAts(p), [iso(ist('2026-10-15', '08:00')), iso(ist('2026-10-15', '20:00'))]);
    const first = p.items[0];
    assert.equal(first.key, 'dose:2026-10-15T02:30:00.000Z');
    assert.equal(first.ring, true);
    assert.equal(first.title, '💊 Time for Metformin 500 mg');
    assert.equal(first.body, '1 tablet · after food · for Mom');
    assert.equal(first.path, '/alarm?at=2026-10-15T02%3A30%3A00.000Z&med=m1');
    assert.equal(first.deepLink, 'orza://alarm?at=2026-10-15T02%3A30%3A00.000Z&med=m1');
    assert.equal(first.doses?.[0].scheduledFor, '2026-10-15T02:30:00.000Z');
    assert.equal(first.doses?.[0].localTime, '08:00');
    assert.equal(p.coveredUntil, NOW + 24 * H);
  });

  test('weekdays only (Mon, Wed, Fri)', () => {
    const p = plan({ meds: [med({ id: 'm1', schedule: { times: ['09:00'], days: [1, 3, 5], start_date: '2026-01-01' } })] });
    assert.deepEqual(doseAts(p), [ist('2026-10-16', '09:00'), ist('2026-10-19', '09:00'), ist('2026-10-21', '09:00')].map(iso));
  });

  test('alternate days from the start date', () => {
    const p = plan({ meds: [med({ id: 'm1', schedule: { times: ['08:00'], days: [], start_date: '2026-10-14', every_n_days: 2 } })] });
    assert.deepEqual(doseAts(p), [ist('2026-10-16', '08:00'), ist('2026-10-18', '08:00'), ist('2026-10-20', '08:00')].map(iso));
  });

  test('date range (start in the future, inclusive end)', () => {
    const p = plan({ meds: [med({ id: 'm1', schedule: { times: ['08:00', '21:00'], days: [], start_date: '2026-10-16', end_date: '2026-10-17' } })] });
    assert.deepEqual(
      doseAts(p),
      [ist('2026-10-16', '08:00'), ist('2026-10-16', '21:00'), ist('2026-10-17', '08:00'), ist('2026-10-17', '21:00')].map(iso)
    );
  });

  test('DST zone (New York, clocks go back on 1 Nov 2026) keeps 08:00 local', () => {
    const now = Date.parse('2026-10-30T12:00:00.000Z'); // 08:00 EDT
    const p = planAlarms({ now, tz: NY, horizonDays: 5, meds: [med({ id: 'm1' })] });
    assert.deepEqual(doseAts(p), ['2026-10-31T12:00:00.000Z', '2026-11-01T13:00:00.000Z', '2026-11-02T13:00:00.000Z', '2026-11-03T13:00:00.000Z']);
    for (const item of p.items) assert.equal(utcToZoned(new Date(item.at), NY).time, '08:00');
  });

  test('DST spring forward: occurrences stay one per day', () => {
    const occ = occurrencesBetween({ times: ['02:30', '09:00'], start_date: '2027-03-13' }, new Date('2027-03-13T00:00:00Z'), new Date('2027-03-16T00:00:00Z'), NY);
    assert.equal(occ.length, 6);
    assert.equal(new Set(occ.map((o) => o.iso)).size, 6);
    assert.equal(utcToZoned(new Date(zonedToUtc('2027-03-15', '09:00', NY)), NY).time, '09:00');
  });

  test('timezone boundary at midnight: local dates and weekdays, strictly after now', () => {
    const now = Date.parse('2026-10-15T18:29:00.000Z'); // Thu 23:59 IST
    const p = planAlarms({
      now,
      tz: IST,
      horizonDays: 1,
      meds: [
        med({ id: 'late', schedule: { times: ['23:59'], days: [], start_date: '2026-01-01' } }),
        med({ id: 'midnight', schedule: { times: ['00:00'], days: [], start_date: '2026-01-01' } }),
        med({ id: 'fri', schedule: { times: ['00:30'], days: [5], start_date: '2026-01-01' } }), // Friday in IST, Thursday in UTC
      ],
    });
    const items = p.items.filter((i) => i.kind === 'dose');
    assert.equal(iso(items[0].at), '2026-10-15T18:30:00.000Z'); // 00:00 IST Fri — the 23:59 dose right now is not re-planned
    assert.equal(items[0].doses?.[0].medId, 'midnight');
    assert.equal(iso(items[1].at), '2026-10-15T19:00:00.000Z');
    assert.equal(items[1].doses?.[0].medId, 'fri');
    assert.ok(!items.some((i) => i.at === now));
  });
});

describe('doses', () => {
  test('medicines due at the same minute share one alarm; photos interleaved', () => {
    const p = plan({
      horizonDays: 1,
      meds: [
        med({ id: 'b', name: 'Telma', photo_ids: ['t1', 't2', 't3'], photo_urls: ['/api/media/t1', '/api/media/t2', '/api/media/t3'] }),
        med({ id: 'a', name: 'Atorva', photo_ids: ['a1', 'a2'], photo_urls: ['/api/media/a1', '/api/media/a2'] }),
      ],
    });
    assert.equal(p.items.length, 1);
    const item = p.items[0];
    assert.equal(item.key, `dose:${iso(ist('2026-10-15', '08:00'))}`);
    assert.equal(item.title, '💊 Time for 2 medicines');
    assert.equal(item.body, 'Atorva, Telma');
    assert.equal(item.path, `/alarm?at=${encodeURIComponent(iso(ist('2026-10-15', '08:00')))}`);
    assert.deepEqual(
      item.doses?.map((d) => d.medId),
      ['a', 'b']
    );
    assert.deepEqual(
      item.photoRefs.map((r) => r.id),
      ['a1', 't1', 'a2', 't2']
    );
    assert.deepEqual(item.doses?.[1].photoUrls, ['/api/media/t1', '/api/media/t2']);
  });

  test('SOS and paused medicines never ring', () => {
    const p = plan({ meds: [med({ id: 'sos', as_needed: true }), med({ id: 'paused', active: false })] });
    assert.equal(p.items.length, 0);
  });

  test('created_at grace: a dose from before the medicine was added (− 30 min) is not its alarm', () => {
    const now = ist('2026-10-15', '09:30');
    const at8 = iso(ist('2026-10-15', '08:00'));
    const taken = [{ medication_id: 'm1', scheduled_for: at8, status: 'taken', acted_at: iso(now) }];
    const within = planAlarms({ now, tz: IST, horizonDays: 1, meds: [med({ id: 'm1', created_at: iso(ist('2026-10-15', '08:20')) })], doseStates: taken });
    assert.deepEqual(within.settledKeys, [`dose:${at8}`, `snooze:m1:${at8}`]);
    const after = planAlarms({ now, tz: IST, horizonDays: 1, meds: [med({ id: 'm1', created_at: iso(ist('2026-10-15', '09:00')) })], doseStates: taken });
    assert.deepEqual(after.settledKeys, []);
    assert.deepEqual(doseAts(after), [iso(ist('2026-10-16', '08:00'))]);
  });

  test('taken / skipped / any acted dose is not planned', () => {
    const at8 = iso(ist('2026-10-15', '08:00'));
    const at20 = iso(ist('2026-10-15', '20:00'));
    const p = plan({
      horizonDays: 1,
      meds: [med({ id: 'm1', schedule: { times: ['08:00', '20:00'], days: [], start_date: '2026-01-01' } }), med({ id: 'm2' })],
      doseStates: [
        { medication_id: 'm1', scheduled_for: at8, status: 'taken', acted_at: iso(NOW) },
        { medication_id: 'm1', scheduled_for: at20, status: 'skipped', acted_at: iso(NOW) },
        { medication_id: 'm2', scheduled_for: at8, status: 'upcoming' },
      ],
    });
    assert.equal(p.items.length, 1);
    assert.deepEqual(
      p.items[0].doses?.map((d) => d.medId),
      ['m2']
    );
  });

  test('a snoozed dose re-rings at snooze_until (and not at its own time)', () => {
    const now = ist('2026-10-15', '08:05');
    const at8 = iso(ist('2026-10-15', '08:00'));
    const until = iso(now + 10 * MIN);
    const p = planAlarms({
      now,
      tz: IST,
      horizonDays: 1,
      meds: [med({ id: 'm1', name: 'Telma' })],
      doseStates: [{ medication_id: 'm1', scheduled_for: at8, status: 'snoozed', acted_at: iso(now), snooze_until: until }],
    });
    const snooze = p.items[0];
    assert.equal(snooze.key, `snooze:m1:${at8}`);
    assert.equal(snooze.key, snoozeAlarmKey(at8, ['m1']));
    assert.equal(snooze.at, Date.parse(until));
    assert.equal(snooze.ring, true);
    assert.equal(snooze.deepLink, `orza://alarm?at=${encodeURIComponent(at8)}&med=m1`);
    assert.equal(snooze.doses?.[0].snoozed, true);
    assert.match(snooze.body, /snoozed from 8:00 am$/);
    assert.equal(iso(p.items[1].at), iso(ist('2026-10-16', '08:00')));
  });

  test('a snooze that already ended is not re-planned; a deleted medicine snooze is dropped', () => {
    const now = ist('2026-10-15', '08:30');
    const at8 = iso(ist('2026-10-15', '08:00'));
    const p = planAlarms({
      now,
      tz: IST,
      horizonDays: 1,
      meds: [med({ id: 'm1' })],
      doseStates: [
        { medication_id: 'm1', scheduled_for: at8, status: 'due', acted_at: iso(now - 20 * MIN), snooze_until: iso(now - 10 * MIN) },
        { medication_id: 'gone', scheduled_for: at8, status: 'snoozed', acted_at: iso(now), snooze_until: iso(now + 5 * MIN) },
      ],
    });
    assert.ok(!p.items.some((i) => i.key.startsWith('snooze:')));
  });

  test('pending actions overlay the logs: a native snooze keeps its alarm, a take removes the dose', () => {
    const now = ist('2026-10-15', '08:01');
    const at8 = iso(ist('2026-10-15', '08:00'));
    const at20 = iso(ist('2026-10-15', '20:00'));
    const p = planAlarms({
      now,
      tz: IST,
      horizonDays: 1,
      meds: [med({ id: 'a', schedule: { times: ['08:00', '20:00'], days: [], start_date: '2026-01-01' } }), med({ id: 'b' })],
      pending: [
        { medId: 'a', scheduledFor: at8, action: 'snooze', createdAt: now },
        { medId: 'b', scheduledFor: at8, action: 'snooze', createdAt: now + 20_000 },
        { medId: 'a', scheduledFor: at20, action: 'take', createdAt: now },
      ],
    });
    // Both doses of the 08:00 alarm were snoozed into the same minute → one re-ring for the group.
    const snoozes = p.items.filter((i) => i.key.startsWith('snooze:'));
    assert.equal(snoozes.length, 1);
    assert.equal(snoozes[0].key, `snooze:${at8}`);
    assert.equal(snoozes[0].at, now + 20_000 + 10 * MIN);
    assert.equal(snoozes[0].deepLink, `orza://alarm?at=${encodeURIComponent(at8)}`);
    assert.ok(!p.items.some((i) => i.key === `dose:${at20}`));
  });

  test('snoozes of one alarm sent one after another group even across a minute; far apart they ring apart', () => {
    const now = ist('2026-10-15', '08:01');
    const at8 = iso(ist('2026-10-15', '08:00'));
    const meds = [med({ id: 'a' }), med({ id: 'b' })];
    // Server ends 08:11:59.8 and 08:12:00.1 (sequential POSTs of a "Snooze all"): ONE re-ring, at the later end.
    const close = planAlarms({
      now,
      tz: IST,
      horizonDays: 1,
      meds,
      doseStates: [
        { medication_id: 'a', scheduled_for: at8, status: 'snoozed', acted_at: iso(now), snooze_until: iso(ist('2026-10-15', '08:12') - 200) },
        { medication_id: 'b', scheduled_for: at8, status: 'snoozed', acted_at: iso(now), snooze_until: iso(ist('2026-10-15', '08:12') + 100) },
      ],
    });
    const s1 = close.items.filter((i) => i.key.startsWith('snooze:'));
    assert.deepEqual(
      s1.map((i) => i.key),
      [`snooze:${at8}`]
    );
    assert.equal(s1[0].at, ist('2026-10-15', '08:12') + 100);
    assert.equal(s1[0].doses?.length, 2);
    // Snoozed 3 minutes apart: two re-rings, one per medicine.
    const apart = planAlarms({
      now,
      tz: IST,
      horizonDays: 1,
      meds,
      doseStates: [
        { medication_id: 'a', scheduled_for: at8, status: 'snoozed', acted_at: iso(now), snooze_until: iso(ist('2026-10-15', '08:11')) },
        { medication_id: 'b', scheduled_for: at8, status: 'snoozed', acted_at: iso(now), snooze_until: iso(ist('2026-10-15', '08:14')) },
      ],
    });
    assert.deepEqual(
      apart.items.filter((i) => i.key.startsWith('snooze:')).map((i) => i.key),
      [`snooze:a:${at8}`, `snooze:b:${at8}`]
    );
  });

  test('a pending snooze / skip never undoes a taken dose; an older press loses to a newer server log', () => {
    const now = ist('2026-10-15', '08:21');
    const at8 = iso(ist('2026-10-15', '08:00'));
    const taken = { medication_id: 'a', scheduled_for: at8, status: 'taken', acted_at: iso(ist('2026-10-15', '08:05')) };
    // "Snooze all" pressed at 08:20 on an alarm whose medicine a was taken at 08:05: a stays taken, nothing re-rings.
    const p1 = planAlarms({
      now,
      tz: IST,
      horizonDays: 1,
      meds: [med({ id: 'a' })],
      doseStates: [taken],
      pending: [{ medId: 'a', scheduledFor: at8, action: 'snooze', createdAt: ist('2026-10-15', '08:20') }],
    });
    assert.ok(!p1.items.some((i) => i.key.startsWith('snooze:')));
    assert.ok(p1.settledKeys.includes(`dose:${at8}`));
    // A take queued at 08:10 vs. a snooze ÖRZA recorded at 08:20 (done later elsewhere): the snooze stands.
    const p2 = planAlarms({
      now,
      tz: IST,
      horizonDays: 1,
      meds: [med({ id: 'a' })],
      doseStates: [{ medication_id: 'a', scheduled_for: at8, status: 'snoozed', acted_at: iso(ist('2026-10-15', '08:20')), snooze_until: iso(ist('2026-10-15', '08:30')) }],
      pending: [{ medId: 'a', scheduledFor: at8, action: 'take', createdAt: ist('2026-10-15', '08:10') }],
    });
    assert.equal(p2.items.find((i) => i.key.startsWith('snooze:'))?.at, ist('2026-10-15', '08:30'));
    // Within the clock skew the phone's press wins.
    assert.equal(pendingWins({ action: 'take', createdAt: 1_000_000 }, { finished: false, actedAt: 1_000_000 + 30_000 }), true);
    assert.equal(pendingWins({ action: 'take', createdAt: 1_000_000 }, { finished: false, actedAt: 1_000_000 + 120_000 }), false);
    assert.equal(pendingWins({ action: 'skip', createdAt: 2_000_000 }, { finished: true, actedAt: 1_000_000 }), false);
    assert.equal(pendingWins({ action: 'take', createdAt: 2_000_000 }, { finished: true, actedAt: 1_000_000 }), true);
  });

  test('partly handled group alarms are rebuilt with only the open doses', () => {
    const now = ist('2026-10-15', '09:00');
    const at8 = iso(ist('2026-10-15', '08:00'));
    const meds = [med({ id: 'a', name: 'Alpha' }), med({ id: 'b', name: 'Beta' })];
    const p = planAlarms({
      now,
      tz: IST,
      horizonDays: 1,
      meds,
      doseStates: [{ medication_id: 'a', scheduled_for: at8, status: 'taken', acted_at: iso(now) }],
    });
    assert.deepEqual(
      p.partialAlarms.map((i) => [i.key, i.doses?.map((d) => d.medId)]),
      [[`dose:${at8}`, ['b']]]
    );
    assert.equal(p.partialAlarms[0].title, '💊 Time for Beta');
    assert.equal(p.partialAlarms[0].deepLink, `orza://alarm?at=${encodeURIComponent(at8)}&med=b`);
    // b snoozed (a "Snooze all" re-ring may be showing with a in it too).
    const q = planAlarms({
      now,
      tz: IST,
      horizonDays: 1,
      meds,
      doseStates: [
        { medication_id: 'a', scheduled_for: at8, status: 'taken', acted_at: iso(now) },
        { medication_id: 'b', scheduled_for: at8, status: 'snoozed', acted_at: iso(now), snooze_until: iso(now + 5 * MIN) },
      ],
    });
    assert.deepEqual(
      q.partialAlarms.map((i) => [i.key, i.doses?.map((d) => d.medId)]),
      [
        [`dose:${at8}`, ['b']],
        [`snooze:${at8}`, ['b']],
      ]
    );
    // Nothing handled, or everything: nothing to rebuild.
    assert.deepEqual(planAlarms({ now, tz: IST, horizonDays: 1, meds }).partialAlarms, []);
  });

  test('an in-app snooze re-ring is the very item the planner will plan', () => {
    const now = ist('2026-10-15', '08:02');
    const at8 = iso(ist('2026-10-15', '08:00'));
    const until = now + 10 * MIN;
    const meds = [med({ id: 'a', name: 'Telma', strength: '40 mg', photo_ids: ['p1'], photo_urls: ['/api/media/p1'] }), med({ id: 'b' })];
    const quick = snoozeAlarmItem({ meds, scheduledFor: at8, medIds: ['a'], at: until, tz: IST });
    const planned = planAlarms({
      now,
      tz: IST,
      horizonDays: 1,
      meds,
      doseStates: [{ medication_id: 'a', scheduled_for: at8, status: 'snoozed', acted_at: iso(now), snooze_until: iso(until) }],
    }).items.find((i) => i.key.startsWith('snooze:'));
    assert.ok(quick && planned);
    assert.equal(quick.key, planned.key);
    assert.equal(planHash([quick]), planHash([planned]));
    assert.equal(quick.photoRefs[0]?.id, 'p1');
    assert.equal(snoozeAlarmItem({ meds, scheduledFor: at8, medIds: ['gone'], at: until, tz: IST }), null);
  });

  test('an in-app snooze survives a plan made before the press, until the plan carries it or the dose is taken', () => {
    const now = ist('2026-10-15', '08:02');
    const at8 = iso(ist('2026-10-15', '08:00'));
    const until = now + 10 * MIN;
    const meds = [med({ id: 'a' }), med({ id: 'b' })];
    const quick = snoozeAlarmItem({ meds, scheduledFor: at8, medIds: ['a'], at: until, tz: IST });
    assert.ok(quick);
    const none = new Map();

    // Planned before the press: no snooze in it → the re-ring is added back, in time order.
    const before = planAlarms({ now, tz: IST, horizonDays: 1, meds }).items;
    const merged = withInAppSnoozes(before, [quick], none, now, 200);
    assert.equal(merged.length, before.length + 1);
    assert.equal(merged[0].key, quick.key);

    // The plan has it (the press reached ÖRZA), or a group re-ring covering its dose → nothing added.
    const snoozedLogs = [{ medication_id: 'a', scheduled_for: at8, status: 'snoozed', acted_at: iso(now), snooze_until: iso(until) }];
    const after = planAlarms({ now, tz: IST, horizonDays: 1, meds, doseStates: snoozedLogs }).items;
    assert.equal(withInAppSnoozes(after, [quick], none, now, 200), after);
    const group = snoozeAlarmItem({ meds, scheduledFor: at8, medIds: ['a', 'b'], at: until, tz: IST });
    assert.ok(group);
    assert.equal(withInAppSnoozes([group], [quick], none, now, 200).length, 1);

    // Taken since, or its time has passed → nothing added.
    const taken = latestDoseStates([{ medication_id: 'a', scheduled_for: at8, status: 'taken', acted_at: iso(now + MIN) }], []);
    assert.equal(withInAppSnoozes(before, [quick], taken, now, 200), before);
    assert.equal(withInAppSnoozes(before, [quick], none, until, 200), before);

    // The cap still holds: the latest item gives way.
    assert.equal(withInAppSnoozes(before, [quick], none, now, before.length).length, before.length);
  });

  test('settled keys: handled alarms of the last 12 h', () => {
    const now = ist('2026-10-15', '09:00');
    const at8 = iso(ist('2026-10-15', '08:00'));
    const p = planAlarms({
      now,
      tz: IST,
      horizonDays: 1,
      meds: [med({ id: 'a' }), med({ id: 'b' })],
      doseStates: [
        { medication_id: 'a', scheduled_for: at8, status: 'taken', acted_at: iso(now) },
        { medication_id: 'b', scheduled_for: at8, status: 'snoozed', acted_at: iso(now), snooze_until: iso(now + 5 * MIN) },
      ],
    });
    assert.deepEqual(p.settledKeys, [`dose:${at8}`, `snooze:a:${at8}`]);
  });
});

describe('quiet hours', () => {
  test('window helper, including overnight windows', () => {
    assert.equal(inQuietWindow({ start: '22:00', end: '07:00' }, '23:30'), true);
    assert.equal(inQuietWindow({ start: '22:00', end: '07:00' }, '06:59'), true);
    assert.equal(inQuietWindow({ start: '22:00', end: '07:00' }, '07:00'), false);
    assert.equal(inQuietWindow({ start: '13:00', end: '15:00' }, '14:00'), true);
    assert.equal(inQuietWindow({ start: '13:00', end: '13:00' }, '13:00'), false);
    assert.equal(inQuietWindow(null, '13:00'), false);
  });

  test('overnight window suppresses doses and reports them', () => {
    const p = plan({
      horizonDays: 1,
      quietHours: { start: '22:00', end: '07:00' },
      meds: [med({ id: 'm1', name: 'Telma', schedule: { times: ['23:00', '08:00'], days: [], start_date: '2026-01-01' } })],
    });
    assert.deepEqual(doseAts(p), [iso(ist('2026-10-15', '08:00'))]);
    assert.equal(p.quietDoses.length, 1);
    assert.equal(p.quietDoses[0].localTime, '23:00');
    assert.equal(p.quietDoses[0].label, 'Telma');
  });

  test('same-day window suppresses doses, reminders and snoozes', () => {
    const now = ist('2026-10-15', '12:55');
    const at1250 = iso(ist('2026-10-15', '12:50'));
    const p = planAlarms({
      now,
      tz: IST,
      horizonDays: 1,
      quietHours: { start: '13:00', end: '15:00' },
      meds: [med({ id: 'm1', schedule: { times: ['14:00', '12:50'], days: [], start_date: '2026-01-01' } })],
      doseStates: [{ medication_id: 'm1', scheduled_for: at1250, status: 'snoozed', acted_at: iso(now), snooze_until: iso(now + 10 * MIN) }],
      reminders: [reminder({ id: 'r1', schedule: { times: ['14:30', '16:00'], days: [], start_date: '2026-01-01' } })],
    });
    assert.equal(p.quietDoses.length, 2);
    assert.equal(p.quietDoses.find((q) => q.snoozed)?.localTime, '13:05');
    assert.equal(p.quietReminders, 1);
    assert.ok(!p.items.some((i) => i.at === ist('2026-10-15', '14:00')));
    assert.ok(p.items.some((i) => i.key === `reminder:r1:${iso(ist('2026-10-15', '16:00'))}`));
  });
});

describe('refill alerts', () => {
  const low = (over: Partial<PlanMedication> = {}) =>
    med({ id: 'r', name: 'Telma', strength: '40', as_needed: true, stock: { count: 3, unit: 'tablets', refill_alert_at: 5 }, ...over });

  test('daytime alert today and tomorrow at 08:00', () => {
    const p = plan({ meds: [low()] });
    const refills = p.items.filter((i) => i.kind === 'refill');
    assert.deepEqual(
      refills.map((i) => i.key),
      ['refill:r:2026-10-15', 'refill:r:2026-10-16']
    );
    assert.equal(refills[0].at, ist('2026-10-15', '08:00'));
    assert.equal(refills[0].title, '💊 Refill Telma 40 soon');
    assert.equal(refills[0].body, 'Only 3 tablets left. Reorder before you run out.');
    assert.equal(refills[0].ring, false);
    assert.equal(refills[0].deepLink, 'orza://med/r');
  });

  test('once per local day: a delivered alert is not repeated; late in the day it goes out a minute later', () => {
    const now = ist('2026-10-15', '10:00');
    const delivered = planAlarms({ now, tz: IST, meds: [low()], refillDelivered: ['refill:r:2026-10-15'] });
    assert.deepEqual(
      delivered.items.map((i) => i.key),
      ['refill:r:2026-10-16']
    );
    const fresh = planAlarms({ now, tz: IST, meds: [low({ stock: { count: 0, unit: 'tablets', refill_alert_at: 5 }, for_person: 'Dad' })] });
    assert.equal(fresh.items[0].at, now + REFILL_SOON_MS);
    assert.equal(fresh.items[0].title, '💊 Telma 40 has run out');
    assert.equal(fresh.items[0].body, 'Your stock (for Dad) is at zero. Reorder today so no dose is missed.');
  });

  test('no alert after 21:00; quiet hours defer it to their end', () => {
    const late = planAlarms({ now: ist('2026-10-15', '21:30'), tz: IST, meds: [low()] });
    assert.deepEqual(
      late.items.map((i) => i.key),
      ['refill:r:2026-10-16']
    );
    const sameDay = plan({ meds: [low()], quietHours: { start: '07:00', end: '09:30' } });
    assert.equal(sameDay.items[0].at, ist('2026-10-15', '09:30'));
    const overnight = plan({ meds: [low()], quietHours: { start: '22:00', end: '08:30' } });
    assert.equal(overnight.items[0].at, ist('2026-10-15', '08:30'));
    const allEvening = planAlarms({ now: ist('2026-10-15', '20:30'), tz: IST, meds: [low()], quietHours: { start: '20:00', end: '07:00' } });
    assert.deepEqual(
      allEvening.items.map((i) => i.key),
      ['refill:r:2026-10-16']
    );
    const tooLate = plan({ meds: [low()], quietHours: { start: '06:00', end: '21:30' } });
    assert.equal(tooLate.items.length, 0);
  });

  test('no alert when stock is above the threshold, has no threshold or the medicine is paused', () => {
    assert.equal(plan({ meds: [low({ stock: { count: 6, unit: 'tablets', refill_alert_at: 5 } })] }).items.length, 0);
    assert.equal(plan({ meds: [low({ stock: { count: 1, unit: 'tablets' } })] }).items.length, 0);
    assert.equal(plan({ meds: [low({ active: false })] }).items.length, 0);
  });
});

describe('reminders', () => {
  test('rings active push reminders with the kind emoji and default body', () => {
    const p = plan({ horizonDays: 1, reminders: [reminder({ id: 'r1', kind: 'meal', title: 'Log lunch', schedule: { times: ['13:00'], days: [], start_date: '2026-01-01' } })] });
    assert.equal(p.items.length, 1);
    assert.equal(p.items[0].title, '🍽️ Log lunch');
    assert.equal(p.items[0].body, 'Snap it, say it or type it — logging takes a few seconds.');
    assert.equal(p.items[0].deepLink, 'orza://meals');
    assert.equal(p.items[0].ring, false);
  });

  test('"Gentle reminders" off, paused, or no push channel → nothing', () => {
    const r = reminder({ id: 'r1' });
    assert.equal(plan({ reminders: [r], remindersEnabled: false }).items.length, 0);
    assert.equal(plan({ reminders: [{ ...r, active: false }] }).items.length, 0);
    assert.equal(plan({ reminders: [{ ...r, channels: { push: false, whatsapp: true, calendar: false } }] }).items.length, 0);
  });
});

describe('cap and horizon', () => {
  const fourTimes = med({ id: 'm1', schedule: { times: ['08:00', '12:00', '16:00', '20:00'], days: [], start_date: '2026-01-01' } });

  test('horizon limits the days planned', () => {
    assert.equal(plan({ meds: [fourTimes], horizonDays: 2 }).items.length, 8);
    assert.equal(plan({ meds: [fourTimes] }).items.length, 28);
    assert.equal(plan({ meds: [fourTimes], horizonDays: 30 }).items.length, 28); // max 7 days
  });

  test('cap: medicine alarms may use all of it; when they are cut the last one says to open ÖRZA', () => {
    const p = plan({ meds: [fourTimes], reminders: [reminder({ id: 'w' })], maxItems: 12 });
    assert.equal(p.items.length, 12);
    const doses = p.items.filter((i) => i.kind === 'dose');
    assert.equal(doses.length, 12);
    assert.equal(p.items.filter((i) => i.kind === 'reminder').length, 0);
    assert.equal(p.dropped, 28 + 7 - 12);
    assert.ok(doses[11].body.endsWith(`· ${CONTINUE_NOTE}`));
    assert.ok(doses.slice(0, 11).every((d) => !d.body.includes(CONTINUE_NOTE)));
    // The first reminder (today 11:00) is already left out.
    assert.equal(p.coveredUntil, ist('2026-10-15', '11:00'));
    assert.deepEqual(
      p.items.map((i) => i.at),
      [...p.items.map((i) => i.at)].sort((a, b) => a - b)
    );
  });

  test('cap: reminders get the room the doses leave', () => {
    const p = plan({ meds: [fourTimes], reminders: [reminder({ id: 'w' })], maxItems: 32 });
    assert.equal(p.items.filter((i) => i.kind === 'dose').length, 28);
    assert.equal(p.items.filter((i) => i.kind === 'reminder').length, 4);
    assert.ok(p.items.every((i) => !i.body.includes(CONTINUE_NOTE)));
    // The 5th reminder (day 5, 11:00) is the first one left out.
    assert.equal(p.coveredUntil, ist('2026-10-19', '11:00'));
  });

  test('without competition the cap goes to whichever kind exists', () => {
    assert.equal(plan({ reminders: [reminder({ id: 'w' })], maxItems: 4 }).items.length, 4);
    assert.equal(plan({ meds: [fourTimes], maxItems: 5 }).items.length, 5);
  });
});

describe('hash', () => {
  test('stable for the same plan, changes when a photo arrives', () => {
    const input: Partial<PlanInput> = { meds: [med({ id: 'm1', photo_ids: ['p1'], photo_urls: ['/api/media/p1'] })], horizonDays: 2 };
    const a = plan(input);
    const b = plan(input);
    assert.equal(planHash(a.items), planHash(b.items));
    b.items[0].photos = ['file:///p1.jpg'];
    assert.notEqual(planHash(a.items), planHash(b.items));
  });
});
