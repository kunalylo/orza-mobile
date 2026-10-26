import { useEffect, useId, useState, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedProps, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';

import { colors, gradients, motion } from '@/theme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

type Palette = keyof typeof gradients;

export interface EnergyRingProps {
  /** 0..1; values above 1 draw a full ring. */
  progress: number;
  size?: number;
  stroke?: number;
  palette?: Palette;
  trackColor?: string;
  /** Delay before the sweep animates in (stagger several rings). */
  delay?: number;
  children?: ReactNode;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/** Circular progress with a gradient arc that sweeps in from 12 o'clock; centre content via `children`. */
export function EnergyRing({
  progress,
  size = 120,
  stroke = 10,
  palette = 'energy',
  trackColor = colors.track,
  delay = 0,
  children,
  accessibilityLabel,
  style,
}: EnergyRingProps) {
  const id = `ring${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const reduce = useReducedMotion();
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const target = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  const shown = useSharedValue(0);
  /**
   * The progress the last finished sweep reached. While it equals `target` the arc is a plain Circle whose offset React
   * owns (same reason as ProgressBar: an animated SVG prop that settled could fall back to its first frame — an empty
   * track — after a tab switch).
   */
  const [settled, setSettled] = useState<number | null>(null);

  useEffect(() => {
    if (reduce) return;
    shown.set(
      withDelay(
        delay,
        withTiming(target, { duration: motion.ring, easing: Easing.out(Easing.cubic) }, (done) => {
          if (done) scheduleOnRN(setSettled, target);
        })
      )
    );
  }, [target, delay, reduce, shown]);
  const still = reduce || settled === target;

  const arc = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - shown.get()),
    // A round cap would leave a dot at 0 % — hide the arc until there is something to show.
    strokeOpacity: shown.get() > 0.002 ? 1 : 0,
  }));

  const stops = gradients[palette];
  const arcProps = {
    cx: size / 2,
    cy: size / 2,
    r,
    stroke: `url(#${id})`,
    strokeWidth: stroke,
    strokeLinecap: 'round' as const,
    fill: 'none',
    strokeDasharray: `${circumference} ${circumference}`,
    transform: `rotate(-90 ${size / 2} ${size / 2})`,
  };

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(target * 100) }}
      style={[{ width: size, height: size }, style]}
    >
      <Svg width={size} height={size} style={styles.svg}>
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            {stops.map((c, i) => (
              <Stop key={c} offset={i / (stops.length - 1)} stopColor={c} />
            ))}
          </LinearGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={trackColor} strokeWidth={stroke} fill="none" />
        {/* A plain Circle when settled (a new element: nothing of the animated one's props carries over). */}
        {still ? (
          <Circle {...arcProps} strokeDashoffset={circumference * (1 - target)} strokeOpacity={target > 0.002 ? 1 : 0} />
        ) : (
          <AnimatedCircle {...arcProps} animatedProps={arc} />
        )}
      </Svg>
      <View style={styles.center}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  svg: { position: 'absolute' },
  center: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
});
