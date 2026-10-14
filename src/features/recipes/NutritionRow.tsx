/** Per-serving nutrition strip: calories lead (warm tint), macros follow. */
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { formatNumber, grams } from '@/features/chat/format';
import type { Nutrients } from '@/features/chat/types';
import { colors, radii } from '@/theme';
import { Text } from '@/ui';

export function NutritionRow({ nutrition, style }: { nutrition: Nutrients; style?: StyleProp<ViewStyle> }) {
  const cells = [
    { label: 'Kcal', long: 'calories', value: formatNumber(nutrition.calories), unit: '' },
    { label: 'Protein', long: 'protein', value: grams(nutrition.protein_g), unit: 'g' },
    { label: 'Carbs', long: 'carbs', value: grams(nutrition.carbs_g), unit: 'g' },
    { label: 'Fat', long: 'fat', value: grams(nutrition.fat_g), unit: 'g' },
    { label: 'Fibre', long: 'fibre', value: grams(nutrition.fiber_g), unit: 'g' },
  ];
  const summary = cells.map((c) => `${c.value}${c.unit ? ' grams' : ''} ${c.long}`).join(', ');
  return (
    <View style={[styles.wrap, style]} accessible accessibilityLabel={`Per serving: ${summary}`}>
      <View style={styles.head}>
        <Text variant="eyebrow" tone="subtle" style={styles.eyebrow}>
          Per serving
        </Text>
      </View>
      <View style={styles.row}>
        {cells.map((c, i) => (
          <View key={c.label} style={[styles.cell, i > 0 && styles.divider]}>
            {i === 0 ? (
              <LinearGradient colors={['rgba(255,180,84,0.18)', 'rgba(255,95,162,0.07)']} style={StyleSheet.absoluteFill} pointerEvents="none" />
            ) : null}
            <Text variant="eyebrow" tone="subtle" style={styles.label} numberOfLines={1}>
              {c.label}
            </Text>
            <View style={styles.valueRow}>
              <Text variant="h3" style={styles.value} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                {c.value}
              </Text>
              {c.unit ? (
                <Text variant="caption" tone="subtle" style={styles.unit}>
                  {c.unit}
                </Text>
              ) : null}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: radii.md, borderWidth: 1, borderColor: colors.divider, backgroundColor: 'rgba(255,255,255,0.6)', overflow: 'hidden' },
  head: { paddingHorizontal: 12, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  eyebrow: { fontSize: 10 },
  row: { flexDirection: 'row' },
  cell: { flex: 1, alignItems: 'center', paddingVertical: 10, paddingHorizontal: 2 },
  divider: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.divider },
  label: { fontSize: 9, letterSpacing: 0.8 },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 1, marginTop: 4 },
  value: { fontSize: 18, lineHeight: 22, fontVariant: ['tabular-nums'] },
  unit: { fontSize: 10 },
});
