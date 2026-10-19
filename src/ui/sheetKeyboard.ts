import { useSyncExternalStore } from 'react';
import { Keyboard, type EmitterSubscription } from 'react-native';

/**
 * Whether the keyboard on screen belongs to an open Sheet (a Modal) rather than to the screen under it.
 *
 * Keyboard events are global, so without this the screen below a sheet makes room for the sheet's keyboard too
 * (`Screen keyboard` padding, the tab bar hiding). Android reports the keyboard gone only ~0.6 s after the sheet starts
 * closing, so after "Add" in the food list the Meals screen showed a blank lower half and no tab bar for a moment.
 * Held from a sheet's mount until it has unmounted and its keyboard is down (or a short safety timeout).
 */
let holders = 0;
/** A closed sheet's keyboard is still on its way down. */
let lingering = false;
let hideSub: EmitterSubscription | null = null;
let safety: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

function stopLingering() {
  hideSub?.remove();
  hideSub = null;
  clearTimeout(safety);
  if (!lingering) return;
  lingering = false;
  emit();
}

/** Call when a sheet mounts; the returned function releases it when the sheet unmounts. */
export function holdSheetKeyboard(): () => void {
  holders += 1;
  stopLingering();
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders = Math.max(0, holders - 1);
    if (holders === 0 && Keyboard.isVisible()) {
      lingering = true;
      hideSub = Keyboard.addListener('keyboardDidHide', stopLingering);
      // If the keyboard stays (focus moved to a field on the screen), hand it back to the screen anyway.
      safety = setTimeout(stopLingering, 1500);
    }
    emit();
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const snapshot = () => holders > 0 || lingering;

/** True while the keyboard (if any) belongs to a sheet: screens and the tab bar should not make room for it. */
export function useSheetOwnsKeyboard(): boolean {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
