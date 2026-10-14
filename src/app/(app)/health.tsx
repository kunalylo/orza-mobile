/**
 * Health sync — connect Apple Health (iPhone) or Health Connect (Android), sync the last 30 days of daily totals to
 * ÖRZA, and see steps, sleep, resting heart rate and weight trends (all sources merged, like the web page).
 */
import { useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';

import { useHealthDays } from '@/features/health/api';
import { BarChart, ChartCard, LineChart } from '@/features/health/charts';
import { ConnectCard } from '@/features/health/ConnectCard';
import { addDays, compact, formatDay, formatInt, formatKg, formatSleep, sourceLabel, timeAgo, todayIn } from '@/features/health/format';
import { PrivacyNote, SourcesCard } from '@/features/health/SourcesCard';
import { StatTiles, StatTilesSkeleton } from '@/features/health/StatTiles';
import type { ChartPoint, HealthMetric, HealthRange, MergedHealthDay } from '@/features/health/types';
import { errorMessage } from '@/lib/api';
import { useSignedInUser } from '@/lib/auth';
import { haptics } from '@/lib/haptics';
import { useHealthAutoSync, useHealthSync } from '@/lib/health/sync';
import { colors, radii, spacing } from '@/theme';
import { Button, EmptyState, GlassCard, IconButton, Screen, ScreenHeader, Segmented, Skeleton, Tag, Text, toast } from '@/ui';

const DEFAULT_STEP_TARGET = 8000;
const SLEEP_GUIDE_HOURS = 7;

const average = (values: number[]) => (values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0);

function series(dates: string[], byDate: Map<string, MergedHealthDay>, metric: HealthMetric, map: (v: number) => number = (v) => v): ChartPoint[] {
  return dates.map((date) => {
    const v = byDate.get(date)?.[metric];
    return { date, value: typeof v === 'number' ? map(v) : undefined };
  });
}

const valuesOf = (pts: ChartPoint[]) => pts.flatMap((p) => (p.value !== undefined ? [p.value] : []));

export default function HealthSync() {
  const user = useSignedInUser();
  const health = useHealthSync();
  useHealthAutoSync();
  const reduce = useReducedMotion();

  const today = todayIn(user.profile?.timezone);
  const stepTarget = user.targets?.steps > 0 ? user.targets.steps : DEFAULT_STEP_TARGET;
  const [range, setRange] = useState<HealthRange>('30');
  const from = addDays(today, -(Number(range) - 1));
  const query = useHealthDays(from, today);
  const [pulling, setPulling] = useState(false);

  const data = query.data;
  const days = data?.days ?? [];
  const byDate = new Map(days.map((d) => [d.date, d]));
  const dates = Array.from({ length: Number(range) }, (_, i) => addDays(from, i));

  const steps = series(dates, byDate, 'steps');
  const sleepHours = series(dates, byDate, 'sleep_minutes', (m) => m / 60);
  const resting = series(dates, byDate, 'resting_hr');
  const weight = series(dates, byDate, 'weight_kg');

  const stepVals = valuesOf(steps);
  const sleepVals = valuesOf(sleepHours);
  const restingVals = valuesOf(resting);
  const weightPts = weight.filter((p) => p.value !== undefined) as { date: string; value: number }[];
  const onTarget = stepVals.filter((v) => v >= stepTarget).length;
  const weightDelta = weightPts.length > 1 ? weightPts[weightPts.length - 1].value - weightPts[0].value : 0;

  const neverSynced = !!data && days.length === 0 && !data.last_sync;
  const dimmed = query.isFetching && query.isPlaceholderData;

  async function refresh() {
    setPulling(true);
    haptics.soft();
    try {
      if (health.connected) {
        const r = await health.syncNow();
        if (r.status === 'error') toast.error(r.message);
      }
      await query.refetch();
    } finally {
      setPulling(false);
    }
  }

  return (
    <Screen
      backdrop="orb"
      refreshControl={
        <RefreshControl
          refreshing={pulling}
          onRefresh={() => void refresh()}
          tintColor={colors.coral}
          colors={[colors.coral]}
          progressBackgroundColor={colors.canvas}
        />
      }
    >
      <ScreenHeader
        back
        eyebrow="Care · Health sync"
        title="Health sync"
        subtitle={`Steps, sleep, heart rate and weight from ${health.platform === 'android' ? 'Health Connect' : 'Apple Health'}, side by side with what you eat.`}
        right={
          <IconButton
            icon="refresh-cw"
            accessibilityLabel="Check for new health data"
            onPress={() => void refresh()}
            disabled={pulling || health.syncing}
          />
        }
      />

      <View style={styles.stack}>
        <ConnectCard health={health} />

        {query.isPending ? (
          <LoadingBody />
        ) : query.isError && !data ? (
          <GlassCard padding={spacing.sm}>
            <EmptyState
              icon="mci:heart-pulse"
              title="We couldn’t load your health data"
              body={errorMessage(query.error)}
              actionLabel="Try again"
              onAction={() => void query.refetch()}
            />
          </GlassCard>
        ) : neverSynced ? (
          <GlassCard padding={spacing.sm}>
            <EmptyState
              icon="mci:heart-pulse"
              eyebrow="Trends"
              title="No health data yet"
              body={
                health.connected
                  ? `Your first sync from ${health.name} is on its way — pull down to check again.`
                  : `Connect ${health.name} above and your steps, sleep, heart rate and weight will show up here.`
              }
            />
          </GlassCard>
        ) : data ? (
          <>
            {query.isError ? (
              <Animated.View entering={FadeIn} style={styles.staleBanner} accessibilityRole="alert">
                <Text variant="caption" tone="text" style={styles.flex}>
                  {`Showing saved data. ${errorMessage(query.error)}`}
                </Text>
                <Button label="Retry" size="sm" variant="secondary" onPress={() => void query.refetch()} />
              </Animated.View>
            ) : null}

            {data.last_sync ? (
              <View style={styles.tagRow}>
                <Tag tone="success" dot label={`Synced ${timeAgo(data.last_sync)}`} />
                {data.last_sync_source ? (
                  <Text variant="caption" tone="muted" numberOfLines={1} style={styles.flex}>
                    {sourceLabel(data.last_sync_source)}
                  </Text>
                ) : null}
              </View>
            ) : null}

            <StatTiles days={days} today={today} stepTarget={stepTarget} />

            <View style={styles.trendsHead}>
              <Text variant="h2" tone="ink">
                Trends
              </Text>
              <Segmented
                accessibilityLabel="Trend period"
                size="sm"
                value={range}
                onChange={(v) => {
                  haptics.select();
                  setRange(v);
                }}
                options={[
                  { value: '30', label: '30 days' },
                  { value: '90', label: '90 days' },
                ]}
              />
            </View>

            <ChartCard
              index={0}
              title="Steps"
              subtitle={`Daily steps vs your ${formatInt(stepTarget)} target`}
              headline={stepVals.length ? formatInt(average(stepVals)) : undefined}
              headlineNote={stepVals.length ? `avg · ${onTarget} of ${stepVals.length} days on target` : undefined}
              empty={!stepVals.length}
              emptyText="No steps in this period."
              dimmed={dimmed}
            >
              <BarChart
                points={steps}
                tone="energy"
                format={(v) => `${formatInt(v)} steps`}
                label={`Daily steps, last ${range} days`}
                reference={{ value: stepTarget, label: `Target ${compact(stepTarget)}` }}
                unitNote={(v) => (v >= stepTarget ? 'Target reached' : `${formatInt(stepTarget - v)} short of target`)}
              />
            </ChartCard>

            <ChartCard
              index={1}
              title="Sleep"
              subtitle="Hours asleep, credited to the morning you woke up"
              headline={sleepVals.length ? formatSleep(average(sleepVals) * 60) : undefined}
              headlineNote={sleepVals.length ? `avg over ${sleepVals.length} nights` : undefined}
              empty={!sleepVals.length}
              emptyText="No sleep in this period."
              dimmed={dimmed}
            >
              <BarChart
                points={sleepHours}
                tone="violet"
                format={(v) => formatSleep(v * 60)}
                label={`Hours of sleep, last ${range} days`}
                reference={{ value: SLEEP_GUIDE_HOURS, label: `${SLEEP_GUIDE_HOURS} h` }}
                unitNote={(v) => (v >= SLEEP_GUIDE_HOURS ? '7 h or more' : `${formatSleep((SLEEP_GUIDE_HOURS - v) * 60)} under 7 h`)}
                yFormat={(v) => `${v}h`}
              />
            </ChartCard>

            <ChartCard
              index={2}
              title="Resting heart rate"
              subtitle="Beats per minute at rest"
              headline={restingVals.length ? `${Math.round(average(restingVals))} bpm` : undefined}
              headlineNote={restingVals.length ? 'average' : undefined}
              empty={!restingVals.length}
              emptyText="No resting heart rate in this period. It usually comes from a watch or fitness band."
              dimmed={dimmed}
            >
              <LineChart points={resting} tone="coral" format={(v) => `${Math.round(v)} bpm`} label={`Resting heart rate, last ${range} days`} minSpan={6} />
            </ChartCard>

            <ChartCard
              index={3}
              title="Weight"
              subtitle="Latest reading each day, in kg"
              headline={weightPts.length ? `${formatKg(weightPts[weightPts.length - 1].value)} kg` : undefined}
              headlineNote={
                weightPts.length > 1
                  ? `${weightDelta >= 0 ? '+' : '−'}${formatKg(Math.abs(weightDelta))} kg since ${formatDay(weightPts[0].date)}`
                  : undefined
              }
              empty={!weightPts.length}
              emptyText="No weigh-ins in this period."
              dimmed={dimmed}
            >
              <LineChart points={weight} tone="cyan" format={(v) => `${formatKg(v)} kg`} label={`Weight, last ${range} days`} minSpan={2} />
            </ChartCard>

            <SourcesCard data={data} range={range} />
          </>
        ) : null}

        <Animated.View entering={reduce ? undefined : FadeIn.delay(200)}>
          <PrivacyNote />
        </Animated.View>
      </View>
    </Screen>
  );
}

function LoadingBody() {
  return (
    <View style={styles.stack} accessibilityLabel="Loading your health data">
      <StatTilesSkeleton />
      <Skeleton width={140} height={26} />
      {[0, 1].map((i) => (
        <GlassCard key={i} padding={spacing.lg} style={styles.chartSkeleton}>
          <Skeleton width="40%" height={20} />
          <Skeleton width="70%" height={12} />
          <Skeleton height={150} radius={radii.sm} />
        </GlassCard>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.lg },
  flex: { flex: 1 },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  trendsHead: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  staleBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: 'rgba(176,106,0,0.2)',
    backgroundColor: colors.warningBg,
  },
  chartSkeleton: { gap: spacing.sm },
});
