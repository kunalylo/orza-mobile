// Signs a LOCAL QA account in to the local website (http://localhost:3100 ONLY — never production) and prints a
// one-line `document.cookie = …` snippet to paste into a browser tab on http://localhost:3100 (then reload).
// Usage: node scripts/e2e/websession.mjs <email>
// The password is read from E:\aylo\orza-localtest\.data\test-accounts.json and never printed; the printed value is a
// short-lived session token of a local test account (sign out on the website to end it).
import fs from 'node:fs';

const email = process.argv[2];
if (!email) {
  console.error('usage: node scripts/e2e/websession.mjs <email>');
  process.exit(2);
}
const raw = JSON.parse(fs.readFileSync('E:/aylo/orza-localtest/.data/test-accounts.json', 'utf8'));
const accts = Array.isArray(raw) ? raw : raw.accounts;
const a = accts.find((x) => x.email === email);
if (!a) {
  console.error(`no local test account ${email}`);
  process.exit(1);
}
const r = await fetch('http://localhost:3100/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password: a.password }),
  redirect: 'manual',
});
const cookies = r.headers.getSetCookie?.() ?? [];
const session = cookies.map((c) => c.split(';')[0]).find((c) => c.startsWith('orza_session='));
if (!r.ok || !session) {
  console.error(`login failed: ${r.status}`);
  process.exit(1);
}
console.log(`document.cookie = ${JSON.stringify(`${session}; path=/; SameSite=Lax`)}; document.cookie = "orza_signed_in=1; path=/; SameSite=Lax";`);
