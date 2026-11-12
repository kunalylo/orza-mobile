/// <reference types="node" />
/**
 * What Today's steps card offers (`todayCard.ts`, `docs/notes/steps-v2.md` §2.2, §6, P6, P7, P19, U1, U2) — `npm run
 * test:steps` runs this file next to the other steps tests. Pure: `StepsCard.tsx` hands it `useTodaySteps()`'s state
 * and renders what it returns.
 *
 * - P7: "Log steps" whenever nothing counts today (`manual = !countingToday`), whatever the permission state.
 * - P6: the disclosure sheet has one button — "Continue" before a system prompt, "Turn on" when the OS permission is
 *   already there (a consent screen only).
 * - P19: "Not now — I'll log steps" after a refusal (and on a "Turn on" ask); never on a fresh first ask.
 * - §2.2: Android after a Health Connect refusal → "Open Health Connect" + "Use this phone's motion sensor instead";
 *   Android with the phone counting on a phone where Health Connect doesn't count it → "Include your watch or fitness
 *   app"; iPhone with Apple Health empty → "Use iPhone motion instead", once.
 * - §6: the disclosure's exact points and captions by path.
 * - U5: Health Connect origin labels ("From Samsung Health"), the time-zone mismatch hint.
 * - V2 real phone: the motion button once it opens Settings (B2); the "Counting since…" line by why counting starts
 *   late (F3).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { CountingSource, StepsAskState } from '../../src/lib/steps/plan';
import {
  disclosureCopy,
  motionButtonCopy,
  originLabel,
  partialDayLine,
  todayCard,
  zoneHint,
  type CardInputs,
  type PartialDayInputs,
} from '../../src/lib/steps/todayCard';
import type { StepFeatures, StepsAccess } from '../../src/lib/steps/types';

const ANDROID_14: StepFeatures = { platform: 'android', store: 'available', stepTracking: true, counter: true };
const ANDROID_13: StepFeatures = { platform: 'android', store: 'available', stepTracking: false, counter: true };
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

function inputs(patch: Partial<CardInputs> = {}): CardInputs {
  const a = patch.access === undefined ? access(ANDROID_14) : patch.access;
  return {
    platform: a?.features?.platform ?? 'android',
    isToday: true,
    access: a,
    busy: false,
    ask: null,
    askFolded: false,
    sources: [],
    countingToday: false,
    healthEmpty: false,
    motionOffered: false,
    hcRefused: false,
    ...patch,
  };
}

const ask = (kind: StepsAskState['kind'], granted = false): StepsAskState => ({ kind, granted });
const on = (...s: CountingSource[]) => s;

describe('the first check and the plain states', () => {
  test('before the first check (a read running, access unknown): no buttons yet — no flicker from Log to Edit', () => {
    const c = todayCard(inputs({ access: null, busy: true }));
    assert.equal(c.state, 'checking');
    assert.deepEqual([c.log, c.edit, c.cta, c.motion, c.watch, c.notNow], [false, false, null, null, null, false]);
  });

  test('access unknown and nothing running (the check timed out): "Log steps" (P7)', () => {
    const c = todayCard(inputs({ access: null }));
    assert.equal(c.state, 'unknown');
    assert.equal(c.log, true);
    assert.equal(c.cta, null);
  });

  test('nothing can count on this phone (no counter, no Health Connect): "Log steps" only', () => {
    const f: StepFeatures = { platform: 'android', store: 'unavailable', stepTracking: false, counter: false };
    const c = todayCard(inputs({ access: access(f, { firstAsk: 'none' }) }));
    assert.equal(c.state, 'none');
    assert.equal(c.log, true);
    assert.equal(c.cta, null);
    assert.equal(todayCard(inputs({ platform: 'none', access: { phoneAvailable: false, phonePermission: 'unavailable' } })).state, 'none');
  });

  test('counting today: "Edit", no "Log steps", no ask', () => {
    const c = todayCard(inputs({ sources: on('store'), countingToday: true }));
    assert.equal(c.state, 'counting');
    assert.deepEqual([c.log, c.edit, c.cta, c.notNow], [false, true, null, false]);
  });

  test('a source is ON but has nothing today yet (Health Connect 0 → no reading): "Not counted yet" + "Log steps" (E-1, P7)', () => {
    const c = todayCard(inputs({ sources: on('store') }));
    assert.equal(c.state, 'waiting');
    assert.deepEqual([c.log, c.edit, c.cta], [true, false, null]);
  });

  test('a past day: "Edit" while something counts for the member, else "Log steps"; never an ask', () => {
    const past = todayCard(inputs({ isToday: false, sources: on('recording'), ask: null }));
    assert.deepEqual([past.log, past.edit, past.cta, past.watch], [false, true, null, null]);
    const manual = todayCard(inputs({ isToday: false, ask: ask('hc') }));
    assert.deepEqual([manual.log, manual.edit, manual.cta, manual.notNow], [true, false, null, false]);
    assert.deepEqual([todayCard(inputs({ isToday: false, access: null, busy: true })).log, todayCard(inputs({ isToday: false, access: null, busy: true })).edit], [false, false]);
  });
});

describe('Android: Health Connect first (14+, extension 20 — P20)', () => {
  test('a fresh ask: "Continue" before Health Connect\'s sheet, "Log steps" beside it (P7), no "Not now" yet', () => {
    const c = todayCard(inputs({ ask: ask('hc') }));
    assert.equal(c.state, 'asking');
    assert.deepEqual(c.cta, { type: 'sheet', sheet: { kind: 'hc', path: 'hc', variant: 'continue' } });
    assert.deepEqual([c.log, c.notNow, c.motion], [true, false, null]);
  });

  test('Steps already granted (a second member, the switch was off): the consent sheet with "Turn on" + "Not now"', () => {
    const c = todayCard(inputs({ ask: ask('hc', true), access: access(ANDROID_14, { store: 'granted' }) }));
    assert.deepEqual(c.cta, { type: 'sheet', sheet: { kind: 'hc', path: 'hc', variant: 'turn_on' } });
    assert.equal(c.notNow, true);
  });

  test('after a refusal: "Open Health Connect", "Use this phone\'s motion sensor instead" (never chained), "Not now"', () => {
    const c = todayCard(inputs({ ask: ask('hc'), hcRefused: true }));
    assert.deepEqual(c.cta, { type: 'store_settings' });
    assert.deepEqual(c.motion, { type: 'sheet', sheet: { kind: 'phone', path: 'phone', variant: 'continue', fallback: true } });
    assert.deepEqual([c.log, c.notNow], [true, true]);
  });

  test('the motion fallback follows Physical activity: already allowed → "Turn on"; blocked → Settings; no counter → none', () => {
    const granted = todayCard(inputs({ ask: ask('hc'), hcRefused: true, access: access(ANDROID_14, { phonePermission: 'granted' }) }));
    assert.deepEqual(granted.motion, { type: 'sheet', sheet: { kind: 'phone', path: 'phone', variant: 'turn_on', fallback: true } });
    const blocked = todayCard(inputs({ ask: ask('hc'), hcRefused: true, access: access(ANDROID_14, { phonePermission: 'blocked' }) }));
    assert.deepEqual(blocked.motion, { type: 'settings' });
    const noCounter: StepFeatures = { platform: 'android', store: 'available', stepTracking: false, counter: false };
    assert.equal(todayCard(inputs({ ask: ask('hc'), hcRefused: true, access: access(noCounter) })).motion, null);
  });

  test('a refusal noted earlier no longer counts once Steps is granted (the ask turns into "Turn on")', () => {
    const c = todayCard(inputs({ ask: ask('hc', true), hcRefused: true, access: access(ANDROID_14, { store: 'granted' }) }));
    assert.equal(c.cta?.type, 'sheet');
    assert.equal(c.motion, null);
  });

  test('"Not now" folds the ask: no ask, no motion button, "Log steps" stays (P19)', () => {
    const c = todayCard(inputs({ ask: ask('hc'), hcRefused: true, askFolded: true }));
    assert.equal(c.state, 'folded');
    assert.deepEqual([c.cta, c.motion, c.notNow, c.log], [null, null, false, true]);
  });
});

describe('Android: Physical activity first (9–13, or 14 without extension 20)', () => {
  test('a fresh ask: "Continue" before the Physical activity prompt (Recording API copy), no "Not now"', () => {
    const c = todayCard(inputs({ ask: ask('phone'), access: access(ANDROID_13) }));
    assert.deepEqual(c.cta, { type: 'sheet', sheet: { kind: 'phone', path: 'phone', variant: 'continue' } });
    assert.equal(c.notNow, false);
  });

  test('without Play services\' Recording API (the sampler counts): the sampler\'s copy', () => {
    for (const recording of ['missing', 'disabled', 'update_required', 'unavailable'] as const) {
      const c = todayCard(inputs({ ask: ask('phone'), access: access(ANDROID_13, { recording }) }));
      assert.deepEqual(c.cta, { type: 'sheet', sheet: { kind: 'phone', path: 'phone_sampler', variant: 'continue' } }, recording);
    }
  });

  test('refused once (the system asks again): "Continue" again + "Not now"; refused for good: "Open Settings" + "Not now"', () => {
    const denied = todayCard(inputs({ ask: ask('phone'), access: access(ANDROID_13, { phonePermission: 'denied' }) }));
    assert.equal(denied.cta?.type, 'sheet');
    assert.equal(denied.notNow, true);
    const blocked = todayCard(inputs({ ask: ask('phone'), access: access(ANDROID_13, { phonePermission: 'blocked' }) }));
    assert.deepEqual(blocked.cta, { type: 'settings' });
    assert.deepEqual([blocked.notNow, blocked.log], [true, true]);
  });

  test('already allowed (another member, or below Android 10): "Turn on" + "Not now"', () => {
    const c = todayCard(inputs({ ask: ask('phone', true), access: access(ANDROID_13, { phonePermission: 'granted' }) }));
    assert.deepEqual(c.cta, { type: 'sheet', sheet: { kind: 'phone', path: 'phone', variant: 'turn_on' } });
    assert.equal(c.notNow, true);
  });

  test('the phone counting, Health Connect available: "Include your watch or fitness app" (Continue / Turn on / Health Connect / Play)', () => {
    const counting = { sources: on('recording'), countingToday: true };
    assert.deepEqual(todayCard(inputs({ ...counting, access: access(ANDROID_13, { phonePermission: 'granted' }) })).watch, {
      type: 'sheet',
      sheet: { kind: 'hc', path: 'hc_add', variant: 'continue' },
    });
    assert.deepEqual(todayCard(inputs({ ...counting, access: access(ANDROID_13, { phonePermission: 'granted', store: 'granted' }) })).watch, {
      type: 'sheet',
      sheet: { kind: 'hc', path: 'hc_add', variant: 'turn_on' },
    });
    assert.deepEqual(todayCard(inputs({ ...counting, hcRefused: true, access: access(ANDROID_13, { phonePermission: 'granted' }) })).watch, {
      type: 'store_settings',
    });
    const installable: StepFeatures = { ...ANDROID_13, store: 'installable' };
    assert.deepEqual(todayCard(inputs({ ...counting, access: access(installable, { phonePermission: 'granted' }) })).watch, { type: 'store_install' });
    // Also while nothing is counted yet today (the sampler between samples).
    assert.notEqual(todayCard(inputs({ sources: on('sampler'), access: access(ANDROID_13, { phonePermission: 'granted' }) })).watch, null);
  });

  test('no watch button: Health Connect already ON, unavailable, or counting this phone itself (S-A3), or only on Today', () => {
    const granted = access(ANDROID_13, { phonePermission: 'granted', store: 'granted' });
    assert.equal(todayCard(inputs({ sources: on('store', 'recording'), countingToday: true, access: granted })).watch, null);
    const noHc: StepFeatures = { ...ANDROID_13, store: 'unavailable' };
    assert.equal(todayCard(inputs({ sources: on('recording'), countingToday: true, access: access(noHc, { phonePermission: 'granted' }) })).watch, null);
    // A stepTracking phone counting with its motion sensor after refusing Health Connect: not asked again from here.
    assert.equal(todayCard(inputs({ sources: on('recording'), countingToday: true, access: access(ANDROID_14, { phonePermission: 'granted' }) })).watch, null);
    assert.equal(todayCard(inputs({ isToday: false, sources: on('recording'), access: access(ANDROID_13, { phonePermission: 'granted' }) })).watch, null);
  });
});

describe('Android: no step counter — Health Connect for a watch or an app', () => {
  const NO_COUNTER: StepFeatures = { platform: 'android', store: 'available', stepTracking: false, counter: false };

  test('"Continue" with the watches-and-apps copy', () => {
    const c = todayCard(inputs({ ask: ask('hc'), access: access(NO_COUNTER) }));
    assert.deepEqual(c.cta, { type: 'sheet', sheet: { kind: 'hc', path: 'hc_watch', variant: 'continue' } });
  });

  test('Health Connect not installed: "Get Health Connect" (Google Play) + "Not now"', () => {
    const c = todayCard(inputs({ ask: ask('hc'), access: access({ ...NO_COUNTER, store: 'installable' }) }));
    assert.deepEqual(c.cta, { type: 'store_install' });
    assert.equal(c.notNow, true);
  });
});

describe('iPhone: Apple Health first, the motion sensor once when it has no steps (U2)', () => {
  test('a fresh ask: "Continue" before Apple Health\'s sheet, no "Not now" (a refusal can\'t be seen)', () => {
    const c = todayCard(inputs({ access: access(IPHONE), ask: ask('healthkit') }));
    assert.deepEqual(c.cta, { type: 'sheet', sheet: { kind: 'healthkit', path: 'healthkit', variant: 'continue' } });
    assert.deepEqual([c.notNow, c.log], [false, true]);
  });

  test('the sheet answered already (another member, the switch was off): "Turn on" + "Not now"', () => {
    const c = todayCard(inputs({ access: access(IPHONE, { store: 'granted' }), ask: ask('healthkit', true) }));
    assert.deepEqual(c.cta, { type: 'sheet', sheet: { kind: 'healthkit', path: 'healthkit', variant: 'turn_on' } });
    assert.equal(c.notNow, true);
  });

  test('Apple Health empty: "Log steps" + "Use iPhone motion instead" (its own sheet, then the Motion prompt)', () => {
    const c = todayCard(inputs({ access: access(IPHONE, { store: 'granted' }), sources: on('store'), healthEmpty: true }));
    assert.equal(c.state, 'health_empty');
    assert.equal(c.log, true);
    assert.deepEqual(c.motion, { type: 'sheet', sheet: { kind: 'phone', path: 'motion', variant: 'continue', fallback: true } });
    assert.equal(c.notNow, false);
  });

  test('offered once: gone once offered; Motion already allowed → "Turn on"; blocked → Settings; no motion chip → none', () => {
    const empty = { sources: on('store'), healthEmpty: true };
    assert.equal(todayCard(inputs({ ...empty, access: access(IPHONE, { store: 'granted' }), motionOffered: true })).motion, null);
    assert.deepEqual(todayCard(inputs({ ...empty, access: access(IPHONE, { store: 'granted', phonePermission: 'granted' }) })).motion, {
      type: 'sheet',
      sheet: { kind: 'phone', path: 'motion', variant: 'turn_on', fallback: true },
    });
    assert.deepEqual(todayCard(inputs({ ...empty, access: access(IPHONE, { store: 'granted', phonePermission: 'blocked' }) })).motion, { type: 'settings' });
    const noMotion: StepFeatures = { ...IPHONE, counter: false };
    assert.equal(todayCard(inputs({ ...empty, access: access(noMotion, { store: 'granted' }) })).motion, null);
  });

  test('offered, refused, then Motion & Fitness allowed in Settings: offered again as "Turn on" (the only way to agree)', () => {
    const c = todayCard(inputs({ sources: on('store'), healthEmpty: true, motionOffered: true, access: access(IPHONE, { store: 'granted', phonePermission: 'granted' }) }));
    assert.deepEqual(c.motion, { type: 'sheet', sheet: { kind: 'phone', path: 'motion', variant: 'turn_on', fallback: true } });
    const blocked = todayCard(inputs({ sources: on('store'), healthEmpty: true, motionOffered: true, access: access(IPHONE, { store: 'granted', phonePermission: 'blocked' }) }));
    assert.equal(blocked.motion, null, 'still refused: not offered again');
  });

  test('the motion sensor counting: not "health empty" any more, no offer', () => {
    const c = todayCard(inputs({ access: access(IPHONE, { store: 'granted', phonePermission: 'granted' }), sources: on('store', 'pedometer'), healthEmpty: true, countingToday: true }));
    assert.equal(c.state, 'counting');
    assert.equal(c.motion, null);
    const waiting = todayCard(inputs({ access: access(IPHONE, { store: 'granted', phonePermission: 'granted' }), sources: on('store', 'pedometer'), healthEmpty: true }));
    assert.equal(waiting.state, 'waiting');
    assert.equal(waiting.motion, null);
  });

  test('no Apple Health on this device: the motion sensor first, with its own copy', () => {
    const noHealth: StepFeatures = { platform: 'ios', store: 'unavailable', counter: true };
    const c = todayCard(inputs({ access: access(noHealth, { firstAsk: 'phone' }), ask: ask('phone') }));
    assert.deepEqual(c.cta, { type: 'sheet', sheet: { kind: 'phone', path: 'ios_phone', variant: 'continue' } });
  });
});

describe('the disclosure (§6: one button, the exact points)', () => {
  const SAVED = 'Only each day’s total is saved to your ÖRZA account — on Today, your reports and the website. Never where you go.';
  const OFF = 'Turn it off any time in Settings › Privacy & data.';
  /** Every path, iPhone included (the AI consent, ai-consent.md §4: OpenAI named; sent only once AI features are allowed). */
  const AI = 'If you allow AI features, your step totals go with your Ask ÖRZA chats to OpenAI, our AI provider.';
  const texts = (c: ReturnType<typeof disclosureCopy>) => c.points.map((p) => p.text);

  test('Android Health Connect (14+): its points, the AI provider named, Health Connect\'s caption, "Continue"', () => {
    const c = disclosureCopy('hc', 'continue', false);
    assert.equal(c.title, 'Count your steps automatically');
    assert.deepEqual(texts(c), [
      'ÖRZA reads your daily step total from Health Connect — this phone’s steps plus any watch or fitness app you use with it.',
      'Health Connect then keeps this phone’s steps, so other health apps you allow can use them too.',
      SAVED,
      AI,
      OFF,
    ]);
    assert.equal(c.points.find((p) => p.text === AI)?.icon, 'ai');
    assert.equal(c.caption, 'Next, Health Connect shows what ÖRZA would like to read.');
    assert.equal(c.button, 'Continue');
  });

  test('Android phone: its point, the AI provider named, the Physical activity caption; no history line (counting starts at the subscription)', () => {
    const c = disclosureCopy('phone', 'continue', true);
    assert.deepEqual(texts(c), [
      'Your phone counts steps with a low-power motion sensor, and Google Play services keeps them for ÖRZA — even when ÖRZA is closed.',
      SAVED,
      AI,
      OFF,
    ]);
    assert.equal(c.caption, 'Next, your phone asks to allow “Physical activity”.');
    assert.equal(disclosureCopy('phone_sampler', 'continue', true).points.length, 4);
    assert.deepEqual(texts(disclosureCopy('phone_sampler', 'continue', true)).slice(-3), [SAVED, AI, OFF]);
    assert.equal(disclosureCopy('phone_sampler', 'continue', true).caption, c.caption);
  });

  test('iPhone Apple Health and the motion fallback: their points and captions, OpenAI named too', () => {
    const hk = disclosureCopy('healthkit', 'continue', false);
    assert.deepEqual(texts(hk), [
      'ÖRZA reads your daily step total from Apple Health — your iPhone and Apple Watch counted once, just like the Health app.',
      SAVED,
      AI,
      OFF,
    ]);
    assert.equal(hk.caption, 'Next, Apple Health shows what ÖRZA would like to read.');
    const motion = disclosureCopy('motion', 'continue', false);
    assert.deepEqual(texts(motion), [
      'Apple Health has no steps for ÖRZA, so your iPhone’s motion sensor can count them instead (the last 7 days, without a watch).',
      SAVED,
      AI,
      OFF,
    ]);
    assert.equal(motion.caption, 'Next, your iPhone asks to allow “Motion & Fitness”.');
    assert.deepEqual(texts(disclosureCopy('ios_phone', 'continue', false)), [
      'Your iPhone counts your steps with its low-power motion sensor (without a watch).',
      SAVED,
      AI,
      OFF,
    ]);
  });

  test('the full backfill (M9) adds the history line after what is read: 30 days for a store, 7 for motion', () => {
    assert.deepEqual(texts(disclosureCopy('hc', 'continue', true)).slice(2, 3), ['Your steps from the last 30 days come in too.']);
    assert.deepEqual(texts(disclosureCopy('healthkit', 'continue', true)).slice(1, 2), ['Your steps from the last 30 days come in too.']);
    assert.deepEqual(texts(disclosureCopy('hc_add', 'continue', true)).slice(1, 2), ['Your steps from the last 30 days come in too.']);
    assert.deepEqual(texts(disclosureCopy('motion', 'continue', true)).slice(1, 2), ['Your steps from the last 7 days come in too.']);
    assert.equal(texts(disclosureCopy('healthkit', 'continue', false)).length, 4);
  });

  test('Health Connect for a watch only: no claim that it keeps this phone\'s steps', () => {
    for (const path of ['hc_add', 'hc_watch'] as const) {
      const c = disclosureCopy(path, 'continue', false);
      assert.ok(!texts(c).some((t) => t.includes('keeps this phone’s steps')), path);
      assert.equal(c.caption, 'Next, Health Connect shows what ÖRZA would like to read.');
      assert.deepEqual(texts(c).slice(-3), [SAVED, AI, OFF]);
    }
  });

  test('the AI line names OpenAI on all 8 paths, with its icon, right before the way to turn counting off', () => {
    const paths = ['hc', 'hc_add', 'hc_watch', 'phone', 'phone_sampler', 'healthkit', 'motion', 'ios_phone'] as const;
    for (const path of paths) {
      for (const full of [false, true]) {
        const c = disclosureCopy(path, 'continue', full);
        const i = c.points.findIndex((p) => p.text === AI);
        assert.ok(i >= 0, `${path} ${full}`);
        assert.equal(c.points[i].icon, 'ai');
        assert.equal(c.points[i + 1].text, OFF, path);
        assert.ok(AI.includes('OpenAI'));
      }
    }
  });

  test('"Turn on" (the permission is already there): the same points, no "Next…" caption — no system prompt follows', () => {
    const c = disclosureCopy('hc', 'turn_on', true);
    assert.equal(c.button, 'Turn on');
    assert.equal(c.caption, null);
    assert.deepEqual(texts(c), texts(disclosureCopy('hc', 'continue', true)));
  });
});

describe('U5: where Health Connect\'s steps came from, the time-zone hint', () => {
  test('one known app → its name ("From Samsung Health", "From Fitbit"); Health Connect\'s own phone count → "From this phone"', () => {
    assert.equal(originLabel(['com.sec.android.app.shealth']), 'From Samsung Health');
    assert.equal(originLabel(['com.fitbit.FitbitMobile']), 'From Fitbit');
    assert.equal(originLabel(['com.google.android.apps.fitness']), 'From Google Fit');
    assert.equal(originLabel(['android']), 'From this phone');
    assert.equal(originLabel(['android', 'android']), 'From this phone');
  });

  test('several apps (Health Connect\'s priority list decided), an unknown app or none → no label of its own', () => {
    assert.equal(originLabel(['android', 'com.sec.android.app.shealth']), null);
    assert.equal(originLabel(['com.example.steps']), null);
    assert.equal(originLabel([]), null);
    assert.equal(originLabel(undefined), null);
  });

  const AT = Date.UTC(2026, 10, 2, 6, 0); // 2 Nov 2026
  const JULY = Date.UTC(2026, 6, 1, 12, 0);

  test('the phone\'s zone has another offset than the profile\'s: a hint naming both', () => {
    assert.deepEqual(zoneHint('Asia/Kolkata', 'Asia/Singapore', AT), { profile: 'Asia/Kolkata', device: 'Asia/Singapore' });
    assert.deepEqual(zoneHint('Europe/London', 'Africa/Abidjan', JULY), { profile: 'Europe/London', device: 'Africa/Abidjan' });
  });

  test('the same offset (another name for the zone, or the same now): no hint; an unknown phone zone: none', () => {
    assert.equal(zoneHint('Asia/Kolkata', 'Asia/Kolkata', AT), null);
    assert.equal(zoneHint('Asia/Kolkata', 'Asia/Calcutta', AT), null);
    assert.equal(zoneHint('Europe/London', 'Africa/Abidjan', AT), null);
    assert.equal(zoneHint('Asia/Kolkata', 'Not/AZone', AT), null);
    assert.equal(zoneHint('Asia/Kolkata', null, AT), null);
  });
});

describe('the motion button (U2) once Physical activity is refused for good (V2 B2)', () => {
  const ANDROID_PATH = 'Settings › Apps › ÖRZA › Permissions › Physical activity › Allow';

  test('Android, refused for good: the button opens Settings — "Allow Physical activity" ↗ and the Settings path', () => {
    const card = todayCard(inputs({ access: access(ANDROID_14, { phonePermission: 'blocked' }), ask: ask('hc'), hcRefused: true }));
    assert.deepEqual(card.motion, { type: 'settings' });
    const copy = motionButtonCopy('android', card.motion!, 'Physical activity', ANDROID_PATH);
    assert.equal(copy.label, 'Allow Physical activity');
    assert.equal(copy.external, true);
    assert.equal(copy.caption, `To count with this phone, turn on Physical activity: ${ANDROID_PATH}.`);
    assert.equal(copy.hint, 'Opens Settings to turn on Physical activity for ÖRZA');
  });

  test('iPhone, Motion & Fitness refused: "Allow Motion & Fitness" ↗ with its Settings path', () => {
    const copy = motionButtonCopy('ios', { type: 'settings' }, 'Motion & Fitness', 'Settings › ÖRZA › Motion & Fitness');
    assert.equal(copy.label, 'Allow Motion & Fitness');
    assert.equal(copy.caption, 'To count with your iPhone, turn on Motion & Fitness: Settings › ÖRZA › Motion & Fitness.');
  });

  test('still askable: the fallback labels (with their short forms), no ↗, no caption', () => {
    const cont = motionButtonCopy('android', { type: 'sheet', sheet: { kind: 'phone', path: 'phone', variant: 'continue', fallback: true } }, 'Physical activity', ANDROID_PATH);
    assert.equal(cont.label, 'Use this phone’s motion sensor instead');
    assert.deepEqual(cont.short, ['Use this phone’s motion sensor', 'Use this phone’s sensor', 'Use phone’s sensor']);
    assert.deepEqual([cont.external, cont.caption], [false, null]);
    assert.equal(cont.hint, 'Explains counting with the motion sensor, then asks for Physical activity');
    const turnOn = motionButtonCopy('ios', { type: 'sheet', sheet: { kind: 'phone', path: 'motion', variant: 'turn_on', fallback: true } }, 'Motion & Fitness', '');
    assert.equal(turnOn.label, 'Use iPhone motion instead');
    assert.equal(turnOn.hint, 'Explains counting with the motion sensor, then turns it on for your account');
  });
});

describe('"Counting since…" — why today counts from later than midnight (§6, V2 F3)', () => {
  const GRANT = Date.UTC(2026, 10, 12, 13, 45);
  const base: PartialDayInputs = { since: '7:15 pm', savedEarlier: null, winner: 'health_connect', coverFrom: GRANT, stepTracking: true, hcGrantAt: GRANT };

  test('a START base: on top of what was saved earlier, whatever the source', () => {
    assert.equal(partialDayLine({ ...base, savedEarlier: '800' }), 'Counting since 7:15 pm, on top of the 800 saved earlier today.');
    assert.equal(partialDayLine({ ...base, winner: 'phone', savedEarlier: '1,000' }), 'Counting since 7:15 pm, on top of the 1,000 saved earlier today.');
  });

  test('Health Connect from its first grant on this install (S-H2): it starts counting this phone then', () => {
    assert.equal(partialDayLine(base), 'Counting since 7:15 pm — Health Connect starts counting this phone’s steps when you turn this on.');
  });

  test('Health Connect from any other instant — a member switch (M9 floor), another grant — a neutral line', () => {
    const neutral = 'Counting since 7:15 pm — steps before then aren’t included.';
    assert.equal(partialDayLine({ ...base, coverFrom: GRANT + 25 * 60_000 }), neutral, 'the floor after the grant');
    assert.equal(partialDayLine({ ...base, hcGrantAt: null }), neutral, 'no grant on record');
    assert.equal(partialDayLine({ ...base, stepTracking: false }), neutral, 'Health Connect doesn’t count this phone');
  });

  test('the phone’s own counter: earlier steps weren’t seen by this phone', () => {
    assert.equal(partialDayLine({ ...base, winner: 'phone' }), 'Counting since 7:15 pm — earlier steps today weren’t seen by this phone.');
  });
});
