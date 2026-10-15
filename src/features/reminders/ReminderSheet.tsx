/**
 * Create / edit a reminder in the bottom Sheet: kind, title, message, times (with "repeat through the day"),
 * weekdays, channels (App / WhatsApp / Calendar), on/off and delete — the website's ReminderSheet, adapted to touch.
 * Time pickers open as nested sheets rendered inside this sheet's tree (so they present over it on iOS).
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition, useReducedMotion } from 'react-native-reanimated';

import { TimePickerSheet } from '@/features/meds/PickerSheets';
import { formatTime12 } from '@/features/meds/shared';
import { ApiError, errorMessage, validationField } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { colors, radii, spacing } from '@/theme';
import { Button, Chip, Icon, PressableScale, Sheet, Text, TextField, toast } from '@/ui';

import { useDeleteReminder, useSaveReminder } from './api';
import { ConfirmStrip, SwitchRow } from './parts';
import {
  DEFAULT_CHANNELS,
  describeDays,
  isHHMM,
  KIND_DEFAULT_BODY,
  KIND_DEFAULT_TITLE,
  KIND_ICON,
  KIND_LABEL,
  MAX_TIMES_PER_REMINDER,
  nextReminderTime,
  REMINDER_KINDS,
  REPEAT_EVERY,
  repeatLabel,
  timesEvery,
  WEEK_ORDER,
  WEEKDAY_NAMES,
  WEEKDAYS_LETTER,
} from './shared';
import type { ReminderChannels, ReminderKind, ReminderView } from './types';

interface Draft {
  kind: ReminderKind;
  title: string;
  body: string;
  times: string[];
  days: number[];
  channels: ReminderChannels;
  active: boolean;
}

type Errors = { title?: string | null; times?: string | null; channels?: string | null; form?: string | null };
type PickerTarget = { type: 'time'; index: number } | { type: 'add' } | { type: 'from' } | { type: 'to' } | null;

function draftFrom(r: ReminderView | null): Draft {
  if (r) {
    return {
      kind: r.kind,
      title: r.title,
      body: r.body || '',
      times: [...r.schedule.times],
      days: [...(r.schedule.days || [])],
      channels: { ...DEFAULT_CHANNELS, ...r.channels },
      active: r.active,
    };
  }
  return { kind: 'meal', title: KIND_DEFAULT_TITLE.meal, body: '', times: ['09:00'], days: [], channels: { ...DEFAULT_CHANNELS }, active: true };
}

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const DEFAULT_REPEAT = { open: false, every: 2, from: '09:00', to: '21:00' };

export interface ReminderSheetProps {
  visible: boolean;
  reminder: ReminderView | null;
  onClose: () => void;
  /** WhatsApp is configured for ÖRZA — show its channel at all. */
  whatsappAvailable: boolean;
  /** The user saved a number and agreed — the channel can be switched on. */
  whatsappReady: boolean;
  /** Notifications are allowed on this phone. */
  pushReady: boolean;
}

export function ReminderSheet({ visible, reminder, onClose, whatsappAvailable, whatsappReady, pushReady }: ReminderSheetProps) {
  const reduceMotion = useReducedMotion();
  const save = useSaveReminder();
  const del = useDeleteReminder();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(reminder));
  const [errors, setErrors] = useState<Errors>({});
  const [repeat, setRepeat] = useState(DEFAULT_REPEAT);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [picker, setPicker] = useState<PickerTarget>(null);

  // Re-seed the form each time the sheet opens (state adjusted during render, no effect).
  const [seen, setSeen] = useState<{ visible: boolean; id: string | null }>({ visible, id: reminder?.id ?? null });
  if (seen.visible !== visible || (visible && seen.id !== (reminder?.id ?? null))) {
    setSeen({ visible, id: reminder?.id ?? null });
    if (visible) {
      setDraft(draftFrom(reminder));
      setErrors({});
      setRepeat(DEFAULT_REPEAT);
      setConfirmDelete(false);
      setPicker(null);
    }
  }

  const busy = save.isPending || del.isPending;
  const layout = reduceMotion ? undefined : LinearTransition.springify().damping(20);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const changeKind = (kind: ReminderKind) =>
    setDraft((d) => {
      const untouched = !d.title.trim() || REMINDER_KINDS.some((k) => KIND_DEFAULT_TITLE[k] === d.title.trim());
      return { ...d, kind, title: untouched ? KIND_DEFAULT_TITLE[kind] : d.title };
    });

  const removeTime = (i: number) => {
    haptics.soft();
    set({ times: draft.times.filter((_, j) => j !== i) });
  };

  const onPicked = (hhmm: string) => {
    if (!picker) return;
    if (picker.type === 'time') set({ times: draft.times.map((t, j) => (j === picker.index ? hhmm : t)) });
    else if (picker.type === 'add') set({ times: [...draft.times, hhmm].slice(0, MAX_TIMES_PER_REMINDER) });
    else if (picker.type === 'from') setRepeat((r) => ({ ...r, from: hhmm }));
    else setRepeat((r) => ({ ...r, to: hhmm }));
    if (errors.times) setErrors((e) => ({ ...e, times: null }));
  };

  const fillRepeat = () => {
    if (!isHHMM(repeat.from) || !isHHMM(repeat.to) || repeat.to <= repeat.from) {
      haptics.error();
      toast.error('Choose a start time before the end time.');
      return;
    }
    haptics.success();
    set({ times: timesEvery(repeat.from, repeat.to, Math.round(repeat.every * 60)) });
    setRepeat((r) => ({ ...r, open: false }));
    if (errors.times) setErrors((e) => ({ ...e, times: null }));
  };

  const toggleDay = (d: number) => {
    const current = draft.days.length ? draft.days : ALL_DAYS;
    const next = current.includes(d) ? current.filter((x) => x !== d) : [...current, d];
    if (!next.length) {
      haptics.warning();
      return; // At least one day — "Every day" is the empty list.
    }
    haptics.select();
    set({ days: next.length === 7 ? [] : next.sort((a, b) => a - b) });
  };

  const validate = (): boolean => {
    const e: Errors = {};
    if (!draft.title.trim()) e.title = 'Give the reminder a title.';
    const valid = draft.times.filter(isHHMM);
    if (!valid.length) e.times = 'Add at least one time.';
    else if (valid.length !== draft.times.length) e.times = 'Fix or remove the empty time.';
    if (!draft.channels.push && !(whatsappAvailable && draft.channels.whatsapp) && !draft.channels.calendar) e.channels = 'Pick at least one way to be reminded.';
    setErrors(e);
    return !e.title && !e.times && !e.channels;
  };

  const submit = () => {
    if (busy) return;
    if (!validate()) {
      haptics.error();
      return;
    }
    const times = [...new Set(draft.times)].sort();
    save.mutate(
      {
        id: reminder?.id,
        input: {
          kind: draft.kind,
          title: draft.title.trim(),
          body: draft.body.trim() || null,
          schedule: { times, days: draft.days },
          channels: { ...draft.channels, whatsapp: whatsappAvailable ? draft.channels.whatsapp : (reminder?.channels.whatsapp ?? false) },
          active: draft.active,
        },
      },
      {
        onSuccess: () => {
          haptics.success();
          toast.success(reminder ? 'Reminder updated' : 'Reminder added');
          onClose();
        },
        onError: (err) => {
          haptics.error();
          const f = validationField(err);
          if (f?.field === 'title') setErrors({ title: f.message });
          else if (f?.field === 'schedule') setErrors({ times: f.message });
          else if (f?.field === 'body') setErrors({ form: f.message });
          else if (err instanceof ApiError && err.status === 404) {
            toast.error('That reminder was already deleted.');
            onClose();
          } else setErrors({ form: errorMessage(err) });
        },
      }
    );
  };

  const remove = () => {
    if (!reminder || busy) return;
    del.mutate(reminder.id, {
      onSuccess: () => {
        haptics.success();
        toast.success('Reminder deleted');
        onClose();
      },
      onError: (err) => {
        haptics.error();
        if (err instanceof ApiError && err.status === 404) {
          toast.info('That reminder was already deleted.');
          onClose();
        } else toast.error(errorMessage(err));
      },
    });
  };

  const activeDays = draft.days.length ? draft.days : ALL_DAYS;
  const pickerValue =
    picker?.type === 'time'
      ? draft.times[picker.index]
      : picker?.type === 'from'
        ? repeat.from
        : picker?.type === 'to'
          ? repeat.to
          : nextReminderTime(draft.times);
  const pickerTitle = picker?.type === 'from' ? 'Start at' : picker?.type === 'to' ? 'Last one at' : picker?.type === 'add' ? 'Add a time' : 'Reminder time';

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      dismissible={!busy}
      eyebrow={reminder ? KIND_LABEL[reminder.kind] + ' reminder' : 'Reminders'}
      title={reminder ? 'Edit reminder' : 'New reminder'}
      footer={<Button label={reminder ? 'Save changes' : 'Add reminder'} variant="energy" size="lg" block loading={save.isPending} disabled={del.isPending} onPress={submit} icon="check" />}
    >
      <Text variant="small" tone="muted">
        Times are in your own timezone. ÖRZA nudges you on the channels you pick.
      </Text>

      {/* Kind */}
      <Text variant="eyebrow" tone="subtle" style={styles.label}>
        Kind
      </Text>
      <View style={styles.wrap} accessibilityRole="radiogroup" accessibilityLabel="Reminder kind">
        {REMINDER_KINDS.map((k) => (
          <Chip key={k} label={KIND_LABEL[k]} icon={KIND_ICON[k]} role="radio" size="sm" selected={draft.kind === k} onPress={() => changeKind(k)} />
        ))}
      </View>

      <TextField
        label="Title"
        value={draft.title}
        onChangeText={(t) => {
          set({ title: t });
          if (errors.title) setErrors((e) => ({ ...e, title: null }));
        }}
        error={errors.title}
        placeholder={KIND_DEFAULT_TITLE[draft.kind]}
        maxLength={80}
        returnKeyType="next"
        containerStyle={styles.field}
      />
      <TextField
        label="Message (optional)"
        value={draft.body}
        onChangeText={(t) => set({ body: t })}
        placeholder={KIND_DEFAULT_BODY[draft.kind]}
        maxLength={240}
        multiline
        hint={draft.body.length > 200 ? `${240 - draft.body.length} characters left` : undefined}
        containerStyle={styles.field}
      />

      {/* Times */}
      <Text variant="eyebrow" tone="subtle" style={styles.label}>
        Times · {draft.times.length}
      </Text>
      <Animated.View layout={layout} style={styles.wrap}>
        {draft.times.map((t, i) => (
          <Animated.View key={`${i}-${t}`} entering={reduceMotion ? undefined : FadeIn.duration(160)} exiting={reduceMotion ? undefined : FadeOut.duration(120)} style={styles.timePill}>
            <PressableScale
              haptic="tap"
              onPress={() => setPicker({ type: 'time', index: i })}
              accessibilityRole="button"
              accessibilityLabel={`Time ${i + 1}, ${isHHMM(t) ? formatTime12(t) : 'not set'}. Change`}
              style={styles.timeMain}
            >
              <Icon name="clock" size={14} color={colors.energyInk} />
              <Text variant="label">{isHHMM(t) ? formatTime12(t) : 'Set time'}</Text>
            </PressableScale>
            <PressableScale
              haptic="none"
              disabled={draft.times.length <= 1}
              onPress={() => removeTime(i)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${isHHMM(t) ? formatTime12(t) : `time ${i + 1}`}`}
              style={[styles.timeRemove, draft.times.length <= 1 && styles.dim]}
            >
              <Icon name="x" size={14} color={colors.muted} />
            </PressableScale>
          </Animated.View>
        ))}
        {draft.times.length < MAX_TIMES_PER_REMINDER ? (
          <Chip label="Add time" icon="plus" size="sm" onPress={() => setPicker({ type: 'add' })} />
        ) : null}
      </Animated.View>
      {errors.times ? (
        <Text variant="caption" tone="error" style={styles.error} accessibilityRole="alert">
          {errors.times}
        </Text>
      ) : null}

      <PressableScale
        haptic="soft"
        onPress={() => setRepeat((r) => ({ ...r, open: !r.open }))}
        accessibilityRole="button"
        accessibilityState={{ expanded: repeat.open }}
        style={styles.repeatToggle}
      >
        <Icon name="repeat" size={14} color={colors.cyan700} />
        <Text variant="label" tone="cyan">
          Repeat through the day
        </Text>
        <Icon name={repeat.open ? 'chevron-up' : 'chevron-down'} size={14} color={colors.cyan700} />
      </PressableScale>
      {repeat.open ? (
        <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(180)} style={styles.repeatPanel}>
          <Text variant="eyebrow" tone="subtle">
            Every
          </Text>
          <View style={styles.wrap} accessibilityRole="radiogroup" accessibilityLabel="Repeat every">
            {REPEAT_EVERY.map((h) => (
              <Chip key={h} label={repeatLabel(h)} size="sm" role="radio" selected={repeat.every === h} onPress={() => setRepeat((r) => ({ ...r, every: h }))} />
            ))}
          </View>
          <View style={styles.rangeRow}>
            <RangeButton label="From" value={repeat.from} onPress={() => setPicker({ type: 'from' })} />
            <RangeButton label="Until" value={repeat.to} onPress={() => setPicker({ type: 'to' })} />
          </View>
          <Button label="Fill times" icon="repeat" variant="secondary" size="sm" onPress={fillRepeat} />
        </Animated.View>
      ) : null}

      {/* Days */}
      <Text variant="eyebrow" tone="subtle" style={styles.label}>
        Days · {describeDays(draft.days)}
      </Text>
      <View style={styles.days} accessibilityLabel="Days of the week">
        {WEEK_ORDER.map((d) => {
          const on = activeDays.includes(d);
          return (
            <PressableScale
              key={d}
              haptic="none"
              onPress={() => toggleDay(d)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={WEEKDAY_NAMES[d]}
              style={[styles.day, on && styles.dayOn]}
            >
              <Text variant="label" color={on ? colors.inverse : colors.muted}>
                {WEEKDAYS_LETTER[d]}
              </Text>
            </PressableScale>
          );
        })}
      </View>

      {/* Channels */}
      <Text variant="eyebrow" tone="subtle" style={styles.label}>
        Remind me by
      </Text>
      <View style={styles.stack}>
        <SwitchRow
          icon="smartphone"
          title="App notification"
          hint={pushReady ? 'On this phone and your other devices with notifications on.' : 'Turn on notifications above so this reaches your phone.'}
          value={draft.channels.push}
          onChange={(v) => {
            set({ channels: { ...draft.channels, push: v } });
            if (errors.channels) setErrors((e) => ({ ...e, channels: null }));
          }}
        />
        {whatsappAvailable ? (
          <SwitchRow
            icon="message-circle"
            title="WhatsApp"
            hint={whatsappReady ? 'Sent to your saved WhatsApp number.' : 'Save your WhatsApp number and consent first.'}
            value={draft.channels.whatsapp}
            disabled={!whatsappReady && !draft.channels.whatsapp}
            onChange={(v) => {
              set({ channels: { ...draft.channels, whatsapp: v } });
              if (errors.channels) setErrors((e) => ({ ...e, channels: null }));
            }}
          />
        ) : null}
        <SwitchRow
          icon="calendar"
          title="Calendar"
          hint="Adds it to your ÖRZA calendar — the feed and your phone's calendar — so your calendar can ring too."
          value={draft.channels.calendar}
          onChange={(v) => {
            set({ channels: { ...draft.channels, calendar: v } });
            if (errors.channels) setErrors((e) => ({ ...e, channels: null }));
          }}
        />
      </View>
      {errors.channels ? (
        <Text variant="caption" tone="error" style={styles.error} accessibilityRole="alert">
          {errors.channels}
        </Text>
      ) : null}

      <SwitchRow icon="bell" title="Reminder on" hint="Pause it without deleting." value={draft.active} onChange={(v) => set({ active: v })} style={styles.activeRow} />

      {errors.form ? (
        <View style={styles.formError} accessibilityRole="alert">
          <Icon name="alert-triangle" size={16} color={colors.errorInk} />
          <Text variant="small" color={colors.errorInk} style={styles.flex}>
            {errors.form}
          </Text>
        </View>
      ) : null}

      {reminder ? (
        confirmDelete ? (
          <ConfirmStrip
            message="Delete this reminder? This can't be undone."
            confirmLabel="Delete reminder"
            busy={del.isPending}
            onCancel={() => setConfirmDelete(false)}
            onConfirm={remove}
          />
        ) : (
          <Button
            label="Delete reminder"
            icon="trash-2"
            variant="ghost"
            size="sm"
            onPress={() => {
              haptics.warning();
              setConfirmDelete(true);
            }}
            disabled={busy}
            style={styles.deleteBtn}
          />
        )
      ) : null}

      <TimePickerSheet visible={picker !== null} value={pickerValue} title={pickerTitle} onClose={() => setPicker(null)} onSubmit={onPicked} />
    </Sheet>
  );
}

function RangeButton({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  return (
    <PressableScale haptic="tap" onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label} ${formatTime12(value)}. Change`} style={styles.range}>
      <Text variant="eyebrow" tone="subtle">
        {label}
      </Text>
      <Text variant="title">{formatTime12(value)}</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  label: { marginTop: spacing.xl, marginBottom: spacing.sm },
  field: { marginTop: spacing.lg },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  stack: { gap: spacing.sm },
  timePill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.pill,
    backgroundColor: colors.energyBg,
    borderWidth: 1,
    borderColor: 'rgba(255,122,106,0.28)',
    minHeight: 36,
  },
  timeMain: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 12, paddingRight: 6, minHeight: 36 },
  timeRemove: { width: 32, height: 36, alignItems: 'center', justifyContent: 'center' },
  dim: { opacity: 0.35 },
  error: { marginTop: spacing.xs },
  repeatToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: spacing.md, minHeight: 36 },
  repeatPanel: {
    marginTop: spacing.xs,
    padding: spacing.md,
    gap: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.cyan50,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(11,143,166,0.25)',
  },
  rangeRow: { flexDirection: 'row', gap: spacing.sm },
  range: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
    backgroundColor: colors.glassSolid,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairlineStrong,
    gap: 2,
  },
  days: { flexDirection: 'row', justifyContent: 'space-between', gap: 4 },
  day: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glassStrong,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
  },
  dayOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  activeRow: { marginTop: spacing.xl },
  formError: {
    marginTop: spacing.lg,
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    padding: spacing.md,
    borderRadius: radii.sm,
    backgroundColor: colors.errorBg,
  },
  deleteBtn: { marginTop: spacing.lg, alignSelf: 'flex-start' },
});
