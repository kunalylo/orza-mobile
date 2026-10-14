/** The "ÖRZA is cooking" card while a recipe is created, and the freshly generated recipe card. */
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut, useReducedMotion } from 'react-native-reanimated';

import { colors, diagonal, gradients, radii, spacing } from '@/theme';
import { Button, GlassCard, Icon, IconButton, Orb, Skeleton, Tag, Text } from '@/ui';

import { NutritionRow } from './NutritionRow';
import { displayTags, type Recipe } from './types';

const STEPS = ['Checking your diet and allergies…', 'Balancing protein, carbs and fibre…', 'Measuring out the ingredients…', 'Writing the method…'];

export function GeneratingCard() {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % STEPS.length), 1800);
    return () => clearInterval(t);
  }, []);
  return (
    <GlassCard tone="strong" glow padding={spacing.xl} accessibilityLabel="ÖRZA is creating your recipe">
      <View style={styles.cookingRow} accessibilityLiveRegion="polite">
        <View style={styles.cookingOrb}>
          <Orb size={72} tone="light" orbits={false} active />
        </View>
        <View style={styles.flex}>
          <Text variant="eyebrow" tone="subtle">
            ÖRZA is cooking
          </Text>
          <Animated.View key={i} entering={reduce ? undefined : FadeIn.duration(260)} exiting={reduce ? undefined : FadeOut.duration(160)}>
            <Text variant="callout" style={styles.cookingStep}>
              {STEPS[i]}
            </Text>
          </Animated.View>
        </View>
      </View>
      <View style={styles.skeletons} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Skeleton width="70%" height={26} radius={8} />
        <Skeleton width="100%" height={14} />
        <Skeleton width="100%" height={64} radius={radii.md} />
        <Skeleton width="85%" height={14} />
        <Skeleton width="60%" height={14} />
      </View>
    </GlassCard>
  );
}

export function RecipeResultCard({
  recipe,
  notice,
  onClose,
  onAnother,
  generating,
  onToggleSave,
  saving,
}: {
  recipe: Recipe;
  notice?: string;
  onClose: () => void;
  onAnother: () => void;
  generating: boolean;
  onToggleSave: () => void;
  saving: boolean;
}) {
  const reduce = useReducedMotion();
  const tags = displayTags(recipe.tags);
  const preview = recipe.ingredients.slice(0, 4);
  const more = recipe.ingredients.length - preview.length;

  return (
    <Animated.View key={recipe.id} entering={reduce ? undefined : FadeInDown.springify().damping(18)}>
      <GlassCard tone="strong" glow padding={0}>
        <LinearGradient colors={gradients.energy} {...diagonal} style={styles.topBar} />
        <View style={styles.resultBody}>
          <View style={styles.resultHead}>
            <Text variant="eyebrow" tone="energy" style={styles.flex}>
              {recipe.source === 'ai' ? 'Created by ÖRZA AI' : "From ÖRZA's recipe collection"}
            </Text>
            <IconButton icon="rotate-cw" accessibilityLabel="Generate another with the same request" size={36} iconSize={16} onPress={onAnother} disabled={generating} />
            <IconButton icon="x" accessibilityLabel="Close recipe" size={36} iconSize={16} onPress={onClose} />
          </View>
          <Text variant="h2" style={styles.resultTitle} accessibilityRole="header">
            {recipe.title}
          </Text>
          {recipe.description ? (
            <Text variant="small" tone="muted" style={styles.desc}>
              {recipe.description}
            </Text>
          ) : null}
          {notice ? (
            <View style={styles.notice}>
              <Icon name="info" size={15} color={colors.cyan700} />
              <Text variant="caption" tone="cyan" style={styles.flex}>
                {notice}
              </Text>
            </View>
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

          <View style={styles.preview}>
            <Text variant="eyebrow" tone="subtle" style={styles.previewLabel}>
              You&apos;ll need
            </Text>
            {preview.map((ing, idx) => (
              <View key={idx} style={styles.previewRow}>
                <View style={styles.previewDot} />
                <Text variant="small" style={styles.flex} numberOfLines={1}>
                  {ing}
                </Text>
              </View>
            ))}
            {more > 0 ? (
              <Text variant="caption" tone="subtle" style={styles.more}>
                + {more} more ingredient{more === 1 ? '' : 's'} · {recipe.steps.length} steps
              </Text>
            ) : null}
          </View>

          <View style={styles.actions}>
            <Button
              label="View full recipe"
              iconRight="arrow-right"
              variant="primary"
              style={styles.flex}
              onPress={() => router.push({ pathname: '/recipe/[id]', params: { id: recipe.id } })}
            />
            <Button
              label={recipe.saved ? 'Saved' : 'Save'}
              icon={recipe.saved ? 'check' : 'bookmark'}
              variant="secondary"
              loading={saving}
              haptic="soft"
              onPress={onToggleSave}
              accessibilityLabel={recipe.saved ? 'Saved — tap to remove from saved' : 'Save recipe'}
            />
          </View>
        </View>
      </GlassCard>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  cookingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  cookingOrb: { width: 72, height: 72 },
  cookingStep: { marginTop: 4 },
  skeletons: { gap: spacing.md, marginTop: spacing.xl },
  topBar: { height: 4 },
  resultBody: { padding: spacing.xl, paddingTop: spacing.md },
  resultHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginRight: -spacing.sm },
  resultTitle: { marginTop: spacing.xs },
  desc: { marginTop: spacing.sm },
  notice: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: 'rgba(11,143,166,0.2)',
    backgroundColor: 'rgba(234,246,255,0.85)',
  },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.lg },
  nutrition: { marginTop: spacing.lg },
  preview: { marginTop: spacing.lg, gap: 6 },
  previewLabel: { fontSize: 10, marginBottom: 2 },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  previewDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.coral },
  more: { marginTop: 2 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl },
});
