/**
 * Toasts: `toast.success("Saved")`, `toast.error(message)`, `toast.info(...)` from anywhere (also outside React).
 * Rendered by <ToastHost /> at the root: glass pills under the status bar that spring in, stack (max 3),
 * dismiss on tap or after a few seconds, buzz a matching haptic and are announced by screen readers.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeOutUp, LinearTransition, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { haptics } from '@/lib/haptics';
import { colors, radii, shadows } from '@/theme';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export type ToastKind = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  duration: number;
}

let items: ToastItem[] = [];
let seq = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function dismiss(id: number) {
  const next = items.filter((t) => t.id !== id);
  if (next.length !== items.length) {
    items = next;
    emit();
  }
}

function show(kind: ToastKind, message: string, duration?: number) {
  const text = message.trim();
  if (!text) return;
  // Same message already showing (double tap, repeated network error) — don't stack duplicates.
  if (items.some((t) => t.message === text && t.kind === kind)) return;
  const id = ++seq;
  items = [...items.slice(-2), { id, kind, message: text, duration: duration ?? (kind === 'error' ? 4500 : 3000) }];
  emit();
  if (kind === 'success') haptics.success();
  else if (kind === 'error') haptics.error();
  AccessibilityInfo.announceForAccessibility(text);
}

export const toast = {
  success: (message: string, duration?: number) => show('success', message, duration),
  error: (message: string, duration?: number) => show('error', message, duration),
  info: (message: string, duration?: number) => show('info', message, duration),
  dismiss,
};

const look: Record<ToastKind, { icon: IconName; color: string; bg: string }> = {
  success: { icon: 'check-circle', color: colors.success, bg: colors.successBg },
  error: { icon: 'alert-circle', color: colors.error, bg: colors.errorBg },
  info: { icon: 'info', color: colors.cyan700, bg: colors.cyan50 },
};

function ToastRow({ item }: { item: ToastItem }) {
  const [hold, setHold] = useState(false);
  useEffect(() => {
    if (hold) return;
    const timer = setTimeout(() => dismiss(item.id), item.duration);
    return () => clearTimeout(timer);
  }, [item.id, item.duration, hold]);

  const l = look[item.kind];
  return (
    <Animated.View entering={ZoomIn.springify().damping(16).stiffness(220)} exiting={FadeOutUp.duration(180)} layout={LinearTransition.springify().damping(20)}>
      <Pressable
        onPress={() => dismiss(item.id)}
        onPressIn={() => setHold(true)}
        onPressOut={() => setHold(false)}
        accessibilityRole="alert"
        accessibilityHint="Tap to dismiss"
        style={styles.toast}
      >
        <View style={[styles.badge, { backgroundColor: l.bg }]}>
          <Icon name={l.icon} size={16} color={l.color} />
        </View>
        <Text variant="small" weight="medium" style={styles.message}>
          {item.message}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

/** Mount once near the root (inside SafeAreaProvider). */
export function ToastHost() {
  const insets = useSafeAreaInsets();
  const list = useSyncExternalStore(subscribe, () => items, () => items);
  if (!list.length) return null;
  return (
    <View pointerEvents="box-none" style={[styles.host, { top: insets.top + 8 }]}>
      {list.map((t) => (
        <ToastRow key={t.id} item={t} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: 16, right: 16, alignItems: 'center', gap: 8, zIndex: 1000, elevation: 1000 },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    maxWidth: 520,
    paddingVertical: 10,
    paddingLeft: 10,
    paddingRight: 16,
    borderRadius: radii.pill,
    backgroundColor: colors.glassSolid,
    borderWidth: 1,
    borderColor: colors.hairline,
    ...shadows.floating,
  },
  badge: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  message: { flexShrink: 1 },
});
