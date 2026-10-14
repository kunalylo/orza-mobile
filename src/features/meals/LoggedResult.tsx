import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';

import { colors, radii, spacing } from '@/theme';
import { Button, GlassCard, Icon, IconButton, Tag, Text } from '@/ui';

import { MealItemRow } from './MealItemRow';
import type { TextLogResponse } from './types';
import { MEAL_LABEL, formatNumber } from './utils';

/** "Just logged" card under the composer: what ÖRZA understood, anything it couldn't place, and quick fixes. */
export function LoggedResult({
  result,
  onDismiss,
  onUndo,
  onEdit,
  onSearch,
  undoing,
}: {
  result: TextLogResponse;
  onDismiss: () => void;
  onUndo: () => void;
  onEdit: () => void;
  onSearch: (phrase: string) => void;
  undoing?: boolean;
}) {
  const { meal, ai, unmatched, notice } = result;
  const t = meal.totals;

  return (
    <Animated.View entering={FadeInDown.springify().damping(18)} exiting={FadeOut.duration(160)}>
      <GlassCard tone="strong" style={styles.card} padding={spacing.lg}>
        <View style={styles.head}>
          <View style={styles.check}>
            <Icon name="check" size={16} color={colors.white} />
          </View>
          <View style={styles.headText}>
            <Text variant="h3" tone="ink" accessibilityRole="header">
              Logged to {MEAL_LABEL[meal.meal_type].toLowerCase()}
            </Text>
            <View style={styles.metaRow}>
              <Tag label={ai ? 'AI estimate' : 'Built-in food list'} tone={ai ? 'violet' : 'neutral'} />
              <Text variant="mono" tone="muted">
                {meal.items.length} item{meal.items.length === 1 ? '' : 's'} · {formatNumber(t.calories)} kcal
              </Text>
            </View>
          </View>
          <IconButton icon="x" variant="plain" size={36} iconSize={17} color={colors.subtle} accessibilityLabel="Dismiss" onPress={onDismiss} />
        </View>

        <View style={styles.items}>
          {meal.items.map((i, idx) => (
            <MealItemRow key={`${i.name}-${idx}`} item={i} divider={idx > 0} unit=" kcal" />
          ))}
          <View style={styles.total}>
            <Text variant="label" tone="ink">
              Total
            </Text>
            <Text variant="mono" tone="ink" style={styles.totalText}>
              {formatNumber(t.calories)} kcal · P {t.protein_g}g · C {t.carbs_g}g · F {t.fat_g}g
            </Text>
          </View>
        </View>

        {meal.notes ? (
          <View style={[styles.box, styles.infoBox]}>
            <Icon name="help-circle" size={14} color={colors.cyan600} />
            <Text variant="small" tone="ink" style={styles.flex}>
              {meal.notes}
            </Text>
          </View>
        ) : null}

        {notice ? (
          <View style={[styles.box, styles.noticeBox]}>
            <Icon name="info" size={14} color={colors.warning} />
            <Text variant="small" color="#8A5300" style={styles.flex}>
              {notice}
            </Text>
          </View>
        ) : null}

        {unmatched.length > 0 ? (
          <View style={styles.unmatched}>
            <Text variant="label" tone="ink">
              ÖRZA couldn&apos;t place {unmatched.length === 1 ? 'this' : 'these'}:
            </Text>
            <View style={styles.unmatchedChips}>
              {unmatched.map((u) => (
                <Pressable
                  key={u}
                  onPress={() => onSearch(u)}
                  accessibilityRole="button"
                  accessibilityLabel={`Search the food list for ${u}`}
                  style={({ pressed }) => [styles.unmatchedChip, pressed && styles.pressed]}
                >
                  <Icon name="search" size={12} color="#8A5300" />
                  <Text variant="small" color="#8A5300" numberOfLines={1}>
                    {u}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text variant="caption" tone="muted">
              Tap one to find it in the food list, or type it again with a portion — e.g. “1 katori kadhi”.
            </Text>
          </View>
        ) : null}

        <View style={styles.actions}>
          <Button label="Adjust portions" icon="edit-3" variant="secondary" size="sm" onPress={onEdit} />
          <Button label="Undo" icon={undoing ? undefined : 'corner-up-left'} variant="ghost" size="sm" onPress={onUndo} loading={undoing} haptic="warning" />
        </View>
        {ai ? (
          <Text variant="caption" tone="subtle" style={styles.wellness}>
            Wellness guidance, not medical advice. For medical concerns, please consult your doctor.
          </Text>
        ) : null}
      </GlassCard>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { borderColor: 'rgba(18,122,86,0.24)' },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  check: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  headText: { flex: 1, gap: 6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  items: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  total: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.xs,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairlineStrong,
  },
  totalText: { fontSize: 11.5, flexShrink: 1, textAlign: 'right' },
  box: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, padding: spacing.md, borderRadius: radii.sm, borderWidth: 1 },
  infoBox: { backgroundColor: 'rgba(11,190,220,0.06)', borderColor: 'rgba(11,190,220,0.22)' },
  noticeBox: { backgroundColor: '#FFF8EE', borderColor: 'rgba(176,106,0,0.22)' },
  unmatched: { marginTop: spacing.lg, gap: spacing.sm },
  unmatchedChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  unmatchedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 34,
    maxWidth: '100%',
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.warningBg,
    borderWidth: 1,
    borderColor: 'rgba(176,106,0,0.25)',
  },
  pressed: { opacity: 0.7 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.lg },
  wellness: { marginTop: spacing.md },
});
