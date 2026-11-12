/// <reference types="node" />
/**
 * "Keep medicine alarms working" (`src/lib/alarms/oem.ts`) — `npm run test:alarms` runs this file next to the other
 * alarm tests. V2 real phone: vivo force-stopped ÖRZA, and no alarm could ring until it was opened again; on phones
 * from makers that do this, ÖRZA shows once which settings stop it.
 *
 * - Which phones: Build.BRAND first (iQOO, Redmi, POCO, realme, OnePlus, Honor), else Build.MANUFACTURER.
 * - The steps name their paths; the button tries the maker's screens, then App info, then the battery-optimisation
 *   list — never the "ignore battery optimisations" request.
 * - The sheet shows once, after the first medicine alarm is set, never over another sheet; Samsung only without
 *   "Unrestricted".
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { keepAliveGuide, keepAliveRowShown, makerOf, shouldOfferKeepAlive, type KeepAliveOfferInputs } from '../../src/lib/alarms/oem';

describe('which phones close apps to save battery (Build.MANUFACTURER / BRAND)', () => {
  test('the families and their names, the brand first (an iQOO phone is made by vivo)', () => {
    assert.deepEqual(makerOf('vivo', 'vivo'), { maker: 'vivo', name: 'vivo' });
    assert.deepEqual(makerOf('vivo', 'iQOO'), { maker: 'vivo', name: 'iQOO' });
    assert.deepEqual(makerOf('Xiaomi', 'Redmi'), { maker: 'xiaomi', name: 'Redmi' });
    assert.deepEqual(makerOf('Xiaomi', 'POCO'), { maker: 'xiaomi', name: 'POCO' });
    assert.deepEqual(makerOf('Xiaomi', 'Xiaomi'), { maker: 'xiaomi', name: 'Xiaomi' });
    assert.deepEqual(makerOf('OPPO', 'OPPO'), { maker: 'oppo', name: 'OPPO' });
    assert.deepEqual(makerOf('realme', 'realme'), { maker: 'oppo', name: 'realme' });
    assert.deepEqual(makerOf('OnePlus', 'OnePlus'), { maker: 'oppo', name: 'OnePlus' });
    assert.deepEqual(makerOf('HUAWEI', 'HUAWEI'), { maker: 'huawei', name: 'Huawei' });
    assert.deepEqual(makerOf('HONOR', 'HONOR'), { maker: 'huawei', name: 'Honor' });
    assert.deepEqual(makerOf('samsung', 'samsung'), { maker: 'samsung', name: 'Samsung' });
  });

  test('an unknown brand falls back to the manufacturer; other phones, iPhone and web: none', () => {
    assert.deepEqual(makerOf(' Xiaomi ', 'something-else'), { maker: 'xiaomi', name: 'Xiaomi' });
    assert.equal(makerOf('Google', 'google'), null);
    assert.equal(makerOf('motorola', 'motorola'), null);
    assert.equal(makerOf('Apple', 'Apple'), null);
    assert.equal(makerOf(null, null), null);
    assert.equal(makerOf(undefined), null);
  });
});

describe('the guide: steps by maker, the screens the button tries', () => {
  const vivo = keepAliveGuide({ maker: 'vivo', name: 'vivo' });

  test('vivo (the V2 phone): background power usage in App info, then Autostart; App info first', () => {
    assert.equal(vivo.title, 'Keep medicine alarms working');
    assert.equal(vivo.intro, 'vivo phones can close ÖRZA to save battery. Its medicine alarms then can’t ring until you open ÖRZA again. Change this once:');
    assert.deepEqual(vivo.steps, [
      'Battery: choose “Allow background power usage” in Settings › Apps › ÖRZA › Battery usage › Background power control.',
      'Autostart: turn it on for ÖRZA in Settings › Apps › Autostart, if your phone has it.',
    ]);
    assert.deepEqual(vivo.targets, [{ type: 'app' }, { type: 'battery' }]);
    assert.match(keepAliveGuide({ maker: 'vivo', name: 'iQOO' }).intro, /^iQOO phones /);
  });

  test('Xiaomi, OPPO and Huawei try their own autostart / app launch screens first, then App info, then the battery list', () => {
    for (const maker of ['xiaomi', 'oppo', 'huawei'] as const) {
      const g = keepAliveGuide({ maker, name: maker });
      const types = g.targets.map((t) => t.type);
      assert.ok(types[0] === 'component', maker);
      assert.deepEqual(types.slice(-2), ['app', 'battery'], maker);
      assert.ok(g.steps.length >= 1 && g.steps.every((s) => s.includes('›')), `${maker}: every step names where`);
    }
    const xiaomi = keepAliveGuide({ maker: 'xiaomi', name: 'Redmi' });
    assert.deepEqual(xiaomi.targets[0], { type: 'component', pkg: 'com.miui.securitycenter', cls: 'com.miui.permcenter.autostart.AutoStartManagementActivity' });
  });

  test('Samsung: Unrestricted in App info, and not in the sleeping apps', () => {
    const g = keepAliveGuide({ maker: 'samsung', name: 'Samsung' });
    assert.deepEqual(g.steps, [
      'Battery: choose “Unrestricted” in Settings › Apps › ÖRZA › Battery.',
      'Sleeping apps: make sure ÖRZA isn’t listed in Settings › Battery › Background usage limits.',
    ]);
    assert.deepEqual(g.targets, [{ type: 'app' }, { type: 'battery' }]);
  });

  test('every maker screen’s package is in the alarms module’s <queries> (Android 11+ package visibility)', () => {
    const manifest = readFileSync(new URL('../../modules/orza-alarms/android/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
    const queries = manifest.match(/<queries>([\s\S]*?)<\/queries>/)?.[1] ?? '';
    const declared = new Set([...queries.matchAll(/<package android:name="([^"]+)"/g)].map((m) => m[1]));
    const used = new Set<string>();
    for (const maker of ['vivo', 'xiaomi', 'oppo', 'huawei', 'samsung'] as const) {
      for (const t of keepAliveGuide({ maker, name: maker }).targets) if (t.type === 'component') used.add(t.pkg);
    }
    assert.deepEqual([...used].sort(), [...declared].sort());
    assert.doesNotMatch(manifest, /<uses-permission android:name="android\.permission\.QUERY_ALL_PACKAGES"/);
  });

  test('never the "ignore battery optimisations" request (Google Play restricts it): only screens the member changes', () => {
    for (const maker of ['vivo', 'xiaomi', 'oppo', 'huawei', 'samsung'] as const) {
      const json = JSON.stringify(keepAliveGuide({ maker, name: maker }).targets);
      assert.doesNotMatch(json, /REQUEST_IGNORE_BATTERY_OPTIMIZATIONS/i, maker);
    }
  });
});

describe('when the sheet shows by itself (once, after the first medicine alarm)', () => {
  const ready: KeepAliveOfferInputs = { maker: 'vivo', seen: false, doseAlarms: 3, notificationsGranted: true, busy: false };

  test('a medicine alarm set on such a phone, never shown before: yes', () => {
    assert.equal(shouldOfferKeepAlive(ready), true);
  });

  test('not before an alarm is set, without notifications, over another sheet, a second time, or on other phones', () => {
    assert.equal(shouldOfferKeepAlive({ ...ready, doseAlarms: 0 }), false, 'no medicine alarm yet');
    assert.equal(shouldOfferKeepAlive({ ...ready, notificationsGranted: false }), false, 'alarms can’t ring anyway');
    assert.equal(shouldOfferKeepAlive({ ...ready, busy: true }), false, 'another sheet / the alarm screen');
    assert.equal(shouldOfferKeepAlive({ ...ready, seen: true }), false, 'once per install');
    assert.equal(shouldOfferKeepAlive({ ...ready, maker: null }), false, 'a maker not known to close apps');
  });

  test('Samsung only while its battery isn’t "Unrestricted"; other makers whatever Android’s exemption says', () => {
    assert.equal(shouldOfferKeepAlive({ ...ready, maker: 'samsung', batteryUnrestricted: false }), true);
    assert.equal(shouldOfferKeepAlive({ ...ready, maker: 'samsung', batteryUnrestricted: true }), false);
    assert.equal(shouldOfferKeepAlive({ ...ready, maker: 'samsung' }), true, 'not known: shown');
    assert.equal(shouldOfferKeepAlive({ ...ready, batteryUnrestricted: true }), true, 'vivo closes apps anyway');
  });

  test('the way back on Alarms on this phone: such phones only (Samsung without Unrestricted)', () => {
    assert.equal(keepAliveRowShown('vivo', true), true);
    assert.equal(keepAliveRowShown('samsung', true), false);
    assert.equal(keepAliveRowShown('samsung', null), true);
    assert.equal(keepAliveRowShown(null, false), false);
  });
});
