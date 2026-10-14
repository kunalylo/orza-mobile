import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { haptics } from '@/lib/haptics';
import { colors, diagonal, gradients, radii, shadows, spacing } from '@/theme';
import { Button, Icon, IconButton, Sheet, Text } from '@/ui';

import { MONTHS_LONG, addDays, formatDayLabel } from './utils';

/** Glass pill: ‹ day label (opens a month calendar) › plus a "Today" jump. Never goes past `today`. */
export function DateNavigator({ date, today, onChange }: { date: string; today: string; onChange: (date: string) => void }) {
  const [picking, setPicking] = useState(false);
  const label = formatDayLabel(date, today);
  const atToday = date >= today;

  const go = (next: string) => {
    if (next > today) return;
    haptics.select();
    onChange(next);
  };

  return (
    <View style={styles.row}>
      <View style={styles.pill}>
        <IconButton icon="chevron-left" variant="plain" size={36} iconSize={18} accessibilityLabel="Previous day" onPress={() => go(addDays(date, -1))} haptic="none" />
        <Pressable
          onPress={() => setPicking(true)}
          accessibilityRole="button"
          accessibilityLabel={`Choose a date. Showing ${label}`}
          hitSlop={4}
          style={({ pressed }) => [styles.labelBtn, pressed && styles.pressed]}
        >
          <Icon name="calendar" size={14} color={colors.coral} />
          <Animated.View key={date} entering={FadeIn.duration(180)}>
            <Text variant="label" tone="ink" numberOfLines={1}>
              {label}
            </Text>
          </Animated.View>
        </Pressable>
        <IconButton
          icon="chevron-right"
          variant="plain"
          size={36}
          iconSize={18}
          accessibilityLabel="Next day"
          disabled={atToday}
          onPress={() => go(addDays(date, 1))}
          haptic="none"
        />
      </View>
      {!atToday ? (
        <Animated.View entering={FadeIn.duration(200)}>
          <Button label="Today" variant="ghost" size="sm" onPress={() => go(today)} haptic="none" accessibilityLabel="Jump to today" />
        </Animated.View>
      ) : null}
      <CalendarSheet
        visible={picking}
        value={date}
        today={today}
        onClose={() => setPicking(false)}
        onPick={(d) => {
          setPicking(false);
          go(d);
        }}
      />
    </View>
  );
}

/* ───────────────────────────── Month calendar ───────────────────────────── */

const WEEK_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const WEEK_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad = (n: number) => String(n).padStart(2, '0');

function monthOf(date: string) {
  const [y, m] = date.split('-').map(Number);
  return { y, m };
}

function CalendarSheet({
  visible,
  value,
  today,
  onClose,
  onPick,
}: {
  visible: boolean;
  value: string;
  today: string;
  onClose: () => void;
  onPick: (date: string) => void;
}) {
  const [view, setView] = useState(() => monthOf(value));
  const [shownFor, setShownFor] = useState(value);
  // Re-centre on the selected day each time the sheet opens for a different day.
  if (visible && shownFor !== value) {
    setShownFor(value);
    setView(monthOf(value));
  }

  const max = monthOf(today);
  const atMax = view.y > max.y || (view.y === max.y && view.m >= max.m);
  const atMin = view.y <= 2000 && view.m <= 1;
  const first = new Date(Date.UTC(view.y, view.m - 1, 1));
  const lead = first.getUTCDay();
  const days = new Date(Date.UTC(view.y, view.m, 0)).getUTCDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(`${view.y}-${pad(view.m)}-${pad(d)}`);
  while (cells.length % 7) cells.push(null);

  const shift = (delta: number) => {
    haptics.select();
    setView((v) => {
      const t = new Date(Date.UTC(v.y, v.m - 1 + delta, 1));
      return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1 };
    });
  };

  return (
    <Sheet visible={visible} onClose={onClose} eyebrow="Meal log" title="Pick a day">
      <View style={styles.monthRow}>
        <IconButton icon="chevron-left" variant="glass" size={38} accessibilityLabel="Previous month" disabled={atMin} onPress={() => shift(-1)} haptic="none" />
        <Text variant="h3" tone="ink" accessibilityRole="header">
          {MONTHS_LONG[view.m - 1]} {view.y}
        </Text>
        <IconButton icon="chevron-right" variant="glass" size={38} accessibilityLabel="Next month" disabled={atMax} onPress={() => shift(1)} haptic="none" />
      </View>
      <View style={styles.grid}>
        {WEEK_LETTERS.map((w, i) => (
          <View key={`w${i}`} style={styles.cell} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Text variant="eyebrow" tone="subtle">
              {w}
            </Text>
          </View>
        ))}
        {cells.map((d, i) => {
          if (!d) return <View key={`e${i}`} style={styles.cell} />;
          const future = d > today;
          const selected = d === value;
          const isToday = d === today;
          const dayNum = Number(d.slice(8));
          const weekday = WEEK_NAMES[new Date(`${d}T00:00:00Z`).getUTCDay()];
          return (
            <View key={d} style={styles.cell}>
              <Pressable
                disabled={future}
                onPress={() => onPick(d)}
                accessibilityRole="button"
                accessibilityState={{ selected, disabled: future }}
                accessibilityLabel={`${weekday} ${dayNum} ${MONTHS_LONG[view.m - 1]}${isToday ? ', today' : ''}`}
                style={({ pressed }) => [styles.day, isToday && !selected && styles.dayToday, pressed && styles.pressed, future && styles.dayFuture]}
              >
                {selected ? (
                  <LinearGradient colors={gradients.energy} start={diagonal.start} end={diagonal.end} style={[StyleSheet.absoluteFill, styles.dayFill]} />
                ) : null}
                <Text variant="label" weight={selected || isToday ? 'bold' : 'medium'} color={selected ? colors.white : future ? colors.subtle : colors.ink}>
                  {dayNum}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>
      <Text variant="caption" tone="subtle" align="center" style={styles.note}>
        You can look back at any day — new meals are added to the day you pick.
      </Text>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairlineStrong,
    backgroundColor: colors.glassStrong,
    padding: 2,
    ...shadows.soft,
  },
  labelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 128,
    height: 36,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
  },
  pressed: { opacity: 0.6 },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, maxHeight: 48, alignItems: 'center', justifyContent: 'center' },
  day: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  dayFill: { borderRadius: 20 },
  dayToday: { borderWidth: 1.5, borderColor: colors.coral },
  dayFuture: { opacity: 0.35 },
  note: { marginTop: spacing.md },
});
