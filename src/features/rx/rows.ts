/**
 * Review rows (ported from the web's ReviewTable.tsx): building rows from a scan, the blank manual row, the checks
 * that block "Create alarms", and the photo hand-off from the capture screen to manual entry.
 */
import { DEFAULT_DOSE, formatTime12, isHHMM, MAX_TIMES, TIMING_LABEL } from '@/features/meds/shared';

import type { ExtractedMedicine, ReviewRow } from './types';

export const LOW_CONFIDENCE = 0.6;
export const MAX_ROWS = 20;
export const MAX_ROW_TIMES = MAX_TIMES;

let seq = 0;
export const rowKey = () => `row-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export function toRows(meds: ExtractedMedicine[]): ReviewRow[] {
  return meds.map((m) => ({ ...m, times: [...m.times], key: rowKey(), include: true }));
}

export function emptyRow(): ReviewRow {
  return {
    key: rowKey(),
    include: true,
    name: '',
    form: 'tablet',
    dose: DEFAULT_DOSE.tablet,
    timing: 'any',
    times: ['08:00', '21:00'],
    frequency_text: '1-0-1',
    as_needed: false,
    confidence: 1,
  };
}

export const isLowConfidence = (r: Pick<ReviewRow, 'confidence'>) => (r.confidence ?? 1) < LOW_CONFIDENCE;

/** Problems that block "Create alarms" for one included row (null = fine). */
export function rowProblem(r: ReviewRow): string | null {
  if (!r.include) return null;
  if (!r.name.trim()) return "Add the medicine's name.";
  if (!r.dose.trim()) return 'Add the dose, e.g. 1 tablet.';
  if (!r.as_needed && !r.times.filter(isHHMM).length) return 'Add at least one alarm time, or mark it SOS.';
  if (r.duration_days != null && (!Number.isInteger(r.duration_days) || r.duration_days < 1 || r.duration_days > 365)) {
    return 'Days should be 1 to 365 (leave empty if ongoing).';
  }
  return null;
}

/** Row → the apply body (trimmed, sorted unique times, no UI keys). */
export function toApplyMedicine({ key: _key, include: _include, ...m }: ReviewRow): ExtractedMedicine {
  const out: ExtractedMedicine = {
    ...m,
    name: m.name.trim(),
    dose: m.dose.trim(),
    strength: m.strength?.trim() || undefined,
    times: m.as_needed ? [] : [...new Set(m.times.filter(isHHMM))].sort(),
  };
  if (!out.strength) delete out.strength;
  if (out.duration_days == null) delete out.duration_days;
  return out;
}

/** "8:00 AM · 9:00 PM" (or "Only when needed"). */
export function timesText(r: Pick<ReviewRow, 'as_needed' | 'times'>): string {
  if (r.as_needed) return 'Only when needed — no alarms';
  const valid = [...r.times].filter(isHHMM).sort();
  return valid.length ? valid.map(formatTime12).join(' · ') : 'No alarm time yet';
}

/** "1 tablet · After food · 5 days". */
export function rowSummary(r: ReviewRow): string {
  return [
    r.dose.trim(),
    r.timing !== 'any' ? TIMING_LABEL[r.timing] : '',
    r.duration_days ? `${r.duration_days} day${r.duration_days === 1 ? '' : 's'}` : r.as_needed ? '' : 'Ongoing',
  ]
    .filter(Boolean)
    .join(' · ');
}

/* ───────────────────────────── Photo hand-off ───────────────────────────── */

/**
 * The photo picked on the capture screen when the member chooses to type the medicines instead. Data URLs are far
 * too big for route params, so the review screen takes it from here once.
 */
let pendingPhoto: string | null = null;

export const rxPhotoDraft = {
  set(dataUrl: string | null) {
    pendingPhoto = dataUrl;
  },
  take(): string | null {
    const p = pendingPhoto;
    pendingPhoto = null;
    return p;
  },
};
