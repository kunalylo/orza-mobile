import { useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Keyboard, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { ApiError, errorMessage } from '@/lib/api';
import { useSignedInUser } from '@/lib/auth';
import { haptics } from '@/lib/haptics';
import { colors, radii, spacing } from '@/theme';
import { Button, EmptyState, EnergyRing, GlassCard, Icon, Screen, ScreenHeader, Segmented, Skeleton, Text, goBackOrHome, toast } from '@/ui';

import { findCachedMeal, useDeleteMeal, useMealsDay, useUpdateMeal } from '@/features/meals/api';
import { ItemEditor, draftTotals, draftsValid, fromDraft, toDraft, type DraftItem } from '@/features/meals/ItemEditor';
import { confirmDeleteMeal } from '@/features/meals/MealGroups';
import type { Meal, MealType } from '@/features/meals/types';
import { DEFAULT_TZ, MEAL_SINGULAR, MEAL_TYPES, SOURCE_LABEL, formatDayLabel, formatNumber, formatTime, isRealDay, todayInTz } from '@/features/meals/utils';

/** Comparable snapshot of the editable state (ignores row ids). */
const snapshot = (rows: DraftItem[], type: MealType) =>
  JSON.stringify([type, rows.map((r) => [r.name.trim(), r.unit.trim(), r.quantity, r.calories, r.protein_g, r.carbs_g, r.fat_g])]);

/** Edit a logged meal: names, portions and numbers (PATCH /api/meals/[id]), move it to another meal, or delete it. */
export default function EditMeal() {
  const { id, date: qDate } = useLocalSearchParams<{ id: string; date?: string }>();
  const user = useSignedInUser();
  const tz = user.profile?.timezone || DEFAULT_TZ;
  const qc = useQueryClient();
  const navigation = useNavigation();

  const cached = id ? findCachedMeal(qc, id) : undefined;
  const date = isRealDay(qDate) ? qDate : (cached?.date ?? todayInTz(tz));
  const day = useMealsDay(date);
  const live: Meal | undefined = day.data?.meals.find((m) => m.id === id) ?? (day.data ? undefined : cached);

  const [rows, setRows] = useState<DraftItem[]>([]);
  const [mealType, setMealType] = useState<MealType>('lunch');
  const [initial, setInitial] = useState<string | null>(null);
  const [initFor, setInitFor] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [held, setHeld] = useState<Meal | null>(null);
  const update = useUpdateMeal();
  const del = useDeleteMeal();
  const leaving = useRef(false);

  // Start editing from the meal once it's known (and only once per meal).
  if (live && initFor !== live.id) {
    const nextRows = live.items.map(toDraft);
    setInitFor(live.id);
    setRows(nextRows);
    setMealType(live.meal_type);
    setInitial(snapshot(nextRows, live.meal_type));
  }
  if (live && held !== live) setHeld(live);
  // While a delete is on its way the meal is already gone from the cache — keep showing it until we leave.
  const meal = live ?? (del.isPending || del.isSuccess ? (held ?? undefined) : undefined);

  const dirty = initial != null && snapshot(rows, mealType) !== initial;
  const busy = update.isPending || del.isPending;
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  // Unsaved edits: ask before leaving (header back, Android back). The iOS swipe is disabled while dirty.
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (!dirtyRef.current || leaving.current) return;
      e.preventDefault();
      // Cancelable: Android back on the dialog means "Keep editing".
      Alert.alert(
        'Discard changes?',
        "Your edits to this meal haven't been saved.",
        [
          { text: 'Keep editing', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
        ],
        { cancelable: true }
      );
    });
    return unsubscribe;
  }, [navigation]);

  const leave = () => {
    leaving.current = true;
    goBackOrHome();
  };

  const totals = draftTotals(rows);
  const today = todayInTz(tz);

  const save = () => {
    if (!meal || busy) return;
    setShowErrors(true);
    if (!draftsValid(rows)) {
      haptics.error();
      toast.error(rows.length ? 'Please check the highlighted fields.' : 'Add at least one item — or delete the meal instead.');
      return;
    }
    // Let the keyboard go down while the change is saved: leaving with it up showed a blank screen until it had hidden.
    Keyboard.dismiss();
    update.mutate(
      { id: meal.id, items: rows.map(fromDraft), meal_type: mealType },
      {
        onSuccess: () => {
          haptics.success();
          toast.success('Meal updated');
          leave();
        },
        onError: (e) => {
          haptics.error();
          toast.error(errorMessage(e));
          if (e instanceof ApiError && e.status === 404) leave();
        },
      }
    );
  };

  const remove = () => {
    if (!meal || busy) return;
    confirmDeleteMeal(meal, () =>
      del.mutate(meal, {
        onSuccess: () => {
          haptics.success();
          toast.success('Meal removed');
          leave();
        },
        onError: (e) => {
          haptics.error();
          toast.error(errorMessage(e));
        },
      })
    );
  };

  const header = (
    <ScreenHeader
      back
      large={false}
      eyebrow={meal ? `${MEAL_SINGULAR[meal.meal_type]} · ${formatDayLabel(meal.date, today)}` : 'Meal log'}
      title="Edit meal"
      subtitle="Adjust names, portions or numbers. Changing a quantity rescales that item's nutrition."
    />
  );

  // Loading the day the meal belongs to.
  if (!meal && day.isPending) {
    return (
      <Screen backdrop="orb">
        {header}
        <View style={styles.skeletons} accessibilityLabel="Loading the meal">
          <Skeleton height={44} radius={radii.pill} />
          <Skeleton height={168} radius={radii.md} />
          <Skeleton height={168} radius={radii.md} />
        </View>
      </Screen>
    );
  }

  if (!meal) {
    const offline = day.error instanceof ApiError && day.error.isNetwork;
    return (
      <Screen backdrop="orb">
        {header}
        <EmptyState
          icon={offline ? 'wifi-off' : 'search'}
          title={day.isError ? "We couldn't load this meal" : "We couldn't find that meal"}
          body={day.isError ? errorMessage(day.error) : 'It may have been deleted on another device.'}
          actionLabel={day.isError ? 'Try again' : 'Back to meals'}
          onAction={day.isError ? () => void day.refetch() : leave}
          style={styles.empty}
        />
      </Screen>
    );
  }

  const quoted = (meal.source === 'text' || meal.source === 'voice' || meal.source === 'chat') && meal.description.trim();
  const time = formatTime(meal.created_at, tz);
  const target = user.targets.calories || 0;

  return (
    <Screen
      keyboard
      backdrop="orb"
      footer={
        <View style={styles.footer}>
          <Button label="Save changes" variant="energy" size="lg" block icon="check" loading={update.isPending} disabled={del.isPending} onPress={save} haptic="none" />
        </View>
      }
    >
      <Stack.Screen options={{ gestureEnabled: !dirty && !busy }} />
      {header}

      <Animated.View entering={FadeInDown.delay(40).springify().damping(18).stiffness(100).mass(1)}>
        <GlassCard tone="strong" glow>
          <View style={styles.summary}>
            <EnergyRing progress={target > 0 ? totals.calories / target : 0} size={84} stroke={8} accessibilityLabel={`${formatNumber(totals.calories)} calories`}>
              <Text variant="title" tone="ink" style={styles.nums}>
                {formatNumber(totals.calories)}
              </Text>
              <Text variant="eyebrow" tone="subtle" style={styles.kcal}>
                kcal
              </Text>
            </EnergyRing>
            <View style={styles.flex}>
              <Text variant="eyebrow" tone="subtle">
                {SOURCE_LABEL[meal.source] ?? 'Logged'}
                {time ? ` · ${time}` : ''}
              </Text>
              <Text variant="label" tone="ink" style={styles.macros}>
                P {totals.protein_g}g · C {totals.carbs_g}g · F {totals.fat_g}g · Fibre {totals.fiber_g}g
              </Text>
              {target > 0 ? (
                <Text variant="caption" tone="muted">
                  {Math.round((totals.calories / target) * 100)}% of your {formatNumber(target)} kcal day
                </Text>
              ) : null}
            </View>
          </View>
          {quoted ? (
            <View style={styles.quote}>
              <Icon name={meal.source === 'voice' ? 'mic' : 'message-square'} size={13} color={colors.subtle} />
              <Text variant="small" tone="muted" italic style={styles.flex}>
                “{meal.description}”
              </Text>
            </View>
          ) : null}
        </GlassCard>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(90).springify().damping(18).stiffness(100).mass(1)} style={styles.section}>
        <Text variant="label" tone="ink" style={styles.label}>
          Meal
        </Text>
        <Segmented
          accessibilityLabel="Meal type"
          size="sm"
          value={mealType}
          onChange={setMealType}
          options={MEAL_TYPES.map((t) => ({ value: t, label: MEAL_SINGULAR[t] }))}
        />
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(140).springify().damping(18).stiffness(100).mass(1)} style={styles.section}>
        <Text variant="label" tone="ink" style={styles.label}>
          Items
        </Text>
        <ItemEditor rows={rows} onChange={setRows} showErrors={showErrors} />
      </Animated.View>

      <View style={styles.section}>
        <Button label="Delete meal" icon="trash-2" variant="ghost" onPress={remove} loading={del.isPending} disabled={update.isPending} haptic="none" style={styles.delete} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  nums: { fontVariant: ['tabular-nums'] },
  skeletons: { gap: spacing.lg },
  empty: { marginTop: spacing.xxl },
  summary: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  kcal: { fontSize: 9.5 },
  macros: { marginTop: 4, marginBottom: 2 },
  quote: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairlineStrong,
  },
  section: { marginTop: spacing.xl },
  label: { marginBottom: spacing.sm, marginLeft: 2 },
  delete: { alignSelf: 'center' },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
    backgroundColor: 'rgba(251,247,241,0.94)',
  },
});
