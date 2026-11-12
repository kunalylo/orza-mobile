/// <reference types="node" />
/**
 * "Count steps automatically" outside Today (`switchCard.ts`, `docs/notes/steps-v2.md` §6 "Health screen: the Steps
 * switch card", P9, P19, U3, U4) — `npm run test:steps` runs this file next to the other steps tests. Pure: the Health
 * screen's card and the Settings › Privacy & data row hand it `useTodaySteps()`'s state and render what it returns.
 *
 * - The switch is on only while the member agreed on this install and hasn't switched it off; the subtitle names what
 *   counts (§6).
 * - Turning it on: the member's consents count again (`resume`), or — never agreed — Today's ask (its disclosure,
 *   Settings, Health Connect, Play), whatever "Not now" folded on Today (P19: the switch keeps the way back).
 * - On with nothing counting (a permission taken away since): what gets it counting again.
 * - The off sheet (§6) and its platform note; the "both ways" line by platform.
 * - Counting from Health Connect without its background reading: the way to allow it (V2 B1).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { CountingSource, StepsAskState } from '../../src/lib/steps/plan';
import { bothWaysLine, offSheet, switchView, type SwitchInputs } from '../../src/lib/steps/switchCard';
import type { StepFeatures, StepsAccess } from '../../src/lib/steps/types';

const ANDROID_14: StepFeatures = { platform: 'android', store: 'available', stepTracking: true, counter: true };
const ANDROID_13: StepFeatures = { platform: 'android', store: 'available', stepTracking: false, counter: true };
const ANDROID_NO_COUNTER: StepFeatures = { platform: 'android', store: 'available', stepTracking: false, counter: false };
const IPHONE: StepFeatures = { platform: 'ios', store: 'available', counter: true };

function access(features: StepFeatures, patch: Partial<StepsAccess> = {}): StepsAccess {
  return {
    phoneAvailable: features.counter,
    phonePermission: features.counter ? 'undetermined' : 'unavailable',
    firstAsk: features.platform === 'ios' ? 'healthkit' : features.stepTracking ? 'hc' : features.counter ? 'phone' : 'hc',
    store: features.store === 'installable' ? 'needs_install' : features.store === 'available' ? 'not_granted' : 'unavailable',
    recording: features.platform === 'android' ? 'available' : undefined,
    features,
    ...patch,
  };
}

function inputs(patch: Partial<SwitchInputs> = {}): SwitchInputs {
  const a = patch.access === undefined ? access(ANDROID_14) : patch.access;
  return {
    platform: a?.features?.platform ?? 'android',
    on: true,
    agreed: false,
    sources: [],
    access: a,
    ask: null,
    hcRefused: false,
    ...patch,
  };
}

const ask = (kind: StepsAskState['kind'], granted = false): StepsAskState => ({ kind, granted });
const on = (...s: CountingSource[]) => s;

describe('what counts: the switch on, the subtitle by source (§6)', () => {
  test('Health Connect counting this phone (14+): "From Health Connect — this phone and your watch"', () => {
    const v = switchView(inputs({ agreed: true, sources: on('store') }));
    assert.equal(v.state, 'counting');
    assert.equal(v.checked, true);
    assert.equal(v.enabled, true);
    assert.equal(v.subtitle, 'From Health Connect — this phone and your watch');
    assert.deepEqual([v.fix, v.motion, v.background], [null, null, null]);
  });

  test('Android 9–13: Health Connect beside the phone\'s own count keeps §6\'s line; Health Connect alone names the watch and apps', () => {
    const both = switchView(inputs({ access: access(ANDROID_13), agreed: true, sources: on('store', 'recording') }));
    assert.equal(both.subtitle, 'From Health Connect — this phone and your watch');
    const alone = switchView(inputs({ access: access(ANDROID_NO_COUNTER), agreed: true, sources: on('store') }));
    assert.equal(alone.subtitle, 'From Health Connect — your watch and fitness apps');
  });

  test('the phone\'s own counter (Recording API or the sampler): "Counted by this phone"', () => {
    for (const s of ['recording', 'sampler'] as const) {
      assert.equal(switchView(inputs({ access: access(ANDROID_13), agreed: true, sources: on(s) })).subtitle, 'Counted by this phone', s);
    }
  });

  test('iPhone: Apple Health, the motion sensor, or both', () => {
    const a = access(IPHONE);
    assert.equal(switchView(inputs({ access: a, agreed: true, sources: on('store') })).subtitle, 'From Apple Health');
    assert.equal(switchView(inputs({ access: a, agreed: true, sources: on('pedometer') })).subtitle, 'Counted by your iPhone’s motion sensor');
    assert.equal(switchView(inputs({ access: a, agreed: true, sources: on('store', 'pedometer') })).subtitle, 'From Apple Health and your iPhone’s motion sensor');
  });
});

describe('off, and turning it back on (P9)', () => {
  test('switched off: "Off — you log steps yourself"; on again = the member\'s consents count again', () => {
    const v = switchView(inputs({ on: false, agreed: true, ask: ask('hc', true) }));
    assert.equal(v.state, 'off');
    assert.equal(v.checked, false);
    assert.equal(v.enabled, true);
    assert.equal(v.subtitle, 'Off — you log steps yourself');
    assert.deepEqual(v.turnOn, { type: 'resume' });
  });

  test('a published reading that lingers after the switch went off never shows as counting', () => {
    const v = switchView(inputs({ on: false, agreed: true, sources: on('store') }));
    assert.equal(v.state, 'off');
    assert.equal(v.checked, false);
  });

  test('off before ever agreeing: on = Today\'s ask (its disclosure), not a bare resume', () => {
    const v = switchView(inputs({ on: false, agreed: false, ask: ask('hc') }));
    assert.equal(v.state, 'off');
    assert.deepEqual(v.turnOn, { type: 'sheet', sheet: { kind: 'hc', path: 'hc', variant: 'continue' } });
  });
});

describe('never agreed on this install: the switch is the way in (P19: "Not now" on Today doesn\'t hide it)', () => {
  test('a fresh phone: off-looking, "Not on yet", on = the disclosure with "Continue"', () => {
    const v = switchView(inputs({ ask: ask('hc') }));
    assert.equal(v.state, 'setup');
    assert.equal(v.checked, false);
    assert.equal(v.enabled, true);
    assert.equal(v.subtitle, 'Not on yet — you log steps yourself');
    assert.deepEqual(v.turnOn, { type: 'sheet', sheet: { kind: 'hc', path: 'hc', variant: 'continue' } });
  });

  test('the permission is already there (another member): "Turn on" — a consent screen', () => {
    const v = switchView(inputs({ access: access(ANDROID_13, { phonePermission: 'granted' }), ask: ask('phone', true) }));
    assert.deepEqual(v.turnOn, { type: 'sheet', sheet: { kind: 'phone', path: 'phone', variant: 'turn_on' } });
    const ios = switchView(inputs({ access: access(IPHONE, { store: 'granted' }), ask: ask('healthkit', true) }));
    assert.deepEqual(ios.turnOn, { type: 'sheet', sheet: { kind: 'healthkit', path: 'healthkit', variant: 'turn_on' } });
  });

  test('after a Health Connect refusal: Health Connect\'s own page, and the phone\'s motion sensor beside it', () => {
    const v = switchView(inputs({ ask: ask('hc'), hcRefused: true }));
    assert.deepEqual(v.turnOn, { type: 'store_settings' });
    assert.deepEqual(v.motion, { type: 'sheet', sheet: { kind: 'phone', path: 'phone', variant: 'continue', fallback: true } });
  });

  test('Physical activity refused for good: Settings; Health Connect not installed: Play', () => {
    const blocked = switchView(inputs({ access: access(ANDROID_13, { phonePermission: 'blocked' }), ask: ask('phone') }));
    assert.deepEqual(blocked.turnOn, { type: 'settings' });
    const f: StepFeatures = { platform: 'android', store: 'installable', stepTracking: false, counter: false };
    const install = switchView(inputs({ access: access(f), ask: ask('hc') }));
    assert.deepEqual(install.turnOn, { type: 'store_install' });
  });

  test('the phone\'s state not known yet (no ask): switching on only clears the switch — Today asks once it knows', () => {
    const v = switchView(inputs({ access: null }));
    assert.equal(v.state, 'setup');
    assert.deepEqual(v.turnOn, { type: 'resume' });
  });
});

describe('on, agreed, but nothing counts', () => {
  test('the phone\'s state is still being checked: on, "checking"', () => {
    const v = switchView(inputs({ agreed: true, access: null }));
    assert.equal(v.state, 'checking');
    assert.equal(v.checked, true);
    assert.equal(v.subtitle, 'On — checking this phone…');
    assert.equal(v.fix, null);
  });

  test('a permission taken away since: on, says so, and offers what gets it counting again', () => {
    const v = switchView(inputs({ access: access(ANDROID_13, { phonePermission: 'blocked' }), agreed: true, ask: ask('phone') }));
    assert.equal(v.state, 'stopped');
    assert.equal(v.checked, true);
    assert.equal(v.subtitle, 'On — but ÖRZA can’t read your steps right now');
    assert.deepEqual(v.fix, { type: 'settings' });
    const hc = switchView(inputs({ agreed: true, ask: ask('hc'), hcRefused: true }));
    assert.deepEqual(hc.fix, { type: 'store_settings' });
    assert.deepEqual(hc.motion, { type: 'sheet', sheet: { kind: 'phone', path: 'phone', variant: 'continue', fallback: true } });
  });
});

describe('nothing can count here', () => {
  test('no step counter and no Health Connect: the switch can\'t be used', () => {
    const f: StepFeatures = { platform: 'android', store: 'unavailable', stepTracking: false, counter: false };
    const v = switchView(inputs({ access: access(f, { firstAsk: 'none' }) }));
    assert.equal(v.state, 'none');
    assert.equal(v.enabled, false);
    assert.equal(v.checked, false);
    assert.equal(v.turnOn, null);
    assert.equal(v.subtitle, 'This phone can’t count steps — log them on Today');
  });

  test('not a phone (the web build): the switch can\'t be used either', () => {
    const v = switchView(inputs({ platform: 'none', access: { phoneAvailable: false, phonePermission: 'unavailable' } }));
    assert.equal(v.state, 'unsupported');
    assert.equal(v.enabled, false);
    assert.equal(v.subtitle, 'Steps count by themselves in the ÖRZA phone app');
  });
});

describe('the off sheet (§6)', () => {
  const TITLE = 'Stop counting steps automatically?';
  const BODY = 'ÖRZA stops reading steps on this phone. Steps already saved stay in your account.';

  test('Android with Health Connect counting this phone: §6\'s note and "Open Health Connect"', () => {
    const s = offSheet('android', on('store'), access(ANDROID_14, { store: 'granted' }));
    assert.equal(s.title, TITLE);
    assert.equal(s.body, BODY);
    assert.equal(
      s.note,
      'Health Connect may keep counting this phone’s steps for other apps. To remove ÖRZA’s access, open Health Connect › App permissions › ÖRZA.'
    );
    assert.equal(s.open, 'store_settings');
  });

  test('Android 9–13 with Health Connect: no claim that it counts this phone', () => {
    const s = offSheet('android', on('store', 'recording'), access(ANDROID_13, { store: 'granted', phonePermission: 'granted' }));
    assert.equal(s.note, 'To remove ÖRZA’s access, open Health Connect › App permissions › ÖRZA.');
    assert.equal(s.open, 'store_settings');
  });

  test('Android with only the phone counting: Physical activity in Settings', () => {
    const s = offSheet('android', on('recording'), access(ANDROID_13, { phonePermission: 'granted' }));
    assert.equal(s.note, 'To remove ÖRZA’s access, turn off Physical activity in Settings › Apps › ÖRZA › Permissions.');
    assert.equal(s.open, 'settings');
  });

  test('iPhone: §6\'s Health path (no button); Motion & Fitness in ÖRZA\'s Settings when the motion sensor counts', () => {
    const a = access(IPHONE, { store: 'granted' });
    const store = offSheet('ios', on('store'), a);
    assert.equal(store.note, 'To remove ÖRZA’s access, open Settings › Health › Data Access & Devices › ÖRZA.');
    assert.equal(store.open, null);
    const both = offSheet('ios', on('store', 'pedometer'), a);
    assert.equal(both.note, 'To remove ÖRZA’s access, open Settings › Health › Data Access & Devices › ÖRZA, and turn off Motion & Fitness in Settings › ÖRZA.');
    assert.equal(both.open, 'settings');
    const motion = offSheet('ios', on('pedometer'), access(IPHONE, { phonePermission: 'granted' }));
    assert.equal(motion.note, 'To remove ÖRZA’s access, turn off Motion & Fitness in Settings › ÖRZA.');
    assert.equal(motion.open, 'settings');
  });

  test('nothing granted (the phone\'s state unknown): no note', () => {
    const s = offSheet('android', [], null);
    assert.equal(s.note, null);
    assert.equal(s.open, null);
  });
});

describe('Health Connect counting without background reading (V2 B1: connected from the Health screen before it asked)', () => {
  const granted = (storeBackground: StepsAccess['storeBackground']) => access(ANDROID_14, { store: 'granted', storeBackground });

  test('READ_STEPS without background: "Allow background access" (Health Connect’s background screen)', () => {
    const v = switchView(inputs({ access: granted('not_granted'), agreed: true, sources: on('store') }));
    assert.equal(v.state, 'counting');
    assert.equal(v.background, 'ask');
  });

  test('refused on this visit: Health Connect’s own page instead (its screen may not show again)', () => {
    const v = switchView(inputs({ access: granted('not_granted'), agreed: true, sources: on('store'), backgroundRefused: true }));
    assert.equal(v.background, 'store_settings');
  });

  test('nothing to offer: granted, not offered by this Health Connect, unknown (older reader), or Health Connect not counting', () => {
    for (const b of ['granted', 'unavailable', undefined] as const) {
      assert.equal(switchView(inputs({ access: granted(b), agreed: true, sources: on('store') })).background, null, String(b));
    }
    const phone = access(ANDROID_13, { store: 'granted', storeBackground: 'not_granted', phonePermission: 'granted' });
    assert.equal(switchView(inputs({ access: phone, agreed: true, sources: on('recording') })).background, null, 'the phone counts');
    assert.equal(switchView(inputs({ access: granted('not_granted'), on: false, agreed: true })).background, null, 'switched off');
    const ios = access(IPHONE, { store: 'granted', storeBackground: 'not_granted' });
    assert.equal(switchView(inputs({ access: ios, agreed: true, sources: on('store') })).background, null, 'iPhone');
  });
});

describe('the "both ways" line (§6, §2.8)', () => {
  test('Android 14+ with Health Connect counting: the phone\'s steps are in Health Connect, no second copy', () => {
    assert.equal(
      bothWaysLine('android', ANDROID_14, on('store')),
      'Your phone’s steps are in Health Connect, so other health apps you allow see them too. ÖRZA doesn’t add a second copy.'
    );
  });

  test('Android 9–13 with Health Connect on, or nothing counting yet: what ÖRZA reads through Health Connect', () => {
    const line = 'ÖRZA reads steps that Samsung Health, Fitbit and others share through Health Connect.';
    assert.equal(bothWaysLine('android', ANDROID_13, on('store', 'recording')), line);
    assert.equal(bothWaysLine('android', ANDROID_13, on('store')), line);
    assert.equal(bothWaysLine('android', undefined, []), line);
  });

  test('the phone’s own counter without Health Connect (V2 F2: 14+ with Health Connect refused): no Health Connect claim', () => {
    const line = 'ÖRZA counts this phone’s steps itself and doesn’t share them with other health apps.';
    assert.equal(bothWaysLine('android', ANDROID_14, on('recording')), line);
    assert.equal(bothWaysLine('android', ANDROID_14, on('sampler')), line);
    assert.equal(bothWaysLine('android', ANDROID_13, on('recording')), line);
  });

  test('iPhone: the iPhone already saves its steps to Apple Health; not a phone: none', () => {
    assert.equal(
      bothWaysLine('ios', IPHONE, []),
      'Your iPhone already saves its steps to Apple Health for every app you allow. ÖRZA reads them and never writes a second copy.'
    );
    assert.equal(bothWaysLine('none', undefined, []), null);
  });
});
