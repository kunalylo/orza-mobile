/**
 * "Keep medicine alarms working" — the one-time sheet for phones whose maker closes apps to save battery
 * (`lib/alarms/oem.ts`: which phones, the steps, what the button opens). Shown once per install, right after the
 * member's first medicine alarm is set (`KeepAlarmsSheet` watches the alarm engine), and again whenever the member
 * opens it from Reminders & alarms › Alarms on this phone. It counts as seen once the member closes it ("Done", the
 * backdrop, back); "Let your medicine alarms ring" coming up meanwhile takes its place, and it is offered again later.
 * No React here.
 */
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { keepAliveGuide, makerOf, type KeepAliveGuide } from '@/lib/alarms/oem';
import { readJsonFile, writeJsonFile } from '@/lib/alarms/store';

import { openKeepAliveSettings, type KeepAliveOpened } from '../../../modules/orza-alarms';

export interface KeepAliveState {
  visible: boolean;
  /** Shown by itself after the first alarm (the sheet then says where to find it again). */
  auto: boolean;
}

const FILE = 'orza-alarm-keepalive.json';

let state: KeepAliveState = { visible: false, auto: false };
const listeners = new Set<() => void>();
let guide: KeepAliveGuide | null | undefined;

function set(next: KeepAliveState) {
  state = next;
  for (const l of [...listeners]) l();
}

export const getKeepAlive = () => state;
export function subscribeKeepAlive(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** This phone's guide (Android phones from a maker that closes apps), else null. */
export function keepAliveGuideHere(): KeepAliveGuide | null {
  if (guide === undefined) {
    const phone = Platform.OS === 'android' ? makerOf(Device.manufacturer, Device.brand) : null;
    guide = phone ? keepAliveGuide(phone) : null;
  }
  return guide;
}

/** The sheet has been shown on this install. */
export function keepAliveSeen(): boolean {
  return readJsonFile<{ shownAt?: number }>(FILE)?.shownAt != null;
}

/** The one-time showing, by itself. */
export function offerKeepAlive(): void {
  if (state.visible || !keepAliveGuideHere() || keepAliveSeen()) return;
  set({ visible: true, auto: true });
}

/** From Reminders & alarms › Alarms on this phone. */
export function openKeepAlive(): void {
  if (keepAliveGuideHere()) set({ visible: true, auto: false });
}

/** The member closed it: it never shows by itself again on this install. */
export function closeKeepAlive(): void {
  if (!keepAliveSeen()) writeJsonFile(FILE, { shownAt: Date.now() });
  set({ ...state, visible: false });
}

/** "Let your medicine alarms ring" came up (it goes first): out of its way, not seen — offered again later. */
export function yieldKeepAlive(): void {
  if (state.visible && state.auto) set({ ...state, visible: false });
}

/** The button: the maker's screen, else ÖRZA's App info, else Android's battery-optimisation list. */
export async function openKeepAliveScreen(): Promise<KeepAliveOpened> {
  const g = keepAliveGuideHere();
  if (!g) return '';
  return openKeepAliveSettings(g.targets).catch((): KeepAliveOpened => '');
}
