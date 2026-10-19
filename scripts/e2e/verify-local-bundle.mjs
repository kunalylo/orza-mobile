#!/usr/bin/env node
/**
 * Safety gate for emulator testing: fetches the Android bundle Metro is serving and fails unless the app's API origin is
 * the LOCAL web test server (http://10.0.2.2:3100). Run it before any interaction that could write data, and after every
 * Metro restart. Exit 0 = safe, 1 = NOT safe (do not touch the app).
 *   node scripts/e2e/verify-local-bundle.mjs
 */
const METRO = process.env.METRO_URL || 'http://localhost:8081';
const EXPECTED = process.env.EXPECTED_API || 'http://10.0.2.2:3100';
const url =
  `${METRO}/node_modules/expo-router/entry.bundle?platform=android&dev=true&lazy=true&minify=false` +
  '&app=in.co.ylo.orza&modulesOnly=false&runModule=true&transform.routerRoot=src%2Fapp&unstable_transformProfile=hermes-stable';

const res = await fetch(url).catch((e) => ({ ok: false, statusText: e.message }));
if (!res.ok) {
  console.error(`NOT SAFE: could not fetch the bundle from Metro (${res.status ?? ''} ${res.statusText})`);
  process.exit(1);
}
const body = await res.text();
const m = body.match(/"EXPO_PUBLIC_API_URL":\s*\{[^}]*value:\s*"([^"]*)"/);
const origin = m?.[1];
if (origin !== EXPECTED) {
  console.error(`NOT SAFE: the app's EXPO_PUBLIC_API_URL is ${origin ? JSON.stringify(origin) : 'not set'} (expected ${EXPECTED}).`);
  process.exit(1);
}
console.log(`SAFE: the app talks to ${origin} (local web test server).`);
