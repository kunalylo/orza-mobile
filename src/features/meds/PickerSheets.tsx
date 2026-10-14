/**
 * Dependable time + date pickers in the shared bottom Sheet (no native module): big serif readout, tap grids,
 * 44 pt targets, screen-reader labels and selection haptics.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { haptics } from '@/lib/haptics';
import { colors, fonts, radii, spacing } from '@/theme';
import { Button, IconButton, PressableScale, Segmented, Sheet, Text } from '@/ui';

import { addDaysISO, formatDateLong, formatTime12, isHHMM, isISODate, MONTHS_LONG, WEEKDAY_ORDER, WEEKDAYS } from './shared';

const pad = (n: number) => String(n).padStart(2, '0');

/** Re-seed local draft state each time a sheet opens (state adjusted during render, no effect). */
function useDraftOnOpen<T>(visible: boolean, initial: () => T): [T, (v: T) => void] {
  const [draft, setDraft] = useState<T>(initial);
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setDraft(initial());
  }
  return [draft, setDraft];
}

function Cell({ label, selected, disabled, onPress, accessibilityLabel, muted }: { label: string; selected?: boolean; disabled?: boolean; onPress: () => void; accessibilityLabel?: string; muted?: boolean }) {
  return (
    <PressableScale
      haptic="none"
      disabled={disabled}
      onPress={() => {
        haptics.select();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      accessibilityLabel={accessibilityLabel ?? label}
      style={[styles.cell, selected && styles.cellOn, disabled && styles.cellDisabled]}
    >
      <Text variant="label" color={selected ? colors.inverse : muted ? colors.subtle : colors.ink} style={styles.cellText}>
        {label}
      </Text>
    </PressableScale>
  );
}

/* ───────────────────────────── Time ───────────────────────────── */

export function TimePickerSheet({
  visible,
  value,
  title = 'Alarm time',
  onClose,
  onSubmit,
}: {
  visible: boolean;
  value: string;
  title?: string;
  onClose: () => void;
  onSubmit: (hhmm: string) => void;
}) {
  const parse = () => {
    const [h, m] = (isHHMM(value) ? value : '08:00').split(':').map(Number);
    return { h12: h % 12 === 0 ? 12 : h % 12, m, pm: h >= 12 };
  };
  const [draft, setDraft] = useDraftOnOpen(visible, parse);
  const h24 = (draft.h12 % 12) + (draft.pm ? 12 : 0);
  const hhmm = `${pad(h24)}:${pad(draft.m)}`;
  const minutes = Array.from({ length: 12 }, (_, i) => i * 5);
  if (!minutes.includes(draft.m)) minutes.push(draft.m);
  minutes.sort((a, b) => a - b);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      eyebrow="Schedule"
      title={title}
      footer={
        <Button
          label={`Set ${formatTime12(hhmm)}`}
          variant="primary"
          size="lg"
          block
          onPress={() => {
            onSubmit(hhmm);
            onClose();
          }}
        />
      }
    >
      <View style={styles.readout} accessible accessibilityLabel={`Selected time ${formatTime12(hhmm)}`}>
        <Text style={styles.big}>
          {draft.h12}:{pad(draft.m)}
        </Text>
        <Text variant="eyebrow" tone="subtle">
          {draft.pm ? 'pm' : 'am'}
        </Text>
      </View>
      <Segmented
        accessibilityLabel="Morning or afternoon"
        value={draft.pm ? 'pm' : 'am'}
        onChange={(v) => setDraft({ ...draft, pm: v === 'pm' })}
        options={[
          { value: 'am', label: 'AM · morning' },
          { value: 'pm', label: 'PM · afternoon / night' },
        ]}
      />
      <Text variant="eyebrow" tone="subtle" style={styles.gridLabel}>
        Hour
      </Text>
      <View style={styles.grid}>
        {[12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((h) => (
          <Cell key={h} label={String(h)} selected={draft.h12 === h} onPress={() => setDraft({ ...draft, h12: h })} accessibilityLabel={`${h} o'clock`} />
        ))}
      </View>
      <Text variant="eyebrow" tone="subtle" style={styles.gridLabel}>
        Minute
      </Text>
      <View style={styles.grid}>
        {minutes.map((m) => (
          <Cell key={m} label={`:${pad(m)}`} selected={draft.m === m} onPress={() => setDraft({ ...draft, m })} accessibilityLabel={`${m} minutes`} />
        ))}
      </View>
    </Sheet>
  );
}

/* ───────────────────────────── Date ───────────────────────────── */

function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function shiftMonth(first: string, delta: number): string {
  const [y, m] = first.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-01`;
}

function daysInMonth(first: string): number {
  const [y, m] = first.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function DatePickerSheet({
  visible,
  value,
  today,
  min,
  title = 'Choose a date',
  onClose,
  onSubmit,
}: {
  visible: boolean;
  value: string;
  today: string;
  min?: string;
  title?: string;
  onClose: () => void;
  onSubmit: (date: string) => void;
}) {
  const initial = () => {
    const selected = isISODate(value) ? value : min && min > today ? min : today;
    return { selected, month: monthStart(selected) };
  };
  const [draft, setDraft] = useDraftOnOpen(visible, initial);
  const first = draft.month;
  const [year, month] = first.split('-').map(Number);
  const lead = WEEKDAY_ORDER.indexOf(new Date(Date.UTC(year, month - 1, 1)).getUTCDay());
  const total = daysInMonth(first);
  const cells: (string | null)[] = [...Array.from({ length: lead }, () => null), ...Array.from({ length: total }, (_, i) => addDaysISO(first, i))];
  while (cells.length % 7) cells.push(null);
  const canGoBack = !min || shiftMonth(first, -1) >= monthStart(min);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      eyebrow="Schedule"
      title={title}
      footer={
        <Button
          label="Set date"
          variant="primary"
          size="lg"
          block
          onPress={() => {
            onSubmit(draft.selected);
            onClose();
          }}
        />
      }
    >
      <Text variant="title" align="center" style={styles.dateReadout} accessibilityLiveRegion="polite">
        {formatDateLong(draft.selected)}
      </Text>
      <View style={styles.monthBar}>
        <IconButton icon="chevron-left" accessibilityLabel="Previous month" disabled={!canGoBack} onPress={() => setDraft({ ...draft, month: shiftMonth(first, -1) })} size={40} />
        <Text variant="h3" accessibilityRole="header">
          {MONTHS_LONG[month - 1]} {year}
        </Text>
        <IconButton icon="chevron-right" accessibilityLabel="Next month" onPress={() => setDraft({ ...draft, month: shiftMonth(first, 1) })} size={40} />
      </View>
      <View style={styles.week}>
        {WEEKDAY_ORDER.map((d) => (
          <Text key={d} variant="eyebrow" tone="subtle" align="center" style={styles.weekDay}>
            {WEEKDAYS[d].slice(0, 2)}
          </Text>
        ))}
      </View>
      <View style={styles.calendar}>
        {cells.map((date, i) =>
          date ? (
            <View key={date} style={styles.dayWrap}>
              <PressableScale
                haptic="none"
                disabled={!!min && date < min}
                onPress={() => {
                  haptics.select();
                  setDraft({ ...draft, selected: date });
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: draft.selected === date, disabled: !!min && date < min }}
                accessibilityLabel={`${formatDateLong(date)}${date === today ? ', today' : ''}`}
                style={[styles.dayCell, date === today && styles.dayToday, draft.selected === date && styles.cellOn, !!min && date < min && styles.cellDisabled]}
              >
                <Text variant="label" color={draft.selected === date ? colors.inverse : colors.ink}>
                  {Number(date.slice(8))}
                </Text>
              </PressableScale>
            </View>
          ) : (
            <View key={`blank-${i}`} style={styles.dayWrap} />
          )
        )}
      </View>
      <View style={styles.quick}>
        <Button
          label="Today"
          variant="ghost"
          size="sm"
          disabled={!!min && today < min}
          onPress={() => setDraft({ selected: today, month: monthStart(today) })}
        />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  readout: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: spacing.sm, marginBottom: spacing.lg },
  big: { fontFamily: fonts.display, fontSize: 48, lineHeight: 56, color: colors.ink, fontVariant: ['tabular-nums'] },
  gridLabel: { marginTop: spacing.xl, marginBottom: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  cell: {
    width: '14.5%',
    flexGrow: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.glassStrong,
  },
  cellOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  cellDisabled: { opacity: 0.35 },
  cellText: { fontVariant: ['tabular-nums'] },
  dateReadout: { marginBottom: spacing.md },
  monthBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  week: { flexDirection: 'row', marginBottom: spacing.xs },
  weekDay: { flex: 1 },
  calendar: { flexDirection: 'row', flexWrap: 'wrap' },
  dayWrap: { width: `${100 / 7}%`, padding: 2 },
  dayCell: { minHeight: 44, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center' },
  dayToday: { borderWidth: 1, borderColor: colors.cyan },
  quick: { flexDirection: 'row', justifyContent: 'center', marginTop: spacing.sm },
});
