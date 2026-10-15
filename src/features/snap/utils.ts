/**
 * Snap & Know helpers — copy and maths mirrored from the web (`components/meals/ScanPanels.tsx`, `ScanViewfinder.tsx`).
 */
import type { IconName, TagTone } from '@/ui';

/**
 * Longest side / JPEG quality / size cap for meal photos. Meal scans accept far larger uploads (≈ 6 MB) than medicine
 * photos; 2.5 MB keeps the base64 JSON body (≈ 3.4 MB) under the hosting platform's 4.5 MB request limit.
 */
export const SCAN_PHOTO = { maxSide: 1600, quality: 0.82, maxBytes: 2_500_000 } as const;

/** The AI usually answers in 5–20 s; leave room for slow networks. */
export const SCAN_TIMEOUT_MS = 90_000;

export const NOTE_MAX = 200;

/** Captions cycled under the scan line while ÖRZA analyses the photo. */
export const SCAN_STEPS = [
  'Spotting each item on the plate',
  'Estimating portions — katoris, rotis, plates',
  'Reading the cooking style and oil',
  'Adding up calories and macros',
];

export const SNAP_TIPS: { icon: IconName; title: string; body: string }[] = [
  { icon: 'sun', title: 'Good, even light', body: 'Daylight or a bright room works best — avoid harsh shadows and flash glare.' },
  { icon: 'crop', title: 'The whole plate in frame', body: 'Shoot from slightly above so every katori, roti and side is visible.' },
  { icon: 'mci:silverware-fork-knife', title: 'One plate at a time', body: 'Scan shared dishes or a second helping separately for a truer estimate.' },
  {
    icon: 'message-square',
    title: "Add what the camera can't see",
    body: 'Homemade or restaurant, extra ghee, half eaten — a short note sharpens the numbers.',
  },
];

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Honest range around the estimate — wider when ÖRZA is less sure. */
export function estimateRange(kcal: number, confidence: number): { low: number; high: number } {
  const spread = clamp(0.1 + (1 - confidence) * 0.35, 0.1, 0.35);
  return {
    low: Math.max(0, Math.round((kcal * (1 - spread)) / 10) * 10),
    high: Math.round((kcal * (1 + spread)) / 10) * 10,
  };
}

/** Confidence → tag tone + label (same thresholds as the web's `confidenceTone`). */
export function confidenceTone(c: number): { tone: TagTone; label: string } {
  if (c >= 0.8) return { tone: 'success', label: 'High confidence' };
  if (c >= 0.55) return { tone: 'info', label: 'Medium confidence' };
  return { tone: 'warning', label: 'Low confidence — please check' };
}

export const percent = (c: number) => `${Math.round(clamp(Number(c) || 0, 0, 1) * 100)}%`;
