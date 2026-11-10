/// <reference types="node" />
/**
 * App-wide AI consent (`docs/notes/ai-consent.md` §3.3, §4, §7) — `npm run test:ai`. Pure: `lib/aiConsent.ts` decides
 * the gate, the backstop's paths, how a refusal looks and every string the sheet, the notes and Settings show;
 * `features/ai/*` renders it, and `lib/api.ts` refuses the six AI paths while the member has no recorded consent.
 *
 * - A1 `aiConsentState`: no field = an old server (or an old snapshot); a number ≥ the app's version = allowed.
 * - A2 `gateStep` / `runAiGate`: allowed → go; otherwise one `/auth/me` refresh, then the sheet (ask) or the
 *   unavailable line (an old server); a server refusal never trusts the cache.
 * - A3 `isAiPath`: exactly the six AI routes.
 * - A4 refusal / outdated detection (duck-typed, so these tests never load `expo-device`).
 * - A5 copy.
 * - A6 `iphoneSendsHealthData`: the iPhone sends automatic steps and weight only to a server that knows the consent.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  AI_CONSENT_VERSION,
  AI_FEATURES,
  AI_NEEDED_LINE,
  AI_OUTDATED_LINE,
  AI_PATHS,
  AI_PRIVACY_PATH,
  AI_SAVE_FAILED_LINE,
  AI_TOASTS,
  AI_TURN_OFF,
  AI_UNAVAILABLE,
  aiConsentState,
  aiSettingsSubtitle,
  aiStatusLine,
  consentCopy,
  declinedLine,
  gateStep,
  isAiConsentOutdated,
  isAiConsentRefusal,
  isAiPath,
  isLocalAiRefusal,
  runAiGate,
  serverKnowsAiConsent,
  type AiConsentState,
  type AiConsentUser,
  type GateDeps,
} from '../../src/lib/aiConsent';
import { iphoneSendsHealthData, SEND_IPHONE_HEALTH_DATA } from '../../src/lib/health/types';

const AT = '2026-11-10T09:30:00.000Z';

describe('A1: the consent state of a user copy', () => {
  test('no field: an old server or an old snapshot (unsupported); null: ask; a number at or above the version: allowed', () => {
    assert.equal(AI_CONSENT_VERSION, 1);
    assert.equal(aiConsentState({}), 'unsupported');
    assert.equal(aiConsentState({ ai_consent: undefined }), 'unsupported');
    assert.equal(aiConsentState({ ai_consent: null }), 'ask');
    assert.equal(aiConsentState({ ai_consent: { version: 1, at: AT } }), 'allowed');
    assert.equal(aiConsentState({ ai_consent: { version: 2, at: AT } }), 'allowed', 'a newer server version still covers this app');
    assert.equal(aiConsentState({ ai_consent: { version: 0, at: AT } }), 'ask');
  });

  test('a lower version than the app asks again (a material change bumps both repos)', () => {
    assert.equal(aiConsentState({ ai_consent: { version: 1, at: AT } }, 2), 'ask');
    assert.equal(aiConsentState({ ai_consent: { version: 2, at: AT } }, 2), 'allowed');
  });

  test('anything malformed asks: never an AI request on a guess', () => {
    for (const bad of ['yes', true, 1, {}, { version: '1' }, { version: NaN }, { version: Infinity }, []]) {
      assert.equal(aiConsentState({ ai_consent: bad } as AiConsentUser), 'ask', JSON.stringify(bad));
    }
  });

  test('no user at all: unsupported (nothing to ask for)', () => {
    assert.equal(aiConsentState(null), 'unsupported');
    assert.equal(aiConsentState(undefined), 'unsupported');
  });

  test('serverKnowsAiConsent: the field is there (null included)', () => {
    assert.equal(serverKnowsAiConsent({ ai_consent: null }), true);
    assert.equal(serverKnowsAiConsent({ ai_consent: { version: 1, at: AT } }), true);
    assert.equal(serverKnowsAiConsent({}), false);
    assert.equal(serverKnowsAiConsent(null), false);
  });
});

describe('A2: the gate', () => {
  test('gateStep: allowed goes; otherwise refresh once, then ask (or unavailable on an old server)', () => {
    assert.equal(gateStep('allowed', { refreshed: false, refused: false }), 'go');
    assert.equal(gateStep('ask', { refreshed: false, refused: false }), 'refresh');
    assert.equal(gateStep('unsupported', { refreshed: false, refused: false }), 'refresh');
    assert.equal(gateStep('ask', { refreshed: true, refused: false }), 'ask');
    assert.equal(gateStep('unsupported', { refreshed: true, refused: false }), 'unavailable');
    assert.equal(gateStep('allowed', { refreshed: true, refused: false }), 'go');
  });

  test('gateStep: a server refusal asks, even when the copy says allowed', () => {
    for (const s of ['allowed', 'ask', 'unsupported'] as AiConsentState[]) {
      assert.equal(gateStep(s, { refreshed: false, refused: true }), 'ask', s);
      assert.equal(gateStep(s, { refreshed: true, refused: true }), 'ask', s);
    }
  });

  /** A fake app: the backstop follows the user copy, as `auth.tsx` keeps it. */
  function app(initial: AiConsentUser | null, opts: { server?: AiConsentUser | null; allow?: boolean } = {}) {
    let user = initial;
    const calls = { refresh: 0, ask: 0 };
    const deps: GateDeps = {
      allowed: () => aiConsentState(user) === 'allowed',
      user: () => user,
      current: () => true,
      refresh: async () => {
        calls.refresh += 1;
        if (opts.server === undefined) return null; // offline
        user = opts.server;
        return user;
      },
      ask: async () => {
        calls.ask += 1;
        if (opts.allow) user = { ai_consent: { version: 1, at: AT } };
        return !!opts.allow;
      },
    };
    return { deps, calls, user: () => user };
  }

  test('allowed: goes at once — no refresh, no sheet', async () => {
    const a = app({ ai_consent: { version: 1, at: AT } });
    assert.equal(await runAiGate(a.deps), 'go');
    assert.deepEqual(a.calls, { refresh: 0, ask: 0 });
  });

  test('no consent here, allowed on another phone or the web: the refresh finds it, no sheet', async () => {
    const a = app({ ai_consent: null }, { server: { ai_consent: { version: 1, at: AT } } });
    assert.equal(await runAiGate(a.deps), 'go');
    assert.deepEqual(a.calls, { refresh: 1, ask: 0 });
  });

  test('no consent: one refresh, then the sheet — Allow goes, Not now is declined', async () => {
    const yes = app({ ai_consent: null }, { server: { ai_consent: null }, allow: true });
    assert.equal(await runAiGate(yes.deps), 'go');
    assert.deepEqual(yes.calls, { refresh: 1, ask: 1 });
    const no = app({ ai_consent: null }, { server: { ai_consent: null }, allow: false });
    assert.equal(await runAiGate(no.deps), 'declined');
    assert.deepEqual(no.calls, { refresh: 1, ask: 1 });
  });

  test('offline with no consent: the sheet still opens (its Allow then fails with the network line)', async () => {
    const a = app({ ai_consent: null });
    assert.equal(await runAiGate(a.deps), 'declined');
    assert.deepEqual(a.calls, { refresh: 1, ask: 1 });
  });

  test('an old server: no sheet and no request — unavailable', async () => {
    const a = app({}, { server: {} });
    assert.equal(await runAiGate(a.deps), 'unavailable');
    assert.deepEqual(a.calls, { refresh: 1, ask: 0 });
  });

  test('an old snapshot while offline: offline, not "unavailable" (the server may well know the consent)', async () => {
    const a = app({});
    assert.equal(await runAiGate(a.deps), 'offline');
    assert.deepEqual(a.calls, { refresh: 1, ask: 0 });
  });

  test('an old snapshot, a new server: the refresh brings the field, then the sheet', async () => {
    const a = app({}, { server: { ai_consent: null }, allow: true });
    assert.equal(await runAiGate(a.deps), 'go');
    assert.deepEqual(a.calls, { refresh: 1, ask: 1 });
  });

  test('a server refusal: straight to the sheet, no refresh (never trust the cache then)', async () => {
    const a = app({ ai_consent: { version: 1, at: AT } }, { server: { ai_consent: { version: 1, at: AT } }, allow: false });
    assert.equal(await runAiGate(a.deps, { refused: true }), 'declined');
    assert.deepEqual(a.calls, { refresh: 0, ask: 1 });
  });

  test('a copy that says allowed while the backstop is closed is not trusted: refresh, then ask', async () => {
    const a = app({ ai_consent: { version: 1, at: AT } }, { server: { ai_consent: null } });
    a.deps.allowed = () => false;
    assert.equal(await runAiGate(a.deps), 'declined');
    assert.deepEqual(a.calls, { refresh: 1, ask: 1 });
  });

  test('a sheet that resolves true without a recorded consent never goes (the backstop decides)', async () => {
    const a = app({ ai_consent: null }, { server: { ai_consent: null } });
    a.deps.ask = async () => true;
    assert.equal(await runAiGate(a.deps), 'declined');
  });

  test('signed out (or into another account) during the refresh: gone — no sheet for the next member', async () => {
    const a = app({ ai_consent: null }, { server: { ai_consent: null }, allow: true });
    let member = 'A';
    const refresh = a.deps.refresh;
    a.deps.refresh = async () => {
      const me = await refresh();
      member = 'B';
      return me;
    };
    a.deps.current = () => member === 'A';
    assert.equal(await runAiGate(a.deps), 'gone');
    assert.deepEqual(a.calls, { refresh: 1, ask: 0 });
  });

  test('another member allowed while the sheet was up: gone — the first member’s action never goes on their consent', async () => {
    const a = app({ ai_consent: null }, { server: { ai_consent: null } });
    let member = 'A';
    a.deps.current = () => member === 'A';
    a.deps.ask = async () => {
      member = 'B';
      a.deps.allowed = () => true; // B's copy has a consent: the backstop is open for B
      return true;
    };
    assert.equal(await runAiGate(a.deps), 'gone');
    member = 'A';
    a.deps.allowed = () => false;
    assert.equal(await runAiGate(a.deps, { refused: true }), 'gone', 'a refusal’s retry too');
  });
});

describe('A3: the backstop’s paths', () => {
  test('the six AI routes, with or without /api, a query, a hash, a trailing slash or an absolute URL', () => {
    assert.deepEqual([...AI_PATHS], ['/chat/send', '/meals/text', '/meals/scan', '/recipes/generate', '/compensation/plan', '/prescriptions/scan']);
    for (const p of AI_PATHS) {
      assert.ok(isAiPath(p), p);
      assert.ok(isAiPath(`/api${p}`), `/api${p}`);
      assert.ok(isAiPath(`${p}/`), `${p}/`);
      assert.ok(isAiPath(`${p}?x=1`), `${p}?x=1`);
      assert.ok(isAiPath(`${p}#a`), `${p}#a`);
      assert.ok(isAiPath(p.slice(1)), p.slice(1));
      assert.ok(isAiPath(`https://orza.test/api${p}`), `absolute ${p}`);
      assert.ok(isAiPath(`/api/${p}`), `double slash /api/${p}`);
      assert.ok(isAiPath(p.toUpperCase()), `upper case ${p}`);
    }
  });

  test('everything else is not AI: history, sessions, manual meals, scan confirm, prescription apply, saves, lists', () => {
    for (const p of [
      '/chat/history',
      '/chat/history?session_id=1',
      '/chat/sessions',
      '/chat/sessions/abc',
      '/meals/manual',
      '/meals/scan/x/confirm',
      '/api/meals/scan/x/confirm',
      '/meals/x',
      '/prescriptions/x/apply',
      '/prescriptions',
      '/prescriptions/scan-x',
      '/recipes/x/save',
      '/recipes',
      '/compensation',
      '/compensation/x',
      '/auth/me',
      '/settings/ai-consent',
      '/track/steps',
      '',
    ]) {
      assert.equal(isAiPath(p), false, p);
    }
  });
});

describe('A4: refusal and outdated', () => {
  test('403 ai_consent_required is a refusal; other 403s, 401, 409 and non-errors are not', () => {
    assert.equal(isAiConsentRefusal({ status: 403, code: 'ai_consent_required' }), true);
    assert.equal(isAiConsentRefusal({ status: 403, code: 'forbidden' }), false);
    assert.equal(isAiConsentRefusal({ status: 401, code: 'ai_consent_required' }), false);
    assert.equal(isAiConsentRefusal({ status: 409, code: 'ai_consent_outdated' }), false);
    assert.equal(isAiConsentRefusal(null), false);
    assert.equal(isAiConsentRefusal(undefined), false);
    assert.equal(isAiConsentRefusal('ai_consent_required'), false);
    assert.equal(isAiConsentRefusal(new Error('x')), false);
  });

  test('the backstop’s own refusal is marked local; the server’s is not', () => {
    assert.equal(isLocalAiRefusal({ status: 403, code: 'ai_consent_required', data: { local: true } }), true);
    assert.equal(isLocalAiRefusal({ status: 403, code: 'ai_consent_required', data: { error: 'x', code: 'ai_consent_required' } }), false);
    assert.equal(isLocalAiRefusal({ status: 403, code: 'forbidden', data: { local: true } }), false);
  });

  test('409 ai_consent_outdated: the app is older than the server’s consent version', () => {
    assert.equal(isAiConsentOutdated({ status: 409, code: 'ai_consent_outdated' }), true);
    assert.equal(isAiConsentOutdated({ status: 409, code: 'conflict' }), false);
    assert.equal(isAiConsentOutdated({ status: 403, code: 'ai_consent_outdated' }), false);
    assert.equal(isAiConsentOutdated(null), false);
  });
});

describe('A5: copy', () => {
  test('the sheet: eyebrow, title, a lead that names OpenAI, the buttons and the privacy link', () => {
    const c = consentCopy('chat', 'android');
    assert.equal(c.eyebrow, 'AI features');
    assert.equal(c.title, 'Allow ÖRZA’s AI features?');
    assert.equal(
      c.lead,
      'Ask ÖRZA answers with AI. These features are run by OpenAI, our AI provider. When you use one, ÖRZA sends OpenAI only what that request needs:'
    );
    assert.equal(c.allow, 'Allow');
    assert.equal(c.notNow, 'Not now');
    assert.equal(c.link, 'How ÖRZA uses AI');
    assert.equal(AI_PRIVACY_PATH, '/privacy#ai-processing');
  });

  test('every feature has its own first sentence, and Settings none; every lead names OpenAI', () => {
    const first: Record<string, string> = {
      chat: 'Ask ÖRZA answers with AI.',
      meal_text: 'ÖRZA reads typed and spoken meals with AI.',
      snap: 'Snap & Know reads your meal photo with AI.',
      recipe: 'ÖRZA writes new recipes with AI.',
      rebalance: 'ÖRZA personalises rebalance plans with AI.',
      rx: 'ÖRZA reads prescription photos with AI.',
    };
    assert.deepEqual([...AI_FEATURES], Object.keys(first));
    for (const f of AI_FEATURES) {
      const lead = consentCopy(f, 'ios').lead;
      assert.ok(lead.startsWith(`${first[f]} These features are run by OpenAI`), f);
      assert.ok(lead.includes('OpenAI'), f);
    }
    assert.ok(consentCopy('settings', 'ios').lead.startsWith('These features are run by OpenAI, our AI provider.'));
  });

  test('the points, in order; the chat point names the phone’s health sources per platform', () => {
    const ios = consentCopy('snap', 'ios');
    assert.deepEqual(
      ios.points.map((p) => p.icon),
      ['meals', 'chat', 'recipes', 'rx', 'never']
    );
    assert.equal(ios.points[0].text, 'Meals — your meal photo, or the words you type or say, with your diet, region and language.');
    const chatIos = ios.points[1].text;
    assert.ok(
      chatIos.startsWith(
        'Ask ÖRZA — your message and the chat so far, your first name and everything in your profile (including age, sex, weight, diet, allergies and health notes), your targets, what ÖRZA remembers, and today’s meals, water and steps.'
      )
    );
    assert.ok(chatIos.endsWith(' Steps can come from Apple Health or your iPhone’s motion sensor, and weight from Apple Health.'));
    const chatAndroid = consentCopy('snap', 'android').points[1].text;
    assert.ok(chatAndroid.endsWith(' Steps can come from Health Connect or this phone, and weight from Health Connect.'));
    assert.ok(!chatAndroid.includes('Apple'));
    assert.equal(ios.points[2].text, 'Recipes and rebalance plans — what you ask for, with your first name, diet, allergies, region, goal and targets.');
    assert.equal(ios.points[3].text, 'Prescription scans — the prescription photo and the allergies you listed.');
    // "Account’s" and "saved": a photo or a message can show anything (the prescription photo shows its medicines).
    assert.equal(ios.points[4].text, 'Never your account’s email, password or phone number, your saved medicines and alarms, or your sleep and heart rate.');
  });

  test('after the points: no ads or sale, what works without AI, the way to turn it off (not repeated inside Settings)', () => {
    const after = [
      'ÖRZA shares this only to answer you — never for ads, and it’s never sold.',
      'Everything else works without AI: the food list, medicines and alarms, steps, water and weight.',
      'Turn AI features off any time in Settings › Privacy & data.',
    ];
    assert.deepEqual(consentCopy('rx', 'android').after, after);
    assert.deepEqual(consentCopy('settings', 'android').after, after.slice(0, 2));
  });

  test('declined lines: one per feature, each naming what still works', () => {
    assert.equal(declinedLine('chat'), 'Ask ÖRZA needs AI features. Your earlier chats are still here.');
    assert.equal(declinedLine('meal_text'), 'Typing or speaking a meal needs AI features. You can still add foods from the food list.');
    assert.equal(declinedLine('snap'), 'Snap & Know needs AI features. You can still log your meal from the food list.');
    assert.equal(declinedLine('recipe'), 'New recipes need AI features. Your saved recipes are still here.');
    assert.equal(declinedLine('rebalance'), 'New rebalance plans need AI features. Your earlier plans are still here.');
    assert.equal(declinedLine('rx'), 'Reading a prescription needs AI features. You can type the medicines instead.');
    assert.equal(AI_UNAVAILABLE, 'ÖRZA’s AI features aren’t ready for this app yet. Please try again later.');
    assert.ok(AI_NEEDED_LINE.includes('Settings › Privacy & data'));
  });

  test('saving the choice: update the app (409), or try again', () => {
    assert.equal(AI_OUTDATED_LINE, 'This version of ÖRZA can’t turn on AI features. Please update the app.');
    assert.equal(AI_SAVE_FAILED_LINE, 'Couldn’t save your choice. Please try again.');
  });

  test('Settings: the row’s subtitle, the status line, the turn-off confirm and the toasts', () => {
    assert.equal(aiSettingsSubtitle('allowed'), 'On · run by OpenAI');
    assert.equal(aiSettingsSubtitle('ask'), 'Off · ÖRZA asks before the first use');
    assert.equal(aiSettingsSubtitle('unsupported'), 'Not available yet');
    // Midday UTC: the same calendar day in every zone a test machine is likely to use.
    assert.equal(aiStatusLine({ ai_consent: { version: 1, at: '2026-11-10T12:00:00.000Z' } }), 'On since 10 Nov 2026');
    assert.equal(aiStatusLine({ ai_consent: { version: 1, at: 'garbage' } }), 'On');
    assert.equal(aiStatusLine({ ai_consent: null }), 'Off');
    assert.equal(aiStatusLine({}), null);
    assert.equal(AI_TURN_OFF.title, 'Turn off AI features?');
    assert.equal(
      AI_TURN_OFF.body,
      'Ask ÖRZA, Snap & Know, typed and spoken meals, recipes, rebalance plans and prescription scans stop in the app until you allow them again. Your meals, chats and plans stay.'
    );
    assert.equal(AI_TURN_OFF.confirm, 'Turn off');
    assert.equal(AI_TURN_OFF.cancel, 'Keep on');
    // "In the app": the website doesn't ask yet (ai-consent.md §11 Q1).
    assert.equal(AI_TOASTS.off, 'AI features are off in the app. ÖRZA will ask before using them again.');
    assert.equal(AI_TOASTS.on, 'AI features are on.');
  });
});

describe('A6: the iPhone’s automatic steps and weight (SEND_IPHONE_HEALTH_DATA)', () => {
  test('on, and sent only to a server whose user answers carry ai_consent — with or without the member’s consent', () => {
    assert.equal(SEND_IPHONE_HEALTH_DATA, true);
    assert.equal(iphoneSendsHealthData(serverKnowsAiConsent({ ai_consent: { version: 1, at: AT } })), true, 'allowed');
    assert.equal(iphoneSendsHealthData(serverKnowsAiConsent({ ai_consent: null })), true, 'ask: the server keeps it out of AI (R1, R2)');
    assert.equal(iphoneSendsHealthData(serverKnowsAiConsent({})), false, 'an old server: nothing automatic');
    assert.equal(iphoneSendsHealthData(serverKnowsAiConsent(null)), false);
  });
});
