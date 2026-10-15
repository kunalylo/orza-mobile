/**
 * Hero card: the calorie EnergyRing with the kcal left as a big Playfair numeral, kcal eaten and macro bars.
 * Over target → a gentle link to Rebalance (no guilt).
 */
import { StyleSheet, View, useWindowDimensions } from 'react-native';

import type { Targets } from '@/lib/types';
import { colors, gutter, radii, spacing } from '@/theme';
import { EnergyRing, GlassCard, Icon, PressableScale, ProgressBar, Text } from '@/ui';

import type { Nutrients } from '@/features/meals/types';
import { formatNumber, round } from '@/features/meals/utils';

type Palette = 'energy' | 'cyan' | 'violet' | 'success';

function MacroRow({ label, value, target, palette }: { label: string; value: number; target: number; palette: Palette }) {
  const v = round(value, 0);
  const t = Math.round(target || 0);
  const pct = t > 0 ? Math.min(1, value / t) : 0;
  return (
    <View accessible accessibilityLabel={`${label}: ${v} of ${t} grams`}>
      <View style={styles.macroHead}>
        <Text variant="label" tone="ink">
          {label}
        </Text>
        <Text variant="mono" tone="muted">
          <Text variant="mono" tone="ink">
            {formatNumber(v)}
          </Text>{' '}
          / {formatNumber(t)} g
        </Text>
      </View>
      <ProgressBar value={pct} palette={palette} height={7} style={styles.bar} />
    </View>
  );
}

export function EnergyCard({
  totals,
  targets,
  remaining,
  isToday,
  onRebalance,
}: {
  totals: Nutrients;
  targets: Targets;
  remaining: { calories: number; protein_g: number };
  isToday: boolean;
  onRebalance: () => void;
}) {
  const { width } = useWindowDimensions();
  const ring = Math.max(168, Math.min(212, width - gutter * 2 - spacing.xl * 2 - 24));
  const over = remaining.calories < 0;
  const pct = targets.calories > 0 ? Math.round((totals.calories / targets.calories) * 100) : 0;
  const progress = targets.calories > 0 ? totals.calories / targets.calories : 0;
  const left = Math.abs(Math.round(remaining.calories));

  return (
    <GlassCard tone="strong" glow>
      <View style={styles.ringWrap}>
        <EnergyRing
          progress={progress}
          size={ring}
          stroke={13}
          accessibilityLabel={
            over
              ? `${formatNumber(left)} kilocalories over your ${formatNumber(targets.calories)} target`
              : `${formatNumber(left)} kilocalories left of ${formatNumber(targets.calories)}`
          }
        >
          <Text variant="eyebrow" tone="subtle" style={styles.ringEyebrow}>
            {over ? 'Over target' : 'Kcal left'}
          </Text>
          <Text
            variant="display"
            tone="ink"
            style={[styles.bigNum, { fontSize: ring > 190 ? 50 : 42, lineHeight: ring > 190 ? 56 : 48 }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
          >
            {over ? '+' : ''}
            {formatNumber(left)}
          </Text>
          <Text variant="caption" tone="muted">
            of {formatNumber(targets.calories)} kcal
          </Text>
        </EnergyRing>
      </View>

      <View style={styles.balanceHead}>
        <Text variant="eyebrow" tone="subtle">
          Energy balance
        </Text>
        <Text variant="mono" tone="subtle">
          {pct}%
        </Text>
      </View>
      <View style={styles.eatenRow}>
        <Text variant="stat" tone="ink">
          {formatNumber(totals.calories)}
        </Text>
        <Text variant="small" tone="muted">
          kcal eaten{isToday ? ' today' : ''}
        </Text>
      </View>

      <View style={styles.macros}>
        <MacroRow label="Protein" value={totals.protein_g} target={targets.protein_g} palette="energy" />
        <MacroRow label="Carbs" value={totals.carbs_g} target={targets.carbs_g} palette="cyan" />
        <MacroRow label="Fat" value={totals.fat_g} target={targets.fat_g} palette="violet" />
        <MacroRow label="Fibre" value={totals.fiber_g} target={targets.fiber_g} palette="success" />
      </View>

      {over ? (
        <PressableScale onPress={onRebalance} haptic="soft" accessibilityRole="link" accessibilityLabel="Enjoyed a special meal? Get a supportive rebalance plan" style={styles.rebalance}>
          <Icon name="mci:hand-heart-outline" size={20} color={colors.energyInk} />
          <Text variant="small" tone="ink" style={styles.flex}>
            <Text variant="small" weight="semibold" tone="ink">
              Enjoyed a special meal?
            </Text>{' '}
            <Text variant="small" tone="muted">
              Get a supportive rebalance plan — no guilt.
            </Text>
          </Text>
          <Icon name="arrow-up-right" size={16} color={colors.muted} />
        </PressableScale>
      ) : null}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  ringWrap: { alignItems: 'center', paddingTop: spacing.xs },
  ringEyebrow: { fontSize: 10 },
  bigNum: { marginTop: 4, letterSpacing: -1.2, fontVariant: ['tabular-nums'], paddingHorizontal: spacing.lg },
  balanceHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xl },
  eatenRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, marginTop: spacing.xs },
  macros: { marginTop: spacing.lg, gap: spacing.md },
  macroHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm },
  bar: { marginTop: 6 },
  rebalance: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.xl,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: 'rgba(255,122,106,0.28)',
    backgroundColor: 'rgba(255,241,234,0.85)',
  },
});
