/**
 * Fallback health bridge (web preview and any platform without a native health store). Metro uses
 * `bridge.ios.ts` on iPhone and `bridge.android.ts` on Android; TypeScript resolves this file, so it defines the
 * shared export every platform file must match.
 */
import type { HealthBridge } from './types';

export const healthBridge: HealthBridge = {
  platform: 'none',
  name: 'Health',
  source: 'apple_health',
  async availability() {
    return 'unsupported';
  },
  async hasAccess() {
    return false;
  },
  async requestAccess() {
    return { granted: false, metrics: [] };
  },
  async readDays() {
    return [];
  },
  async openManage() {},
  async openStore() {},
};
