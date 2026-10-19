import { useEffect, useState } from 'react';
import { Keyboard, type KeyboardEvent } from 'react-native';

import { isIOS } from '@/theme';

/**
 * Height of the on-screen keyboard (0 while it is down). The app draws edge to edge on Android as well as iOS, so the
 * window is never resized for the keyboard: screens (`Screen keyboard`), sheets and composers make room themselves.
 * `enabled: false` listens to nothing and stays 0 (no re-render of screens that don't care).
 */
export function useKeyboardHeight(enabled = true): number {
  const [height, setHeight] = useState(0);
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
  return enabled ? height : 0;
}
