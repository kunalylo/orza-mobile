import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { haptics } from '@/lib/haptics';
import { colors, fonts, radii } from '@/theme';
import { IconButton } from '@/ui';

import { round } from './utils';

/** − value + pill; the value can also be typed (decimal pad). Clamped to [min, max], rounded to 0.01. */
export function Stepper({
  value,
  onChange,
  min = 0.5,
  max = 20,
  step = 0.5,
  label = 'Servings',
  compact,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Screen-reader name, e.g. "Servings" or "Quantity of Dal". */
  label?: string;
  compact?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  const [shown, setShown] = useState(value);
  // Follow outside changes (buttons, clamping) without fighting the user's typing.
  if (shown !== value) {
    setShown(value);
    setDraft(String(value));
  }

  const clamp = (n: number) => Math.min(max, Math.max(min, round(n, 2)));
  const commit = (raw: string) => {
    const n = Number(raw.replace(',', '.'));
    if (Number.isFinite(n) && n > 0) {
      const next = clamp(n);
      onChange(next);
      setDraft(String(next));
    } else setDraft(String(value));
  };
  const bump = (dir: 1 | -1) => {
    // From an odd value (e.g. 1.33) step to the next multiple of `step` first.
    const base = dir > 0 ? Math.floor(value / step + 1e-9) * step + step : Math.ceil(value / step - 1e-9) * step - step;
    const next = clamp(base);
    if (next === value) return;
    haptics.select();
    onChange(next);
  };

  const size = compact ? 32 : 36;
  return (
    <View style={styles.pill}>
      <IconButton icon="minus" variant="plain" size={size} iconSize={15} accessibilityLabel={`Less ${label.toLowerCase()}`} disabled={value <= min} onPress={() => bump(-1)} haptic="none" />
      <TextInput
        value={draft}
        onChangeText={setDraft}
        onBlur={() => commit(draft)}
        onSubmitEditing={() => commit(draft)}
        keyboardType="decimal-pad"
        returnKeyType="done"
        selectTextOnFocus
        maxLength={6}
        accessibilityLabel={label}
        maxFontSizeMultiplier={1.3}
        style={[styles.input, compact && styles.inputCompact]}
      />
      <IconButton icon="plus" variant="plain" size={size} iconSize={15} accessibilityLabel={`More ${label.toLowerCase()}`} disabled={value >= max} onPress={() => bump(1)} haptic="none" />
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    backgroundColor: colors.glassSolid,
    padding: 2,
  },
  input: {
    minWidth: 48,
    paddingVertical: 4,
    paddingHorizontal: 4,
    textAlign: 'center',
    fontFamily: fonts.bodySemiBold,
    fontSize: 16,
    color: colors.ink,
    fontVariant: ['tabular-nums'],
  },
  inputCompact: { minWidth: 40, fontSize: 15 },
});
