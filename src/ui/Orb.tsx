/**
 * The ÖRZA orb — the web hero's "convergence" core, made alive for the phone: a warm amber → coral → pink
 * sphere that breathes inside a pulsing glow, with two slowly counter-rotating dashed orbits carrying
 * violet and cyan satellites. Transforms run on the UI thread (Reanimated); Reduce Motion freezes it.
 */
import { useEffect, useId } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { colors } from '@/theme';

export interface OrbProps {
  size?: number;
  /** `dark` for the hero (full glow + orbits), `light` for the cream canvas (softer glow). */
  tone?: 'dark' | 'light';
  /** Show the dashed orbits + satellites (default true). */
  orbits?: boolean;
  /** Pause all motion (e.g. while a screen is in the background). */
  paused?: boolean;
  /** Faster, brighter pulse — "ÖRZA is thinking". */
  active?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Orb({ size = 220, tone = 'dark', orbits = true, paused, active, style }: OrbProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const reduce = useReducedMotion();
  const still = reduce || paused;

  const breathe = useSharedValue(0);
  const spin = useSharedValue(0);
  const spinB = useSharedValue(0);

  useEffect(() => {
    if (still) {
      cancelAnimation(breathe);
      cancelAnimation(spin);
      cancelAnimation(spinB);
      return;
    }
    const half = active ? 900 : 2600;
    breathe.set(
      withRepeat(
        withSequence(withTiming(1, { duration: half, easing: Easing.inOut(Easing.sin) }), withTiming(0, { duration: half, easing: Easing.inOut(Easing.sin) })),
        -1
      )
    );
    // Each loop covers exactly one turn, so the restart is seamless (0° ≡ 360°).
    spin.set(withRepeat(withTiming(spin.get() + 1, { duration: active ? 9000 : 28000, easing: Easing.linear }), -1));
    spinB.set(withRepeat(withTiming(spinB.get() + 1, { duration: active ? 14000 : 42000, easing: Easing.linear }), -1));
    return () => {
      cancelAnimation(breathe);
      cancelAnimation(spin);
      cancelAnimation(spinB);
    };
  }, [still, active, breathe, spin, spinB]);

  const glowStyle = useAnimatedStyle(() => ({
    opacity: 0.72 + breathe.get() * 0.28,
    transform: [{ scale: 0.94 + breathe.get() * 0.1 }],
  }));
  const coreStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 + breathe.get() * 0.035 }] }));
  const orbitA = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.get() * 360}deg` }] }));
  const orbitB = useAnimatedStyle(() => ({ transform: [{ rotate: `${140 - spinB.get() * 360}deg` }] }));

  const light = tone === 'light';
  const c = size / 2;
  const coreR = size * 0.2;
  const orbitR1 = size * 0.355;
  const orbitR2 = size * 0.44;
  const dash = `${size * 0.012} ${size * 0.022}`;
  const ring = light ? 'rgba(11,143,166,0.30)' : 'rgba(47,210,240,0.38)';

  return (
    <View style={[{ width: size, height: size }, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none">
      {/* Glow */}
      <Animated.View style={[StyleSheet.absoluteFill, glowStyle]}>
        <Svg width={size} height={size}>
          <Defs>
            <RadialGradient id={`glow${uid}`} cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={colors.cream} stopOpacity={light ? 0.75 : 0.95} />
              <Stop offset="0.3" stopColor={colors.amber} stopOpacity={light ? 0.42 : 0.6} />
              <Stop offset="0.62" stopColor={colors.coral} stopOpacity={light ? 0.16 : 0.26} />
              <Stop offset="1" stopColor={colors.pink} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={c} cy={c} r={c} fill={`url(#glow${uid})`} />
        </Svg>
      </Animated.View>

      {/* Orbits */}
      {orbits ? (
        <>
          <Animated.View style={[StyleSheet.absoluteFill, orbitA]}>
            <Svg width={size} height={size}>
              <Defs>
                <RadialGradient id={`satA${uid}`} cx="50%" cy="50%" r="50%">
                  <Stop offset="0" stopColor={colors.violet300} stopOpacity={0.9} />
                  <Stop offset="1" stopColor={colors.violet300} stopOpacity={0} />
                </RadialGradient>
              </Defs>
              <Circle cx={c} cy={c} r={orbitR1} stroke={ring} strokeWidth={Math.max(1, size * 0.005)} strokeDasharray={dash} fill="none" />
              <Circle cx={c + orbitR1 * 0.707} cy={c - orbitR1 * 0.707} r={size * 0.04} fill={`url(#satA${uid})`} />
              <Circle cx={c + orbitR1 * 0.707} cy={c - orbitR1 * 0.707} r={size * 0.014} fill="#C9B5FF" />
            </Svg>
          </Animated.View>
          <Animated.View style={[StyleSheet.absoluteFill, orbitB]}>
            <Svg width={size} height={size}>
              <Defs>
                <RadialGradient id={`satB${uid}`} cx="50%" cy="50%" r="50%">
                  <Stop offset="0" stopColor={colors.cyan300} stopOpacity={0.9} />
                  <Stop offset="1" stopColor={colors.cyan300} stopOpacity={0} />
                </RadialGradient>
              </Defs>
              <Circle cx={c} cy={c} r={orbitR2} stroke={light ? 'rgba(135,87,242,0.18)' : 'rgba(191,168,255,0.22)'} strokeWidth={Math.max(1, size * 0.004)} strokeDasharray={dash} fill="none" />
              <Circle cx={c - orbitR2} cy={c} r={size * 0.032} fill={`url(#satB${uid})`} />
              <Circle cx={c - orbitR2} cy={c} r={size * 0.011} fill={colors.cyan300} />
            </Svg>
          </Animated.View>
        </>
      ) : null}

      {/* Core sphere */}
      <Animated.View style={[StyleSheet.absoluteFill, coreStyle]}>
        <Svg width={size} height={size}>
          <Defs>
            <RadialGradient id={`core${uid}`} cx="36%" cy="30%" r="78%" fx="34%" fy="28%">
              <Stop offset="0" stopColor="#FFE9CF" />
              <Stop offset="0.28" stopColor={colors.amber} />
              <Stop offset="0.66" stopColor={colors.coral} />
              <Stop offset="1" stopColor={colors.pink} />
            </RadialGradient>
            <RadialGradient id={`spec${uid}`} cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={colors.white} stopOpacity={0.85} />
              <Stop offset="1" stopColor={colors.white} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={c} cy={c} r={coreR} fill={`url(#core${uid})`} />
          <Circle cx={c - coreR * 0.32} cy={c - coreR * 0.38} r={coreR * 0.42} fill={`url(#spec${uid})`} />
        </Svg>
      </Animated.View>
    </View>
  );
}
