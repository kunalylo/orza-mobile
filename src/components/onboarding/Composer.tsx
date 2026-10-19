/**
 * The answer area under the onboarding conversation — whatever the current step asks for: quick-reply chips,
 * option cards, a searchable list (region), multi-select (allergies), a number with units, free text, or the
 * plan confirmation. Answer formats match the website exactly (the server parses them).
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { haptics } from '@/lib/haptics';
import type { Answer, StepOption, StepPrompt } from '@/lib/onboarding';
import { colors, fonts, radii, spacing } from '@/theme';
import { Button, Chip, Icon, PressableScale, Segmented, Text } from '@/ui';

export interface PickerProps {
  prompt: StepPrompt;
  busy: boolean;
  onAnswer: (value: Answer, display: string) => void;
}

export function Composer(props: PickerProps) {
  const { prompt } = props;
  if (prompt.summary || prompt.step === 'summary') return <SummaryActions {...props} />;
  switch (prompt.input) {
    case 'choice':
      return prompt.featured ? <SearchPicker {...props} /> : <ChoicePicker {...props} />;
    case 'multi':
      return <MultiPicker {...props} />;
    case 'number':
      return <NumberAnswer {...props} />;
    case 'text':
      return <TextAnswer {...props} />;
    default:
      return null;
  }
}

/* ───────────────────────────── Shared bits ───────────────────────────── */

function SendButton({ disabled, onPress, label = 'Send answer' }: { disabled?: boolean; onPress: () => void; label?: string }) {
  return (
    <PressableScale
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      haptic="firm"
      scaleTo={0.9}
      style={[styles.send, disabled && styles.sendDisabled]}
    >
      <Icon name="arrow-up" size={20} color={colors.white} />
    </PressableScale>
  );
}

function Field({
  value,
  onChangeText,
  placeholder,
  label,
  onSubmit,
  keyboardType,
  maxLength = 200,
  suffix,
  returnKeyType = 'send',
  multiline,
}: {
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  label: string;
  /** Gets the field's own text: a fast "type + Return" can reach JS before the render with the last characters. */
  onSubmit: (text: string) => void;
  keyboardType?: 'default' | 'decimal-pad' | 'number-pad';
  maxLength?: number;
  suffix?: string;
  returnKeyType?: 'send' | 'search' | 'done';
  /** Longer free text: wraps (and so does a long placeholder) instead of scrolling sideways; Return still sends. */
  multiline?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.field, multiline && styles.fieldMultiline, focused && styles.fieldFocused]}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="rgba(20,20,20,0.38)"
        accessibilityLabel={label}
        keyboardType={keyboardType}
        maxLength={maxLength}
        returnKeyType={returnKeyType}
        onSubmitEditing={(e) => onSubmit(e.nativeEvent.text)}
        submitBehavior="submit"
        multiline={multiline}
        textAlignVertical={multiline ? 'center' : undefined}
        autoCorrect={false}
        autoComplete="off"
        selectionColor={colors.cyan600}
        cursorColor={colors.cyan600}
        maxFontSizeMultiplier={1.4}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[styles.input, multiline && styles.inputMultiline]}
      />
      {suffix ? (
        <Text variant="mono" tone="subtle" style={styles.suffix}>
          {suffix}
        </Text>
      ) : null}
    </View>
  );
}

function InlineText({
  placeholder,
  busy,
  label,
  maxLength,
  clearOnSubmit,
  onSubmit,
}: {
  placeholder?: string;
  busy: boolean;
  label: string;
  maxLength?: number;
  /** Empty the field after each submit (multi-select "Add another": ready for the next item). */
  clearOnSubmit?: boolean;
  onSubmit: (t: string) => void;
}) {
  const [value, setValue] = useState('');
  const submit = (raw: string = value) => {
    const t = raw.trim();
    if (!t || busy) return;
    onSubmit(t);
    if (clearOnSubmit) setValue('');
  };
  return (
    <View style={styles.inline}>
      <Field value={value} onChangeText={setValue} placeholder={placeholder} label={label} onSubmit={submit} maxLength={maxLength} />
      <SendButton disabled={busy || !value.trim()} onPress={() => submit()} />
    </View>
  );
}

function ChipWrap({ children, label }: { children: ReactNode; label: string }) {
  return (
    <View style={styles.wrap} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {children}
    </View>
  );
}

/* ───────────────────────────── Single choice ───────────────────────────── */

function OptionCard({ option, disabled, onPress }: { option: StepOption; disabled: boolean; onPress: () => void }) {
  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityLabel={option.hint ? `${option.label}. ${option.hint}` : option.label}
      accessibilityState={{ checked: false, disabled }}
      disabled={disabled}
      haptic="soft"
      scaleTo={0.98}
      onPress={onPress}
      style={styles.optionCard}
    >
      <View style={styles.optionText}>
        <Text variant="label">{option.label}</Text>
        {option.hint ? (
          <Text variant="caption" tone="muted" style={styles.optionHint}>
            {option.hint}
          </Text>
        ) : null}
      </View>
      <Icon name="chevron-right" size={17} color={colors.subtle} />
    </PressableScale>
  );
}

function ChoicePicker({ prompt, busy, onAnswer }: PickerProps) {
  const options = prompt.options ?? [];
  const detailed = options.some((o) => o.hint);
  return (
    <View style={styles.stack}>
      {detailed ? (
        <View style={styles.cards} accessibilityRole="radiogroup" accessibilityLabel="Choose one">
          {options.map((o) => (
            <OptionCard key={o.value} option={o} disabled={busy} onPress={() => onAnswer(o.value, o.label)} />
          ))}
        </View>
      ) : (
        <ChipWrap label="Choose one">
          {options.map((o) => (
            <Chip key={o.value} label={o.label} role="radio" disabled={busy} onPress={() => onAnswer(o.value, o.label)} />
          ))}
        </ChipWrap>
      )}
      {prompt.allow_custom ? <InlineText label="Or type your own answer" placeholder={prompt.placeholder} busy={busy} onSubmit={(t) => onAnswer(t, t)} /> : null}
    </View>
  );
}

/* ───────────────────────────── Searchable list (region) ───────────────────────────── */

function SearchPicker({ prompt, busy, onAnswer }: PickerProps) {
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const options = useMemo(() => prompt.options ?? [], [prompt.options]);
  const featured = (prompt.featured ?? []).map((v) => options.find((o) => o.value === v) ?? { value: v, label: v });
  const matchesFor = (q: string) =>
    q
      ? options
          .filter((o) => o.label.toLowerCase().includes(q))
          .sort((a, b) => Number(!a.label.toLowerCase().startsWith(q)) - Number(!b.label.toLowerCase().startsWith(q)))
          .slice(0, 12)
      : [];
  const q = query.trim().toLowerCase();
  const matches = matchesFor(q);
  const list: StepOption[] = q ? matches : showAll ? options : featured;

  const submit = (raw: string = query) => {
    const text = raw.trim();
    if (busy || !text) return;
    const found = matchesFor(text.toLowerCase());
    if (found.length === 1) onAnswer(found[0].value, found[0].label);
    else onAnswer(text, text); // cities & nicknames are resolved server-side
  };

  return (
    <View style={styles.stack}>
      <View style={styles.inline}>
        <Field value={query} onChangeText={setQuery} placeholder={prompt.placeholder || 'Search your state or city'} label="Search your state or city" onSubmit={submit} maxLength={80} returnKeyType="search" />
        <SendButton disabled={busy || !q} onPress={() => submit()} />
      </View>
      <ChipWrap label={q ? 'Matching places' : showAll ? 'All states and territories' : 'Popular choices'}>
        {list.map((o) => (
          <Chip key={o.value} label={o.label} size="sm" role="radio" disabled={busy} onPress={() => onAnswer(o.value, o.label)} />
        ))}
      </ChipWrap>
      {q && matches.length === 0 ? (
        <Text variant="caption" tone="muted">
          No state matches “{query.trim()}”. Send it anyway — I know most cities too.
        </Text>
      ) : null}
      {!q ? (
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => {
            haptics.select();
            setShowAll((s) => !s);
          }}
          style={styles.link}
        >
          <Text variant="small" weight="semibold" tone="cyan">
            {showAll ? 'Show fewer' : `Show all ${options.length} options`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/* ───────────────────────────── Multi select (allergies) ───────────────────────────── */

function MultiPicker({ prompt, busy, onAnswer }: PickerProps) {
  const options = useMemo(() => prompt.options ?? [], [prompt.options]);
  const exclusive = useMemo(() => new Set(prompt.exclusive ?? []), [prompt.exclusive]);
  const [selected, setSelected] = useState<string[]>([]);
  const [custom, setCustom] = useState<string[]>([]);
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v;

  function toggle(v: string) {
    setSelected((s) => {
      if (s.includes(v)) return s.filter((x) => x !== v);
      if (exclusive.has(v)) return [v];
      return [...s.filter((x) => !exclusive.has(x)), v];
    });
  }

  function addCustom(text: string) {
    const t = text.replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!t) return;
    const known = options.find((o) => o.value.toLowerCase() === t.toLowerCase() || o.label.toLowerCase() === t.toLowerCase());
    if (known) {
      if (!selected.includes(known.value)) toggle(known.value);
      return;
    }
    if (custom.some((c) => c.toLowerCase() === t.toLowerCase()) || custom.length >= 8) return;
    setCustom((c) => [...c, t]);
    setSelected((s) => [...s.filter((x) => !exclusive.has(x)), t]);
  }

  function removeCustom(v: string) {
    setCustom((c) => c.filter((x) => x !== v));
    setSelected((s) => s.filter((x) => x !== v));
  }

  const count = selected.length;
  return (
    <View style={styles.stack}>
      <View style={styles.wrap} accessibilityLabel="Choose all that apply">
        {options.map((o) => {
          const on = selected.includes(o.value);
          return <Chip key={o.value} label={o.label} role="checkbox" selected={on} icon={on ? 'check' : undefined} disabled={busy} onPress={() => toggle(o.value)} />;
        })}
        {custom.map((c) => (
          <Chip key={`custom-${c}`} label={c} role="button" selected icon="x" accessibilityHint="Removes this item" disabled={busy} onPress={() => removeCustom(c)} />
        ))}
      </View>
      {prompt.allow_custom ? <InlineText label="Add another" placeholder={prompt.placeholder} busy={busy} maxLength={40} clearOnSubmit onSubmit={addCustom} /> : null}
      <Button
        label={count === 0 ? 'Pick at least one' : selected.some((s) => exclusive.has(s)) ? 'Continue' : `Continue (${count})`}
        iconRight={count > 0 ? 'arrow-right' : undefined}
        variant="primary"
        size="lg"
        block
        disabled={count === 0}
        loading={busy}
        onPress={() => onAnswer(selected, selected.map(labelOf).join(', '))}
      />
    </View>
  );
}

/* ───────────────────────────── Numbers with units ───────────────────────────── */

const UNIT_LABEL: Record<string, string> = { cm: 'cm', ft: 'ft / in', kg: 'kg', lb: 'lb' };
const NUMERIC = /^\d+(?:[.,]\d+)?$/;

function NumberAnswer({ prompt, busy, onAnswer }: PickerProps) {
  const units = prompt.units;
  const [unit, setUnit] = useState(units?.[0] ?? '');
  const [value, setValue] = useState('');
  const [feet, setFeet] = useState('');
  const [inches, setInches] = useState('');

  const imperialHeight = unit === 'ft';
  const suffix = unit || prompt.unit_hint;
  // Example numbers in the server's placeholder are metric; convert for pounds.
  const example = Number(prompt.placeholder?.match(/\d+(?:\.\d+)?/)?.[0]);
  const placeholder = Number.isFinite(example) ? `e.g. ${unit === 'lb' ? Math.round(example * 2.2046) : example}` : undefined;
  const sendable = (v: string, ft: string, inch: string) =>
    imperialHeight ? NUMERIC.test(ft.trim()) && (!inch.trim() || NUMERIC.test(inch.trim())) : !!v.trim();
  const canSend = sendable(value, feet, inches);

  function changeUnit(u: string) {
    setUnit(u);
    setValue('');
    setFeet('');
    setInches('');
  }

  /** `typed`: the submitting field's own text (Return on the keyboard), fresher than state after fast typing. */
  function submit(typed: { value?: string; feet?: string; inches?: string } = {}) {
    const v = typed.value ?? value;
    const ft = typed.feet ?? feet;
    const inch = typed.inches ?? inches;
    if (busy || !sendable(v, ft, inch)) return;
    if (imperialHeight) {
      const f = Math.floor(Number(ft.replace(',', '.')));
      const i = inch.trim() ? Number(inch.replace(',', '.')) : 0;
      onAnswer(`${f}'${i}"`, `${f} ft ${i} in`);
      return;
    }
    const raw = v.trim().replace(',', '.');
    if (!NUMERIC.test(raw)) {
      onAnswer(raw, raw); // free text like "5'8" or "70kg" — the server parses it
      return;
    }
    if (units?.length) onAnswer(`${raw} ${unit}`, `${raw} ${unit}`);
    else onAnswer(Number(raw), raw);
  }

  const skip = prompt.optional ? (prompt.options ?? []) : [];

  return (
    <View style={styles.stack}>
      {units && units.length > 1 ? (
        <View style={styles.unitsRow}>
          <Text variant="eyebrow" tone="subtle">
            Units
          </Text>
          <Segmented
            accessibilityLabel="Units"
            size="sm"
            value={unit}
            onChange={changeUnit}
            options={units.map((u) => ({ value: u, label: UNIT_LABEL[u] ?? u }))}
            style={styles.units}
          />
        </View>
      ) : null}
      <View style={styles.inline}>
        {imperialHeight ? (
          <>
            <Field value={feet} onChangeText={setFeet} suffix="ft" label="Height — feet" placeholder="5" keyboardType="number-pad" maxLength={1} onSubmit={(t) => submit({ feet: t })} />
            <Field value={inches} onChangeText={setInches} suffix="in" label="Height — inches" placeholder="6" keyboardType="decimal-pad" maxLength={4} onSubmit={(t) => submit({ inches: t })} />
          </>
        ) : (
          <Field
            value={value}
            onChangeText={setValue}
            suffix={suffix}
            label={suffix ? `Your answer in ${suffix}` : 'Your answer'}
            placeholder={placeholder}
            keyboardType="decimal-pad"
            maxLength={12}
            onSubmit={(t) => submit({ value: t })}
          />
        )}
        <SendButton disabled={busy || !canSend} onPress={() => submit()} />
      </View>
      {skip.length > 0 ? (
        <View style={styles.wrap}>
          {skip.map((o) => (
            <Chip key={o.value} label={o.label} size="sm" disabled={busy} onPress={() => onAnswer(o.value, o.label)} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/* ───────────────────────────── Free text (lifestyle) ───────────────────────────── */

function TextAnswer({ prompt, busy, onAnswer }: PickerProps) {
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const answerWith = (typed: string) => [...picked, typed.trim()].filter(Boolean).join(', ');
  const answer = answerWith(text);
  const suggestions = prompt.options ?? [];

  const submit = (typed: string = text) => {
    const a = answerWith(typed);
    if (busy || !a || a.length > 300) return;
    onAnswer(a, a);
  };

  return (
    <View style={styles.stack}>
      {suggestions.length > 0 ? (
        <View style={styles.wrap} accessibilityLabel="Suggestions">
          {suggestions.map((o) => {
            const on = picked.includes(o.value);
            return (
              <Chip
                key={o.value}
                label={o.label}
                size="sm"
                role="checkbox"
                selected={on}
                icon={on ? 'check' : 'plus'}
                disabled={busy}
                onPress={() => setPicked((p) => (on ? p.filter((x) => x !== o.value) : [...p, o.value]))}
              />
            );
          })}
        </View>
      ) : null}
      <View style={[styles.inline, styles.inlineBottom]}>
        <Field
          value={text}
          onChangeText={setText}
          placeholder={picked.length ? 'Anything else? (optional)' : prompt.placeholder}
          label="Tell ÖRZA about your routine"
          maxLength={240}
          multiline
          onSubmit={submit}
        />
        <SendButton disabled={busy || !answer || answer.length > 300} onPress={() => submit()} />
      </View>
      {prompt.optional ? (
        <Pressable accessibilityRole="button" hitSlop={8} disabled={busy} onPress={() => onAnswer('skip', 'Skip for now')} style={styles.link}>
          <Text variant="small" weight="medium" tone="muted" style={styles.underline}>
            Skip for now
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/* ───────────────────────────── Summary ───────────────────────────── */

function SummaryActions({ prompt, busy, onAnswer }: PickerProps) {
  const confirm = prompt.options?.find((o) => o.value === 'confirm')?.label ?? "Looks good — let's go";
  const restart = prompt.options?.find((o) => o.value === 'restart')?.label ?? 'Start over';
  return (
    <View style={styles.stack}>
      <Button label={confirm} iconRight="arrow-right" variant="energy" size="lg" block loading={busy} onPress={() => onAnswer('confirm', confirm)} />
      <Button label={restart} icon="rotate-ccw" variant="secondary" block disabled={busy} onPress={() => onAnswer('restart', restart)} />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  cards: { gap: spacing.sm },
  inline: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  inlineBottom: { alignItems: 'flex-end' },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 50,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.hairline,
    backgroundColor: colors.glassSolid,
  },
  fieldMultiline: { borderRadius: 25 },
  fieldFocused: { borderColor: colors.cyan, backgroundColor: colors.white },
  input: { flex: 1, minHeight: 48, paddingHorizontal: 18, fontFamily: fonts.body, fontSize: 16, color: colors.ink },
  inputMultiline: { maxHeight: 112, paddingTop: 12, paddingBottom: 12 },
  suffix: { paddingRight: 18, textTransform: 'uppercase' },
  send: { width: 50, height: 50, borderRadius: 25, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  sendDisabled: { opacity: 0.3 },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    backgroundColor: colors.glassSolid,
  },
  optionText: { flex: 1 },
  optionHint: { marginTop: 2 },
  unitsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  units: { width: 180 },
  link: { alignSelf: 'flex-start', paddingVertical: 4 },
  underline: { textDecorationLine: 'underline' },
});
