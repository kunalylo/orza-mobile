/**
 * Health sync — shared, platform-neutral types and metric rules.
 *
 * Mirrors the web's `src/components/care/health/metrics.ts` so the phone sends exactly what
 * `POST /api/health/import` accepts: one row of daily totals / averages per local calendar day.
 */

export const HEALTH_METRICS = [
  'steps',
  'active_kcal',
  'distance_km',
  'sleep_minutes',
  'resting_hr',
  'avg_hr',
  'weight_kg',
  'water_ml',
] as const;

export type HealthMetric = (typeof HEALTH_METRICS)[number];
export type HealthDayValues = Partial<Record<HealthMetric, number>>;
/** One local calendar day (`YYYY-MM-DD`) of daily totals / averages. */
export type HealthDayInput = { date: string } & HealthDayValues;

export interface MetricInfo {
  label: string;
  unit: string;
  min: number;
  max: number;
  /** Decimal places the server keeps. */
  digits: number;
}

/** Canonical units and the range a real day can fall in (out-of-range values are dropped, never clamped). */
export const METRIC_INFO: Record<HealthMetric, MetricInfo> = {
  steps: { label: 'Steps', unit: 'steps', min: 0, max: 100_000, digits: 0 },
  active_kcal: { label: 'Active energy', unit: 'kcal', min: 0, max: 10_000, digits: 0 },
  distance_km: { label: 'Distance', unit: 'km', min: 0, max: 300, digits: 2 },
  sleep_minutes: { label: 'Sleep', unit: 'min', min: 0, max: 1440, digits: 0 },
  resting_hr: { label: 'Resting heart rate', unit: 'bpm', min: 25, max: 230, digits: 0 },
  avg_hr: { label: 'Average heart rate', unit: 'bpm', min: 25, max: 230, digits: 0 },
  weight_kg: { label: 'Weight', unit: 'kg', min: 20, max: 400, digits: 2 },
  water_ml: { label: 'Water', unit: 'ml', min: 0, max: 10_000, digits: 0 },
};

/** Where a day of data came from (server `HealthSource`). */
export type HealthSource = 'apple_health' | 'health_connect' | 'health_auto_export' | 'shortcut' | 'csv' | 'manual' | 'api';

/** Days read from the phone on every sync (Health Connect only allows 30 days before the first grant anyway). */
export const SYNC_DAYS = 30;
/** Automatic sync runs at most this often (manual "Sync now" always runs). */
export const AUTO_SYNC_INTERVAL_MS = 3 * 60 * 60 * 1000;
/** After a failed automatic attempt, wait this long before trying again on the next foreground. */
export const AUTO_RETRY_AFTER_FAILURE_MS = 2 * 60 * 1000;

/* ───────────────────────────── Native bridge contract ───────────────────────────── */

/** Thrown by `readDays` when the platform reports that ÖRZA may no longer read anything (permissions removed). */
export class HealthNotAuthorizedError extends Error {
  constructor(message = 'ÖRZA no longer has permission to read your health data.') {
    super(message);
    this.name = 'HealthNotAuthorizedError';
  }
}

export type HealthPlatform = 'ios' | 'android' | 'none';

/** A time range for `stepsBetween` (epoch ms, end exclusive). */
export interface StepRange {
  start: number;
  end: number;
}

/**
 * - `available`: ready to connect / read.
 * - `needs_install`: Health Connect isn't installed (Android 9–13) — send the user to the Play Store.
 * - `needs_update`: Health Connect is installed but too old — Play Store.
 * - `unsupported`: this device can't use it (iPad without Health, Android < 9, web, Expo Go).
 */
export type HealthAvailability = 'available' | 'needs_install' | 'needs_update' | 'unsupported';

export interface HealthAccessResult {
  /**
   * Android: at least one read permission is granted. iPhone: the permission sheet was completed — HealthKit never
   * reveals whether reading was allowed, so the first sync is the real test.
   */
  granted: boolean;
  /** Android only: metrics the user allowed (all on iPhone, where it can't be known). */
  metrics: HealthMetric[];
}

export interface HealthBridge {
  platform: HealthPlatform;
  /** "Apple Health" / "Health Connect". */
  name: string;
  /** The import source ÖRZA records for this platform. */
  source: HealthSource;
  availability(): Promise<HealthAvailability>;
  /** Whether the permission prompt has already been answered / some access exists (no UI shown). */
  hasAccess(): Promise<boolean>;
  /** Shows the system permission UI for every metric ÖRZA reads. */
  requestAccess(): Promise<HealthAccessResult>;
  /** Daily aggregates for the last `days` local days (today included), oldest first; days without data are omitted. */
  readDays(days: number): Promise<HealthDayInput[]>;
  /**
   * Step totals for each `[start, end)` range (epoch ms) — the store's own deduplicated total (phone + watch counted
   * once). `null` for a range that can't be read (no permission, store unavailable or locked); 0 when nothing was
   * recorded. Used by automatic step counting (`lib/steps`) for Today; never throws.
   */
  stepsBetween(ranges: readonly StepRange[]): Promise<(number | null)[]>;
  /** Where the user manages ÖRZA's access (Health Connect settings / the app's Settings page on iPhone). */
  openManage(): Promise<void>;
  /** Play Store page for Health Connect (Android). */
  openStore(): Promise<void>;
}
