/**
 * Monday-first month grid: today ringed in coral, the selected day filled ink, coloured dots per source
 * (medicines, reminders, meals, your calendar) and a violet bar on packed days. Swipe left / right to change month.
 */
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';

import { haptics } from '@/lib/haptics';
import { colors, radii, spacing } from '@/theme';
import { PressableScale, Skeleton, Text } from '@/ui';

import { KIND_COLOR, KIND_LABEL, type CalendarEvent } from './types';
import { formatLongDate, kindsOf, WEEKDAYS_MON_FIRST } from './utils';

export interface MonthGridProps {
  month: string;
  dates: string[];
  today: string;
  selected: string;
  byDate: Map<string, CalendarEvent[]>;
  /** Local dates with ≥ 4 h booked in the user's own calendar. */
  busyDates: Set<string>;
  loading: boolean;
  onSelect: (date: string) => void;
  onSwipe: (delta: 1 | -1) => void;
}

function describeDay(date: string, events: CalendarEvent[] | undefined, today: string, selected: boolean, busy: boolean): string {
  const counts = new Map<string, number>();
  for (const e of events ?? []) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  const bits = [...counts.entries()].map(([k, n]) => `${n} ${KIND_LABEL[k as CalendarEvent['kind']].toLowerCase()}`);
  return [formatLongDate(date), date === today ? 'today' : '', bits.length ? bits.join(', ') : 'nothing scheduled', busy ? 'busy day' : '', selected ? 'selected' : '']
    .filter(Boolean)
    .join(', ');
}

export function MonthGrid({ month, dates, today, selected, byDate, busyDates, loading, onSelect, onSwipe }: MonthGridProps) {
  const reduceMotion = useReducedMotion();
  const swipe = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-24, 24])
    .failOffsetY([-14, 14])
    .onEnd((e) => {
      if (Math.abs(e.translationX) < 50 && Math.abs(e.velocityX) < 400) return;
      haptics.select();
      onSwipe(e.translationX < 0 ? 1 : -1);
    });

  const weeks: string[][] = [];
  for (let i = 0; i < dates.length; i += 7) weeks.push(dates.slice(i, i + 7));

  return (
    <GestureDetector gesture={swipe}>
      <View>
        <View style={styles.weekRow} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          {WEEKDAYS_MON_FIRST.map((d) => (
            <Text key={d} variant="eyebrow" tone="subtle" align="center" style={styles.weekday}>
              {d.slice(0, 1)}
            </Text>
          ))}
        </View>
        <Animated.View key={month} entering={reduceMotion ? undefined : FadeIn.duration(220)} style={styles.grid}>
          {weeks.map((week) => (
            <View key={week[0]} style={styles.weekRow}>
              {week.map((date) => {
                const inMonth = date.startsWith(month);
                const isToday = date === today;
                const isSelected = date === selected;
                const events = byDate.get(date);
                const kinds = kindsOf(events);
                const busy = busyDates.has(date);
                return (
                  <PressableScale
                    key={date}
                    haptic="none"
                    scaleTo={0.92}
                    onPress={() => {
                      haptics.select();
                      onSelect(date);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    accessibilityLabel={describeDay(date, events, today, isSelected, busy)}
                    style={styles.cell}
                  >
                    <View style={[styles.num, isToday && styles.today, isSelected && styles.selected]}>
                      <Text
                        variant="label"
                        align="center"
                        color={isSelected ? colors.inverse : isToday ? colors.energyInk : inMonth ? colors.ink : colors.subtle}
                        style={!inMonth && !isSelected ? styles.outside : undefined}
                      >
                        {Number(date.slice(8, 10))}
                      </Text>
                    </View>
                    <View style={styles.dots}>
                      {loading && !events ? (
                        <Skeleton width={14} height={4} radius={2} />
                      ) : (
                        kinds.slice(0, 4).map((k) => <View key={k} style={[styles.dot, { backgroundColor: KIND_COLOR[k] }, !inMonth && styles.outside]} />)
                      )}
                    </View>
                    {busy ? <View style={styles.busy} /> : null}
                  </PressableScale>
                );
              })}
            </View>
          ))}
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  grid: { gap: 2 },
  weekRow: { flexDirection: 'row' },
  weekday: { flex: 1, paddingBottom: spacing.sm },
  cell: { flex: 1, alignItems: 'center', paddingVertical: 4, minHeight: 50 },
  num: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  today: { borderWidth: 1.5, borderColor: colors.coral, backgroundColor: colors.energyBg },
  selected: { backgroundColor: colors.ink, borderColor: colors.ink },
  outside: { opacity: 0.45 },
  dots: { flexDirection: 'row', gap: 3, height: 6, marginTop: 3, alignItems: 'center' },
  dot: { width: 5, height: 5, borderRadius: 3 },
  busy: { position: 'absolute', top: 2, right: '18%', width: 6, height: 6, borderRadius: radii.pill, backgroundColor: colors.violet },
});
