/**
 * Runtime configuration. `EXPO_PUBLIC_API_URL` is inlined at build time (eas.json sets it per profile);
 * it may be the site origin or end in `/api` — both work.
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';

const DEFAULT_ORIGIN = 'https://orza-nine.vercel.app';

function originFrom(raw: string | undefined): string {
  const value = (raw || DEFAULT_ORIGIN).trim().replace(/\/+$/, '').replace(/\/api$/, '');
  return /^https?:\/\//.test(value) ? value : DEFAULT_ORIGIN;
}

/** The ÖRZA web origin, e.g. `https://orza-nine.vercel.app` (no trailing slash). */
export const API_ORIGIN = originFrom(process.env.EXPO_PUBLIC_API_URL);

/** Base for JSON endpoints: `${API_BASE}/auth/me`. */
export const API_BASE = `${API_ORIGIN}/api`;

/** The marketing / web console site (admins use the console there). */
export const WEB_URL = API_ORIGIN;

/** Marketing version from app.json (`1.0.0`). */
export const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';

export const PLATFORM: 'ios' | 'android' | 'web' = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
