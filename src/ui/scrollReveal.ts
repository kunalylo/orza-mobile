import { createContext, useContext } from 'react';
import type { View } from 'react-native';

/**
 * Lets a focused field ask the form screen around it (`Screen scroll keyboard`) to scroll it fully into view —
 * label, input and the error / hint line under it.
 *
 * Android only scrolls the native input itself into view, and does it when the field gains focus, before the keyboard
 * and `KeyboardAvoidingView` shrink the page: a field near the bottom ended up with its border and its error line
 * ("Type the new password again.") under the fixed footer (Save / Update password) while the keyboard was up.
 */
export interface ScrollReveal {
  /** `target` (a field's outer view) is focused, or its error changed: keep it in view, now and when the page shrinks. */
  focus: (target: View | null) => void;
  /** `target` lost focus. */
  blur: (target: View | null) => void;
}

/** Null outside a keyboard form screen — and inside a Sheet, whose fields live in another window. */
export const ScrollRevealContext = createContext<ScrollReveal | null>(null);

export const useScrollReveal = () => useContext(ScrollRevealContext);
