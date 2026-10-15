/** A slow-breathing amber → coral → pink glow behind the alarm's clock (static when Reduce Motion is on). */
import { useEffect } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

export function AlarmGlow({ active = true }: { active?: boolean }) {
  const { width } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const breath = useSharedValue(0);
  const size = Math.round(width * 1.25);

  useEffect(() => {
    if (reduceMotion || !active) {
      cancelAnimation(breath);
      breath.set(withTiming(0.5, { duration: 300 }));
      return;
    }
    breath.set(withRepeat(withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.sin) }), -1, true));
    return () => cancelAnimation(breath);
  }, [reduceMotion, active, breath]);

  const style = useAnimatedStyle(() => ({
    opacity: 0.55 + 0.35 * breath.get(),
    transform: [{ scale: 0.92 + 0.12 * breath.get() }],
  }));

  return (
    <Animated.View pointerEvents="none" style={[styles.wrap, { width: size, height: size, top: -size * 0.42, left: (width - size) / 2 }, style]}>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id="alarmGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#FF7A6A" stopOpacity={0.5} />
            <Stop offset="0.35" stopColor="#FFB454" stopOpacity={0.22} />
            <Stop offset="0.7" stopColor="#FF5FA2" stopOpacity={0.06} />
            <Stop offset="1" stopColor="#07090C" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={size / 2} fill="url(#alarmGlow)" />
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute' },
});
