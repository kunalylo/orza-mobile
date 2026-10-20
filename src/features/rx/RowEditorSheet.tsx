/**
 * Edit one reviewed medicine in a bottom sheet: name, strength, dose, prescription pattern (1-0-1, BD, TDS, SOS…),
 * alarm time chips, food timing and course length. Nothing changes in the list until "Save". Once something was
 * changed the sheet stops closing on its own: swipe-down is off, and Cancel, the close button, the backdrop and Android
 * back all ask "Discard changes?" first.
 */
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { TimePickerSheet } from '@/features/meds/PickerSheets';
import { activeQuickPattern, nextTime, QUICK_PATTERNS } from '@/features/meds/schedule';
import { formatTime12, isHHMM, TIMING_OPTIONS } from '@/features/meds/shared';
import { haptics } from '@/lib/haptics';
import { colors, fonts, radii, spacing } from '@/theme';
import { Button, Chip, Icon, PressableScale, Sheet, Text, TextField } from '@/ui';

import { MAX_ROW_TIMES, rowProblem } from './rows';
import type { ReviewRow } from './types';

/** `savedTimes`: the alarm times from before it was marked SOS, restored when SOS is switched off. */
type Draft = ReviewRow & { daysText: string; savedTimes?: string[] };

const toDraft = (r: ReviewRow | null): Draft | null => (r ? { ...r, times: [...r.times], daysText: r.duration_days ? String(r.duration_days) : '' } : null);

/** What counts as an unsaved change (`savedTimes` is bookkeeping, times are compared as a set). */
function draftKey(d: Draft): string {
  const { savedTimes: _ignored, ...rest } = d;
  void _ignored;
  return JSON.stringify({ ...rest, name: rest.name.trim(), times: [...rest.times].filter(isHHMM).sort() });
}

/**
 * Re-seed the draft each time the sheet opens (state adjusted during render, no effect). Also returns the key of
 * what it was opened with, the baseline for unsaved changes.
 */
function useDraftOnOpen(visible: boolean, row: ReviewRow | null): [Draft | null, (d: Draft) => void, string | null] {
  const [draft, setDraft] = useState<Draft | null>(() => toDraft(row));
  const [opened, setOpened] = useState<string | null>(() => {
    const d = toDraft(row);
    return d ? draftKey(d) : null;
  });
  const [openedFor, setOpenedFor] = useState<string | null>(visible ? (row?.key ?? null) : null);
  const key = visible ? (row?.key ?? null) : null;
  if (key !== openedFor) {
    setOpenedFor(key);
    const seeded = key ? toDraft(row) : null;
    if (seeded) {
      setDraft(seeded);
      setOpened(draftKey(seeded));
    }
  }
  return [draft, setDraft, opened];
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Text variant="eyebrow" tone="subtle" style={styles.label}>
      {children}
    </Text>
  );
}

export function RowEditorSheet({
  visible,
  row,
  isNew,
  onClose,
  onSave,
}: {
  visible: boolean;
  row: ReviewRow | null;
  isNew: boolean;
  onClose: () => void;
  onSave: (row: ReviewRow) => void;
}) {
  const [draft, setDraft, opened] = useDraftOnOpen(visible, row);
  const [timeIndex, setTimeIndex] = useState<number | null>(null); // -1 = adding
  const [showErrors, setShowErrors] = useState(false);
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setShowErrors(false);
  }

  if (!draft) return null;
  const update = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const times = [...draft.times].filter(isHHMM).sort();
  // The pattern the member tapped (TDS) wins over the first one with the same times (1-1-1).
  const tapped = QUICK_PATTERNS.find((q) => q.key === draft.frequency_text);
  const pattern =
    tapped && (tapped.as_needed ? draft.as_needed : !draft.as_needed && [...(tapped.times ?? [])].sort().join(',') === times.join(','))
      ? tapped.key
      : activeQuickPattern({ as_needed: draft.as_needed, times });

  const { daysText, savedTimes: _savedTimes, ...base } = draft;
  const daysNum = daysText.trim() ? Number(daysText) : undefined;
  const candidate: ReviewRow = { ...base, include: true, times, duration_days: daysNum };
  const problem = rowProblem(candidate);
  const nameError = showErrors && !draft.name.trim() ? "Add the medicine's name." : null;
  const doseError = showErrors && !draft.dose.trim() ? 'Add the dose, e.g. 1 tablet.' : null;
  const daysError =
    showErrors && daysNum !== undefined && (!Number.isInteger(daysNum) || daysNum < 1 || daysNum > 365) ? 'Days should be 1 to 365.' : null;
  const otherError = showErrors && problem && !nameError && !doseError && !daysError ? problem : null;

  // A new row counts as soon as anything was typed or picked; a scanned row once it differs from how it opened.
  const dirty = draftKey(draft) !== opened;

  const save = () => {
    if (problem) {
      setShowErrors(true);
      haptics.error();
      return;
    }
    haptics.success();
    onSave({ ...candidate, include: draft.include || isNew });
    onClose();
  };

  const cancel = () => {
    if (!dirty) {
      onClose();
      return;
    }
    haptics.warning();
    Alert.alert('Discard changes?', isNew ? "This medicine hasn't been added to the list yet." : "Your changes to this medicine haven't been saved.", [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: onClose },
    ]);
  };

  const pickPattern = (key: string) => {
    const q = QUICK_PATTERNS.find((p) => p.key === key);
    if (!q) return;
    if (q.as_needed) update({ as_needed: true, times: [], frequency_text: 'SOS', savedTimes: times.length ? times : draft.savedTimes });
    else update({ as_needed: false, times: [...(q.times ?? [])], frequency_text: q.key });
  };

  const setSos = (on: boolean) => {
    haptics.select();
    // A pattern this editor filled in (1-0-1 on a typed medicine) would read "As written · 1-0-1" on an SOS row; what
    // the doctor actually wrote (a scanned "1 tab if fever") is kept.
    const wasPattern = !draft.frequency_text || QUICK_PATTERNS.some((q) => q.key === draft.frequency_text);
    if (on) update({ as_needed: true, times: [], frequency_text: wasPattern ? 'SOS' : draft.frequency_text, savedTimes: times.length ? times : draft.savedTimes });
    else {
      // Back to the times it had (or was scanned with) before it was marked SOS.
      const back = times.length ? times : draft.savedTimes?.length ? draft.savedTimes : row?.times.filter(isHHMM).length ? [...row.times] : ['08:00'];
      update({ as_needed: false, times: back, frequency_text: draft.frequency_text === 'SOS' ? (activeQuickPattern({ as_needed: false, times: back }) ?? '') : draft.frequency_text });
    }
  };

  const submitTime = (hhmm: string) => {
    if (timeIndex === null) return;
    const next = timeIndex < 0 ? [...times, hhmm] : times.map((t, i) => (i === timeIndex ? hhmm : t));
    update({ times: [...new Set(next)].sort() });
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      // With unsaved changes nothing closes it silently: backdrop, X and Android back ask first (like Cancel), swipe is off.
      dismissible={!dirty}
      onBlockedDismiss={cancel}
      eyebrow={isNew ? 'Add a medicine' : 'Check this medicine'}
      title={draft.name.trim() || 'New medicine'}
      full
      footer={
        <View style={styles.footer}>
          <Button label="Cancel" variant="ghost" size="lg" onPress={cancel} />
          <Button label={isNew ? 'Add medicine' : 'Save'} icon="check" variant="primary" size="lg" onPress={save} style={styles.flex} />
        </View>
      }
    >
      {row?.frequency_text && !isNew ? (
        <View style={styles.written}>
          <Icon name="mci:file-document-outline" size={15} color={colors.muted} />
          <Text variant="caption" tone="muted" style={styles.flex}>
            As written on the prescription: <Text style={styles.mono}>{row.frequency_text}</Text>
          </Text>
        </View>
      ) : null}

      <TextField
        label="Medicine"
        value={draft.name}
        onChangeText={(name) => update({ name })}
        placeholder="Medicine name, e.g. Dolo"
        maxLength={80}
        autoFocus={isNew}
        autoCapitalize="words"
        returnKeyType="next"
        error={nameError}
        icon="mci:pill"
      />
      <View style={styles.twoCol}>
        <TextField
          label="Strength"
          value={draft.strength ?? ''}
          onChangeText={(s) => update({ strength: s || undefined })}
          placeholder="500 mg"
          maxLength={40}
          containerStyle={styles.flex}
        />
        <TextField label="Dose" value={draft.dose} onChangeText={(dose) => update({ dose })} placeholder="1 tablet" maxLength={40} error={doseError} containerStyle={styles.flex} />
      </View>

      <SectionLabel>How often</SectionLabel>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow} accessibilityRole="radiogroup" accessibilityLabel="Prescription pattern">
        {QUICK_PATTERNS.map((q) => (
          <Chip key={q.key} label={q.label} size="sm" role="radio" selected={pattern === q.key} onPress={() => pickPattern(q.key)} accessibilityHint={q.hint} />
        ))}
      </ScrollView>
      <Text variant="caption" tone="subtle" style={styles.hint}>
        {pattern ? QUICK_PATTERNS.find((q) => q.key === pattern)?.hint : 'Custom times'}
      </Text>

      <SectionLabel>Alarm times</SectionLabel>
      {draft.as_needed ? (
        <Animated.View entering={FadeIn} exiting={FadeOut} style={styles.sosNote}>
          <Icon name="mci:hand-heart-outline" size={16} color={colors.cyan700} />
          <Text variant="small" color={colors.cyan700} style={styles.flex}>
            Only when needed — no alarms
          </Text>
        </Animated.View>
      ) : (
        <Animated.View layout={LinearTransition.springify().damping(20).stiffness(100).mass(1)} style={styles.timeRow} accessibilityLabel={`Alarm times for ${draft.name || 'this medicine'}`}>
          {times.map((t, i) => (
            <Animated.View key={t} entering={FadeIn.duration(180)} exiting={FadeOut.duration(140)} layout={LinearTransition.springify().damping(20).stiffness(100).mass(1)} style={styles.timeChip}>
              <PressableScale onPress={() => setTimeIndex(i)} haptic="tap" style={styles.timeMain} accessibilityRole="button" accessibilityLabel={`Alarm time ${formatTime12(t)}. Change`}>
                <Icon name="bell" size={13} color={colors.energyInk} />
                <Text variant="label">{formatTime12(t)}</Text>
              </PressableScale>
              <PressableScale
                onPress={() => update({ times: times.filter((x) => x !== t) })}
                haptic="soft"
                hitSlop={6}
                style={styles.timeRemove}
                accessibilityRole="button"
                accessibilityLabel={`Remove alarm time ${formatTime12(t)}`}
              >
                <Icon name="x" size={13} color={colors.muted} />
              </PressableScale>
            </Animated.View>
          ))}
          {times.length < MAX_ROW_TIMES ? (
            <PressableScale onPress={() => setTimeIndex(-1)} haptic="tap" style={styles.addTime} accessibilityRole="button" accessibilityLabel="Add an alarm time">
              <Icon name="plus" size={14} color={colors.muted} />
              <Text variant="label" tone="muted">
                Time
              </Text>
            </PressableScale>
          ) : null}
        </Animated.View>
      )}

      <View style={styles.switchRow}>
        <View style={styles.flex}>
          <Text variant="label">SOS — only when needed</Text>
          <Text variant="caption" tone="muted">
            For pain or fever medicines. No alarms ring.
          </Text>
        </View>
        <Switch
          value={draft.as_needed}
          onValueChange={setSos}
          trackColor={{ true: colors.cyan600, false: colors.canvas3 }}
          thumbColor={colors.white}
          accessibilityLabel="Only when needed (SOS)"
        />
      </View>

      <SectionLabel>Food</SectionLabel>
      <View style={styles.wrapRow} accessibilityRole="radiogroup" accessibilityLabel="When to take it">
        {TIMING_OPTIONS.map((o) => (
          <Chip key={o.value} label={o.label} size="sm" role="radio" selected={draft.timing === o.value} onPress={() => update({ timing: o.value })} />
        ))}
      </View>

      <TextField
        label="Course length (days)"
        value={draft.daysText}
        onChangeText={(t) => update({ daysText: t.replace(/[^\d]/g, '').slice(0, 3) })}
        placeholder="Ongoing"
        keyboardType="number-pad"
        inputMode="numeric"
        maxLength={3}
        hint="Leave empty if it's ongoing. Counts from the start date."
        error={daysError}
        containerStyle={styles.days}
        suffix={draft.daysText ? 'days' : undefined}
      />

      {draft.instructions ? (
        <View style={styles.written}>
          <Icon name="info" size={14} color={colors.muted} />
          <Text variant="caption" tone="muted" style={styles.flex}>
            {draft.instructions}
          </Text>
        </View>
      ) : null}

      {otherError ? (
        <Text variant="small" tone="error" accessibilityRole="alert" style={styles.error}>
          {otherError}
        </Text>
      ) : null}

      <TimePickerSheet
        visible={timeIndex !== null}
        value={timeIndex !== null && timeIndex >= 0 ? times[timeIndex] : nextTime(times)}
        title={timeIndex !== null && timeIndex >= 0 ? 'Change alarm time' : 'Add an alarm time'}
        onClose={() => setTimeIndex(null)}
        onSubmit={submitTime}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  mono: { fontFamily: fonts.mono, fontSize: 12, color: colors.ink },
  written: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderRadius: radii.sm,
    backgroundColor: colors.canvas1,
  },
  twoCol: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  label: { marginTop: spacing.xl, marginBottom: spacing.sm },
  chipRow: { gap: spacing.sm, paddingRight: spacing.lg },
  hint: { marginTop: spacing.xs },
  sosNote: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radii.sm,
    backgroundColor: colors.cyan50,
  },
  timeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  timeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.pill,
    backgroundColor: colors.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairlineStrong,
  },
  timeMain: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 12, paddingRight: 4, minHeight: 40 },
  timeRemove: { width: 34, height: 40, alignItems: 'center', justifyContent: 'center' },
  addTime: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 14,
    minHeight: 40,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.hairlineStrong,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.lg },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  days: { marginTop: spacing.xl },
  error: { marginTop: spacing.md },
});
