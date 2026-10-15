/** Month calendar in a bottom sheet — pick any past day (days after `max` are disabled). Weeks start on Monday. */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';

import { haptics } from '@/lib/haptics';
import { colors, spacing } from '@/theme';
import { Button, IconButton, Sheet, Text } from '@/ui';

import { longDate, monthTitle } from './format';

const WEEK = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const WEEK_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const pad = (n: number) => String(n).padStart(2, '0');
const ym = (date: string) => ({ y: Number(date.slice(0, 4)), m: Number(date.slice(5, 7)) });

export function CalendarSheet({
  visible,
  onClose,
  value,
  max,
  onSelect,
  title = 'Pick a date',
}: {
  visible: boolean;
  onClose: () => void;
  value: string;
  max: string;
  onSelect: (date: string) => void;
  title?: string;
}) {
  const reduce = useReducedMotion();
  const [month, setMonth] = useState(() => ym(value));
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setMonth(ym(value));
  }

  const maxYm = ym(max);
  const atMax = month.y > maxYm.y || (month.y === maxYm.y && month.m >= maxYm.m);
  const shift = (d: number) => {
    haptics.select();
    setMonth((c) => {
      const t = new Date(Date.UTC(c.y, c.m - 1 + d, 1));
      return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1 };
    });
  };

  const daysIn = new Date(Date.UTC(month.y, month.m, 0)).getUTCDate();
  const lead = (new Date(Date.UTC(month.y, month.m - 1, 1)).getUTCDay() + 6) % 7; // Monday first
  const cells: (string | null)[] = [...Array.from({ length: lead }, () => null), ...Array.from({ length: daysIn }, (_, i) => `${month.y}-${pad(month.m)}-${pad(i + 1)}`)];
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      eyebrow="Reports"
      title={title}
      footer={
        value !== max ? (
          <Button
            label="Back to today"
            variant="secondary"
            icon="rotate-ccw"
            block
            onPress={() => {
              onSelect(max);
              onClose();
            }}
          />
        ) : undefined
      }
    >
      <View style={styles.head}>
        <IconButton icon="chevron-left" accessibilityLabel="Previous month" size={40} iconSize={18} onPress={() => shift(-1)} haptic="none" />
        <Text variant="h3" accessibilityRole="header" accessibilityLiveRegion="polite">
          {monthTitle(month.y, month.m)}
        </Text>
        <IconButton icon="chevron-right" accessibilityLabel="Next month" size={40} iconSize={18} disabled={atMax} onPress={() => shift(1)} haptic="none" />
      </View>

      <View style={styles.row}>
        {WEEK.map((d, i) => (
          <View key={WEEK_LONG[i]} style={styles.cell} accessibilityElementsHidden importantForAccessibility="no">
            <Text variant="eyebrow" tone="subtle">
              {d}
            </Text>
          </View>
        ))}
      </View>

      <Animated.View key={`${month.y}-${month.m}`} entering={reduce ? undefined : FadeIn.duration(180)}>
        {weeks.map((w, wi) => (
          <View key={wi} style={styles.row}>
            {w.map((date, di) => {
              if (!date) return <View key={`e${di}`} style={styles.cell} />;
              const disabled = date > max;
              const selected = date === value;
              const isToday = date === max;
              return (
                <View key={date} style={styles.cell}>
                  <Pressable
                    disabled={disabled}
                    onPress={() => {
                      haptics.select();
                      onSelect(date);
                      onClose();
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`${longDate(date)}${isToday ? ', today' : ''}`}
                    accessibilityState={{ selected, disabled }}
                    style={({ pressed }) => [styles.day, isToday && styles.today, selected && styles.selected, pressed && !selected && styles.pressed]}
                  >
                    <Text variant="label" weight={selected || isToday ? 'semibold' : 'medium'} color={selected ? colors.white : disabled ? 'rgba(20,20,20,0.25)' : colors.ink} style={styles.num}>
                      {Number(date.slice(8))}
                    </Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        ))}
      </Animated.View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  row: { flexDirection: 'row' },
  cell: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 3 },
  day: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  today: { borderWidth: 1.5, borderColor: colors.coral },
  selected: { backgroundColor: colors.ink, borderColor: colors.ink },
  pressed: { backgroundColor: colors.canvas2 },
  num: { fontVariant: ['tabular-nums'] },
});
