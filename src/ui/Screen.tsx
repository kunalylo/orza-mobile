import { LinearGradient } from 'expo-linear-gradient';
import type { ReactElement, ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type RefreshControlProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { colors, gutter, layout } from '@/theme';

export type BackdropVariant = 'canvas' | 'orb' | 'hero' | 'none';

export interface ScreenProps {
  children?: ReactNode;
  /** Wrap content in a ScrollView (default true). */
  scroll?: boolean;
  /** `canvas` warm cream gradient; `orb` adds the warm/cool glows; `hero` is the dark ÖRZA hero. */
  backdrop?: BackdropVariant;
  /** Apply the top / bottom safe-area insets (default both). */
  edges?: ('top' | 'bottom')[];
  /** Horizontal page gutter (default true). */
  padded?: boolean;
  /** Avoid the keyboard (forms). */
  keyboard?: boolean;
  /** Leave room for the floating tab bar. */
  tabBar?: boolean;
  /** Fixed above the scroll area. */
  header?: ReactNode;
  /** Fixed at the bottom (e.g. a primary action or composer). */
  footer?: ReactNode;
  refreshControl?: ReactElement<RefreshControlProps>;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Bottom space taken by the floating glass tab bar (+ the raised Snap button), including the safe area. */
export function useTabBarSpace() {
  const insets = useSafeAreaInsets();
  return layout.tabBarHeight + Math.max(insets.bottom, layout.tabBarGap) + 24;
}

export function Backdrop({ variant }: { variant: BackdropVariant }) {
  if (variant === 'none') return null;
  if (variant === 'hero') {
    return (
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <LinearGradient colors={[colors.hero, colors.hero2, colors.hero]} style={StyleSheet.absoluteFill} />
        <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
          <Defs>
            <RadialGradient id="heroWarm" cx="50%" cy="34%" r="62%">
              <Stop offset="0" stopColor={colors.coral} stopOpacity={0.22} />
              <Stop offset="0.5" stopColor={colors.amber} stopOpacity={0.06} />
              <Stop offset="1" stopColor={colors.hero} stopOpacity={0} />
            </RadialGradient>
            <RadialGradient id="heroCool" cx="8%" cy="96%" r="58%">
              <Stop offset="0" stopColor={colors.cyan} stopOpacity={0.14} />
              <Stop offset="1" stopColor={colors.hero} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#heroWarm)" />
          <Rect width="100%" height="100%" fill="url(#heroCool)" />
        </Svg>
      </View>
    );
  }
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient colors={[colors.canvas, colors.canvas1]} style={StyleSheet.absoluteFill} />
      {variant === 'orb' ? (
        <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
          <Defs>
            <RadialGradient id="canvasWarm" cx="100%" cy="0%" r="70%">
              <Stop offset="0" stopColor={colors.amber} stopOpacity={0.3} />
              <Stop offset="0.45" stopColor={colors.coral} stopOpacity={0.1} />
              <Stop offset="1" stopColor={colors.canvas} stopOpacity={0} />
            </RadialGradient>
            <RadialGradient id="canvasCool" cx="0%" cy="100%" r="65%">
              <Stop offset="0" stopColor={colors.cyan} stopOpacity={0.12} />
              <Stop offset="0.5" stopColor={colors.violet} stopOpacity={0.04} />
              <Stop offset="1" stopColor={colors.canvas} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#canvasWarm)" />
          <Rect width="100%" height="100%" fill="url(#canvasCool)" />
        </Svg>
      ) : null}
    </View>
  );
}

/** Page container: safe areas, cream canvas (or hero), optional scroll, keyboard avoidance and tab-bar spacing. */
export function Screen({
  children,
  scroll = true,
  backdrop = 'canvas',
  edges = ['top', 'bottom'],
  padded = true,
  keyboard,
  tabBar,
  header,
  footer,
  refreshControl,
  style,
  contentContainerStyle,
  testID,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const tabSpace = useTabBarSpace();
  const top = edges.includes('top') ? insets.top : 0;
  const bottomInset = edges.includes('bottom') ? insets.bottom : 0;
  const bottom = tabBar ? tabSpace : footer ? 0 : bottomInset + 16;
  const pad: ViewStyle = padded ? { paddingHorizontal: gutter } : {};

  const body = scroll ? (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[styles.grow, pad, { paddingBottom: bottom }, contentContainerStyle]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      showsVerticalScrollIndicator={false}
      refreshControl={refreshControl}
      contentInsetAdjustmentBehavior="never"
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, pad, { paddingBottom: bottom }, contentContainerStyle]}>{children}</View>
  );

  const inner = (
    <>
      {header}
      {body}
      {footer ? <View style={{ paddingBottom: tabBar ? 0 : bottomInset }}>{footer}</View> : null}
    </>
  );

  return (
    <View testID={testID} style={[styles.root, { paddingTop: top, backgroundColor: backdrop === 'hero' ? colors.hero : colors.canvas }, style]}>
      <Backdrop variant={backdrop} />
      {keyboard ? (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {inner}
        </KeyboardAvoidingView>
      ) : (
        inner
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  grow: { flexGrow: 1 },
});
