/**
 * Medicines — labels and pure helpers (ported from the web's src/components/care/meds/shared.ts so wording matches).
 */
import type { TagTone } from '@/ui';

import type { DoseAction, DoseItem, DoseLog, DoseStatusView, DoseTiming, Medication, MedForm, PersonFilter, Schedule } from './types';

export const DEFAULT_TZ = 'Asia/Kolkata';
export const SNOOZE_MINUTES = 10;
/** Server limits (web src/app/api/meds/_shared.ts). */
export const MAX_PHOTOS_ON_CREATE = 4;
export const MAX_PHOTOS_PER_MEDICINE = 6;
export const MAX_TIMES = 12;

/* ───────────────────────────── Labels ───────────────────────────── */

export const FORM_OPTIONS: { value: MedForm; label: string }[] = [
  { value: 'tablet', label: 'Tablet' },
  { value: 'capsule', label: 'Capsule' },
  { value: 'syrup', label: 'Syrup / liquid' },
  { value: 'drops', label: 'Drops' },
  { value: 'injection', label: 'Injection' },
  { value: 'inhaler', label: 'Inhaler / spray' },
  { value: 'cream', label: 'Cream / ointment' },
  { value: 'powder', label: 'Powder / sachet' },
  { value: 'other', label: 'Other' },
];

export const FORM_LABEL = Object.fromEntries(FORM_OPTIONS.map((o) => [o.value, o.label])) as Record<MedForm, string>;

/** Suggested dose when the user picks a form (only while the dose field is untouched). */
export const DEFAULT_DOSE: Record<MedForm, string> = {
  tablet: '1 tablet',
  capsule: '1 capsule',
  syrup: '5 ml',
  drops: '1 drop',
  injection: '1 injection',
  inhaler: '1 puff',
  cream: 'Apply a thin layer',
  powder: '1 sachet',
  other: '1 dose',
};

export const STOCK_UNITS = ['tablets', 'capsules', 'doses', 'sachets', 'puffs', 'injections'];

export function stockUnitFor(form: MedForm): string {
  if (form === 'capsule') return 'capsules';
  if (form === 'tablet') return 'tablets';
  if (form === 'powder') return 'sachets';
  if (form === 'inhaler') return 'puffs';
  if (form === 'injection') return 'injections';
  return 'doses';
}

export const TIMING_OPTIONS: { value: DoseTiming; label: string }[] = [
  { value: 'any', label: 'Any time' },
  { value: 'before_food', label: 'Before food' },
  { value: 'after_food', label: 'After food' },
  { value: 'with_food', label: 'With food' },
  { value: 'empty_stomach', label: 'Empty stomach' },
  { value: 'bedtime', label: 'At bedtime' },
];

export const TIMING_LABEL = Object.fromEntries(TIMING_OPTIONS.map((o) => [o.value, o.label])) as Record<DoseTiming, string>;

/** Sentence used on the alarm: "Take it after food." */
export const TIMING_INSTRUCTION: Record<DoseTiming, string> = {
  any: '',
  before_food: 'Take it before food',
  after_food: 'Take it after food',
  with_food: 'Take it with food',
  empty_stomach: 'Take it on an empty stomach',
  bedtime: 'Take it at bedtime',
};

export const STATUS_META: Record<DoseStatusView, { label: string; tone: TagTone }> = {
  upcoming: { label: 'Upcoming', tone: 'neutral' },
  due: { label: 'Due now', tone: 'energy' },
  snoozed: { label: 'Snoozed', tone: 'info' },
  taken: { label: 'Taken', tone: 'success' },
  skipped: { label: 'Skipped', tone: 'neutral' },
  missed: { label: 'Missed', tone: 'error' },
};

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** Monday-first order for weekday pickers. */
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/* ───────────────────────────── Formatting ───────────────────────────── */

export const isHHMM = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
export const isISODate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** "20:30" → "8:30 pm" */
export function formatTime12(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  if (!m) return hhmm;
  const h = Number(m[1]);
  const suffix = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]} ${suffix}`;
}

/** "2026-09-30" → "30 Sep" (adds the year when it differs from `refYear`). */
export function formatDateShort(date: string, refYear?: number): string {
  const [y, m, d] = (date || '').split('-').map(Number);
  if (!y || !m || !d) return date;
  const base = `${d} ${MONTHS[m - 1]}`;
  return refYear && refYear !== y ? `${base} ${y}` : base;
}

/** "2026-09-30" → "Wednesday, 30 September" */
export function formatDateLong(date: string): string {
  const [y, m, d] = (date || '').split('-').map(Number);
  if (!y || !m || !d) return date;
  return `${WEEKDAYS_LONG[weekdayOf(date)]}, ${d} ${MONTHS_LONG[m - 1]}`;
}

export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Calendar arithmetic on YYYY-MM-DD strings (timezone-free). */
export function addDaysISO(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function daysBetweenISO(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

/** Today's YYYY-MM-DD in the user's timezone. */
export function todayIn(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const get = (t: string) => parts.find((p) => p.type === t)?.value;
    const y = get('year');
    const m = get('month');
    const d = get('day');
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    // fall through
  }
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Wall-clock time in the user's timezone, e.g. "8:04 pm". */
export function clockIn(tz: string, d: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
    const h = parts.find((p) => p.type === 'hour')?.value;
    const m = parts.find((p) => p.type === 'minute')?.value;
    if (h && m) return formatTime12(`${h.padStart(2, '0')}:${m}`);
  } catch {
    // fall through
  }
  return formatTime12(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
}

/** "Every day", "Alternate days", "Mon, Wed, Fri", "Every 3 days". */
export function repeatSummary(s: Pick<Schedule, 'days' | 'every_n_days'>): string {
  const n = s.every_n_days && s.every_n_days > 1 ? s.every_n_days : 1;
  const days = s.days?.length && s.days.length < 7 ? s.days : [];
  const dayText = days.length
    ? [...days]
        .sort((a, b) => WEEKDAY_ORDER.indexOf(a) - WEEKDAY_ORDER.indexOf(b))
        .map((d) => WEEKDAYS[d])
        .join(', ')
    : '';
  if (n === 2) return dayText ? `Alternate days · ${dayText}` : 'Alternate days';
  if (n === 7 && !dayText) return 'Once a week';
  if (n > 1) return dayText ? `Every ${n} days · ${dayText}` : `Every ${n} days`;
  if (dayText === 'Mon, Tue, Wed, Thu, Fri') return 'Weekdays';
  if (dayText === 'Sat, Sun') return 'Weekends';
  return dayText || 'Every day';
}

/** "Every day · 8:00 am, 9:00 pm · until 30 Sep" */
export function scheduleSummary(m: Pick<Medication, 'schedule' | 'as_needed'>, today?: string): string {
  if (m.as_needed) return 'Only when needed (SOS) · no alarms';
  const s = m.schedule;
  const year = today ? Number(today.slice(0, 4)) : undefined;
  const parts = [repeatSummary(s), s.times.map(formatTime12).join(', ')];
  if (today && s.start_date > today) parts.push(`from ${formatDateShort(s.start_date, year)}`);
  if (s.end_date) parts.push(today && s.end_date < today ? `ended ${formatDateShort(s.end_date, year)}` : `until ${formatDateShort(s.end_date, year)}`);
  return parts.filter(Boolean).join(' · ');
}

/** Doses per day on average (for stock → days left). */
export function dosesPerDay(m: Pick<Medication, 'schedule' | 'as_needed'>): number {
  if (m.as_needed) return 0;
  const perActiveDay = m.schedule.times.length;
  const n = m.schedule.every_n_days && m.schedule.every_n_days > 1 ? m.schedule.every_n_days : 1;
  const dayShare = m.schedule.days?.length ? m.schedule.days.length / 7 : 1;
  return (perActiveDay * dayShare) / n;
}

/** Stock threshold at which "Refill soon" shows: the user's own, else ~5 days of doses (min 5). */
export function refillThreshold(m: Pick<Medication, 'schedule' | 'as_needed' | 'stock'>): number {
  if (m.stock?.refill_alert_at != null) return m.stock.refill_alert_at;
  return Math.max(5, Math.ceil(dosesPerDay(m) * 5));
}

export function needsRefill(m: Pick<Medication, 'schedule' | 'as_needed' | 'stock' | 'active'>): boolean {
  return !!m.active && !!m.stock && m.stock.count <= refillThreshold(m);
}

/** "About 6 days left" — null when unknown. */
export function daysLeftText(m: Pick<Medication, 'schedule' | 'as_needed' | 'stock'>): string | null {
  if (!m.stock) return null;
  const perDay = dosesPerDay(m);
  if (!perDay) return null;
  const d = Math.floor(m.stock.count / perDay);
  if (d <= 0) return 'Runs out today';
  return d === 1 ? 'About 1 day left' : `About ${d} days left`;
}

export function medicineTitle(m: { name: string; strength?: string }): string {
  return [m.name, m.strength].filter(Boolean).join(' ');
}

/** "500 mg · 1 tablet · Tablet" */
export function medicineSubtitle(m: Pick<Medication, 'strength' | 'dose' | 'form'>): string {
  return [m.strength, m.dose, m.form !== 'other' ? FORM_LABEL[m.form] : null].filter(Boolean).join(' · ');
}

/** Is this dose still actionable (not taken / skipped)? */
export const isOpen = (d: Pick<DoseItem, 'status'>) => d.status !== 'taken' && d.status !== 'skipped';

/** What needs attention first — due, missed, snoozed, upcoming, then done. */
export function attentionRank(s: DoseStatusView): number {
  return { due: 0, missed: 1, snoozed: 2, upcoming: 3, taken: 4, skipped: 5 }[s];
}

export const doseKey = (d: Pick<DoseItem, 'medication_id' | 'scheduled_for'>) => `${d.medication_id}:${d.scheduled_for}`;

/** The dose after an action (optimistic UI). */
export function withAction(d: DoseItem, action: DoseAction, log?: Partial<DoseLog>): DoseItem {
  const status: DoseStatusView = action === 'take' ? 'taken' : action === 'skip' ? 'skipped' : 'snoozed';
  return {
    ...d,
    status,
    acted_at: log?.acted_at || new Date().toISOString(),
    snooze_until: action === 'snooze' ? log?.snooze_until || new Date(Date.now() + SNOOZE_MINUTES * 60000).toISOString() : undefined,
  };
}

/** "Taken at 8:04 pm", "Snoozed until 8:20 pm", "Due now"… */
export function statusDetail(d: DoseItem, tz: string): string {
  if (d.status === 'taken' && d.acted_at) return `Taken at ${clockIn(tz, new Date(d.acted_at))}`;
  if (d.status === 'skipped') return 'Skipped';
  if (d.status === 'snoozed' && d.snooze_until) return `Snoozed until ${clockIn(tz, new Date(d.snooze_until))}`;
  return STATUS_META[d.status].label;
}

/** Person filter (caregiver mode). */
export function matchesPerson(forPerson: string | undefined, filter: PersonFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'me') return !forPerson;
  return forPerson === filter;
}

/** Active first, then A–Z (the server's order). */
export function sortMedications<T extends Pick<Medication, 'active' | 'name'>>(list: T[]): T[] {
  return [...list].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}
