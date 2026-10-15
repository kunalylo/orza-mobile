/** Weight trend (last 120 days): chart / list toggle and "Log weight" (bottom sheet). */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, LinearTransition, useReducedMotion } from 'react-native-reanimated';

import { colors, radii, spacing } from '@/theme';
import { Button, GlassCard, Icon, Segmented, Text } from '@/ui';

import { LogWeightSheet } from './LogWeightSheet';
import { formatDayDate, formatDecimal, formatShortDate, formatWeight, kgToUnit, weightUnit } from './math';
import type { WeightPoint } from './types';
import { WeightChart } from './WeightChart';

type View_ = 'chart' | 'list';

export function WeightTrendCard({ points, target, imperial, today }: { points: WeightPoint[]; target?: number | null; imperial: boolean; today: string }) {
  const reduce = useReducedMotion();
  const [view, setView] = useState<View_>('chart');
  const [logOpen, setLogOpen] = useState(false);
  const n = points.length;
  const first = points[0];
  const last = points[n - 1];
  const change = n > 1 ? Math.round((kgToUnit(last.weight_kg, imperial) - kgToUnit(first.weight_kg, imperial)) * 10) / 10 : null;
  const loggedToday = last?.date === today;

  return (
    <GlassCard tone="strong" padding={spacing.xl}>
      <View style={styles.head}>
        <View style={styles.flex}>
          <Text variant="eyebrow" tone="subtle">
            Weight trend
          </Text>
          {last ? (
            <View style={styles.headline}>
              <Text variant="h2" style={styles.tabular}>
                {formatWeight(last.weight_kg, imperial)}
              </Text>
              <Text variant="caption" tone="muted">
                {change == null
                  ? `on ${formatShortDate(last.date)}`
                  : change === 0
                    ? `steady since ${formatShortDate(first.date)}`
                    : `${change > 0 ? '+' : '−'}${formatDecimal(Math.abs(change))} ${weightUnit(imperial)} since ${formatShortDate(first.date)}`}
              </Text>
            </View>
          ) : (
            <Text variant="h3" style={styles.headline}>
              Last 120 days
            </Text>
          )}
        </View>
        {n > 1 ? (
          <Segmented<View_>
            size="sm"
            accessibilityLabel="Show weigh-ins as"
            value={view}
            onChange={setView}
            options={[
              { value: 'chart', label: 'Chart' },
              { value: 'list', label: 'List' },
            ]}
            style={styles.toggle}
          />
        ) : null}
      </View>

      <Animated.View key={n === 0 ? 'empty' : view} entering={reduce ? undefined : FadeIn.duration(220)} layout={reduce ? undefined : LinearTransition.springify().damping(20)} style={styles.body}>
        {n === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyDisc}>
              <Icon name="trending-down" size={20} color={colors.muted} />
            </View>
            <Text variant="title" align="center">
              No weigh-ins yet
            </Text>
            <Text variant="small" tone="muted" align="center">
              Log your first one — your trend line starts building from there.
            </Text>
          </View>
        ) : view === 'list' && n > 1 ? (
          <WeightList points={points} imperial={imperial} />
        ) : (
          <>
            <WeightChart points={points} target={target} imperial={imperial} />
            {n === 1 ? (
              <Text variant="caption" tone="subtle" align="center" style={styles.single}>
                One weigh-in so far — log another in a few days to see your trend.
              </Text>
            ) : null}
          </>
        )}
      </Animated.View>

      <View style={styles.footer}>
        <Button
          label={loggedToday ? "Update today's weight" : "Log today's weight"}
          icon="plus"
          variant={n === 0 ? 'primary' : 'secondary'}
          block
          onPress={() => setLogOpen(true)}
        />
        <Text variant="caption" tone="subtle" align="center">
          Same time of day, once or twice a week, gives the clearest trend.
        </Text>
      </View>

      <LogWeightSheet visible={logOpen} onClose={() => setLogOpen(false)} latestKg={last?.weight_kg} imperial={imperial} today={today} />
    </GlassCard>
  );
}

/** Newest first, with the change from the weigh-in before. */
function WeightList({ points, imperial }: { points: WeightPoint[]; imperial: boolean }) {
  const [all, setAll] = useState(false);
  const rows = [...points].reverse();
  const visible = all ? rows : rows.slice(0, 8);
  const unit = weightUnit(imperial);
  return (
    <View>
      {visible.map((p, i) => {
        const before = rows[i + 1];
        const d = before ? Math.round((kgToUnit(p.weight_kg, imperial) - kgToUnit(before.weight_kg, imperial)) * 10) / 10 : null;
        return (
          <View key={p.date} style={[styles.row, i > 0 && styles.rowBorder]} accessible accessibilityLabel={`${formatDayDate(p.date)}: ${formatWeight(p.weight_kg, imperial)}`}>
            <Text variant="small" tone="text" style={styles.flex}>
              {formatDayDate(p.date)}
            </Text>
            {d != null && d !== 0 ? (
              <Text variant="caption" tone="subtle" style={styles.tabular}>
                {d > 0 ? '+' : '−'}
                {formatDecimal(Math.abs(d))}
              </Text>
            ) : null}
            <Text variant="label" style={[styles.tabular, styles.value]}>
              {formatDecimal(kgToUnit(p.weight_kg, imperial))} {unit}
            </Text>
          </View>
        );
      })}
      {rows.length > 8 ? (
        <Button label={all ? 'Show fewer' : `Show all ${rows.length}`} variant="ghost" size="sm" onPress={() => setAll((v) => !v)} style={styles.more} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, flexWrap: 'wrap' },
  headline: { marginTop: spacing.xs, gap: 2 },
  toggle: { width: 148 },
  tabular: { fontVariant: ['tabular-nums'] },
  body: { marginTop: spacing.lg },
  empty: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.hairlineStrong,
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  emptyDisc: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glassSolid,
    marginBottom: spacing.sm,
  },
  single: { marginTop: spacing.sm },
  footer: { marginTop: spacing.lg, gap: spacing.sm, paddingTop: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairlineStrong },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  value: { minWidth: 76, textAlign: 'right' },
  more: { alignSelf: 'center', marginTop: spacing.xs },
});
