import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import type { Targets } from '@/lib/types';
import { colors, spacing } from '@/theme';
import { EnergyRing, GlassCard, Icon, ProgressBar, Skeleton, Text } from '@/ui';

import type { Nutrients } from './types';
import { formatNumber } from './utils';

type Palette = 'energy' | 'cyan' | 'violet' | 'success';

function MacroRow({ label, value, target, palette }: { label: string; value: number; target: number; palette: Palette }) {
  const pct = target > 0 ? value / target : 0;
  return (
    <View style={styles.macro}>
      <View style={styles.macroHead}>
        <Text variant="small" tone="ink">
          {label}
        </Text>
        <Text variant="caption" tone="muted" style={styles.nums}>
          {formatNumber(value)} / {formatNumber(target)} g
        </Text>
      </View>
      <ProgressBar value={pct} palette={palette} height={6} accessibilityLabel={`${label}: ${formatNumber(value)} of ${formatNumber(target)} grams`} />
    </View>
  );
}

/** Day totals vs the user's targets: energy ring for calories + macro bars. */
export function DailySummary({
  totals,
  targets,
  dayLabel,
  loading,
}: {
  totals: Nutrients | null;
  targets: Targets;
  dayLabel: string;
  loading?: boolean;
}) {
  if (loading || !totals) {
    return (
      <GlassCard tone="strong" accessibilityLabel="Loading the day's totals">
        <View style={styles.top}>
          <Skeleton circle height={116} />
          <View style={styles.topText}>
            <Skeleton width={110} height={11} />
            <Skeleton width={150} height={22} style={styles.gapSm} />
            <Skeleton width="90%" height={12} style={styles.gapSm} />
          </View>
        </View>
        <View style={styles.macros}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={styles.macro}>
              <Skeleton width="100%" height={12} />
              <Skeleton width="100%" height={6} />
            </View>
          ))}
        </View>
      </GlassCard>
    );
  }

  const target = targets.calories || 0;
  const remaining = Math.round(target - totals.calories);
  const over = target > 0 && remaining < 0;
  const headline = target <= 0 ? 'No calorie target yet' : over ? `${formatNumber(-remaining)} kcal over` : `${formatNumber(remaining)} kcal left`;

  return (
    <GlassCard tone="strong" glow>
      <View style={styles.top}>
        <EnergyRing
          progress={target > 0 ? totals.calories / target : 0}
          size={116}
          stroke={10}
          accessibilityLabel={`${formatNumber(totals.calories)} of ${formatNumber(target)} calories`}
        >
          <Text variant="h2" tone="ink" style={styles.nums}>
            {formatNumber(totals.calories)}
          </Text>
          <Text variant="eyebrow" tone="subtle" style={styles.kcal}>
            kcal
          </Text>
        </EnergyRing>
        <View style={styles.topText}>
          <Text variant="eyebrow" tone="subtle" numberOfLines={1}>
            {dayLabel} · Totals
          </Text>
          <Text variant="h3" tone="ink" style={styles.headline}>
            {headline}
          </Text>
          <Text variant="caption" tone="muted">
            {target > 0 ? `of your ${formatNumber(target)} kcal target` : 'Set one in Goals whenever you like.'}
            {over ? " — that's okay, one day doesn't define you." : ''}
          </Text>
          {over ? (
            <Pressable onPress={() => router.push('/rebalance')} accessibilityRole="link" hitSlop={8} style={styles.link}>
              <Text variant="small" weight="semibold" tone="energy">
                Plan a gentle rebalance
              </Text>
              <Icon name="arrow-up-right" size={14} color={colors.energyInk} />
            </Pressable>
          ) : target <= 0 ? (
            <Pressable onPress={() => router.push('/goals')} accessibilityRole="link" hitSlop={8} style={styles.link}>
              <Text variant="small" weight="semibold" tone="cyan">
                Open Goals
              </Text>
              <Icon name="arrow-up-right" size={14} color={colors.cyan700} />
            </Pressable>
          ) : null}
        </View>
      </View>
      <View style={styles.macros}>
        <MacroRow label="Protein" value={totals.protein_g} target={targets.protein_g} palette="cyan" />
        <MacroRow label="Carbs" value={totals.carbs_g} target={targets.carbs_g} palette="energy" />
        <MacroRow label="Fat" value={totals.fat_g} target={targets.fat_g} palette="violet" />
        <MacroRow label="Fibre" value={totals.fiber_g} target={targets.fiber_g} palette="success" />
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  topText: { flex: 1, minWidth: 0, gap: 4 },
  gapSm: { marginTop: spacing.sm },
  headline: { marginTop: 2 },
  kcal: { marginTop: 2, fontSize: 10 },
  nums: { fontVariant: ['tabular-nums'] },
  link: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6, alignSelf: 'flex-start' },
  macros: { marginTop: spacing.xl, gap: spacing.md },
  macro: { gap: 6 },
  macroHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
});
