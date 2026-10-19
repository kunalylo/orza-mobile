/**
 * This phone in the user's `devices` registry: `POST /api/devices` (app sessions only — the server answers 403 to
 * anything else) and `DELETE /api/devices/<id>`. Registered after sign-in and on launch / return to foreground
 * (throttled to once per 10 minutes unless something changed).
 *
 * Server rules this module follows (web repo `src/app/api/devices/route.ts`):
 * - an omitted `push_token` deletes the stored one, and an omitted `alarms_local` means `true` — so every
 *   registration re-sends what this phone last declared (`pushToken`, `alarmsLocal`), remembered until sign-out;
 * - `alarms_local` stays **false** until the on-phone alarm engine ships (Phase C): while a phone reports
 *   `alarms_local: true` the server stops sending Web Push for medicine doses, so claiming it before the app can
 *   actually ring would make people miss doses. Phase C calls `registerDevice({ alarmsLocal: true, pushToken })`
 *   once alarms really ring; later foreground re-registrations keep both.
 * - The declaration is kept in SecureStore (cleared on sign-out) and loaded before the FIRST registration of a launch:
 *   otherwise every cold start — an alarm launching the app, an iOS background run — would first tell the server
 *   `alarms_local: false` until the engine re-declares, and the member's browsers could ring the same dose too.
 */
import * as Localization from 'expo-localization';

import { ApiError, api, deviceLabel } from './api';
import { APP_VERSION, PLATFORM } from './config';
import { KEYS, readSecure, readSecureJson, writeSecure, writeSecureJson } from './secure';
import type { AppDeviceView } from './types';

const FALLBACK_TZ = 'Asia/Kolkata';

function isTimeZone(tz: string | null | undefined): tz is string {
  if (!tz || tz.length > 64 || !/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The phone's IANA timezone (e.g. "Asia/Kolkata"); falls back to IST like the website. */
export function deviceTimeZone(): string {
  let tz: string | null | undefined;
  try {
    tz = Localization.getCalendars()[0]?.timeZone;
  } catch {
    tz = null;
  }
  if (isTimeZone(tz)) return tz;
  try {
    const intl = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (isTimeZone(intl)) return intl;
  } catch {
    // ignore
  }
  return FALLBACK_TZ;
}

export interface RegisterOptions {
  /** Expo push token; `null` withdraws it (notifications turned off). Omit to keep the one last declared. */
  pushToken?: string | null;
  /** The phone rings medicine alarms itself. Omit to keep the value last declared (false until Phase C). */
  alarmsLocal?: boolean;
}

type Declaration = { pushToken: string | null; alarmsLocal: boolean };

const MIN_INTERVAL_MS = 10 * 60 * 1000;
const UNDECLARED: Declaration = { pushToken: null, alarmsLocal: false };

let declared: Declaration = UNDECLARED;
/** The declaration changed and hasn't reached the server yet (bypasses the throttle). */
let dirty = false;
let lastSentAt = 0;
/** Bumped on sign-out so a registration still in flight can't record its result for the next account. */
let generation = 0;
let inflight: Promise<AppDeviceView | null> | null = null;

/* ── The last declaration, kept across launches (per account) ── */

type StoredDeclaration = Partial<Declaration> & { userId?: string | null };

/** Loads the last declaration once per launch (reset on sign-out: the next account starts undeclared). */
let loaded: Promise<void> | null = null;
/** Writes in order (each reads the signed-in member first). */
let persisting: Promise<void> = Promise.resolve();

const signedInUserId = () => readSecureJson<{ id?: string }>(KEYS.user).then((u) => u?.id ?? null);

function loadDeclaration(): Promise<void> {
  if (!loaded) {
    loaded = Promise.all([readSecureJson<StoredDeclaration>(KEYS.deviceDeclared), signedInUserId()])
      .then(([stored, userId]) => {
        // Only this member's, and only when nothing was declared meanwhile in this launch (that one is newer).
        if (!stored || typeof stored.alarmsLocal !== 'boolean' || !userId || stored.userId !== userId || declared !== UNDECLARED) return;
        declared = { pushToken: typeof stored.pushToken === 'string' && stored.pushToken ? stored.pushToken : null, alarmsLocal: stored.alarmsLocal };
      })
      .catch(() => undefined);
  }
  return loaded;
}

function persistDeclaration(next: Declaration): void {
  const gen = generation;
  persisting = persisting
    .then(async () => {
      const userId = await signedInUserId();
      if (gen !== generation) return; // signed out meanwhile
      await writeSecureJson(KEYS.deviceDeclared, { ...next, userId } satisfies StoredDeclaration);
    })
    .catch(() => undefined);
}

async function send(gen: number): Promise<AppDeviceView | null> {
  const sent = declared;
  try {
    const body: Record<string, unknown> = {
      platform: PLATFORM,
      device_label: deviceLabel(),
      app_version: APP_VERSION,
      timezone: deviceTimeZone(),
      alarms_local: sent.alarmsLocal,
    };
    if (sent.pushToken) body.push_token = sent.pushToken;
    const res = await api.post<{ device: AppDeviceView }>('/devices', body, { timeoutMs: 15_000 });
    if (gen !== generation) return null;
    lastSentAt = Date.now();
    if (declared === sent) dirty = false;
    await writeSecure(KEYS.device, res.device.id);
    return res.device;
  } catch {
    return null;
  }
}

/**
 * Upserts this phone for the current app session. Never throws (returns null on failure or when throttled). The first
 * call of a launch waits for the last declaration to load (calls keep their order).
 */
export function registerDevice(opts: RegisterOptions & { force?: boolean } = {}): Promise<AppDeviceView | null> {
  if (PLATFORM === 'web') return Promise.resolve(null);
  const gen = generation;
  return loadDeclaration().then(() => (gen === generation ? registerNow(opts) : null));
}

function registerNow(opts: RegisterOptions & { force?: boolean }): Promise<AppDeviceView | null> {
  const next: Declaration = {
    pushToken: opts.pushToken === undefined ? declared.pushToken : opts.pushToken || null,
    alarmsLocal: opts.alarmsLocal ?? declared.alarmsLocal,
  };
  const changed = next.pushToken !== declared.pushToken || next.alarmsLocal !== declared.alarmsLocal;
  if (changed) {
    declared = next;
    dirty = true;
    persistDeclaration(next);
  }
  if (inflight && !changed) return inflight;
  if (!opts.force && !dirty && Date.now() - lastSentAt < MIN_INTERVAL_MS) return Promise.resolve(null);

  const previous = inflight;
  const gen = generation;
  // An older registration lands first, so the newest declaration is the one the server keeps.
  const run = (previous ? previous.then(() => send(gen)) : send(gen)).finally(() => {
    if (inflight === run) inflight = null;
  });
  inflight = run;
  return run;
}

/**
 * Removes this phone from the registry (`DELETE /api/devices/<id>`), so medicine doses go back to Web Push.
 * It doesn't sign out — `POST /api/auth/logout` does that and forgets the phone too. Returns false when the
 * server couldn't be reached (a 404, already gone, counts as done).
 */
export async function unregisterDevice(): Promise<boolean> {
  if (PLATFORM === 'web') return true;
  const id = await readSecure(KEYS.device);
  if (id) {
    try {
      await api.del(`/devices/${encodeURIComponent(id)}`, { timeoutMs: 15_000 });
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) return false;
    }
  }
  declared = UNDECLARED;
  dirty = false;
  loaded = Promise.resolve();
  await writeSecure(KEYS.deviceDeclared, null);
  await writeSecure(KEYS.device, null);
  return true;
}

/** Forget the registration state (after sign-out, so the next account registers immediately and declares afresh). */
export function resetDeviceRegistration() {
  generation += 1;
  inflight = null; // its result is discarded (stale generation); the next account must not wait on it
  declared = UNDECLARED;
  dirty = false;
  lastSentAt = 0;
  loaded = Promise.resolve(); // the next account starts undeclared
  void writeSecure(KEYS.device, null);
  void writeSecure(KEYS.deviceDeclared, null);
}
