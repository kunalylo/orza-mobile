import { LinearGradient } from 'expo-linear-gradient';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import type { HapticKind } from '@/lib/haptics';
import { colors, diagonal, gradients, radii, shadows } from '@/theme';

import { fitLabel } from './fitLabel';
import { Icon, type IconName } from './Icon';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'energy' | 'secondary' | 'ghost' | 'hero' | 'heroOutline' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  label: string;
  /**
   * Shorter labels, longest first, for where `label` can't fit on one line (large text on a narrow phone): the button
   * shows the longest that fits (the last if none does) and screen readers still hear `label`. Measured, per screen
   * width and font scale (AC-10, steps-v2-V1 F2). Only for a button whose row sets its width (`block`, or flex in a
   * row) and that keeps its size's padding.
   */
  shortLabel?: string | readonly string[];
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
const borders: Partial<Record<ButtonVariant, number>> = { secondary: StyleSheet.hairlineWidth * 2, heroOutline: 1 };

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
  shortLabel,
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
  // shortLabel: each label's row at its natural width (an invisible copy) against the room inside the button.
  const labels = shortLabel == null ? null : [label, ...(typeof shortLabel === 'string' ? [shortLabel] : shortLabel)];
  const [natural, setNatural] = useState<Record<string, number>>({});
  const [width, setWidth] = useState(0);
  const shown = labels ? fitLabel(labels, natural, width - 2 * (paddings[size] + (borders[variant] ?? 0))) : label;
  const content = (text: string) => (
    <>
      {icon ? <Icon name={icon} size={iconSize} color={color} /> : null}
      <Text variant={size === 'sm' ? 'label' : 'title'} color={color} numberOfLines={1} style={size === 'lg' ? styles.lgLabel : undefined}>
        {text}
      </Text>
      {iconRight ? <Icon name={iconRight} size={iconSize} color={color} /> : null}
    </>
  );

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
      onLayout={labels ? (e) => setWidth(e.nativeEvent.layout.width) : undefined}
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
      <View style={[styles.row, loading && styles.hidden]}>{content(shown)}</View>
      {labels ? (
        <View style={styles.measure} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {labels.map((l) => (
            <View
              key={l}
              style={styles.row}
              onLayout={(e) => {
                const w = e.nativeEvent.layout.width;
                setNatural((m) => (m[l] === w ? m : { ...m, [l]: w }));
              }}
            >
              {content(l)}
            </View>
          ))}
        </View>
      ) : null}
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
  // Wide enough that no label is cut: its rows measure at their natural width (shortLabel).
  measure: { position: 'absolute', top: 0, left: 0, width: 1000, alignItems: 'flex-start', opacity: 0 },
});
