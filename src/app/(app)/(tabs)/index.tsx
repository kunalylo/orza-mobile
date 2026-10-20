import { useQueryClient } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AppState, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';

import { addDays, safeTimeZone } from '@/lib/alarms/schedule';
import { ApiError, errorMessage } from '@/lib/api';
import { firstName, useAuth, useSignedInUser } from '@/lib/auth';
import { dayStartMs } from '@/lib/steps/counter';
import { colors, gutter, radii, spacing } from '@/theme';
import { Button, GlassCard, Icon, Screen, Text, useTabBarSpace } from '@/ui';

import type { Meal, MealType } from '@/features/meals/types';
import { DEFAULT_TZ, hourInTz, todayInTz } from '@/features/meals/utils';
import { medsKeys } from '@/features/meds/api';
import { useTodayDashboard } from '@/features/today/api';
import { StepsSheet, WeightSheet, WeightTile } from '@/features/today/BodyCards';
import { EnergyCard } from '@/features/today/EnergyCard';
import { InsightCard } from '@/features/today/InsightCard';
import { MealsSection } from '@/features/today/MealsSection';
import { MedsCard } from '@/features/today/MedsCard';
import { QuickActions } from '@/features/today/QuickActions';
import { DEFAULT_STEP_TARGET, StepsCard } from '@/features/today/StepsCard';
import { TodayHeader, WeekStrip } from '@/features/today/TodayHeader';
import { TodaySkeleton } from '@/features/today/TodaySkeleton';
import { WaterCard } from '@/features/today/WaterCard';

/**
 * Today — the daily dashboard: energy ring + macros, ÖRZA's insight, quick actions, medicines, water, steps (counted
 * automatically), weight, meals.
 */
export default function Today() {
  const user = useSignedInUser();
  const { refresh } = useAuth();
  const qc = useQueryClient();
  const tz = user.profile?.timezone || DEFAULT_TZ;
  const tabSpace = useTabBarSpace();
  const reduce = useReducedMotion();

  const [today, setToday] = useState(() => todayInTz(tz));
  /** A past day being browsed; null = today (follows midnight). */
  const [picked, setPicked] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'steps' | 'weight' | null>(null);
  /** How the steps sheet opened: typing fallback ("log") or correcting a counted day ("edit"), with the number shown. */
  const [stepsEntry, setStepsEntry] = useState<{ mode: 'log' | 'edit'; shown: number }>({ mode: 'log', shown: 0 });
  const [refreshing, setRefreshing] = useState(false);

  const date = picked && picked < today ? picked : today;
  const isToday = date === today;

  // Midnight rollover: re-read the calendar day whenever the tab or the app comes back.
  const syncToday = useCallback(() => setToday(todayInTz(tz)), [tz]);
  useFocusEffect(syncToday);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && syncToday());
    return () => sub.remove();
  }, [syncToday]);
  // Midnight while Today stays open: move to the new day (the steps card would otherwise keep showing yesterday's
  // saved count under a Live pill). Re-armed after every hop, so a long wait is split into ≤ 6 h steps.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      const ms = dayStartMs(addDays(todayInTz(tz), 1), safeTimeZone(tz)) - Date.now();
      t = setTimeout(
        () => {
          syncToday();
          arm();
        },
        Math.max(1_000, Math.min(ms + 1_000, 6 * 3_600_000))
      );
    };
    arm();
    return () => clearTimeout(t);
  }, [tz, syncToday]);

  const q = useTodayDashboard(date);
  const data = q.data;
  /** The previous day is still on screen while the chosen one loads. */
  const stale = q.isPlaceholderData;
  const shown = data && !stale ? data : null;

  const goTo = (d: string) => {
    if (d > today) return;
    setPicked(d >= today ? null : d);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    syncToday();
    try {
      await Promise.all([
        q.refetch(),
        isToday ? qc.invalidateQueries({ queryKey: medsKeys.todayAll() }) : Promise.resolve(),
        refresh().catch(() => null),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  /* ─── navigation ─── */

  // Always name the day (today included): Meals / Snap stay mounted and keep whatever day they were left on.
  const dayParam = (): Record<string, string> => ({ date });
  const openSnap = () => router.navigate({ pathname: '/snap', params: dayParam() });
  const openCompose = () => router.navigate({ pathname: '/meals', params: { compose: '1', ...dayParam() } });
  const openLog = (type?: MealType) => router.navigate({ pathname: '/meals', params: { ...(type ? { meal_type: type } : {}), ...dayParam() } });
  const openMeal = (meal: Meal) => router.push({ pathname: '/meal/[id]', params: { id: meal.id, date: meal.date } });
  const openMedicines = () => router.navigate('/medicines');

  const enter = (delay: number) => (reduce ? undefined : FadeInDown.delay(delay).springify().damping(18).stiffness(100).mass(1));
  const imperial = user.preferences?.units === 'imperial';
  const view = data;
  const openSteps = (mode: 'log' | 'edit', shownSteps: number) => {
    setStepsEntry({ mode, shown: shownSteps });
    setSheet('steps');
  };

  let content: ReactNode;
  if (q.isError && !data) {
    const offline = q.error instanceof ApiError && q.error.isNetwork;
    content = (
      <>
        <Animated.View entering={enter(0)}>
          <GlassCard tone="strong" style={styles.errorCard} accessibilityRole="alert">
            <View style={styles.errorIcon}>
              <Icon name={offline ? 'wifi-off' : 'alert-circle'} size={20} color={colors.error} />
            </View>
            <Text variant="h3" tone="ink" align="center">
              We couldn&apos;t load your day
            </Text>
            <Text variant="small" tone="muted" align="center" style={styles.errorText}>
              {errorMessage(q.error)}
            </Text>
            <View style={styles.errorActions}>
              <Button label="Try again" icon="rotate-cw" onPress={() => void q.refetch()} loading={q.isFetching} />
              {!isToday ? <Button label="Back to today" variant="secondary" onPress={() => setPicked(null)} /> : null}
            </View>
          </GlassCard>
        </Animated.View>
        {/* The phone counts steps without the network: today's count still shows (and saves once back online). */}
        {isToday ? (
          <Animated.View entering={enter(60)} style={styles.section}>
            <StepsCard date={today} today={today} serverSteps={null} target={user.targets?.steps > 0 ? user.targets.steps : DEFAULT_STEP_TARGET} tz={tz} />
          </Animated.View>
        ) : null}
      </>
    );
  } else if (!view) {
    content = <TodaySkeleton />;
  } else {
    const viewToday = view.date === view.today;
    content = (
      <View style={stale && styles.stale} pointerEvents={stale ? 'none' : 'auto'} accessibilityState={{ busy: stale }}>
        {/* Kept up during the background retries while offline (they used to hide it on and off) — gone on success. */}
        {q.isError && !refreshing ? (
          <Animated.View entering={enter(0)} style={styles.offline}>
            <Icon name="wifi-off" size={14} color={colors.warning} />
            <Text variant="caption" tone="warning" style={styles.flex}>
              {/* Its own sentence: lower-casing the server's message turned "ÖRZA" into "örza" mid-banner. */}
              Showing your last saved numbers. {errorMessage(q.error)}
            </Text>
          </Animated.View>
        ) : null}

        <Animated.View entering={enter(0)}>
          <WeekStrip week={view.week} date={view.date} today={view.today} target={view.targets.calories} onSelect={goTo} />
        </Animated.View>

        <Animated.View entering={enter(60)} style={styles.section}>
          <EnergyCard totals={view.totals} targets={view.targets} remaining={view.remaining} isToday={viewToday} onRebalance={() => router.push('/rebalance')} />
        </Animated.View>

        <Animated.View entering={enter(110)} style={styles.section}>
          <InsightCard insight={view.insight} onTalk={() => router.push('/ask')} />
        </Animated.View>

        <Animated.View entering={enter(150)} style={styles.section}>
          <QuickActions onSnap={openSnap} onType={openCompose} onAsk={() => router.push('/ask')} />
        </Animated.View>

        {/* Time-sensitive, so it sits high up. It always shows the real today's doses, so only on today's view. */}
        {viewToday ? (
          <Animated.View entering={enter(190)} style={styles.section}>
            <MedsCard onOpenMedicines={openMedicines} onAddMedicine={() => router.push('/med/edit')} onScanPrescription={() => router.push('/rx')} />
          </Animated.View>
        ) : null}

        <Animated.View entering={enter(220)} style={styles.section}>
          <WaterCard key={`water-${view.date}`} date={view.date} glasses={view.tracking.water_glasses || 0} target={view.targets.water_glasses} />
        </Animated.View>

        {/* Steps count themselves (this phone / Health Connect / Apple Health); typing is only a fallback. */}
        <Animated.View entering={enter(250)} style={styles.section}>
          <StepsCard
            date={view.date}
            today={view.today}
            serverSteps={view.tracking.steps || 0}
            target={view.targets.steps > 0 ? view.targets.steps : DEFAULT_STEP_TARGET}
            tz={tz}
            onLog={openSteps}
          />
        </Animated.View>

        <Animated.View entering={enter(270)} style={[styles.section, styles.row]}>
          <WeightTile
            date={view.date}
            today={view.today}
            onPress={() => setSheet('weight')}
            info={{ dayWeight: view.tracking.weight_kg, lastWeight: view.last_weight, profileWeight: user.profile?.weight_kg, goal: view.goal, imperial }}
          />
        </Animated.View>

        <Animated.View entering={enter(280)} style={styles.sectionLg}>
          <MealsSection
            meals={view.meals}
            totals={view.totals}
            isToday={viewToday}
            tz={tz}
            onLog={openLog}
            onOpen={openMeal}
            onSnap={openSnap}
            onType={openCompose}
          />
        </Animated.View>
      </View>
    );
  }

  return (
    <Screen scroll={false} padded={false} backdrop="orb" edges={['top']} contentContainerStyle={styles.noPad}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: tabSpace }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.coral} colors={[colors.coral]} progressBackgroundColor={colors.white} />}
      >
        <TodayHeader
          name={firstName(user)}
          date={date}
          today={today}
          hour={hourInTz(tz)}
          streak={data ? data.streak : null}
          busy={stale}
          onDateChange={goTo}
        />
        {content}
        <Text variant="caption" tone="subtle" align="center" style={styles.disclaimer}>
          ÖRZA offers wellness guidance, not medical advice.
        </Text>
      </ScrollView>

      {shown ? (
        <>
          <StepsSheet
            visible={sheet === 'steps'}
            onClose={() => setSheet(null)}
            date={shown.date}
            today={shown.today}
            steps={stepsEntry.mode === 'edit' ? stepsEntry.shown : shown.tracking.steps || 0}
            target={shown.targets.steps > 0 ? shown.targets.steps : DEFAULT_STEP_TARGET}
            mode={stepsEntry.mode}
          />
          <WeightSheet
            visible={sheet === 'weight'}
            onClose={() => setSheet(null)}
            date={shown.date}
            today={shown.today}
            onGoals={() => router.push('/goals')}
            info={{ dayWeight: shown.tracking.weight_kg, lastWeight: shown.last_weight, profileWeight: user.profile?.weight_kg, goal: shown.goal, imperial }}
          />
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  noPad: { paddingBottom: 0 },
  content: { paddingHorizontal: gutter, flexGrow: 1 },
  stale: { opacity: 0.6 },
  section: { marginTop: spacing.lg },
  sectionLg: { marginTop: spacing.xxxl },
  row: { flexDirection: 'row', gap: spacing.md },
  offline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: colors.warningBg,
  },
  errorCard: { alignItems: 'center', paddingVertical: spacing.xxxl },
  errorIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.errorBg,
    marginBottom: spacing.md,
  },
  errorText: { marginTop: spacing.sm },
  errorActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.xl },
  disclaimer: { marginTop: spacing.xxl, paddingHorizontal: spacing.lg },
});
