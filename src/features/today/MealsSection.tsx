/** The day's meals grouped by type (breakfast · lunch · snacks · dinner) with per-group totals; tap a meal to edit it. */
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';

import { colors, radii, spacing } from '@/theme';
import { Button, GlassCard, Icon, Orb, PressableScale, Text } from '@/ui';

import type { Meal, MealType, Nutrients } from '@/features/meals/types';
import { MEAL_ICON, MEAL_LABEL, MEAL_TONE, SOURCE_ICON, SOURCE_LABEL, fmtQty, formatNumber, formatTime, sumNutrients } from '@/features/meals/utils';

import { MEAL_ORDER } from './types';

function MealRow({ meal, tz, divider, onOpen }: { meal: Meal; tz?: string; divider: boolean; onOpen: (m: Meal) => void }) {
  const items = (meal.items || []).map((i) => (i.quantity && i.quantity !== 1 ? `${i.name} ×${fmtQty(i.quantity)}` : i.name));
  const desc = meal.description?.trim();
  const raw = desc || items.join(', ') || 'Meal';
  const title = raw.charAt(0).toUpperCase() + raw.slice(1);
  const subtitle = desc ? items.join(', ') : '';
  const time = formatTime(meal.created_at, tz);
  const kcal = formatNumber(meal.totals?.calories || 0);
  return (
    <PressableScale
      onPress={() => onOpen(meal)}
      haptic="tap"
      scaleTo={0.98}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${kcal} kilocalories${time ? `, ${time}` : ''}. ${SOURCE_LABEL[meal.source] ?? ''}`}
      accessibilityHint="Opens the meal to edit it"
      style={[styles.row, divider && styles.divider]}
    >
      <View style={styles.src}>
        <Icon name={SOURCE_ICON[meal.source] ?? 'list'} size={12} color={colors.subtle} />
      </View>
      <View style={styles.flex}>
        <Text variant="small" tone="ink" numberOfLines={2}>
          {title}
        </Text>
        {subtitle || time ? (
          <Text variant="caption" tone="muted" numberOfLines={1} style={styles.sub}>
            {time}
            {time && subtitle ? ' · ' : ''}
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={styles.kcal}>
        <Text variant="label" tone="ink" style={styles.tabular}>
          {kcal}
        </Text>
        <Text variant="eyebrow" tone="subtle" style={styles.kcalUnit}>
          kcal
        </Text>
      </View>
      <Icon name="chevron-right" size={16} color={colors.subtle} />
    </PressableScale>
  );
}

function MealGroup({ type, meals, tz, onLog, onOpen }: { type: MealType; meals: Meal[]; tz?: string; onLog: (t: MealType) => void; onOpen: (m: Meal) => void }) {
  const label = MEAL_LABEL[type];
  const tone = MEAL_TONE[type];
  const t: Nutrients = sumNutrients(meals.map((m) => m.totals));
  const empty = meals.length === 0;
  return (
    <GlassCard tone={empty ? 'default' : 'strong'} padding={spacing.lg} style={empty && styles.emptyGroup}>
      <View style={styles.groupHead}>
        <View style={[styles.tile, { backgroundColor: tone.bg }]}>
          <Icon name={MEAL_ICON[type]} size={17} color={tone.fg} />
        </View>
        <View style={styles.flex}>
          <Text variant="h3" tone="ink" style={styles.groupTitle}>
            {label}
          </Text>
          <Text variant="caption" tone="muted">
            {empty ? 'Nothing logged yet' : `${formatNumber(t.calories)} kcal · ${meals.length} ${meals.length === 1 ? 'entry' : 'entries'}`}
          </Text>
        </View>
        <PressableScale onPress={() => onLog(type)} haptic="tap" accessibilityRole="button" accessibilityLabel={`Log ${label.toLowerCase()}`} style={styles.logPill}>
          <Icon name="plus" size={13} color={colors.ink} />
          <Text variant="caption" weight="semibold" tone="ink">
            Log
          </Text>
        </PressableScale>
      </View>
      {!empty ? (
        <>
          <View style={styles.rows}>
            {meals.map((m, i) => (
              <MealRow key={m.id} meal={m} tz={tz} divider={i > 0} onOpen={onOpen} />
            ))}
          </View>
          <View style={styles.macros}>
            <Text variant="eyebrow" tone="subtle" style={styles.macro}>
              Protein <Text variant="eyebrow" tone="muted" style={styles.macro}>{formatNumber(t.protein_g)} g</Text>
            </Text>
            <Text variant="eyebrow" tone="subtle" style={styles.macro}>
              Carbs <Text variant="eyebrow" tone="muted" style={styles.macro}>{formatNumber(t.carbs_g)} g</Text>
            </Text>
            <Text variant="eyebrow" tone="subtle" style={styles.macro}>
              Fat <Text variant="eyebrow" tone="muted" style={styles.macro}>{formatNumber(t.fat_g)} g</Text>
            </Text>
          </View>
        </>
      ) : null}
    </GlassCard>
  );
}

export function MealsSection({
  meals,
  totals,
  isToday,
  tz,
  onLog,
  onOpen,
  onSnap,
  onType,
}: {
  meals: Meal[];
  totals: Nutrients;
  isToday: boolean;
  tz?: string;
  onLog: (type?: MealType) => void;
  onOpen: (meal: Meal) => void;
  onSnap: () => void;
  onType: () => void;
}) {
  const reduce = useReducedMotion();
  return (
    <View>
      <View style={styles.head}>
        <Text variant="eyebrow" tone="subtle">
          On your plate
        </Text>
        <Text variant="h2" tone="ink" style={styles.title} accessibilityRole="header">
          {isToday ? "Today's meals" : 'Meals that day'}
        </Text>
        {meals.length > 0 ? (
          <View style={styles.summaryRow}>
            <Text variant="small" tone="muted" style={styles.flex}>
              <Text variant="small" weight="semibold" tone="ink">
                {formatNumber(totals.calories)}
              </Text>{' '}
              kcal · {meals.length} {meals.length === 1 ? 'entry' : 'entries'}
            </Text>
            <Button label="Log a meal" icon="plus" variant="secondary" size="sm" onPress={() => onLog()} haptic="tap" />
          </View>
        ) : null}
      </View>

      {meals.length === 0 ? (
        <Animated.View entering={reduce ? undefined : FadeInDown.springify().damping(18)}>
          <GlassCard tone="strong" style={styles.empty}>
            <Orb size={84} tone="light" orbits={false} paused={reduce} />
            <Text variant="h3" tone="ink" align="center" style={styles.emptyTitle}>
              {isToday ? 'Nothing on your plate yet' : 'Nothing was logged this day'}
            </Text>
            <Text variant="small" tone="muted" align="center" style={styles.emptyBody}>
              {isToday
                ? 'Snap a photo, type it, or just tell ÖRZA what you ate — in English, Hindi or Hinglish.'
                : 'Forgot to log? You can still add meals for this day — ÖRZA will update your totals.'}
            </Text>
            <View style={styles.emptyActions}>
              <Button label="Snap a meal" icon="camera" variant="energy" onPress={onSnap} style={styles.flex} />
              <Button label="Type or speak" icon="mic" variant="secondary" onPress={onType} style={styles.flex} />
            </View>
          </GlassCard>
        </Animated.View>
      ) : (
        <View style={styles.groups}>
          {MEAL_ORDER.map((type, i) => (
            <Animated.View key={type} entering={reduce ? undefined : FadeInDown.delay(40 * i).springify().damping(18)}>
              <MealGroup type={type} meals={meals.filter((m) => m.meal_type === type)} tz={tz} onLog={onLog} onOpen={onOpen} />
            </Animated.View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  tabular: { fontVariant: ['tabular-nums'] },
  head: { marginBottom: spacing.lg },
  title: { marginTop: spacing.xs },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md },
  groups: { gap: spacing.md },
  emptyGroup: { opacity: 0.92 },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  tile: { width: 38, height: 38, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center' },
  groupTitle: { fontSize: 18, lineHeight: 22 },
  logPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 34,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    backgroundColor: 'rgba(255,255,255,0.75)',
  },
  rows: { marginTop: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  src: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.8)', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.divider },
  sub: { marginTop: 2 },
  kcal: { alignItems: 'flex-end' },
  kcalUnit: { fontSize: 9, letterSpacing: 1 },
  macros: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.lg, rowGap: 4, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  macro: { fontSize: 10, letterSpacing: 0.8 },
  empty: { alignItems: 'center', paddingVertical: spacing.xxxl },
  emptyTitle: { marginTop: spacing.lg },
  emptyBody: { marginTop: spacing.sm, maxWidth: 320 },
  emptyActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xl, alignSelf: 'stretch' },
});
