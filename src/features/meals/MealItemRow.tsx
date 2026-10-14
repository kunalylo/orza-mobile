import { StyleSheet, View } from 'react-native';

import { colors, spacing } from '@/theme';
import { Text } from '@/ui';

import type { MealItem } from './types';
import { formatNumber, itemPortion, macroLine } from './utils';

/** One logged item: name + portion on the left, kcal + macros on the right. */
export function MealItemRow({ item, divider = true, unit = '' }: { item: MealItem; divider?: boolean; unit?: string }) {
  return (
    <View
      style={[styles.row, divider && styles.divider]}
      accessible
      accessibilityLabel={`${item.name}, ${itemPortion(item)}, ${formatNumber(item.calories)} calories, ${macroLine(item)}`}
    >
      <View style={styles.left}>
        <Text variant="label" tone="ink" numberOfLines={2}>
          {item.name}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {itemPortion(item)}
        </Text>
      </View>
      <View style={styles.right}>
        <Text variant="mono" tone="ink" style={styles.kcal}>
          {formatNumber(item.calories)}
          {unit}
        </Text>
        <Text variant="caption" tone="muted" style={styles.macros}>
          {macroLine(item)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 10 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairlineStrong },
  left: { flex: 1, minWidth: 0, gap: 1 },
  right: { alignItems: 'flex-end', flexShrink: 0 },
  kcal: { fontSize: 13, fontVariant: ['tabular-nums'] },
  macros: { fontSize: 11, fontVariant: ['tabular-nums'] },
});
