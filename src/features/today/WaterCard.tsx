/**
 * Water tracker — tap a glass to set the count (tapping the last full glass empties it), or use − / +.
 * Optimistic: the count changes instantly; writes are serialised so the latest value always wins (see useWaterWriter).
 */
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';

import { haptics } from '@/lib/haptics';
import { colors, motion, radii, spacing } from '@/theme';
import { GlassCard, Icon, IconButton, PressableScale, Text } from '@/ui';

import { useWaterWriter } from './api';
import { MAX_GLASSES, formatMl } from './format';
import { TrackerHead } from './TrackerHead';

const MAX_SLOTS = 16;

function Glass({ filled, index, nextValue, onPress }: { filled: boolean; index: number; nextValue: number; onPress: () => void }) {
  const reduce = useReducedMotion();
  const scale = useSharedValue(1);
  const mounted = useRef(false);
  useEffect(() => {
    // Pop only when the glass changes, not on first paint.
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (reduce) return;
    scale.set(withSequence(withTiming(filled ? 1.16 : 0.9, { duration: 110 }), withSpring(1, motion.spring)));
  }, [filled, reduce, scale]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  return (
    <PressableScale
      onPress={onPress}
      haptic="none"
      scaleTo={0.92}
      accessibilityRole="button"
      accessibilityLabel={`Glass ${index + 1}. Set water to ${nextValue} glass${nextValue === 1 ? '' : 'es'}`}
      accessibilityState={{ checked: filled }}
      hitSlop={3}
      style={[styles.glass, filled ? styles.glassFull : styles.glassEmpty]}
    >
      <Animated.View style={style}>
        <Icon name={filled ? 'mci:cup-water' : 'mci:cup-outline'} size={19} color={filled ? colors.cyan600 : 'rgba(20,20,20,0.24)'} />
      </Animated.View>
    </PressableScale>
  );
}

export function WaterCard({ date, glasses, target }: { date: string; glasses: number; target: number }) {
  const { value, commit } = useWaterWriter(date, glasses);
  const slots = Math.min(Math.max(target, value), MAX_SLOTS);
  const extra = value - slots;
  const done = target > 0 && value >= target;

  const set = (n: number) => {
    if (n === value) return;
    if (target > 0 && n >= target && value < target) haptics.success();
    else haptics.select();
    commit(n);
  };

  return (
    <GlassCard>
      <TrackerHead icon="droplet" tone="cyan" label="Water" right={formatMl(value * 250)} />
      <View style={styles.bigRow}>
        <Text variant="stat" tone="ink" accessibilityLiveRegion="polite" accessibilityLabel={`${value} of ${target} glasses`}>
          {value}
        </Text>
        <Text variant="small" tone="muted">
          of {target} glasses
        </Text>
      </View>

      <View style={styles.glasses} accessibilityLabel="Glasses of water — tap to set">
        {Array.from({ length: slots }, (_, i) => {
          const filled = i < value;
          const nextValue = filled && i + 1 === value ? i : i + 1;
          return <Glass key={i} index={i} filled={filled} nextValue={nextValue} onPress={() => set(nextValue)} />;
        })}
        {extra > 0 ? (
          <View style={[styles.glass, styles.glassFull, styles.extra]}>
            <Text variant="label" color={colors.cyan600}>
              +{extra}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.foot}>
        <Text variant="caption" tone={done ? 'success' : 'subtle'} weight={done ? 'semibold' : undefined} style={styles.flex}>
          {done ? 'Hydration goal reached' : `${Math.max(0, target - value)} to go · 250 ml each`}
        </Text>
        <IconButton icon="minus" size={38} iconSize={16} accessibilityLabel="Remove a glass" disabled={value <= 0} onPress={() => set(value - 1)} haptic="none" />
        <IconButton icon="plus" variant="solid" size={38} iconSize={16} accessibilityLabel="Add a glass" disabled={value >= MAX_GLASSES} onPress={() => set(value + 1)} haptic="none" />
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  bigRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, marginTop: spacing.md },
  glasses: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: spacing.md },
  glass: { width: 30, height: 38, borderRadius: 9, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  glassFull: { borderColor: 'rgba(11,190,220,0.32)', backgroundColor: colors.cyan50 },
  glassEmpty: { borderColor: colors.divider, backgroundColor: 'rgba(255,255,255,0.5)' },
  extra: { width: undefined, paddingHorizontal: spacing.sm, borderRadius: radii.xs + 2 },
  foot: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg },
});
