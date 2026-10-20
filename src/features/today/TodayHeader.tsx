/**
 * Today header: date eyebrow, greeting (or "Yesterday, at a glance"), streak, the day navigator and a 7-day strip
 * (warm bars = calories vs target) that doubles as quick date navigation.
 */
import { LinearGradient } from 'expo-linear-gradient';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';

import { haptics } from '@/lib/haptics';
import { colors, gradients, radii, spacing } from '@/theme';
import { Icon, Orb, PressableScale, Skeleton, Tag, Text } from '@/ui';

import { DateNavigator } from '@/features/meals/DateNavigator';
import { addDays, formatNumber } from '@/features/meals/utils';

import { dayOfMonth, formatLong, greetingFor, relativeDay, weekdayLong, weekdayShort } from './format';
import type { WeekDay } from './types';

export function TodayHeader({
  name,
  date,
  today,
  hour,
  streak,
  busy,
  onDateChange,
}: {
  name: string;
  date: string;
  today: string;
  hour: number;
  /** null while loading. */
  streak: number | null;
  busy?: boolean;
  onDateChange: (date: string) => void;
}) {
  const reduce = useReducedMotion();
  const isToday = date === today;
  const isYesterday = date === addDays(today, -1);

  return (
    <View style={styles.header}>
      <View style={styles.orb} pointerEvents="none">
        <Orb size={150} tone="light" orbits={false} paused={reduce} />
      </View>
      <Text variant="eyebrow" tone="subtle" numberOfLines={1}>
        {isToday ? 'Today' : 'Looking back'} · {formatLong(date)}
      </Text>
      <Animated.View key={`${date}-${isToday}`} entering={reduce ? undefined : FadeIn.duration(260)}>
        <Text variant="h1" tone="ink" style={styles.title} accessibilityRole="header">
          {isToday ? (
            <>
              {greetingFor(hour)},{' '}
              <Text variant="h1" italic tone="ink">
                {name}
              </Text>
              .
            </>
          ) : (
            <>
              {isYesterday ? 'Yesterday' : weekdayLong(date)},{' '}
              <Text variant="h1" italic tone="muted">
                at a glance
              </Text>
              .
            </>
          )}
        </Text>
      </Animated.View>
      <View style={styles.metaRow}>
        <StreakTag streak={streak} />
        <Text variant="small" tone="muted" style={styles.flexShrink}>
          {isToday ? "Here's your wellness snapshot for today." : 'A calm look back at what you logged.'}
        </Text>
      </View>
      <View style={styles.navRow}>
        <DateNavigator date={date} today={today} onChange={onDateChange} />
        {busy ? (
          <Animated.View entering={FadeIn.duration(160)}>
            <ActivityIndicator size="small" color={colors.coral} accessibilityLabel="Loading this day" />
          </Animated.View>
        ) : null}
      </View>
    </View>
  );
}

function StreakTag({ streak }: { streak: number | null }) {
  if (streak == null) return <Skeleton height={26} width={120} radius={radii.pill} />;
  if (streak <= 0) return <Tag tone="neutral" label="Log a meal to start a streak" />;
  return (
    <View style={styles.streak} accessible accessibilityLabel={`${streak}-day streak`}>
      <LinearGradient colors={gradients.energy} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <Icon name="mci:fire" size={14} color={colors.white} />
      <Text variant="label" color={colors.white}>
        {streak}-day streak
      </Text>
    </View>
  );
}

/** Seven-day strip — warm heat = calories vs target. */
export function WeekStrip({ week, date, today, target, onSelect }: { week: WeekDay[]; date: string; today: string; target: number; onSelect: (date: string) => void }) {
  const reduce = useReducedMotion();
  if (!week.length) return null;
  return (
    <View style={styles.week}>
      <View style={styles.weekHead}>
        <Text variant="eyebrow" tone="subtle" style={styles.weekEyebrow}>
          Your week
        </Text>
        <Text variant="caption" tone="subtle" numberOfLines={1} style={styles.flexShrink}>
          Warm bars = calories vs your target
        </Text>
      </View>
      <View style={styles.weekRow}>
        {week.map((d, i) => {
          const heat = target > 0 ? Math.min(1, d.calories / target) : 0;
          const selected = d.date === date;
          const isToday = d.date === today;
          const label = `${relativeDay(d.date, today)}: ${d.meals ? `${formatNumber(d.calories)} kcal across ${d.meals} meal${d.meals === 1 ? '' : 's'}` : 'nothing logged'}`;
          return (
            <Animated.View key={d.date} entering={reduce ? undefined : FadeInDown.delay(30 * i).springify().damping(18).stiffness(100).mass(1)} style={styles.dayWrap}>
              <PressableScale
                onPress={() => {
                  if (d.date === date || d.date > today) return;
                  haptics.select();
                  onSelect(d.date);
                }}
                haptic="none"
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityState={{ selected }}
                style={[styles.day, selected && styles.daySelected]}
              >
                <LinearGradient
                  pointerEvents="none"
                  colors={[`rgba(255,180,84,${(heat * 0.18).toFixed(3)})`, `rgba(255,95,162,${(heat * 0.12).toFixed(3)})`]}
                  style={StyleSheet.absoluteFill}
                />
                <Text variant="eyebrow" style={styles.dayName} color={isToday ? colors.energyInk : colors.muted}>
                  {weekdayShort(d.date)}
                </Text>
                <Text variant="h3" tone="ink" style={[styles.dayNum, !selected && styles.dayNumDim]}>
                  {dayOfMonth(d.date)}
                </Text>
                <View style={styles.heatTrack}>
                  {heat > 0 ? <LinearGradient colors={gradients.energy} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.heatFill, { width: `${Math.round(heat * 100)}%` }]} /> : null}
                </View>
              </PressableScale>
            </Animated.View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flexShrink: { flexShrink: 1 },
  header: { paddingTop: spacing.lg, marginBottom: spacing.lg },
  orb: { position: 'absolute', top: -56, right: -70, opacity: 0.8 },
  title: { marginTop: spacing.sm },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.lg },
  streak: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radii.pill,
    overflow: 'hidden',
    boxShadow: '0px 6px 16px rgba(255,122,106,0.28)',
  },
  week: {
    padding: spacing.sm,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    backgroundColor: colors.glassSubtle,
  },
  weekHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingHorizontal: spacing.xs, marginBottom: spacing.sm },
  weekEyebrow: { fontSize: 10 },
  weekRow: { flexDirection: 'row', gap: 6 },
  dayWrap: { flex: 1, minWidth: 0 },
  day: {
    height: 74,
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    paddingHorizontal: 2,
    borderRadius: radii.sm,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  daySelected: { borderColor: 'rgba(11,190,220,0.45)', backgroundColor: 'rgba(255,255,255,0.92)', boxShadow: '0px 8px 20px rgba(20,20,20,0.08)' },
  dayName: { fontSize: 9.5, letterSpacing: 1 },
  dayNum: { marginTop: 4, fontVariant: ['tabular-nums'] },
  dayNumDim: { opacity: 0.75 },
  heatTrack: { marginTop: 'auto', height: 4, width: '80%', borderRadius: 2, backgroundColor: colors.divider, overflow: 'hidden' },
  heatFill: { height: '100%', borderRadius: 2 },
});
