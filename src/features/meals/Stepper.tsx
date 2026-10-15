import { useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { haptics } from '@/lib/haptics';
import { colors, fonts, radii } from '@/theme';
import { IconButton } from '@/ui';

import { round } from './utils';

/**
 * − value + pill; the value can also be typed (decimal pad). Clamped to [min, max], rounded to 0.01, and reported
 * as it's typed (not only on blur), so the parent's state is current whenever a button is tapped.
 */
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
  /** The value before the current typing (on focus / − +) — what clearing the field and leaving it goes back to. */
  const focusValue = useRef(value);
  // Follow outside changes (buttons, clamping) without fighting the user's typing.
  if (shown !== value) {
    setShown(value);
    setDraft(String(value));
  }

  const clamp = (n: number) => Math.min(max, Math.max(min, round(n, 2)));
  /** "1,5" / " 2 " → number; "" / "." → NaN. */
  const parse = (raw: string) => {
    const t = raw.trim().replace(',', '.');
    return t ? Number(t) : NaN;
  };
  const report = (next: number) => {
    // Keep `shown` in step so the sync above doesn't rewrite what's being typed.
    setShown(next);
    if (next !== value) onChange(next);
  };
  // Every keystroke that reads as a quantity is reported straight away: a Save / Log / Add tapped while the field
  // still has focus (no blur first — the decimal pad has no return key on iOS) must see what was typed.
  const type = (raw: string) => {
    setDraft(raw);
    const n = parse(raw);
    if (Number.isFinite(n) && n > 0) report(clamp(n));
  };
  // Leaving the field tidies the text: clamped and rounded, or back to the value it had when focused.
  const commit = (raw: string) => {
    const n = parse(raw);
    const next = Number.isFinite(n) && n > 0 ? clamp(n) : focusValue.current;
    report(next);
    setDraft(String(next));
  };
  const bump = (dir: 1 | -1) => {
    // From an odd value (e.g. 1.33) step to the next multiple of `step` first.
    const base = dir > 0 ? Math.floor(value / step + 1e-9) * step + step : Math.ceil(value / step - 1e-9) * step - step;
    const next = clamp(base);
    if (next === value) return;
    haptics.select();
    focusValue.current = next;
    onChange(next);
  };

  const size = compact ? 32 : 36;
  return (
    <View style={styles.pill}>
      <IconButton icon="minus" variant="plain" size={size} iconSize={15} accessibilityLabel={`Less ${label.toLowerCase()}`} disabled={value <= min} onPress={() => bump(-1)} haptic="none" />
      <TextInput
        value={draft}
        onChangeText={type}
        onFocus={() => {
          focusValue.current = value;
        }}
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
