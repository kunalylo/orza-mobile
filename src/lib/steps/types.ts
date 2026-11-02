/**
 * Automatic step counting — shared types. Platform readers: `reader.android.ts` (Health Connect + the phone's hardware
 * step counter via `modules/orza-steps`), `reader.ios.ts` (Apple Health + CMPedometer via expo-sensors), `reader.ts`
 * (web / anything else: no automatic source).
 */

/** Where a day's automatic count came from. `phone` = this phone's own step counter / motion coprocessor. */
export type StepSource = 'phone' | 'health_connect' | 'apple_health';

/** Which counter a `phone` reading came from. They all read the same sensor: compared, never added (M1). */
export type PhoneCounter = 'recording' | 'sampler' | 'pedometer';

/**
 * Steps v2 (`docs/notes/steps-v2.md` §2): one source's count for one member day [s, e) in the profile time zone. A
 * source with no data for the day gives no reading (null), never a 0: a 0 is a reading only for time it covered (M0).
 */
export interface SourceReading {
  source: StepSource;
  /** `phone` only: which counter. */
  counter?: PhoneCounter;
  /** Steps in [coverFrom, min(e, now)). */
  steps: number;
  /** The first instant of the day the source can see: the day's start when it sees the whole day. */
  coverFrom: number;
  /** Sampler only: how many of `steps` are a long-gap estimate. */
  estimated?: number;
  /** The source has read up to the day's end (a past day can become final, M7). */
  complete?: boolean;
  /**
   * Health Connect only: its count holds this phone's own steps — HC counts the phone itself (Android 14+ with SDK
   * extension 20, `stepTracking`), or a phone step recorder wrote the day (Samsung Health, Google Fit, HC's own
   * on-device count: `androidSources.HC_PHONE_ORIGINS`); the reader sets it. Only then does it decide a past day over
   * the phone's count (M4). Apple Health always holds the iPhone's steps.
   */
  includesPhone?: boolean;
  /** Health Connect only: the apps (package names) whose records make up `steps` — for labels (U5). */
  origins?: string[];
  /**
   * What the source counted after a base's `at` (M5): its count over [max(at, coverFrom), min(e, now)), read for the
   * day's `ReadOptions.sinceAt`. Not needed when `coverFrom >= at` (then it is all of `steps`).
   */
  since?: SinceCount;
}

/** A source's count after the instant `at` (the `ReadOptions.sinceAt` it was read for). */
export interface SinceCount {
  at: number;
  steps: number;
  /** How many of `steps` are a long-gap estimate; unknown → at most the reading's own `estimated`. */
  estimated?: number;
}

/** Every source's reading for one member day [start, end) (epoch ms, the profile zone's midnights). */
export interface DayReading {
  /** Local day in the member's (profile) time zone, YYYY-MM-DD. */
  date: string;
  start: number;
  /** The day's end — the next midnight, also while the day is still running. */
  end: number;
  /** One reading per source that has data for the day; a source without data has none (M0). */
  sources: SourceReading[];
  /**
   * A health store is ON for the member but wasn't read this run (Android in the background without
   * `READ_HEALTH_DATA_IN_BACKGROUND`, a locked iPhone, a failed query) — not the same as "no data": the day may be
   * missing the store's count. A past day then saves nothing and isn't final (§2.9); today still raises. Android also
   * sets it when the phone's Recording API is ON (subscribed) but its read failed or Play services couldn't answer
   * (R2), and the iPhone when CMPedometer is ON but its query failed (R4): the same lower bound, for the phone's count.
   * Never proof that Apple Health is empty (`plan.healthEmpty`).
   */
  storeUnread?: boolean;
}

/**
 * The day's base (M5), anchored in time, never in a source's value (C4): the day is `steps` plus what is counted after
 * `at`.
 * - `edit`: the member set the day (on this phone, the website, another phone) while something was counting it;
 * - `start`: the day already had `steps` when counting began (typed while nothing counted, or saved before a new
 *   source's first day / a re-subscribe): counting adds on, and a higher whole-day count still replaces it.
 */
export interface DayBase {
  kind: 'edit' | 'start';
  steps: number;
  at: number;
  /** The server's edit marker (`steps_edited_at`) this base was taken from, or that this phone's edit set. */
  editRef?: string | null;
}

/**
 * The phone's own counter permission ("Physical activity" on Android 10+, "Motion & Fitness" on iPhone):
 * - `undetermined`: never asked — one tap asks;
 * - `denied`: refused but the system will ask again;
 * - `blocked`: refused for good — only Settings can turn it on;
 * - `unavailable`: no step counter on this phone / platform (or the native module isn't in this build).
 */
export type StepPermission = 'granted' | 'undetermined' | 'denied' | 'blocked' | 'unavailable';

/** Why a read runs (a queued run keeps the most important one: `permission` > `launch` > `foreground` > …). */
export type RefreshReason = 'launch' | 'foreground' | 'today' | 'permission' | 'background';

/** The one permission Today asks for first (§2.2); `none`: nothing can count on this phone — Log steps only. */
export type FirstAsk = 'hc' | 'phone' | 'healthkit' | 'none';

/** A permission the steps reader can ask for: Health Connect's / Apple Health's steps, or the phone's own counter. */
export type StepsAsk = Exclude<FirstAsk, 'none'>;

/** The health store's steps read access: `needs_install` = Health Connect can be installed / updated from Play. */
export type StoreAccess = 'granted' | 'not_granted' | 'unavailable' | 'needs_install';

/** Google Play services' Recording API on this phone (`modules/orza-steps` `recordingStatus()`, S-R5). */
export type RecordingStatus = 'available' | 'update_required' | 'missing' | 'disabled' | 'unavailable' | 'no_sensor';

export interface StepsAccess {
  /** The phone's own step counter exists (step sensor / motion coprocessor + the native code to read it). */
  phoneAvailable: boolean;
  phonePermission: StepPermission;
  /** Steps v2 (R2 / R4): what Today asks first (`plan.firstAsk`; the sync's `plan.stepsAsk`). */
  firstAsk?: FirstAsk;
  /**
   * Steps v2 (R2 / R4): the health store's steps access. iPhone: `granted` = the StepCount sheet was answered (HealthKit
   * never says whether reading was allowed); never `needs_install`.
   */
  store?: StoreAccess;
  /** Steps v2, Android (R2): the Recording API's status. */
  recording?: RecordingStatus;
  /** Steps v2, Android (R2): the Recording API is subscribed (with `available`: `plan.SourceInputs.recordingReady`). */
  recordingReady?: boolean;
  /** Steps v2 (R2 / R4): what this phone can count with — the sync's gate (`plan.stepsGate`: the sources ON, lookback). */
  features?: StepFeatures;
}

/** What this phone can count steps with (§2.1, §2.2) — from the readers (R2 / R4); `plan.firstAsk` / `plan.sourcesOn`. */
export interface StepFeatures {
  platform: 'android' | 'ios' | 'none';
  /**
   * The health store: Health Connect's SDK status (`installable`: it can be installed or updated from Play), or
   * whether Apple Health is available on this iPhone.
   */
  store: 'available' | 'installable' | 'unavailable';
  /** Android: Health Connect counts this phone's steps itself (API ≥ 34 and SDK extension ≥ 20). */
  stepTracking?: boolean;
  /** The phone has a step counter (Android `TYPE_STEP_COUNTER`, the iPhone's motion coprocessor). */
  counter: boolean;
}

/**
 * One member's steps consent on this install (M9), kept per user id in the prefs file (J7). OS permissions belong to
 * the phone; ÖRZA reads a kind of source only for a member who agreed to it.
 */
export interface StepsConsent {
  /** Agreed to read Apple Health / Health Connect. */
  store?: { at: number };
  /** Agreed to read this phone's own counter. */
  phone?: { at: number };
  /** "Count steps automatically" switched off (P9): nothing is read or saved. */
  off?: { at: number };
  /** "Not now — I'll log steps": Today's ask stays folded until then (P19). */
  notNowUntil?: number;
  /** iPhone: the one-time "Use iPhone motion instead" was offered. */
  motionOffered?: boolean;
  /** Another member had agreed on this install before this member first did: nothing before that is read. */
  sharedAtConsent: boolean;
}

/** Which kinds of source this member agreed to (M9: per member, set by the steps disclosure). */
export interface ReadConsent {
  /** Apple Health / Health Connect. */
  store: boolean;
  /** This phone's own counter (Recording API, sampler, CMPedometer). */
  phone: boolean;
}

export interface ReadOptions {
  /** The member's IANA time zone — days are counted in it. */
  timeZone: string;
  /**
   * The member's consents (P8, `plan.readConsent`): nothing is read for a kind without one — and the sources of a kind
   * without one are switched off (Android: the Recording API unsubscribed, the sampler stopped; iPhone: Apple Health's
   * background delivery cleared).
   */
  consent: ReadConsent;
  /** A background run: no UI, no live sensor read (Android only delivers sensor events to the app in front). */
  background?: boolean;
  /** Per date, a base's `at` (`plan.sinceAtOf`) — each source also reports its count after it (`SourceReading.since`). */
  sinceAt?: Record<string, number>;
  /** M9: no source reads before this instant (a shared phone: this member's consent). */
  coverFloor?: number | null;
}

export interface StepsReader {
  platform: 'android' | 'ios' | 'none';
  /** What the system calls the phone counter's permission. */
  permissionName: string;
  /** Where to turn it on when blocked. */
  settingsPath: string;
  access(): Promise<StepsAccess>;
  /**
   * Shows the system permission prompt (when it still can) for `kind` — default `phone`, the phone's own counter
   * (Android `hc`: Health Connect's steps + background, R2; iPhone `healthkit`: Apple Health's StepCount sheet,
   * `granted` = answered, `undetermined` when it couldn't open, R4). Only the OS permission: the member's consent is the
   * caller's (R5a). A kind this platform doesn't have → `unavailable`.
   */
  requestPermission(kind?: StepsAsk): Promise<StepPermission>;
  /**
   * Starts background counting where the platform needs it. Android: the next read subscribes to the Recording API
   * again (once per prepare); with `opts` the phone's counter is set up now for that consent (Recording API or sampler,
   * S-A2…S-A4; everything off without a phone consent), else by that read. iPhone: with `opts`, Apple Health's
   * background delivery is set up while the store is ON for the member and cleared otherwise (§4.3) — every read does
   * the same. Cheap, never throws.
   */
  prepare(timeZone: string, opts?: Pick<ReadOptions, 'consent'>): Promise<void>;
  /**
   * Sign-out: stops background counting and forgets raw samples — Android: also the Recording API subscription;
   * iPhone: Apple Health's background delivery (`clearBackgroundTypes`). Never throws.
   */
  reset(): Promise<void>;
  /**
   * Every source's reading for each of `dates` (a date nothing could read has no sources, or no `DayReading`). Which
   * reading decides the day is `merge.ts`'s job. Never throws.
   */
  readDays(dates: readonly string[], opts: ReadOptions): Promise<DayReading[]>;
}
