/// <reference types="node" />
/**
 * The steps store's files (`storeData.ts`, `docs/notes/steps-v2.md` §2.7, P16) — `npm run test:steps` runs this file
 * next to the other steps tests. Pure: `store.ts` keeps the files (expo-file-system) and hands their JSON to
 * `storeData.ts`, which these tests drive directly.
 *
 * T40 (the store's part): a member's day records go at sign-out, another member's stay; the prefs (consents, the
 * permission history) are not health data and stay in the backed-up documents folder, the day records go to the cache
 * folder; the v1 file keeps only its permission flags.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { addDays } from '../../src/lib/alarms/schedule';
import { grantConsent } from '../../src/lib/steps/plan';
import type { DayRecord } from '../../src/lib/steps/policy';
import {
  KEEP_DAYS,
  loadDays,
  loadPrefs,
  STEPS_FILES,
  withConsentPatch,
  withConsents,
  withDayRecord,
  withAutoSave,
  withHcGrant,
  withoutConsent,
  withoutUserDays,
  type StepsDays,
  type StepsPrefs,
} from '../../src/lib/steps/storeData';

const D = '2026-10-20';

/** The day records of `userId`, as the store would write them one by one. */
function daysOf(entries: [userId: string, date: string, rec: DayRecord][]): StepsDays {
  return entries.reduce((days, [u, d, r]) => withDayRecord(days, u, d, r), loadDays(null));
}

describe('where the files live (P16)', () => {
  test('day records in the cache folder (no backups, may be purged); prefs and the v1 file in documents', () => {
    assert.equal(STEPS_FILES.days.dir, 'cache');
    assert.equal(STEPS_FILES.prefs.dir, 'document');
    assert.equal(STEPS_FILES.legacy.dir, 'document');
    assert.equal(STEPS_FILES.legacy.name, 'orza-steps.json', 'the v1 file');
    assert.notEqual(STEPS_FILES.days.name, STEPS_FILES.legacy.name);
  });
});

describe('day records (T40: sign-out deletes the member’s)', () => {
  test('sign-out deletes that member’s day records; another member’s stay', () => {
    const days = daysOf([
      ['a', D, { autoSent: 9_000, server: 9_000 }],
      ['a', addDays(D, -1), { final: true }],
      ['b', D, { autoSent: 4_000 }],
    ]);
    const after = withoutUserDays(days, 'a');
    assert.equal(after.users.a, undefined);
    assert.deepEqual(after.users.b, { [D]: { autoSent: 4_000 } });
    assert.equal(withoutUserDays(after, 'nobody'), after, 'nothing to delete → unchanged');
  });

  test('a patch merges into the day’s record (undefined clears a field)', () => {
    let days = daysOf([['a', D, { autoSent: 9_000, autoAt: 1, server: 9_000 }]]);
    days = withDayRecord(days, 'a', D, { autoSent: undefined, server: 7_000 });
    assert.equal(days.users.a[D].autoSent, undefined);
    assert.equal(days.users.a[D].server, 7_000);
    assert.equal(days.users.a[D].autoAt, 1);
  });

  test(`kept ${KEEP_DAYS} days back from the member’s newest (the longest lookback is 30)`, () => {
    let days = loadDays(null);
    for (let i = 0; i <= 40; i++) days = withDayRecord(days, 'a', addDays(D, -i), { server: i });
    const dates = Object.keys(days.users.a).sort();
    assert.equal(dates.length, KEEP_DAYS + 1);
    assert.equal(dates[0], addDays(D, -KEEP_DAYS));
    assert.equal(dates[dates.length - 1], D);
    days = withDayRecord(days, 'b', addDays(D, -60), { server: 1 });
    assert.equal(Object.keys(days.users.a).length, KEEP_DAYS + 1, 'per member: another member’s old day changes nothing');
  });

  test('read back as written; a corrupt, old or unknown file → empty (the server is the record of truth)', () => {
    const days = daysOf([['a', D, { autoSent: 9_000, serverModes: true, tz: 'Asia/Kolkata', base: { kind: 'edit', steps: 8_000, at: 5, editRef: 'm' } }]]);
    assert.deepEqual(loadDays(JSON.parse(JSON.stringify(days))), days);
    for (const bad of [null, undefined, 'x', 42, [], {}, { version: 1, users: { a: { days: { [D]: { sent: 1 } } } } }, { version: 2, users: 'x' }]) {
      assert.deepEqual(loadDays(bad), { version: 2, users: {} }, JSON.stringify(bad));
    }
    assert.deepEqual(
      loadDays({ version: 2, users: { a: { [D]: { server: 1 }, 'not-a-date': { server: 2 }, '2026-10-19': 'x' }, b: 'x' } }),
      { version: 2, users: { a: { [D]: { server: 1 } } } },
      'malformed entries are dropped'
    );
  });
});

describe('prefs: consents, Health Connect’s first grant, the v1 file', () => {
  test('the v1 file: its Android permission flags move to the prefs; its day records are dropped', () => {
    const v1 = { version: 1, asked: true, blocked: true, users: { a: { days: { [D]: { sent: 9_000, base: { steps: 8_000, auto: 9_000 } } } } } };
    const { prefs, migrated } = loadPrefs(null, v1);
    assert.equal(migrated, true);
    assert.deepEqual(prefs, { version: 2, asked: true, blocked: true, consents: {} });
    assert.equal(JSON.stringify(prefs).includes('9000'), false, 'no step data in the prefs');
  });

  test('prefs already written win over a leftover v1 file; nothing at all → empty', () => {
    const written: StepsPrefs = { version: 2, asked: true, consents: { a: { store: { at: 5 }, sharedAtConsent: false } } };
    const { prefs, migrated } = loadPrefs(JSON.parse(JSON.stringify(written)), { version: 1, blocked: true, users: {} });
    assert.equal(migrated, false);
    assert.deepEqual(prefs, written);
    assert.deepEqual(loadPrefs(null, null), { prefs: { version: 2, consents: {} }, migrated: false });
    assert.deepEqual(loadPrefs('corrupt', 42), { prefs: { version: 2, consents: {} }, migrated: false });
  });

  test('read back as written (every field); malformed consent fields are dropped, never read as consent', () => {
    const prefs: StepsPrefs = {
      version: 2,
      asked: true,
      blocked: false,
      hcGrantAt: 1_700_000_000_000,
      hkBackground: true,
      formerConsent: true,
      consents: {
        a: { store: { at: 1 }, phone: { at: 2 }, off: { at: 3 }, notNowUntil: 4, motionOffered: true, sharedAtConsent: false },
        b: { phone: { at: 9 }, sharedAtConsent: true },
      },
      autoSavedAt: { a: 1_700_000_100_000 },
    };
    assert.deepEqual(loadPrefs(JSON.parse(JSON.stringify(prefs)), null).prefs, prefs);
    const odd = loadPrefs(
      { version: 2, hcGrantAt: 'soon', formerConsent: 'yes', consents: { a: { store: true, phone: { at: 'x' }, off: { at: 3 } }, b: 'yes' }, autoSavedAt: { a: 'x', b: 5 } },
      null
    ).prefs;
    assert.deepEqual(odd, { version: 2, consents: { a: { off: { at: 3 }, sharedAtConsent: false } }, autoSavedAt: { b: 5 } });
  });

  test('when this phone last saved a member’s steps automatically: kept through sign-out and a cache purge (a time, no steps)', () => {
    let prefs = withAutoSave(loadPrefs(null, null).prefs, 'a', 1_000);
    prefs = withAutoSave(prefs, 'b', 1_500);
    assert.deepEqual(prefs.autoSavedAt, { a: 1_000, b: 1_500 });
    assert.equal(withAutoSave(prefs, 'a', 900), prefs, 'never moves back');
    assert.equal(withAutoSave(prefs, 'a', Number.NaN), prefs);
    assert.deepEqual(withAutoSave(prefs, 'a', 2_000).autoSavedAt, { a: 2_000, b: 1_500 });
    // Sign-out deletes the day records only (`withoutUserDays`); account deletion removes this too.
    assert.deepEqual(withoutConsent(prefs, 'a').autoSavedAt, { b: 1_500 });
  });

  test('consent records per member: written with `plan.grantConsent`; account deletion removes only that member’s', () => {
    let prefs = loadPrefs(null, null).prefs;
    prefs = withConsents(prefs, grantConsent(prefs.consents, 'a', 'store', 10));
    prefs = withConsents(prefs, grantConsent(prefs.consents, 'b', 'phone', 20));
    assert.deepEqual(prefs.consents, { a: { store: { at: 10 }, sharedAtConsent: false }, b: { phone: { at: 20 }, sharedAtConsent: true } });
    // The switch and "Not now" sit in the same record; switched off, the member still agreed once.
    const off = withConsentPatch(prefs, 'a', { off: { at: 30 } });
    assert.deepEqual(off.consents.a, { store: { at: 10 }, off: { at: 30 }, sharedAtConsent: false });
    assert.deepEqual(withConsentPatch(off, 'a', { off: undefined }).consents.a, { store: { at: 10 }, sharedAtConsent: false }, 'switched back on');
    const notNow = withConsentPatch(prefs, 'c', { notNowUntil: 40 });
    assert.deepEqual(notNow.consents.c, { notNowUntil: 40, sharedAtConsent: false }, '“Not now” only: no consent in the record');
    assert.equal(grantConsent(notNow.consents, 'c', 'store', 50).c.sharedAtConsent, true, 'decided at the first consent');
    const left = withoutConsent(prefs, 'a');
    assert.deepEqual(left.consents, { b: { phone: { at: 20 }, sharedAtConsent: true } });
    assert.equal(withoutConsent(left, 'a'), left, 'nothing to remove → unchanged');
  });

  test('account deletion of a member who had agreed leaves the install flag: the next member’s first consent is a shared phone’s', () => {
    let prefs = loadPrefs(null, null).prefs;
    prefs = withConsents(prefs, grantConsent(prefs.consents, 'a', 'store', 10));
    const gone = withoutConsent(prefs, 'a');
    assert.deepEqual(gone.consents, {});
    assert.equal(gone.formerConsent, true);
    const c = grantConsent(gone.consents, 'c', 'store', 50, gone.formerConsent);
    assert.equal(c.c.sharedAtConsent, true, 'no backfill of the deleted member’s walking');
    // A member who never agreed ("Not now" only) leaves nothing behind.
    const notNow = withoutConsent(withConsentPatch(loadPrefs(null, null).prefs, 'd', { notNowUntil: 40 }), 'd');
    assert.equal(notNow.formerConsent, undefined);
  });

  test('S-H2: Health Connect’s first grant time is kept from the first time it was seen', () => {
    const prefs = withHcGrant(loadPrefs(null, null).prefs, 1_000);
    assert.equal(prefs.hcGrantAt, 1_000);
    assert.equal(withHcGrant(prefs, 2_000), prefs, 'a later sighting changes nothing');
    assert.equal(withHcGrant(prefs, Number.NaN), prefs);
  });
});
