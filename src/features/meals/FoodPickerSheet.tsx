import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type TextInput } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { errorMessage } from '@/lib/api';
import { useSignedInUser } from '@/lib/auth';
import { haptics } from '@/lib/haptics';
import { colors, radii, spacing } from '@/theme';
import { Button, Chip, Icon, Segmented, Sheet, Skeleton, Text, TextField, toast } from '@/ui';

import { useAddManualMeal, useFoodSearch } from './api';
import { ItemEditor, blankDraft, draftTotals, draftsValid, fromDraft, type DraftItem } from './ItemEditor';
import { Stepper } from './Stepper';
import type { FoodDietMark, FoodHit, Meal, MealType } from './types';
import { DIET_MARK, MEAL_SINGULAR, MEAL_TYPES, fmtQty, foodNutrients, formatNumber, maxServingsFor, quickPicksFor, round } from './utils';

/** The familiar Indian veg / non-veg square mark. */
export function DietMark({ diet }: { diet: FoodDietMark }) {
  const d = DIET_MARK[diet] ?? DIET_MARK.veg;
  return (
    <View style={[styles.diet, { borderColor: d.color }]} accessible accessibilityLabel={d.label}>
      <View style={[styles.dietDot, { backgroundColor: d.color }]} />
    </View>
  );
}

function MealTypeChips({ value, onChange }: { value: MealType; onChange: (t: MealType) => void }) {
  return (
    <View style={styles.block}>
      <Text variant="label" tone="ink">
        Add to
      </Text>
      <View style={styles.chips} accessibilityRole="radiogroup">
        {MEAL_TYPES.map((t) => (
          <Chip
            key={t}
            role="radio"
            size="sm"
            label={MEAL_SINGULAR[t]}
            selected={value === t}
            onPress={() => onChange(t)}
          />
        ))}
      </View>
    </View>
  );
}

function NutrientGrid({ calories, protein, carbs, fat, approx }: { calories: number; protein: number; carbs: number; fat: number; approx?: boolean }) {
  const cells = [
    { label: 'kcal', value: `${approx ? '≈' : ''}${formatNumber(calories)}` },
    { label: 'Protein', value: `${round(protein, 1)}g` },
    { label: 'Carbs', value: `${round(carbs, 1)}g` },
    { label: 'Fat', value: `${round(fat, 1)}g` },
  ];
  return (
    <View style={styles.grid}>
      {cells.map((c) => (
        <View key={c.label} style={styles.cell} accessible accessibilityLabel={`${c.label} ${c.value}`}>
          <Text variant="title" tone="ink" style={styles.nums} numberOfLines={1} adjustsFontSizeToFit>
            {c.value}
          </Text>
          <Text variant="eyebrow" tone="subtle" style={styles.cellLabel}>
            {c.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** "Add from food list": debounced search of ÖRZA's food list, or custom items (e.g. from a nutrition label). */
export function FoodPickerSheet({
  visible,
  onClose,
  date,
  defaultMealType,
  initialQuery,
  onAdded,
}: {
  visible: boolean;
  onClose: () => void;
  date: string;
  defaultMealType: MealType;
  initialQuery?: string;
  onAdded: (meal: Meal) => void;
}) {
  const user = useSignedInUser();
  const [tab, setTab] = useState<'search' | 'custom'>('search');
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [selected, setSelected] = useState<FoodHit | null>(null);
  const [qty, setQty] = useState(1);
  const [style, setStyle] = useState<'home' | 'restaurant'>('home');
  const [mealType, setMealType] = useState<MealType>(defaultMealType);
  const [custom, setCustom] = useState<DraftItem[]>(() => [blankDraft()]);
  const [showErrors, setShowErrors] = useState(false);
  const [wasVisible, setWasVisible] = useState(false);
  const searchRef = useRef<TextInput>(null);
  const add = useAddManualMeal();
  const saving = add.isPending;

  // Fresh state every time the sheet opens.
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setTab('search');
      setQ(initialQuery ?? '');
      setTerm((initialQuery ?? '').trim());
      setSelected(null);
      setQty(1);
      setStyle('home');
      setMealType(defaultMealType);
      setCustom([blankDraft()]);
      setShowErrors(false);
    }
  }

  // Debounce typing → search term.
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  // Focus the search box once the sheet has sprung up (not when arriving with a phrase to look at).
  useEffect(() => {
    if (!visible || initialQuery) return;
    const t = setTimeout(() => searchRef.current?.focus(), 380);
    return () => clearTimeout(t);
  }, [visible, initialQuery]);

  const search = useFoodSearch(tab === 'search' && visible ? term : '');
  const results = search.data ?? [];
  const typing = q.trim() !== term;
  const quickPicks = quickPicksFor(user.profile?.diet, user.profile?.allergies);

  // One entry holds at most 20 servings, and never more than the per-item limits allow for rich dishes.
  const maxQty = selected ? Math.max(0.5, Math.floor(maxServingsFor(selected, style === 'restaurant') * 2) / 2) : 20;
  const servings = Math.min(qty, maxQty);
  const preview = selected ? foodNutrients(selected, servings, style === 'restaurant') : null;
  const customTotals = draftTotals(custom);

  const pick = (f: FoodHit) => {
    haptics.tap();
    searchRef.current?.blur();
    setSelected(f);
    setQty(1);
    setStyle('home');
  };

  const done = (meal: Meal, message: string) => {
    haptics.success();
    toast.success(message);
    onAdded(meal);
    onClose();
  };

  const addFood = () => {
    if (!selected || saving) return;
    add.mutate(
      { food_key: selected.key, quantity: servings, restaurant: style === 'restaurant', meal_type: mealType, date },
      {
        onSuccess: ({ meal }) => done(meal, `Added ${fmtQty(servings)} × ${selected.name} to ${MEAL_SINGULAR[mealType].toLowerCase()}`),
        onError: (e) => {
          haptics.error();
          toast.error(errorMessage(e));
        },
      }
    );
  };

  const addCustom = () => {
    if (saving) return;
    setShowErrors(true);
    if (!draftsValid(custom)) {
      haptics.error();
      toast.error('Please check the highlighted fields.');
      return;
    }
    add.mutate(
      { items: custom.map(fromDraft), meal_type: mealType, date },
      {
        onSuccess: ({ meal }) => done(meal, `Added to ${MEAL_SINGULAR[mealType].toLowerCase()}`),
        onError: (e) => {
          haptics.error();
          toast.error(errorMessage(e));
        },
      }
    );
  };

  const footer =
    tab === 'search' && selected ? (
      <Button
        label={`Add ${fmtQty(servings)} × ${selected.name.length > 22 ? 'item' : selected.name}`}
        variant="energy"
        size="lg"
        block
        icon="plus"
        loading={saving}
        onPress={addFood}
        haptic="none"
      />
    ) : tab === 'custom' ? (
      <Button
        label={`Add to ${MEAL_SINGULAR[mealType].toLowerCase()}`}
        variant="energy"
        size="lg"
        block
        icon="plus"
        loading={saving}
        disabled={custom.length === 0}
        onPress={addCustom}
        haptic="none"
      />
    ) : undefined;

  return (
    <Sheet visible={visible} onClose={onClose} eyebrow="Food list · always free" title="Add from food list" full footer={footer} dismissible={!saving}>
      <Segmented
        accessibilityLabel="How to add food"
        size="sm"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'search', label: 'Search foods' },
          { value: 'custom', label: 'Custom item' },
        ]}
      />

      {tab === 'search' && !selected ? (
        <View style={styles.block}>
          <TextField
            ref={searchRef}
            icon="search"
            value={q}
            onChangeText={setQ}
            placeholder="Try roti, dal makhani, poha, dosa…"
            accessibilityLabel="Search foods"
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            maxLength={60}
            onSubmitEditing={() => setTerm(q.trim())}
          />

          {!q.trim() && quickPicks.length > 0 ? (
            <Animated.View entering={FadeIn.duration(180)} style={styles.block}>
              <Text variant="eyebrow" tone="subtle">
                Popular
              </Text>
              <View style={styles.chips}>
                {quickPicks.map((p) => (
                  <Chip
                    key={p}
                    label={p}
                    size="sm"
                    onPress={() => {
                      setQ(p);
                      setTerm(p);
                    }}
                  />
                ))}
              </View>
            </Animated.View>
          ) : null}

          {q.trim() ? (
            <View style={styles.results} accessibilityLiveRegion="polite">
              {(search.isPending && search.fetchStatus !== 'idle') || (typing && !results.length) ? (
                <View style={styles.skeletons} accessibilityLabel="Searching">
                  {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} height={48} radius={radii.sm} />
                  ))}
                </View>
              ) : search.isError ? (
                <View style={styles.center}>
                  <Icon name="wifi-off" size={20} color={colors.subtle} />
                  <Text variant="small" tone="muted" align="center">
                    {errorMessage(search.error)}
                  </Text>
                  <Button label="Try again" icon="refresh-cw" variant="secondary" size="sm" onPress={() => void search.refetch()} />
                </View>
              ) : results.length === 0 ? (
                <View style={styles.center}>
                  <Icon name="mci:silverware-fork-knife" size={22} color={colors.subtle} />
                  <Text variant="label" tone="ink" align="center">
                    No match for “{q.trim()}”
                  </Text>
                  <Text variant="small" tone="muted" align="center">
                    Try a simpler name, describe it in your own words in the composer, or add it as a custom item.
                  </Text>
                  <Button label="Add a custom item" variant="secondary" size="sm" onPress={() => setTab('custom')} />
                </View>
              ) : (
                <View>
                  {results.map((f, i) => (
                    <Animated.View key={f.key} entering={FadeInDown.delay(Math.min(i, 6) * 30).duration(220)}>
                      <Pressable
                        onPress={() => pick(f)}
                        accessibilityRole="button"
                        accessibilityLabel={`${f.name}, ${f.serving.label}, ${formatNumber(f.per_serving.calories)} calories per serving`}
                        style={({ pressed }) => [styles.result, i > 0 && styles.resultDivider, pressed && styles.pressed]}
                      >
                        <DietMark diet={f.diet} />
                        <View style={styles.resultText}>
                          <Text variant="label" tone="ink" numberOfLines={1}>
                            {f.name}
                          </Text>
                          <Text variant="caption" tone="muted" numberOfLines={1}>
                            {f.serving.label}
                            {f.category ? ` · ${f.category}` : ''}
                          </Text>
                        </View>
                        <Text variant="mono" tone="muted" style={styles.nums}>
                          {formatNumber(f.per_serving.calories)} kcal
                        </Text>
                        <Icon name="chevron-right" size={16} color={colors.subtle} />
                      </Pressable>
                    </Animated.View>
                  ))}
                </View>
              )}
            </View>
          ) : null}
        </View>
      ) : null}

      {tab === 'search' && selected && preview ? (
        <Animated.View entering={FadeInDown.springify().damping(18)} style={styles.block}>
          <Pressable onPress={() => setSelected(null)} accessibilityRole="button" hitSlop={8} style={styles.back}>
            <Icon name="arrow-left" size={15} color={colors.muted} />
            <Text variant="small" weight="medium" tone="muted">
              Back to results
            </Text>
          </Pressable>
          <View style={styles.selected}>
            <View style={styles.selectedHead}>
              <View style={styles.dietTop}>
                <DietMark diet={selected.diet} />
              </View>
              <View style={styles.flex}>
                <Text variant="h3" tone="ink">
                  {selected.name}
                </Text>
                <Text variant="small" tone="muted">
                  1 serving = {selected.serving.label}
                </Text>
              </View>
            </View>
            <View style={styles.controls}>
              <View style={styles.control}>
                <Text variant="label" tone="ink">
                  Servings
                </Text>
                <Stepper value={servings} onChange={setQty} max={maxQty} label="Servings" />
              </View>
              <View style={[styles.control, styles.flex]}>
                <Text variant="label" tone="ink">
                  Cooked
                </Text>
                <Segmented
                  accessibilityLabel="Where it was cooked"
                  size="sm"
                  value={style}
                  onChange={setStyle}
                  options={[
                    { value: 'home', label: 'At home' },
                    { value: 'restaurant', label: 'Restaurant' },
                  ]}
                />
              </View>
            </View>
            <NutrientGrid calories={preview.calories} protein={preview.protein_g} carbs={preview.carbs_g} fat={preview.fat_g} approx={style === 'restaurant'} />
            <Text variant="caption" tone="subtle">
              {style === 'restaurant'
                ? 'Restaurant versions use more oil, butter and cream — ÖRZA adds that to the estimate when you log it.'
                : 'Home-cooked estimate (e.g. home dal ≈ 5 ml oil per katori).'}
            </Text>
            {servings >= maxQty ? (
              <Text variant="caption" tone="warning">
                One entry holds up to {fmtQty(maxQty)} servings of this — add more as another entry.
              </Text>
            ) : null}
          </View>
          <MealTypeChips value={mealType} onChange={setMealType} />
        </Animated.View>
      ) : null}

      {tab === 'custom' ? (
        <Animated.View entering={FadeIn.duration(180)} style={styles.block}>
          <Text variant="small" tone="muted">
            Add your own item — handy for packaged food with a nutrition label.
          </Text>
          <ItemEditor rows={custom} onChange={setCustom} showErrors={showErrors} addLabel="Add another" />
          <View style={styles.totalRow}>
            <Text variant="small" tone="muted">
              Total
            </Text>
            <Text variant="mono" tone="ink" style={styles.totalText}>
              {formatNumber(customTotals.calories)} kcal · P {customTotals.protein_g}g · C {customTotals.carbs_g}g · F {customTotals.fat_g}g
            </Text>
          </View>
          <MealTypeChips value={mealType} onChange={setMealType} />
        </Animated.View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  nums: { fontVariant: ['tabular-nums'] },
  block: { marginTop: spacing.lg, gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  diet: { width: 14, height: 14, borderRadius: 3, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  dietDot: { width: 6, height: 6, borderRadius: 3 },
  results: {
    marginTop: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: 'rgba(255,255,255,0.6)',
    padding: spacing.xs,
  },
  skeletons: { gap: spacing.xs, padding: spacing.xs },
  center: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl, paddingHorizontal: spacing.lg },
  result: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: 12, borderRadius: radii.sm },
  resultDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  resultText: { flex: 1, minWidth: 0 },
  pressed: { backgroundColor: 'rgba(255,255,255,0.95)' },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 4 },
  selected: {
    padding: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: 'rgba(255,255,255,0.75)',
    gap: spacing.md,
  },
  selectedHead: { flexDirection: 'row', gap: spacing.md },
  dietTop: { marginTop: 7 },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, alignItems: 'flex-end' },
  control: { gap: spacing.sm, minWidth: 150 },
  grid: { flexDirection: 'row', gap: spacing.sm },
  cell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: 4,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.white,
  },
  cellLabel: { fontSize: 9.5, marginTop: 2 },
  totalRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  totalText: { fontSize: 11.5, flexShrink: 1, textAlign: 'right' },
});
