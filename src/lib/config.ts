/**
 * Runtime configuration. `EXPO_PUBLIC_API_URL` is inlined at build time (eas.json sets it per profile; a development
 * build gets it from Metro — `.env` / `.env.local`); it may be the site origin or end in `/api` — both work.
 *
 * Development builds (`__DEV__`) never fall back to the production site: with the URL missing or invalid the app shows
 * a blocking "API URL not configured" screen (`API_CONFIG_ERROR`, root layout) and every request goes to an
 * unresolvable `.invalid` host. Release builds keep the production default.
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';

const DEFAULT_ORIGIN = 'https://orza-nine.vercel.app';
/** RFC 2606: `.invalid` never resolves — a misconfigured dev build can't reach any real server. */
const UNCONFIGURED_ORIGIN = 'http://api-url-not-configured.invalid';

/** `https://host[:port]` (a trailing `/` or `/api` is dropped); null for anything else. */
function parseOrigin(raw: string | undefined): string | null {
  const value = (raw ?? '').trim().replace(/\/+$/, '').replace(/\/api$/, '');
  return /^https?:\/\/[^/\s?#]+$/.test(value) ? value : null;
}

// Literal `process.env.EXPO_PUBLIC_…` so the bundler inlines it.
const RAW_API_URL = process.env.EXPO_PUBLIC_API_URL;
const CONFIGURED_ORIGIN = parseOrigin(RAW_API_URL);

/**
 * Set in a development build whose API URL is missing or invalid: the root layout shows it instead of the app.
 * Null in release builds and when the URL is fine.
 */
export const API_CONFIG_ERROR: string | null =
  __DEV__ && !CONFIGURED_ORIGIN
    ? RAW_API_URL?.trim()
      ? `EXPO_PUBLIC_API_URL isn't a valid http(s) origin ("${RAW_API_URL.trim()}").`
      : 'EXPO_PUBLIC_API_URL is not set.'
    : null;

/** The ÖRZA web origin, e.g. `https://orza-nine.vercel.app` (no trailing slash). */
export const API_ORIGIN = CONFIGURED_ORIGIN ?? (__DEV__ ? UNCONFIGURED_ORIGIN : DEFAULT_ORIGIN);

/** Base for JSON endpoints: `${API_BASE}/auth/me`. */
export const API_BASE = `${API_ORIGIN}/api`;

/** The marketing / web console site (admins use the console there). */
export const WEB_URL = API_ORIGIN;

/** Marketing version from app.json (`1.0.0`). */
export const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';

export const PLATFORM: 'ios' | 'android' | 'web' = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
