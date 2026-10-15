/**
 * An adapter that rings nothing: the web preview, and the Android / iOS stubs until C2 / C3 replace them.
 * `maxScheduled: 0` tells the engine it can't ring alarms, so it never declares `alarmsLocal: true` with it.
 */
import type { AdapterStatus, PlatformAdapter } from './adapter';

const NO_STATUS: AdapterStatus = { notifications: 'undetermined', canAskNotifications: false };

export function createNoopAdapter(name: PlatformAdapter['name'] = 'none'): PlatformAdapter {
  return {
    name,
    maxScheduled: 0,
    schedule: async () => ({ scheduled: 0 }),
    cancelAll: async () => undefined,
    dismiss: async () => undefined,
    status: async () => ({ ...NO_STATUS }),
    requestNotifications: async () => ({ ...NO_STATUS }),
    openSettings: async () => undefined,
    takeNativeActions: async () => [],
    onAction: () => () => undefined,
  };
}

/** Fallback adapter for targets without alarms (web preview). */
export const alarmAdapter: PlatformAdapter = createNoopAdapter('none');
