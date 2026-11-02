/// <reference types="node" />
/**
 * The step sync's consent gate and what it reads (`plan.ts`, `docs/notes/steps-v2.md` §2.1, §2.2, §2.7, P8, P9) —
 * `npm run test:steps` runs this file next to the other steps tests. Pure: `sync.ts` hands these the member's consent
 * records (the prefs, `store.ts`) and the phone's `StepsAccess` (the readers).
 *
 * T40 (the sync's part): OS permission granted but no consent for this member → no reads, no saves; the switch off →
 * reads stop; a consent withdrawn while a read was running → its readings are dropped. Also: what Today asks first
 * (§2.2: "Continue" before a system prompt, "Turn on" when the OS permission is already there), how far back the sync
 * reads (the sources ON), the shared phone's floor (M9) and the bases' instants the readers measure a count after (M5).
 * R6: what Today's answers record (`useSteps`: the consent a granted ask means, "Not now", the disclosure's backfill line).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  consentKindOf,
  fullBackfill,
  grantConsent,
  NOT_NOW_MS,
  notNowActive,
  readConsent,
  sinceAtOf,
  stepsAsk,
  stepsGate,
  stillAllowed,
} from '../../src/lib/steps/plan';
import type { DayRecord } from '../../src/lib/steps/policy';
import type { StepFeatures, StepsAccess, StepsConsent } from '../../src/lib/steps/types';

const t1 = Date.UTC(2026, 9, 20, 4, 0);
const t2 = Date.UTC(2026, 9, 25, 9, 30);

const android = (f: Partial<StepFeatures> = {}): StepFeatures => ({ platform: 'android', store: 'available', stepTracking: false, counter: true, ...f });
const iphone = (f: Partial<StepFeatures> = {}): StepFeatures => ({ platform: 'ios', store: 'available', counter: true, ...f });

/** The phone's access as a reader reports it: everything granted unless said otherwise. */
const access = (features: StepFeatures, a: Partial<StepsAccess> = {}): StepsAccess => ({
  phoneAvailable: features.counter,
  phonePermission: features.counter ? 'granted' : 'unavailable',
  firstAsk: features.platform === 'ios' ? 'healthkit' : features.stepTracking ? 'hc' : features.counter ? 'phone' : 'hc',
  store: features.store === 'available' ? 'granted' : features.store === 'installable' ? 'needs_install' : 'unavailable',
  recording: 'available',
  recordingReady: true,
  features,
  ...a,
});

const agreed = (c: Partial<StepsConsent>): StepsConsent => ({ sharedAtConsent: false, ...c });

describe('the member’s consent (T40, P8, P9)', () => {
  test('no record, or one without a consent in it → nothing may be read', () => {
    assert.equal(readConsent(undefined), null);
    assert.equal(readConsent(agreed({})), null);
    assert.equal(readConsent(agreed({ notNowUntil: t2, motionOffered: true })), null, '“Not now” and the motion offer are no consent');
  });

  test('each kind only with its own consent', () => {
    assert.deepEqual(readConsent(agreed({ store: { at: t1 } })), { store: true, phone: false });
    assert.deepEqual(readConsent(agreed({ phone: { at: t1 } })), { store: false, phone: true });
    assert.deepEqual(readConsent(agreed({ store: { at: t1 }, phone: { at: t2 } })), { store: true, phone: true });
  });

  test('the switch off → nothing, whatever was agreed; switched on again (no `off`) → the consents read again', () => {
    const on = agreed({ store: { at: t1 }, phone: { at: t1 } });
    assert.equal(readConsent({ ...on, off: { at: t2 } }), null);
    assert.deepEqual(readConsent(on), { store: true, phone: true });
  });

  test('a read made under a consent is kept only while every kind it read is still allowed', () => {
    const both = { store: true, phone: true };
    assert.equal(stillAllowed(both, both), true);
    assert.equal(stillAllowed({ store: false, phone: true }, both), true, 'more allowed since: still fine');
    assert.equal(stillAllowed(both, { store: false, phone: true }), false, 'Health disconnected meanwhile');
    assert.equal(stillAllowed(both, null), false, 'switched off meanwhile');
  });
});

describe('the gate: what the sync reads for a member (T40, §2.1, §2.6, M9)', () => {
  test('OS permission granted but no consent for this member → no gate: no reads, no saves', () => {
    const consents = grantConsent({}, 'amy', 'phone', t1);
    assert.equal(stepsGate(consents, 'ben', access(android())), null, 'Amy agreed on this phone, Ben didn’t');
    assert.notEqual(stepsGate(consents, 'amy', access(android())), null);
  });

  test('the switch off → no gate', () => {
    const consents: Record<string, StepsConsent> = { amy: agreed({ store: { at: t1 }, off: { at: t2 } }) };
    assert.equal(stepsGate(consents, 'amy', access(android())), null);
  });

  test('the sources ON follow the consent, the permission and the hardware; the lookback is the largest of theirs', () => {
    const store = { amy: agreed({ store: { at: t1 } }) };
    const g = stepsGate(store, 'amy', access(android()));
    assert.deepEqual(g?.consent, { store: true, phone: false });
    assert.deepEqual(g?.on, ['store'], 'Physical activity granted, but Amy agreed only to Health Connect');
    assert.equal(g?.maxBack, 30);
    assert.equal(g?.storeOn, true);

    const phone = { amy: agreed({ phone: { at: t1 } }) };
    assert.deepEqual(stepsGate(phone, 'amy', access(android()))?.on, ['recording']);
    assert.equal(stepsGate(phone, 'amy', access(android()))?.maxBack, 9);
    assert.deepEqual(stepsGate(phone, 'amy', access(android(), { recordingReady: false }))?.on, ['sampler']);
    assert.equal(stepsGate(phone, 'amy', access(android()))?.storeOn, false);
    assert.deepEqual(stepsGate(phone, 'amy', access(iphone()))?.on, ['pedometer']);
    assert.equal(stepsGate(phone, 'amy', access(iphone()))?.maxBack, 7);

    const both = { amy: agreed({ store: { at: t1 }, phone: { at: t1 } }) };
    assert.deepEqual(stepsGate(both, 'amy', access(android({ stepTracking: true })))?.on, ['store'], 'S-A3');
    assert.deepEqual(stepsGate(both, 'amy', access(android(), { store: 'not_granted' }))?.on, ['recording'], 'HC revoked: the phone alone');
    assert.deepEqual(stepsGate(both, 'amy', access(android(), { phonePermission: 'blocked' }))?.on, ['store']);
  });

  test('consent but nothing ON (the permission revoked) → the gate is open, nothing is read back', () => {
    const g = stepsGate({ amy: agreed({ phone: { at: t1 } }) }, 'amy', access(android(), { phonePermission: 'denied' }));
    assert.deepEqual(g?.on, []);
    assert.equal(g?.maxBack, 0);
  });

  test('the phone’s state unknown (access timed out) → today only; a store consent keeps past days from settling early', () => {
    const g = stepsGate({ amy: agreed({ store: { at: t1 }, phone: { at: t1 } }) }, 'amy', null);
    assert.deepEqual(g?.consent, { store: true, phone: true });
    assert.deepEqual(g?.on, []);
    assert.equal(g?.maxBack, 0);
    assert.equal(g?.storeOn, true);
    assert.equal(stepsGate({ amy: agreed({ phone: { at: t1 } }) }, 'amy', { phoneAvailable: true, phonePermission: 'granted' })?.maxBack, 0, 'no features: unknown');
  });

  test('M9: the first member on the install → a full backfill; a later one → from their consent', () => {
    const consents = grantConsent(grantConsent({}, 'amy', 'store', t1), 'ben', 'phone', t2);
    assert.equal(stepsGate(consents, 'amy', access(android()))?.coverFloor, null);
    assert.equal(stepsGate(consents, 'ben', access(android()))?.coverFloor, t2);
  });
});

describe('what Today asks (§2.2, §6)', () => {
  test('no consent, the OS permission not given yet → firstAsk, “Continue” (a system prompt follows)', () => {
    assert.deepEqual(stepsAsk(access(android({ stepTracking: true }), { store: 'not_granted' }), null), { kind: 'hc', granted: false });
    assert.deepEqual(stepsAsk(access(android(), { phonePermission: 'undetermined' }), null), { kind: 'phone', granted: false });
    assert.deepEqual(stepsAsk(access(android(), { phonePermission: 'blocked' }), null), { kind: 'phone', granted: false });
    assert.deepEqual(stepsAsk(access(iphone(), { store: 'not_granted' }), null), { kind: 'healthkit', granted: false });
  });

  test('the OS permission already granted (a second member, or after the switch was off) → “Turn on”', () => {
    assert.deepEqual(stepsAsk(access(android()), null), { kind: 'phone', granted: true });
    assert.deepEqual(stepsAsk(access(android({ stepTracking: true })), null), { kind: 'hc', granted: true });
    assert.deepEqual(stepsAsk(access(iphone()), null), { kind: 'healthkit', granted: true }, 'the StepCount sheet was answered');
  });

  test('something counting for the member → no ask; consent but nothing ON (permission revoked) → ask again', () => {
    const consents = { amy: agreed({ phone: { at: t1 } }) };
    const a = access(android());
    assert.equal(stepsAsk(a, stepsGate(consents, 'amy', a)), null);
    const revoked = access(android(), { phonePermission: 'denied' });
    assert.deepEqual(stepsAsk(revoked, stepsGate(consents, 'amy', revoked)), { kind: 'phone', granted: false });
  });

  test('nothing can count here, or the phone’s state isn’t known yet → no ask', () => {
    assert.equal(stepsAsk(access(android({ counter: false, store: 'unavailable' }), { firstAsk: 'none' }), null), null);
    assert.equal(stepsAsk(null, null), null);
    assert.equal(stepsAsk({ phoneAvailable: true, phonePermission: 'granted' }, null), null, 'no firstAsk reported');
  });
});

describe('the bases’ instants each source measures a count after (M5, S-R4)', () => {
  test('per date with a base: its `at`; dates without one are left out', () => {
    const recs: Record<string, DayRecord> = {
      '2026-10-25': { base: { kind: 'edit', steps: 9_000, at: t2, editRef: null }, server: 9_000 },
      '2026-10-24': { autoSent: 4_000 },
    };
    assert.deepEqual(sinceAtOf(['2026-10-25', '2026-10-24', '2026-10-23'], (d) => recs[d]), { '2026-10-25': t2 });
    assert.deepEqual(sinceAtOf(['2026-10-24'], (d) => recs[d]), {});
  });
});

describe('Today’s answers to the ask (R6: `useSteps`, §2.2, §6, P19, M9)', () => {
  test('a granted ask records the matching consent: Health Connect / Apple Health → the store; the phone’s counter → the phone', () => {
    assert.equal(consentKindOf('hc'), 'store');
    assert.equal(consentKindOf('healthkit'), 'store');
    assert.equal(consentKindOf('phone'), 'phone');
  });

  test('“Not now — I’ll log steps” folds the ask for 30 days, per member', () => {
    assert.equal(NOT_NOW_MS, 30 * 24 * 3_600_000);
    assert.equal(notNowActive(undefined, t1), false);
    assert.equal(notNowActive(agreed({}), t1), false, 'never said “Not now”');
    assert.equal(notNowActive(agreed({ notNowUntil: t1 + NOT_NOW_MS }), t1), true);
    assert.equal(notNowActive(agreed({ notNowUntil: t1 + NOT_NOW_MS }), t1 + NOT_NOW_MS), false, '30 days later: asked again');
  });

  test('M9, for the disclosure’s “Your steps from the last 30 days come in too”: the full backfill applies to the next consent?', () => {
    assert.equal(fullBackfill({}, 'amy'), true, 'the first member on the install');
    const amy = grantConsent({}, 'amy', 'store', t1);
    assert.equal(fullBackfill(amy, 'amy'), true, 'Amy adding the phone’s counter: still hers');
    assert.equal(fullBackfill(amy, 'ben'), false, 'Ben on Amy’s phone: from his consent only');
    const both = grantConsent(amy, 'ben', 'phone', t2);
    assert.equal(fullBackfill(both, 'ben'), false, 'Ben adding Health Connect: still a shared phone’s');
    assert.equal(fullBackfill({}, 'cat', true), false, 'a member who had agreed deleted their account');
    assert.equal(fullBackfill({ dan: agreed({ notNowUntil: t2 }) }, 'cat'), true, '“Not now” only is no consent');
    // The same rule as the consent it predicts.
    for (const [consents, id, former] of [
      [{}, 'amy', false],
      [amy, 'ben', false],
      [both, 'amy', false],
      [{}, 'cat', true],
    ] as const) {
      assert.equal(fullBackfill(consents, id, former), !grantConsent(consents, id, 'phone', t2, former)[id].sharedAtConsent);
    }
  });
});
