import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, spacing } from '@/theme';

import { Button, type ButtonVariant } from './Button';
import { Icon, type IconName } from './Icon';
import { Orb } from './Orb';
import { Text } from './Text';

export interface EmptyStateProps {
  title: string;
  body?: string;
  /** An icon in a soft glass disc; omit to show a small living orb instead. */
  icon?: IconName;
  eyebrow?: string;
  actionLabel?: string;
  onAction?: () => void;
  actionVariant?: ButtonVariant;
  style?: StyleProp<ViewStyle>;
}

/** Friendly "nothing here yet" block with an optional call to action. */
export function EmptyState({ title, body, icon, eyebrow, actionLabel, onAction, actionVariant = 'secondary', style }: EmptyStateProps) {
  return (
    <View style={[styles.wrap, style]}>
      {icon ? (
        <View style={styles.disc}>
          <Icon name={icon} size={26} color={colors.energyInk} />
        </View>
      ) : (
        <Orb size={112} tone="light" orbits={false} />
      )}
      {eyebrow ? (
        <Text variant="eyebrow" tone="subtle" align="center" style={styles.eyebrow}>
          {eyebrow}
        </Text>
      ) : null}
      <Text variant="h3" align="center" accessibilityRole="header">
        {title}
      </Text>
      {body ? (
        <Text variant="callout" tone="muted" align="center" style={styles.body}>
          {body}
        </Text>
      ) : null}
      {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} variant={actionVariant} style={styles.action} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingHorizontal: spacing.xxl, paddingVertical: spacing.xxxl },
  disc: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.energyBg,
    borderWidth: 1,
    borderColor: 'rgba(255,122,106,0.22)',
    marginBottom: spacing.lg,
  },
  eyebrow: { marginBottom: spacing.sm },
  body: { marginTop: spacing.sm, maxWidth: 340 },
  action: { marginTop: spacing.xl, alignSelf: 'center' },
});
