// Types a LOCAL QA account's password into the focused field on the emulator, without printing it.
// Usage: node scripts/e2e/typepw.mjs <email>   (focus the password field first)
// Reads E:\aylo\orza-localtest\.data\test-accounts.json — local test accounts only.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const email = process.argv[2];
if (!email) {
  console.error('usage: node scripts/e2e/typepw.mjs <email>');
  process.exit(2);
}
const raw = JSON.parse(fs.readFileSync('E:/aylo/orza-localtest/.data/test-accounts.json', 'utf8'));
const accts = Array.isArray(raw) ? raw : raw.accounts;
const a = accts.find((x) => x.email === email);
if (!a) {
  console.error(`no local test account ${email}`);
  process.exit(1);
}
const adb = path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', 'adb.exe');
// Type only into a focused PASSWORD field: when a tap didn't move the focus (e.g. the keyboard covered the field on a
// small screen) the password would land in the email field in plain text — and any later screen dump would show it.
const dump = (() => {
  try {
    execFileSync(adb, ['shell', 'uiautomator', 'dump', '/sdcard/typepw.xml'], { stdio: 'ignore' });
    return execFileSync(adb, ['shell', 'cat', '/sdcard/typepw.xml'], { encoding: 'utf8' });
  } catch {
    return '';
  } finally {
    try {
      execFileSync(adb, ['shell', 'rm', '-f', '/sdcard/typepw.xml'], { stdio: 'ignore' });
    } catch {}
  }
})();
const focused = [...dump.matchAll(/<node\b[^>]*>/g)].map((m) => m[0]).find((n) => /focused="true"/.test(n) && /class="android\.widget\.EditText"/.test(n));
if (!focused || !/password="true"/.test(focused)) {
  console.error('typepw: the focused field is not a password field — tap the password field first (hide the keyboard if it covers it). Nothing typed.');
  process.exit(1);
}
// `input text` needs spaces as %s and shell metacharacters escaped.
const escaped = a.password.replace(/([\\'"`$&|;<>()*?!#~ ])/g, (c) => (c === ' ' ? '%s' : `\\${c}`));
execFileSync(adb, ['shell', 'input', 'text', escaped], { stdio: ['ignore', 'ignore', 'inherit'] });
console.log(`typed the password for ${email}`);
