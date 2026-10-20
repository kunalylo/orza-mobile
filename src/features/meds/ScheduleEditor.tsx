/**
 * Schedule editor (ported from the web): quick Indian patterns, alarm times with a time picker, repeat (every day /
 * some days / alternate days), start date, and ongoing / for N days / until a date — with a live summary.
 */
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { haptics } from '@/lib/haptics';
import { colors, fonts, radii, spacing } from '@/theme';
import { Chip, Icon, IconButton, PressableScale, Segmented, Text } from '@/ui';

import { DatePickerSheet, TimePickerSheet } from './PickerSheets';
import { activeQuickPattern, nextTime, QUICK_PATTERNS, scheduleFromDraft, type ScheduleDraft } from './schedule';
import { addDaysISO, formatDateShort, formatTime12, MAX_TIMES, scheduleSummary, WEEKDAY_ORDER, WEEKDAYS, WEEKDAYS_LONG } from './shared';

/** − [n] + with a typed value (kept as a string so the field can be cleared while typing). */
export function Stepper({ value, onChange, min, max, label, unit }: { value: string; onChange: (v: string) => void; min: number; max: number; label: string; unit?: string }) {
  const n = Number(value);
  const valid = Number.isInteger(n) && value !== '';
  const step = (d: number) => {
    const next = Math.min(max, Math.max(min, (valid ? n : min) + d));
    haptics.select();
    onChange(String(next));
  };
  return (
    <View style={styles.stepper}>
      <IconButton icon="minus" accessibilityLabel={`Fewer ${unit ?? ''}`.trim()} size={40} disabled={valid && n <= min} onPress={() => step(-1)} />
      <TextInput
        value={value}
        onChangeText={(t) => onChange(t.replace(/[^0-9]/g, '').slice(0, 3))}
        keyboardType="number-pad"
        inputMode="numeric"
        maxLength={3}
        accessibilityLabel={label}
        style={styles.stepperInput}
        selectTextOnFocus
      />
      <IconButton icon="plus" accessibilityLabel={`More ${unit ?? ''}`.trim()} size={40} disabled={valid && n >= max} onPress={() => step(1)} />
      {unit ? (
        <Text variant="small" tone="muted">
          {unit}
        </Text>
      ) : null}
    </View>
  );
}

/** A tappable field that shows a value and opens a picker. */
export function PickerField({ label, value, icon, onPress, accessibilityLabel }: { label: string; value: string; icon: 'calendar' | 'clock'; onPress: () => void; accessibilityLabel?: string }) {
  return (
    <View style={styles.fieldWrap}>
      <Text variant="label" style={styles.fieldLabel}>
        {label}
      </Text>
      <PressableScale haptic="soft" onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? `${label}: ${value}`} accessibilityHint="Opens a picker" style={styles.field}>
        <Icon name={icon} size={17} color={colors.muted} />
        <Text variant="callout" style={styles.flex} numberOfLines={1}>
          {value}
        </Text>
        <Icon name="chevron-down" size={17} color={colors.subtle} />
      </PressableScale>
    </View>
  );
}

export function ScheduleEditor({ value, onChange, today, error }: { value: ScheduleDraft; onChange: (d: ScheduleDraft) => void; today: string; error?: string | null }) {
  const d = value;
  const set = (patch: Partial<ScheduleDraft>) => onChange({ ...d, ...patch });
  const [timeIndex, setTimeIndex] = useState<number | null>(null); // -1 = adding a new time
  const [datePicker, setDatePicker] = useState<'start' | 'end' | null>(null);
  const activeQuick = activeQuickPattern(d);
  const preview = scheduleFromDraft(d);
  const year = Number(today.slice(0, 4));
  const lastDay = d.end_mode === 'days' && Number(d.duration_days) >= 1 ? addDaysISO(d.start_date, Number(d.duration_days) - 1) : null;
  const editingTime = timeIndex == null ? '08:00' : timeIndex === -1 ? nextTime(d.times) : d.times[timeIndex] ?? '08:00';

  return (
    <View style={styles.wrap}>
      {/* Quick patterns */}
      <View>
        <Text variant="label" style={styles.label}>
          How often
        </Text>
        <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="How often">
          {QUICK_PATTERNS.map((q) => (
            <Chip
              key={q.key}
              label={q.label}
              size="sm"
              role="radio"
              selected={activeQuick === q.key}
              accessibilityHint={q.hint}
              onPress={() => (q.as_needed ? set({ as_needed: true, times: [] }) : set({ as_needed: false, times: [...(q.times ?? [])] }))}
            />
          ))}
        </View>
        <Text variant="caption" tone="subtle" style={styles.hint}>
          1-0-1 means morning and night; 1-1-1 adds an afternoon dose. You can change any time below.
        </Text>
      </View>

      {/* Times */}
      {d.as_needed ? (
        <Animated.View entering={FadeIn} exiting={FadeOut} style={styles.sos}>
          <Text variant="small" color={colors.cyan700}>
            <Text variant="small" weight="semibold" color={colors.cyan700}>
              Only when needed (SOS).
            </Text>{' '}
            ÖRZA won&apos;t ring for this medicine — it stays in your list for reference.
          </Text>
          <PressableScale
            haptic="soft"
            onPress={() => set({ as_needed: false, times: d.times.length ? d.times : ['08:00'] })}
            accessibilityRole="button"
            style={styles.sosLink}
          >
            <Text variant="small" weight="semibold" color={colors.cyan700} style={styles.underline}>
              Set alarm times instead
            </Text>
          </PressableScale>
        </Animated.View>
      ) : (
        <View>
          <Text variant="label" style={styles.label}>
            Alarm times
          </Text>
          <Animated.View layout={LinearTransition.springify().damping(20).stiffness(100).mass(1)} style={styles.chips}>
            {d.times.map((t, i) => (
              <Animated.View key={`${i}-${t}`} entering={FadeIn.springify()} exiting={FadeOut} style={styles.timePill}>
                <PressableScale haptic="soft" onPress={() => setTimeIndex(i)} accessibilityRole="button" accessibilityLabel={`Alarm time ${i + 1}: ${formatTime12(t)}. Change`} style={styles.timeBtn}>
                  <Icon name="bell" size={14} color={colors.energyInk} />
                  <Text variant="label" style={styles.timeText}>
                    {formatTime12(t)}
                  </Text>
                </PressableScale>
                <IconButton
                  icon="x"
                  variant="plain"
                  size={32}
                  iconSize={14}
                  accessibilityLabel={`Remove alarm time ${i + 1}`}
                  disabled={d.times.length <= 1}
                  onPress={() => set({ times: d.times.filter((_, j) => j !== i) })}
                />
              </Animated.View>
            ))}
            {d.times.length < MAX_TIMES ? (
              <PressableScale haptic="soft" onPress={() => setTimeIndex(-1)} accessibilityRole="button" accessibilityLabel="Add an alarm time" style={styles.addTime}>
                <Icon name="plus" size={15} color={colors.ink} />
                <Text variant="label">Add time</Text>
              </PressableScale>
            ) : null}
          </Animated.View>
        </View>
      )}

      {/* Repeat */}
      {!d.as_needed ? (
        <View>
          <Text variant="label" style={styles.label}>
            Repeat
          </Text>
          <Segmented
            accessibilityLabel="Repeat"
            size="sm"
            value={d.repeat}
            onChange={(v) => set({ repeat: v, days: v === 'weekdays' && !d.days.length ? [1, 2, 3, 4, 5] : d.days })}
            options={[
              { value: 'daily', label: 'Every day' },
              { value: 'weekdays', label: 'Some days' },
              { value: 'interval', label: 'Alternate' },
            ]}
          />
          {d.repeat === 'weekdays' ? (
            <View style={[styles.weekdays, styles.gapTop]} accessibilityLabel="Days of the week">
              {WEEKDAY_ORDER.map((wd) => {
                const on = d.days.includes(wd);
                return (
                  <PressableScale
                    key={wd}
                    haptic="select"
                    onPress={() => set({ days: on ? d.days.filter((x) => x !== wd) : [...d.days, wd] })}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={WEEKDAYS_LONG[wd]}
                    style={[styles.weekday, on && styles.weekdayOn]}
                  >
                    <Text variant="label" color={on ? colors.cyan700 : colors.muted}>
                      {WEEKDAYS[wd].slice(0, 2)}
                    </Text>
                  </PressableScale>
                );
              })}
            </View>
          ) : null}
          {d.repeat === 'interval' ? (
            <View style={styles.gapTop}>
              <View style={styles.inline}>
                <Text variant="small">Every</Text>
                <Stepper value={d.every_n_days} onChange={(v) => set({ every_n_days: v })} min={2} max={90} label="Repeat every how many days" unit="days" />
              </View>
              <Text variant="caption" tone="subtle" style={styles.hint}>
                2 = alternate days, counted from the start date.
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Dates */}
      <PickerField label="Start date" icon="calendar" value={formatDateShort(d.start_date, year)} onPress={() => setDatePicker('start')} />
      <View>
        <Text variant="label" style={styles.label}>
          Ends
        </Text>
        <Segmented
          accessibilityLabel="Ends"
          size="sm"
          value={d.end_mode}
          onChange={(v) => set({ end_mode: v, end_date: v === 'date' && !d.end_date ? addDaysISO(d.start_date || today, 29) : d.end_date })}
          options={[
            { value: 'ongoing', label: 'Ongoing' },
            { value: 'days', label: 'For N days' },
            { value: 'date', label: 'On a date' },
          ]}
        />
        {d.end_mode === 'days' ? (
          <View style={styles.gapTop}>
            <View style={styles.inline}>
              <Text variant="small">For</Text>
              <Stepper value={d.duration_days} onChange={(v) => set({ duration_days: v })} min={1} max={365} label="Course length in days" unit="days" />
            </View>
            {lastDay ? (
              <Text variant="caption" tone="subtle" style={styles.hint}>
                Last dose day {formatDateShort(lastDay, year)}
              </Text>
            ) : null}
          </View>
        ) : null}
        {d.end_mode === 'date' ? (
          <View style={styles.gapTop}>
            <PickerField label="Last day" icon="calendar" value={d.end_date ? formatDateShort(d.end_date, year) : 'Choose a date'} onPress={() => setDatePicker('end')} />
          </View>
        ) : null}
      </View>

      <View style={styles.summary} accessibilityLiveRegion="polite">
        {'schedule' in preview ? (
          <Text variant="small" tone="muted">
            <Text variant="eyebrow" tone="subtle">
              Summary ·{' '}
            </Text>
            {scheduleSummary({ schedule: preview.schedule, as_needed: d.as_needed }, today)}
          </Text>
        ) : (
          <Text variant="small" tone="error">
            {preview.error}
          </Text>
        )}
      </View>
      {error && 'schedule' in preview ? (
        <Text variant="caption" tone="error" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}

      <TimePickerSheet
        visible={timeIndex != null}
        value={editingTime}
        title={timeIndex === -1 ? 'Add an alarm time' : 'Alarm time'}
        onClose={() => setTimeIndex(null)}
        onSubmit={(t) => {
          if (timeIndex === -1) set({ times: [...d.times, t] });
          else if (timeIndex != null) set({ times: d.times.map((x, j) => (j === timeIndex ? t : x)) });
        }}
      />
      <DatePickerSheet
        visible={datePicker != null}
        value={datePicker === 'end' ? d.end_date || addDaysISO(d.start_date, 29) : d.start_date}
        today={today}
        min={datePicker === 'end' ? d.start_date : undefined}
        title={datePicker === 'end' ? 'Last day' : 'Start date'}
        onClose={() => setDatePicker(null)}
        onSubmit={(date) => {
          if (datePicker === 'end') set({ end_date: date });
          else set({ start_date: date, end_date: d.end_date && d.end_date < date ? date : d.end_date });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  wrap: { gap: spacing.xl },
  label: { marginBottom: spacing.sm },
  hint: { marginTop: spacing.sm },
  gapTop: { marginTop: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  sos: { padding: spacing.md, borderRadius: radii.sm, backgroundColor: colors.infoBg, borderWidth: 1, borderColor: 'rgba(11,143,166,0.22)', gap: spacing.sm },
  sosLink: { alignSelf: 'flex-start', paddingVertical: spacing.xs },
  underline: { textDecorationLine: 'underline' },
  timePill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    backgroundColor: colors.glassSolid,
    paddingLeft: spacing.xs,
  },
  timeBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: spacing.sm, paddingRight: 2, minHeight: 40 },
  timeText: { fontVariant: ['tabular-nums'] },
  addTime: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 42,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(20,20,20,0.22)',
  },
  weekdays: { flexDirection: 'row', gap: 6 },
  weekday: {
    flex: 1,
    minHeight: 42,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    backgroundColor: colors.glassStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekdayOn: { borderColor: colors.cyan600, backgroundColor: colors.cyan50 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepperInput: {
    minWidth: 56,
    height: 44,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    backgroundColor: colors.glassSolid,
    textAlign: 'center',
    fontFamily: fonts.bodySemiBold,
    fontSize: 17,
    color: colors.ink,
  },
  fieldWrap: {},
  fieldLabel: { marginBottom: spacing.sm },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 50,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    backgroundColor: colors.glassSolid,
  },
  summary: { paddingHorizontal: spacing.md, paddingVertical: spacing.md, borderRadius: radii.sm, backgroundColor: 'rgba(255,255,255,0.6)' },
});
