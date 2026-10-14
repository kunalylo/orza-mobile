/**
 * Haptic feedback for key actions. Never throws (unsupported devices, web, low-power modes just do nothing).
 */
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

const enabled = Platform.OS === 'ios' || Platform.OS === 'android';

function safe(run: () => Promise<void>) {
  if (!enabled) return;
  run().catch(() => {});
}

export type HapticKind = 'tap' | 'soft' | 'firm' | 'select' | 'success' | 'warning' | 'error' | 'none';

export const haptics = {
  /** Light tap — buttons, tab presses. */
  tap: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  /** Softer tap — chips, toggles. */
  soft: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft)),
  /** Firm tap — primary/irreversible actions (Snap, Take dose). */
  firm: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  /** Selection tick — segmented controls, pickers. */
  select: () => safe(() => Haptics.selectionAsync()),
  success: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};

export function playHaptic(kind: HapticKind | undefined) {
  if (!kind || kind === 'none') return;
  haptics[kind]();
}
