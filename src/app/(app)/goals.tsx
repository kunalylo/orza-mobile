/** Smart Goals — active goal progress, weight trend, daily targets and the goal planner. See src/features/goals. */
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useGoalsActive } from '@/features/goals/api';
import { GoalCalculator } from '@/features/goals/GoalCalculator';
import { GoalOverview } from '@/features/goals/GoalOverview';
import { formatLongDate, isImperial, todayInTz } from '@/features/goals/math';
import { TargetsGrid } from '@/features/goals/TargetsGrid';
import type { GoalCalculateResponse } from '@/features/goals/types';
import { WeightTrendCard } from '@/features/goals/WeightTrendCard';
import { errorMessage } from '@/lib/api';
import { useAuth, useSignedInUser } from '@/lib/auth';
import type { Targets } from '@/lib/types';
import { colors, gutter, radii, spacing } from '@/theme';
import { EmptyState, GlassCard, IconButton, Screen, ScreenHeader, SectionHeader, Skeleton, Text, toast } from '@/ui';

export default function Goals() {
  const user = useSignedInUser();
  const { setUser } = useAuth();
  const reduce = useReducedMotion();
  const insets = useSafeAreaInsets();
  const q = useGoalsActive();
  const [previousTargets, setPreviousTargets] = useState<Targets | null>(null);
  const [plannerKey, setPlannerKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const plannerY = useRef(0);
  const contentY = useRef(0);

  const data = q.data;
  const imperial = isImperial(user.preferences?.units);
  const today = data?.today ?? todayInTz(user.profile?.timezone);
  const latest = data?.weights.length ? data.weights[data.weights.length - 1].weight_kg : (data?.profile.weight_kg ?? null);

  const scrollToPlanner = () => scrollRef.current?.scrollTo({ y: Math.max(0, contentY.current + plannerY.current - spacing.md), animated: !reduce });

  function onGoalSaved(res: GoalCalculateResponse) {
    setPreviousTargets(data?.targets ?? null);
    setUser(res.user);
    setPlannerKey((k) => k + 1);
    toast.success(
      res.goal.target_date ? `Goal saved — estimated around ${formatLongDate(res.goal.target_date)}. Your daily targets are updated.` : 'Goal saved — your daily targets are updated.',
      5000,
    );
    const notice = res.notice;
    if (notice) setTimeout(() => toast.info(notice, 7000), 400);
    scrollRef.current?.scrollTo({ y: 0, animated: !reduce });
  }

  async function onRefresh() {
    setRefreshing(true);
    try {
      await q.refetch();
    } finally {
      setRefreshing(false);
    }
  }

  const enter = (i: number) => (reduce ? undefined : FadeInDown.delay(i * 60).springify().damping(18).stiffness(100).mass(1));

  return (
    <Screen backdrop="orb" scroll={false} padded={false} keyboard edges={['top']} contentContainerStyle={styles.noPad}>
      <ScrollView
        ref={scrollRef}
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxxl }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.coral} colors={[colors.coral]} />}
      >
        <ScreenHeader
          back
          large={false}
          eyebrow="Smart goals"
          title="Goals & planner"
          subtitle="Set targets and get intelligent recommendations. AI-powered planning adapts to your lifestyle and progress."
          right={data ? <IconButton icon="sliders" accessibilityLabel={data.goal ? 'Update goal' : 'Set a goal'} onPress={scrollToPlanner} /> : undefined}
        />

        {q.isError && !data ? (
          <GlassCard tone="strong">
            <EmptyState icon="wifi-off" title="We couldn't load your goals" body={errorMessage(q.error)} actionLabel="Try again" onAction={() => void q.refetch()} />
          </GlassCard>
        ) : !data ? (
          <GoalsSkeleton />
        ) : (
          <View
            onLayout={(e) => {
              contentY.current = e.nativeEvent.layout.y;
            }}
          >
            <Animated.View entering={enter(0)}>
              <GoalOverview goal={data.goal} latest={latest} today={today} imperial={imperial} onPlan={scrollToPlanner} />
            </Animated.View>

            <Animated.View entering={enter(1)} style={styles.block}>
              <WeightTrendCard
                points={data.weights}
                target={data.goal && data.goal.goal !== 'maintain' ? data.goal.target_weight_kg : null}
                imperial={imperial}
                today={today}
              />
            </Animated.View>

            <View style={styles.section}>
              <SectionHeader
                eyebrow="Daily targets"
                title={data.goal ? 'What your goal looks like each day' : 'Your daily targets'}
                actionLabel="Fine-tune"
                onAction={() => router.push('/account/targets')}
              />
              <TargetsGrid targets={data.targets} previous={previousTargets} />
            </View>

            <View
              style={styles.section}
              onLayout={(e) => {
                plannerY.current = e.nativeEvent.layout.y;
              }}
            >
              <Text variant="eyebrow" tone="energy">
                Goal planner
              </Text>
              <Text variant="h2" accessibilityRole="header" style={styles.plannerTitle}>
                {data.goal ? 'Adjust your goal' : 'Plan a goal that fits your life'}
              </Text>
              <Text variant="callout" tone="muted" style={styles.plannerBody}>
                Choose a pace that feels sustainable. ÖRZA works out your calories and macros instantly, and keeps every plan within safe limits.
              </Text>
              <GoalCalculator
                key={`${plannerKey}-${imperial ? 'imperial' : 'metric'}`}
                goal={data.goal}
                profile={data.profile}
                latestWeight={latest}
                currentTargets={data.targets}
                today={today}
                imperial={imperial}
                onSaved={onGoalSaved}
              />
            </View>

            <Text variant="caption" tone="subtle" align="center" style={styles.note}>
              Wellness guidance, not medical advice. For medical concerns, please consult your doctor.
            </Text>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

function GoalsSkeleton() {
  return (
    <View accessibilityLabel="Loading your goals" accessibilityState={{ busy: true }}>
      <Skeleton height={420} radius={radii.lg} />
      <Skeleton height={340} radius={radii.lg} style={styles.block} />
      <Skeleton width={140} height={14} radius={radii.pill} style={styles.section} />
      <View style={styles.skGrid}>
        {Array.from({ length: 6 }, (_, i) => (
          <View key={i} style={styles.skCell}>
            <Skeleton height={118} radius={radii.md} />
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  noPad: { paddingBottom: 0 },
  content: { paddingHorizontal: gutter },
  block: { marginTop: spacing.lg },
  section: { marginTop: spacing.xxxl },
  plannerTitle: { marginTop: spacing.xs },
  plannerBody: { marginTop: spacing.sm, marginBottom: spacing.lg },
  note: { marginTop: spacing.xxl, paddingHorizontal: spacing.lg },
  skGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -spacing.xs, marginTop: spacing.md },
  skCell: { width: '50%', padding: spacing.xs },
});
