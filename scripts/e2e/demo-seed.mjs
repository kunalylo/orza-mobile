// Fills a sample account on the LOCAL test server (http://localhost:3100 ONLY, never production) with three days of
// everyday data for store screenshots (docs/store/listing.md §4.1): home-style vegetarian Indian meals logged by hand
// (no AI), water, two weigh-ins, and two common supplements on a schedule with plain product photos, the past doses and
// today's mid-day dose marked taken. Steps come from Health Connect on the phone (Health Connect Toolbox on the emulator),
// not from here. The account's "today" should be mid-day when shooting: the 2026-11-14 Play set used an emulator and
// profile timezone of America/Denver (early afternoon there while it was night in India).
// Usage: node scripts/e2e/demo-seed.mjs <email> <photoDir> [lunch]
//   <photoDir> holds strip.jpg and bottle.jpg (scripts/e2e/demo-pill-photos.mjs). "lunch" also logs today's lunch.
// "Today" is the account's own day (its profile timezone). Logs in like api.mjs (password from test-accounts.json, never
// printed). Run it once on a fresh account: it doesn't look for earlier entries.
import fs from 'node:fs';
import path from 'node:path';

const [email, photoDir, withLunch] = process.argv.slice(2);
if (!email || !photoDir) {
  console.error('usage: node scripts/e2e/demo-seed.mjs <email> <photoDir> [lunch]');
  process.exit(2);
}
const BASE = 'http://localhost:3100/api';
const raw = JSON.parse(fs.readFileSync('E:/aylo/orza-localtest/.data/test-accounts.json', 'utf8'));
const acct = raw.accounts.find((a) => a.email === email);
if (!acct) throw new Error(`no local test account ${email}`);

const login = await fetch(`${BASE}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'X-ORZA-Client': 'mobile', 'X-ORZA-Device': 'qa-cli', 'X-ORZA-Platform': 'android' },
  body: JSON.stringify({ email, password: acct.password }),
}).then((r) => r.json());
if (!login.token) throw new Error('login failed');
async function call(method, p, body) {
  const r = await fetch(`${BASE}${p}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${login.token}`, 'X-ORZA-Client': 'mobile' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${p} → ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  return j;
}

const me = (await call('GET', '/auth/me')).user;
const tz = me.profile?.timezone || 'Asia/Kolkata';
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const today = ymd(new Date());
const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
// The UTC instant of a wall-clock time on a day in the account's timezone.
function zoned(day, hhmm) {
  const guess = Date.parse(`${day}T${hhmm}:00Z`);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(guess))
      .map((p) => [p.type, p.value]),
  );
  const asIfUtc = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00Z`);
  return new Date(guess - (asIfUtc - guess)).toISOString();
}
console.log(`${me.name} · ${tz} · today ${today}`);

// Per default serving, from ÖRZA's own food list (src/lib/nutrition/foods.ts on the web): kcal, protein, carbs, fat, fibre.
const FOOD = {
  poha: ['Poha', 'plate', 150, [230, 4.5, 38, 7, 2]],
  chai: ['Chai', 'cup', 150, [85, 2.3, 13.5, 2.2, 0]],
  roti: ['Roti', 'piece', 40, [110, 3.6, 21, 1.2, 3]],
  dal_tadka: ['Dal Tadka', 'katori', 150, [170, 7.5, 20, 7, 4.5]],
  bhindi: ['Bhindi Masala', 'katori', 150, [130, 3, 11, 8.5, 4.5]],
  lauki: ['Lauki Sabzi', 'katori', 150, [80, 1.5, 8, 5, 2.5]],
  mixed_veg: ['Mixed Veg Sabzi', 'katori', 150, [130, 3.5, 13, 7, 4.5]],
  curd: ['Curd (Dahi)', 'katori', 150, [95, 5.3, 7, 5, 0]],
  rice: ['Steamed Rice', 'plate', 250, [325, 6.8, 71, 0.8, 1]],
  khichdi: ['Moong Dal Khichdi', 'bowl', 200, [240, 9, 38, 5.5, 4]],
  moong_chilla: ['Moong Dal Chilla', 'piece', 80, [150, 9, 18, 5, 3]],
  banana: ['Banana', 'piece', 100, [105, 1.3, 27, 0.4, 3.1]],
  apple: ['Apple', 'piece', 150, [78, 0.4, 21, 0.3, 3.6]],
  papaya: ['Papaya', 'katori', 150, [60, 0.7, 15, 0.4, 2.5]],
  makhana: ['Roasted Makhana', 'bowl', 25, [100, 3.5, 17, 2, 2]],
};
const r1 = (n) => Math.round(n * 10) / 10;
const item = (key, q = 1) => {
  const [name, unit, g, [kcal, p, c, f, fib]] = FOOD[key];
  return { name, quantity: q, unit, grams: Math.round(g * q), calories: Math.round(kcal * q), protein_g: r1(p * q), carbs_g: r1(c * q), fat_g: r1(f * q), fiber_g: r1(fib * q) };
};
const meal = (date, meal_type, items) => call('POST', '/meals/manual', { date, meal_type, items: items.map(([k, q]) => item(k, q)) });

const d2 = addDays(today, -2);
const d1 = addDays(today, -1);
const MEALS = [
  [d2, 'breakfast', [['poha', 1], ['chai', 1]]],
  [d2, 'lunch', [['roti', 2], ['dal_tadka', 1], ['bhindi', 1], ['curd', 1]]],
  [d2, 'snack', [['banana', 1], ['chai', 1]]],
  [d2, 'dinner', [['khichdi', 1], ['lauki', 1]]],
  [d1, 'breakfast', [['moong_chilla', 2], ['chai', 1]]],
  [d1, 'lunch', [['rice', 0.8], ['dal_tadka', 1], ['mixed_veg', 1], ['curd', 1]]],
  [d1, 'snack', [['apple', 1], ['makhana', 1]]],
  [d1, 'dinner', [['roti', 2], ['mixed_veg', 1]]],
  [today, 'breakfast', [['poha', 1], ['chai', 1]]],
  [today, 'snack', [['papaya', 1]]],
];
if (withLunch === 'lunch') MEALS.push([today, 'lunch', [['roti', 2], ['dal_tadka', 1], ['lauki', 1], ['curd', 1]]]);
for (const [date, type, items] of MEALS) {
  const m = (await meal(date, type, items)).meal;
  console.log(`meal ${date} ${type}: ${m.description} (${Math.round(m.totals?.calories ?? m.calories ?? 0)} kcal)`);
}

for (const [date, glasses] of [[d2, 8], [d1, 9], [today, 5]]) await call('POST', '/track/water', { date, glasses });
console.log('water: 8, 9, 5 glasses');
for (const [date, weight_kg] of [[addDays(today, -6), 66.4], [today, 65.8]]) await call('POST', '/track/weight', { date, weight_kg });
console.log('weight: 66.4 kg (6 days ago), 65.8 kg (today)');

const photo = (f) => `data:image/jpeg;base64,${fs.readFileSync(path.join(photoDir, f)).toString('base64')}`;
// Two everyday supplements (the Play set of 2026-11-14): a mid-day dose that is already taken when the screenshots are made
// in the early afternoon, and an evening one still to come.
const MEDS = [
  {
    name: 'Vitamin B12', strength: '1500 mcg', form: 'tablet', dose: '1 tablet', timing: 'after_food',
    instructions: 'After lunch', schedule: { times: ['11:45'], start_date: today },
    stock: { count: 28, unit: 'tablets', refill_alert_at: 7 }, photos: [photo('strip.jpg')],
  },
  {
    name: 'Calcium + Vitamin D3', strength: '500 mg', form: 'tablet', dose: '1 tablet', timing: 'after_food',
    instructions: 'After dinner', schedule: { times: ['21:00'], start_date: d2 },
    stock: { count: 54, unit: 'tablets', refill_alert_at: 7 }, photos: [photo('bottle.jpg')],
  },
];
const meds = [];
for (const m of MEDS) {
  const med = (await call('POST', '/meds', m)).medication;
  meds.push(med);
  console.log(`medicine: ${med.name} ${med.strength} at ${med.schedule.times.join(', ')} · ${med.photo_urls?.length ?? 0} photo`);
}
// Every dose so far taken, a few minutes after its time: the two past evenings' Calcium, and today's B12 (shoot after
// 11:45 in the account's timezone, or Medicines shows a dose "taken" before it was due).
const taken = [
  [meds[1], d2, '21:00'],
  [meds[1], d1, '21:00'],
  [meds[0], today, '11:45'],
];
for (const [med, day, time] of taken) {
  const scheduled_for = zoned(day, time);
  const acted_at = new Date(Date.parse(scheduled_for) + 4 * 60000).toISOString();
  const { dose } = await call('POST', '/meds/doses', { medication_id: med.id, scheduled_for, action: 'take', acted_at });
  console.log(`dose taken: ${med.name} ${day} ${time} → ${dose.status}`);
}
