/**
 * Water tracker — tap a glass to set the count (tapping the last full glass empties it), or use − / +.
 * Optimistic: the count changes instantly; writes are serialised so the latest value always wins (see useWaterWriter).
 */
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';

import { haptics } from '@/lib/haptics';
import { colors, motion, radii, spacing } from '@/theme';
import { GlassCard, Icon, IconButton, PressableScale, Text } from '@/ui';

import { useWaterWriter } from './api';
import { MAX_GLASSES, formatMl } from './format';
import { TrackerHead } from './TrackerHead';

const MAX_SLOTS = 16;
const GLASS_W = 30;
const GLASS_MIN_W = 24;
const GAP = 5;

/**
 * Glass width and row width for `cells` glasses in a row `rowWidth` wide: one row whenever they fit at ≥ 24 dp (the
 * common 9–13 glass targets on a 360–411 dp phone), else evenly filled rows — never a lone glass wrapped onto its own
 * line (10 glasses at a fixed 30 dp broke as 9 + 1 on a 411 dp phone).
 */
function glassLayout(rowWidth: number, cells: number) {
  if (rowWidth <= 0 || cells <= 0) return { width: GLASS_W, rowMax: undefined };
  const fit = Math.max(1, Math.floor((rowWidth + GAP) / (GLASS_MIN_W + GAP)));
  const perRow = Math.ceil(cells / Math.ceil(cells / fit));
  const width = Math.max(GLASS_MIN_W, Math.min(GLASS_W, Math.floor((rowWidth - GAP * (perRow - 1)) / perRow)));
  return { width, rowMax: perRow * width + (perRow - 1) * GAP };
}

function Glass({ filled, index, nextValue, width, onPress }: { filled: boolean; index: number; nextValue: number; width: number; onPress: () => void }) {
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
      style={[styles.glass, { width }, filled ? styles.glassFull : styles.glassEmpty]}
    >
      <Animated.View style={style}>
        <Icon name={filled ? 'mci:cup-water' : 'mci:cup-outline'} size={19} color={filled ? colors.cyan600 : 'rgba(20,20,20,0.24)'} />
      </Animated.View>
    </PressableScale>
  );
}

export function WaterCard({ date, glasses, target }: { date: string; glasses: number; target: number }) {
  const { value, current, commit } = useWaterWriter(date, glasses);
  const slots = Math.min(Math.max(target, value), MAX_SLOTS);
  const extra = value - slots;
  const done = target > 0 && value >= target;
  const [rowWidth, setRowWidth] = useState(0);
  const onRowLayout = (e: LayoutChangeEvent) => setRowWidth(Math.floor(e.nativeEvent.layout.width));
  const layout = glassLayout(rowWidth, slots + (extra > 0 ? 1 : 0));

  // `current()`, not `value`: fast taps can land before the card re-renders.
  const set = (n: number) => {
    const from = current();
    if (n === from) return;
    if (target > 0 && n >= target && from < target) haptics.success();
    else haptics.select();
    commit(n);
  };

  return (
    <GlassCard>
      <TrackerHead icon="droplet" tone="cyan" label="Water" right={formatMl(value * 250)} />
      {/* − / + sit beside the count, above the glasses: the glass rows reflow (one row ↔ two) as the count passes what
          fits, and buttons below them would jump away from a thumb tapping fast. */}
      <View style={styles.countRow}>
        <View style={styles.bigRow}>
          <Text variant="stat" tone="ink" accessibilityLiveRegion="polite" accessibilityLabel={`${value} of ${target} glasses`}>
            {value}
          </Text>
          <Text variant="small" tone="muted" style={styles.flex} numberOfLines={1}>
            of {target} glasses
          </Text>
        </View>
        <IconButton icon="minus" size={38} iconSize={16} accessibilityLabel="Remove a glass" disabled={value <= 0} onPress={() => set(current() - 1)} haptic="none" />
        <IconButton icon="plus" variant="solid" size={38} iconSize={16} accessibilityLabel="Add a glass" disabled={value >= MAX_GLASSES} onPress={() => set(current() + 1)} haptic="none" />
      </View>

      <View style={styles.glassesBox} onLayout={onRowLayout}>
        <View style={[styles.glasses, { maxWidth: layout.rowMax }]} accessibilityLabel="Glasses of water — tap to set">
          {Array.from({ length: slots }, (_, i) => {
            const filled = i < value;
            const nextValue = filled && i + 1 === value ? i : i + 1;
            return <Glass key={i} index={i} filled={filled} nextValue={nextValue} width={layout.width} onPress={() => set(nextValue)} />;
          })}
          {extra > 0 ? (
            <View style={[styles.glass, styles.glassFull, styles.extra]}>
              <Text variant="label" color={colors.cyan600}>
                +{extra}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      <Text variant="caption" tone={done ? 'success' : 'subtle'} weight={done ? 'semibold' : undefined} style={styles.foot}>
        {done ? 'Hydration goal reached' : `${Math.max(0, target - value)} to go · 250 ml each`}
      </Text>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  countRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  bigRow: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  glassesBox: { marginTop: spacing.md },
  glasses: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  glass: { width: GLASS_W, height: 38, borderRadius: 9, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  glassFull: { borderColor: 'rgba(11,190,220,0.32)', backgroundColor: colors.cyan50 },
  glassEmpty: { borderColor: colors.divider, backgroundColor: 'rgba(255,255,255,0.5)' },
  extra: { width: undefined, paddingHorizontal: spacing.sm, borderRadius: radii.xs + 2 },
  foot: { marginTop: spacing.md },
});
