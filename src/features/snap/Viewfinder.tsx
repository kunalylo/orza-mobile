/**
 * Glass viewfinder (after the web's ÖRZA Lens scanner): corner brackets, the chosen photo or a stylised thali,
 * a cyan scan line + progress captions while analysing, and confidence / dish chips on results.
 */
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, Ellipse, G, RadialGradient, Rect, Stop } from 'react-native-svg';

import { colors, radii, shadows, spacing } from '@/theme';
import { GlassCard, Text } from '@/ui';

import type { ScanPhase } from './types';
import { SCAN_STEPS, percent } from './utils';

/* ───────────────────────────── Art ───────────────────────────── */

/** Stylised thali shown before a photo is chosen (echoes the ÖRZA Lens illustration). */
function PlateIllustration() {
  const katoris = [
    { cx: 300, cy: 200, fill: 'url(#vfDal)' },
    { cx: 420, cy: 168, fill: 'url(#vfSabzi)' },
    { cx: 530, cy: 220, fill: 'url(#vfCurd)' },
  ];
  return (
    <Svg width="100%" height="100%" viewBox="0 0 800 600" preserveAspectRatio="xMidYMid slice" style={StyleSheet.absoluteFill}>
      <Defs>
        <RadialGradient id="vfPlate" cx="50%" cy="50%" r="55%">
          <Stop offset="0" stopColor="#F7F4EF" />
          <Stop offset="0.72" stopColor="#E7DDD1" />
          <Stop offset="1" stopColor="#CDB894" />
        </RadialGradient>
        <RadialGradient id="vfDal" cx="50%" cy="45%" r="55%">
          <Stop offset="0" stopColor="#F2B84B" />
          <Stop offset="1" stopColor="#C77F1A" />
        </RadialGradient>
        <RadialGradient id="vfSabzi" cx="50%" cy="45%" r="55%">
          <Stop offset="0" stopColor="#9DBA5A" />
          <Stop offset="1" stopColor="#5E7E2A" />
        </RadialGradient>
        <RadialGradient id="vfCurd" cx="50%" cy="45%" r="55%">
          <Stop offset="0" stopColor="#FFFFFF" />
          <Stop offset="1" stopColor="#E9E4DA" />
        </RadialGradient>
        <RadialGradient id="vfRoti" cx="45%" cy="45%" r="60%">
          <Stop offset="0" stopColor="#EFCB8A" />
          <Stop offset="0.7" stopColor="#D9A558" />
          <Stop offset="1" stopColor="#A8742C" />
        </RadialGradient>
        <RadialGradient id="vfVignette" cx="50%" cy="50%" r="70%">
          <Stop offset="0.5" stopColor="#FBF7F1" stopOpacity={0} />
          <Stop offset="1" stopColor="#EFE7DD" stopOpacity={0.6} />
        </RadialGradient>
      </Defs>
      <Rect width="800" height="600" fill="#EFE7DD" />
      <Ellipse cx="400" cy="540" rx="270" ry="20" fill="rgba(20,20,20,0.10)" />
      <Circle cx="400" cy="300" r="236" fill="url(#vfPlate)" stroke="rgba(20,20,20,0.10)" strokeWidth={2} />
      <Circle cx="400" cy="300" r="200" fill="none" stroke="rgba(20,20,20,0.06)" />
      {katoris.map((k) => (
        <G key={k.cx}>
          <Circle cx={k.cx} cy={k.cy} r="62" fill="#D8CCBB" stroke="rgba(20,20,20,0.12)" strokeWidth={2} />
          <Circle cx={k.cx} cy={k.cy} r="50" fill={k.fill} />
          <Ellipse cx={k.cx - 14} cy={k.cy - 16} rx="16" ry="8" fill="rgba(255,255,255,0.22)" />
        </G>
      ))}
      <Ellipse cx="330" cy="365" rx="96" ry="66" fill="#FBF8F1" stroke="rgba(20,20,20,0.06)" />
      <Ellipse cx="312" cy="350" rx="40" ry="18" fill="rgba(255,255,255,0.8)" />
      <Ellipse cx="505" cy="360" rx="92" ry="70" fill="url(#vfRoti)" />
      <Ellipse cx="520" cy="385" rx="92" ry="70" fill="url(#vfRoti)" opacity={0.92} />
      <Circle cx="498" cy="370" r="6" fill="rgba(122,70,20,0.45)" />
      <Circle cx="545" cy="400" r="5" fill="rgba(122,70,20,0.4)" />
      <Circle cx="530" cy="355" r="4" fill="rgba(122,70,20,0.35)" />
      <Circle cx="420" cy="455" r="10" fill="#E24B3B" />
      <Circle cx="444" cy="462" r="9" fill="#9CC75A" />
      <Circle cx="398" cy="468" r="8" fill="#F1E9C8" />
      <Rect width="800" height="600" fill="url(#vfVignette)" />
    </Svg>
  );
}

/** Four L-shaped corner brackets framing the shot (cyan with a glow while scanning). */
function Brackets({ active }: { active: boolean }) {
  const tone = active ? styles.bracketActive : styles.bracketIdle;
  return (
    <View pointerEvents="none" style={styles.brackets}>
      <View style={[styles.bracket, tone, styles.tl]} />
      <View style={[styles.bracket, tone, styles.tr]} />
      <View style={[styles.bracket, tone, styles.bl]} />
      <View style={[styles.bracket, tone, styles.br]} />
    </View>
  );
}

/* ───────────────────────────── Scanning ───────────────────────────── */

/** Cyan line sweeping top ↔ bottom (hidden with Reduce Motion). */
function ScanLine({ height }: { height: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.set(withRepeat(withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.quad) }), -1, true));
    return () => cancelAnimation(t);
  }, [t]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: 8 + t.get() * Math.max(0, height - 18) }] }));
  return (
    <Animated.View pointerEvents="none" style={[styles.scanLine, style]}>
      <LinearGradient colors={['rgba(47,210,240,0)', 'rgba(47,210,240,0.95)', 'rgba(47,210,240,0)']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.scanLineFill} />
    </Animated.View>
  );
}

/** "Spotting each item…" captions that advance every 2.6 s (mounted only while scanning, so it restarts each time). */
function ScanCaption() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => Math.min(s + 1, SCAN_STEPS.length - 1)), 2600);
    return () => clearInterval(t);
  }, []);
  return (
    <View style={styles.captionRow} pointerEvents="none">
      <View style={styles.captionPill} accessibilityLiveRegion="polite" accessibilityRole="text">
        <ActivityIndicator size="small" color={colors.cyan600} />
        <Animated.View key={step} entering={FadeIn.duration(220)} style={styles.shrink}>
          <Text variant="caption" weight="medium" tone="ink" numberOfLines={1}>
            {SCAN_STEPS[step]}…
          </Text>
        </Animated.View>
      </View>
    </View>
  );
}

function PulseDot({ color, pulsing }: { color: string; pulsing: boolean }) {
  const reduce = useReducedMotion();
  const o = useSharedValue(1);
  useEffect(() => {
    if (pulsing && !reduce) o.set(withRepeat(withTiming(0.3, { duration: 700 }), -1, true));
    else {
      cancelAnimation(o);
      o.set(1);
    }
    return () => cancelAnimation(o);
  }, [pulsing, reduce, o]);
  const style = useAnimatedStyle(() => ({ opacity: o.get() }));
  return <Animated.View style={[styles.dot, { backgroundColor: color }, style]} />;
}

/* ───────────────────────────── Viewfinder ───────────────────────────── */

export function Viewfinder({
  imageUri,
  phase,
  confidence,
  dishName,
  children,
}: {
  /** Local file URI of the chosen photo. */
  imageUri: string | null;
  phase: ScanPhase;
  confidence?: number;
  dishName?: string;
  /** Controls under the frame (take photo / gallery / analyse). */
  children?: ReactNode;
}) {
  const reduce = useReducedMotion();
  const [frameH, setFrameH] = useState(0);
  const scanning = phase === 'scanning';
  const showResult = (phase === 'result' || phase === 'logged') && confidence != null;

  const status = scanning ? 'Analysing' : phase === 'logged' ? 'Logged' : phase === 'result' ? 'Analysed' : imageUri ? 'Photo ready' : 'Viewfinder';
  const dotColor = scanning ? colors.cyan400 : imageUri ? colors.success : colors.amber;

  const onLayout = (e: LayoutChangeEvent) => setFrameH(e.nativeEvent.layout.height);

  return (
    <GlassCard tone="strong" padding={spacing.md}>
      <View style={styles.head}>
        <View style={styles.headLeft}>
          <PulseDot color={dotColor} pulsing={scanning} />
          <Text variant="eyebrow" tone="subtle">
            {status}
          </Text>
        </View>
        <Text variant="caption" tone="subtle" numberOfLines={1} style={styles.shrink}>
          {imageUri ? 'Resized on your device' : 'One plate at a time'}
        </Text>
      </View>

      <View
        style={styles.frame}
        onLayout={onLayout}
        accessible
        accessibilityRole="image"
        accessibilityLabel={imageUri ? (dishName ? `Your meal photo: ${dishName}` : 'Your meal photo') : 'Viewfinder. Frame the whole plate, from slightly above.'}
      >
        {imageUri ? (
          <Image source={{ uri: imageUri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={reduce ? 0 : 260} />
        ) : (
          <>
            <PlateIllustration />
            <View style={styles.captionRow} pointerEvents="none">
              <View style={styles.captionPill}>
                <Text variant="caption" weight="medium" tone="ink" numberOfLines={1}>
                  Frame the whole plate, from slightly above
                </Text>
              </View>
            </View>
          </>
        )}

        {scanning ? (
          <Animated.View entering={FadeIn.duration(260)} exiting={FadeOut.duration(220)} style={StyleSheet.absoluteFill} pointerEvents="none">
            <LinearGradient colors={['rgba(7,9,12,0.22)', 'rgba(7,9,12,0.46)']} style={StyleSheet.absoluteFill} />
            {!reduce && frameH > 0 ? <ScanLine height={frameH} /> : null}
            <ScanCaption />
          </Animated.View>
        ) : null}

        {showResult ? (
          <Animated.View entering={FadeIn.duration(300)} style={StyleSheet.absoluteFill} pointerEvents="none">
            <LinearGradient colors={['rgba(7,9,12,0)', 'rgba(7,9,12,0.6)']} style={styles.resultShade} />
            <Animated.View entering={reduce ? undefined : FadeInDown.springify().damping(16).stiffness(100).mass(1)} style={styles.confChip}>
              <View style={[styles.dot, { backgroundColor: colors.cyan }]} />
              <Text variant="caption" weight="semibold" tone="ink">
                Confidence · {percent(confidence ?? 0)}
              </Text>
            </Animated.View>
            {dishName ? (
              <View style={styles.dish}>
                <Text variant="h3" color={colors.white} numberOfLines={2} style={styles.dishText}>
                  {dishName}
                </Text>
              </View>
            ) : null}
          </Animated.View>
        ) : null}

        {/* On results the confidence chip and the dish name take the corners — the brackets ran through both. */}
        {showResult ? null : <Brackets active={scanning} />}
      </View>

      {children ? <View style={styles.controls}>{children}</View> : null}
    </GlassCard>
  );
}

const B = 28;

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, paddingHorizontal: spacing.xs, marginBottom: spacing.md },
  headLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  shrink: { flexShrink: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  frame: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: radii.md,
    overflow: 'hidden',
    backgroundColor: colors.canvas2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
  },
  brackets: { position: 'absolute', top: spacing.md, left: spacing.md, right: spacing.md, bottom: spacing.md },
  bracket: { position: 'absolute', width: B, height: B, borderColor: 'rgba(255,255,255,0.92)' },
  bracketIdle: { borderColor: 'rgba(255,255,255,0.92)', boxShadow: '0px 1px 4px rgba(7,9,12,0.30)' },
  bracketActive: { borderColor: colors.cyan400, boxShadow: '0px 0px 10px rgba(47,210,240,0.7)' },
  tl: { left: 0, top: 0, borderLeftWidth: 2.5, borderTopWidth: 2.5, borderTopLeftRadius: 12 },
  tr: { right: 0, top: 0, borderRightWidth: 2.5, borderTopWidth: 2.5, borderTopRightRadius: 12 },
  bl: { left: 0, bottom: 0, borderLeftWidth: 2.5, borderBottomWidth: 2.5, borderBottomLeftRadius: 12 },
  br: { right: 0, bottom: 0, borderRightWidth: 2.5, borderBottomWidth: 2.5, borderBottomRightRadius: 12 },
  scanLine: { position: 'absolute', left: 0, right: 0, top: 0, height: 2, boxShadow: '0px 0px 14px rgba(47,210,240,0.7)' },
  scanLineFill: { flex: 1 },
  captionRow: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.lg, alignItems: 'center' },
  captionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    maxWidth: '100%',
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(255,255,255,0.9)',
    ...shadows.floating,
  },
  resultShade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '45%' },
  confChip: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(255,255,255,0.92)',
    ...shadows.floating,
  },
  dish: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.md },
  dishText: { textShadowColor: 'rgba(7,9,12,0.5)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 8 },
  controls: { marginTop: spacing.lg },
});
