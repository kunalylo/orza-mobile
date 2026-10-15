/**
 * Review an AI scan before logging: dish + confidence, ÖRZA's question/notes, live totals (recomputed as rows change),
 * an honest calorie range, editable items (name / qty / unit / kcal / P / C / F, add / remove), meal type, Log.
 */
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, LinearTransition, useReducedMotion } from 'react-native-reanimated';

import { colors, radii, spacing } from '@/theme';
import { Button, GlassCard, Icon, Segmented, Tag, Text } from '@/ui';

import { ItemEditor, draftTotals, type DraftItem } from '@/features/meals/ItemEditor';
import type { MealType } from '@/features/meals/types';
import { MEAL_SINGULAR, MEAL_TYPES, formatNumber, round } from '@/features/meals/utils';

import type { Scan } from './types';
import { confidenceTone, estimateRange, percent } from './utils';

const TYPE_OPTIONS = MEAL_TYPES.map((t) => ({ value: t, label: MEAL_SINGULAR[t] }));

export function ScanReview({
  scan,
  rows,
  onRowsChange,
  mealType,
  onMealTypeChange,
  dayLabel,
  showErrors,
  logging,
  onLog,
  onReset,
}: {
  scan: Scan;
  rows: DraftItem[];
  onRowsChange: (rows: DraftItem[]) => void;
  mealType: MealType;
  onMealTypeChange: (t: MealType) => void;
  dayLabel: string;
  showErrors: boolean;
  logging: boolean;
  onLog: () => void;
  onReset: () => void;
}) {
  const reduce = useReducedMotion();
  const totals = draftTotals(rows);
  const conf = confidenceTone(scan.confidence);
  const range = estimateRange(totals.calories, scan.confidence);
  const cells = [
    { label: 'kcal', value: formatNumber(totals.calories) },
    { label: 'Protein', value: `${round(totals.protein_g, 1)}g` },
    { label: 'Carbs', value: `${round(totals.carbs_g, 1)}g` },
    { label: 'Fat', value: `${round(totals.fat_g, 1)}g` },
  ];

  return (
    <Animated.View entering={reduce ? undefined : FadeInDown.springify().damping(18)} layout={reduce ? undefined : LinearTransition.springify().damping(20)}>
      <GlassCard tone="strong">
        <View style={styles.eyebrowRow}>
          <Icon name="star" size={12} color={colors.cyan600} />
          <Text variant="eyebrow" tone="subtle">
            ÖRZA analysis
          </Text>
        </View>
        <Text variant="h2" tone="ink" style={styles.dish} accessibilityRole="header">
          {scan.dish_name}
        </Text>
        <View style={styles.confRow}>
          <Tag tone={conf.tone} label={conf.label} dot />
          <Text variant="mono" tone="subtle">
            {percent(scan.confidence)} sure
          </Text>
        </View>

        {scan.notes ? (
          <View style={styles.note}>
            <Icon name="help-circle" size={15} color={colors.cyan600} />
            <Text variant="small" tone="ink" style={styles.flex}>
              {scan.notes}
            </Text>
          </View>
        ) : null}

        <View
          style={styles.cells}
          accessible
          accessibilityLabel={`Meal totals: ${formatNumber(totals.calories)} kilocalories, ${round(totals.protein_g, 1)} grams protein, ${round(totals.carbs_g, 1)} grams carbs, ${round(totals.fat_g, 1)} grams fat`}
        >
          {cells.map((c) => (
            <View key={c.label} style={styles.cell}>
              <Text variant="title" tone="ink" style={styles.cellValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                {c.value}
              </Text>
              <Text variant="eyebrow" tone="subtle" style={styles.cellLabel} numberOfLines={1}>
                {c.label}
              </Text>
            </View>
          ))}
        </View>
        <View style={styles.rangeRow}>
          <Text variant="caption" tone="muted">
            Estimated range
          </Text>
          <Text variant="mono" tone="ink">
            {formatNumber(range.low)}–{formatNumber(range.high)} kcal
          </Text>
        </View>

        <View style={styles.itemsHead}>
          <Text variant="label" tone="ink">
            Detected items
          </Text>
          <Text variant="caption" tone="subtle">
            Edit anything that looks off
          </Text>
        </View>
        <ItemEditor rows={rows} onChange={onRowsChange} showErrors={showErrors} />

        <View style={styles.typeBlock}>
          <Text variant="label" tone="ink" style={styles.typeLabel}>
            Log to{' '}
            <Text variant="small" tone="muted">
              · {dayLabel}
            </Text>
          </Text>
          <Segmented size="sm" accessibilityLabel="Meal type" options={TYPE_OPTIONS} value={mealType} onChange={onMealTypeChange} />
        </View>

        <View style={styles.actions}>
          <Button label="Log this meal" icon="check-circle" variant="energy" size="lg" onPress={onLog} loading={logging} disabled={rows.length === 0} haptic="firm" block />
          <Button label="Scan another" icon="camera" variant="secondary" onPress={onReset} disabled={logging} block />
        </View>
        <Text variant="caption" tone="subtle" align="center" style={styles.wellness}>
          Estimates for wellness guidance, not medical advice.
        </Text>
      </GlassCard>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dish: { marginTop: spacing.sm },
  confRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: 'rgba(11,190,220,0.22)',
    backgroundColor: 'rgba(11,190,220,0.06)',
  },
  cells: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  cell: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
    backgroundColor: 'rgba(255,255,255,0.7)',
  },
  cellValue: { fontVariant: ['tabular-nums'] },
  cellLabel: { fontSize: 9.5, marginTop: 2, letterSpacing: 1 },
  rangeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm, gap: spacing.sm },
  itemsHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm, marginTop: spacing.xxl, marginBottom: spacing.md },
  typeBlock: { marginTop: spacing.xl, paddingTop: spacing.xl, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  typeLabel: { marginBottom: spacing.sm },
  actions: { marginTop: spacing.xl, gap: spacing.sm },
  wellness: { marginTop: spacing.md },
});
