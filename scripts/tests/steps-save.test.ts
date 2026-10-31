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
import type { DayRecord } from '../../src/lib/steps/policy';
import { applyManualSteps, saveDay, saveManualDay, type SaveDeps, type StepsAnswer, type StepsMode } from '../../src/lib/steps/save';
import { forgetServerObservations, observeServerSteps } from '../../src/lib/steps/serverSeen';
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
 * another writer (on the old server, the website too: it has no marker).
 */
function fakeServer(modes: boolean, start: number, initial: Record<string, number> = {}) {
  let clock = start;
  let hasModes = modes;
  let failure: unknown = null;
  const rows = new Map<string, { steps: number; marker: string | null }>(Object.entries(initial).map(([d, steps]) => [d, { steps, marker: null }]));
  const posts: Post[] = [];
  const reads: string[] = [];

  const row = (date: string) => rows.get(date) ?? { steps: 0, marker: null };
  const tracking = (date: string): TrackingDay => ({
    date,
    steps: row(date).steps,
    water_glasses: 0,
    ...(hasModes ? { steps_edited_at: row(date).marker } : {}),
  });

  function answer(date: string, steps: number, mode: StepsMode, editRef: string | null, expect?: number): StepsAnswer {
    const r = row(date);
    if (!hasModes) {
      rows.set(date, { ...r, steps }); // the old server: whatever the body says, it sets the count
      return { tracking: tracking(date) };
    }
    if (mode === 'manual') {
      rows.set(date, { steps, marker: new Date(clock).toISOString() });
      return { tracking: tracking(date), applied: true };
    }
    if (r.marker !== editRef) return { tracking: tracking(date), applied: false, reason: 'edited' };
    if (mode === 'auto' && !(r.steps < steps)) return { tracking: tracking(date), applied: false, reason: 'not_higher' };
    if (mode === 'reconcile' && r.steps !== expect) return { tracking: tracking(date), applied: false, reason: 'changed' };
    rows.set(date, { ...r, steps });
    return { tracking: tracking(date), applied: true };
  }

  /** One phone of the member: its own day records; its server observations are kept under its own id. */
  function phone(name = 'A') {
    const userId = `member-${++fakeIds}-${name}`;
    const records = new Map<string, DayRecord>();
    const deps: SaveDeps = {
      getRecord: (u, d) => records.get(`${u}|${d}`),
      updateRecord: (u, d, patch) => {
        records.set(`${u}|${d}`, { ...records.get(`${u}|${d}`), ...patch });
      },
      async fetchServerDay(date) {
        clock += 200;
        if (failure) throw failure;
        reads.push(`${name} ${date}`);
        const r = row(date);
        return hasModes ? { steps: r.steps, marker: r.marker } : { steps: r.steps };
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
    return { name, userId, deps, record: (date: string) => records.get(`${userId}|${date}`) };
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
    set: (date: string, steps: number) => rows.set(date, { ...row(date), steps }),
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
  /** Today at 23:30: the phone's live count above the store's (12,000 vs 11,000) — saved as the live tail. */
  async function liveTail(modes: boolean) {
    forgetServerObservations();
    const srv = fakeServer(modes, ist(D, '23:30'));
    const a = srv.phone('A');
    await saveDay(a.deps, a.userId, dayOf([hc(11_000), recording(12_000)]), true, { tz: IST });
    assert.equal(srv.steps(), 12_000);
    srv.advance(8.5 * H); // the next morning, 08:00
    return { srv, a };
  }
  /** The past day the next morning: the store caught up at 11,500, below the phone's 12,000. */
  const morning = () => dayOf([hc(11_500), recording(12_000, S, { complete: true })]);

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

describe('the old server (no `applied`, T39)', () => {
  test('never reconcile: the live tail stays above the store until the server has the modes', async () => {
    forgetServerObservations();
    const srv = fakeServer(false, ist(D, '23:30'));
    const a = srv.phone('A');
    await saveDay(a.deps, a.userId, dayOf([hc(11_000), recording(12_000)]), true, { tz: IST });
    assert.equal(a.record(D)?.serverModes, false);
    srv.advance(8.5 * H);
    assert.equal(await saveDay(a.deps, a.userId, dayOf([hc(11_500), recording(12_000, S, { complete: true })]), false, { tz: IST }), true);
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
