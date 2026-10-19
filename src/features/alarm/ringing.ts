/**
 * The alarm screen ↔ the alarm on the phone (notification / Android native alarm):
 * - Opened by a TAP on the alarm → the notification is dismissed straight away (the member is looking at it).
 * - Raised by the RINGING alarm itself (Android full-screen alarm over the lock screen, or an alarm that rang while
 *   ÖRZA was open — `ringing=1`) → it keeps ringing until the member's first press; dismissing on open would silence
 *   an alarm the moment it lights up a locked phone.
 * - First press of Take / Snooze / Skip / Take all / Close → Android stops the sound (`silenceRinging`; the alarm stays
 *   in the shade with its buttons until handled). Once every dose of the alarm is handled, its notification goes too.
 * - Leaving the alarm for the rest of the app asks for the phone's unlock first (Android, when shown over the lock
 *   screen); closing over the lock screen hands the phone back to the lock screen. The app stops showing over the lock
 *   screen when the last alarm screen closes (`releaseLockScreen`; the native side also releases after 10 min or when
 *   the app goes to the background).
 * Everything here is a no-op where it doesn't apply (iOS has no ringing to stop or lock-screen mode; web).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { alarmAdapter } from '@/lib/alarms/adapter';
import { alarmScreenOpened } from '@/lib/alarms/presence';
import { doseAlarmKey, snoozeAlarmKey } from '@/lib/alarms/types';
import { goBackOrHome } from '@/ui';

import { getStatus, releaseLockScreen, requestUnlock, silenceRinging } from '../../../modules/orza-alarms';

type DoseRef = { medication_id: string; scheduled_for: string };

/** Every key an alarm for these doses can be showing under: `dose:<iso>`, `snooze:<iso>`, `snooze:<med>:<iso>`. */
export function alarmKeysFor(doses: readonly DoseRef[], at?: string | null, med?: string): string[] {
  const byInstant = new Map<string, Set<string>>();
  const add = (iso: string, medId?: string) => {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return;
    const key = new Date(t).toISOString();
    const meds = byInstant.get(key) ?? new Set<string>();
    if (medId) meds.add(medId);
    byInstant.set(key, meds);
  };
  for (const d of doses) add(d.scheduled_for, d.medication_id);
  if (at) add(at, med);
  const keys: string[] = [];
  for (const [iso, meds] of byInstant) {
    keys.push(doseAlarmKey(iso), `snooze:${iso}`);
    for (const m of meds) keys.push(snoozeAlarmKey(iso, [m]));
  }
  return keys;
}

const dismissAll = (keys: readonly string[]) => {
  for (const k of keys) void alarmAdapter.dismiss(k).catch(() => undefined);
};

export function useAlarmRinging(opts: { at: string | null; test: string | null; ringing: boolean }) {
  /** null until known: was the screen raised by the ringing alarm (keep ringing) or opened by a tap? */
  const [raisedByAlarm, setRaisedByAlarm] = useState<boolean | null>(opts.ringing ? true : Platform.OS === 'android' ? null : false);
  const overLockScreen = useRef(false);
  const dismissed = useRef(new Set<string>());
  const start = useRef(opts);

  // Presence (one screen per alarm) + lock-screen release when the last alarm screen closes.
  useEffect(() => {
    const close = alarmScreenOpened(start.current.at, start.current.test);
    return () => {
      if (close()) void releaseLockScreen().catch(() => false);
    };
  }, []);

  // Android: a full-screen launch shows the app over the lock screen — that alarm is still ringing.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let alive = true;
    void getStatus()
      .catch(() => null)
      .then((s) => {
        overLockScreen.current = !!s?.overLockScreen;
        if (alive) setRaisedByAlarm(start.current.ringing || overLockScreen.current);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Stable callbacks (screens use them in effect dependencies): they only touch refs and the native module.

  /** Remove the alarm's notification(s) (once per key). */
  const dismiss = useCallback((keys: readonly string[]) => {
    const fresh = keys.filter((k) => !dismissed.current.has(k));
    for (const k of fresh) dismissed.current.add(k);
    dismissAll(fresh);
  }, []);

  /** The member pressed something: stop the sound (Android; the alarm stays in the shade until handled). */
  const silence = useCallback(() => {
    void silenceRinging().catch(() => 0);
  }, []);

  /** Close the alarm. Over the lock screen the phone goes back to its lock screen first. */
  const close = useCallback(async () => {
    void silenceRinging().catch(() => 0);
    if (overLockScreen.current) await releaseLockScreen().catch(() => false);
    goBackOrHome();
  }, []);

  /** Leave the alarm for the rest of the app: the phone's unlock first (no-op when it isn't locked). */
  const leave = useCallback(async (go: () => void) => {
    void silenceRinging().catch(() => 0);
    if (!(await requestUnlock().catch(() => false))) return;
    void releaseLockScreen().catch(() => false);
    go();
  }, []);

  return { raisedByAlarm, dismiss, silence, close, leave };
}
