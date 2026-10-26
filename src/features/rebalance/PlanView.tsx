/** A rebalance plan: summary tiles, "ÖRZA says", and one card per day (plus the "How ÖRZA rebalances" panel). */
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';

import { formatNumber } from '@/features/chat/format';
import { DarkPanel } from '@/features/recipes/DarkPanel';
import { colors, radii, spacing } from '@/theme';
import { EnergyRing, Icon, Tag, Text, type IconName } from '@/ui';

import { PRINCIPLES, formatDayDate, splitMeal, type CompensationDay, type RebalancePlan } from './types';

function usualFor(plan: RebalancePlan, d: CompensationDay): number {
  return plan.summary?.usual_calories ?? d.calorie_target - d.adjustment;
}

/** "ÖRZA says" — the plan's supportive message on the dark orb surface. */
export function OrzaSays({ message }: { message: string }) {
  return (
    <DarkPanel orb="bottom-right" accessibilityLabel="ÖRZA says">
      <View style={styles.saysHead}>
        <View style={styles.saysDot}>
          <View style={styles.saysCore} />
        </View>
        <Text variant="eyebrow" tone="heroSubtle">
          ÖRZA says
        </Text>
      </View>
      <Text variant="h3" tone="inverse" italic style={styles.saysText}>
        “{message}”
      </Text>
      <Text variant="caption" tone="heroSubtle" style={styles.saysNote}>
        Wellness guidance, not medical advice.
      </Text>
    </DarkPanel>
  );
}

export function HowItWorks() {
  return (
    <DarkPanel orb="bottom-right">
      <Text variant="eyebrow" tone="heroSubtle">
        How ÖRZA rebalances
      </Text>
      <Text variant="h2" tone="inverse" style={styles.howTitle}>
        One meal is never the whole story.
      </Text>
      <View style={styles.principles}>
        {PRINCIPLES.map((p) => (
          <View key={p.title} style={styles.principle} accessible accessibilityLabel={`${p.title}. ${p.body}`}>
            <View style={styles.disc}>
              <Icon name={p.icon} size={16} color={colors.amber} />
            </View>
            <View style={styles.flex}>
              <Text variant="label" tone="inverse">
                {p.title}
              </Text>
              <Text variant="small" tone="heroMuted" style={styles.principleBody}>
                {p.body}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </DarkPanel>
  );
}

function Stat({ k, v, note, icon }: { k: string; v: string; note: string; icon: IconName }) {
  return (
    <View style={styles.stat} accessible accessibilityLabel={`${k}: ${v}. ${note}`}>
      <View style={styles.statHead}>
        <Text variant="eyebrow" tone="subtle" style={styles.statKey} numberOfLines={1}>
          {k}
        </Text>
        <Icon name={icon} size={14} color={colors.muted} />
      </View>
      <Text variant="title" style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
        {v}
      </Text>
      <Text variant="caption" tone="muted">
        {note}
      </Text>
    </View>
  );
}

function DayCard({ plan, day, index }: { plan: RebalancePlan; day: CompensationDay; index: number }) {
  const usual = usualFor(plan, day);
  const trim = Math.max(0, -day.adjustment);
  return (
    <View style={styles.day}>
      <View style={styles.dayHead}>
        <View>
          <Text variant="eyebrow" tone="subtle" style={styles.dayEyebrow}>
            Day {index + 1}
          </Text>
          <Text variant="title" style={styles.dayDate}>
            {formatDayDate(day.date)}
          </Text>
        </View>
        {trim > 0 ? <Tag label={`−${formatNumber(trim)} kcal`} tone="energy" /> : <Tag label="Usual calories" tone="success" />}
      </View>

      <View style={styles.dayMain}>
        <EnergyRing
          progress={usual > 0 ? day.calorie_target / usual : 1}
          size={92}
          stroke={8}
          delay={120 + index * 90}
          accessibilityLabel={`${formatNumber(day.calorie_target)} kcal target`}
        >
          <Text variant="title" style={styles.ringValue}>
            {formatNumber(day.calorie_target)}
          </Text>
          <Text variant="caption" tone="subtle" style={styles.ringUnit}>
            kcal
          </Text>
        </EnergyRing>
        <View style={styles.dayFacts}>
          <Text variant="caption" tone="muted">
            {trim > 0 ? `A gentle trim from your usual ${formatNumber(usual)}` : `Same as your usual ${formatNumber(usual)}`}
          </Text>
          <View style={styles.fact}>
            <Icon name="mci:leaf" size={16} color={colors.energyInk} />
            <Text variant="small" weight="semibold" style={styles.flex}>
              {day.focus}
            </Text>
          </View>
          <View style={styles.fact}>
            <Icon name="mci:shoe-print" size={16} color={colors.cyan600} />
            <Text variant="small" tone="muted" style={styles.flex}>
              {day.activity}
            </Text>
          </View>
        </View>
      </View>

      {day.meals.length > 0 ? (
        <View style={styles.meals}>
          <View style={styles.mealsHead}>
            <Icon name="mci:silverware-fork-knife" size={13} color={colors.subtle} />
            <Text variant="eyebrow" tone="subtle" style={styles.mealsEyebrow}>
              Meal ideas
            </Text>
          </View>
          {day.meals.map((m, i) => {
            const { label, text } = splitMeal(m);
            return (
              <View key={i} style={styles.meal}>
                {label ? (
                  <Text variant="eyebrow" tone="subtle" style={styles.mealLabel}>
                    {label}
                  </Text>
                ) : null}
                <Text variant="small">{text}</Text>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

/** Summary tiles + "ÖRZA says" + one card per day. */
export function PlanView({ plan, matched, showMessage = true }: { plan: RebalancePlan; matched?: string[]; showMessage?: boolean }) {
  const reduce = useReducedMotion();
  const s = plan.summary;
  const n = plan.days.length;
  const backTo = s?.back_to_usual;
  const trimTotal = s?.food_kcal ?? plan.days.reduce((a, d) => a + Math.max(0, -d.adjustment), 0);
  const avgTrim = s?.avg_daily_trim ?? (n ? Math.round(trimTotal / n / 10) * 10 : 0);

  const stats: { k: string; v: string; note: string; icon: IconName }[] = [
    {
      k: 'To rebalance',
      v: `${formatNumber(plan.extra_calories)} kcal`,
      note: plan.estimated ? 'Estimated from what you ate' : 'As you entered it',
      icon: 'mci:fire',
    },
    {
      k: 'Gentle trim',
      v: avgTrim > 0 ? `~${formatNumber(avgTrim)} kcal/day` : 'None needed',
      note: `Over ${n} day${n === 1 ? '' : 's'}, no skipped meals`,
      icon: 'mci:leaf',
    },
    {
      k: 'Added movement',
      v: s && s.walk_minutes_per_day > 0 ? `${s.walk_minutes_per_day} min/day` : 'Your usual',
      note: s && s.extra_steps_per_day > 0 ? `≈ ${formatNumber(s.extra_steps_per_day)} extra steps` : 'An easy stroll is plenty',
      icon: 'mci:shoe-print',
    },
    {
      k: 'Back to usual',
      v: backTo ? formatDayDate(backTo) : `After day ${n}`,
      note: 'Your regular targets resume',
      icon: 'mci:calendar-check',
    },
  ];

  return (
    <View>
      <View style={styles.stats}>
        {stats.map((st) => (
          <Stat key={st.k} {...st} />
        ))}
      </View>

      {plan.estimated && matched && matched.length > 0 ? (
        <Text variant="caption" tone="subtle" style={styles.matched}>
          Recognised: {matched.slice(0, 8).join(', ')}
          {matched.length > 8 ? '…' : ''}
        </Text>
      ) : null}

      {showMessage ? (
        <View style={styles.block}>
          <OrzaSays message={plan.message} />
        </View>
      ) : null}

      {s && s.released_kcal > 0 ? (
        <Text variant="small" tone="muted" style={styles.released}>
          {/* When the usual target already sits at (or under) the safe floor there is nothing to trim — "never below
              1,696 kcal" next to days of 1,680 read as a contradiction. */}
          {s.floor_calories >= s.usual_calories
            ? `Your usual ${formatNumber(s.usual_calories)} kcal already sits at your body's safe floor, so ÖRZA doesn't trim meals, and walks stay comfortable — the last ~`
            : `Trims stay within a gentle range (never below ${formatNumber(s.floor_calories)} kcal a day) and walks stay comfortable, so the last ~`}
          {formatNumber(s.released_kcal)} kcal is simply left to even out naturally over the week.
        </Text>
      ) : null}

      <Text variant="eyebrow" tone="subtle" style={styles.daysHead}>
        Your {n}-day plan
      </Text>
      <View style={styles.days}>
        {plan.days.map((d, i) => (
          <Animated.View key={d.date} entering={reduce ? undefined : FadeInDown.delay(80 * i).springify().damping(18).stiffness(100).mass(1)}>
            <DayCard plan={plan} day={d} index={i} />
          </Animated.View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  block: { marginTop: spacing.lg },
  saysHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  saysDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  saysCore: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: colors.amber, boxShadow: '0px 0px 12px rgba(255,180,84,0.85)' },
  saysText: { marginTop: spacing.lg, lineHeight: 28 },
  saysNote: { marginTop: spacing.lg },
  howTitle: { marginTop: spacing.sm, maxWidth: 280 },
  principles: { gap: spacing.lg, marginTop: spacing.xl },
  principle: { flexDirection: 'row', gap: spacing.md },
  principleBody: { marginTop: 2 },
  disc: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  stat: {
    flexGrow: 1,
    flexBasis: '46%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.glass,
  },
  statHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  statKey: { flex: 1, fontSize: 9.5, letterSpacing: 1 },
  statValue: { marginTop: 6, fontVariant: ['tabular-nums'] },
  matched: { marginTop: spacing.sm },
  released: { marginTop: spacing.lg },
  daysHead: { marginTop: spacing.xxl, marginBottom: spacing.md },
  days: { gap: spacing.md },
  day: {
    padding: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.glassSolid,
    boxShadow: '0px 10px 30px rgba(20,20,20,0.07)',
  },
  dayHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  dayEyebrow: { fontSize: 10 },
  dayDate: { marginTop: 2 },
  dayMain: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, marginTop: spacing.lg },
  ringValue: { fontVariant: ['tabular-nums'], fontSize: 16, lineHeight: 20 },
  ringUnit: { fontSize: 10, lineHeight: 12 },
  dayFacts: { flex: 1, gap: spacing.sm },
  fact: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  meals: { marginTop: spacing.lg, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairlineStrong, gap: spacing.sm },
  mealsHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  mealsEyebrow: { fontSize: 10 },
  meal: { gap: 1 },
  mealLabel: { fontSize: 9.5, letterSpacing: 1 },
});
