import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import type { HapticKind } from '@/lib/haptics';
import { colors, diagonal, gradients, radii, shadows } from '@/theme';

import { Icon, type IconName } from './Icon';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'energy' | 'secondary' | 'ghost' | 'hero' | 'heroOutline' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  /** Icon after the label (e.g. arrow-right). */
  iconRight?: IconName;
  loading?: boolean;
  disabled?: boolean;
  /** Stretch to the container width. */
  block?: boolean;
  haptic?: HapticKind;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  children?: ReactNode;
}

const heights: Record<ButtonSize, number> = { sm: 38, md: 48, lg: 56 };
const paddings: Record<ButtonSize, number> = { sm: 14, md: 20, lg: 26 };

const fg: Record<ButtonVariant, string> = {
  primary: colors.white,
  energy: colors.white,
  secondary: colors.ink,
  ghost: colors.ink,
  hero: colors.hero2,
  heroOutline: colors.heroText,
  danger: colors.white,
};

/**
 * Pill buttons: `primary` (ink), `energy` (amber → coral → pink), `secondary` (glass), `ghost`,
 * `hero` / `heroOutline` (on the dark hero), `danger`. Springy press + haptic; `loading` keeps the width.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  iconRight,
  loading,
  disabled,
  block,
  haptic,
  accessibilityLabel,
  accessibilityHint,
  style,
  testID,
}: ButtonProps) {
  const inactive = disabled || loading;
  const color = fg[variant];
  const iconSize = size === 'sm' ? 15 : 17;

  return (
    <PressableScale
      // A new native view per variant: on Android (Fabric) a rounded `overflow: hidden` view whose border goes away
      // (secondary → energy / primary) stopped drawing its children — Snap's "Analyse photo" (the reused "Choose from
      // gallery" button) showed as a blank coral pill with no gradient and no label.
      key={variant}
      testID={testID}
      onPress={inactive ? undefined : onPress}
      disabled={inactive}
      haptic={haptic ?? (variant === 'energy' || variant === 'primary' ? 'firm' : 'tap')}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      hitSlop={size === 'sm' ? 6 : 0}
      style={[
        styles.base,
        { height: heights[size], paddingHorizontal: paddings[size] },
        variantStyle[variant],
        block && styles.block,
        disabled && !loading && styles.disabled,
        style,
      ]}
    >
      {variant === 'energy' && (
        <LinearGradient colors={gradients.energy} start={diagonal.start} end={diagonal.end} style={[StyleSheet.absoluteFill, styles.gradient]} />
      )}
      <View style={[styles.row, loading && styles.hidden]}>
        {icon ? <Icon name={icon} size={iconSize} color={color} /> : null}
        <Text variant={size === 'sm' ? 'label' : 'title'} color={color} numberOfLines={1} style={size === 'lg' ? styles.lgLabel : undefined}>
          {label}
        </Text>
        {iconRight ? <Icon name={iconRight} size={iconSize} color={color} /> : null}
      </View>
      {loading ? <ActivityIndicator style={StyleSheet.absoluteFill} color={color} /> : null}
    </PressableScale>
  );
}

const variantStyle = StyleSheet.create({
  primary: { backgroundColor: colors.ink, ...shadows.cta },
  energy: { backgroundColor: colors.coral, ...shadows.energy },
  secondary: { backgroundColor: colors.glassStrong, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.hairlineStrong, ...shadows.soft },
  ghost: { backgroundColor: colors.transparent },
  hero: { backgroundColor: colors.white, boxShadow: '0px 18px 50px rgba(255,255,255,0.14)' },
  heroOutline: { backgroundColor: colors.heroGlass, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },
  danger: { backgroundColor: colors.error },
});

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    alignSelf: 'flex-start',
  },
  gradient: { borderRadius: radii.pill },
  block: { alignSelf: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  hidden: { opacity: 0 },
  disabled: { opacity: 0.45 },
  lgLabel: { fontSize: 17.5 },
});
