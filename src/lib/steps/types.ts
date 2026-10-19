/**
 * Automatic step counting — shared types. Platform readers: `reader.android.ts` (Health Connect + the phone's hardware
 * step counter via `modules/orza-steps`), `reader.ios.ts` (Apple Health + CMPedometer via expo-sensors), `reader.ts`
 * (web / anything else: no automatic source).
 */

/** Where a day's automatic count came from. `phone` = this phone's own step counter / motion coprocessor. */
export type StepSource = 'phone' | 'health_connect' | 'apple_health';

/**
 * The phone's own counter permission ("Physical activity" on Android 10+, "Motion & Fitness" on iPhone):
 * - `undetermined`: never asked — one tap asks;
 * - `denied`: refused but the system will ask again;
 * - `blocked`: refused for good — only Settings can turn it on;
 * - `unavailable`: no step counter on this phone / platform (or the native module isn't in this build).
 */
export type StepPermission = 'granted' | 'undetermined' | 'denied' | 'blocked' | 'unavailable';

export interface DaySteps {
  /** Local day in the member's time zone, YYYY-MM-DD. */
  date: string;
  steps: number;
  source: StepSource;
  /** Phone counter only: this phone started counting this day at this instant (epoch ms); earlier steps weren't seen. */
  partialFrom?: number;
}

export interface StepsAccess {
  /** The phone's own step counter exists (step sensor / motion coprocessor + the native code to read it). */
  phoneAvailable: boolean;
  phonePermission: StepPermission;
}

export interface ReadOptions {
  /** The member's IANA time zone — days are counted in it. */
  timeZone: string;
  /** The member connected Apple Health / Health Connect in ÖRZA (Health screen): also read steps from it. */
  healthConnected: boolean;
  /** A background run: no UI, no live sensor read (Android only delivers sensor events to the app in front). */
  background?: boolean;
}

export interface StepsReader {
  platform: 'android' | 'ios' | 'none';
  /** What the system calls the phone counter's permission. */
  permissionName: string;
  /** Where to turn it on when blocked. */
  settingsPath: string;
  access(): Promise<StepsAccess>;
  /** Shows the system permission prompt (when it still can). */
  requestPermission(): Promise<StepPermission>;
  /** Starts background counting where the platform needs it (Android sampler alarms). Cheap, never throws. */
  prepare(timeZone: string): Promise<void>;
  /** Stops background counting and forgets raw samples (sign-out). Never throws. */
  reset(): Promise<void>;
  /**
   * Today's / recent days' automatic counts, one row per date that some source could read (0 = read, nothing walked).
   * Several sources for a day → the highest (they all measure the same walking; the higher one missed less), a tie
   * goes to the health store. Never throws.
   */
  readDays(dates: readonly string[], opts: ReadOptions): Promise<DaySteps[]>;
}
