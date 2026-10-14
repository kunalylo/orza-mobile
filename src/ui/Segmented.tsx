import { useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, withSpring } from 'react-native-reanimated';

import { haptics } from '@/lib/haptics';
import { colors, motion, radii, shadows } from '@/theme';

import { Text } from './Text';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel: string;
  size?: 'sm' | 'md';
  style?: StyleProp<ViewStyle>;
}

/** Glass segmented control with a springy sliding thumb (equal-width segments). */
export function Segmented<T extends string>({ options, value, onChange, accessibilityLabel, size = 'md', style }: SegmentedProps<T>) {
  const [width, setWidth] = useState(0);
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const segment = options.length ? (width - PAD * 2) / options.length : 0;

  const thumb = useAnimatedStyle(() => ({
    width: segment,
    opacity: segment > 0 ? 1 : 0,
    transform: [{ translateX: withSpring(index * segment, motion.spring) }],
  }));

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      style={[styles.track, size === 'sm' ? styles.sm : styles.md, style]}
    >
      <Animated.View pointerEvents="none" style={[styles.thumb, thumb]} />
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityLabel={o.label}
            accessibilityState={{ checked: active }}
            onPress={() => {
              if (active) return;
              haptics.select();
              onChange(o.value);
            }}
            style={styles.segment}
          >
            <Text variant={size === 'sm' ? 'caption' : 'small'} weight={active ? 'semibold' : 'medium'} tone={active ? 'ink' : 'muted'} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const PAD = 4;

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    padding: PAD,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(20,20,20,0.05)',
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  md: { height: 44 },
  sm: { height: 36 },
  thumb: {
    position: 'absolute',
    top: PAD,
    bottom: PAD,
    left: PAD,
    borderRadius: radii.pill,
    backgroundColor: colors.white,
    ...shadows.soft,
  },
  segment: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
});
