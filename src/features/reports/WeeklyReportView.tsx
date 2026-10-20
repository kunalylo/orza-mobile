/** Weekly tab body: averages, calories day by day vs target, protein / water / steps minis and the week in words. */
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';

import { formatNumber, formatWeight, kgToUnit, formatDecimal } from '@/features/goals/math';
import { colors, radii, spacing } from '@/theme';
import { GlassCard, Icon, Orb, Skeleton, Text } from '@/ui';

import { weekdayLong } from './format';
import type { WeeklyReport } from './types';
import { CalorieChart, Legend, LegendItem, MiniBars } from './WeeklyCharts';

export function WeeklyReportView({ report, today, imperial, dimmed }: { report: WeeklyReport; today: string; imperial: boolean; dimmed: boolean }) {
  const reduce = useReducedMotion();
  const r = report;
  const enter = (i: number) => (reduce ? undefined : FadeInDown.delay(i * 60).springify().damping(18).stiffness(100).mass(1));

  return (
    <View style={[styles.stack, dimmed && styles.dimmed]} accessibilityState={{ busy: dimmed }}>
      <Animated.View key={`stats-${r.end}`} entering={enter(0)} style={styles.grid}>
        <Stat label="Avg calories" value={r.logged_days ? formatNumber(r.averages.calories) : '—'} unit={r.logged_days ? 'kcal' : undefined} hint={`Target ${formatNumber(r.targets.calories)} kcal`} />
        <Stat label="Avg protein" value={r.logged_days ? formatNumber(r.averages.protein_g) : '—'} unit={r.logged_days ? 'g' : undefined} hint={`Target ${formatNumber(r.targets.protein_g)} g`} />
        <Stat label="On-target days" value={String(r.adherence)} unit={`of ${r.logged_days}`} hint="Within ±10% of your calories" />
        <Stat label="Days logged" value={String(r.logged_days)} unit="of 7" hint={r.logged_days === 7 ? 'A full week — lovely consistency' : 'Days with at least one meal'} />
      </Animated.View>

      <Animated.View key={`cal-${r.end}`} entering={enter(1)}>
        <GlassCard tone="strong">
          <Text variant="eyebrow" tone="subtle">
            Calories
          </Text>
          <Text variant="h3" accessibilityRole="header" style={styles.cardTitle}>
            Your week, day by day
          </Text>
          <Legend>
            <LegendItem swatch="bar" label="Logged calories" />
            <LegendItem swatch="dash" label={`Target ${formatNumber(r.targets.calories)}`} />
            <LegendItem swatch="band" label="±10% range" />
          </Legend>
          <View style={styles.chart}>
            <CalorieChart days={r.days} target={r.targets.calories} today={today} bestDate={r.logged_days > 1 ? r.best_day?.date : undefined} />
          </View>
        </GlassCard>
      </Animated.View>

      <Animated.View key={`minis-${r.end}`} entering={enter(2)} style={styles.stack}>
        <MiniBars
          title="Protein"
          icon="mci:dumbbell"
          days={r.days}
          value={(d) => d.protein_g}
          target={r.targets.protein_g}
          unit="g"
          tone="violet"
          average={`${formatNumber(r.averages.protein_g)} g`}
          today={today}
        />
        <MiniBars
          title="Water"
          icon="mci:cup-water"
          days={r.days}
          value={(d) => d.water_glasses}
          target={r.targets.water_glasses}
          unit="glasses"
          tone="cyan"
          average={formatDecimal(r.averages.water_glasses)}
          today={today}
        />
        <MiniBars
          title="Steps"
          icon="mci:shoe-print"
          days={r.days}
          value={(d) => d.steps}
          target={r.targets.steps}
          unit="steps"
          tone="success"
          average={formatNumber(r.averages.steps)}
          today={today}
        />
      </Animated.View>

      <Animated.View key={`words-${r.end}`} entering={enter(3)}>
        <View style={styles.hero}>
          <Orb size={220} tone="dark" orbits={false} style={styles.orb} />
          <Text variant="eyebrow" tone="heroSubtle">
            Your week in words
          </Text>
          <Text variant="h3" tone="inverse" style={styles.summary}>
            {r.summary}
          </Text>
          <View style={styles.facts}>
            <View style={styles.fact} accessible accessibilityLabel={`Most balanced day: ${r.best_day && r.logged_days > 1 ? `${weekdayLong(r.best_day.date)}, score ${r.best_day.score}` : 'log two or more days to see it'}`}>
              <View style={styles.factHead}>
                <Icon name="star" size={12} color={colors.amber} />
                <Text variant="eyebrow" tone="heroSubtle" style={styles.factLabel}>
                  Most balanced day
                </Text>
              </View>
              <Text variant="callout" color="rgba(247,244,239,0.9)">
                {r.best_day && r.logged_days > 1 ? `${weekdayLong(r.best_day.date)} · score ${r.best_day.score}` : 'Log two or more days to see it'}
              </Text>
            </View>
            <View style={styles.fact} accessible>
              <View style={styles.factHead}>
                <Icon name="mci:scale-bathroom" size={12} color={colors.amber} />
                <Text variant="eyebrow" tone="heroSubtle" style={styles.factLabel}>
                  Weigh-ins
                </Text>
              </View>
              <Text variant="callout" color="rgba(247,244,239,0.9)" style={styles.tabular}>
                {r.weight
                  ? r.weight.entries > 1
                    ? `${formatDecimal(kgToUnit(r.weight.first, imperial))} → ${formatWeight(r.weight.last, imperial)}`
                    : formatWeight(r.weight.last, imperial)
                  : 'No weigh-ins this week'}
              </Text>
            </View>
          </View>
        </View>
      </Animated.View>

      <Text variant="caption" tone="subtle" align="center">
        Wellness guidance, not medical advice. For medical concerns, please consult your doctor.
      </Text>
    </View>
  );
}

function Stat({ label, value, unit, hint }: { label: string; value: string; unit?: string; hint: string }) {
  return (
    <View style={styles.cell}>
      <GlassCard padding={spacing.lg} style={styles.statCard} accessible accessibilityLabel={`${label}: ${value}${unit ? ` ${unit}` : ''}. ${hint}`}>
        <Text variant="eyebrow" tone="subtle" numberOfLines={1}>
          {label}
        </Text>
        <View style={styles.statRow}>
          <Text variant="h2" style={styles.tabular} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
            {value}
          </Text>
          {unit ? (
            <Text variant="caption" tone="muted">
              {unit}
            </Text>
          ) : null}
        </View>
        <Text variant="caption" tone="subtle" numberOfLines={2}>
          {hint}
        </Text>
      </GlassCard>
    </View>
  );
}

export function WeeklySkeleton() {
  return (
    <View style={styles.stack} accessibilityLabel="Loading weekly report" accessibilityState={{ busy: true }}>
      <View style={styles.grid}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={styles.cell}>
            <Skeleton height={112} radius={radii.lg} />
          </View>
        ))}
      </View>
      <Skeleton height={340} radius={radii.lg} />
      <Skeleton height={180} radius={radii.lg} />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.lg },
  dimmed: { opacity: 0.55 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -spacing.xs, marginVertical: -spacing.xs },
  cell: { width: '50%', padding: spacing.xs },
  statCard: { flex: 1, minHeight: 112 },
  statRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: spacing.sm, marginBottom: 2 },
  tabular: { fontVariant: ['tabular-nums'], flexShrink: 1 },
  cardTitle: { marginTop: 4, marginBottom: spacing.md },
  chart: { marginTop: spacing.md },
  hero: { backgroundColor: colors.hero, borderRadius: radii.xl, padding: spacing.xl, overflow: 'hidden', boxShadow: '0px 18px 60px rgba(20,20,20,0.22)' },
  orb: { position: 'absolute', right: -90, bottom: -100, opacity: 0.75 },
  summary: { marginTop: spacing.md, lineHeight: 30 },
  facts: { marginTop: spacing.xl, gap: spacing.sm },
  fact: { borderRadius: radii.sm, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', backgroundColor: 'rgba(255,255,255,0.07)', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: 4 },
  factHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  factLabel: { fontSize: 10 },
});
