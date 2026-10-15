/**
 * Schedule editor state (ported from the web's ScheduleEditor.tsx): the draft the form edits, conversion to the
 * API schedule with friendly errors, and the quick Indian prescription patterns.
 */
import { addDaysISO, daysBetweenISO, isHHMM, isISODate, MAX_TIMES } from './shared';
import type { Schedule } from './types';

export interface ScheduleDraft {
  as_needed: boolean;
  times: string[];
  repeat: 'daily' | 'weekdays' | 'interval';
  days: number[];
  every_n_days: string;
  start_date: string;
  end_mode: 'ongoing' | 'days' | 'date';
  duration_days: string;
  end_date: string;
}

export function draftFromSchedule(s: Schedule | null, asNeeded: boolean, today: string): ScheduleDraft {
  if (!s) {
    return { as_needed: false, times: ['08:00'], repeat: 'daily', days: [], every_n_days: '2', start_date: today, end_mode: 'ongoing', duration_days: '5', end_date: '' };
  }
  const n = s.every_n_days && s.every_n_days > 1 ? s.every_n_days : 1;
  return {
    as_needed: asNeeded,
    times: s.times.length ? [...s.times] : asNeeded ? [] : ['08:00'],
    repeat: n > 1 ? 'interval' : s.days?.length ? 'weekdays' : 'daily',
    days: s.days?.length ? [...s.days] : [],
    every_n_days: String(n > 1 ? n : 2),
    start_date: s.start_date,
    end_mode: s.end_date ? 'date' : 'ongoing',
    duration_days: s.end_date ? String(daysBetweenISO(s.start_date, s.end_date) + 1) : '5',
    end_date: s.end_date || '',
  };
}

/** Draft → API schedule. Returns an error message instead when something needs fixing. */
export function scheduleFromDraft(d: ScheduleDraft): { schedule: Schedule } | { error: string } {
  const times = [...new Set(d.times.filter(isHHMM))].sort();
  if (!d.as_needed && !times.length) return { error: 'Add at least one time for the alarm.' };
  if (times.length > MAX_TIMES) return { error: `Up to ${MAX_TIMES} times a day.` };
  if (!isISODate(d.start_date)) return { error: 'Choose a start date.' };
  const schedule: Schedule = { times, days: [], start_date: d.start_date };
  // SOS never rings, and the editor hides Repeat for it — so neither check nor send those settings. The draft keeps
  // them, so "Set alarm times instead" brings them back.
  const repeat = d.as_needed ? 'daily' : d.repeat;
  if (repeat === 'weekdays') {
    if (!d.days.length) return { error: 'Pick at least one day of the week.' };
    schedule.days = d.days.length === 7 ? [] : [...d.days].sort((a, b) => a - b);
  }
  if (repeat === 'interval') {
    const n = Number(d.every_n_days);
    if (!Number.isInteger(n) || n < 2 || n > 90) return { error: 'Repeat every 2 to 90 days.' };
    schedule.every_n_days = n;
  }
  if (d.end_mode === 'days') {
    const n = Number(d.duration_days);
    if (!Number.isInteger(n) || n < 1 || n > 365) return { error: 'The course length should be 1 to 365 days.' };
    schedule.end_date = addDaysISO(d.start_date, n - 1);
  } else if (d.end_mode === 'date') {
    if (!isISODate(d.end_date)) return { error: 'Choose an end date.' };
    if (d.end_date < d.start_date) return { error: "The end date can't be before the start date." };
    schedule.end_date = d.end_date;
  }
  return { schedule };
}

export interface QuickPattern {
  key: string;
  label: string;
  hint: string;
  times?: string[];
  as_needed?: boolean;
}

/** Same times as the web's `timesForPattern` (DEFAULT_SLOT_TIMES: morning 08:00, afternoon 14:00, night 21:00, bedtime 22:00). */
export const QUICK_PATTERNS: QuickPattern[] = [
  { key: '1-0-0', label: '1-0-0', hint: 'Morning', times: ['08:00'] },
  { key: '0-0-1', label: '0-0-1', hint: 'Night', times: ['21:00'] },
  { key: '1-0-1', label: '1-0-1', hint: 'Morning and night', times: ['08:00', '21:00'] },
  { key: '1-1-1', label: '1-1-1', hint: 'Morning, afternoon and night', times: ['08:00', '14:00', '21:00'] },
  { key: 'BD', label: 'BD', hint: 'Twice a day', times: ['08:00', '20:00'] },
  { key: 'TDS', label: 'TDS', hint: 'Three times a day', times: ['08:00', '14:00', '21:00'] },
  { key: 'HS', label: 'HS', hint: 'At bedtime', times: ['22:00'] },
  { key: 'SOS', label: 'SOS', hint: 'Only when needed — no alarms', as_needed: true },
];

/** Which quick pattern the draft currently matches (first match wins, like the web). */
export function activeQuickPattern(d: Pick<ScheduleDraft, 'as_needed' | 'times'>): string | undefined {
  if (d.as_needed) return 'SOS';
  const sorted = [...d.times].filter(isHHMM).sort().join(',');
  return QUICK_PATTERNS.find((q) => q.times && [...q.times].sort().join(',') === sorted)?.key;
}

/** A sensible next alarm time after the existing ones. */
export function nextTime(times: string[]): string {
  const valid = times.filter(isHHMM).sort();
  if (!valid.length) return '08:00';
  const [h, m] = valid[valid.length - 1].split(':').map(Number);
  for (const step of [4, 3, 2, 1]) {
    const nh = h + step;
    if (nh <= 23) {
      const t = `${String(nh).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      if (!valid.includes(t)) return t;
    }
  }
  for (let hh = 6; hh <= 23; hh++) {
    const t = `${String(hh).padStart(2, '0')}:00`;
    if (!valid.includes(t)) return t;
  }
  return '12:00';
}

/** Stable comparison key for unsaved-changes detection. */
export function draftKey(d: ScheduleDraft): string {
  return JSON.stringify({ ...d, times: [...d.times].sort(), days: [...d.days].sort() });
}
