/** Active goal: progress ring, start / now / target, pace + estimated date and a gentle status note — or a "set a goal" invite. */
import { StyleSheet, View } from 'react-native';

import { colors, radii, spacing } from '@/theme';
import { Button, EnergyRing, GlassCard, Icon, Tag, Text, type TagTone } from '@/ui';

import { GOAL_LABEL, formatLongDate, formatPace, formatShortDate, formatWeight, kgToUnit, progressFor, statusFor, weightUnit, type StatusTone } from './math';
import type { Goal } from './types';

const TAG: Record<StatusTone, TagTone> = { success: 'success', info: 'info', neutral: 'neutral' };

export function GoalOverview({ goal, latest, today, imperial, onPlan }: { goal: Goal | null; latest: number | null; today: string; imperial: boolean; onPlan: () => void }) {
  if (!goal) {
    return (
      <GlassCard tone="strong" glow>
        <View style={styles.tile}>
          <Icon name="target" size={18} color={colors.energyInk} />
        </View>
        <Text variant="eyebrow" tone="energy" style={styles.eyebrow}>
          Smart goals
        </Text>
        <Text variant="h2" accessibilityRole="header" style={styles.inviteTitle}>
          Set a goal that fits your life.
        </Text>
        <Text variant="callout" tone="muted" style={styles.inviteBody}>
          Set targets and get intelligent recommendations. AI-powered planning adapts to your lifestyle and progress — at a pace that stays safe and kind.
        </Text>
        <Button label="Plan my goal" iconRight="arrow-down" variant="primary" onPress={onPlan} style={styles.inviteCta} />
      </GlassCard>
    );
  }

  const now = latest ?? goal.current_weight_kg;
  const pct = progressFor(goal, now);
  const status = statusFor(goal, now, today, pct, imperial);
  const unit = weightUnit(imperial);
  const change = Math.round((kgToUnit(now, imperial) - kgToUnit(goal.current_weight_kg, imperial)) * 10) / 10;
  const maintain = goal.goal === 'maintain';
  const stats = [
    { k: 'Start', v: formatWeight(goal.current_weight_kg, imperial) },
    { k: 'Now', v: formatWeight(now, imperial), strong: true },
    { k: maintain ? 'Keep near' : 'Target', v: formatWeight(goal.target_weight_kg, imperial) },
  ];

  return (
    <GlassCard tone="strong" glow>
      <View style={styles.headRow}>
        <Text variant="eyebrow" tone="subtle">
          Active goal
        </Text>
        <View style={styles.tags}>
          <Tag label={GOAL_LABEL[goal.goal]} tone="energy" />
          <Tag label={status.label} tone={TAG[status.tone]} dot />
        </View>
      </View>

      <View style={styles.ringWrap}>
        <EnergyRing
          progress={pct}
          size={176}
          stroke={12}
          accessibilityLabel={`${maintain ? 'Stability' : 'Progress'}: ${Math.round(pct * 100)} percent ${maintain ? 'in range' : 'of the way'}`}
        >
          <Text variant="eyebrow" tone="subtle">
            {maintain ? 'Stability' : 'Progress'}
          </Text>
          <Text variant="display" style={styles.pct}>
            {Math.round(pct * 100)}%
          </Text>
          <Text variant="caption" tone="muted">
            {maintain ? 'in range' : 'of the way'}
          </Text>
        </EnergyRing>
      </View>

      <View style={styles.stats}>
        {stats.map((s) => (
          <View key={s.k} style={[styles.stat, s.strong && styles.statStrong]} accessible accessibilityLabel={`${s.k}: ${s.v}`}>
            <Text variant="eyebrow" tone="subtle" style={styles.statKey}>
              {s.k}
            </Text>
            <Text variant="label" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={styles.tabular}>
              {s.v}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.facts}>
        <View style={styles.fact}>
          <Icon name="activity" size={16} color="#E0593F" />
          <Text variant="small" tone="muted" style={styles.flex}>
            {maintain ? (
              'Maintenance pace — no deficit, no surplus'
            ) : (
              <>
                <Text variant="small" weight="semibold">
                  {goal.goal === 'lose' ? '−' : '+'}
                  {formatPace(goal.weekly_rate_kg, imperial)}
                </Text>{' '}
                a week planned
                {change !== 0 ? ` · ${change > 0 ? '+' : '−'}${Math.abs(change)} ${unit} so far` : ''}
              </>
            )}
          </Text>
        </View>
        <View style={styles.fact}>
          <Icon name="calendar" size={16} color="#E0593F" />
          <Text variant="small" tone="muted" style={styles.flex}>
            {goal.target_date ? (
              <>
                Estimated around{' '}
                <Text variant="small" weight="semibold">
                  {formatLongDate(goal.target_date)}
                </Text>
              </>
            ) : (
              `Set on ${formatShortDate(goal.created_at.slice(0, 10))} · no finish line needed`
            )}
          </Text>
        </View>
      </View>

      <View style={styles.note}>
        <Text variant="small" tone="muted">
          {status.note}
        </Text>
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  tile: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.energyBg, borderWidth: 1, borderColor: 'rgba(255,122,106,0.22)' },
  eyebrow: { marginTop: spacing.lg },
  inviteTitle: { marginTop: spacing.sm },
  inviteBody: { marginTop: spacing.sm },
  inviteCta: { marginTop: spacing.xl, alignSelf: 'flex-start' },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: spacing.sm },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  ringWrap: { alignItems: 'center', marginTop: spacing.xl },
  pct: { fontVariant: ['tabular-nums'], marginVertical: 2 },
  stats: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl },
  stat: { flex: 1, borderRadius: radii.sm, borderWidth: 1, borderColor: colors.divider, backgroundColor: 'rgba(255,255,255,0.6)', paddingHorizontal: spacing.md, paddingVertical: 10, gap: 4 },
  statStrong: { borderColor: 'rgba(255,122,106,0.28)', backgroundColor: '#FFF6F1' },
  statKey: { fontSize: 10 },
  tabular: { fontVariant: ['tabular-nums'] },
  facts: { marginTop: spacing.lg, gap: spacing.sm },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  note: { marginTop: spacing.lg, borderRadius: radii.sm, borderWidth: 1, borderColor: 'rgba(20,20,20,0.06)', backgroundColor: 'rgba(255,255,255,0.5)', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
});
