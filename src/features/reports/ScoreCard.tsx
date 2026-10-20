/** Day score in the energy ring with its weighted contributors. */
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInRight, useReducedMotion } from 'react-native-reanimated';

import { formatNumber } from '@/features/goals/math';
import { colors, radii, spacing } from '@/theme';
import { EnergyRing, GlassCard, ProgressBar, Text } from '@/ui';

import { scoreMood } from './format';
import type { DailyReport } from './types';

export function ScoreCard({ report }: { report: DailyReport }) {
  const reduce = useReducedMotion();
  return (
    <GlassCard tone="strong" glow>
      <View style={styles.head}>
        <Text variant="eyebrow" tone="subtle">
          Day score
        </Text>
        <Text variant="caption" tone="subtle">
          Out of 100
        </Text>
      </View>

      <View style={styles.ringWrap}>
        <EnergyRing key={report.date} progress={report.score / 100} size={188} stroke={12} accessibilityLabel={`Day score ${report.score} out of 100. ${scoreMood(report)}.`}>
          <Text variant="display" style={styles.score}>
            {report.score}
          </Text>
          <Text variant="caption" tone="muted">
            / 100
          </Text>
        </EnergyRing>
        <Text variant="h3" align="center" style={styles.mood}>
          {scoreMood(report)}
        </Text>
      </View>

      <View style={styles.parts} accessibilityLabel="How the score is made">
        {report.score_parts.map((p, i) => {
          const full = p.points >= p.max;
          return (
            <Animated.View
              key={`${report.date}-${p.key}`}
              entering={reduce ? undefined : FadeInRight.delay(50 * i).springify().damping(18).stiffness(100).mass(1)}
              style={styles.part}
              accessible
              accessibilityLabel={`${p.label}: ${p.points} of ${p.max} points. ${formatNumber(p.value)} of ${formatNumber(p.target)} ${p.unit}.`}
            >
              <View style={styles.partTop}>
                <Text variant="label">{p.label}</Text>
                <Text variant="mono" tone={full ? 'success' : 'muted'} style={styles.tabular}>
                  {p.points}/{p.max}
                </Text>
              </View>
              <View style={styles.partBottom}>
                <ProgressBar value={p.max ? p.points / p.max : 0} height={5} style={styles.flex} />
                <Text variant="caption" tone="subtle" style={styles.tabular}>
                  {formatNumber(p.value)} / {formatNumber(p.target)} {p.unit}
                </Text>
              </View>
            </Animated.View>
          );
        })}
      </View>

      <Text variant="caption" tone="subtle" style={styles.foot}>
        Calories within ±10% of target (35), protein at 90% of goal (25), water (15), steps (15) and fibre (10).
      </Text>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ringWrap: { alignItems: 'center', marginTop: spacing.lg },
  score: { fontSize: 54, lineHeight: 60, fontVariant: ['tabular-nums'] },
  mood: { marginTop: spacing.md },
  parts: { marginTop: spacing.xl, gap: spacing.sm },
  part: { borderRadius: radii.sm, borderWidth: 1, borderColor: colors.divider, backgroundColor: 'rgba(255,255,255,0.55)', paddingHorizontal: 14, paddingVertical: 10 },
  partTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  partBottom: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: 6 },
  tabular: { fontVariant: ['tabular-nums'] },
  foot: { marginTop: spacing.lg },
});
