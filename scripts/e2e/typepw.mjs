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
// `input text` needs spaces as %s and shell metacharacters escaped.
const escaped = a.password.replace(/([\\'"`$&|;<>()*?!#~ ])/g, (c) => (c === ' ' ? '%s' : `\\${c}`));
execFileSync(adb, ['shell', 'input', 'text', escaped], { stdio: ['ignore', 'ignore', 'inherit'] });
console.log(`typed the password for ${email}`);
