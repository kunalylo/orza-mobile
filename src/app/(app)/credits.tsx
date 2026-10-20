/** AI credits: balance, what each AI action costs, the credit history and "Request more credits". See src/features/credits. */
import { useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCreditBalance, useCreditRequests, useCreditTransactions } from '@/features/credits/api';
import { BalanceHero } from '@/features/credits/BalanceHero';
import { CostsCard } from '@/features/credits/CostsCard';
import { FALLBACK_COSTS } from '@/features/credits/options';
import { RequestCreditsSheet } from '@/features/credits/RequestCreditsSheet';
import { TransactionHistory } from '@/features/credits/TransactionHistory';
import { errorMessage } from '@/lib/api';
import { useAuth, useSignedInUser } from '@/lib/auth';
import { colors, gutter, radii, spacing } from '@/theme';
import { EmptyState, GlassCard, Screen, ScreenHeader, Skeleton } from '@/ui';

export default function Credits() {
  const user = useSignedInUser();
  const { setUser } = useAuth();
  const reduce = useReducedMotion();
  const insets = useSafeAreaInsets();
  const balance = useCreditBalance();
  const history = useCreditTransactions();
  const requests = useCreditRequests();
  const [requestOpen, setRequestOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const costsY = useRef(0);
  const stackY = useRef(0);

  const b = balance.data;
  const requested = !!requests.data?.pending;

  // Keep the header / tab credit pill in sync with the server's balance — only from a fresh answer, never from the
  // cached copy shown while refetching (an AI action elsewhere may have spent credits since).
  const syncedAt = useRef(0);
  const fetching = balance.isFetching;
  const updatedAt = balance.dataUpdatedAt;
  useEffect(() => {
    if (!b || fetching || syncedAt.current === updatedAt) return;
    syncedAt.current = updatedAt;
    if (b.credits !== user.credits) setUser({ ...user, credits: b.credits });
  }, [b, fetching, updatedAt, user, setUser]);

  async function onRefresh() {
    setRefreshing(true);
    try {
      await Promise.all([balance.refetch(), history.refetch(), requests.refetch()]);
    } finally {
      setRefreshing(false);
    }
  }

  const enter = (i: number) => (reduce ? undefined : FadeInDown.delay(i * 70).springify().damping(18).stiffness(100).mass(1));

  return (
    <Screen backdrop="orb" scroll={false} padded={false} edges={['top']} contentContainerStyle={styles.noPad}>
      <ScrollView
        ref={scrollRef}
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxxl }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.coral} colors={[colors.coral]} />}
      >
        <ScreenHeader
          back
          large={false}
          eyebrow="AI credits"
          title="Credits"
          subtitle="Credits power ÖRZA's AI — photo scans, AI meal logging, chat, recipes and rebalance plans. Everything else is free, always."
        />

        {balance.isError && !b ? (
          <GlassCard tone="strong">
            <EmptyState icon="wifi-off" title="We couldn't load your credits" body={errorMessage(balance.error)} actionLabel="Try again" onAction={() => void onRefresh()} />
          </GlassCard>
        ) : !b ? (
          <View style={styles.stack} accessibilityLabel="Loading credits" accessibilityState={{ busy: true }}>
            <Skeleton height={460} radius={radii.xl} />
            <Skeleton height={380} radius={radii.lg} />
            <Skeleton height={260} radius={radii.lg} />
          </View>
        ) : (
          <View
            style={styles.stack}
            onLayout={(e) => {
              stackY.current = e.nativeEvent.layout.y;
            }}
          >
            <Animated.View entering={enter(0)}>
              <BalanceHero
                credits={b.credits}
                costs={b.costs ?? FALLBACK_COSTS}
                aiEnabled={b.ai_enabled}
                spent30d={b.spent_30d}
                requested={requested}
                onRequest={() => setRequestOpen(true)}
                onShowCosts={() => scrollRef.current?.scrollTo({ y: Math.max(0, stackY.current + costsY.current - spacing.md), animated: !reduce })}
              />
            </Animated.View>

            <Animated.View
              entering={enter(1)}
              onLayout={(e) => {
                costsY.current = e.nativeEvent.layout.y;
              }}
            >
              <CostsCard costs={b.costs ?? FALLBACK_COSTS} aiEnabled={b.ai_enabled} />
            </Animated.View>

            <Animated.View entering={enter(2)}>
              {history.isError && !history.data ? (
                <GlassCard tone="strong">
                  <EmptyState icon="clock" title="We couldn't load your credit activity" body={errorMessage(history.error)} actionLabel="Try again" onAction={() => void history.refetch()} />
                </GlassCard>
              ) : !history.data ? (
                <Skeleton height={260} radius={radii.lg} />
              ) : (
                <TransactionHistory transactions={history.data.transactions ?? []} />
              )}
            </Animated.View>
          </View>
        )}
      </ScrollView>

      {b ? <RequestCreditsSheet visible={requestOpen} onClose={() => setRequestOpen(false)} email={user.email} credits={b.credits} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  noPad: { paddingBottom: 0 },
  content: { paddingHorizontal: gutter },
  stack: { gap: spacing.lg },
});
