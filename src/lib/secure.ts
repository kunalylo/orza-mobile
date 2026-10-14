/**
 * Small wrapper around expo-secure-store (Keychain / Android Keystore) for the session token and a
 * tiny user snapshot. Never throws: storage failures just behave like an empty store.
 * Items are readable after the first unlock so future background alarm work can still call the API.
 * Web (dev preview only) falls back to memory — SecureStore has no web implementation.
 */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export const KEYS = {
  token: 'orza.session',
  user: 'orza.user',
  device: 'orza.device',
  /** A session signed out while offline: still live on the server until the app ends it (next launch or sign-in). */
  unrevoked: 'orza.session.unrevoked',
} as const;

type Key = (typeof KEYS)[keyof typeof KEYS];

const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };
const native = Platform.OS === 'ios' || Platform.OS === 'android';
const memory = new Map<string, string>();

export async function readSecure(key: Key): Promise<string | null> {
  if (!native) return memory.get(key) ?? null;
  try {
    return await SecureStore.getItemAsync(key, OPTIONS);
  } catch {
    return null;
  }
}

export async function writeSecure(key: Key, value: string | null): Promise<void> {
  if (!native) {
    if (value == null) memory.delete(key);
    else memory.set(key, value);
    return;
  }
  try {
    if (value == null) await SecureStore.deleteItemAsync(key, OPTIONS);
    else await SecureStore.setItemAsync(key, value, OPTIONS);
  } catch {
    // Keychain unavailable (e.g. device locked during a restore) — the app still works for this run.
  }
}

export async function readSecureJson<T>(key: Key): Promise<T | null> {
  const raw = await readSecure(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeSecureJson(key: Key, value: unknown): Promise<void> {
  return writeSecure(key, value == null ? null : JSON.stringify(value));
}
