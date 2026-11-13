/// <reference types="node" />
/**
 * Where "Add to my calendar" puts ÖRZA's events on an iPhone and how a re-sync changes them
 * (`src/features/calendar/phoneTarget.ts`) — `npm run test:calendar`.
 *
 * TestFlight build 3 on a real iPhone: "Couldn't create the ÖRZA calendar…". Every `createCalendar` try threw: build 3
 * tried only the default calendar's account (Google / Outlook / Exchange accounts don't let apps add calendars), the
 * local source (hidden by iOS while iCloud Calendars is on) and "let iOS pick" (the default calendar's account again).
 *
 * - T1 permission: full access, iOS 17+ "Add Events Only", not asked, denied, blocked.
 * - T2 the accounts tried for the ÖRZA calendar: iCloud → On My iPhone → the default calendar's → other writable ones;
 *   never subscribed / birthdays / read-only ones.
 * - T3 own calendar or the default calendar; T3b what a sync clears first (lost map, another account's events,
 *   sign-out with "Add Events Only" and the same account adding again).
 * - T4 re-sync with full access (update, delete, history in the default calendar).
 * - T5 re-sync with "Add Events Only": only adds, never twice, counts what it can't fix; full access fixes it later.
 * - T6 ÖRZA's events found by their orza:// link or ÖRZA's words (map lost, full access only), the listing window,
 *   the default calendar's key.
 * - T7 the diagnostic line.
 * - T8 copy.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  accessFor,
  afterCreateFailed,
  decideTarget,
  DEFAULT_CALENDAR_KEY,
  DEFAULT_HISTORY_MS,
  defaultIsNew,
  describeAttempts,
  errorText,
  iosSourceOrder,
  isICloudSource,
  isOrzaEvent,
  isOrzaEventUrl,
  linkMode,
  listWindow,
  ORZA_REMINDER_NOTE,
  PHONE_CALENDAR_COPY,
  phonePermissionFrom,
  planCleanup,
  planSync,
  removeBlockedMessage,
  sourceLabel,
  upcomingCount,
  type SourceInfo,
  type SyncedEvent,
  type WantedEvent,
} from '../../src/features/calendar/phoneTarget';
import { PHONE_EVENT_COPY } from '../../src/features/calendar/phoneEvents';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-11-13T06:00:00.000Z');
const at = (ms: number) => new Date(NOW + ms).toISOString();

describe('T1 permission', () => {
  const full = (granted: boolean, status: string, canAskAgain: boolean) => ({ granted, status, canAskAgain });
  test('full access', () => {
    assert.equal(phonePermissionFrom(full(true, 'granted', true), true), 'granted');
    assert.equal(phonePermissionFrom(full(true, 'granted', false), false), 'granted');
  });
  test('"Add Events Only": expo-calendar reports it as denied for good on the full-access check', () => {
    assert.equal(phonePermissionFrom(full(false, 'denied', false), true), 'writeOnly');
  });
  test('not asked, denied, blocked', () => {
    assert.equal(phonePermissionFrom(full(false, 'undetermined', true), false), 'undetermined');
    assert.equal(phonePermissionFrom(full(false, 'denied', true), false), 'denied');
    assert.equal(phonePermissionFrom(full(false, 'denied', false), false), 'blocked');
  });
  test('what a sync may do', () => {
    assert.equal(accessFor('granted'), 'full');
    assert.equal(accessFor('writeOnly'), 'writeOnly');
    for (const p of ['undetermined', 'denied', 'blocked'] as const) assert.equal(accessFor(p), null);
  });
});

describe('T2 the accounts tried for the ÖRZA calendar', () => {
  const ICLOUD: SourceInfo = { id: 'src-icloud', type: 'caldav', name: 'iCloud' };
  const GMAIL: SourceInfo = { id: 'src-gmail', type: 'caldav', name: 'Gmail' };
  const LOCAL: SourceInfo = { id: 'src-local', type: 'local', name: 'Default' };
  const EXCHANGE: SourceInfo = { id: 'src-ex', type: 'exchange', name: 'Work' };
  const OUTLOOK: SourceInfo = { id: 'src-outlook', type: 'exchange', name: 'Outlook' };
  const SUBSCRIBED: SourceInfo = { id: 'src-sub', type: 'subscribed', name: 'Subscribed Calendars' };
  const BIRTHDAYS: SourceInfo = { id: 'src-bday', type: 'birthdays', name: 'Other' };
  const ids = (s: SourceInfo[]) => s.map((x) => x.id);

  test('build 3 failure: default calendar in Gmail, iCloud Calendars on (no local source) → iCloud first', () => {
    const order = iosSourceOrder(
      [GMAIL, ICLOUD, SUBSCRIBED, BIRTHDAYS],
      [
        { sourceId: 'src-gmail', allowsModifications: true },
        { sourceId: 'src-icloud', allowsModifications: true },
        { sourceId: 'src-sub', allowsModifications: false },
        { sourceId: 'src-bday', allowsModifications: false },
      ],
      'src-gmail'
    );
    assert.deepEqual(ids(order), ['src-icloud', 'src-gmail']);
  });
  test('iCloud Calendars off: On My iPhone before the default calendar\'s Google account', () => {
    assert.deepEqual(ids(iosSourceOrder([GMAIL, LOCAL], [{ sourceId: 'src-gmail', allowsModifications: true }], 'src-gmail')), ['src-local', 'src-gmail']);
  });
  test('iCloud → default → other writable accounts; read-only accounts are skipped', () => {
    const order = iosSourceOrder(
      [OUTLOOK, EXCHANGE, GMAIL, LOCAL, ICLOUD],
      [
        { sourceId: 'src-ex', allowsModifications: true },
        { sourceId: 'src-outlook', allowsModifications: false },
        { sourceId: 'src-gmail', allowsModifications: true },
      ],
      'src-gmail'
    );
    assert.deepEqual(ids(order), ['src-icloud', 'src-gmail', 'src-ex']);
  });
  test('iCloud Calendars on: the hidden local source is not tried (a calendar there may not show), unless it is in use', () => {
    // Listed by iOS but holding no calendar: skipped.
    assert.deepEqual(ids(iosSourceOrder([LOCAL, ICLOUD, GMAIL], [{ sourceId: 'src-gmail', allowsModifications: true }], 'src-gmail')), [
      'src-icloud',
      'src-gmail',
    ]);
    // It holds the default calendar, or another calendar ÖRZA may change: it shows, so it is tried.
    assert.deepEqual(ids(iosSourceOrder([LOCAL, ICLOUD], [{ sourceId: 'src-local', allowsModifications: true }], 'src-local')), ['src-icloud', 'src-local']);
    assert.deepEqual(
      ids(iosSourceOrder([LOCAL, ICLOUD, GMAIL], [{ sourceId: 'src-local', allowsModifications: true }, { sourceId: 'src-gmail', allowsModifications: true }], 'src-gmail')),
      ['src-icloud', 'src-gmail', 'src-local']
    );
  });
  test('no iCloud: On My iPhone right after it would have been, then the rest', () => {
    assert.deepEqual(ids(iosSourceOrder([EXCHANGE, LOCAL, GMAIL], [{ sourceId: 'src-ex', allowsModifications: true }], 'src-gmail')), [
      'src-local',
      'src-gmail',
      'src-ex',
    ]);
  });
  test('subscribed and birthday sources never take a calendar, even with a writable-looking calendar', () => {
    const order = iosSourceOrder(
      [SUBSCRIBED, BIRTHDAYS],
      [
        { sourceId: 'src-sub', allowsModifications: true },
        { sourceId: 'src-bday', allowsModifications: true },
      ],
      'src-sub'
    );
    assert.deepEqual(order, []);
  });
  test('each account once; the default calendar\'s account is tried even when the source list is missing', () => {
    assert.deepEqual(ids(iosSourceOrder([ICLOUD], [{ sourceId: 'src-icloud', allowsModifications: true }], 'src-icloud')), ['src-icloud']);
    assert.deepEqual(ids(iosSourceOrder([], [], 'src-gmail')), ['src-gmail']);
    assert.deepEqual(iosSourceOrder([], [], undefined), []);
  });
  test('iCloud is a CalDAV account named iCloud', () => {
    assert.ok(isICloudSource({ id: 'x', type: 'caldav', name: ' ICLOUD ' }));
    assert.ok(!isICloudSource({ id: 'x', type: 'caldav', name: 'Gmail' }));
    assert.ok(!isICloudSource({ id: 'x', type: 'local', name: 'iCloud' }));
  });
});

describe('T3 own calendar or the default calendar', () => {
  test('full access: the ÖRZA calendar (found, or a new one)', () => {
    assert.equal(decideTarget('full', null), 'own');
    assert.equal(decideTarget('full', { mode: 'own', mine: true }), 'own');
    assert.equal(decideTarget('full', { mode: 'own', mine: false }), 'own');
  });
  test("this account's events already in the default calendar stay there (any access)", () => {
    for (const access of ['full', 'writeOnly'] as const) assert.equal(decideTarget(access, { mode: 'default', mine: true }), 'default');
    assert.ok(!defaultIsNew({ mode: 'default', mine: true }));
  });
  test("another account's events in the default calendar: full access gets an ÖRZA calendar; \"Add Events Only\" starts fresh", () => {
    assert.equal(decideTarget('full', { mode: 'default', mine: false }), 'own');
    assert.equal(decideTarget('writeOnly', { mode: 'default', mine: false }), 'default');
    // Not "ÖRZA can't see what it added": this account added nothing there.
    assert.ok(defaultIsNew({ mode: 'default', mine: false }));
    assert.ok(defaultIsNew({ mode: 'own', mine: true }));
    assert.ok(defaultIsNew(null));
  });
  test('"Add Events Only": the default calendar', () => {
    assert.equal(decideTarget('writeOnly', null), 'default');
    assert.equal(decideTarget('writeOnly', { mode: 'own', mine: false }), 'default');
  });
  test('"Add Events Only" with this account\'s ÖRZA calendar: nothing written (every dose would show twice)', () => {
    assert.equal(decideTarget('writeOnly', { mode: 'own', mine: true }), 'ownNeedsFullAccess');
  });
  test('no account took the ÖRZA calendar', () => {
    assert.equal(afterCreateFailed('ios', true), 'default');
    assert.equal(afterCreateFailed('ios', false), 'fail');
    assert.equal(afterCreateFailed('android', true), 'fail');
  });
});

describe('T3b what a sync clears first (never twice, nothing left behind)', () => {
  const NONE = { deleteLeftover: false, wipeOwn: false, wipeMarked: false, refuse: false };
  test("this account's map of this target: nothing to clear (the diff does the rest)", () => {
    for (const target of ['own', 'default'] as const) {
      for (const access of ['full', 'writeOnly'] as const) {
        assert.deepEqual(planCleanup({ mine: true, created: false, target, access, leftover: null }), NONE);
      }
    }
  });
  test('a new ÖRZA calendar or a first add to the default calendar: nothing to clear', () => {
    assert.deepEqual(planCleanup({ mine: false, created: true, target: 'own', access: 'full', leftover: null }), NONE);
    assert.deepEqual(planCleanup({ mine: false, created: true, target: 'default', access: 'writeOnly', leftover: null }), NONE);
  });
  test('map lost: ÖRZA calendar wiped; default calendar: ÖRZA\'s events deleted (full access) or nothing added ("Add Events Only")', () => {
    assert.deepEqual(planCleanup({ mine: false, created: false, target: 'own', access: 'full', leftover: null }), { ...NONE, wipeOwn: true });
    assert.deepEqual(planCleanup({ mine: false, created: false, target: 'default', access: 'full', leftover: null }), { ...NONE, wipeMarked: true });
    assert.deepEqual(planCleanup({ mine: false, created: false, target: 'default', access: 'writeOnly', leftover: null }), { ...NONE, refuse: true });
  });
  test("another account's events in the default calendar: deleted with full access, wherever this sync writes", () => {
    assert.deepEqual(planCleanup({ mine: false, created: true, target: 'own', access: 'full', leftover: 'default' }), { ...NONE, deleteLeftover: true });
    assert.deepEqual(planCleanup({ mine: false, created: true, target: 'default', access: 'full', leftover: 'default' }), { ...NONE, deleteLeftover: true });
    assert.deepEqual(planCleanup({ mine: false, created: false, target: 'own', access: 'full', leftover: 'own' }), { ...NONE, wipeOwn: true });
  });
  test('"Add Events Only" never deletes, and adds fresh when this account has nothing there', () => {
    assert.deepEqual(planCleanup({ mine: false, created: true, target: 'default', access: 'writeOnly', leftover: 'default' }), NONE);
    assert.deepEqual(planCleanup({ mine: false, created: true, target: 'default', access: 'writeOnly', leftover: 'own' }), NONE);
  });
  test('sign-out with "Add Events Only", then the same account adds again: its kept map is diffed against, nothing twice', () => {
    // The kept link says this account's events are in the default calendar: not new, and the map is this account's.
    const stored = { mode: 'default' as const, mine: true };
    assert.equal(decideTarget('writeOnly', stored), 'default');
    assert.deepEqual(planCleanup({ mine: true, created: defaultIsNew(stored), target: 'default', access: 'writeOnly', leftover: null }), NONE);
    const known = { a: { id: 'e1', sig: 's', start: at(HOUR) } };
    const plan = planSync({ known, wanted: [{ key: 'a', sig: 's', start: at(HOUR) }], now: NOW, canEdit: false, historyMs: DEFAULT_HISTORY_MS });
    assert.deepEqual(plan.create, []);
  });
});

/** Apply a plan as deviceCalendar.ts does, with created / updated events getting new or the same ids. */
function apply(plan: ReturnType<typeof planSync>, wanted: WantedEvent[], idPrefix: string): Record<string, SyncedEvent> {
  const next = { ...plan.keep };
  for (const { key, have } of plan.update) {
    const w = wanted.find((x) => x.key === key)!;
    next[key] = { id: have.id, sig: w.sig, start: w.start };
  }
  for (const key of plan.create) {
    const w = wanted.find((x) => x.key === key)!;
    next[key] = { id: `${idPrefix}-${key}`, sig: w.sig, start: w.start };
  }
  return next;
}

describe('T4 re-sync with full access', () => {
  const known: Record<string, SyncedEvent> = {
    same: { id: 'e1', sig: 'a', start: at(2 * HOUR) },
    changed: { id: 'e2', sig: 'old', start: at(3 * HOUR) },
    stopped: { id: 'e3', sig: 'a', start: at(DAY) },
    past: { id: 'e4', sig: 'a', start: at(-2 * HOUR) },
    old: { id: 'e5', sig: 'a', start: at(-40 * DAY) },
  };
  const wanted: WantedEvent[] = [
    { key: 'same', sig: 'a', start: at(2 * HOUR) },
    { key: 'changed', sig: 'new', start: at(3 * HOUR) },
    { key: 'fresh', sig: 'a', start: at(5 * HOUR) },
  ];
  test('ÖRZA calendar: keep, update, create, delete upcoming stopped ones; past ones leave the map', () => {
    const plan = planSync({ known, wanted, now: NOW, canEdit: true, historyMs: 0 });
    assert.deepEqual(Object.keys(plan.keep), ['same']);
    assert.deepEqual(plan.update, [{ key: 'changed', have: known.changed }]);
    assert.deepEqual(plan.create, ['fresh']);
    assert.deepEqual(plan.remove, [known.stopped]);
    assert.equal(plan.stuck, 0);
  });
  test('default calendar: past events stay in the map for 31 days, so Remove deletes them too', () => {
    const plan = planSync({ known, wanted, now: NOW, canEdit: true, historyMs: DEFAULT_HISTORY_MS });
    assert.deepEqual(Object.keys(plan.keep).sort(), ['past', 'same']);
    assert.deepEqual(plan.remove, [known.stopped]);
    assert.equal(DEFAULT_HISTORY_MS, 31 * DAY);
  });
  test('a second sync with nothing changed writes nothing', () => {
    const first = planSync({ known, wanted, now: NOW, canEdit: true, historyMs: 0 });
    const map = apply(first, wanted, 'n');
    const again = planSync({ known: map, wanted, now: NOW, canEdit: true, historyMs: 0 });
    assert.deepEqual(again.create, []);
    assert.deepEqual(again.update, []);
    assert.deepEqual(again.remove, []);
  });
  test('the upcoming count leaves history out', () => {
    assert.equal(upcomingCount(known, NOW), 3);
    assert.equal(upcomingCount({}, NOW), 0);
  });
});

describe('T5 re-sync with "Add Events Only"', () => {
  const known: Record<string, SyncedEvent> = {
    same: { id: 'e1', sig: 'a', start: at(2 * HOUR) },
    changed: { id: 'e2', sig: 'old', start: at(3 * HOUR) },
    stopped: { id: 'e3', sig: 'a', start: at(DAY) },
    past: { id: 'e4', sig: 'a', start: at(-2 * HOUR) },
  };
  const wanted: WantedEvent[] = [
    { key: 'same', sig: 'a', start: at(2 * HOUR) },
    { key: 'changed', sig: 'new', start: at(3 * HOUR) },
    { key: 'fresh', sig: 'a', start: at(5 * HOUR) },
  ];
  const writeOnly = (k: Record<string, SyncedEvent>) => planSync({ known: k, wanted, now: NOW, canEdit: false, historyMs: DEFAULT_HISTORY_MS });

  test('never updates or deletes: only adds what it never added', () => {
    const plan = writeOnly(known);
    assert.deepEqual(plan.update, []);
    assert.deepEqual(plan.remove, []);
    assert.deepEqual(plan.create, ['fresh']);
  });
  test('changed and stopped upcoming events stay in the map (still on the phone) and count as out of date', () => {
    const plan = writeOnly(known);
    assert.deepEqual(plan.keep.changed, known.changed);
    assert.deepEqual(plan.keep.stopped, known.stopped);
    assert.equal(plan.stuck, 2);
  });
  test('never twice: a changed event is not written again, and a second sync adds nothing', () => {
    const plan = writeOnly(known);
    assert.ok(!plan.create.includes('changed'));
    const map = apply(plan, wanted, 'w');
    const again = writeOnly(map);
    assert.deepEqual(again.create, []);
    assert.equal(again.stuck, 2);
  });
  test('the same event twice in the source is created once', () => {
    const plan = planSync({ known: {}, wanted: [...wanted, wanted[2]], now: NOW, canEdit: false, historyMs: 0 });
    assert.deepEqual(plan.create, ['same', 'changed', 'fresh']);
  });
  test('first add: everything is created, nothing is out of date', () => {
    const plan = writeOnly({});
    assert.deepEqual(plan.create, ['same', 'changed', 'fresh']);
    assert.equal(plan.stuck, 0);
  });
  test('a stuck event that has passed is history, not out of date', () => {
    const plan = planSync({ known, wanted, now: NOW + 2 * DAY, canEdit: false, historyMs: DEFAULT_HISTORY_MS });
    assert.equal(plan.stuck, 0);
  });
  test('when full access comes back, the next sync fixes them', () => {
    const map = apply(writeOnly(known), wanted, 'w');
    const plan = planSync({ known: map, wanted, now: NOW, canEdit: true, historyMs: DEFAULT_HISTORY_MS });
    assert.deepEqual(plan.update.map((u) => u.key), ['changed']);
    assert.deepEqual(plan.remove.map((r) => r.id), ['e3']);
    assert.deepEqual(plan.create, []);
    assert.equal(plan.stuck, 0);
  });
});

describe('T6 ÖRZA events and the default calendar key', () => {
  test('only orza:// links are ÖRZA\'s', () => {
    assert.ok(isOrzaEventUrl('orza://alarm?med=med_1&at=2026-11-14T02:30:00.000Z'));
    assert.ok(isOrzaEventUrl('orza://reminders'));
    assert.ok(isOrzaEventUrl('ORZA://reminders'));
    for (const url of ['https://orza-nine.vercel.app/dashboard', 'notes orza://x', '', null, undefined]) assert.ok(!isOrzaEventUrl(url), String(url));
  });
  test("ÖRZA's events by what ÖRZA writes on them, when Google / Exchange dropped the link", () => {
    const dose = { url: null, title: PHONE_EVENT_COPY.iosMedicineTitle, notes: `Marked as taken in ÖRZA.\n${PHONE_EVENT_COPY.iosMedicineNote}\nhttps://x/dashboard/alarm` };
    assert.ok(isOrzaEvent(dose));
    assert.ok(isOrzaEvent({ url: undefined, title: '💧 Drink water', notes: `Stay hydrated\n${ORZA_REMINDER_NOTE}` }));
    assert.ok(isOrzaEvent({ url: 'orza://reminders', title: 'anything', notes: null }));
    assert.equal(ORZA_REMINDER_NOTE, 'A gentle nudge from ÖRZA.');
  });
  test("a member's own events are never ÖRZA's", () => {
    for (const ev of [
      { title: 'Dentist', notes: 'Bring the report', url: 'https://clinic.example/booking' },
      { title: '💊 Medicine time · ÖRZA', notes: 'my own copy' }, // the title alone isn't enough
      { title: 'Medicine time', notes: PHONE_EVENT_COPY.iosMedicineNote.slice(0, 20) },
      { title: null, notes: null, url: null },
      {},
    ]) {
      assert.ok(!isOrzaEvent(ev), JSON.stringify(ev));
    }
  });
  test('the listing window around the events to change or delete', () => {
    assert.equal(listWindow([]), null);
    assert.equal(listWindow([{ start: 'not a date' }]), null);
    assert.deepEqual(listWindow([{ start: at(5 * HOUR) }, { start: at(-2 * DAY) }, { start: 'x' }]), { from: NOW - 3 * DAY, to: NOW + 5 * HOUR + DAY });
  });
  test('the default calendar is never mistaken for ÖRZA\'s own', () => {
    assert.equal(linkMode({ calendarId: DEFAULT_CALENDAR_KEY }), 'default');
    assert.equal(linkMode({ calendarId: 'A1B2C3D4-0000-1111-2222-333344445555' }), 'own');
    assert.ok(!/^[0-9A-F-]{36}$/i.test(DEFAULT_CALENDAR_KEY));
  });
});

describe('T7 the diagnostic line (development logs only)', () => {
  test('one line with every try and its real error', () => {
    const line = describeAttempts([
      { source: sourceLabel({ id: '1', type: 'caldav', name: 'iCloud' }), error: errorText(new Error('That account does not allow calendars to be added or removed.')) },
      { source: sourceLabel({ id: '2', type: 'caldav', name: 'Gmail' }), error: errorText('nope') },
    ]);
    assert.equal(
      line,
      "couldn't create the ÖRZA calendar: iCloud (caldav): That account does not allow calendars to be added or removed. | Gmail (caldav): nope"
    );
    assert.ok(!line.includes('\n'));
  });
  test('no account to try; odd errors', () => {
    assert.equal(describeAttempts([]), "couldn't create the ÖRZA calendar: no calendar account to try");
    assert.equal(errorText({ code: 'E_X' }), '{"code":"E_X"}');
    assert.equal(sourceLabel({ id: '3', type: 'local', name: '' }), 'unnamed (local)');
  });
});

describe('T8 copy', () => {
  test('the iCloud guess is gone; each case says its real next step', () => {
    assert.equal(
      PHONE_CALENDAR_COPY.noCalendarIos,
      'Your iPhone has no calendar ÖRZA can add events to. Choose a default calendar in Settings › Apps › Calendar › Default Calendar (Settings › Calendar on iOS 17), then try again.'
    );
    assert.equal(
      PHONE_CALENDAR_COPY.ownNeedsFullAccess,
      "Calendar access for ÖRZA is “Add Events Only”, so ÖRZA can't update its calendar. To keep it up to date, tap Open Settings, then Calendars › Full Access."
    );
    assert.equal(
      PHONE_CALENDAR_COPY.writeOnlyUnknownEvents,
      "ÖRZA can't see the events it already added to your calendar, so it won't add them again (they could show twice). To fix it, tap Open Settings, then Calendars › Full Access, then tap Sync now."
    );
    // Access turned off (iOS asks only once): where to turn it back on.
    assert.equal(PHONE_CALENDAR_COPY.accessOffIos, 'Calendar access is off for ÖRZA. Tap Open Settings, then Calendars › Full Access, then come back.');
    assert.equal(
      PHONE_CALENDAR_COPY.accessOffLinkedIos,
      "Calendar access is off for ÖRZA, so new doses can't be added. Tap Open Settings, then Calendars › Full Access."
    );
    for (const text of [
      PHONE_CALENDAR_COPY.noCalendarIos,
      PHONE_CALENDAR_COPY.ownNeedsFullAccess,
      PHONE_CALENDAR_COPY.writeOnlyUnknownEvents,
      PHONE_CALENDAR_COPY.accessOffIos,
      PHONE_CALENDAR_COPY.accessOffLinkedIos,
    ]) {
      assert.ok(!text.includes('iCloud'), text);
    }
  });
  test('the card says where the events went', () => {
    // True both when no account took an ÖRZA calendar and after "Add Events Only" became full access.
    assert.equal(
      PHONE_CALENDAR_COPY.defaultCalendarNote('Home'),
      "ÖRZA's events are in your default calendar, “Home”, not in a calendar of their own. Remove deletes only ÖRZA's events."
    );
    assert.equal(
      PHONE_CALENDAR_COPY.defaultCalendarNote(undefined),
      "ÖRZA's events are in your default calendar, not in a calendar of their own. Remove deletes only ÖRZA's events."
    );
    assert.equal(
      PHONE_CALENDAR_COPY.writeOnlyBeforeAdd,
      "Calendar access for ÖRZA is “Add Events Only”, so the events go into your default calendar and ÖRZA can't change or remove them later. For events ÖRZA keeps up to date, tap Open Settings, then Calendars › Full Access."
    );
    assert.equal(
      PHONE_CALENDAR_COPY.writeOnlyLinked,
      "Calendar access for ÖRZA is “Add Events Only”: ÖRZA adds new events to your default calendar but can't change or remove the ones it added. For events ÖRZA keeps up to date, tap Open Settings, then Calendars › Full Access."
    );
    assert.equal(PHONE_CALENDAR_COPY.stuck(1), "1 of ÖRZA's events in your calendar is out of date (a dose or reminder changed or stopped).");
    assert.equal(PHONE_CALENDAR_COPY.stuck(3), "3 of ÖRZA's events in your calendar are out of date (a dose or reminder changed or stopped).");
    assert.equal(PHONE_CALENDAR_COPY.addedToDefault(1), 'Added 1 event to your default calendar.');
    assert.equal(PHONE_CALENDAR_COPY.addedToDefault(12), 'Added 12 events to your default calendar.');
  });
  test('Remove', () => {
    assert.equal(
      PHONE_CALENDAR_COPY.removeDefaultConfirm,
      "Remove ÖRZA's events from your calendar? Your own events, and your medicines and reminders in ÖRZA, stay as they are."
    );
    assert.equal(PHONE_CALENDAR_COPY.removeDefaultConfirmLabel, 'Remove events');
    assert.equal(PHONE_CALENDAR_COPY.removedFromDefault, "Removed ÖRZA's events from your calendar.");
    assert.equal(removeBlockedMessage('default', 'writeOnly'), PHONE_CALENDAR_COPY.removeDefaultNeedsFullAccess);
    assert.equal(removeBlockedMessage('default', 'blocked'), PHONE_CALENDAR_COPY.removeDefaultNeedsFullAccess);
    assert.equal(removeBlockedMessage('own', 'writeOnly'), PHONE_CALENDAR_COPY.removeOwnNeedsFullAccess);
    // Unchanged from build 3 for ÖRZA's own calendar without access.
    assert.equal(
      removeBlockedMessage('own', 'blocked'),
      'Allow calendar access for ÖRZA in Settings to remove its calendar, or delete the ÖRZA calendar in your Calendar app.'
    );
    assert.equal(
      PHONE_CALENDAR_COPY.removeDefaultNeedsFullAccess,
      'ÖRZA needs Full Access to remove the events it added: tap Open Settings, then Calendars › Full Access, and tap Remove again. Or delete them in your Calendar app.'
    );
    assert.equal(
      PHONE_CALENDAR_COPY.removeOwnNeedsFullAccess,
      'ÖRZA needs Full Access to remove its calendar: tap Open Settings, then Calendars › Full Access, and tap Remove again. Or delete the ÖRZA calendar in your Calendar app.'
    );
  });
});
