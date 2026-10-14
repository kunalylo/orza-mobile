/** Prompt + filters for a personalised recipe. Chips fill the prompt; nothing is spent until "Generate recipe". */
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { formatNumber } from '@/features/chat/format';
import { haptics } from '@/lib/haptics';
import type { Diet } from '@/lib/types';
import { colors, radii, spacing } from '@/theme';
import { Button, Chip, GlassCard, Icon, Sheet, Text, TextField } from '@/ui';

import { CALORIE_OPTIONS, CUISINE_GROUPS, DIET_LABELS, EXAMPLE_PROMPTS, cuisineLabel, type GenerateRequest } from './types';

export type GeneratorErrors = Partial<Record<'prompt' | 'max_calories' | 'cuisine' | 'diet', string>>;

function ChipRow({ label, children, error }: { label: string; children: ReactNode; error?: string }) {
  return (
    <View style={styles.group}>
      <Text variant="label" style={styles.groupLabel}>
        {label}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow} style={styles.chipScroll} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
      {error ? (
        <Text variant="caption" tone="error" style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function RecipeGenerator({
  aiEnabled,
  cost,
  credits,
  myDiets,
  generating,
  errors,
  onClearError,
  onGenerate,
}: {
  aiEnabled: boolean | null;
  cost: number;
  credits: number;
  /** Diets applied when none is picked here (profile + learned in chat), strictest first. */
  myDiets: Diet[];
  generating: boolean;
  errors: GeneratorErrors;
  onClearError: (field: keyof GeneratorErrors) => void;
  onGenerate: (req: GenerateRequest) => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [cuisine, setCuisine] = useState('');
  const [maxCalories, setMaxCalories] = useState<number | null>(null);
  const [diet, setDiet] = useState<Diet | null>(null);
  const [cuisineOpen, setCuisineOpen] = useState(false);

  function submit() {
    if (generating) return;
    onGenerate({
      prompt: prompt.trim() || undefined,
      cuisine: cuisine || undefined,
      max_calories: maxCalories ?? undefined,
      diet: diet ?? undefined,
    });
  }

  const lowCredits = !!aiEnabled && credits < cost;
  const hint =
    aiEnabled == null
      ? 'Your allergies are always avoided.'
      : aiEnabled
        ? lowCredits
          ? `Uses ${cost} AI credits — you have ${formatNumber(credits)}, so ÖRZA will pick from its curated collection for free.`
          : `Uses ${cost} AI credits · ${formatNumber(credits)} left. Your allergies are always avoided.`
        : "Free — picked from ÖRZA's curated collection of Indian and global recipes. Your allergies are always avoided.";

  const dietOptions = (Object.keys(DIET_LABELS) as Diet[]).filter((d) => !(myDiets.length === 1 && d === myDiets[0]));
  const myDietLabel = myDiets.length ? `My diet (${myDiets.map((d) => DIET_LABELS[d]).join(' · ')})` : 'No restriction';

  return (
    <GlassCard tone="strong" glow padding={spacing.xl}>
      <Text variant="eyebrow" tone="energy">
        Recipe studio
      </Text>
      <Text variant="h2" style={styles.title} accessibilityRole="header">
        What would you like to cook?
      </Text>
      <Text variant="small" tone="muted" style={styles.lead}>
        Describe a craving, a meal or what&apos;s in your fridge. ÖRZA tunes it to your diet, allergies and calorie budget.
      </Text>

      <TextField
        icon="mci:creation"
        value={prompt}
        onChangeText={(t) => {
          setPrompt(t.slice(0, 300));
          if (errors.prompt) onClearError('prompt');
        }}
        placeholder="e.g. high-protein veg dinner under 500 kcal"
        maxLength={300}
        autoCorrect
        returnKeyType="go"
        onSubmitEditing={submit}
        error={errors.prompt}
        accessibilityLabel="Describe the recipe you want"
        containerStyle={styles.prompt}
      />

      <View style={styles.tryRow}>
        <Text variant="eyebrow" tone="subtle" style={styles.tryLabel}>
          Try
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow} style={styles.chipScroll} keyboardShouldPersistTaps="handled">
          {EXAMPLE_PROMPTS.map((ex) => (
            <Chip
              key={ex}
              size="sm"
              label={ex}
              selected={prompt === ex}
              onPress={() => {
                setPrompt(ex);
                if (errors.prompt) onClearError('prompt');
              }}
              accessibilityHint="Fills in the request"
            />
          ))}
        </ScrollView>
      </View>

      <View style={styles.group}>
        <Text variant="label" style={styles.groupLabel}>
          Cuisine
        </Text>
        <Pressable
          onPress={() => {
            haptics.tap();
            setCuisineOpen(true);
          }}
          style={[styles.select, !!errors.cuisine && styles.selectError]}
          accessibilityRole="button"
          accessibilityLabel={`Cuisine: ${cuisine ? cuisineLabel(cuisine) : 'Any cuisine'}`}
          accessibilityHint="Opens the cuisine list"
        >
          <Icon name="mci:silverware-fork-knife" size={17} color={colors.muted} />
          <Text variant="callout" style={styles.selectText} numberOfLines={1}>
            {cuisine ? cuisineLabel(cuisine) : 'Any cuisine'}
          </Text>
          <Icon name="chevron-down" size={18} color={colors.muted} />
        </Pressable>
        {errors.cuisine ? (
          <Text variant="caption" tone="error" style={styles.error}>
            {errors.cuisine}
          </Text>
        ) : null}
      </View>

      <ChipRow label="Max calories" error={errors.max_calories}>
        <Chip
          size="sm"
          role="radio"
          label="No limit"
          selected={maxCalories == null}
          onPress={() => {
            setMaxCalories(null);
            if (errors.max_calories) onClearError('max_calories');
          }}
        />
        {CALORIE_OPTIONS.map((c) => (
          <Chip
            key={c}
            size="sm"
            role="radio"
            label={`Under ${c} kcal`}
            selected={maxCalories === c}
            onPress={() => {
              setMaxCalories(c);
              if (errors.max_calories) onClearError('max_calories');
            }}
          />
        ))}
      </ChipRow>

      <ChipRow label="Diet" error={errors.diet}>
        <Chip
          size="sm"
          role="radio"
          label={myDietLabel}
          selected={diet == null}
          onPress={() => {
            setDiet(null);
            if (errors.diet) onClearError('diet');
          }}
        />
        {dietOptions.map((d) => (
          <Chip
            key={d}
            size="sm"
            role="radio"
            label={DIET_LABELS[d]}
            selected={diet === d}
            onPress={() => {
              setDiet(d);
              if (errors.diet) onClearError('diet');
            }}
          />
        ))}
      </ChipRow>

      <Text variant="caption" tone="subtle" style={styles.hint}>
        {hint}
      </Text>
      <Button
        label={generating ? 'Creating your recipe…' : 'Generate recipe'}
        icon={generating ? undefined : 'mci:creation'}
        variant="energy"
        size="lg"
        block
        loading={generating}
        haptic="firm"
        onPress={submit}
        style={styles.cta}
      />

      <Sheet visible={cuisineOpen} onClose={() => setCuisineOpen(false)} eyebrow="Recipe studio" title="Choose a cuisine">
        <Chip
          role="radio"
          label="Any cuisine"
          selected={!cuisine}
          onPress={() => {
            setCuisine('');
            setCuisineOpen(false);
          }}
          style={styles.anyChip}
        />
        {CUISINE_GROUPS.map((g) => (
          <View key={g.label} style={styles.sheetGroup}>
            <Text variant="eyebrow" tone="subtle">
              {g.label}
            </Text>
            <View style={styles.wrap}>
              {g.options.map((o) => (
                <Chip
                  key={o.value}
                  role="radio"
                  size="sm"
                  label={o.label}
                  selected={cuisine === o.value}
                  onPress={() => {
                    setCuisine(o.value);
                    if (errors.cuisine) onClearError('cuisine');
                    setCuisineOpen(false);
                  }}
                />
              ))}
            </View>
          </View>
        ))}
      </Sheet>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  title: { marginTop: spacing.sm },
  lead: { marginTop: 6 },
  prompt: { marginTop: spacing.lg },
  tryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  tryLabel: { fontSize: 10 },
  chipScroll: { flexGrow: 0, marginRight: -spacing.xl },
  chipRow: { gap: spacing.sm, paddingRight: spacing.xl },
  group: { marginTop: spacing.lg },
  groupLabel: { marginBottom: spacing.sm, marginLeft: 2 },
  select: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 52,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    backgroundColor: colors.glassSolid,
  },
  selectError: { borderColor: colors.error },
  selectText: { flex: 1 },
  error: { marginTop: 6, marginLeft: 4 },
  hint: { marginTop: spacing.xl },
  cta: { marginTop: spacing.md },
  anyChip: { alignSelf: 'flex-start' },
  sheetGroup: { gap: spacing.sm, marginTop: spacing.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
