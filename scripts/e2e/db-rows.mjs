// Read-only view of the LOCAL test server's JSON DB (E:\aylo\orza-localtest\.data\orza-db.json) for a QA account.
// Never touches production; never prints passwords or tokens.
// Usage: node scripts/e2e/db-rows.mjs <email> [fromDate=YYYY-MM-DD] [--since=ISO]
//   - tracking steps rows from fromDate (default: 7 days ago): steps, edit marker / value, updated_at (IST);
//   - sessions and devices rows created / seen since --since (default: the last 2 h), to prove the app reached THIS server.
import fs from 'node:fs';

const DB = 'E:/aylo/orza-localtest/.data/orza-db.json';
const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith('--') && a.includes('@'));
if (!email) {
  console.error('usage: node scripts/e2e/db-rows.mjs <email> [fromDate] [--since=ISO]');
  process.exit(2);
}
const from = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
const sinceArg = args.find((a) => a.startsWith('--since='));
const since = sinceArg ? Date.parse(sinceArg.slice(8)) : Date.now() - 2 * 3600e3;

const db = JSON.parse(fs.readFileSync(DB, 'utf8'));
const user = db.users.find((u) => u.email === email);
if (!user) {
  console.error(`no user ${email} in the local DB`);
  process.exit(1);
}
const ist = (s) => (s ? new Date(Date.parse(s) + 5.5 * 3600e3).toISOString().slice(0, 19).replace('T', ' ') : '-');

console.log(`tracking (steps) for ${email} from ${from}:`);
for (const r of db.tracking.filter((t) => t.user_id === user.id && t.date >= from).sort((a, b) => (a.date < b.date ? -1 : 1))) {
  console.log(
    ` ${r.date} steps ${r.steps ?? '-'} | edited_at ${ist(r.steps_edited_at)} value ${r.steps_edited_value ?? '-'} | updated ${ist(r.updated_at)}`
  );
}
const recent = (t) => t && Date.parse(t) >= since;
console.log(`sessions since ${ist(new Date(since).toISOString())} IST:`);
for (const s of db.sessions.filter((x) => x.user_id === user.id && recent(x.created_at))) {
  console.log(` ${ist(s.created_at)} ${s.kind ?? ''} ${s.platform ?? ''} ${s.device_label ?? ''}`);
}
console.log('devices seen since then:');
for (const d of db.devices.filter((x) => x.user_id === user.id && (recent(x.created_at) || recent(x.last_seen_at) || recent(x.updated_at)))) {
  console.log(` created ${ist(d.created_at)} last_seen ${ist(d.last_seen_at)} updated ${ist(d.updated_at)} ${d.platform ?? ''} ${d.label ?? ''} ${d.app_version ?? ''}`);
}
