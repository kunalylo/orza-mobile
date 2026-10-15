/**
 * Pure helpers for the reminders screens — constants, presets and schedule text, ported from the website's
 * `components/care/reminders/shared.ts` (times read as "8:30 pm" like the rest of the app).
 */
import { formatTime12, isHHMM, todayIn } from '@/features/meds/shared';
import type { IconName } from '@/ui';

import type { ReminderChannels, ReminderKind, ReminderView, Schedule } from './types';

export { isHHMM };

/* ───────────────────────────── Kinds ───────────────────────────── */

export const REMINDER_KINDS: ReminderKind[] = ['meal', 'water', 'weight', 'custom'];

export const KIND_LABEL: Record<ReminderKind, string> = {
  meal: 'Meal',
  water: 'Water',
  weight: 'Weigh-in',
  custom: 'Custom',
};

export const KIND_DEFAULT_TITLE: Record<ReminderKind, string> = {
  meal: 'Log your meal',
  water: 'Drink a glass of water',
  weight: 'Weigh-in',
  custom: 'Reminder',
};

/** Default notification text when a reminder has no message of its own. */
export const KIND_DEFAULT_BODY: Record<ReminderKind, string> = {
  meal: 'Snap it, say it or type it — logging takes a few seconds.',
  water: 'A glass now keeps your energy steady.',
  weight: "Step on the scale and log today's weight.",
  custom: 'A gentle nudge from ÖRZA.',
};

export const KIND_ICON: Record<ReminderKind, IconName> = {
  meal: 'mci:silverware-fork-knife',
  water: 'droplet',
  weight: 'mci:scale-bathroom',
  custom: 'bell',
};

/** Icon tile colours per kind (energy for meals, cyan water, violet weigh-ins, amber custom). */
export const KIND_TONE: Record<ReminderKind, { bg: string; fg: string }> = {
  meal: { bg: '#FFF1EA', fg: '#C2410C' },
  water: { bg: '#E8FBFF', fg: '#0A6F82' },
  weight: { bg: '#F4F1FF', fg: '#6E3ED6' },
  custom: { bg: '#FFF4E6', fg: '#B06A00' },
};

export const DEFAULT_CHANNELS: ReminderChannels = { push: true, whatsapp: false, calendar: false };

export const MAX_REMINDERS = 50;
export const MAX_TIMES_PER_REMINDER = 24;

/* ───────────────────────────── Presets ───────────────────────────── */

export interface ReminderPreset {
  key: string;
  label: string;
  hint: string;
  kind: ReminderKind;
  title: string;
  body?: string;
  times: string[];
  days: number[];
}

const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const fromMinutes = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** "HH:MM" every `stepMinutes` from start to end inclusive (same day). */
export function timesEvery(start: string, end: string, stepMinutes: number): string[] {
  const s = toMinutes(start);
  const e = toMinutes(end);
  const step = Math.max(15, Math.round(stepMinutes));
  const out: string[] = [];
  for (let m = s; m <= e && out.length < MAX_TIMES_PER_REMINDER; m += step) out.push(fromMinutes(m));
  return out;
}

export const REMINDER_PRESETS: ReminderPreset[] = [
  { key: 'breakfast', label: 'Log breakfast', hint: 'Daily · 9:00 am', kind: 'meal', title: 'Log breakfast', times: ['09:00'], days: [] },
  { key: 'lunch', label: 'Log lunch', hint: 'Daily · 1:30 pm', kind: 'meal', title: 'Log lunch', times: ['13:30'], days: [] },
  { key: 'dinner', label: 'Log dinner', hint: 'Daily · 8:30 pm', kind: 'meal', title: 'Log dinner', times: ['20:30'], days: [] },
  {
    key: 'water',
    label: 'Water every 2 h',
    hint: '9 am – 9 pm',
    kind: 'water',
    title: 'Drink a glass of water',
    times: timesEvery('09:00', '21:00', 120),
    days: [],
  },
  { key: 'weigh-in', label: 'Weekly weigh-in', hint: 'Mondays · 7:30 am', kind: 'weight', title: 'Weekly weigh-in', times: ['07:30'], days: [1] },
];

export const sameTimes = (a: string[], b: string[]) => [...new Set(a)].sort().join() === [...new Set(b)].sort().join();

export const presetAdded = (p: ReminderPreset, list: ReminderView[]) =>
  list.some((r) => r.kind === p.kind && r.title === p.title && sameTimes(r.schedule.times, p.times));

/** "Add time" suggests two hours after the latest time (or noon). */
export function nextReminderTime(times: string[]): string {
  const last = [...times].filter(isHHMM).sort().pop();
  if (!last) return '12:00';
  const [h, m] = last.split(':').map(Number);
  return `${String(Math.min(23, h + 2)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Repeat-through-the-day intervals offered in the sheet (hours). */
export const REPEAT_EVERY = [0.5, 1, 1.5, 2, 3, 4];
export const repeatLabel = (h: number) => (h < 1 ? '30 min' : `${h} h`);

/* ───────────────────────────── Schedule text ───────────────────────────── */

export const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAYS_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** Display the week Monday-first (Indian calendars); values stay 0 = Sunday. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function describeDays(days: number[] | undefined): string {
  const set = [...new Set(days || [])].filter((d) => d >= 0 && d <= 6).sort();
  if (!set.length || set.length === 7) return 'Every day';
  if (set.join() === '1,2,3,4,5') return 'Weekdays';
  if (set.join() === '0,6') return 'Weekends';
  if (set.length === 1) return `${WEEKDAY_NAMES[set[0]]}s`;
  return [...set]
    .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
    .map((d) => WEEKDAYS_SHORT[d])
    .join(', ');
}

export function describeTimes(times: string[]): string {
  const t = [...new Set(times)].sort();
  if (t.length <= 3) return t.map(formatTime12).join(', ');
  return `${t.length}× a day · ${formatTime12(t[0])} – ${formatTime12(t[t.length - 1])}`;
}

export function describeSchedule(s: Pick<Schedule, 'times' | 'days' | 'every_n_days'>): string {
  const every = s.every_n_days && s.every_n_days > 1 ? `Every ${s.every_n_days} days` : describeDays(s.days);
  return `${every} · ${describeTimes(s.times)}`;
}

function partsIn(tz: string, d: Date): { date: string; time: string } {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour').padStart(2, '0')}:${get('minute')}` };
  } catch {
    const pad = (n: number) => String(n).padStart(2, '0');
    return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
  }
}

/** Friendly "Today 1:30 pm" / "Tomorrow 9:00 am" / "Mon 7:30 am" / "12 Oct 7:30 am" in the given timezone. */
export function describeNext(iso: string | null, tz: string, now: Date = new Date()): string {
  if (!iso) return '';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const target = partsIn(tz, at);
  const time = formatTime12(target.time);
  if (target.date === todayIn(tz)) return `Today ${time}`;
  if (target.date === partsIn(tz, new Date(now.getTime() + 86400000)).date) return `Tomorrow ${time}`;
  const [y, m, d] = target.date.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  if (at.getTime() - now.getTime() < 6 * 86400000) return `${WEEKDAYS_SHORT[utc.getUTCDay()]} ${time}`;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${months[m - 1]} ${time}`;
}

/** Active first, then by first time of day, then title (same order as the API). */
export function sortReminders(list: ReminderView[]): ReminderView[] {
  return [...list].sort(
    (a, b) =>
      Number(b.active) - Number(a.active) ||
      (a.schedule.times[0] || '').localeCompare(b.schedule.times[0] || '') ||
      a.title.localeCompare(b.title)
  );
}

/* ───────────────────────────── Phone numbers (WhatsApp) ───────────────────────────── */

export const E164_RE = /^\+[1-9]\d{7,14}$/;

export const COUNTRY_CODES: { code: string; label: string }[] = [
  { code: '+91', label: 'India' },
  { code: '+971', label: 'UAE' },
  { code: '+966', label: 'Saudi Arabia' },
  { code: '+974', label: 'Qatar' },
  { code: '+965', label: 'Kuwait' },
  { code: '+968', label: 'Oman' },
  { code: '+973', label: 'Bahrain' },
  { code: '+977', label: 'Nepal' },
  { code: '+880', label: 'Bangladesh' },
  { code: '+94', label: 'Sri Lanka' },
  { code: '+65', label: 'Singapore' },
  { code: '+60', label: 'Malaysia' },
  { code: '+44', label: 'UK' },
  { code: '+1', label: 'USA / Canada' },
  { code: '+61', label: 'Australia' },
  { code: '+64', label: 'New Zealand' },
];

/**
 * Turn what someone typed into E.164. A number starting with "+" (or "00") keeps its own country code;
 * otherwise `countryCode` (default +91) is added and a leading trunk "0" is dropped.
 */
export function toE164(raw: string, countryCode = '+91'): { ok: true; e164: string } | { ok: false; error: string } {
  const input = (raw || '').trim();
  if (!input) return { ok: false, error: 'Enter your WhatsApp number.' };
  if (/[^\d\s()+\-.]/.test(input)) return { ok: false, error: 'Use digits only, like 98765 43210.' };
  let digits = input.replace(/[\s()\-.]/g, '');
  let e164: string;
  if (digits.startsWith('+')) e164 = '+' + digits.slice(1).replace(/\+/g, '');
  else if (digits.startsWith('00')) e164 = '+' + digits.slice(2);
  else {
    digits = digits.replace(/^0+/, '');
    const cc = countryCode.replace(/[^\d]/g, '');
    if (cc === '91' && digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
    e164 = `+${cc}${digits}`;
  }
  if (!E164_RE.test(e164)) return { ok: false, error: "That doesn't look like a complete phone number." };
  if (e164.startsWith('+91') && !/^\+91[6-9]\d{9}$/.test(e164)) {
    return { ok: false, error: 'Indian mobile numbers have 10 digits and start with 6, 7, 8 or 9.' };
  }
  return { ok: true, e164 };
}

/** Split an E.164 number back into a known country code + national number for editing. */
export function splitE164(e164: string | null | undefined): { code: string; national: string } {
  if (!e164) return { code: '+91', national: '' };
  const match = [...COUNTRY_CODES].sort((a, b) => b.code.length - a.code.length).find((c) => e164.startsWith(c.code));
  if (!match) return { code: '+91', national: e164 };
  return { code: match.code, national: e164.slice(match.code.length) };
}

/** "+91 98765 43210" style display. */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  const { code, national } = splitE164(e164);
  if (national.startsWith('+')) return national;
  if (code === '+91' && national.length === 10) return `${code} ${national.slice(0, 5)} ${national.slice(5)}`;
  return `${code} ${national}`;
}

/** "Asia/Kolkata" → "Asia/Kolkata" with spaces for underscores ("America/New York"). */
export const tzLabel = (tz: string) => tz.replace(/_/g, ' ');
