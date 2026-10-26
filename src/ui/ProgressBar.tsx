import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { colors, gradients, motion, radii } from '@/theme';

type Palette = keyof typeof gradients;

export interface ProgressBarProps {
  /** 0..1 (clamped). */
  value: number;
  height?: number;
  palette?: Palette;
  trackColor?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Rounded progress bar with a gradient fill that springs to its value.
 *
 * Only the spring is Reanimated's: once it settles, the fill is a plain View whose width React owns. Left to an
 * animated `width`, a settled bar sometimes lost its fill after a tab switch (Today → Meals → Today on Android:
 * Protein / Carbs / Fat / Fibre back to an empty track, ~1 run in 3, although the spring had finished at the right
 * width) — the data a bar shows must not depend on an animation's last frame surviving.
 */
export function ProgressBar({ value, height = 8, palette = 'energy', trackColor = colors.track, accessibilityLabel, style }: ProgressBarProps) {
  const [width, setWidth] = useState(0);
  const reduce = useReducedMotion();
  const pct = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  const target = width * pct;

  const w = useSharedValue(0);
  /** The width the last finished spring reached — the fill is static while it equals `target`. */
  const [settled, setSettled] = useState<number | null>(null);
  useEffect(() => {
    if (reduce || width <= 0) return;
    w.set(
      withSpring(target, motion.springSoft, (done) => {
        if (done) scheduleOnRN(setSettled, target);
      })
    );
  }, [target, width, reduce, w]);
  const fill = useAnimatedStyle(() => ({ width: w.get() }));
  const still = reduce || width <= 0 || settled === target;

  const gradient = <LinearGradient colors={gradients[palette]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={[styles.track, { height, borderRadius: height / 2, backgroundColor: trackColor }, style]}
    >
      {still ? (
        <View style={[styles.fill, { borderRadius: height / 2, width: target }]}>{gradient}</View>
      ) : (
        <Animated.View style={[styles.fill, { borderRadius: height / 2 }, fill]}>{gradient}</Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { overflow: 'hidden', borderRadius: radii.pill },
  fill: { height: '100%', overflow: 'hidden' },
});
