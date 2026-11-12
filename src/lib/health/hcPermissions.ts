/**
 * What ÖRZA asks Health Connect for (steps v2 P5) — pure (type imports only), so `npm run test:steps` covers it;
 * `bridge.android.ts` makes the calls.
 *
 * - The Health screen's Connect (`connectAsk`): the four types app.json declares.
 * - Today's steps card (`stepsAsk`): Steps alone.
 * - Both add "Access data in the background" where Health Connect offers it, so the hourly run can read while ÖRZA is
 *   closed. V2 real phone (B1): the Health screen's Connect used to ask without it, and nothing asked later (Today then
 *   counts), so a member who connected there had no background saves. With Steps granted already, the same steps ask
 *   shows only the background screen (the Health screen's "Allow background access").
 */
import type { BackgroundAccessPermission, Permission, RecordType } from 'react-native-health-connect';

import type { HealthMetric } from './types';

/**
 * Health Connect record type → the ÖRZA metric it feeds: the four types app.json declares (P5). Active calories,
 * distance, heart rate and hydration are no longer read (nor declared: Health Connect couldn't grant them).
 */
export const RECORDS = {
  Steps: 'steps',
  SleepSession: 'sleep_minutes',
  RestingHeartRate: 'resting_hr',
  Weight: 'weight_kg',
} as const satisfies Partial<Record<RecordType, HealthMetric>>;

export type ReadType = keyof typeof RECORDS;
export const READ_TYPES = Object.keys(RECORDS) as ReadType[];

const READS: Permission[] = READ_TYPES.map((recordType) => ({ accessType: 'read', recordType }));
const STEPS: Permission = { accessType: 'read', recordType: 'Steps' };
const BACKGROUND: BackgroundAccessPermission = { accessType: 'read', recordType: 'BackgroundAccessPermission' };

/** Health Connect's background reading on this phone (`healthFeatures().backgroundRead`). */
export type BackgroundRead = 'available' | 'unavailable';

type Ask = (Permission | BackgroundAccessPermission)[];

/** The Health screen's Connect: every type ÖRZA reads, plus background reading where Health Connect offers it. */
export function connectAsk(backgroundRead: BackgroundRead): Ask {
  return backgroundRead === 'available' ? [...READS, BACKGROUND] : [...READS];
}

/** Today's steps card (§2.2 `hc`), and the background ask once Steps is granted: Steps, plus background reading. */
export function stepsAsk(backgroundRead: BackgroundRead): Ask {
  return backgroundRead === 'available' ? [STEPS, BACKGROUND] : [STEPS];
}

/** Health Connect's grants (any permission list it answers with) → Steps, and background reading. */
export function stepsGrantOf(list: readonly { accessType: string; recordType: string }[]): { granted: boolean; background: boolean } {
  const has = (recordType: string) => list.some((p) => p.accessType === 'read' && p.recordType === recordType);
  return { granted: has('Steps'), background: has('BackgroundAccessPermission') };
}

/** The ÖRZA metrics among Health Connect's grants (the background permission isn't one). */
export function grantedMetrics(list: readonly { accessType: string; recordType: string }[]): HealthMetric[] {
  const metrics = new Set<HealthMetric>();
  for (const p of list) {
    if (p.accessType === 'read' && p.recordType in RECORDS) metrics.add(RECORDS[p.recordType as ReadType]);
  }
  return [...metrics];
}
