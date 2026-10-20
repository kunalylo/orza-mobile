/** Compassionate Rebalancing — a supportive 2–5 day plan after a special meal, plus past plans. See src/features/rebalance. */
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useRebalancePlans } from '@/features/rebalance/api';
import { PlanHistory } from '@/features/rebalance/PlanHistory';
import { HowItWorks, PlanView } from '@/features/rebalance/PlanView';
import { RebalanceForm } from '@/features/rebalance/RebalanceForm';
import { formatDayDate, resultTitle, type RebalanceCreateResponse } from '@/features/rebalance/types';
import { errorMessage } from '@/lib/api';
import { useAuth, useSignedInUser } from '@/lib/auth';
import { haptics } from '@/lib/haptics';
import { colors, gutter, spacing } from '@/theme';
import { Button, EmptyState, Screen, ScreenHeader, Tag, Text, toast } from '@/ui';

export default function Rebalance() {
  const user = useSignedInUser();
  const { setUser, refresh } = useAuth();
  const reduce = useReducedMotion();
  const insets = useSafeAreaInsets();
  const q = useRebalancePlans();
  const [result, setResult] = useState<RebalanceCreateResponse | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const resultY = useRef(0);

  const plans = q.data?.plans ?? [];
  const plan = result?.plan;
  const n = plan?.days.length ?? 0;

  function onCreated(res: RebalanceCreateResponse) {
    setResult(res);
    if (typeof res.credits === 'number' && res.credits !== user.credits) setUser({ ...user, credits: res.credits });
    haptics.success();
    if (res.notice) toast.info(res.notice, 6000);
    else toast.success('Your rebalance plan is ready.');
    // Wait a frame for the result to lay out, then bring it into view.
    setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, resultY.current - spacing.md), animated: !reduce }), 120);
  }

  async function onRefresh() {
    setRefreshing(true);
    try {
      await q.refetch();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <Screen backdrop="orb" scroll={false} padded={false} keyboard edges={['top']} contentContainerStyle={styles.noPad}>
      <ScrollView
        ref={scrollRef}
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxl }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.coral} colors={[colors.coral]} />}
      >
        <ScreenHeader
          back
          large={false}
          eyebrow="Compassionate rebalancing"
          title="Rebalance"
          subtitle="Enjoyed a special meal? ÖRZA creates a supportive recovery plan — no guilt, just smart wellness strategies."
        />

        <Animated.View entering={reduce ? undefined : FadeInDown.springify().damping(18).stiffness(100).mass(1)}>
          <RebalanceForm
            aiEnabled={q.isPending ? undefined : q.data?.ai_enabled}
            cost={q.data?.cost}
            onCreated={onCreated}
            onNeedCredits={() => void refresh()}
          />
        </Animated.View>

        {plan ? (
          <View
            style={styles.section}
            onLayout={(e) => {
              resultY.current = e.nativeEvent.layout.y;
            }}
          >
            <Animated.View entering={reduce ? undefined : FadeInDown.springify().damping(18).stiffness(100).mass(1)}>
              <Text variant="eyebrow" tone="energy">
                Your rebalance plan
              </Text>
              <Text variant="h1" style={styles.resultTitle} accessibilityRole="header">
                {resultTitle(plan.occasion)}
              </Text>
              <View style={styles.resultMeta}>
                <Tag label={plan.ai ? 'AI-personalised' : 'Built-in plan'} tone={plan.ai ? 'violet' : 'neutral'} dot />
                {n > 0 ? (
                  <Text variant="caption" tone="muted">
                    {n} days · starts {formatDayDate(plan.days[0].date)}
                  </Text>
                ) : null}
              </View>
              {result?.notice ? (
                <Text variant="caption" tone="subtle" style={styles.notice}>
                  {result.notice}
                </Text>
              ) : null}
            </Animated.View>
            <View style={styles.planBody}>
              <PlanView plan={plan} matched={result?.estimate?.matched} />
            </View>
            <View style={styles.resultActions}>
              <Button
                label="Plan another"
                icon="refresh-cw"
                variant="secondary"
                size="sm"
                onPress={() => scrollRef.current?.scrollTo({ y: 0, animated: !reduce })}
              />
              {user.credits <= 0 && q.data?.ai_enabled ? (
                <Button label="Get credits" icon="zap" variant="ghost" size="sm" onPress={() => router.push('/credits')} />
              ) : null}
            </View>
          </View>
        ) : null}

        <Animated.View entering={reduce ? undefined : FadeInDown.delay(80).springify().damping(18).stiffness(100).mass(1)} style={styles.section}>
          <HowItWorks />
        </Animated.View>

        <View style={styles.section}>
          <View style={styles.historyHead}>
            <View style={styles.flex}>
              <Text variant="eyebrow" tone="subtle">
                History
              </Text>
              <Text variant="h2" style={styles.historyTitle} accessibilityRole="header">
                Past plans
              </Text>
            </View>
            {!q.isPending && !q.isError && plans.length > 0 ? (
              <Text variant="caption" tone="muted">
                {plans.length} plan{plans.length === 1 ? '' : 's'}
              </Text>
            ) : null}
          </View>
          {q.isError && !q.data ? (
            <EmptyState icon="wifi-off" title="We couldn't load your past plans" body={errorMessage(q.error)} actionLabel="Try again" onAction={() => void q.refetch()} />
          ) : (
            <PlanHistory
              plans={plans}
              loading={q.isPending}
              highlightId={result?.plan.id}
              onDeleted={(id) => setResult((r) => (r?.plan.id === id ? null : r))}
            />
          )}
        </View>

        <Text variant="caption" tone="subtle" align="center" style={styles.note}>
          Wellness guidance, not medical advice. For medical concerns, please consult your doctor.
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  noPad: { paddingBottom: 0 },
  content: { paddingHorizontal: gutter },
  section: { marginTop: spacing.xxxl },
  resultTitle: { marginTop: spacing.xs },
  resultMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  notice: { marginTop: spacing.sm },
  planBody: { marginTop: spacing.lg },
  resultActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.lg },
  historyHead: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md, marginBottom: spacing.lg },
  historyTitle: { marginTop: 4 },
  note: { marginTop: spacing.xxl, paddingHorizontal: spacing.lg },
});
