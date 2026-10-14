import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';

import { playHaptic, type HapticKind } from '@/lib/haptics';
import { motion } from '@/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface PressableScaleProps extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle>;
  /** Scale while pressed (default 0.965). */
  scaleTo?: number;
  /** Haptic on press (default "tap"). */
  haptic?: HapticKind;
}

/** A Pressable that springs down while held and gives a light haptic — the base of every tappable surface. */
export function PressableScale({ style, scaleTo = motion.pressScale, haptic = 'tap', onPressIn, onPressOut, onPress, disabled, ...rest }: PressableScaleProps) {
  const reduce = useReducedMotion();
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  return (
    <AnimatedPressable
      accessibilityRole="button"
      disabled={disabled}
      accessibilityState={{ disabled: !!disabled }}
      onPressIn={(e) => {
        if (!reduce) scale.set(withSpring(scaleTo, motion.spring));
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.set(withSpring(1, motion.spring));
        onPressOut?.(e);
      }}
      onPress={(e) => {
        playHaptic(haptic);
        onPress?.(e);
      }}
      style={[style, animated]}
      {...rest}
    />
  );
}
