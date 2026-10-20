/**
 * The prescription frame on the capture screen: an empty "lay it flat" frame, the picked photo with corner marks, and
 * while the AI reads it a sweeping cyan scan line over a dimmed photo (a calm pulse instead when Reduce Motion is on).
 */
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { mediaSource } from '@/lib/api';
import { colors, diagonal, fonts, radii, spacing } from '@/theme';
import { Icon, Text } from '@/ui';

const isLocal = (u: string) => /^(file|data|content|ph|assets-library):/.test(u);

function Corners({ color }: { color: string }) {
  const c = { borderColor: color };
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={[styles.corner, styles.tl, c]} />
      <View style={[styles.corner, styles.tr, c]} />
      <View style={[styles.corner, styles.bl, c]} />
      <View style={[styles.corner, styles.br, c]} />
    </View>
  );
}

function ScanOverlay({ height }: { height: number }) {
  const reduceMotion = useReducedMotion();
  const y = useSharedValue(0);
  const pulse = useSharedValue(0.35);

  useEffect(() => {
    if (reduceMotion) {
      pulse.set(withRepeat(withSequence(withTiming(0.6, { duration: 900 }), withTiming(0.35, { duration: 900 })), -1));
    } else {
      y.set(withRepeat(withTiming(1, { duration: 1700, easing: Easing.inOut(Easing.quad) }), -1, true));
    }
    return () => {
      cancelAnimation(y);
      cancelAnimation(pulse);
    };
  }, [reduceMotion, y, pulse]);

  const lineStyle = useAnimatedStyle(() => ({ transform: [{ translateY: y.get() * Math.max(0, height - 64) }] }));
  const tintStyle = useAnimatedStyle(() => ({ opacity: pulse.get() }));

  return (
    <Animated.View pointerEvents="none" entering={FadeIn.duration(220)} exiting={FadeOut.duration(220)} style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.dim, tintStyle]} />
      {reduceMotion ? null : (
        <Animated.View style={[styles.lineWrap, lineStyle]}>
          <LinearGradient colors={['rgba(47,210,240,0)', 'rgba(47,210,240,0.28)', 'rgba(47,210,240,0)']} style={StyleSheet.absoluteFill} />
          <View style={styles.line} />
        </Animated.View>
      )}
    </Animated.View>
  );
}

export function Viewfinder({ uri, scanning }: { uri: string | null; scanning: boolean }) {
  const { width, height: windowHeight } = useWindowDimensions();
  const frameHeight = Math.round(Math.min((width - 2 * spacing.xl) * 1.2, windowHeight * 0.46, 520));
  const source = uri ? (isLocal(uri) ? { uri } : mediaSource(uri)) : undefined;
  const state = scanning ? 'Reading' : uri ? 'Photo ready' : 'Prescription';

  return (
    <View style={[styles.frame, { height: frameHeight }]}>
      {source ? (
        <>
          <Image source={source} style={StyleSheet.absoluteFill} contentFit="contain" transition={200} accessibilityLabel="Your prescription photo" />
          <Corners color="rgba(255,255,255,0.9)" />
          {scanning ? <ScanOverlay height={frameHeight} /> : null}
        </>
      ) : (
        <LinearGradient colors={[colors.cream, colors.canvas1, colors.cyan50]} {...diagonal} style={[StyleSheet.absoluteFill, styles.empty]}>
          <Corners color={colors.hairlineStrong} />
          <View style={styles.emptyIcon}>
            <Icon name="mci:file-document-outline" size={30} color={colors.energyInk} />
          </View>
          <Text variant="title" align="center" style={styles.emptyTitle}>
            Your prescription goes here
          </Text>
          <Text variant="small" tone="muted" align="center" style={styles.emptyBody}>
            Lay it flat in good light and fit the whole page in the frame.
          </Text>
        </LinearGradient>
      )}

      <View style={[styles.badge, source ? styles.badgeDark : styles.badgeLight]} accessibilityLiveRegion="polite">
        <View style={[styles.dot, { backgroundColor: scanning ? colors.cyan400 : uri ? colors.success : colors.hairlineStrong }]} />
        <Text style={[styles.badgeText, { color: source ? colors.heroText : colors.muted }]}>{state}</Text>
      </View>
    </View>
  );
}

const CORNER = 26;

const styles = StyleSheet.create({
  frame: {
    width: '100%',
    borderRadius: radii.lg,
    overflow: 'hidden',
    backgroundColor: '#11161C',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  empty: { alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glassStrong,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  emptyTitle: { marginTop: spacing.lg },
  emptyBody: { marginTop: spacing.xs, maxWidth: 260 },
  corner: { position: 'absolute', width: CORNER, height: CORNER },
  tl: { top: 14, left: 14, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 10 },
  tr: { top: 14, right: 14, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 10 },
  bl: { bottom: 14, left: 14, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 10 },
  br: { bottom: 14, right: 14, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 10 },
  dim: { backgroundColor: 'rgba(7,9,12,0.55)' },
  lineWrap: { position: 'absolute', left: 0, right: 0, top: 0, height: 64, justifyContent: 'center' },
  line: { height: 2, marginHorizontal: spacing.md, borderRadius: 1, backgroundColor: colors.cyan300, boxShadow: '0px 0px 12px rgba(47,210,240,0.9)' },
  // Inside the top-left corner mark: at the frame's edge it sat on the mark, whose lines showed through the glass.
  badge: {
    position: 'absolute',
    top: 24,
    left: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.pill,
  },
  badgeDark: { backgroundColor: 'rgba(7,9,12,0.62)' },
  badgeLight: { backgroundColor: colors.glassStrong, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline },
  dot: { width: 7, height: 7, borderRadius: 4 },
  badgeText: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 1.4, textTransform: 'uppercase' },
});
