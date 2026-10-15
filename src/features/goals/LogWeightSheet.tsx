/**
 * "Log today's weight" bottom sheet — posts to /api/track/weight (which also keeps profile.weight_kg current).
 * Typed in the member's unit (kg or lb) with ±0.1 nudges, always sent as kg.
 */
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { haptics } from '@/lib/haptics';
import { colors, fonts, radii, spacing } from '@/theme';
import { Button, Icon, IconButton, Sheet, Text, toast } from '@/ui';

import { fieldError, useLogWeight } from './api';
import { MAX_WEIGHT_KG, MIN_WEIGHT_KG, formatDecimal, kgToUnit, parseNum, round, unitToKg, weightRange, weightUnit } from './math';

export function LogWeightSheet({
  visible,
  onClose,
  latestKg,
  imperial,
  today,
}: {
  visible: boolean;
  onClose: () => void;
  /** Latest weigh-in (kg) — the starting value and placeholder. */
  latestKg?: number | null;
  imperial: boolean;
  today: string;
}) {
  const { setUser } = useAuth();
  const log = useLogWeight(today);
  const unit = weightUnit(imperial);
  const range = weightRange(imperial);
  const start = latestKg ? String(kgToUnit(latestKg, imperial)) : '';
  const [value, setValue] = useState(start);
  const [error, setError] = useState<string | null>(null);
  const [wasVisible, setWasVisible] = useState(visible);

  // Each time the sheet opens, start again from the latest weigh-in.
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setValue(start);
      setError(null);
    }
  }

  const nudge = (d: number) => {
    const cur = parseNum(value);
    const base = Number.isFinite(cur) ? cur : latestKg ? kgToUnit(latestKg, imperial) : imperial ? 160 : 70;
    const next = Math.min(range.max, Math.max(range.min, round(base + d, 1)));
    haptics.select();
    setValue(String(next));
    if (error) setError(null);
  };

  const submit = () => {
    const w = parseNum(value);
    const kg = Number.isFinite(w) ? unitToKg(w, imperial) : NaN;
    if (!(kg >= MIN_WEIGHT_KG && kg <= MAX_WEIGHT_KG)) {
      haptics.warning();
      setError(`Enter a weight between ${range.min} and ${range.max} ${unit}.`);
      return;
    }
    setError(null);
    log.mutate(kg, {
      onSuccess: (res) => {
        if (res.user) setUser(res.user);
        haptics.success();
        toast.success('Weight logged — thanks for checking in.');
        onClose();
      },
      onError: (e) => {
        haptics.error();
        const f = fieldError(e);
        if (f) setError(f.message);
        else toast.error(errorMessage(e));
      },
    });
  };

  const diff = (() => {
    const w = parseNum(value);
    if (!latestKg || !Number.isFinite(w)) return null;
    const d = round(w - kgToUnit(latestKg, imperial), 1);
    return d === 0 ? 'Same as your last weigh-in' : `${d > 0 ? '+' : '−'}${formatDecimal(Math.abs(d))} ${unit} vs your last weigh-in`;
  })();

  return (
    <Sheet
      visible={visible}
      onClose={() => !log.isPending && onClose()}
      eyebrow="Weigh-in"
      title="Log today's weight"
      dismissible={!log.isPending}
      footer={<Button label="Log weight" icon="check" block loading={log.isPending} disabled={!value.trim()} onPress={submit} haptic="none" />}
    >
      <View style={styles.row}>
        <IconButton icon="minus" accessibilityLabel={`Decrease by 0.1 ${unit}`} size={52} iconSize={20} onPress={() => nudge(-0.1)} haptic="none" />
        <View style={[styles.field, error ? styles.invalid : null]}>
          <TextInput
            value={value}
            onChangeText={(t) => {
              setValue(t.replace(/[^0-9.,]/g, '').slice(0, 6));
              if (error) setError(null);
            }}
            keyboardType="decimal-pad"
            inputMode="decimal"
            placeholder={latestKg ? String(kgToUnit(latestKg, imperial)) : imperial ? '160' : '72.5'}
            placeholderTextColor="rgba(20,20,20,0.3)"
            selectionColor={colors.cyan600}
            cursorColor={colors.cyan600}
            returnKeyType="done"
            onSubmitEditing={submit}
            maxFontSizeMultiplier={1.2}
            accessibilityLabel={`Today's weight in ${unit === 'kg' ? 'kilograms' : 'pounds'}`}
            accessibilityHint={error ?? undefined}
            style={styles.input}
          />
          <Text variant="mono" tone="subtle" style={styles.unit}>
            {unit}
          </Text>
        </View>
        <IconButton icon="plus" accessibilityLabel={`Increase by 0.1 ${unit}`} size={52} iconSize={20} onPress={() => nudge(0.1)} haptic="none" />
      </View>
      {error ? (
        <View style={styles.message} accessibilityLiveRegion="polite">
          <Icon name="alert-circle" size={14} color={colors.error} />
          <Text variant="caption" tone="error" style={styles.flex}>
            {error}
          </Text>
        </View>
      ) : (
        <Text variant="caption" tone="muted" align="center">
          {diff ?? 'Same time of day, once or twice a week, gives the clearest trend.'}
        </Text>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  field: {
    flex: 1,
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    backgroundColor: colors.glassSolid,
    paddingHorizontal: spacing.md,
  },
  invalid: { borderColor: colors.error },
  input: {
    minWidth: 80,
    fontFamily: fonts.display,
    fontSize: 40,
    lineHeight: 48,
    color: colors.ink,
    textAlign: 'center',
    paddingVertical: 4,
    fontVariant: ['tabular-nums'],
  },
  unit: { marginLeft: 6, marginTop: 10 },
  message: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, justifyContent: 'center' },
  flex: { flexShrink: 1 },
});
