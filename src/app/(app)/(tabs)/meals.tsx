import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { ApiError, errorMessage } from '@/lib/api';
import { useAuth, useSignedInUser } from '@/lib/auth';
import { haptics } from '@/lib/haptics';
import { colors, gutter, spacing } from '@/theme';
import { Button, GlassCard, Icon, IconButton, Screen, ScreenHeader, Text, toast, useTabBarSpace } from '@/ui';

import { useAiStatus, useDeleteMeal, useMealsDay } from '@/features/meals/api';
import { DailySummary } from '@/features/meals/DailySummary';
import { DateNavigator } from '@/features/meals/DateNavigator';
import { FoodPickerSheet } from '@/features/meals/FoodPickerSheet';
import { LoggedResult } from '@/features/meals/LoggedResult';
import { MealComposer, type ComposerMealType, type MealComposerHandle } from '@/features/meals/MealComposer';
import { MealGroups } from '@/features/meals/MealGroups';
import type { Meal, MealType, TextLogResponse } from '@/features/meals/types';
import { DEFAULT_TZ, formatDayLabel, guessMealType, isMealType, isRealDay, todayInTz } from '@/features/meals/utils';

type Params = { compose?: string; voice?: string; date?: string; meal_type?: string };

/**
 * Meals — type or speak what you ate, add from the food list, and review / edit the day's log.
 * Route params: `compose=1` focuses the composer, `voice=1` starts listening, `date=YYYY-MM-DD`, `meal_type=…`.
 */
export default function Meals() {
  const user = useSignedInUser();
  const { refresh } = useAuth();
  const tz = user.profile?.timezone || DEFAULT_TZ;
  const params = useLocalSearchParams<Params>();
  const tabSpace = useTabBarSpace();

  const [today, setToday] = useState(() => todayInTz(tz));
  const [date, setDate] = useState(today);
  const [composerType, setComposerType] = useState<ComposerMealType>('auto');
  const [result, setResult] = useState<TextLogResponse | null>(null);
  const [picker, setPicker] = useState<{ open: boolean; type: MealType; query?: string }>({ open: false, type: 'lunch' });
  const [refreshing, setRefreshing] = useState(false);

  const scrollRef = useRef<ScrollView>(null);
  const composerRef = useRef<MealComposerHandle>(null);

  const isToday = date === today;
  const dayLabel = formatDayLabel(date, today);
  const day = useMealsDay(date);
  const aiStatus = useAiStatus();
  const del = useDeleteMeal();

  const meals = day.data?.meals ?? [];
  const loading = day.isPending;
  const loadError = day.isError && !day.data;

  // Midnight rollover: when the calendar day changes, follow it if the log was showing "today".
  const syncToday = useCallback(() => {
    const t = todayInTz(tz);
    if (t === today) return;
    setToday(t);
    setDate((d) => (d === today ? t : d > t ? t : d));
  }, [tz, today]);

  useFocusEffect(syncToday);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && syncToday());
    return () => sub.remove();
  }, [syncToday]);

  const changeDate = (d: string) => {
    if (d > today || d === date) return;
    setResult(null);
    setDate(d);
  };

  // Deep-link / quick-action params (Today's "Type or speak" → compose=1, mic → voice=1). Each set is consumed once:
  // the day / meal type are applied while rendering, focus / voice after the tab transition, then the params are cleared.
  const { compose, voice, date: qDate, meal_type: qType } = params;
  const paramKey = [compose ?? '', voice ?? '', qDate ?? '', qType ?? ''].join('|');
  const [seenParams, setSeenParams] = useState('|||');
  if (paramKey !== seenParams) {
    setSeenParams(paramKey);
    if (isRealDay(qDate) && qDate <= today && qDate !== date) {
      setResult(null);
      setDate(qDate);
    }
    if (isMealType(qType)) setComposerType(qType);
  }

  const paramTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (paramTimer.current) clearTimeout(paramTimer.current);
    },
    []
  );
  useEffect(() => {
    if (!compose && !voice && !qDate && !qType) return;
    const wantsVoice = voice === '1' || voice === 'true';
    const wantsCompose = compose === '1' || compose === 'true';
    if (wantsVoice || wantsCompose) {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      if (paramTimer.current) clearTimeout(paramTimer.current);
      // Let the tab transition settle before raising the keyboard / opening the mic.
      paramTimer.current = setTimeout(() => {
        paramTimer.current = null;
        if (wantsVoice) composerRef.current?.startVoice();
        else composerRef.current?.focus();
      }, 350);
    }
    router.setParams({ compose: undefined, voice: undefined, date: undefined, meal_type: undefined });
  }, [compose, voice, qDate, qType]);

  const onRefresh = async () => {
    setRefreshing(true);
    syncToday();
    try {
      await Promise.all([day.refetch(), refresh().catch(() => null)]);
    } finally {
      setRefreshing(false);
    }
  };

  const defaultType = (): MealType => (composerType !== 'auto' ? composerType : guessMealType(tz));
  const openPicker = (type?: MealType, query?: string) => {
    haptics.tap();
    setPicker({ open: true, type: type ?? defaultType(), query });
  };

  const openEditor = (meal: Meal) => router.push({ pathname: '/meal/[id]', params: { id: meal.id, date: meal.date } });

  const removeMeal = (meal: Meal, undo = false) =>
    del.mutate(meal, {
      onSuccess: () => {
        haptics.success();
        toast.success(undo ? 'Undone — that meal was removed' : 'Meal removed');
        setResult((r) => (r && r.meal.id === meal.id ? null : r));
      },
      onError: (e) => {
        haptics.error();
        toast.error(errorMessage(e));
      },
    });

  const openSnap = () => {
    const p: Record<string, string> = {};
    if (!isToday) p.date = date;
    if (composerType !== 'auto') p.meal_type = composerType;
    router.push({ pathname: '/snap', params: p });
  };

  // The "just logged" card follows edits / deletes made elsewhere (cache is the source of truth once loaded).
  const shownResult = (() => {
    if (!result) return null;
    if (!day.data) return result;
    const live = day.data.meals.find((m) => m.id === result.meal.id);
    return live ? { ...result, meal: live } : null;
  })();

  return (
    <Screen scroll={false} padded={false} keyboard backdrop="orb" edges={['top']} contentContainerStyle={styles.noPad}>
      <ScrollView
        ref={scrollRef}
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: tabSpace }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.coral} colors={[colors.coral]} progressBackgroundColor={colors.white} />}
      >
        <ScreenHeader
          eyebrow="Meal log"
          title="What's on your plate?"
          subtitle="Type or speak what you ate in English, Hindi or Hinglish — or pick from ÖRZA's food list. Manual logging is always free."
          right={<IconButton icon="camera" accessibilityLabel="Snap a meal" onPress={openSnap} />}
        />

        <Animated.View entering={FadeInDown.delay(40).springify().damping(18)} style={styles.dateRow}>
          <DateNavigator date={date} today={today} onChange={changeDate} />
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(90).springify().damping(18)}>
          <MealComposer
            ref={composerRef}
            date={date}
            isToday={isToday}
            dayLabel={dayLabel}
            mealType={composerType}
            onMealTypeChange={setComposerType}
            aiStatus={aiStatus}
            onLogged={setResult}
            onOpenFoodList={() => openPicker()}
          />
        </Animated.View>

        {shownResult ? (
          <View style={styles.section}>
            <LoggedResult
              key={shownResult.meal.id}
              result={shownResult}
              undoing={del.isPending && del.variables?.id === shownResult.meal.id}
              onDismiss={() => setResult(null)}
              onUndo={() => removeMeal(shownResult.meal, true)}
              onEdit={() => openEditor(shownResult.meal)}
              onSearch={(phrase) => openPicker(shownResult.meal.meal_type, phrase)}
            />
          </View>
        ) : null}

        {loadError ? (
          <Animated.View entering={FadeInDown.springify().damping(18)} style={styles.section}>
            <GlassCard tone="strong">
              <View style={styles.errorRow}>
                <Icon name={day.error instanceof ApiError && day.error.isNetwork ? 'wifi-off' : 'alert-circle'} size={20} color={colors.error} />
                <View style={styles.flex}>
                  <Text variant="title" tone="ink">
                    We couldn&apos;t load your meals
                  </Text>
                  <Text variant="small" tone="muted" style={styles.errorText}>
                    {errorMessage(day.error)}
                  </Text>
                </View>
              </View>
              <Button label="Try again" icon="refresh-cw" variant="secondary" size="sm" onPress={() => void day.refetch()} loading={day.isFetching} style={styles.retry} />
            </GlassCard>
          </Animated.View>
        ) : (
          <>
            <Animated.View entering={FadeInDown.delay(140).springify().damping(18)} style={styles.section}>
              <DailySummary totals={day.data?.totals ?? null} targets={user.targets} dayLabel={dayLabel} loading={loading} />
            </Animated.View>
            <View style={styles.sectionLg}>
              <MealGroups
                meals={meals}
                loading={loading}
                dayLabel={dayLabel}
                tz={tz}
                onAdd={(type) => openPicker(type)}
                onEdit={openEditor}
                onDelete={(m) => removeMeal(m)}
                onSnap={openSnap}
              />
            </View>
          </>
        )}

        <Text variant="caption" tone="subtle" align="center" style={styles.disclaimer}>
          Calorie estimates are approximate — home and restaurant versions of the same dish can differ a lot.
        </Text>
      </ScrollView>

      <FoodPickerSheet
        visible={picker.open}
        onClose={() => setPicker((p) => ({ ...p, open: false }))}
        date={date}
        defaultMealType={picker.type}
        initialQuery={picker.query}
        onAdded={() => {}}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  noPad: { paddingBottom: 0 },
  content: { paddingHorizontal: gutter, flexGrow: 1 },
  dateRow: { marginBottom: spacing.lg },
  section: { marginTop: spacing.lg },
  sectionLg: { marginTop: spacing.xxxl },
  errorRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  errorText: { marginTop: 2 },
  retry: { alignSelf: 'flex-start', marginTop: spacing.md },
  disclaimer: { marginTop: spacing.xxl, paddingHorizontal: spacing.lg },
});
