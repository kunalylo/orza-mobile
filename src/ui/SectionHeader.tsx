import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { haptics } from '@/lib/haptics';
import { colors, spacing } from '@/theme';

import { Icon } from './Icon';
import { Text } from './Text';

export interface SectionHeaderProps {
  title: string;
  eyebrow?: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}

/** Eyebrow + serif title with an optional "See all" link on the right. */
export function SectionHeader({ title, eyebrow, actionLabel, onAction, style }: SectionHeaderProps) {
  return (
    <View style={[styles.row, style]}>
      <View style={styles.titles}>
        {eyebrow ? (
          <Text variant="eyebrow" tone="subtle" style={styles.eyebrow}>
            {eyebrow}
          </Text>
        ) : null}
        <Text variant="h3" accessibilityRole="header" numberOfLines={2}>
          {title}
        </Text>
      </View>
      {actionLabel && onAction ? (
        <Pressable
          onPress={() => {
            haptics.tap();
            onAction();
          }}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          hitSlop={10}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <Text variant="label" tone="cyan">
            {actionLabel}
          </Text>
          <Icon name="chevron-right" size={16} color={colors.cyan700} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: spacing.md, marginBottom: spacing.md },
  titles: { flex: 1 },
  eyebrow: { marginBottom: 4 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 4 },
  pressed: { opacity: 0.6 },
});
