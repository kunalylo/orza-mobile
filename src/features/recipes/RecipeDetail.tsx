/** Full recipe body: tags, nutrition, ingredient checklist and numbered method. */
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';

import { colors, diagonal, gradients, radii, spacing } from '@/theme';
import { Icon, PressableScale, Tag, Text } from '@/ui';

import { NutritionRow } from './NutritionRow';
import { displayTags, type Recipe } from './types';

function IngredientRow({ text, checked, onToggle }: { text: string; checked: boolean; onToggle: () => void }) {
  return (
    <PressableScale
      onPress={onToggle}
      haptic="select"
      scaleTo={0.98}
      style={styles.ingredient}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={text}
    >
      {checked ? (
        <LinearGradient colors={gradients.energy} {...diagonal} style={[styles.box, styles.boxOn]}>
          <Icon name="check" size={13} color={colors.white} />
        </LinearGradient>
      ) : (
        <View style={styles.box} />
      )}
      <Text variant="callout" tone={checked ? 'subtle' : 'ink'} style={[styles.flex, checked && styles.struck]}>
        {text}
      </Text>
    </PressableScale>
  );
}

export function RecipeDetail({ recipe }: { recipe: Recipe }) {
  const reduce = useReducedMotion();
  const [checked, setChecked] = useState<Set<number>>(() => new Set());
  const tags = displayTags(recipe.tags);
  const rise = (d: number) => (reduce ? undefined : FadeInDown.delay(d).springify().damping(18));

  const toggle = (i: number) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <View>
      <Animated.View entering={rise(0)}>
        <Text variant="eyebrow" tone="energy">
          {recipe.source === 'ai' ? 'Created by ÖRZA AI' : "From ÖRZA's recipe collection"}
        </Text>
        <Text variant="h1" style={styles.title} accessibilityRole="header">
          {recipe.title}
        </Text>
        {recipe.description ? (
          <Text variant="callout" tone="muted" style={styles.desc}>
            {recipe.description}
          </Text>
        ) : null}
        {recipe.prompt ? (
          <Text variant="caption" tone="subtle" style={styles.prompt}>
            You asked: “{recipe.prompt}”
          </Text>
        ) : null}
        <View style={styles.tags}>
          <Tag label={recipe.cuisine} tone="violet" />
          <Tag label={`${recipe.prep_minutes} min`} icon="clock" />
          <Tag label={`Serves ${recipe.servings}`} icon="users" />
          {tags.map((t) => (
            <Tag key={t.key} label={t.label} tone={t.tone} />
          ))}
        </View>
        <NutritionRow nutrition={recipe.nutrition} style={styles.nutrition} />
      </Animated.View>

      <Animated.View entering={rise(80)} style={styles.section}>
        <View style={styles.sectionHead}>
          <Text variant="eyebrow" tone="subtle" accessibilityRole="header">
            Ingredients
          </Text>
          <Text variant="caption" tone="subtle" accessibilityLiveRegion="polite">
            {checked.size}/{recipe.ingredients.length} ready
          </Text>
        </View>
        <View style={styles.card}>
          {recipe.ingredients.map((ing, i) => (
            <IngredientRow key={i} text={ing} checked={checked.has(i)} onToggle={() => toggle(i)} />
          ))}
        </View>
      </Animated.View>

      <Animated.View entering={rise(140)} style={styles.section}>
        <Text variant="eyebrow" tone="subtle" accessibilityRole="header" style={styles.methodHead}>
          Method
        </Text>
        <View style={styles.steps}>
          {recipe.steps.map((step, i) => (
            <View key={i} style={styles.step} accessible accessibilityLabel={`Step ${i + 1}: ${step}`}>
              <View style={styles.stepNum}>
                <Text variant="mono" tone="energy" style={styles.stepNumText}>
                  {i + 1}
                </Text>
              </View>
              <Text variant="callout" style={styles.flex}>
                {step}
              </Text>
            </View>
          ))}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  title: { marginTop: spacing.sm },
  desc: { marginTop: spacing.sm },
  prompt: { marginTop: spacing.sm, fontStyle: 'italic' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.lg },
  nutrition: { marginTop: spacing.lg },
  section: { marginTop: spacing.xxl },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: spacing.sm },
  card: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.glass,
    paddingVertical: spacing.xs,
    boxShadow: '0px 10px 30px rgba(20,20,20,0.06)',
  },
  ingredient: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: 10, minHeight: 44 },
  box: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: 'rgba(20,20,20,0.22)', backgroundColor: colors.white, marginTop: 1 },
  boxOn: { borderWidth: 0, alignItems: 'center', justifyContent: 'center' },
  struck: { textDecorationLine: 'line-through' },
  methodHead: { marginBottom: spacing.md },
  steps: { gap: spacing.lg },
  step: { flexDirection: 'row', gap: spacing.md },
  stepNum: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,122,106,0.3)',
    backgroundColor: colors.energyBg,
  },
  stepNumText: { fontSize: 12 },
});
