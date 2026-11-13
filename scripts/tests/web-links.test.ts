/// <reference types="node" />
/**
 * Website pages opened from the app carry `from=app` (D3 decision D5; `src/lib/webLink.ts`, `src/lib/web.ts`) — `npm
 * run test:links`. The website hides its menu and pricing links for a browsing session that started with it.
 *
 * - L1 `withFromApp`: added before the #fragment, after any query; an old `from` is replaced; applying it twice changes
 *   nothing.
 * - L2 `appWebUrl`: site paths and full URLs on the website get it; other sites (and look-alike hosts) don't.
 * - L3 one helper: no screen opens the in-app browser itself (only `lib/web.ts` imports expo-web-browser), and every
 *   place that used to build `${WEB_URL}…` for the browser now goes through `openWebsite`.
 * - L4 Health Connect's privacy page (Android, native WebView) loads the same page with `from=app`.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, test } from 'node:test';

import { FROM_APP_KEY, FROM_APP_VALUE, appWebUrl, isWebsiteUrl, withFromApp } from '../../src/lib/webLink';

const ORIGIN = 'https://orza-nine.vercel.app';
const ROOT = join(__dirname, '..', '..');

describe('L1 withFromApp', () => {
  test('the query the website reads', () => {
    assert.equal(`${FROM_APP_KEY}=${FROM_APP_VALUE}`, 'from=app');
  });
  test('a plain page', () => {
    assert.equal(withFromApp(`${ORIGIN}/terms`), `${ORIGIN}/terms?from=app`);
  });
  test('before the #fragment', () => {
    assert.equal(withFromApp(`${ORIGIN}/privacy#ai-processing`), `${ORIGIN}/privacy?from=app#ai-processing`);
  });
  test('after an existing query, which stays as it is', () => {
    assert.equal(withFromApp(`${ORIGIN}/dashboard/alarm?med=m1&at=2026-11-13T08%3A00`), `${ORIGIN}/dashboard/alarm?med=m1&at=2026-11-13T08%3A00&from=app`);
  });
  test('an old from= is replaced, never doubled', () => {
    assert.equal(withFromApp(`${ORIGIN}/faq?from=web&x=1#a`), `${ORIGIN}/faq?x=1&from=app#a`);
    const once = withFromApp(`${ORIGIN}/privacy#phone-app`);
    assert.equal(withFromApp(once), once);
  });
  test('an empty query or a stray & is tidied', () => {
    assert.equal(withFromApp(`${ORIGIN}/terms?`), `${ORIGIN}/terms?from=app`);
    assert.equal(withFromApp(`${ORIGIN}/terms?&a=1&`), `${ORIGIN}/terms?a=1&from=app`);
  });
  test('a key that only starts with "from" is kept', () => {
    assert.equal(withFromApp(`${ORIGIN}/x?fromage=1`), `${ORIGIN}/x?fromage=1&from=app`);
  });
});

describe('L2 appWebUrl', () => {
  test('site paths', () => {
    assert.equal(appWebUrl('/privacy', ORIGIN), `${ORIGIN}/privacy?from=app`);
    assert.equal(appWebUrl('/privacy#ai-processing', ORIGIN), `${ORIGIN}/privacy?from=app#ai-processing`);
    assert.equal(appWebUrl('/dashboard/admin', ORIGIN), `${ORIGIN}/dashboard/admin?from=app`);
    assert.equal(appWebUrl('/terms', `${ORIGIN}/`), `${ORIGIN}/terms?from=app`);
  });
  test('a full URL on the website (a link in an ÖRZA reply)', () => {
    assert.equal(appWebUrl(`${ORIGIN}/trust`, ORIGIN), `${ORIGIN}/trust?from=app`);
    assert.equal(appWebUrl('https://ORZA-NINE.vercel.app/faq', ORIGIN), 'https://ORZA-NINE.vercel.app/faq?from=app');
    assert.equal(appWebUrl(ORIGIN, ORIGIN), `${ORIGIN}?from=app`);
  });
  test('other sites are opened unchanged', () => {
    for (const url of [
      'https://www.who.int/news-room/fact-sheets/detail/healthy-diet',
      'https://calendar.google.com/calendar/r?cid=webcal%3A%2F%2Forza-nine.vercel.app%2Fapi%2Fcalendar%2Ffeed%2Fx.ics',
      'https://outlook.live.com/calendar/0/addfromweb?url=https%3A%2F%2Forza-nine.vercel.app%2Fapi%2Fcalendar%2Ffeed%2Fx.ics&name=%C3%96RZA',
      'https://orza-nine.vercel.app.example.com/privacy',
      'https://evil.example/?next=https://orza-nine.vercel.app/privacy',
      'http://orza-nine.vercel.app/privacy',
    ]) {
      assert.equal(appWebUrl(url, ORIGIN), url, url);
    }
  });
  test('isWebsiteUrl', () => {
    assert.equal(isWebsiteUrl(`${ORIGIN}/x`, ORIGIN), true);
    assert.equal(isWebsiteUrl(`${ORIGIN}?a=1`, ORIGIN), true);
    assert.equal(isWebsiteUrl(`${ORIGIN}#top`, ORIGIN), true);
    assert.equal(isWebsiteUrl(`${ORIGIN}:8443/x`, ORIGIN), false);
    assert.equal(isWebsiteUrl('http://localhost:3100/privacy', 'http://localhost:3100'), true);
  });
});

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

describe('L3 one helper for every website page', () => {
  const files = sources(join(ROOT, 'src')).map((p) => ({ rel: relative(ROOT, p).replace(/\\/g, '/'), text: readFileSync(p, 'utf8') }));

  test('only lib/web.ts imports expo-web-browser', () => {
    const importers = files.filter((f) => /from 'expo-web-browser'/.test(f.text)).map((f) => f.rel);
    assert.deepEqual(importers, ['src/lib/web.ts']);
  });
  test('nothing builds a website address for the browser by hand', () => {
    // `${WEB_URL}…` may still appear as text (the admin screen shows the console's address) or inside a calendar event,
    // but never next to a browser call.
    const offenders = files.filter((f) => /openBrowserAsync|openAuthSessionAsync/.test(f.text) && f.rel !== 'src/lib/web.ts').map((f) => f.rel);
    assert.deepEqual(offenders, []);
  });
  test('the screens that open website pages use openWebsite', () => {
    for (const rel of [
      'src/app/(app)/settings.tsx',
      'src/app/(app)/account/data.tsx',
      'src/app/(app)/account/preferences.tsx',
      'src/app/(auth)/sign-up.tsx',
      'src/app/admin.tsx',
      'src/features/ai/AiConsentSheet.tsx',
      'src/features/health/ConnectCard.tsx',
      'src/features/chat/RichText.tsx',
    ]) {
      const f = files.find((x) => x.rel === rel);
      assert.ok(f, rel);
      assert.match(f.text, /openWebsite\(/, rel);
    }
  });
});

describe('L4 Health Connect privacy page (Android)', () => {
  const kt = readFileSync(join(ROOT, 'modules/orza-steps/android/src/main/java/expo/modules/orzasteps/HealthPrivacyActivity.kt'), 'utf8');
  const constant = (name: string) => kt.match(new RegExp(`const val ${name} = "([^"]+)"`))?.[1];

  test('the WebView loads the Play Console page with from=app', () => {
    const consoleUrl = constant('PRIVACY_URL');
    const inApp = constant('IN_APP_URL');
    assert.equal(consoleUrl, 'https://orza-nine.vercel.app/privacy#phone-app');
    assert.equal(inApp, withFromApp(consoleUrl!));
    assert.match(kt, /webView\.loadUrl\(IN_APP_URL\)/);
  });
});
