/**
 * The large pill shown on the alarm when a medicine has no photo yet: a tilted energy-gradient capsule and a round
 * tablet on a warm glow, gently floating (still when Reduce Motion is on).
 */
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, G, Line, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';

export function PillIllustration({ size = 180 }: { size?: number }) {
  const reduceMotion = useReducedMotion();
  const float = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) return;
    float.set(withRepeat(withTiming(1, { duration: 2400, easing: Easing.inOut(Easing.sin) }), -1, true));
    return () => cancelAnimation(float);
  }, [reduceMotion, float]);

  const floatStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -6 * float.get() }, { rotate: `${-2 + 4 * float.get()}deg` }] }));

  return (
    <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={size} height={size} viewBox="0 0 200 200" style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="pillGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#FFB454" stopOpacity={0.42} />
            <Stop offset="0.45" stopColor="#FF7A6A" stopOpacity={0.18} />
            <Stop offset="1" stopColor="#FF5FA2" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={100} cy={100} r={100} fill="url(#pillGlow)" />
      </Svg>
      <Animated.View style={[StyleSheet.absoluteFill, floatStyle]}>
        <Svg width={size} height={size} viewBox="0 0 200 200">
          <Defs>
            <LinearGradient id="capWarm" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#FFB454" />
              <Stop offset="0.55" stopColor="#FF7A6A" />
              <Stop offset="1" stopColor="#FF5FA2" />
            </LinearGradient>
            <LinearGradient id="capLight" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#FFFFFF" />
              <Stop offset="1" stopColor="#F2E9DF" />
            </LinearGradient>
            <LinearGradient id="tablet" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#FFFFFF" />
              <Stop offset="1" stopColor="#E7DDD1" />
            </LinearGradient>
          </Defs>
          {/* Capsule, tilted */}
          <G transform="rotate(-35 100 92)">
            <Rect x={42} y={72} width={116} height={42} rx={21} fill="url(#capLight)" />
            <Rect x={100} y={72} width={58} height={42} rx={21} fill="url(#capWarm)" />
            <Rect x={100} y={72} width={22} height={42} fill="url(#capWarm)" />
            <Rect x={54} y={79} width={36} height={7} rx={3.5} fill="#FFFFFF" opacity={0.9} />
            <Rect x={112} y={79} width={34} height={7} rx={3.5} fill="#FFFFFF" opacity={0.35} />
          </G>
          {/* Round tablet */}
          <Circle cx={142} cy={146} r={22} fill="url(#tablet)" />
          <Line x1={127} y1={146} x2={157} y2={146} stroke="#D9CCBD" strokeWidth={3} strokeLinecap="round" />
          <Circle cx={134} cy={137} r={4} fill="#FFFFFF" opacity={0.9} />
        </Svg>
      </Animated.View>
    </View>
  );
}
