/**
 * Editable meal-item rows (meal edits, custom food-list items). Numbers stay strings while typing; `per` keeps
 * per-unit values so changing the quantity rescales nutrition without rounding drift (same model as the web).
 */
import { StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';

import { haptics } from '@/lib/haptics';
import { colors, fonts, radii, spacing } from '@/theme';
import { Button, IconButton, Tag, Text, useLayoutTransition } from '@/ui';

import { Stepper } from './Stepper';
import type { MealItem, MealItemInput, Nutrients } from './types';
import { ITEM_LIMITS, MAX_ITEMS, round, sumNutrients } from './utils';

export type DraftItem = {
  uid: string;
  name: string;
  unit: string;
  quantity: string;
  calories: string;
  protein_g: string;
  carbs_g: string;
  fat_g: string;
  fiber_g: number;
  grams?: number;
  confidence?: number;
  per: Nutrients & { grams?: number };
};

type NumField = 'calories' | 'protein_g' | 'carbs_g' | 'fat_g';
type Field = 'name' | 'unit' | 'quantity' | NumField;

let seq = 0;
const uid = () => `item-${Date.now().toString(36)}-${(seq++).toString(36)}`;

/** "1,5" / " 2 " → number; "" or junk → NaN. */
export function toNum(s: string): number {
  const t = s.trim().replace(',', '.');
  if (!t) return NaN;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

/** A stored optional number (MongoDB returns missing ones as `null`) → a finite number or undefined. */
const optNum = (v: number | null | undefined): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export function toDraft(i: MealItem): DraftItem {
  const q = i.quantity > 0 ? i.quantity : 1;
  const grams = optNum(i.grams);
  return {
    uid: uid(),
    name: i.name,
    unit: i.unit,
    quantity: String(round(q, 2)),
    calories: String(Math.round(i.calories)),
    protein_g: String(round(i.protein_g, 1)),
    carbs_g: String(round(i.carbs_g, 1)),
    fat_g: String(round(i.fat_g, 1)),
    fiber_g: i.fiber_g || 0,
    grams,
    confidence: optNum(i.confidence),
    per: {
      calories: i.calories / q,
      protein_g: i.protein_g / q,
      carbs_g: i.carbs_g / q,
      fat_g: i.fat_g / q,
      fiber_g: (i.fiber_g || 0) / q,
      grams: grams != null ? grams / q : undefined,
    },
  };
}

export function blankDraft(): DraftItem {
  return {
    uid: uid(),
    name: '',
    unit: 'serving',
    quantity: '1',
    calories: '',
    protein_g: '',
    carbs_g: '',
    fat_g: '',
    fiber_g: 0,
    per: { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 },
  };
}

type RowErrors = Partial<Record<'name' | 'quantity' | NumField, string>>;

export function rowErrors(d: DraftItem): RowErrors {
  const q = toNum(d.quantity);
  const kcal = toNum(d.calories);
  const macro = (s: string, max: number) => s.trim() !== '' && !(toNum(s) >= 0 && toNum(s) <= max);
  const e: RowErrors = {};
  if (!d.name.trim()) e.name = 'Give this item a name';
  if (!(q > 0 && q <= ITEM_LIMITS.quantity)) e.quantity = `Quantity must be more than 0 and at most ${ITEM_LIMITS.quantity}`;
  if (!(kcal >= 0 && kcal <= ITEM_LIMITS.calories)) e.calories = `Calories: 0–${ITEM_LIMITS.calories}`;
  if (macro(d.protein_g, ITEM_LIMITS.protein_g)) e.protein_g = `Protein: 0–${ITEM_LIMITS.protein_g} g`;
  if (macro(d.carbs_g, ITEM_LIMITS.carbs_g)) e.carbs_g = `Carbs: 0–${ITEM_LIMITS.carbs_g} g`;
  if (macro(d.fat_g, ITEM_LIMITS.fat_g)) e.fat_g = `Fat: 0–${ITEM_LIMITS.fat_g} g`;
  return e;
}

export const draftsValid = (rows: DraftItem[]) => rows.length > 0 && rows.every((r) => Object.keys(rowErrors(r)).length === 0);

/** A valid draft → the API item shape. Optional numbers are only sent when known (never as `null`). */
export function fromDraft(d: DraftItem): MealItemInput {
  const n = (s: string) => Math.max(0, toNum(s) || 0);
  const item: MealItemInput = {
    name: d.name.trim(),
    quantity: round(toNum(d.quantity), 2),
    unit: d.unit.trim() || 'serving',
    calories: Math.round(n(d.calories)),
    protein_g: round(n(d.protein_g), 1),
    carbs_g: round(n(d.carbs_g), 1),
    fat_g: round(n(d.fat_g), 1),
    fiber_g: Math.min(ITEM_LIMITS.fiber_g, round(d.fiber_g || 0, 1)),
  };
  const grams = optNum(d.grams);
  if (grams != null) item.grams = Math.min(ITEM_LIMITS.grams, Math.max(0, Math.round(grams)));
  const confidence = optNum(d.confidence);
  if (confidence != null) item.confidence = Math.min(1, Math.max(0, round(confidence, 2)));
  return item;
}

export function draftTotals(rows: DraftItem[]): Nutrients {
  const n = (s: string) => Math.max(0, toNum(s) || 0);
  return sumNutrients(
    rows.map((r) => ({ calories: n(r.calories), protein_g: n(r.protein_g), carbs_g: n(r.carbs_g), fat_g: n(r.fat_g), fiber_g: r.fiber_g }))
  );
}

/** Apply a field edit, rescaling nutrition when the quantity changes. */
function applyEdit(row: DraftItem, field: Field, value: string): DraftItem {
  if (field === 'name' || field === 'unit') return { ...row, [field]: value };
  if (field === 'quantity') {
    const q = toNum(value);
    if (!(q > 0)) return { ...row, quantity: value };
    const p = row.per;
    // Blank custom rows have no per-unit values yet — don't overwrite what the user typed.
    const hasBase = p.calories > 0 || p.protein_g > 0 || p.carbs_g > 0 || p.fat_g > 0;
    if (!hasBase) return { ...row, quantity: value };
    return {
      ...row,
      quantity: value,
      calories: String(Math.round(p.calories * q)),
      protein_g: String(round(p.protein_g * q, 1)),
      carbs_g: String(round(p.carbs_g * q, 1)),
      fat_g: String(round(p.fat_g * q, 1)),
      fiber_g: round(p.fiber_g * q, 1),
      grams: p.grams != null ? Math.round(p.grams * q) : row.grams,
    };
  }
  const v = toNum(value);
  const q = toNum(row.quantity);
  const per = v >= 0 && q > 0 ? { ...row.per, [field]: v / q } : row.per;
  return { ...row, [field]: value, per };
}

/* ───────────────────────────── UI ───────────────────────────── */

function SmallField({
  label,
  value,
  onChange,
  error,
  numeric = true,
  placeholder,
  maxLength,
  accessibilityLabel,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  numeric?: boolean;
  placeholder?: string;
  maxLength?: number;
  accessibilityLabel?: string;
}) {
  return (
    <View style={styles.small}>
      <Text variant="eyebrow" tone="subtle" style={styles.smallLabel} numberOfLines={1}>
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="rgba(20,20,20,0.35)"
        keyboardType={numeric ? 'decimal-pad' : 'default'}
        maxLength={maxLength ?? (numeric ? 8 : undefined)}
        autoComplete="off"
        autoCorrect={!numeric}
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityHint={error}
        maxFontSizeMultiplier={1.3}
        selectionColor={colors.cyan600}
        style={[styles.smallInput, numeric && styles.nums, error ? styles.smallInvalid : null]}
      />
    </View>
  );
}

export function ItemEditor({
  rows,
  onChange,
  showErrors = false,
  addLabel = 'Add item',
}: {
  rows: DraftItem[];
  onChange: (rows: DraftItem[]) => void;
  /** Highlight invalid fields (after a save attempt). Blank new rows stay calm until then. */
  showErrors?: boolean;
  addLabel?: string;
}) {
  const layoutTransition = useLayoutTransition();
  const update = (id: string, field: Field, value: string) => onChange(rows.map((r) => (r.uid === id ? applyEdit(r, field, value) : r)));
  const remove = (id: string) => {
    haptics.soft();
    onChange(rows.filter((r) => r.uid !== id));
  };
  const add = () => {
    haptics.tap();
    onChange([...rows, blankDraft()]);
  };

  return (
    <View>
      <View style={styles.list}>
        {rows.map((r, idx) => {
          const errs = showErrors ? rowErrors(r) : {};
          const messages = Object.values(errs);
          const low = r.confidence != null && r.confidence < 0.55;
          const name = r.name.trim() || `item ${idx + 1}`;
          const q = toNum(r.quantity);
          return (
            <Animated.View
              key={r.uid}
              entering={FadeInDown.springify().damping(18).stiffness(100).mass(1)}
              exiting={FadeOut.duration(150)}
              layout={layoutTransition}
              style={styles.row}
            >
              <View style={styles.nameRow}>
                <View style={styles.flex}>
                  <SmallField
                    label={`Item ${idx + 1}`}
                    value={r.name}
                    numeric={false}
                    maxLength={80}
                    placeholder="e.g. Dal tadka"
                    error={errs.name}
                    onChange={(v) => update(r.uid, 'name', v)}
                    accessibilityLabel={`Item ${idx + 1} name`}
                  />
                </View>
                <IconButton icon="trash-2" variant="plain" size={40} iconSize={16} color={colors.muted} accessibilityLabel={`Remove ${name}`} onPress={() => remove(r.uid)} haptic="none" style={styles.trash} />
              </View>
              {low ? <Tag tone="warning" label="ÖRZA wasn't sure about this one — please check" style={styles.lowTag} /> : null}

              <View style={styles.qtyRow}>
                <Stepper
                  compact
                  value={q > 0 ? q : 1}
                  min={0.25}
                  max={ITEM_LIMITS.quantity}
                  step={0.5}
                  label={`Quantity of ${name}`}
                  onChange={(v) => update(r.uid, 'quantity', String(v))}
                />
                <View style={styles.unit}>
                  <SmallField label="Unit" value={r.unit} numeric={false} maxLength={24} onChange={(v) => update(r.uid, 'unit', v)} accessibilityLabel={`Unit for ${name}`} />
                </View>
              </View>

              <View style={styles.grid}>
                <SmallField label="kcal" value={r.calories} placeholder="0" error={errs.calories} onChange={(v) => update(r.uid, 'calories', v)} accessibilityLabel={`Calories for ${name}`} />
                <SmallField label="Protein g" value={r.protein_g} placeholder="0" error={errs.protein_g} onChange={(v) => update(r.uid, 'protein_g', v)} accessibilityLabel={`Protein grams for ${name}`} />
                <SmallField label="Carbs g" value={r.carbs_g} placeholder="0" error={errs.carbs_g} onChange={(v) => update(r.uid, 'carbs_g', v)} accessibilityLabel={`Carbs grams for ${name}`} />
                <SmallField label="Fat g" value={r.fat_g} placeholder="0" error={errs.fat_g} onChange={(v) => update(r.uid, 'fat_g', v)} accessibilityLabel={`Fat grams for ${name}`} />
              </View>
              {messages.length ? (
                <Text variant="caption" tone="error" style={styles.err} accessibilityLiveRegion="polite">
                  {messages.join(' · ')}
                </Text>
              ) : null}
            </Animated.View>
          );
        })}
      </View>
      <View style={styles.footer}>
        <Button label={addLabel} icon="plus" variant="secondary" size="sm" onPress={add} disabled={rows.length >= MAX_ITEMS} haptic="none" />
        <Text variant="caption" tone="subtle" style={styles.flex}>
          Changing a quantity rescales its nutrition.
        </Text>
      </View>
      {showErrors && rows.length === 0 ? (
        <Text variant="caption" tone="error" style={styles.err}>
          Add at least one item.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { gap: spacing.md },
  row: {
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: 'rgba(255,255,255,0.7)',
    gap: spacing.sm,
  },
  nameRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs },
  trash: { marginBottom: 2 },
  lowTag: { alignSelf: 'flex-start' },
  qtyRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md },
  unit: { flex: 1 },
  grid: { flexDirection: 'row', gap: spacing.sm },
  small: { flex: 1, minWidth: 0 },
  smallLabel: { fontSize: 9.5, marginBottom: 4, marginLeft: 2 },
  smallInput: {
    height: 40,
    paddingHorizontal: 10,
    borderRadius: radii.xs,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    backgroundColor: colors.white,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.ink,
  },
  smallInvalid: { borderColor: colors.error, backgroundColor: colors.errorBg },
  nums: { fontVariant: ['tabular-nums'] },
  err: { marginTop: 2 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md },
});
