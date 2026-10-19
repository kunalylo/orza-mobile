/**
 * Fallback steps reader (web preview and any platform without a step counter): no automatic source, so Today keeps
 * the manual entry. Metro uses `reader.ios.ts` on iPhone and `reader.android.ts` on Android; TypeScript resolves this
 * file, so it defines the exports every platform file must match.
 */
import { Linking } from 'react-native';

import type { StepsReader } from './types';

export const stepsReader: StepsReader = {
  platform: 'none',
  permissionName: 'Motion',
  settingsPath: 'Settings',
  async access() {
    return { phoneAvailable: false, phonePermission: 'unavailable' };
  },
  async requestPermission() {
    return 'unavailable';
  },
  async prepare() {},
  async reset() {},
  async readDays() {
    return [];
  },
};

export function openStepsSettings(): Promise<void> {
  return Linking.openSettings();
}
