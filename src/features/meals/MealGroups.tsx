import { useRef } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, { FadeInDown, FadeOut, interpolate, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { haptics } from '@/lib/haptics';
import { colors, radii, spacing } from '@/theme';
import { Button, EmptyState, GlassCard, Icon, IconButton, Skeleton, Text, useLayoutTransition } from '@/ui';

import { MealItemRow } from './MealItemRow';
import type { Meal, MealType } from './types';
import { MEAL_ICON, MEAL_LABEL, MEAL_TONE, MEAL_TYPES, SOURCE_ICON, SOURCE_LABEL, formatNumber, formatTime, sumNutrients } from './utils';

/** Ask before deleting (shared by swipe and the delete button). */
export function confirmDeleteMeal(meal: Meal, onConfirm: () => void, onKeep?: () => void) {
  haptics.warning();
  Alert.alert(
    'Delete this meal?',
    `${meal.items.length} item${meal.items.length === 1 ? '' : 's'} · ${formatNumber(meal.totals.calories)} kcal will be removed from your log.`,
    [
      { text: 'Keep', style: 'cancel', onPress: onKeep },
      { text: 'Delete', style: 'destructive', onPress: onConfirm },
    ],
    { cancelable: true, onDismiss: onKeep }
  );
}

/* ───────────────────────────── Meal card ───────────────────────────── */

function DeleteAction({ progress }: { progress: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(progress.get(), [0, 0.6, 1], [0, 0.8, 1]),
    transform: [{ scale: interpolate(progress.get(), [0, 1], [0.85, 1]) }],
  }));
  return (
    <View style={styles.swipeAction}>
      <Animated.View style={[styles.swipeInner, style]}>
        <Icon name="trash-2" size={20} color={colors.white} />
        <Text variant="caption" weight="semibold" color={colors.white}>
          Delete
        </Text>
      </Animated.View>
    </View>
  );
}

function MealCard({ meal, tz, onEdit, onDelete }: { meal: Meal; tz?: string; onEdit: (m: Meal) => void; onDelete: (m: Meal) => void }) {
  const swipe = useRef<SwipeableMethods>(null);
  const t = meal.totals;
  const quoted = (meal.source === 'text' || meal.source === 'voice' || meal.source === 'chat') && meal.description.trim();
  const time = formatTime(meal.created_at, tz);

  const askDelete = () =>
    confirmDeleteMeal(
      meal,
      () => onDelete(meal),
      () => swipe.current?.close()
    );

  return (
    <ReanimatedSwipeable
      ref={swipe}
      friction={1.6}
      rightThreshold={64}
      overshootRight={false}
      renderRightActions={(progress) => <DeleteAction progress={progress} />}
      onSwipeableWillOpen={askDelete}
      containerStyle={styles.swipeContainer}
    >
      <GlassCard padding={spacing.lg}>
        <Pressable
          onPress={() => {
            haptics.tap();
            onEdit(meal);
          }}
          accessibilityRole="button"
          accessibilityLabel={`${SOURCE_LABEL[meal.source] ?? 'Logged'} meal${time ? ` at ${time}` : ''}, ${formatNumber(t.calories)} calories: ${meal.items
            .map((i) => i.name)
            .join(', ')}`}
          accessibilityHint="Opens the meal editor"
          style={({ pressed }) => pressed && styles.pressedCard}
        >
          <View style={styles.cardHead}>
            <View style={styles.flex}>
              <View style={styles.sourceRow}>
                <Icon name={SOURCE_ICON[meal.source] ?? 'list'} size={12} color={colors.subtle} />
                <Text variant="eyebrow" tone="subtle" numberOfLines={1}>
                  {SOURCE_LABEL[meal.source] ?? 'Logged'}
                  {time ? ` · ${time}` : ''}
                </Text>
              </View>
              {quoted ? (
                <Text variant="small" tone="muted" italic numberOfLines={2} style={styles.quote}>
                  “{meal.description}”
                </Text>
              ) : null}
            </View>
            <View style={styles.kcalBox}>
              <Text variant="h3" tone="ink" style={styles.nums}>
                {formatNumber(t.calories)}
              </Text>
              <Text variant="eyebrow" tone="subtle" style={styles.kcalUnit}>
                kcal
              </Text>
            </View>
          </View>

          <View style={styles.items}>
            {meal.items.map((i, idx) => (
              <MealItemRow key={`${i.name}-${idx}`} item={i} divider={idx > 0} />
            ))}
          </View>

          {meal.notes ? (
            <View style={styles.notes}>
              <Icon name="help-circle" size={13} color={colors.cyan600} />
              <Text variant="caption" tone="ink" style={styles.flex}>
                {meal.notes}
              </Text>
            </View>
          ) : null}
        </Pressable>

        <View style={styles.footer}>
          <Text variant="mono" tone="muted" style={[styles.flex, styles.footerText]} numberOfLines={2}>
            P {t.protein_g}g · C {t.carbs_g}g · F {t.fat_g}g · Fibre {t.fiber_g}g
          </Text>
          <IconButton icon="edit-3" variant="plain" size={36} iconSize={16} color={colors.muted} accessibilityLabel="Edit meal" onPress={() => onEdit(meal)} />
          <IconButton icon="trash-2" variant="plain" size={36} iconSize={16} color={colors.muted} accessibilityLabel="Delete meal" onPress={askDelete} haptic="none" />
        </View>
      </GlassCard>
    </ReanimatedSwipeable>
  );
}

/* ───────────────────────────── Groups ───────────────────────────── */

function GroupsSkeleton() {
  return (
    <View style={styles.groups} accessibilityLabel="Loading meals">
      {[0, 1].map((g) => (
        <View key={g}>
          <View style={styles.groupHead}>
            <View style={styles.groupTitle}>
              <Skeleton circle height={40} />
              <Skeleton width={120} height={18} />
            </View>
          </View>
          <GlassCard>
            <Skeleton width={140} height={11} />
            <Skeleton width="78%" height={14} style={styles.skGap} />
            <Skeleton width="64%" height={14} style={styles.skGap} />
            <Skeleton width="50%" height={11} style={styles.skGapLg} />
          </GlassCard>
        </View>
      ))}
    </View>
  );
}

/** The day's meals grouped Breakfast / Lunch / Dinner / Snacks, with per-group totals and quick add. */
export function MealGroups({
  meals,
  loading,
  dayLabel,
  tz,
  onAdd,
  onEdit,
  onDelete,
  onSnap,
}: {
  meals: Meal[];
  loading: boolean;
  dayLabel: string;
  tz?: string;
  onAdd: (type?: MealType) => void;
  onEdit: (meal: Meal) => void;
  onDelete: (meal: Meal) => void;
  onSnap: () => void;
}) {
  const layoutTransition = useLayoutTransition();
  const total = sumNutrients(meals.map((m) => m.totals)).calories;
  const isToday = dayLabel === 'Today';
  const heading = isToday ? "Today's meals" : dayLabel === 'Yesterday' ? "Yesterday's meals" : `Meals · ${dayLabel}`;

  return (
    <View>
      <View style={styles.sectionHead}>
        <Text variant="eyebrow" tone="energy">
          On your plate
        </Text>
        <Text variant="h2" tone="ink" accessibilityRole="header">
          {heading}
        </Text>
        {!loading && meals.length > 0 ? (
          <Text variant="mono" tone="muted">
            {meals.length} meal{meals.length === 1 ? '' : 's'} · {formatNumber(total)} kcal
          </Text>
        ) : null}
      </View>

      {loading ? (
        <GroupsSkeleton />
      ) : meals.length === 0 ? (
        <Animated.View entering={FadeInDown.springify().damping(18).stiffness(100).mass(1)}>
          <EmptyState
            icon="mci:silverware-fork-knife"
            title={isToday ? 'Nothing logged yet today' : 'Nothing logged for this day'}
            body="Tell ÖRZA what you ate above, snap a photo, or pick from the food list — every entry counts, no judgement."
            actionLabel="Add from food list"
            actionVariant="secondary"
            onAction={() => onAdd()}
          />
          <Button label="Snap a meal" icon="camera" variant="ghost" onPress={onSnap} style={styles.snapBtn} />
        </Animated.View>
      ) : (
        <View style={styles.groups}>
          {MEAL_TYPES.map((type) => {
            const list = meals.filter((m) => m.meal_type === type);
            const kcal = sumNutrients(list.map((m) => m.totals)).calories;
            const tone = MEAL_TONE[type];
            return (
              <Animated.View key={type} layout={layoutTransition}>
                <View style={styles.groupHead}>
                  <View style={styles.groupTitle}>
                    <View style={[styles.groupIcon, { backgroundColor: tone.bg }]}>
                      <Icon name={MEAL_ICON[type]} size={18} color={tone.fg} />
                    </View>
                    <View>
                      <Text variant="h3" tone="ink" accessibilityRole="header">
                        {MEAL_LABEL[type]}
                      </Text>
                      <Text variant="mono" tone="subtle" style={styles.groupKcal}>
                        {list.length ? `${formatNumber(kcal)} kcal` : 'Nothing yet'}
                      </Text>
                    </View>
                  </View>
                  <Pressable
                    onPress={() => onAdd(type)}
                    accessibilityRole="button"
                    accessibilityLabel={`Add to ${MEAL_LABEL[type].toLowerCase()}`}
                    hitSlop={6}
                    style={({ pressed }) => [styles.addBtn, pressed && styles.pressed]}
                  >
                    <Icon name="plus" size={14} color={colors.ink} />
                    <Text variant="label" tone="ink">
                      Add
                    </Text>
                  </Pressable>
                </View>
                {list.map((m) => (
                  <Animated.View
                    key={m.id}
                    entering={FadeInDown.springify().damping(18).stiffness(100).mass(1)}
                    exiting={FadeOut.duration(180)}
                    layout={layoutTransition}
                    style={styles.cardWrap}
                  >
                    <MealCard meal={m} tz={tz} onEdit={onEdit} onDelete={onDelete} />
                  </Animated.View>
                ))}
              </Animated.View>
            );
          })}
          <Text variant="caption" tone="subtle" align="center">
            Tip: swipe a meal left to delete it.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  nums: { fontVariant: ['tabular-nums'] },
  sectionHead: { gap: 4, marginBottom: spacing.lg },
  groups: { gap: spacing.xxl },
  groupHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  groupTitle: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  groupIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  groupKcal: { fontSize: 11 },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.glassStrong,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  pressed: { opacity: 0.6 },
  pressedCard: { opacity: 0.75 },
  cardWrap: { marginBottom: spacing.md },
  swipeContainer: { borderRadius: radii.lg },
  swipeAction: { width: 96, paddingLeft: spacing.sm },
  swipeInner: {
    flex: 1,
    borderRadius: radii.lg,
    backgroundColor: colors.error,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  quote: { marginTop: 6 },
  kcalBox: { alignItems: 'flex-end' },
  kcalUnit: { fontSize: 10 },
  items: { marginTop: spacing.sm },
  notes: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
    padding: spacing.sm + 2,
    borderRadius: radii.sm,
    backgroundColor: 'rgba(11,190,220,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(11,190,220,0.22)',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairlineStrong,
  },
  footerText: { fontSize: 11 },
  skGap: { marginTop: spacing.md },
  skGapLg: { marginTop: spacing.lg },
  snapBtn: { alignSelf: 'center', marginTop: spacing.sm },
});
