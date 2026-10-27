/**
 * One medicine in the review list: include checkbox, name + strength, dose · food · days, the alarm times, and a
 * warning when it was hard to read or something blocks "Create alarms". Tap to edit in the sheet.
 */
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOut, ZoomIn } from 'react-native-reanimated';

import { formatTime12, isHHMM } from '@/features/meds/shared';
import { colors, fonts, radii, spacing } from '@/theme';
import { Icon, IconButton, PressableScale, Text, useLayoutTransition } from '@/ui';

import { isLowConfidence, rowProblem, rowSummary } from './rows';
import type { ReviewRow } from './types';

function Checkbox({ checked, label, onToggle }: { checked: boolean; label: string; onToggle: () => void }) {
  return (
    <PressableScale
      onPress={onToggle}
      haptic="select"
      hitSlop={10}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      style={[styles.box, checked && styles.boxOn]}
    >
      {checked ? (
        <Animated.View entering={ZoomIn.springify().damping(14).stiffness(100).mass(1)}>
          <Icon name="check" size={15} color={colors.white} />
        </Animated.View>
      ) : null}
    </PressableScale>
  );
}

export function ReviewRowCard({
  row,
  index,
  showErrors,
  onToggle,
  onEdit,
  onRemove,
}: {
  row: ReviewRow;
  index: number;
  showErrors: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const layoutTransition = useLayoutTransition();
  const problem = showErrors ? rowProblem(row) : null;
  const low = isLowConfidence(row) && row.include;
  const name = row.name.trim() || `Medicine ${index + 1}`;
  const times = row.as_needed ? [] : [...new Set(row.times.filter(isHHMM))].sort();

  return (
    <Animated.View
      entering={FadeInDown.delay(Math.min(index, 8) * 45).springify().damping(18).stiffness(100).mass(1)}
      exiting={FadeOut.duration(160)}
      layout={layoutTransition}
      style={[styles.card, problem ? styles.cardError : low ? styles.cardLow : null, !row.include && styles.cardOff]}
    >
      <View style={styles.top}>
        <Checkbox checked={row.include} label={`Include ${name}`} onToggle={onToggle} />
        <PressableScale onPress={onEdit} haptic="tap" scaleTo={0.985} style={styles.main} accessibilityRole="button" accessibilityLabel={`Edit ${name}`} accessibilityHint="Opens the medicine editor">
          <Text variant="title" numberOfLines={2} tone={row.name.trim() ? 'ink' : 'subtle'}>
            {row.name.trim() || 'Add the medicine name'}
            {row.strength ? (
              <Text variant="small" tone="muted">
                {'  '}
                {row.strength}
              </Text>
            ) : null}
          </Text>
          <Text variant="small" tone="muted" style={styles.summary}>
            {rowSummary(row)}
          </Text>
          {row.frequency_text ? (
            <Text style={styles.written} numberOfLines={1}>
              As written · {row.frequency_text}
            </Text>
          ) : null}
          <View style={styles.times}>
            {row.as_needed ? (
              <View style={[styles.time, styles.sos]}>
                <Icon name="mci:hand-heart-outline" size={13} color={colors.cyan700} />
                <Text variant="caption" color={colors.cyan700}>
                  SOS · only when needed
                </Text>
              </View>
            ) : times.length ? (
              times.map((t) => (
                <View key={t} style={styles.time}>
                  <Icon name="bell" size={12} color={colors.energyInk} />
                  <Text variant="caption" weight="semibold" color={colors.ink}>
                    {formatTime12(t)}
                  </Text>
                </View>
              ))
            ) : (
              <Text variant="caption" tone="error">
                No alarm time yet
              </Text>
            )}
          </View>
          {row.instructions ? (
            <Text variant="caption" tone="muted" style={styles.instructions}>
              {row.instructions}
            </Text>
          ) : null}
        </PressableScale>
        <View style={styles.side}>
          <IconButton icon="edit-3" variant="plain" size={36} iconSize={16} accessibilityLabel={`Edit ${name}`} onPress={onEdit} />
          <IconButton icon="trash-2" variant="plain" size={36} iconSize={16} color={colors.muted} accessibilityLabel={`Remove ${name} from the list`} onPress={onRemove} haptic="soft" />
        </View>
      </View>

      {problem || low ? (
        <View style={styles.warn} accessibilityRole={problem ? 'alert' : undefined}>
          <Icon name="alert-triangle" size={13} color={problem ? colors.error : colors.warning} />
          <Text variant="caption" color={problem ? colors.error : '#8A5300'} style={styles.flex}>
            {problem || 'Hard to read — please check this one against your prescription.'}
          </Text>
        </View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: {
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.glassStrong,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  cardLow: { borderColor: 'rgba(176,106,0,0.4)', backgroundColor: '#FFFBF3', borderWidth: 1 },
  cardError: { borderColor: 'rgba(176,44,44,0.4)', backgroundColor: '#FFF7F7', borderWidth: 1 },
  cardOff: { opacity: 0.55 },
  top: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  box: {
    width: 24,
    height: 24,
    marginTop: 2,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: colors.hairlineStrong,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: colors.cyan600, borderColor: colors.cyan600 },
  main: { flex: 1, minWidth: 0 },
  summary: { marginTop: 2 },
  written: { marginTop: 4, fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.3, color: colors.subtle },
  times: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm },
  time: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.energyBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(194,65,12,0.18)',
  },
  sos: { backgroundColor: colors.cyan50, borderColor: 'rgba(11,143,166,0.22)' },
  instructions: { marginTop: spacing.sm },
  side: { marginTop: -6, marginRight: -6 },
  warn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm, paddingLeft: 36 },
});
