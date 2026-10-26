/**
 * Toasts: `toast.success("Saved")`, `toast.error(message)`, `toast.info(...)` from anywhere (also outside React).
 * Rendered by <ToastHost /> at the root: glass pills under the status bar that spring in, stack (max 3),
 * dismiss on tap or after a few seconds, buzz a matching haptic and are announced by screen readers.
 *
 * Every open Sheet mounts its own <ToastHost /> inside its Modal window, and only the newest mounted host draws the
 * toasts: from the root host a toast sat UNDER the sheet's dim backdrop (greyed out, "Please check the highlighted
 * fields." looked disabled) or behind a tall sheet. A toast that moves to another host (a sheet opens or closes) keeps
 * its place and its remaining time, without springing in again.
 */
import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeOutUp, LayoutAnimationConfig, LinearTransition, ZoomIn } from 'react-native-reanimated';
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
  /** When it goes away (ms epoch); pushed back while held. Shared by every host that draws it. */
  expiresAt: number;
}

let items: ToastItem[] = [];
let seq = 0;
const listeners = new Set<() => void>();
/** Mounted hosts, oldest first; the last one draws. */
let hosts: string[] = [];
/** Toasts already drawn by some host: drawn again elsewhere without the entering spring. */
const drawn = new Set<number>();

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
    drawn.delete(id);
    emit();
  }
}

const topHost = () => hosts[hosts.length - 1];

/** Let go after a press-and-hold: the full time again. */
function restartTimer(id: number) {
  const t = items.find((x) => x.id === id);
  if (t) t.expiresAt = Date.now() + t.duration;
}

function show(kind: ToastKind, message: string, duration?: number) {
  const text = message.trim();
  if (!text) return;
  // Same message already showing (double tap, repeated network error) — don't stack duplicates.
  if (items.some((t) => t.message === text && t.kind === kind)) return;
  const id = ++seq;
  const ms = duration ?? (kind === 'error' ? 4500 : 3000);
  items = [...items.slice(-2), { id, kind, message: text, duration: ms, expiresAt: Date.now() + ms }];
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
  // Read once per mount: a toast handed over from another host appears in place.
  const [springIn] = useState(() => !drawn.has(item.id));
  useEffect(() => {
    drawn.add(item.id);
  }, [item.id]);
  useEffect(() => {
    if (hold) return;
    const timer = setTimeout(() => dismiss(item.id), Math.max(0, item.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [item, hold]);
  const release = () => {
    restartTimer(item.id);
    setHold(false);
  };

  const l = look[item.kind];
  return (
    <Animated.View
      entering={springIn ? ZoomIn.springify().damping(16).stiffness(220).mass(1) : undefined}
      exiting={FadeOutUp.duration(180)}
      layout={LinearTransition.springify().damping(20).stiffness(100).mass(1)}
      style={styles.row}
    >
      <Pressable
        onPress={() => dismiss(item.id)}
        onPressIn={() => setHold(true)}
        onPressOut={release}
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

/** Mount once near the root (inside SafeAreaProvider); Sheet mounts one inside each open sheet's Modal. */
export function ToastHost({ active = true }: { active?: boolean }) {
  const insets = useSafeAreaInsets();
  const id = useId();
  // `active={false}` (a sheet that started closing) hands its toasts back right away, in the same render as the host
  // below picks them up — waiting for the Modal to unmount left a visible gap with no toast.
  useEffect(() => {
    if (!active) return;
    hosts = [...hosts, id];
    emit();
    return () => {
      hosts = hosts.filter((h) => h !== id);
      emit();
    };
  }, [id, active]);
  const list = useSyncExternalStore(subscribe, () => items, () => items);
  const top = useSyncExternalStore(subscribe, topHost, topHost);
  // Rendered even with no toasts, so the last one to go still fades out (see skipExiting below).
  if (top !== id) return null;
  return (
    <View pointerEvents="box-none" style={[styles.host, { top: insets.top + 8 }]}>
      {/* A host that hands over drops its rows at once (no fade-out here while the next host shows them). */}
      <LayoutAnimationConfig skipExiting>
        {list.map((t) => (
          <ToastRow key={t.id} item={t} />
        ))}
      </LayoutAnimationConfig>
    </View>
  );
}

const styles = StyleSheet.create({
  // Without it a wrapping message made the pill wider than the host (419 dp in 379) — both rounded ends off-screen.
  row: { maxWidth: '100%' },
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
    // Opaque: over a dark card (Today's insight) a see-through pill showed the card's text and buttons behind the message.
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.hairline,
    ...shadows.floating,
  },
  badge: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  message: { flexShrink: 1 },
});
