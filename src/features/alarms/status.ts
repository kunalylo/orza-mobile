/**
 * "Alarms on this phone" — what the status card and the first-run prompt read:
 * - the alarm engine's state (`useAlarmSyncState`: scheduled alarms, the next ones, doses inside quiet hours, offline);
 * - the phone's permissions read fresh (on open, on return to the app, after a permission request): notifications,
 *   Android exact alarms / full-screen alarms, and the Android battery-optimisation exemption (native module);
 * - small text helpers ("8:00 pm today", the quiet-hours warning).
 */
import { useCallback, useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { alarmAdapter, type AdapterStatus, type SettingsKind } from '@/lib/alarms/adapter';
import { onAlarmDataChanged } from '@/lib/alarms/events';
import { time12 } from '@/lib/alarms/plan';
import { addDays, utcToZoned } from '@/lib/alarms/schedule';
import { requestAlarmPermission, type AlarmSyncState } from '@/lib/alarms/sync';
import type { QuietDose } from '@/lib/alarms/types';
import { useAlarmSyncState } from '@/lib/alarms/useAlarmSync';

import { getStatus, openBatterySettings, type NativeAlarmStatus } from '../../../modules/orza-alarms';

export interface PhoneAlarmStatus {
  /** The engine's state (scheduled, next, quietDoses, offline, …). */
  engine: AlarmSyncState;
  /** Permissions; null until first read. */
  status: AdapterStatus | null;
  /** Android native module status (battery exemption, …); null elsewhere. */
  native: NativeAlarmStatus | null;
  /** This build can ring alarms (false: Expo Go, web, a build without the native module). */
  supported: boolean;
  /** Notifications allowed and (Android) exact alarm times allowed — alarms ring on time. */
  ready: boolean;
  /** Something the member can fix (permission off). */
  needsAttention: boolean;
  /** System prompt, or the phone's Settings when it can't be shown any more. Resolves with the new status. */
  allowNotifications: () => Promise<AdapterStatus | null>;
  openSettings: (kind: SettingsKind | 'battery') => Promise<void>;
  refresh: () => Promise<void>;
}

async function readStatus(): Promise<{ status: AdapterStatus | null; native: NativeAlarmStatus | null }> {
  const [status, native] = await Promise.all([
    alarmAdapter.status().catch(() => null),
    Platform.OS === 'android' ? getStatus().catch(() => null) : Promise.resolve(null),
  ]);
  return { status, native };
}

export function usePhoneAlarmStatus(): PhoneAlarmStatus {
  const engine = useAlarmSyncState();
  const [read, setRead] = useState<{ status: AdapterStatus | null; native: NativeAlarmStatus | null }>({ status: null, native: null });

  const refresh = useCallback(async () => {
    setRead(await readStatus());
  }, []);

  // Read on open, on every return to the app, after a permission request — and after each engine run (it may have
  // read a newer status). Results of a read that finishes after unmount are dropped.
  const engineStatus = engine.status;
  useEffect(() => {
    let alive = true;
    const load = () => {
      void readStatus().then((next) => {
        if (alive) setRead(next);
      });
    };
    load();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') load();
    });
    const off = onAlarmDataChanged((change) => {
      if (change === 'permission-changed') load();
    });
    return () => {
      alive = false;
      sub.remove();
      off();
    };
  }, [engineStatus]);

  const status = read.status ?? engine.status;
  const supported = alarmAdapter.maxScheduled > 0;
  const ready = supported && status?.notifications === 'granted' && status.exact !== false;
  const needsAttention = supported && !!status && (status.notifications !== 'granted' || status.exact === false || status.fullScreen === false);

  const allowNotifications = useCallback(async () => {
    const current = await alarmAdapter.status().catch(() => null);
    if (current?.notifications === 'granted') return current;
    if (current && !current.canAskNotifications) {
      await alarmAdapter.openSettings('notifications').catch(() => undefined);
      return current;
    }
    const next = await requestAlarmPermission().catch(() => null);
    await refresh();
    return next;
  }, [refresh]);

  const openSettings = useCallback(async (kind: SettingsKind | 'battery') => {
    if (kind === 'battery') await openBatterySettings().catch(() => false);
    else await alarmAdapter.openSettings(kind).catch(() => undefined);
  }, []);

  return { engine, status, native: read.native, supported, ready, needsAttention, allowNotifications, openSettings, refresh };
}

/* ───────────────────────────── Text helpers ───────────────────────────── */

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "8:00 pm today", "7:30 am tomorrow", "Wed 9:00 pm" in the member's timezone. */
export function whenText(at: number, tz: string, now = Date.now()): string {
  const local = utcToZoned(new Date(at), tz);
  const today = utcToZoned(new Date(now), tz).date;
  const time = time12(local.time);
  if (local.date === today) return `${time} today`;
  if (local.date === addDays(today, 1)) return `${time} tomorrow`;
  const day = WEEKDAY[new Date(`${local.date}T12:00:00Z`).getUTCDay()] ?? local.date;
  return `${day} ${time}`;
}

/** "Telma 40 mg", "Telma 40 mg + Metformin 500 mg", "Telma 40 mg + 2 more". */
export function namesText(labels: readonly string[]): string {
  const list = labels.filter(Boolean);
  if (list.length <= 2) return list.join(' + ');
  return `${list[0]} + ${list.length - 1} more`;
}

/**
 * The quiet-hours warning: "3 doses in the next 7 days fall inside quiet hours and won't ring — 11:00 pm Telma 40 mg
 * (×3)". Null when there are none.
 */
export function quietDosesText(doses: readonly QuietDose[]): { title: string; detail: string } | null {
  if (!doses.length) return null;
  const groups = new Map<string, { time: string; label: string; count: number }>();
  for (const d of doses) {
    const key = `${d.localTime}|${d.label}`;
    const g = groups.get(key) ?? { time: d.localTime, label: d.label, count: 0 };
    g.count += 1;
    groups.set(key, g);
  }
  const list = [...groups.values()].sort((a, b) => a.time.localeCompare(b.time) || a.label.localeCompare(b.label));
  const shown = list.slice(0, 3).map((g) => `${time12(g.time)} ${g.label}${g.count > 1 ? ` (×${g.count})` : ''}`);
  const more = list.length > 3 ? `, +${list.length - 3} more` : '';
  const n = doses.length;
  return {
    title: `${n} dose${n === 1 ? '' : 's'} in the next 7 days fall${n === 1 ? 's' : ''} inside quiet hours and won't ring`,
    detail: `${shown.join(', ')}${more}. Change your quiet hours if you need these alarms.`,
  };
}
