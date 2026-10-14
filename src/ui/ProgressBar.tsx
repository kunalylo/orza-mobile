import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, withSpring } from 'react-native-reanimated';

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

/** Rounded progress bar with a gradient fill that springs to its value. */
export function ProgressBar({ value, height = 8, palette = 'energy', trackColor = colors.track, accessibilityLabel, style }: ProgressBarProps) {
  const [width, setWidth] = useState(0);
  const reduce = useReducedMotion();
  const pct = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  const target = width * pct;

  const fill = useAnimatedStyle(() => ({
    width: reduce ? target : withSpring(target, motion.springSoft),
  }));

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={[styles.track, { height, borderRadius: height / 2, backgroundColor: trackColor }, style]}
    >
      <Animated.View style={[styles.fill, { borderRadius: height / 2 }, fill]}>
        <LinearGradient colors={gradients[palette]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { overflow: 'hidden', borderRadius: radii.pill },
  fill: { height: '100%', overflow: 'hidden' },
});
