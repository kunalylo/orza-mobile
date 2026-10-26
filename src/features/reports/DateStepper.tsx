/** Prev / label / next pill used for day and week navigation; tapping the label can open a calendar. */
import { Pressable, StyleSheet, View } from 'react-native';

import { haptics } from '@/lib/haptics';
import { colors, radii, shadows, spacing } from '@/theme';
import { Icon, IconButton, Text } from '@/ui';

export function DateStepper({
  label,
  sublabel,
  onPrev,
  onNext,
  prevLabel,
  nextLabel,
  nextDisabled,
  onPressLabel,
  pressLabelHint,
}: {
  label: string;
  sublabel?: string;
  onPrev: () => void;
  onNext: () => void;
  prevLabel: string;
  nextLabel: string;
  nextDisabled?: boolean;
  onPressLabel?: () => void;
  pressLabelHint?: string;
}) {
  const center = (
    <View style={styles.center}>
      <View style={styles.labelRow}>
        {/* No adjustsFontSizeToFit: on Android it laid the shrink-wrapped Playfair label out on two lines and clipped the
            second, so "Wed, 21 Oct" read "Wed, 21". The longest label ("29 Dec 2025 – 4 Jan 2026") fits a phone pill. */}
        <Text variant="title" numberOfLines={1} style={styles.label}>
          {label}
        </Text>
        {onPressLabel ? <Icon name="chevron-down" size={15} color={colors.muted} /> : null}
      </View>
      {sublabel ? (
        <Text variant="eyebrow" tone="subtle" style={styles.sub} numberOfLines={1}>
          {sublabel}
        </Text>
      ) : null}
    </View>
  );

  return (
    <View style={styles.pill}>
      <IconButton
        icon="chevron-left"
        variant="plain"
        accessibilityLabel={prevLabel}
        onPress={() => {
          haptics.select();
          onPrev();
        }}
        haptic="none"
      />
      {onPressLabel ? (
        <Pressable
          onPress={() => {
            haptics.tap();
            onPressLabel();
          }}
          accessibilityRole="button"
          accessibilityLabel={`${label}${sublabel ? `, ${sublabel}` : ''}`}
          accessibilityHint={pressLabelHint}
          style={({ pressed }) => [styles.flex, pressed && styles.pressed]}
        >
          {center}
        </Pressable>
      ) : (
        <View style={styles.flex} accessible accessibilityLabel={`${label}${sublabel ? `, ${sublabel}` : ''}`} accessibilityLiveRegion="polite">
          {center}
        </View>
      )}
      <IconButton
        icon="chevron-right"
        variant="plain"
        accessibilityLabel={nextLabel}
        disabled={nextDisabled}
        onPress={() => {
          haptics.select();
          onNext();
        }}
        haptic="none"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    padding: spacing.xs,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.glassStrong,
    ...shadows.glass,
  },
  flex: { flex: 1 },
  pressed: { opacity: 0.6 },
  center: { alignItems: 'center', justifyContent: 'center', minHeight: 44, paddingHorizontal: spacing.xs },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '100%' },
  // No negative letter spacing (the `title` variant's −0.1): Android measured the shrink-wrapped Playfair label a hair
  // narrower than it draws it, so the month wrapped onto a hidden second line and "Fri, 23 Oct" read "Fri, 23".
  label: { fontFamily: 'PlayfairDisplay_600SemiBold', flexShrink: 1 },
  sub: { fontSize: 10, marginTop: 1 },
});
