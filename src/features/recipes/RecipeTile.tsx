/** A recipe in the cookbook list — opens the full recipe. */
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { formatNumber, grams } from '@/features/chat/format';
import { colors, radii, spacing } from '@/theme';
import { Icon, PressableScale, Tag, Text } from '@/ui';

import { displayTags, type Recipe } from './types';

export function RecipeTile({ recipe }: { recipe: Recipe }) {
  const tags = displayTags(recipe.tags, 3);
  return (
    <PressableScale
      onPress={() => router.push({ pathname: '/recipe/[id]', params: { id: recipe.id } })}
      haptic="soft"
      scaleTo={0.98}
      style={styles.card}
      accessibilityRole="button"
      accessibilityLabel={`${recipe.title}. ${recipe.cuisine}, ${recipe.prep_minutes} minutes, ${formatNumber(recipe.nutrition.calories)} kcal per serving${recipe.saved ? ', saved' : ''}`}
      accessibilityHint="Opens the full recipe"
    >
      <View style={styles.top}>
        <Text variant="eyebrow" tone="subtle" style={styles.eyebrow} numberOfLines={1}>
          {recipe.cuisine}
        </Text>
        {recipe.saved ? <Icon name="mci:bookmark-check" size={18} color={colors.energyInk} /> : null}
      </View>
      <Text variant="h3" numberOfLines={2} style={styles.title}>
        {recipe.title}
      </Text>
      <View style={styles.meta}>
        <View style={styles.metaItem}>
          <Icon name="clock" size={13} color={colors.muted} />
          <Text variant="caption" tone="muted">
            {recipe.prep_minutes} min
          </Text>
        </View>
        <View style={styles.metaItem}>
          <Icon name="mci:fire" size={14} color={colors.coral} />
          <Text variant="caption" tone="muted">
            {formatNumber(recipe.nutrition.calories)} kcal
          </Text>
        </View>
        <View style={styles.metaItem}>
          <Text variant="caption" tone="muted">
            P {grams(recipe.nutrition.protein_g)} g
          </Text>
        </View>
      </View>
      {tags.length ? (
        <View style={styles.tags}>
          {tags.map((t) => (
            <Tag key={t.key} label={t.label} tone={t.tone} />
          ))}
        </View>
      ) : null}
      <View style={styles.chevron} pointerEvents="none">
        <Icon name="chevron-right" size={18} color={colors.subtle} />
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.lg,
    paddingRight: spacing.xxxl,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.glass,
    boxShadow: '0px 10px 30px rgba(20,20,20,0.07)',
  },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  eyebrow: { flex: 1, fontSize: 10 },
  title: { marginTop: 4 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: spacing.md, rowGap: 4, marginTop: spacing.sm },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.md },
  chevron: { position: 'absolute', right: spacing.md, top: 0, bottom: 0, justifyContent: 'center' },
});
