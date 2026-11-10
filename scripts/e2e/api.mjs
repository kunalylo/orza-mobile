// Local test server helper — http://localhost:3100 ONLY (never production).
// Usage: node scripts/e2e/api.mjs <email> <METHOD> <path> [jsonBody]
//   e.g. node scripts/e2e/api.mjs qa4@orza.test GET /meds/today
// Logs in as a QA account from E:\aylo\orza-localtest\.data\test-accounts.json (the password is never printed) and caches the
// session token under the OS temp folder. In Git Bash set MSYS_NO_PATHCONV=1, or "/meds" is rewritten into a Windows path.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [email, method, p, body] = process.argv.slice(2);
if (!email || !method || !p) {
  console.error('usage: node scripts/e2e/api.mjs <email> <METHOD> <path> [jsonBody]');
  process.exit(2);
}
const BASE = 'http://localhost:3100/api';
const ACCOUNTS = 'E:/aylo/orza-localtest/.data/test-accounts.json';
const tokDir = path.join(os.tmpdir(), 'orza-e2e');
fs.mkdirSync(tokDir, { recursive: true });
const tokFile = path.join(tokDir, `.tok-${email}`);
const mobile = { 'X-ORZA-Client': 'mobile', 'X-ORZA-Device': 'qa-cli', 'X-ORZA-Platform': 'android' };

async function login() {
  const raw = JSON.parse(fs.readFileSync(ACCOUNTS, 'utf8'));
  const accts = Array.isArray(raw) ? raw : raw.accounts;
  const a = accts.find((x) => x.email === email);
  if (!a) throw new Error(`no local test account ${email}`);
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...mobile },
    body: JSON.stringify({ email, password: a.password }),
  });
  const j = await r.json();
  if (!j.token) throw new Error(`login failed ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  fs.writeFileSync(tokFile, j.token);
  return j.token;
}

let tok = fs.existsSync(tokFile) ? fs.readFileSync(tokFile, 'utf8') : await login();
const call = () =>
  fetch(`${BASE}${p}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}`, 'X-ORZA-Client': 'mobile' },
    body: body ?? undefined,
  });
let r = await call();
if (r.status === 401) {
  tok = await login();
  r = await call();
}
const t = await r.text();
console.log(r.status, t.slice(0, 4000));
