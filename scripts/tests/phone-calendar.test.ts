/// <reference types="node" />
/**
 * Medicine doses in the phone's ÖRZA calendar (D3 decision D4; `src/features/calendar/phoneEvents.ts`) — `npm run
 * test:calendar`.
 *
 * - C1 iPhone: the calendar can sync to iCloud, so an event names no medicine and none of its details (strength,
 *   timing, person): the fixed title, the taken / skipped line, the way back into ÖRZA and the website link.
 * - C2 Android: unchanged (the calendar is under a local account): name and dose in the title, the details in the notes.
 * - C3 copy.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { PHONE_EVENT_COPY, medicineEventText } from '../../src/features/calendar/phoneEvents';

const LINK = 'https://orza-nine.vercel.app/dashboard/alarm?med=med_1&at=2026-11-14T02%3A30%3A00.000Z';
const DOSE = { title: 'Metformin', subtitle: '500 mg · After food · for Mom', status: 'upcoming' as const };

describe('C1 iPhone: no medicine name or details', () => {
  test('title and notes', () => {
    const t = medicineEventText(DOSE, 'ios', LINK);
    assert.equal(t.title, '💊 Medicine time · ÖRZA');
    assert.equal(t.notes, `Open ÖRZA to see which medicine it is and mark the dose.\n${LINK}`);
  });
  test('nothing from the medicine reaches the event', () => {
    for (const status of ['upcoming', 'due', 'taken', 'skipped', 'snoozed', 'missed'] as const) {
      const t = medicineEventText({ ...DOSE, status }, 'ios', LINK);
      for (const secret of ['Metformin', '500 mg', 'After food', 'Mom']) {
        assert.ok(!t.title.includes(secret), `${status} title: ${secret}`);
        assert.ok(!t.notes.includes(secret), `${status} notes: ${secret}`);
      }
    }
  });
  test('every dose has the same title, whatever the medicine', () => {
    assert.equal(medicineEventText({ title: 'Insulin glargine', subtitle: '10 units' }, 'ios', LINK).title, PHONE_EVENT_COPY.iosMedicineTitle);
    assert.equal(medicineEventText({ title: '' }, 'ios', LINK).title, PHONE_EVENT_COPY.iosMedicineTitle);
  });
  test('taken / skipped are still shown', () => {
    assert.equal(medicineEventText({ ...DOSE, status: 'taken' }, 'ios', LINK).notes.split('\n')[0], 'Marked as taken in ÖRZA.');
    assert.equal(medicineEventText({ ...DOSE, status: 'skipped' }, 'ios', LINK).notes.split('\n')[0], 'Marked as skipped in ÖRZA.');
  });
});

describe('C2 Android: unchanged', () => {
  test('name and dose in the title, details in the notes', () => {
    const t = medicineEventText(DOSE, 'android', LINK);
    assert.equal(t.title, '💊 Metformin — 500 mg');
    assert.equal(t.notes, `500 mg · After food · for Mom\nOpen ÖRZA to see the medicine's photos and mark the dose.\n${LINK}`);
  });
  test('taken, and a dose without details', () => {
    const t = medicineEventText({ title: 'Vitamin D3', status: 'taken' }, 'android', LINK);
    assert.equal(t.title, '💊 Vitamin D3');
    assert.equal(t.notes, `Marked as taken in ÖRZA.\nOpen ÖRZA to see the medicine's photos and mark the dose.\n${LINK}`);
  });
});

describe('C3 copy', () => {
  test('the iPhone card says why', () => {
    assert.equal(
      PHONE_EVENT_COPY.iosCardNote,
      'Medicine events say “Medicine time” without the medicine’s name, because your calendar can sync to iCloud. Open ÖRZA to see which medicine it is.'
    );
  });
});
