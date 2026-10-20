/** Six daily targets as stat tiles (calories, macros, water, steps), with "vs before" after a goal change. */
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';

import type { Targets } from '@/lib/types';
import { colors, radii, spacing } from '@/theme';
import { GlassCard, Icon, Text, type IconName } from '@/ui';

import { formatNumber } from './math';

const TILES: { key: keyof Targets; label: string; unit: string; hint: string; icon: IconName; tint: string; bg: string }[] = [
  { key: 'calories', label: 'Calories', unit: 'kcal', hint: 'Your daily energy target', icon: 'mci:fire', tint: colors.energyInk, bg: colors.energyBg },
  { key: 'protein_g', label: 'Protein', unit: 'g', hint: 'Keeps you full and strong', icon: 'mci:dumbbell', tint: colors.violet600, bg: colors.violet50 },
  { key: 'carbs_g', label: 'Carbs', unit: 'g', hint: 'Steady energy for your day', icon: 'mci:barley', tint: colors.warning, bg: colors.warningBg },
  { key: 'fat_g', label: 'Fat', unit: 'g', hint: 'For hormones and absorption', icon: 'droplet', tint: '#BE185D', bg: '#FFF0F6' },
  { key: 'water_glasses', label: 'Water', unit: 'glasses', hint: 'About 250 ml each', icon: 'mci:cup-water', tint: colors.cyan700, bg: colors.cyan50 },
  { key: 'steps', label: 'Steps', unit: 'steps', hint: 'Everyday movement', icon: 'mci:shoe-print', tint: colors.success, bg: colors.successBg },
];

export function TargetsGrid({ targets, previous }: { targets: Targets; previous?: Targets | null }) {
  const reduce = useReducedMotion();
  return (
    <View style={styles.grid}>
      {TILES.map((t, i) => {
        const value = Number(targets[t.key]) || 0;
        const before = previous ? Number(previous[t.key]) || 0 : null;
        const delta = before != null ? Math.round(value - before) : 0;
        return (
          <Animated.View key={t.key} style={styles.cell} entering={reduce ? undefined : FadeInDown.delay(i * 40).springify().damping(18).stiffness(100).mass(1)}>
            <GlassCard padding={spacing.lg} style={styles.card} accessible accessibilityLabel={`${t.label}: ${formatNumber(value)} ${t.unit}${delta ? `, ${delta > 0 ? 'up' : 'down'} ${formatNumber(Math.abs(delta))} from before` : ''}`}>
              <View style={styles.top}>
                <Text variant="eyebrow" tone="subtle">
                  {t.label}
                </Text>
                <View style={[styles.icon, { backgroundColor: t.bg }]}>
                  <Icon name={t.icon} size={15} color={t.tint} />
                </View>
              </View>
              <View style={styles.valueRow}>
                <Text variant="h2" style={styles.tabular} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                  {formatNumber(value)}
                </Text>
                <Text variant="caption" tone="muted">
                  {t.unit}
                </Text>
              </View>
              <Text variant="caption" tone={delta ? 'energy' : 'subtle'} numberOfLines={2}>
                {delta ? `${delta > 0 ? '+' : '−'}${formatNumber(Math.abs(delta))} vs before` : t.hint}
              </Text>
            </GlassCard>
          </Animated.View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -spacing.xs },
  cell: { width: '50%', padding: spacing.xs },
  card: { flex: 1, minHeight: 124, borderRadius: radii.md },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  icon: { width: 28, height: 28, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: spacing.sm, marginBottom: 2 },
  tabular: { fontVariant: ['tabular-nums'], flexShrink: 1 },
});
