/**
 * Weight tile + the steps / weight entry sheets (keyboard-safe numeric field). Steps count themselves on Today
 * (`StepsCard`); `StepsSheet` is the typing fallback when no automatic source exists. Wording and validation follow
 * the web's StepsCard / WeightCard.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View, type TextInput } from 'react-native';

import { ApiError, errorMessage } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { colors, radii, spacing } from '@/theme';
import { Button, Icon, PressableScale, ProgressBar, Sheet, Text, TextField, toast } from '@/ui';

import { formatNumber } from '@/features/meals/utils';

import { useLogSteps, useLogWeight } from './api';
import { MAX_KG, MAX_STEPS, MIN_KG, clamp, displayToKg, kgToDisplay, relativeDay } from './format';
import { TrackerHead } from './TrackerHead';
import type { Goal } from './types';

/* ───────────────────────────── Shared ───────────────────────────── */

function Tile({ children, onPress, label, hint }: { children: ReactNode; onPress: () => void; label: string; hint: string }) {
  return (
    <PressableScale onPress={onPress} haptic="soft" scaleTo={0.975} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={hint} style={styles.tile}>
      {children}
      <View style={styles.editPill}>
        <Icon name="edit-3" size={12} color={colors.muted} />
        <Text variant="caption" weight="medium" tone="muted">
          Log
        </Text>
      </View>
    </PressableScale>
  );
}

/** Error text that belongs next to the field (400 with a field / validation message), else null. */
function fieldMessage(e: unknown, field: string): string | null {
  if (!(e instanceof ApiError) || e.status !== 400) return null;
  if (e.field === field) return e.message;
  if (e.message.startsWith(`${field}:`)) return e.message.slice(field.length + 1).trim();
  return null;
}

/**
 * Raise the keyboard once the sheet has sprung up. With `autoFocus` the field was focused before the sheet's Modal
 * window had focus on Android: it looked focused, but no keyboard came up until it was tapped again.
 */
function useFocusWhenShown(visible: boolean) {
  const ref = useRef<TextInput>(null);
  useEffect(() => {
    if (!visible) return undefined;
    const t = setTimeout(() => ref.current?.focus(), 380);
    return () => clearTimeout(t);
  }, [visible]);
  return ref;
}

/* ───────────────────────────── Steps (typing fallback) ───────────────────────────── */

export function StepsSheet({
  visible,
  onClose,
  date,
  today,
  steps,
  target,
}: {
  visible: boolean;
  onClose: () => void;
  date: string;
  today: string;
  steps: number;
  target: number;
}) {
  const isToday = date === today;
  const log = useLogSteps(date);
  const fieldRef = useFocusWhenShown(visible);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setInput('');
      setError(null);
    }
  }

  const status =
    steps >= target && target > 0
      ? 'Step goal reached — lovely work.'
      : steps > 0
        ? `${formatNumber(target - steps)} more to reach your goal.`
        : isToday
          ? 'A short walk after meals is a great place to start.'
          : 'No steps were logged on this day.';

  const save = () => {
    if (log.isPending) return;
    const n = Number(input.replace(/[,\s]/g, ''));
    if (!input.trim() || !Number.isFinite(n) || n < 0 || n > MAX_STEPS) {
      haptics.error();
      setError(`Enter a step count between 0 and ${formatNumber(MAX_STEPS)}.`);
      return;
    }
    setError(null);
    log.mutate(Math.round(n), {
      onSuccess: ({ tracking }) => {
        toast.success(`${formatNumber(tracking.steps)} steps saved`);
        onClose();
      },
      onError: (e) => {
        const fe = fieldMessage(e, 'steps');
        if (fe) {
          haptics.error();
          setError(fe);
        } else toast.error(errorMessage(e));
      },
    });
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      eyebrow="Steps"
      title={isToday ? "Today's steps" : `Steps · ${relativeDay(date, today)}`}
      dismissible={!log.isPending}
      footer={<Button label="Save steps" icon="check" variant="energy" block loading={log.isPending} disabled={!input.trim()} onPress={save} haptic="none" />}
    >
      <View style={styles.sheetStat}>
        <Text variant="stat" tone="ink">
          {formatNumber(steps)}
        </Text>
        <Text variant="small" tone="muted">
          of {formatNumber(target)} steps
        </Text>
      </View>
      <ProgressBar value={target > 0 ? steps / target : 0} palette="energy" height={7} style={styles.bar} />
      <Text variant="caption" tone="subtle" style={styles.status}>
        {status}
      </Text>
      <TextField
        label={`Total steps ${isToday ? 'today' : 'for this day'}`}
        value={input}
        onChangeText={(t) => {
          setInput(t.replace(/[^\d,\s]/g, ''));
          if (error) setError(null);
        }}
        placeholder={steps > 0 ? formatNumber(steps) : 'e.g. 6500'}
        keyboardType="number-pad"
        returnKeyType="done"
        onSubmitEditing={save}
        maxLength={7}
        error={error}
        hint="Enter the total from your phone or watch."
        ref={fieldRef}
        suffix="steps"
        containerStyle={styles.field}
      />
    </Sheet>
  );
}

/* ───────────────────────────── Weight ───────────────────────────── */

type WeightInfo = {
  /** Weight logged on the viewed day, if any. */
  dayWeight?: number;
  /** Most recent weigh-in on or before the viewed day. */
  lastWeight: { weight_kg: number; date: string } | null;
  profileWeight?: number;
  goal: Goal | null;
  imperial: boolean;
};

function currentWeight(w: WeightInfo): number | undefined {
  return w.dayWeight ?? w.lastWeight?.weight_kg ?? w.profileWeight;
}

function weightSource(w: WeightInfo, date: string, today: string): string {
  if (w.dayWeight != null) return date === today ? 'Logged today' : 'Logged this day';
  if (w.lastWeight) {
    const rel = relativeDay(w.lastWeight.date, today);
    return `Last logged ${rel === 'Today' || rel === 'Yesterday' ? rel.toLowerCase() : `on ${rel}`}`;
  }
  return w.profileWeight != null ? 'From your profile' : 'No weigh-ins yet';
}

/** Goal progress from the goal's starting weight towards the target. */
function goalProgress(goal: Goal, current: number) {
  const start = goal.current_weight_kg;
  const target = goal.target_weight_kg;
  const toGo = Math.abs(current - target);
  const span = start - target;
  const progress = span === 0 ? 1 : clamp((start - current) / span, 0, 1);
  const reached = goal.goal === 'maintain' ? toGo <= 1 : span > 0 ? current <= target : current >= target;
  return { target, toGo, progress, reached };
}

function GoalLine({ goal, current, imperial }: { goal: Goal; current: number; imperial: boolean }) {
  const unit = imperial ? 'lb' : 'kg';
  const g = goalProgress(goal, current);
  const right =
    goal.goal === 'maintain'
      ? g.reached
        ? 'Holding steady'
        : `${kgToDisplay(g.toGo, imperial)} ${unit} away`
      : g.reached
        ? 'Goal reached'
        : `${kgToDisplay(g.toGo, imperial)} ${unit} to go`;
  return (
    <View style={styles.goal}>
      <View style={styles.goalHead}>
        <Text variant="caption" tone="ink" numberOfLines={1}>
          Goal {kgToDisplay(g.target, imperial)} {unit}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1} style={styles.shrink}>
          {right}
        </Text>
      </View>
      {goal.goal !== 'maintain' ? <ProgressBar value={g.progress} palette="violet" height={6} style={styles.bar} /> : null}
    </View>
  );
}

export function WeightTile({ info, date, today, onPress }: { info: WeightInfo; date: string; today: string; onPress: () => void }) {
  const unit = info.imperial ? 'lb' : 'kg';
  const current = currentWeight(info);
  const shown = current != null ? String(kgToDisplay(current, info.imperial)) : '—';
  return (
    <Tile onPress={onPress} label={`Weight: ${current != null ? `${shown} ${unit}` : 'not logged yet'}`} hint="Opens a form to log your weight">
      <TrackerHead icon="mci:scale-bathroom" tone="violet" label="Weight" />
      <View style={styles.bigRow}>
        <Text variant="stat" tone="ink" style={styles.big} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
          {shown}
        </Text>
        <Text variant="small" tone="muted">
          {unit}
        </Text>
      </View>
      <Text variant="caption" tone="muted" numberOfLines={1}>
        {weightSource(info, date, today)}
      </Text>
      {info.goal && current != null && info.goal.goal !== 'maintain' ? (
        <ProgressBar value={goalProgress(info.goal, current).progress} palette="violet" height={6} style={styles.bar} />
      ) : null}
    </Tile>
  );
}

export function WeightSheet({
  visible,
  onClose,
  date,
  today,
  info,
  onGoals,
}: {
  visible: boolean;
  onClose: () => void;
  date: string;
  today: string;
  info: WeightInfo;
  onGoals: () => void;
}) {
  const isToday = date === today;
  const log = useLogWeight(date);
  const fieldRef = useFocusWhenShown(visible);
  const unit = info.imperial ? 'lb' : 'kg';
  const current = currentWeight(info);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setInput('');
      setError(null);
    }
  }

  const save = () => {
    if (log.isPending) return;
    const v = Number(input.replace(',', '.'));
    const kg = Number.isFinite(v) ? displayToKg(v, info.imperial) : NaN;
    if (!input.trim() || !Number.isFinite(kg) || kg < MIN_KG || kg > MAX_KG) {
      haptics.error();
      const lo = kgToDisplay(MIN_KG, info.imperial);
      const hi = kgToDisplay(MAX_KG, info.imperial);
      setError(`Enter a weight between ${Math.ceil(lo)} and ${Math.floor(hi)} ${unit}.`);
      return;
    }
    setError(null);
    log.mutate(kg, {
      onSuccess: ({ tracking }) => {
        toast.success(`Weight saved — ${kgToDisplay(tracking.weight_kg ?? kg, info.imperial)} ${unit}`);
        onClose();
      },
      onError: (e) => {
        const fe = fieldMessage(e, 'weight_kg');
        if (fe) {
          haptics.error();
          setError(fe);
        } else toast.error(errorMessage(e));
      },
    });
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      eyebrow="Weight"
      title={isToday ? "Today's weigh-in" : `Weigh-in · ${relativeDay(date, today)}`}
      dismissible={!log.isPending}
      footer={<Button label="Save weight" icon="check" variant="primary" block loading={log.isPending} disabled={!input.trim()} onPress={save} haptic="none" />}
    >
      <View style={styles.sheetStat}>
        <Text variant="stat" tone="ink">
          {current != null ? kgToDisplay(current, info.imperial) : '—'}
        </Text>
        <Text variant="small" tone="muted">
          {unit}
        </Text>
      </View>
      <Text variant="caption" tone="subtle">
        {weightSource(info, date, today)}
      </Text>
      {info.goal && current != null ? <GoalLine goal={info.goal} current={current} imperial={info.imperial} /> : null}
      <TextField
        label={`Weight in ${info.imperial ? 'pounds' : 'kilograms'} ${isToday ? 'today' : 'for this day'}`}
        value={input}
        onChangeText={(t) => {
          setInput(t.replace(/[^\d.,]/g, ''));
          if (error) setError(null);
        }}
        placeholder={current != null ? String(kgToDisplay(current, info.imperial)) : info.imperial ? 'e.g. 154' : 'e.g. 70.5'}
        keyboardType="decimal-pad"
        returnKeyType="done"
        onSubmitEditing={save}
        maxLength={6}
        error={error}
        hint="Weigh in at the same time of day for a steadier trend."
        ref={fieldRef}
        suffix={unit}
        containerStyle={styles.field}
      />
      <Button
        label={info.goal ? 'View your goal' : 'Set a goal'}
        iconRight="arrow-up-right"
        variant="ghost"
        size="sm"
        onPress={() => {
          onClose();
          onGoals();
        }}
        disabled={log.isPending}
        style={styles.goalLink}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  shrink: { flexShrink: 1 },
  tile: {
    flex: 1,
    minWidth: 0,
    padding: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.glass,
    boxShadow: '0px 10px 30px rgba(20,20,20,0.08)',
  },
  big: { marginTop: spacing.md },
  bigRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  bar: { marginTop: spacing.sm },
  editPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    marginTop: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(20,20,20,0.05)',
  },
  sheetStat: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  status: { marginTop: spacing.sm },
  field: { marginTop: spacing.xl },
  goal: { marginTop: spacing.lg },
  goalHead: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  goalLink: { alignSelf: 'flex-start', marginTop: spacing.md },
});
