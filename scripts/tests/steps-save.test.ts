/// <reference types="node" />
/**
 * Saving one day's steps (`save.ts`, `docs/notes/steps-v2.md` §2.5) against a fake server — `npm run test:steps` runs
 * this file next to the other steps tests. Pure: `save.ts` takes its store and API as `SaveDeps`.
 *
 * The fake server is one member's `tracking` rows behind `POST /api/track/steps`: with the v2 modes (backend B1:
 * `manual` sets the edit marker, `auto` is an atomic raise refused while the marker isn't the phone's `edit_ref`,
 * `reconcile` a compare-and-set; answers `{tracking, applied, reason}`, and the day read carries the marker, B2), or
 * the old production server (a plain set, answering `{tracking}` only). Each phone of the member keeps its own day
 * records (and its own server observations: its own id).
 *
 * T34–T39: an edit is sticky (C1), automatic saves never lower (C5), the `edited` / `not_higher` answers, reconcile,
 * and the old server's branch (no reconcile; the read before each save still guards it). The old server's earlier
 * tests (raise only, an edit seen as a lower read) follow.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { TrackingDay } from '../../src/features/today/types';
import { addDays, zonedToUtc } from '../../src/lib/alarms/schedule';
import { dayStartMs } from '../../src/lib/steps/counter';
import { dayValue } from '../../src/lib/steps/merge';
import { countsIphoneHealthData, type DayRecord } from '../../src/lib/steps/policy';
import { applyManualSteps, saveDay, saveManualDay, syncDay, type SaveDeps, type StepsAnswer, type StepsMode } from '../../src/lib/steps/save';
import { forgetServerObservations, markerOf, markerRowOf, observeServerRow, observeServerSteps } from '../../src/lib/steps/serverSeen';
import { dayBounds } from '../../src/lib/steps/shared';
import type { DayReading, SourceReading } from '../../src/lib/steps/types';

const IST = 'Asia/Kolkata';
const H = 3_600_000;
const MIN = 60_000;
const ist = (date: string, time: string) => zonedToUtc(date, time, IST).getTime();

const D = '2026-10-20';
const S = dayStartMs(D, IST);
const NEXT = addDays(D, 1);
const PREV = addDays(D, -1);

/** Day `date` (IST) read with `sources`. */
const dayOf = (sources: SourceReading[], date = D): DayReading => ({ date, ...dayBounds(date, IST), sources });

const hc = (steps: number, coverFrom = S, extra: Partial<SourceReading> = {}): SourceReading => ({ source: 'health_connect', steps, coverFrom, ...extra });
const recording = (steps: number, coverFrom = S, extra: Partial<SourceReading> = {}): SourceReading => ({
  source: 'phone',
  counter: 'recording',
  steps,
  coverFrom,
  ...extra,
});
const health = (steps: number, coverFrom = S, extra: Partial<SourceReading> = {}): SourceReading => ({ source: 'apple_health', steps, coverFrom, ...extra });
const pedometer = (steps: number, coverFrom = S, extra: Partial<SourceReading> = {}): SourceReading => ({
  source: 'phone',
  counter: 'pedometer',
  steps,
  coverFrom,
  ...extra,
});
/** A source's count after a base's `at` (what the reader measures for `ReadOptions.sinceAt`). */
const after = (at: number, steps: number) => ({ since: { at, steps } });

/** Day D read with this phone's sampler (`partialFrom`: it covers the day from then; `since`: its count after a base). */
const phoneDay = (
  steps: number,
  extra: { partialFrom?: number; estimated?: number; complete?: boolean; since?: { at: number; steps: number } } = {}
): DayReading => {
  const { partialFrom, ...rest } = extra;
  return dayOf([{ source: 'phone', counter: 'sampler', steps, coverFrom: partialFrom ?? S, ...rest }]);
};

/* ───────────────────────────── The fake server ───────────────────────────── */

interface Post {
  phone: string;
  date: string;
  steps: number;
  mode: StepsMode;
  editRef: string | null;
  expect?: number;
}

let fakeIds = 0;

/**
 * One member's step days on a fake server (`modes`: the v2 modes, else the old server) + a clock shared by the server
 * and the member's phones. `website(date, steps)` is a manual save made elsewhere; `set(date, steps)` a raw write by
 * another writer (on the old server, the website too: it has no marker). With the modes a row carries its marker and
 * `updated_at` (every write sets it), and — `editValue` — the edit's own number (`steps_edited_value`, B2).
 */
function fakeServer(modes: boolean, start: number, initial: Record<string, number> = {}, opts: { editValue?: boolean } = {}) {
  let clock = start;
  let hasModes = modes;
  let failure: unknown = null;
  type Row = { steps: number; marker: string | null; edited?: number; updated?: number };
  const rows = new Map<string, Row>(Object.entries(initial).map(([d, steps]) => [d, { steps, marker: null }]));
  const posts: Post[] = [];
  const reads: string[] = [];

  const row = (date: string): Row => rows.get(date) ?? { steps: 0, marker: null };
  const write = (date: string, patch: Partial<Row>) => rows.set(date, { ...row(date), ...patch, updated: clock });
  const tracking = (date: string): TrackingDay => {
    const r = row(date);
    if (!hasModes) return { date, steps: r.steps, water_glasses: 0 };
    return {
      date,
      steps: r.steps,
      water_glasses: 0,
      steps_edited_at: r.marker,
      ...(opts.editValue && r.marker ? { steps_edited_value: r.edited ?? null } : {}),
      ...(r.updated != null ? { updated_at: new Date(r.updated).toISOString() } : {}),
    };
  };

  function answer(date: string, steps: number, mode: StepsMode, editRef: string | null, expect?: number): StepsAnswer {
    const r = row(date);
    if (!hasModes) {
      write(date, { steps }); // the old server: whatever the body says, it sets the count
      return { tracking: tracking(date) };
    }
    if (mode === 'manual') {
      write(date, { steps, marker: new Date(clock).toISOString(), edited: steps });
      return { tracking: tracking(date), applied: true };
    }
    if (r.marker !== editRef) return { tracking: tracking(date), applied: false, reason: 'edited' };
    if (mode === 'auto' && !(r.steps < steps)) return { tracking: tracking(date), applied: false, reason: 'not_higher' };
    if (mode === 'reconcile' && r.steps !== expect) return { tracking: tracking(date), applied: false, reason: 'changed' };
    write(date, { steps });
    return { tracking: tracking(date), applied: true };
  }

  /**
   * One phone of the member: its own day records (`signOut` deletes them, as a sign-out or a purged cache does) and its
   * prefs' last automatic save (kept); its server observations are kept under its own id.
   */
  function phone(name = 'A') {
    const userId = `member-${++fakeIds}-${name}`;
    const records = new Map<string, DayRecord>();
    let lastSave: number | null = null;
    const deps: SaveDeps = {
      getRecord: (u, d) => records.get(`${u}|${d}`),
      updateRecord: (u, d, patch) => {
        records.set(`${u}|${d}`, { ...records.get(`${u}|${d}`), ...patch });
      },
      lastAutoSave: () => lastSave,
      noteAutoSave: (_u, at) => {
        lastSave = Math.max(lastSave ?? at, at);
      },
      async fetchServerDay(date) {
        clock += 200;
        if (failure) throw failure;
        reads.push(`${name} ${date}`);
        const t = tracking(date);
        return hasModes ? { steps: t.steps, marker: markerOf(t), ...markerRowOf(t) } : { steps: t.steps };
      },
      async postSteps(date, steps, mode, editRef, expect) {
        clock += 300;
        if (failure) throw failure;
        posts.push({ phone: name, date, steps, mode, editRef, ...(expect != null ? { expect } : {}) });
        return answer(date, steps, mode, editRef, expect);
      },
      isPermanent: (e) => e === 'permanent',
      now: () => clock,
    };
    return {
      name,
      userId,
      deps,
      record: (date: string) => records.get(`${userId}|${date}`),
      /** The day records are gone (sign-out, P16; a purged cache); the prefs stay. */
      signOut: () => records.clear(),
      /** Today's dashboard read of `date` on this phone (it carries the row's marker, B2). */
      todayRead: (date = D) => observeServerRow(userId, date, tracking(date), clock),
    };
  }

  return {
    phone,
    posts,
    reads,
    /** What each phone posted, in one line each: `<phone> <mode> <steps>[ expect <n>] ref <edit_ref>`. */
    sent: () => posts.map((p) => `${p.phone} ${p.mode} ${p.steps}${p.expect != null ? ` expect ${p.expect}` : ''} ref ${p.editRef}`),
    steps: (date = D) => row(date).steps,
    marker: (date = D) => row(date).marker,
    /** A manual save made elsewhere (the website): the modes' marker with it. */
    website: (date: string, steps: number) => answer(date, steps, 'manual', null),
    /** A raw write by another writer (the old server's website, a reconcile on another phone). */
    set: (date: string, steps: number) => write(date, { steps }),
    /** Another field of the day's row written (a glass of water): `updated_at` moves, the steps don't. */
    touch: (date = D) => write(date, {}),
    /** B1 deployed. */
    upgrade: () => {
      hasModes = true;
    },
    advance: (ms: number) => {
      clock += ms;
    },
    now: () => clock,
    fail: (e: unknown) => {
      failure = e;
    },
  };
}

/* ───────────────────────────── T34–T39: the v2 modes ───────────────────────────── */

describe('an edit is sticky (T34, C1)', () => {
  test('a website edit stays: raises that don’t know its marker are refused, and counting adds on top', async () => {
    forgetServerObservations();
    const srv = fakeServer(true, ist(D, '11:58'));
    const a = srv.phone('A');
    const b = srv.phone('B');
    await saveDay(b.deps, b.userId, phoneDay(11_000), true);
    srv.advance(2 * MIN);
    await saveDay(a.deps, a.userId, phoneDay(12_000), true);
    assert.equal(srv.steps(), 12_000);

    srv.advance(MIN);
    srv.website(D, 9_000); // the member corrects a bus ride on the website
    const marker = srv.marker() ?? assert.fail('a manual save sets the marker');

    srv.advance(4 * MIN);
    await saveDay(a.deps, a.userId, phoneDay(12_100), true); // A hasn't seen the edit: its raise is refused
    await saveDay(b.deps, b.userId, phoneDay(12_500), true); // and so is the other phone's
    assert.equal(srv.steps(), 9_000, 'the edit is not undone');
    assert.deepEqual(srv.sent().slice(-2), ['A auto 12100 ref null', 'B auto 12500 ref null']);
    for (const p of [a, b]) {
      assert.deepEqual(p.record(D)?.base, { kind: 'edit', steps: 9_000, at: Date.parse(marker), editRef: marker }, `${p.name} takes the edit`);
      assert.equal(p.record(D)?.autoSent, undefined, `${p.name}’s earlier automatic save is no longer its own number on the server`);
    }

    srv.advance(15 * MIN);
    await saveDay(a.deps, a.userId, phoneDay(12_400, { since: { at: Date.parse(marker), steps: 150 } }), true);
    assert.equal(srv.steps(), 9_150, 'the edit + what was counted after it');
    assert.equal(srv.sent().at(-1), `A auto 9150 ref ${marker}`);
  });
});

describe('automatic saves never lower (T35, C5)', () => {
  test('a second phone’s lower count is refused; the first phone never takes it — or any lower read without a marker — as an edit', async () => {
    forgetServerObservations();
    const srv = fakeServer(true, ist(D, '17:00'));
    const a = srv.phone('A');
    const b = srv.phone('B');
    await saveDay(b.deps, b.userId, phoneDay(5_000), true);
    srv.advance(MIN);
    await saveDay(a.deps, a.userId, phoneDay(6_000), true);
    srv.advance(MIN);
    // B still knows 5,000 (the race C5 describes: a read, then another phone's save, then this save).
    await saveDay(b.deps, b.userId, phoneDay(5_500), true);
    assert.equal(srv.steps(), 6_000, 'never lowered');
    assert.equal(srv.sent().at(-1), 'B auto 5500 ref null');
    assert.equal(b.record(D)?.server, 6_000, 'B now knows the higher count');
    assert.equal(b.record(D)?.autoSent, 5_000, 'B’s own last save is unchanged');

    // A lower count appears on the server without a new marker (another phone's reconcile, say): with the modes it is
    // not the member's edit.
    srv.set(D, 5_800);
    observeServerSteps(a.userId, D, 5_800, srv.now(), null);
    srv.advance(5 * MIN);
    await saveDay(a.deps, a.userId, phoneDay(6_100), true);
    assert.equal(a.record(D)?.base, undefined, 'no edit');
    assert.equal(srv.steps(), 6_100);
    assert.equal(a.record(D)?.autoSent, 6_100);
  });
});

describe('the “edited” answer (T36, M5c2)', () => {
  test('the edit is taken at its marker; the next run saves it + what was counted since, with the new edit_ref', async () => {
    forgetServerObservations();
    const srv = fakeServer(true, ist(D, '12:00'));
    const a = srv.phone('A');
    await saveDay(a.deps, a.userId, phoneDay(12_000), true);
    srv.advance(MIN);
    srv.website(D, 9_000);
    const m = srv.marker() ?? assert.fail('marker');
    srv.advance(4 * MIN);

    await saveDay(a.deps, a.userId, phoneDay(12_100), true);
    const rec = a.record(D);
    assert.deepEqual(rec?.base, { kind: 'edit', steps: 9_000, at: Date.parse(m), editRef: m });
    assert.equal(rec?.editRef, m);
    assert.equal(rec?.server, 9_000);

    srv.advance(15 * MIN);
    await saveDay(a.deps, a.userId, phoneDay(12_400, { since: { at: Date.parse(m), steps: 300 } }), true);
    assert.deepEqual(srv.sent(), ['A auto 12000 ref null', 'A auto 12100 ref null', `A auto 9300 ref ${m}`]);
    assert.equal(srv.steps(), 9_300);
    assert.equal(a.record(D)?.autoSent, 9_300);
  });

  test('a marker Today’s read already saw is taken before any save (no refused round trip)', async () => {
    forgetServerObservations();
    const srv = fakeServer(true, ist(D, '12:00'));
    const a = srv.phone('A');
    await saveDay(a.deps, a.userId, phoneDay(6_000), true);
    srv.advance(10 * MIN);
    srv.website(D, 8_000);
    const m = srv.marker() ?? assert.fail('marker');
    observeServerSteps(a.userId, D, 8_000, srv.now(), m); // Today's dashboard read (B2: it carries the marker)
    srv.advance(10 * MIN);

    await saveDay(a.deps, a.userId, phoneDay(6_400, { since: { at: Date.parse(m), steps: 120 } }), true);
    assert.deepEqual(a.record(D)?.base, { kind: 'edit', steps: 8_000, at: Date.parse(m), editRef: m });
    assert.deepEqual(srv.sent(), ['A auto 6000 ref null', `A auto 8120 ref ${m}`]);
    assert.equal(srv.steps(), 8_120);
  });

  test('an “edited” answer without a marker the phone can take aligns its edit_ref with the server (no refusal loop)', async () => {
    forgetServerObservations();
    const srv = fakeServer(true, ist(D, '12:00'));
    const a = srv.phone('A');
    await saveDay(a.deps, a.userId, phoneDay(6_000), true);
    // The phone believes in a marker the server doesn't have (its record from another build, say).
    a.deps.updateRecord(a.userId, D, { editRef: 'gone' });
    srv.advance(11 * MIN);
    await saveDay(a.deps, a.userId, phoneDay(6_200), true);
    assert.equal(srv.sent().at(-1), 'A auto 6200 ref gone');
    assert.equal(a.record(D)?.editRef, null);
    srv.advance(11 * MIN);
    await saveDay(a.deps, a.userId, phoneDay(6_300), true);
    assert.equal(srv.sent().at(-1), 'A auto 6300 ref null');
    assert.equal(srv.steps(), 6_300);
  });

  test('the member’s number saved on this phone carries its own marker: the next automatic save is not refused', async () => {
    forgetServerObservations();
    const srv = fakeServer(true, ist(D, '12:00'));
    const a = srv.phone('A');
    await saveDay(a.deps, a.userId, phoneDay(12_000), true);
    srv.advance(MIN);
    const res = await saveManualDay(a.deps, a.userId, D, 9_000, phoneDay(12_050));
    const editAt = srv.now(); // the phone anchors its own edit when the server's answer arrives
    const m = srv.marker() ?? assert.fail('marker');
    assert.equal(res.tracking.steps, 9_000);
    assert.equal(srv.sent().at(-1), 'A manual 9000 ref null');
    assert.deepEqual(a.record(D)?.base, { kind: 'edit', steps: 9_000, at: editAt, editRef: m }, 'something was counting → an edit');
    assert.equal(a.record(D)?.serverModes, true);

    srv.advance(15 * MIN);
    await saveDay(a.deps, a.userId, phoneDay(12_400, { since: { at: editAt, steps: 200 } }), true);
    assert.equal(srv.sent().at(-1), `A auto 9200 ref ${m}`);
    assert.equal(srv.steps(), 9_200);
  });
});

describe('the “not_higher” answer (T37)', () => {
  test('the server’s higher count is kept, and nothing is re-sent until the day’s count passes it', async () => {
    forgetServerObservations();
    const srv = fakeServer(true, ist(D, '12:00'));
    const a = srv.phone('A');
    const b = srv.phone('B');
    await saveDay(a.deps, a.userId, phoneDay(6_000), true);
    srv.advance(MIN);
    await saveDay(b.deps, b.userId, phoneDay(9_000), true); // the member's other phone
    srv.advance(14 * MIN);

    await saveDay(a.deps, a.userId, phoneDay(7_000), true);
    assert.equal(srv.sent().at(-1), 'A auto 7000 ref null');
    assert.equal(srv.steps(), 9_000);
    assert.equal(a.record(D)?.server, 9_000);
    assert.equal(a.record(D)?.autoSent, 6_000, 'its own last save is unchanged');

    const before = srv.posts.length;
    for (const steps of [7_100, 7_500, 8_200, 8_900, 9_000]) {
      srv.advance(11 * MIN);
      assert.equal(await saveDay(a.deps, a.userId, phoneDay(steps), true), true);
    }
    assert.equal(srv.posts.length, before, 'no retry loop');

    srv.advance(11 * MIN);
    await saveDay(a.deps, a.userId, phoneDay(9_100), true);
    assert.equal(srv.steps(), 9_100);
    assert.equal(a.record(D)?.autoSent, 9_100);
  });
});

describe('reconcile a past day (T38, M6)', () => {
  /**
   * Today at 23:30 on an iPhone with the Motion fallback: the phone's live count above Apple Health's (12,000 vs
   * 11,000) — saved as the live tail. (A store that holds the phone's own steps: past days follow it, M4.)
   */
  async function liveTail(modes: boolean) {
    forgetServerObservations();
    const srv = fakeServer(modes, ist(D, '23:30'));
    const a = srv.phone('A');
    await saveDay(a.deps, a.userId, dayOf([health(11_000), pedometer(12_000)]), true, { tz: IST });
    assert.equal(srv.steps(), 12_000);
    srv.advance(8.5 * H); // the next morning, 08:00
    return { srv, a };
  }
  /** The past day the next morning: the store caught up at 11,500, below the phone's 12,000. */
  const morning = () => dayOf([health(11_500), pedometer(12_000, S, { complete: true })]);

  test('Android 9–13: Health Connect without this phone’s steps never lowers the phone’s live tail (M4)', async () => {
    forgetServerObservations();
    const srv = fakeServer(true, ist(D, '23:30'));
    const a = srv.phone('A');
    await saveDay(a.deps, a.userId, dayOf([hc(4_000), recording(12_000)]), true, { tz: IST });
    srv.advance(8.5 * H);
    // Strava wrote 4 000 steps for a run; the Recording API counted 12 000 — the day stays the phone's.
    await saveDay(a.deps, a.userId, dayOf([hc(4_000), recording(12_000, S, { complete: true })]), false, { tz: IST });
    assert.equal(srv.posts.length, 1);
    assert.equal(srv.steps(), 12_000);
  });

  test('Android 9–13: the phone counter that saved the live tail can’t see the day any more → Health Connect alone never lowers it', async () => {
    // Nov 1 (D) 23:30: the Recording API's 9 000 saved over Health Connect's 4 000 (a Fitbit worn part of the day). At
    // 00:31 the member switches counting off and on: the new subscription can't see D, which is read with HC alone.
    forgetServerObservations();
    const srv = fakeServer(true, ist(D, '23:30'));
    const a = srv.phone('A');
    await saveDay(a.deps, a.userId, dayOf([hc(4_000), recording(9_000)]), true, { tz: IST });
    assert.deepEqual(a.record(D)?.autoBy, { source: 'phone', counter: 'recording', coverFrom: S }, 'what made the save');
    srv.advance(61 * MIN);
    await saveDay(a.deps, a.userId, { ...dayOf([hc(4_000, S, { complete: true })]), phonePartial: true }, false, { tz: IST });
    await saveDay(a.deps, a.userId, dayOf([hc(4_000, S, { complete: true })]), false, { tz: IST });
    assert.equal(srv.posts.length, 1, 'no reconcile');
    assert.equal(srv.steps(), 9_000);
  });

  test('Disconnect: the day Health Connect saved isn’t lowered to the phone’s own count', async () => {
    forgetServerObservations();
    const srv = fakeServer(true, ist(D, '23:30'));
    const a = srv.phone('A');
    await saveDay(a.deps, a.userId, dayOf([hc(12_000, S, { includesPhone: true }), recording(9_000)]), true, { tz: IST });
    assert.equal(a.record(D)?.autoBy?.source, 'health_connect');
    srv.advance(8.5 * H);
    await saveDay(a.deps, a.userId, dayOf([recording(9_000, S, { complete: true })]), false, { tz: IST });
    assert.equal(srv.posts.length, 1);
    assert.equal(srv.steps(), 12_000);
  });

  test('the next morning the store says 11,500 → the day follows it (only this phone’s own save is corrected)', async () => {
    const { srv, a } = await liveTail(true);
    assert.equal(await saveDay(a.deps, a.userId, morning(), false, { tz: IST }), true);
    assert.equal(srv.sent().at(-1), 'A reconcile 11500 expect 12000 ref null');
    assert.equal(srv.steps(), 11_500);
    assert.equal(a.record(D)?.autoSent, 11_500);
    assert.equal(a.record(D)?.tz, IST, 'saved under the profile zone (M8)');
    srv.advance(H);
    await saveDay(a.deps, a.userId, morning(), false, { tz: IST });
    assert.equal(srv.posts.length, 2, 'nothing more');
  });

  test('the website set 11,800 meanwhile → unchanged, and the edit (made after the day ended) is the day’s for good', async () => {
    const { srv, a } = await liveTail(true);
    srv.website(D, 11_800);
    srv.advance(5 * MIN);
    await saveDay(a.deps, a.userId, morning(), false, { tz: IST });
    assert.equal(srv.sent().at(-1), 'A reconcile 11500 expect 12000 ref null');
    assert.equal(srv.steps(), 11_800);
    assert.equal(a.record(D)?.base?.kind, 'edit');
    srv.advance(H);
    await saveDay(a.deps, a.userId, morning(), false, { tz: IST });
    assert.equal(srv.posts.length, 2, 'nothing more (M5d)');
    assert.equal(srv.steps(), 11_800);
  });

  test('another phone raised the day meanwhile → “changed”: its count stays, and no reconcile follows', async () => {
    const { srv, a } = await liveTail(true);
    const b = srv.phone('B');
    await saveDay(b.deps, b.userId, dayOf([recording(12_300, S, { complete: true })]), false);
    assert.equal(srv.steps(), 12_300);
    srv.advance(5 * MIN);
    await saveDay(a.deps, a.userId, morning(), false, { tz: IST });
    assert.equal(srv.sent().at(-1), 'A reconcile 11500 expect 12000 ref null');
    assert.equal(srv.steps(), 12_300);
    assert.equal(a.record(D)?.server, 12_300);
    assert.equal(a.record(D)?.autoSent, 12_000, 'a foreign value is never taken as this phone’s own');
    srv.advance(H);
    const before = srv.posts.length;
    await saveDay(a.deps, a.userId, morning(), false, { tz: IST });
    assert.equal(srv.posts.length, before);
  });
});

describe('a coverage restart on a day with a base (R/U review, M5c3)', () => {
  test('an edit, then counting switched off and on: the steps saved between the edit and the restart stay in the day', async () => {
    forgetServerObservations();
    const srv = fakeServer(true, ist(D, '09:00'), {}, { editValue: true });
    const a = srv.phone('A');
    // 09:00 the member sets 2 000 while the Recording API counts (an edit).
    await saveManualDay(a.deps, a.userId, D, 2_000, dayOf([recording(1_500)]));
    const edit = a.record(D)?.base ?? assert.fail('the edit is the day’s base');
    assert.equal(edit.kind, 'edit');
    // 3 000 more by 11:55: saved as 5 000.
    srv.advance(2 * H + 55 * MIN);
    await saveDay(a.deps, a.userId, dayOf([recording(4_500, S, after(edit.at, 3_000))]), true, { tz: IST });
    assert.equal(srv.steps(), 5_000);
    // 12:00 switched off and on: the new subscription covers from 12:00. By 18:00 it has 4 000.
    const restart = ist(D, '12:00');
    srv.advance(6 * H);
    await saveDay(a.deps, a.userId, dayOf([recording(4_000, restart)]), true, { tz: IST });
    assert.deepEqual(a.record(D)?.base, { kind: 'edit', steps: 5_000, at: restart, editRef: edit.editRef }, 're-based at the restart');
    assert.equal(srv.steps(), 9_000, '2 000 + 3 000 + 4 000 — not 6 000');
    // Later reads carry on from the new base (no second re-base, no extra read of the server).
    const reads = srv.reads.length;
    srv.advance(H);
    await saveDay(a.deps, a.userId, dayOf([recording(4_600, restart)]), true, { tz: IST });
    assert.equal(srv.steps(), 9_600);
    assert.equal(srv.reads.length, reads);
  });
});

describe('the old server (no `applied`, T39)', () => {
  test('never reconcile: the live tail stays above the store until the server has the modes', async () => {
    forgetServerObservations();
    const srv = fakeServer(false, ist(D, '23:30'));
    const a = srv.phone('A');
    await saveDay(a.deps, a.userId, dayOf([health(11_000), pedometer(12_000)]), true, { tz: IST });
    assert.equal(a.record(D)?.serverModes, false);
    srv.advance(8.5 * H);
    assert.equal(await saveDay(a.deps, a.userId, dayOf([health(11_500), pedometer(12_000, S, { complete: true })]), false, { tz: IST }), true);
    assert.equal(srv.posts.length, 1);
    assert.equal(srv.steps(), 12_000);
  });

  test('the read right before each save still guards it: a higher count saved elsewhere since is never lowered', async () => {
    forgetServerObservations();
    const srv = fakeServer(false, ist(D, '17:58'));
    const a = srv.phone('A');
    await saveDay(a.deps, a.userId, phoneDay(6_000), true);
    srv.set(D, 9_000); // another phone (the old server: a plain set)
    srv.advance(15 * MIN);
    await saveDay(a.deps, a.userId, phoneDay(6_200), true);
    assert.equal(srv.steps(), 9_000);
    assert.deepEqual(srv.reads, ['A 2026-10-20', 'A 2026-10-20']);
    assert.deepEqual(srv.sent(), ['A auto 6000 ref null'], 'the modes go along (the old server ignores them)');
  });

  test('feature detection: a day is saved behind that read until an answer has `applied`; then without it', async () => {
    forgetServerObservations();
    const srv = fakeServer(false, ist(D, '09:00'));
    const a = srv.phone('A');
    await saveDay(a.deps, a.userId, phoneDay(1_000), true);
    assert.equal(a.record(D)?.serverModes, false);
    srv.upgrade(); // B1 deployed
    srv.advance(15 * MIN);
    await saveDay(a.deps, a.userId, phoneDay(1_500), true);
    assert.equal(srv.reads.length, 2, 'still read first: the server’s modes weren’t known');
    assert.equal(a.record(D)?.serverModes, true);
    srv.advance(15 * MIN);
    await saveDay(a.deps, a.userId, phoneDay(2_000), true);
    assert.equal(srv.reads.length, 2, 'no read before a save the server guards itself');
    assert.equal(srv.steps(), 2_000);
    // Another day is read first again until its own first answer.
    await saveDay(a.deps, a.userId, dayOf([recording(9_000, dayStartMs(PREV, IST), { complete: true })], PREV), false);
    assert.equal(srv.reads.length, 3);
    assert.equal(srv.steps(PREV), 9_000);
  });

  test('the member’s number saved on this phone: no marker, so the old server’s edit sign stays the lower read', async () => {
    forgetServerObservations();
    const srv = fakeServer(false, ist(D, '12:00'));
    const a = srv.phone('A');
    const res = await saveManualDay(a.deps, a.userId, D, 4_000, null);
    assert.equal(res.applied, undefined);
    assert.deepEqual(a.record(D)?.base, { kind: 'start', steps: 4_000, at: srv.now(), editRef: null });
    assert.equal(a.record(D)?.serverModes, false);
    assert.equal(srv.sent().at(-1), 'A manual 4000 ref null');
  });
});

/* ───────────────────────────── Phase J review: the save flow's gaps ───────────────────────────── */

describe('a taken edit leaves a past day open (T36 on a settled day, M7)', () => {
  test('an “edited” answer on a settled past day: not final; the next run saves the edit + what was counted since', async () => {
    forgetServerObservations();
    const srv = fakeServer(true, ist(D, '20:00'));
    const a = srv.phone('A'); // the Recording API only (no store)
    await syncDay(a.deps, a.userId, dayOf([recording(7_000)]), true, false, { tz: IST });
    srv.advance(3 * H); // 23:00: the member raises the day to 9 000 on the website
    srv.website(D, 9_000);
    const m = srv.marker() ?? assert.fail('marker');
    // 01:30: the background task ran late (Doze). The past day is complete and an hour past: this run could settle it.
    srv.advance(2.5 * H);
    assert.equal(await syncDay(a.deps, a.userId, dayOf([recording(7_800, S, { complete: true })]), false, false, { tz: IST }), 'edited');
    assert.equal(srv.sent().at(-1), 'A auto 7800 ref null');
    assert.deepEqual(a.record(D)?.base, { kind: 'edit', steps: 9_000, at: Date.parse(m), editRef: m });
    assert.equal(a.record(D)?.final, undefined, 'not final: the 800 steps after the edit aren’t saved yet');
    srv.advance(30 * MIN);
    const next = dayOf([recording(7_800, S, { complete: true, ...after(Date.parse(m), 800) })]);
    assert.equal(await syncDay(a.deps, a.userId, next, false, false, { tz: IST }), 'done');
    assert.equal(srv.sent().at(-1), `A auto 9800 ref ${m}`);
    assert.equal(srv.steps(), 9_800);
    assert.equal(a.record(D)?.final, true);
  });

  test('an edit taken from Today’s read or from the read before a save: the same — saved on, then final', async () => {
    forgetServerObservations();
    const srv = fakeServer(true, ist(D, '20:00'));
    const a = srv.phone('A');
    await syncDay(a.deps, a.userId, dayOf([recording(7_000)]), true, false);
    srv.advance(3 * H);
    srv.website(D, 9_000);
    a.todayRead(); // the member opened Today: the marker is seen before any save
    srv.advance(2.5 * H);
    assert.equal(await syncDay(a.deps, a.userId, dayOf([recording(7_800, S, { complete: true })]), false, false), 'edited');
    assert.equal(srv.posts.length, 1, 'nothing to save until the count since the edit is read');
    assert.equal(a.record(D)?.final, undefined);
    // The old server (no markers): a lower count Today read at 23:30 is the edit, anchored at that read — open too.
    forgetServerObservations();
    const old = fakeServer(false, ist(D, '20:00'));
    const b = old.phone('B');
    await syncDay(b.deps, b.userId, dayOf([recording(7_000)]), true, false);
    old.advance(3 * H);
    old.set(D, 6_000);
    old.advance(30 * MIN);
    const seenAt = old.now();
    observeServerSteps(b.userId, D, 6_000, seenAt);
    old.advance(2 * H);
    assert.equal(await syncDay(b.deps, b.userId, dayOf([recording(7_800, S, { complete: true })]), false, false), 'edited');
    assert.deepEqual(b.record(D)?.base, { kind: 'edit', steps: 6_000, at: seenAt, editRef: null });
    assert.equal(b.record(D)?.final, undefined);
    assert.equal(old.posts.length, 1);
  });

  test('the old server: an edit first seen by the read before a past day’s save is anchored at that read — after the day, so final', async () => {
    forgetServerObservations();
    const old = fakeServer(false, ist(D, '20:00'));
    const b = old.phone('B');
    await syncDay(b.deps, b.userId, dayOf([recording(7_000)]), true, false);
    old.advance(3 * H);
    old.set(D, 6_000); // when, the old server can't say
    old.advance(2.5 * H);
    assert.equal(await syncDay(b.deps, b.userId, dayOf([recording(7_800, S, { complete: true })]), false, false), 'done');
    assert.equal(b.record(D)?.base?.kind, 'edit');
    assert.ok((b.record(D)?.base?.at ?? 0) >= dayBounds(D, IST).end, 'the member’s number for good (M5d)');
    assert.equal(b.record(D)?.final, true);
    assert.equal(old.steps(), 6_000);
    assert.equal(old.posts.length, 1);
  });

  test('an edit made after the day ended is the member’s number for good: final at once', async () => {
    forgetServerObservations();
    const srv = fakeServer(true, ist(D, '20:00'));
    const a = srv.phone('A');
    await syncDay(a.deps, a.userId, dayOf([recording(7_000)]), true, false);
    srv.advance(5 * H); // 01:00: the website edit is made after the day ended
    srv.website(D, 9_000);
    srv.advance(30 * MIN);
    assert.equal(await syncDay(a.deps, a.userId, dayOf([recording(7_800, S, { complete: true })]), false, false), 'done');
    assert.equal(a.record(D)?.final, true);
    assert.equal(srv.steps(), 9_000);
  });
});

describe('an edit taken after another phone raised it is never counted twice (M5c2)', () => {
  /** 12:00 the website sets 5 000; phone B sees it at once and raises the day to 7 000 by 14:00 (the marker stays). */
  async function raisedByB(editValue: boolean) {
    forgetServerObservations();
    const srv = fakeServer(true, ist(D, '11:58'), {}, { editValue });
    const a = srv.phone('A');
    const b = srv.phone('B');
    await syncDay(a.deps, a.userId, dayOf([recording(4_000)]), true, false);
    await syncDay(b.deps, b.userId, dayOf([recording(4_100)]), true, false);
    srv.advance(2 * MIN);
    srv.website(D, 5_000);
    const markedAt = Date.parse(srv.marker() ?? assert.fail('marker'));
    b.todayRead();
    srv.advance(2 * H);
    await syncDay(b.deps, b.userId, dayOf([recording(6_100, S, after(markedAt, 2_000))]), true, false);
    assert.equal(srv.steps(), 7_000);
    return { srv, a, markedAt };
  }

  /** A's own count after `at` at 14:45: 2 200 since the edit at 12:00, 200 of them after B's raise at 14:00. */
  const aSince = (at: number, markedAt: number) => (at <= markedAt ? 2_200 : 200);

  test('without the edit’s own number: the day’s count taken from its last write on (7 000 + 200, not + 2 200)', async () => {
    const { srv, a, markedAt } = await raisedByB(false);
    const raisedAt = srv.now();
    srv.advance(30 * MIN); // 14:30: A's raise is refused, the edit taken
    await syncDay(a.deps, a.userId, dayOf([recording(6_300)]), true, false);
    assert.equal(srv.sent().at(-1), 'A auto 6300 ref null');
    assert.equal(a.record(D)?.base?.steps, 7_000);
    const at = a.record(D)?.base?.at ?? assert.fail('the edit is the day’s base');
    assert.ok(at >= raisedAt - 300 && at <= raisedAt, 'anchored at B’s raise, not at the marker');
    srv.advance(15 * MIN);
    await syncDay(a.deps, a.userId, dayOf([recording(6_500, S, after(at, aSince(at, markedAt)))]), true, false);
    assert.equal(srv.steps(), 7_200);
  });

  test('with the edit’s own number (B2): the edit at its marker, and each phone’s count since it compared, never summed', async () => {
    const { srv, a, markedAt } = await raisedByB(true);
    srv.advance(30 * MIN);
    await syncDay(a.deps, a.userId, dayOf([recording(6_300)]), true, false);
    assert.deepEqual(a.record(D)?.base, { kind: 'edit', steps: 5_000, at: markedAt, editRef: srv.marker() });
    assert.equal(a.record(D)?.server, 7_000);
    srv.advance(15 * MIN);
    await syncDay(a.deps, a.userId, dayOf([recording(6_500, S, after(markedAt, aSince(markedAt, markedAt)))]), true, false);
    assert.equal(srv.steps(), 7_200);
  });

  test('one phone whose day record was lost takes the marker again: the steps it saved on top aren’t added twice', async () => {
    forgetServerObservations();
    const srv = fakeServer(true, ist(D, '12:00'));
    const a = srv.phone('A');
    await syncDay(a.deps, a.userId, dayOf([recording(8_000)]), true, false);
    srv.advance(MIN);
    srv.website(D, 9_000);
    const markedAt = Date.parse(srv.marker() ?? assert.fail('marker'));
    a.todayRead();
    srv.advance(H);
    await syncDay(a.deps, a.userId, dayOf([recording(8_800, S, after(markedAt, 800))]), true, false);
    assert.equal(srv.steps(), 9_800);
    const raisedAt = srv.now();
    srv.advance(MIN);
    a.signOut(); // the cache was purged
    forgetServerObservations();
    a.todayRead();
    srv.advance(15 * MIN);
    await syncDay(a.deps, a.userId, dayOf([recording(8_900)]), true, false);
    const at = a.record(D)?.base?.at ?? assert.fail('the marker taken again');
    assert.ok(at >= raisedAt - 300 && at <= raisedAt);
    // 950 counted since the edit, 150 of them since this phone's raise.
    await syncDay(a.deps, a.userId, dayOf([recording(8_950, S, after(at, at <= markedAt ? 950 : 150))]), true, false);
    assert.equal(srv.steps(), 9_950, 'not 9 800 + 950');
  });
});

describe('counting that starts after this phone’s own save (M5c3)', () => {
  test('the switch off and on again (the Recording API re-subscribed at 15:00): the morning’s count stays, the new one adds on', async () => {
    forgetServerObservations();
    const srv = fakeServer(true, ist(D, '11:50'));
    const a = srv.phone('A');
    await syncDay(a.deps, a.userId, dayOf([recording(5_000)]), true, false);
    srv.advance(3 * H + 10 * MIN); // 15:00: back on; the new subscription covers the day from then
    const back = srv.now();
    srv.advance(4 * H);
    await syncDay(a.deps, a.userId, dayOf([recording(6_000, back)]), true, false);
    assert.equal(srv.steps(), 11_000);
  });

  test('Health Connect from its grant at 14:00, signed out at 18:05 and back: the day stays what HC counted (not 6 400)', async () => {
    forgetServerObservations();
    const srv = fakeServer(true, ist(D, '14:30'));
    const a = srv.phone('A');
    const grant = ist(D, '14:00');
    const hcFrom = (steps: number, extra: Partial<SourceReading> = {}) => dayOf([hc(steps, grant, { includesPhone: true, ...extra })]);
    await syncDay(a.deps, a.userId, hcFrom(500), true, true);
    srv.advance(3.5 * H); // 18:00
    await syncDay(a.deps, a.userId, hcFrom(3_000), true, true);
    assert.equal(srv.steps(), 3_000);
    srv.advance(5 * MIN);
    a.signOut(); // the day records go (P16); the prefs keep when this phone last saved
    forgetServerObservations();
    srv.advance(55 * MIN); // 19:00
    await syncDay(a.deps, a.userId, hcFrom(3_400), true, true);
    assert.equal(srv.steps(), 3_400);
    const lastSave = a.record(D)?.base?.at ?? assert.fail('a start at this phone’s last save');
    srv.advance(30 * MIN);
    await syncDay(a.deps, a.userId, hcFrom(3_600, after(lastSave, 600)), true, true);
    assert.equal(srv.steps(), 3_600);
  });
});

describe('the member’s number saved before the first read finished (M5c1 without a reading)', () => {
  test('today, while this phone counts: an edit — the next run doesn’t put the higher count back', async () => {
    forgetServerObservations();
    const srv = fakeServer(true, ist(D, '12:00'));
    const a = srv.phone('A');
    await syncDay(a.deps, a.userId, dayOf([recording(8_000)]), true, false);
    srv.advance(H);
    // A cold start: the member corrects the day before the first read returns.
    await saveManualDay(a.deps, a.userId, D, 5_000, null, { end: dayBounds(D, IST).end, counting: false });
    const m = srv.marker() ?? assert.fail('marker');
    assert.equal(a.record(D)?.base?.kind, 'edit', 'this phone saved the day automatically: something counts here');
    srv.advance(MIN);
    await syncDay(a.deps, a.userId, dayOf([recording(8_010)]), true, false);
    assert.equal(srv.steps(), 5_000, 'not 8 010');
    srv.advance(15 * MIN);
    const at = a.record(D)?.base?.at ?? assert.fail('base');
    await syncDay(a.deps, a.userId, dayOf([recording(8_300, S, after(at, 290))]), true, false);
    assert.equal(srv.sent().at(-1), `A auto 5290 ref ${m}`);
  });

  test('a past day corrected right after launch: the member’s number for good (not undone by the launch’s read)', async () => {
    forgetServerObservations();
    const srv = fakeServer(true, ist(D, '22:00'));
    const a = srv.phone('A');
    await syncDay(a.deps, a.userId, dayOf([recording(8_000)]), true, false);
    srv.advance(11 * H); // 09:00 the next day
    await saveManualDay(a.deps, a.userId, D, 5_000, null, { end: dayBounds(D, IST).end, counting: false });
    assert.equal(a.record(D)?.base?.kind, 'edit');
    srv.advance(MIN);
    assert.equal(await syncDay(a.deps, a.userId, dayOf([recording(8_000, S, { complete: true })]), false, false), 'done');
    assert.equal(srv.steps(), 5_000);
    assert.equal(a.record(D)?.final, true);
  });

  test('a source that is ON is something counting too; with nothing at all: a start', async () => {
    forgetServerObservations();
    const srv = fakeServer(true, ist(D, '12:00'));
    const a = srv.phone('A');
    await saveManualDay(a.deps, a.userId, D, 3_000, null, { end: dayBounds(D, IST).end, counting: true });
    assert.equal(a.record(D)?.base?.kind, 'edit');
    const b = srv.phone('B');
    await saveManualDay(b.deps, b.userId, D, 3_000, null, { end: dayBounds(D, IST).end, counting: false });
    assert.equal(b.record(D)?.base?.kind, 'start');
  });
});

describe('the run that settles a past day checks the server once more (M7)', () => {
  test('a count below the one last seen is sent before the day goes final: another phone’s reconcile may have lowered it', async () => {
    forgetServerObservations();
    const srv = fakeServer(true, ist(D, '22:00'));
    const iphone = srv.phone('A'); // Apple Health holds its steps: past days follow it
    const pixel = srv.phone('B'); // the Recording API only
    await syncDay(pixel.deps, pixel.userId, dayOf([recording(8_000)]), true, false);
    srv.advance(MIN);
    await syncDay(iphone.deps, iphone.userId, dayOf([health(11_000), pedometer(12_000)]), true, true); // the live tail
    srv.advance(30 * MIN);
    await syncDay(pixel.deps, pixel.userId, dayOf([recording(9_100)]), true, false);
    assert.equal(srv.sent().at(-1), 'B auto 9100 ref null');
    assert.equal(pixel.record(D)?.server, 12_000, '“not_higher”');
    srv.advance(9 * H); // the next morning: the iPhone follows Apple Health
    await syncDay(iphone.deps, iphone.userId, dayOf([health(9_000), pedometer(12_000, S, { complete: true })]), false, true);
    assert.equal(srv.steps(), 9_000);
    srv.advance(MIN);
    // The Pixel's run that makes the day final (complete, an hour past): one more raise, which applies.
    assert.equal(await syncDay(pixel.deps, pixel.userId, dayOf([recording(9_100, S, { complete: true })]), false, false), 'done');
    assert.equal(srv.sent().at(-1), 'B auto 9100 ref null');
    assert.equal(srv.steps(), 9_100);
    assert.equal(pixel.record(D)?.final, true);
  });

  test('a day made final without a health-store count is marked so (Apple Health’s “no steps” state looks back at it)', async () => {
    forgetServerObservations();
    const srv = fakeServer(true, ist(addDays(D, 4), '09:00'));
    const a = srv.phone('A');
    assert.equal(await syncDay(a.deps, a.userId, dayOf([]), false, true), 'done');
    assert.deepEqual(a.record(D), { final: true, noStore: true });
    await syncDay(a.deps, a.userId, dayOf([health(3_000)], PREV), false, true);
    assert.equal(a.record(PREV)?.final, true);
    assert.equal(a.record(PREV)?.noStore, undefined);
  });

  test('a health store that is ON but wasn’t read: a past day saves nothing and stays open', async () => {
    forgetServerObservations();
    const srv = fakeServer(true, ist(D, '23:00'));
    const a = srv.phone('A');
    await syncDay(a.deps, a.userId, dayOf([hc(11_000), recording(9_000)]), true, true);
    srv.advance(80 * H); // a background run past e + 72 h without READ_HEALTH_DATA_IN_BACKGROUND
    const unread: DayReading = { ...dayOf([recording(9_200, S, { complete: true })]), storeUnread: true };
    assert.equal(await syncDay(a.deps, a.userId, unread, false, true), 'done');
    assert.equal(srv.posts.length, 1);
    assert.equal(srv.steps(), 11_000);
    assert.equal(a.record(D)?.final, undefined);
  });
});

/* ───────────── Held back: the iPhone's health and fitness counts stay on it (coordinator decision, R/U review) ───────────── */

describe('a count the phone mustn’t send yet (`SaveOptions.hold`: the iPhone’s Apple Health and motion counts until the app-wide AI consent)', () => {
  const hold = { hold: countsIphoneHealthData };

  test('neither an Apple Health count nor the motion sensor’s is sent (App Store 5.1.3(i) names both)', async () => {
    forgetServerObservations();
    const srv = fakeServer(true, ist(D, '18:00'));
    const a = srv.phone('A');
    assert.equal(await syncDay(a.deps, a.userId, dayOf([health(6_000)]), true, true, hold), 'done');
    assert.equal(srv.posts.length, 0, 'Apple Health’s count stays on the phone');
    assert.equal(a.record(D)?.autoSent, undefined);
    srv.advance(20 * MIN);
    await syncDay(a.deps, a.userId, dayOf([health(6_000), pedometer(6_400)]), true, true, hold);
    assert.equal(srv.posts.length, 0, 'the motion sensor leading: Motion & Fitness data, held too');
    srv.advance(20 * MIN);
    await syncDay(a.deps, a.userId, dayOf([pedometer(6_500)]), true, false, hold);
    assert.equal(srv.posts.length, 0, '“Use iPhone motion instead” alone');
  });

  test('a past day saves nothing — no reconcile either — and still goes final with its store count noted', async () => {
    forgetServerObservations();
    const srv = fakeServer(true, ist(D, '22:00'));
    const a = srv.phone('A');
    await syncDay(a.deps, a.userId, dayOf([health(9_000), pedometer(9_500)]), true, true, hold);
    srv.advance(75 * H); // past e + 72 h: settled
    assert.equal(await syncDay(a.deps, a.userId, dayOf([health(9_100), pedometer(9_500, S, { complete: true })]), false, true, hold), 'done');
    assert.equal(srv.posts.length, 0);
    assert.equal(a.record(D)?.final, true);
    assert.equal(a.record(D)?.noStore, undefined, 'Apple Health had steps that day (“no steps” never looks at it)');
  });

  test('the member’s own number is theirs (sent); what Apple Health or the motion sensor counted after it is not', async () => {
    forgetServerObservations();
    const srv = fakeServer(true, ist(D, '12:00'));
    const a = srv.phone('A');
    await saveManualDay(a.deps, a.userId, D, 3_000, dayOf([health(2_500)]));
    const at = a.record(D)?.base?.at ?? assert.fail('the edit is the day’s base');
    srv.advance(H);
    await syncDay(a.deps, a.userId, dayOf([health(3_400, S, after(at, 900))]), true, true, hold);
    srv.advance(H);
    await syncDay(a.deps, a.userId, dayOf([health(3_400, S, after(at, 900)), pedometer(4_500, S, after(at, 1_200))]), true, true, hold);
    assert.deepEqual(srv.sent(), ['A manual 3000 ref null']);
  });

  test('only the iPhone’s health and fitness sources are held: a typed start alone isn’t (nothing to add), Android’s never are', () => {
    const v = (sources: SourceReading[]) => dayValue(dayOf(sources), null, true) ?? assert.fail('a value');
    assert.equal(countsIphoneHealthData(v([health(10)])), true);
    assert.equal(countsIphoneHealthData(v([pedometer(10)])), true);
    assert.equal(countsIphoneHealthData(v([hc(10)])), false, 'Android: the hold is the iPhone’s (sync.ts applies it only there)');
    assert.equal(countsIphoneHealthData(v([recording(10)])), false);
    const typed = dayValue(dayOf([]), { kind: 'start', steps: 4_000, at: ist(D, '09:00') }, true) ?? assert.fail('a value');
    assert.equal(countsIphoneHealthData(typed), false);
  });

  test('without `hold` Apple Health counts are saved as before (Android, or once the AI consent ships)', async () => {
    forgetServerObservations();
    const srv = fakeServer(true, ist(D, '18:00'));
    const a = srv.phone('A');
    await syncDay(a.deps, a.userId, dayOf([health(6_000)]), true, true);
    assert.deepEqual(srv.sent(), ['A auto 6000 ref null']);
  });
});

/* ───────────────────────────── The old server: raise only (before B1) ───────────────────────────── */

describe('save — one day against the old server (raise only)', () => {
  test('the first count of the day is saved; the server is read right before', async () => {
    forgetServerObservations();
    const srv = fakeServer(false, ist(D, '09:00'));
    const f = srv.phone();
    assert.equal(await saveDay(f.deps, f.userId, phoneDay(1_200), true), true);
    assert.deepEqual(srv.sent(), ['A auto 1200 ref null']);
    assert.deepEqual(srv.reads, ['A 2026-10-20']);
    assert.equal(f.record(D)?.autoSent, 1_200);
  });

  test('this phone’s own saves never hide a higher count saved elsewhere since (no stale-cache overwrite)', async () => {
    forgetServerObservations();
    const srv = fakeServer(false, ist(D, '17:58'));
    const f = srv.phone();
    await saveDay(f.deps, f.userId, phoneDay(6_000), true);
    srv.set(D, 9_000); // 18:00 — another phone / the website saved a higher count
    srv.advance(3 * MIN);
    assert.equal(await saveDay(f.deps, f.userId, phoneDay(6_060), true), true);
    assert.equal(srv.steps(), 9_000, 'never lowered');
    assert.equal(srv.posts.length, 1);
    // Higher than the server again later: saved.
    srv.advance(15 * MIN);
    await saveDay(f.deps, f.userId, phoneDay(9_100), true);
    assert.equal(srv.steps(), 9_100);
  });

  test('a lower count set on the website after this phone’s save is kept; steps counted after it add on', async () => {
    forgetServerObservations();
    const srv = fakeServer(false, ist(D, '12:00'));
    const f = srv.phone();
    await saveDay(f.deps, f.userId, phoneDay(14_000), true);
    srv.advance(MIN);
    srv.set(D, 9_000); // the member corrects a bus ride on the website
    const seenAt = srv.now();
    observeServerSteps(f.userId, D, 9_000, seenAt); // Today's dashboard fetch saw it (the old server: no marker)
    srv.advance(MIN);
    await saveDay(f.deps, f.userId, phoneDay(14_060), true);
    assert.equal(srv.steps(), 9_000, 'the correction is not undone');
    assert.deepEqual(f.record(D)?.base, { kind: 'edit', steps: 9_000, at: seenAt, editRef: null }, 'anchored at the read');
    srv.advance(5 * MIN);
    await saveDay(f.deps, f.userId, phoneDay(14_200, { since: { at: seenAt, steps: 140 } }), true);
    assert.equal(srv.steps(), 9_140, 'the member’s number + 140 counted since');
    assert.deepEqual(
      srv.posts.map((p) => p.steps),
      [14_000, 9_140],
      'never posted the old higher count again'
    );
  });

  test('a source that can’t say what it counted after the edit adds nothing (never a difference of values, C4)', async () => {
    forgetServerObservations();
    const srv = fakeServer(false, ist(D, '12:00'));
    const f = srv.phone();
    await saveDay(f.deps, f.userId, phoneDay(14_000), true);
    srv.advance(MIN);
    srv.set(D, 9_000);
    observeServerSteps(f.userId, D, 9_000, srv.now());
    srv.advance(15 * MIN);
    await saveDay(f.deps, f.userId, phoneDay(14_500), true);
    assert.equal(srv.steps(), 9_000);
    assert.equal(srv.posts.length, 1);
  });

  test('an edit noticed only by the read before a save is accepted, not overwritten', async () => {
    forgetServerObservations();
    const srv = fakeServer(false, ist(D, '12:00'));
    const f = srv.phone();
    await saveDay(f.deps, f.userId, phoneDay(14_000), true);
    srv.advance(MIN);
    srv.set(D, 9_000);
    srv.advance(MIN);
    await saveDay(f.deps, f.userId, phoneDay(14_060), true);
    assert.equal(srv.steps(), 9_000);
    assert.equal(srv.posts.length, 1);
    const at = f.record(D)?.base?.at ?? assert.fail('the edit is the day’s base');
    srv.advance(5 * MIN);
    await saveDay(f.deps, f.userId, phoneDay(14_200, { since: { at, steps: 140 } }), true);
    assert.equal(srv.steps(), 9_140);
  });

  test('counting that starts mid-day adds on top of steps typed that morning (M5c3)', async () => {
    forgetServerObservations();
    const srv = fakeServer(false, ist(D, '14:00'), { [D]: 5_000 });
    const f = srv.phone();
    const partialFrom = ist(D, '14:00');
    await saveDay(f.deps, f.userId, phoneDay(0, { partialFrom }), true);
    assert.deepEqual(f.record(D)?.base, { kind: 'start', steps: 5_000, at: partialFrom });
    assert.equal(srv.steps(), 5_000);
    srv.advance(5 * H);
    await saveDay(f.deps, f.userId, phoneDay(3_000, { partialFrom }), true);
    assert.equal(srv.steps(), 8_000);
  });

  test('the member’s own number on this phone (Edit) stays the day’s count; counting adds on top', async () => {
    forgetServerObservations();
    const srv = fakeServer(false, ist(D, '12:00'));
    const f = srv.phone();
    await saveDay(f.deps, f.userId, phoneDay(12_000), true);
    srv.advance(MIN);
    srv.set(D, 9_000); // the sheet's POST
    const editAt = srv.now();
    applyManualSteps(f.deps, f.userId, D, 9_000, phoneDay(12_100), null);
    assert.deepEqual(f.record(D)?.base, { kind: 'edit', steps: 9_000, at: editAt, editRef: null }, 'something was counting → an edit');
    assert.equal(f.record(D)?.autoSent, undefined, 'this phone’s earlier save is gone');
    srv.advance(MIN);
    await saveDay(f.deps, f.userId, phoneDay(12_120, { since: { at: editAt, steps: 20 } }), true);
    assert.equal(srv.steps(), 9_000, '+20: not worth a save yet');
    srv.advance(MIN);
    await saveDay(f.deps, f.userId, phoneDay(12_300, { since: { at: editAt, steps: 200 } }), true);
    assert.equal(srv.steps(), 9_200);
  });

  test('typed today with nothing counting: a start (M5c1)', () => {
    forgetServerObservations();
    const srv = fakeServer(false, ist(D, '12:00'));
    const f = srv.phone();
    applyManualSteps(f.deps, f.userId, D, 4_000, null);
    assert.deepEqual(f.record(D)?.base, { kind: 'start', steps: 4_000, at: ist(D, '12:00'), editRef: null });
    assert.equal(f.record(D)?.server, 4_000);
  });

  test('typed LOWER today with nothing counting: the day is that number, and a higher whole-day count replaces it', async () => {
    forgetServerObservations();
    const srv = fakeServer(false, ist(D, '12:00'), { [D]: 1_200 });
    const f = srv.phone();
    srv.set(D, 900); // the sheet's POST
    applyManualSteps(f.deps, f.userId, D, 900, null);
    assert.equal(f.record(D)?.base?.kind, 'start', 'not frozen: nothing was counting');
    assert.equal(f.record(D)?.server, 900);
    srv.advance(H);
    // Health Connect gets connected and has the whole day: its higher count is saved.
    await saveDay(f.deps, f.userId, dayOf([hc(5_000)]), true);
    assert.equal(srv.steps(), 5_000);
  });

  test('typed today, then this phone starts counting mid-day: its steps add on top of the typed number', async () => {
    forgetServerObservations();
    const srv = fakeServer(false, ist(D, '12:00'));
    const f = srv.phone();
    srv.set(D, 900);
    applyManualSteps(f.deps, f.userId, D, 900, null);
    srv.advance(H);
    const partialFrom = srv.now();
    await saveDay(f.deps, f.userId, phoneDay(0, { partialFrom }), true);
    srv.advance(H);
    await saveDay(f.deps, f.userId, phoneDay(700, { partialFrom }), true);
    assert.equal(srv.steps(), 1_600);
  });

  test('a past day typed after it ended, while a source had it: the member’s number for good (M5d)', async () => {
    forgetServerObservations();
    const srv = fakeServer(false, ist(NEXT, '09:00'), { [D]: 12_000 });
    const f = srv.phone();
    srv.set(D, 9_000);
    applyManualSteps(f.deps, f.userId, D, 9_000, phoneDay(12_000, { complete: true }));
    assert.equal(f.record(D)?.base?.kind, 'edit');
    srv.advance(H);
    assert.equal(await saveDay(f.deps, f.userId, phoneDay(12_400, { complete: true }), false), true);
    assert.equal(srv.steps(), 9_000);
    assert.equal(srv.posts.length, 0);
  });

  test('offline: retried later (false); a refusal a retry won’t fix is not retried (true)', async () => {
    forgetServerObservations();
    const srv = fakeServer(false, ist(D, '12:00'));
    const f = srv.phone();
    srv.fail(new Error('Network request failed'));
    assert.equal(await saveDay(f.deps, f.userId, phoneDay(1_000), true), false);
    srv.fail('permanent');
    assert.equal(await saveDay(f.deps, f.userId, phoneDay(1_000), false), true);
    assert.equal(srv.posts.length, 0);
  });

  test('today leaves a long-gap estimate out; once the day is past its full count is saved', async () => {
    forgetServerObservations();
    const srv = fakeServer(false, ist(D, '10:00'));
    const f = srv.phone();
    await saveDay(f.deps, f.userId, phoneDay(4_000, { estimated: 4_000 }), true);
    assert.equal(srv.posts.length, 0);
    srv.advance(5 * H);
    await saveDay(f.deps, f.userId, phoneDay(6_000, { estimated: 4_000 }), true);
    assert.equal(srv.steps(), 2_000, 'only what was really counted today');
    srv.advance(10 * H);
    await saveDay(f.deps, f.userId, phoneDay(6_400, { estimated: 4_000, complete: true }), false);
    assert.equal(srv.steps(), 6_400);
  });

  test('a stale run (signed out meanwhile) writes nothing', async () => {
    forgetServerObservations();
    const srv = fakeServer(false, ist(D, '12:00'));
    const f = srv.phone();
    let signedOut = false;
    const slow: SaveDeps = {
      ...f.deps,
      async fetchServerDay(date) {
        signedOut = true;
        return f.deps.fetchServerDay(date);
      },
    };
    assert.equal(await saveDay(slow, f.userId, phoneDay(1_000), true, { stale: () => signedOut }), true);
    assert.equal(srv.posts.length, 0);
  });
});
