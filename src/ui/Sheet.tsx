/**
 * Bottom sheet — a frosted cream panel that springs up over a dimmed backdrop.
 * Close it by tapping the backdrop, swiping the grab handle / header down, the close button, or Android back.
 * With `dismissible={false}` those are blocked; add `onBlockedDismiss` to answer the backdrop, close button and Android
 * back yourself instead (e.g. a "Discard changes?" prompt). The swipe stays off, so a blocked sheet never hangs half-dragged.
 * Content scrolls and stays above the keyboard; a `footer` (e.g. Save) is pinned at the bottom.
 *
 *   <Sheet visible={open} onClose={() => setOpen(false)} eyebrow="Meals" title="Add from food list" footer={<Button … />}>
 *     …
 *   </Sheet>
 *
 * The parent owns `visible`; the sheet animates out before it unmounts. Pass `scroll={false}` when the child is
 * its own list (FlatList) and `full` to use the full height even with little content (search results).
 */
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Keyboard, Modal, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions, type TextInput } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { colors, gutter, isIOS, motion, radii, shadows, spacing } from '@/theme';

import { IconButton } from './IconButton';
import { holdSheetKeyboard } from './sheetKeyboard';
import { Text } from './Text';
import { useKeyboardHeight } from './useKeyboardHeight';

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  eyebrow?: string;
  children: ReactNode;
  /** Pinned under the content, above the keyboard and the home indicator. */
  footer?: ReactNode;
  /** Largest height as a fraction of the window (default 0.9). */
  maxHeight?: number;
  /** Always use the full `maxHeight`, even when the content is short. */
  full?: boolean;
  /** Wrap children in a ScrollView (default true). Use false when the child scrolls itself (FlatList). */
  scroll?: boolean;
  /** false blocks backdrop / swipe / back / close-button dismissal (e.g. while saving). Default true. */
  dismissible?: boolean;
  /**
   * Called instead of `onClose` when the backdrop, the close button or Android back is used while `dismissible` is
   * false (e.g. to ask "Discard changes?"). Swipe-down stays disabled. Without it those controls do nothing.
   */
  onBlockedDismiss?: () => void;
  /** Show the round close button in the header (default true when there is a title). */
  closeButton?: boolean;
  /** Screen-reader label for the sheet (defaults to the title). */
  accessibilityLabel?: string;
  /**
   * A field to focus, keyboard up, once the sheet is on screen (use this, not `autoFocus` or a timer). Android: a field
   * focused before the sheet's Modal window has focus looks focused but brings no keyboard — and `focus()` is a no-op
   * while it already counts as focused — so the sheet waits for the Modal's `onShow` and re-focuses if no keyboard came.
   */
  initialFocus?: RefObject<TextInput | null>;
}

export function Sheet(props: SheetProps) {
  const [mounted, setMounted] = useState(props.visible);
  // Mount as soon as it should show; unmount only after the exit animation (onHidden).
  if (props.visible && !mounted) setMounted(true);
  const onHidden = useCallback(() => setMounted(false), []);
  if (!mounted) return null;
  return <SheetModal {...props} onHidden={onHidden} />;
}

const dbg = (m: string) => console.log(m);

function SheetModal({
  visible,
  onClose,
  onHidden,
  title,
  eyebrow,
  children,
  footer,
  maxHeight = 0.9,
  full,
  scroll = true,
  dismissible = true,
  onBlockedDismiss,
  closeButton,
  accessibilityLabel,
  initialFocus,
}: SheetProps & { onHidden: () => void }) {
  const reduceMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const keyboard = useKeyboardHeight();

  const progress = useSharedValue(0); // 0 = off screen, 1 = open
  const drag = useSharedValue(0); // finger offset while swiping down
  const [sheetHeight, setSheetHeight] = useState(windowHeight);

  // The keyboard is this sheet's while it is mounted — the screen below must not make room for it (see sheetKeyboard).
  useEffect(() => holdSheetKeyboard(), []);

  // `initialFocus`: focus once the Modal is shown; on Android retry (blur + focus) while no keyboard has come up.
  const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const open = useRef(visible);
  useEffect(() => {
    open.current = visible;
  }, [visible]);
  useEffect(
    () => () => {
      if (focusTimer.current) clearTimeout(focusTimer.current);
    },
    [],
  );
  const onShow = useCallback(() => {
    if (!initialFocus) return;
    let tries = 0;
    const attempt = () => {
      focusTimer.current = null;
      const input = initialFocus.current;
      if (!input || !open.current || (tries > 0 && Keyboard.isVisible())) return;
      if (tries > 0 && input.isFocused()) input.blur();
      input.focus();
      tries += 1;
      if (Platform.OS === 'android' && tries < 4) focusTimer.current = setTimeout(attempt, 400);
    };
    focusTimer.current = setTimeout(attempt, 50);
  }, [initialFocus]);

  useEffect(() => {
    console.log('DBG sheet effect', title, visible);
    if (visible) {
      drag.set(0);
      progress.set(reduceMotion ? withTiming(1, { duration: motion.fast }) : withSpring(1, motion.springSoft));
    } else {
      // Put the keyboard away together with the sheet. Left to Android, it only goes once the Modal window is gone and
      // lingered ~1 s over the screen below.
      Keyboard.dismiss();
      progress.set(
        withTiming(0, { duration: reduceMotion ? motion.fast : motion.base }, (finished) => {
          scheduleOnRN(dbg, `DBG sheet hide done ${String(finished)}`);
          if (finished) scheduleOnRN(onHidden);
        }),
      );
    }
  }, [visible, reduceMotion, progress, drag, onHidden]);

  const requestClose = useCallback(() => {
    if (dismissible) onClose();
    else onBlockedDismiss?.();
  }, [dismissible, onClose, onBlockedDismiss]);
  /** The backdrop, close button and Android back do something (close, or the blocked-dismiss handler). */
  const closable = dismissible || Boolean(onBlockedDismiss);

  const pan = Gesture.Pan()
    .enabled(dismissible)
    .activeOffsetY(8)
    .failOffsetX([-24, 24])
    .onChange((e) => {
      drag.set(Math.max(0, drag.get() + e.changeY));
    })
    .onEnd((e) => {
      if (drag.get() > Math.min(140, sheetHeight * 0.3) || e.velocityY > 900) {
        scheduleOnRN(onClose);
      } else {
        drag.set(withSpring(0, motion.spring));
      }
    });

  const backdropStyle = useAnimatedStyle(() => ({ opacity: interpolate(progress.get(), [0, 1], [0, 1]) }));
  const sheetStyle = useAnimatedStyle(() => ({
    // Clamp so a spring overshoot never lifts the sheet off the bottom edge.
    transform: [{ translateY: Math.max(0, (1 - progress.get()) * (sheetHeight + 40)) + drag.get() }],
  }));

  const showClose = closeButton ?? Boolean(title);
  const limit = Math.round((windowHeight - insets.top - spacing.sm) * Math.min(1, Math.max(0.3, maxHeight)));
  const bottomPad = keyboard > 0 ? keyboard + spacing.md : Math.max(insets.bottom, spacing.lg);

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={requestClose} onShow={onShow}>
      <GestureHandlerRootView style={styles.fill}>
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <Pressable
            style={styles.fill}
            onPress={requestClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            accessible={closable}
            importantForAccessibility={closable ? 'auto' : 'no-hide-descendants'}
          />
        </Animated.View>

        <Animated.View
          style={[styles.sheet, { maxHeight: limit, paddingBottom: bottomPad }, full && { height: limit }, sheetStyle]}
          onLayout={(e) => setSheetHeight(e.nativeEvent.layout.height)}
          accessibilityViewIsModal
          accessibilityLabel={accessibilityLabel ?? title}
        >
          <GestureDetector gesture={pan}>
            <View style={styles.top}>
              <View style={styles.handle} />
              {(title || eyebrow || showClose) && (
                <View style={styles.header}>
                  <View style={styles.headerText}>
                    {eyebrow ? (
                      <Text variant="eyebrow" tone="muted">
                        {eyebrow}
                      </Text>
                    ) : null}
                    {title ? (
                      <Text variant="h3" accessibilityRole="header" numberOfLines={2}>
                        {title}
                      </Text>
                    ) : null}
                  </View>
                  {showClose ? (
                    <IconButton icon="x" accessibilityLabel="Close" size={36} iconSize={18} onPress={requestClose} disabled={!closable} />
                  ) : null}
                </View>
              )}
            </View>
          </GestureDetector>

          {scroll ? (
            <ScrollView
              style={full ? styles.fill : undefined}
              contentContainerStyle={styles.body}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={isIOS ? 'interactive' : 'on-drag'}
              showsVerticalScrollIndicator={false}
            >
              {children}
            </ScrollView>
          ) : (
            <View style={[styles.bodyStatic, full && styles.fill]}>{children}</View>
          )}

          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(7,9,12,0.46)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.canvas,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    borderColor: colors.hairline,
    ...shadows.floating,
  },
  top: { paddingTop: spacing.sm, paddingHorizontal: gutter },
  handle: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.hairlineStrong, marginBottom: spacing.md },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingBottom: spacing.md },
  headerText: { flex: 1, gap: spacing.xxs },
  body: { paddingHorizontal: gutter, paddingBottom: spacing.lg, gap: spacing.md },
  bodyStatic: { paddingHorizontal: gutter, minHeight: 0 },
  footer: {
    paddingHorizontal: gutter,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    gap: spacing.sm,
  },
});
