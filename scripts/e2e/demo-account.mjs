// Creates a sample account on the LOCAL test server (http://localhost:3100 ONLY, never production) for store screenshots.
// Usage: node scripts/e2e/demo-account.mjs <email> <name> [note]
//   e.g. node scripts/e2e/demo-account.mjs asha.demo@orza.test Asha "Play screenshots sample account"
// Generates a random password, adds {name, email, password, note} to E:\aylo\orza-localtest\.data\test-accounts.json (so
// api.mjs / typepw.mjs can use it) and registers it via POST /api/auth/register as the phone app does. The password is never
// printed. Then onboard it with api.mjs (/onboarding/step) and sign in on the emulator with typepw.mjs.
import crypto from 'node:crypto';
import fs from 'node:fs';

const [email, name, note = 'store screenshots sample account'] = process.argv.slice(2);
if (!email || !name || !/@orza\.test$/.test(email)) {
  console.error('usage: node scripts/e2e/demo-account.mjs <email@orza.test> <name> [note]');
  process.exit(2);
}
const BASE = 'http://localhost:3100/api';
const ACCOUNTS = 'E:/aylo/orza-localtest/.data/test-accounts.json';

const raw = JSON.parse(fs.readFileSync(ACCOUNTS, 'utf8'));
if (raw.accounts.some((a) => a.email === email)) {
  console.error(`${email} is already in test-accounts.json`);
  process.exit(1);
}
// Letters and digits only: `adb shell input text` (typepw.mjs) types them without escaping.
const password = `Demo${crypto.randomBytes(9).toString('base64url').replace(/[-_]/g, 'x')}9`;
raw.accounts.push({ name, email, password, note: `${note} (${new Date().toISOString().slice(0, 10)}): created via POST /api/auth/register (mobile client) on the LOCAL server` });
fs.writeFileSync(ACCOUNTS, `${JSON.stringify(raw, null, 2)}\n`);

const r = await fetch(`${BASE}/auth/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'X-ORZA-Client': 'mobile', 'X-ORZA-Device': 'qa-cli', 'X-ORZA-Platform': 'android' },
  body: JSON.stringify({ name, email, password }),
});
const j = await r.json();
console.log(r.status, j.user ? `registered ${j.user.email} (${j.user.name}), id ${j.user.id}` : JSON.stringify(j).slice(0, 300));
if (!j.user) process.exit(1);
