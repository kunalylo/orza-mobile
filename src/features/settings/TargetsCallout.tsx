/** "Your daily targets were updated" — shown after a profile save that recalculated targets. */
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';

import type { Targets } from '@/lib/types';
import { colors, radii, spacing } from '@/theme';
import { Icon, IconButton, Text } from '@/ui';

import { formatNumber } from './options';

export function TargetsCallout({ targets, onDismiss, title = 'Your daily targets were updated' }: { targets: Targets; onDismiss: () => void; title?: string }) {
  const items = [
    { label: 'Calories', value: `${formatNumber(targets.calories)} kcal` },
    { label: 'Protein', value: `${targets.protein_g} g` },
    { label: 'Carbs', value: `${targets.carbs_g} g` },
    { label: 'Fat', value: `${targets.fat_g} g` },
    { label: 'Water', value: `${targets.water_glasses} glasses` },
    { label: 'Steps', value: formatNumber(targets.steps) },
  ];
  return (
    <Animated.View entering={FadeInDown.springify().damping(16)} exiting={FadeOut.duration(180)} style={styles.card} accessibilityLiveRegion="polite">
      <View style={styles.head}>
        <Icon name="mci:creation" size={16} color={colors.energyInk} />
        <Text variant="label" tone="ink" style={styles.flex}>
          {title}
        </Text>
        <IconButton icon="x" accessibilityLabel="Dismiss" variant="plain" size={32} iconSize={15} onPress={onDismiss} />
      </View>
      <View style={styles.grid}>
        {items.map((i) => (
          <View key={i.label} style={styles.cell}>
            <Text variant="eyebrow" tone="subtle">
              {i.label}
            </Text>
            <Text variant="label" tone="ink">
              {i.value}
            </Text>
          </View>
        ))}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  card: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    paddingTop: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: 'rgba(255,122,106,0.28)',
    backgroundColor: 'rgba(255,241,234,0.85)',
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm, rowGap: spacing.md },
  cell: { width: '33.33%', gap: 2, paddingRight: spacing.sm },
});
