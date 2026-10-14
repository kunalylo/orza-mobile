import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { colors, radii, spacing } from '@/theme';

export interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  /** Circle of `height` diameter. */
  circle?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Placeholder block with a soft light sweep (static pulse when Reduce Motion is on). */
export function Skeleton({ width = '100%', height = 14, radius = radii.xs, circle, style }: SkeletonProps) {
  const reduce = useReducedMotion();
  const [w, setW] = useState(0);
  const t = useSharedValue(0);

  useEffect(() => {
    t.set(withRepeat(withTiming(1, { duration: reduce ? 900 : 1300, easing: Easing.inOut(Easing.quad) }), -1, reduce));
  }, [reduce, t]);

  const sweep = useAnimatedStyle(() => ({
    transform: [{ translateX: -w + t.get() * w * 2 }],
  }));
  const pulse = useAnimatedStyle(() => ({ opacity: 0.55 + t.get() * 0.45 }));

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      style={[
        styles.base,
        { width: circle ? height : width, height, borderRadius: circle ? height / 2 : radius },
        reduce ? pulse : null,
        style,
      ]}
    >
      {!reduce && w > 0 ? (
        <Animated.View style={[StyleSheet.absoluteFill, sweep]}>
          <LinearGradient
            colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.75)', 'rgba(255,255,255,0)']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

/** A few lines of text-shaped skeletons. */
export function SkeletonText({ lines = 3, style }: { lines?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ gap: spacing.sm }, style]}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? '62%' : '100%'} height={12} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  base: { backgroundColor: colors.canvas2, overflow: 'hidden' },
});
