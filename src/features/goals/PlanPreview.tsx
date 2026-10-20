/** Dark "live preview" panel with the energy orb: daily calories, macros, maintenance, pace and estimated arrival. */
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, LinearTransition, useReducedMotion } from 'react-native-reanimated';

import type { GoalType, Targets } from '@/lib/types';
import { colors, radii, spacing } from '@/theme';
import { Icon, Orb, Text } from '@/ui';

import { formatLongDate, formatNumber, formatPace, type GoalPlan } from './math';

export function PlanPreview({
  plan,
  blocker,
  missing,
  goal,
  imperial,
  currentTargets,
  footer,
}: {
  plan: GoalPlan | null;
  blocker: string | null;
  /** Inputs still needed ("current weight", "age" …). */
  missing: string[];
  goal: GoalType;
  imperial: boolean;
  currentTargets: Targets;
  footer: ReactNode;
}) {
  const reduce = useReducedMotion();
  const show = plan && !blocker;
  const calDelta = plan ? plan.targets.calories - currentTargets.calories : 0;
  const announce = show
    ? `Daily calories ${formatNumber(plan.targets.calories)} kcal${plan.targetDate ? `, estimated around ${formatLongDate(plan.targetDate)}` : ''}.`
    : (blocker ?? '');

  return (
    <View style={styles.panel}>
      <Orb size={240} tone="dark" orbits style={styles.orb} />
      <View style={styles.wash} pointerEvents="none" />

      <View style={styles.liveRow}>
        <View style={styles.liveDot}>
          <View style={styles.liveCore} />
        </View>
        <Text variant="eyebrow" tone="heroSubtle">
          Live preview
        </Text>
      </View>

      <Text style={styles.srOnly} accessibilityLiveRegion="polite">
        {announce}
      </Text>

      <Animated.View key={show ? 'plan' : blocker ? 'blocker' : 'empty'} entering={reduce ? undefined : FadeIn.duration(260)} layout={reduce ? undefined : LinearTransition.springify().damping(20).stiffness(100).mass(1)}>
        {show ? (
          <View>
            <Text variant="small" tone="heroSubtle" style={styles.calLabel}>
              Your daily calories
            </Text>
            <View style={styles.calRow}>
              <Animated.Text key={plan.targets.calories} entering={reduce ? undefined : FadeInDown.duration(220)} style={styles.calories} maxFontSizeMultiplier={1.2}>
                {formatNumber(plan.targets.calories)}
              </Animated.Text>
              <Text variant="callout" tone="heroSubtle">
                kcal
              </Text>
            </View>
            <Text variant="caption" tone="heroSubtle" style={styles.delta}>
              {calDelta === 0
                ? 'Same as your current target'
                : `${calDelta > 0 ? '+' : '−'}${formatNumber(Math.abs(calDelta))} vs your current ${formatNumber(currentTargets.calories)}`}
            </Text>

            <View style={styles.macros}>
              {[
                { k: 'Protein', v: `${formatNumber(plan.targets.protein_g)} g` },
                { k: 'Carbs', v: `${formatNumber(plan.targets.carbs_g)} g` },
                { k: 'Fat', v: `${formatNumber(plan.targets.fat_g)} g` },
              ].map((m) => (
                <View key={m.k} style={styles.macro} accessible accessibilityLabel={`${m.k}: ${m.v}`}>
                  <Text variant="eyebrow" tone="heroSubtle" style={styles.macroKey}>
                    {m.k}
                  </Text>
                  <Text variant="label" tone="inverse" style={styles.tabular}>
                    {m.v}
                  </Text>
                </View>
              ))}
            </View>

            <View style={styles.rows}>
              <Row label="Maintenance (TDEE)" value={plan.tdee != null ? `${formatNumber(plan.tdee)} kcal` : '—'} />
              <Row label="Weekly change" value={goal === 'maintain' ? 'Hold steady' : `${plan.weeklyRate < 0 ? '−' : '+'}${formatPace(plan.weeklyRate, imperial)}`} />
              <Row
                label="Estimated arrival"
                value={plan.targetDate ? formatLongDate(plan.targetDate) : 'No finish line needed'}
                sub={plan.targetDate && plan.weeks ? `~${plan.weeks} week${plan.weeks === 1 ? '' : 's'}` : undefined}
                last
              />
            </View>

            {plan.paceAdjusted ? (
              <View style={styles.adjusted}>
                <Icon name="info" size={15} color={colors.cream} />
                <Text variant="caption" color={colors.cream} style={styles.flex}>
                  To keep your calories at a safe level, ÖRZA will plan a gentler {formatPace(plan.weeklyRate, imperial)} a week.
                </Text>
              </View>
            ) : null}
          </View>
        ) : blocker ? (
          <View style={styles.blocker} accessibilityRole="alert">
            <Icon name="alert-circle" size={18} color={colors.amber} />
            <Text variant="small" color="rgba(247,244,239,0.85)" style={styles.flex}>
              {blocker}
            </Text>
          </View>
        ) : (
          <View style={styles.emptyWrap}>
            <Text variant="h3" tone="inverse">
              Your plan will appear here as you type.
            </Text>
            <Text variant="small" tone="heroSubtle" style={styles.emptyBody}>
              {missing.length ? `Add your ${missing.join(', ').replace(/, ([^,]*)$/, ' and $1')} to see daily calories, macros and an estimated date.` : 'Almost there.'}
            </Text>
          </View>
        )}
      </Animated.View>

      <View style={styles.footer}>{footer}</View>
    </View>
  );
}

function Row({ label, value, sub, last }: { label: string; value: string; sub?: string; last?: boolean }) {
  return (
    <View style={[styles.row, !last && styles.rowBorder]} accessible accessibilityLabel={`${label}: ${value}${sub ? `, ${sub}` : ''}`}>
      <Text variant="small" tone="heroMuted" style={styles.flex}>
        {label}
      </Text>
      <View style={styles.rowRight}>
        <Text variant="small" tone="inverse" align="right" style={styles.tabular}>
          {value}
        </Text>
        {sub ? (
          <Text variant="caption" tone="heroSubtle" align="right">
            {sub}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  panel: { backgroundColor: colors.hero, borderRadius: radii.xl, padding: spacing.xl, overflow: 'hidden', boxShadow: '0px 18px 60px rgba(20,20,20,0.22)' },
  orb: { position: 'absolute', right: -86, top: -86, opacity: 0.9 },
  wash: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(7,9,12,0.18)' },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  liveDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  liveCore: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.amber, boxShadow: '0px 0px 12px rgba(255,180,84,0.85)' },
  srOnly: { position: 'absolute', width: 1, height: 1, opacity: 0 },
  calLabel: { marginTop: spacing.xxl },
  calRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, marginTop: spacing.xs },
  calories: { fontFamily: 'PlayfairDisplay_600SemiBold', fontSize: 56, lineHeight: 62, letterSpacing: -1.5, color: colors.white, fontVariant: ['tabular-nums'] },
  delta: { marginTop: spacing.xs },
  macros: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl },
  macro: { flex: 1, borderRadius: radii.sm, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', backgroundColor: 'rgba(255,255,255,0.07)', paddingHorizontal: spacing.md, paddingVertical: 10, gap: 4 },
  macroKey: { fontSize: 10 },
  tabular: { fontVariant: ['tabular-nums'] },
  rows: { marginTop: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingVertical: 10 },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.14)' },
  rowRight: { alignItems: 'flex-end', flexShrink: 1 },
  adjusted: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: 'rgba(255,180,84,0.35)',
    backgroundColor: 'rgba(255,180,84,0.10)',
    padding: spacing.md,
  },
  blocker: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.xxl,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: 'rgba(255,255,255,0.07)',
    padding: spacing.lg,
  },
  emptyWrap: { paddingTop: spacing.xxl, paddingBottom: spacing.sm, paddingRight: spacing.huge },
  emptyBody: { marginTop: spacing.md },
  footer: { marginTop: spacing.xl, paddingTop: spacing.xl, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.14)', gap: spacing.md },
});
