/** Health screen API shapes — mirrors the web's `src/components/care/health/metrics.ts`. */
import type { HealthDayValues, HealthMetric, HealthSource } from '@/lib/health/types';

export type { HealthMetric, HealthSource };

/** One calendar day merged across sources (steps/sleep = max, heart rate = average, weight = most recently updated). */
export type MergedHealthDay = { date: string; sources: HealthSource[] } & HealthDayValues;

export interface HealthSourceSummary {
  source: HealthSource;
  label: string;
  /** Days this source contributed inside the requested range. */
  days: number;
  first_date: string;
  last_date: string;
  last_updated: string;
}

/** GET /api/health/days */
export interface HealthDaysResponse {
  from: string;
  to: string;
  days: MergedHealthDay[];
  sources: HealthSourceSummary[];
  /** Most recent write from any source (ISO), across all time. */
  last_sync: string | null;
  last_sync_source: HealthSource | null;
}

export const SOURCE_LABELS: Record<HealthSource, string> = {
  apple_health: 'Apple Health import',
  health_connect: 'Health Connect',
  health_auto_export: 'Health Auto Export',
  shortcut: 'Apple Shortcuts',
  csv: 'CSV import',
  manual: 'Manual entry',
  api: 'Sync API',
};

export type HealthRange = '30' | '90';

/** One slot per calendar day of the range; `value` is undefined when that day has no data. */
export interface ChartPoint {
  date: string;
  value: number | undefined;
}
