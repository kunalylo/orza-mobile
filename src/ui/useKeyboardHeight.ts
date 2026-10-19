import { useEffect, useState } from 'react';
import { Keyboard, type KeyboardEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isIOS } from '@/theme';

/**
 * Height of the window the on-screen keyboard covers (0 while it is down). The app draws edge to edge on Android as
 * well as iOS, so the window is never resized for the keyboard: screens (`Screen keyboard`), sheets and composers make
 * room themselves.
 *
 * Android reports the keyboard's height minus the navigation-bar inset (React Native subtracts the system bars), but
 * edge to edge the keyboard also covers that strip — 24 dp on a gesture-nav phone, so a sheet's Save / Add button sat
 * partly under the keyboard. The inset is added back there; iOS reports the full overlap already.
 * `enabled: false` listens to nothing and stays 0 (no re-render of screens that don't care).
 */
export function useKeyboardHeight(enabled = true): number {
  const [height, setHeight] = useState(0);
  const { bottom: navBar } = useSafeAreaInsets();
  useEffect(() => {
    if (!enabled) return undefined;
    const onShow = (e: KeyboardEvent) => setHeight(e.endCoordinates.height);
    const onHide = () => setHeight(0);
    const show = Keyboard.addListener(isIOS ? 'keyboardWillShow' : 'keyboardDidShow', onShow);
    const hide = Keyboard.addListener(isIOS ? 'keyboardWillHide' : 'keyboardDidHide', onHide);
    return () => {
      show.remove();
      hide.remove();
    };
  }, [enabled]);
  // A height left over from before `enabled` went false is ignored.
  if (!enabled || height <= 0) return 0;
  return isIOS ? height : height + navBar;
}
