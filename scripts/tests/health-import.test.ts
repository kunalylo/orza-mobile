/// <reference types="node" />
/**
 * The Health import without steps (steps v2 R6, `docs/notes/steps-v2.md` §0.5, §5, P5) — `npm run test:steps` runs this
 * file next to the steps tests. Pure: `health/sync.ts` hands the rows its bridge read to `aggregate.importRows` before
 * `POST /api/health/import`.
 *
 * Steps reach the account only through `POST /api/track/steps` (the steps sync, gated by the member's steps consent and
 * the "Count steps automatically" switch): the import never carries them, so it can't raise an edited day or a day the
 * member switched off, and an iPhone's Apple Health steps never ride along.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { importRows } from '../../src/lib/health/aggregate';
import { HEALTH_METRICS, IMPORT_METRICS, METRIC_INFO, PHONE_METRICS, type HealthDayInput } from '../../src/lib/health/types';

describe('what the phone reads and imports (P5, §0.5)', () => {
  test('the phone reads four kinds; the import sends three — never steps', () => {
    assert.deepEqual([...PHONE_METRICS], ['steps', 'sleep_minutes', 'resting_hr', 'weight_kg']);
    assert.deepEqual([...IMPORT_METRICS], ['sleep_minutes', 'resting_hr', 'weight_kg']);
    for (const m of PHONE_METRICS) assert.ok(HEALTH_METRICS.includes(m), `${m} is one of the server's metrics`);
    for (const m of IMPORT_METRICS) assert.ok(METRIC_INFO[m]);
  });

  test('steps are dropped from every day; a day left with nothing is not sent', () => {
    const days: HealthDayInput[] = [
      { date: '2026-10-28', steps: 6_400 },
      { date: '2026-10-29', steps: 9_100, sleep_minutes: 412, resting_hr: 61 },
      { date: '2026-10-30', weight_kg: 71.4 },
    ];
    assert.deepEqual(importRows(days), [
      { date: '2026-10-29', sleep_minutes: 412, resting_hr: 61 },
      { date: '2026-10-30', weight_kg: 71.4 },
    ]);
    assert.equal(days[1].steps, 9_100, 'the input is left as it was');
  });

  test('metrics the phone no longer reads are not sent either; nothing in → nothing out', () => {
    assert.deepEqual(importRows([{ date: '2026-10-29', active_kcal: 300, distance_km: 4.2, avg_hr: 80, water_ml: 1_500, sleep_minutes: 400 }]), [
      { date: '2026-10-29', sleep_minutes: 400 },
    ]);
    assert.deepEqual(importRows([]), []);
  });
});
