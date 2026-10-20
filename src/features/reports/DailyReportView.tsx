/** Daily tab body: score ring, totals vs targets, highlights, gentle suggestions and the day's meals. */
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';

import { formatNumber, formatWeight } from '@/features/goals/math';
import { colors, radii, spacing, type gradients } from '@/theme';
import { Button, EmptyState, GlassCard, Icon, ProgressBar, Skeleton, Tag, Text, type IconName } from '@/ui';

import { MEAL_LABELS, longDate } from './format';
import { ScoreCard } from './ScoreCard';
import type { DailyReport } from './types';

export function DailyReportView({ report, imperial, dimmed }: { report: DailyReport; imperial: boolean; dimmed: boolean }) {
  const reduce = useReducedMotion();
  const r = report;
  const enter = (i: number) => (reduce ? undefined : FadeInDown.delay(i * 60).springify().damping(18).stiffness(100).mass(1));

  return (
    <View style={[styles.stack, dimmed && styles.dimmed]} accessibilityState={{ busy: dimmed }}>
      <Animated.View key={`score-${r.date}`} entering={enter(0)}>
        <ScoreCard report={r} />
      </Animated.View>

      <Animated.View key={`totals-${r.date}`} entering={enter(1)}>
        <GlassCard>
          <CardTitle eyebrow="Totals vs targets" title={longDate(r.date)} />
          <View style={styles.rows}>
            <MacroRow label="Calories" value={r.totals.calories} target={r.targets.calories} unit="kcal" />
            <MacroRow label="Protein" value={r.totals.protein_g} target={r.targets.protein_g} palette="violet" />
            <MacroRow label="Carbs" value={r.totals.carbs_g} target={r.targets.carbs_g} />
            <MacroRow label="Fat" value={r.totals.fat_g} target={r.targets.fat_g} />
            <MacroRow label="Fibre" value={r.totals.fiber_g} target={r.targets.fiber_g} palette="success" />
            <View style={styles.divider} />
            <MacroRow label="Water" value={r.tracking.water_glasses} target={r.targets.water_glasses} unit="glasses" palette="cyan" />
            <MacroRow label="Steps" value={r.tracking.steps} target={r.targets.steps} unit="steps" palette="success" />
          </View>
          {r.tracking.weight_kg ? (
            <Text variant="small" tone="muted" style={styles.weigh}>
              Weigh-in:{' '}
              <Text variant="small" weight="semibold" style={styles.tabular}>
                {formatWeight(r.tracking.weight_kg, imperial)}
              </Text>
            </Text>
          ) : null}
        </GlassCard>
      </Animated.View>

      <Animated.View key={`hl-${r.date}`} entering={enter(2)}>
        <GlassCard>
          <CardTitle eyebrow="Highlights" title="What went well" />
          {r.highlights.length ? (
            <View style={styles.list}>
              {r.highlights.map((h) => (
                <Bullet key={h} icon="check" bg={colors.successBg} fg={colors.success} text={h} />
              ))}
            </View>
          ) : (
            <Text variant="small" tone="muted" style={styles.listEmpty}>
              Log meals, water or steps and ÖRZA will point out what&apos;s going well.
            </Text>
          )}
        </GlassCard>
      </Animated.View>

      <Animated.View key={`sg-${r.date}`} entering={enter(3)}>
        <GlassCard tone="energy">
          <CardTitle eyebrow="Suggestions" title="Gentle next steps" />
          {r.suggestions.length ? (
            <View style={styles.list}>
              {r.suggestions.map((s) => (
                <Bullet key={s} icon="zap" bg="rgba(255,255,255,0.8)" fg="#E0593F" text={s} />
              ))}
            </View>
          ) : (
            <Text variant="small" tone="muted" style={styles.listEmpty}>
              {r.is_today ? 'Nothing to adjust — enjoy the rest of your day.' : 'Nothing to adjust for this day.'}
            </Text>
          )}
          <Text variant="caption" tone="subtle" style={styles.wellness}>
            Wellness guidance, not medical advice.
          </Text>
        </GlassCard>
      </Animated.View>

      <Animated.View key={`meals-${r.date}`} entering={enter(4)}>
        <GlassCard>
          <View style={styles.mealsHead}>
            <View style={styles.flex}>
              <CardTitle eyebrow={`Meals · ${r.meals.length}`} title={r.is_today ? 'Logged today' : 'Logged that day'} />
            </View>
            <Button
              label="Meal log"
              iconRight="arrow-right"
              variant="ghost"
              size="sm"
              onPress={() => router.dismissTo({ pathname: '/meals', params: { date: r.date } })}
            />
          </View>
          {r.meals.length ? (
            <View style={styles.meals}>
              {r.meals.map((m, i) => (
                <View
                  key={m.id}
                  style={[styles.meal, i > 0 && styles.mealBorder]}
                  accessible
                  accessibilityLabel={`${MEAL_LABELS[m.meal_type] || m.meal_type}: ${m.items.map((x) => x.name).join(', ') || m.description || 'Meal'}, ${formatNumber(m.totals.calories)} kilocalories`}
                >
                  <Tag label={MEAL_LABELS[m.meal_type] || m.meal_type} />
                  <View style={styles.flex}>
                    <Text variant="small" numberOfLines={2}>
                      {m.items.map((x) => x.name).join(', ') || m.description || 'Meal'}
                    </Text>
                    <Text variant="caption" tone="subtle" style={styles.tabular}>
                      {formatNumber(m.totals.protein_g)} g protein · {formatNumber(m.totals.carbs_g)} g carbs · {formatNumber(m.totals.fat_g)} g fat
                    </Text>
                  </View>
                  <Text variant="label" style={styles.tabular}>
                    {formatNumber(m.totals.calories)}
                    <Text variant="caption" tone="subtle">
                      {' '}
                      kcal
                    </Text>
                  </Text>
                </View>
              ))}
            </View>
          ) : (
            <EmptyState
              icon="mci:silverware-fork-knife"
              title={r.is_today ? 'No meals logged today' : 'No meals logged on this day'}
              body="Snap a photo, type or speak what you ate — your report fills in automatically."
              actionLabel={r.is_today ? 'Log a meal' : undefined}
              actionVariant="primary"
              onAction={r.is_today ? () => router.dismissTo({ pathname: '/meals', params: { compose: '1', date: r.date } }) : undefined}
              style={styles.empty}
            />
          )}
        </GlassCard>
      </Animated.View>
    </View>
  );
}

function CardTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <View>
      <Text variant="eyebrow" tone="subtle">
        {eyebrow}
      </Text>
      <Text variant="h3" accessibilityRole="header" style={styles.cardTitle}>
        {title}
      </Text>
    </View>
  );
}

function MacroRow({ label, value, target, unit = 'g', palette = 'energy' }: { label: string; value: number; target: number; unit?: string; palette?: keyof typeof gradients }) {
  const pct = target > 0 ? value / target : 0;
  return (
    <View accessible accessibilityLabel={`${label}: ${formatNumber(value)} of ${formatNumber(target)} ${unit}`}>
      <View style={styles.macroTop}>
        <Text variant="label">{label}</Text>
        <Text variant="caption" tone="muted" style={styles.tabular}>
          <Text variant="caption" weight="semibold" tone="ink">
            {formatNumber(value)}
          </Text>{' '}
          / {formatNumber(target)} {unit}
        </Text>
      </View>
      <ProgressBar value={pct} height={7} palette={palette} style={styles.bar} />
    </View>
  );
}

function Bullet({ icon, bg, fg, text }: { icon: IconName; bg: string; fg: string; text: string }) {
  return (
    <View style={styles.bullet}>
      <View style={[styles.bulletIcon, { backgroundColor: bg }]}>
        <Icon name={icon} size={13} color={fg} />
      </View>
      <Text variant="callout" style={styles.flex}>
        {text}
      </Text>
    </View>
  );
}

export function DailySkeleton() {
  return (
    <View style={styles.stack} accessibilityLabel="Loading daily report" accessibilityState={{ busy: true }}>
      <Skeleton height={460} radius={radii.lg} />
      <Skeleton height={380} radius={radii.lg} />
      <Skeleton height={180} radius={radii.lg} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  stack: { gap: spacing.lg },
  dimmed: { opacity: 0.55 },
  cardTitle: { marginTop: 4 },
  rows: { marginTop: spacing.lg, gap: spacing.md },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.hairlineStrong, marginVertical: spacing.xs },
  macroTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.md },
  bar: { marginTop: 6 },
  tabular: { fontVariant: ['tabular-nums'] },
  weigh: { marginTop: spacing.lg },
  list: { marginTop: spacing.lg, gap: spacing.md },
  listEmpty: { marginTop: spacing.md },
  bullet: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  bulletIcon: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  wellness: { marginTop: spacing.lg },
  mealsHead: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  meals: { marginTop: spacing.md },
  meal: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingVertical: spacing.md },
  mealBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  empty: { paddingVertical: spacing.xl, paddingHorizontal: 0 },
});
