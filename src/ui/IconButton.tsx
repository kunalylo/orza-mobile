import { StyleSheet, type Insets, type StyleProp, type ViewStyle } from 'react-native';

import type { HapticKind } from '@/lib/haptics';
import { colors, layout, shadows } from '@/theme';

import { Icon, type IconName } from './Icon';
import { PressableScale } from './PressableScale';

export interface IconButtonProps {
  icon: IconName;
  /** Required — icon-only controls must be named for screen readers. */
  accessibilityLabel: string;
  onPress?: () => void;
  variant?: 'glass' | 'solid' | 'plain' | 'hero';
  size?: number;
  iconSize?: number;
  color?: string;
  disabled?: boolean;
  haptic?: HapticKind;
  /**
   * Per-side slop where a neighbouring control is closer than the even slop: half the gap to it (0 when flush), dp. A
   * later sibling's slop wins over an earlier sibling's own bounds, so without it the button takes the neighbour's edge.
   */
  hitSlop?: Insets;
  style?: StyleProp<ViewStyle>;
}

/** Round icon-only button: smaller than 48 dp, it gets hit slop up to a 48 dp touch target (`layout.hit`). */
export function IconButton({ icon, accessibilityLabel, onPress, variant = 'glass', size = 44, iconSize, color, disabled, haptic = 'tap', hitSlop, style }: IconButtonProps) {
  const even = Math.max(0, (layout.hit - size) / 2);
  const slop = hitSlop ? { top: even, bottom: even, left: even, right: even, ...hitSlop } : even;
  const fg = color ?? (variant === 'solid' ? colors.white : variant === 'hero' ? colors.heroText : colors.ink);
  return (
    <PressableScale
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      disabled={disabled}
      haptic={haptic}
      scaleTo={0.92}
      hitSlop={slop}
      style={[styles.base, { width: size, height: size, borderRadius: size / 2 }, variants[variant], disabled && styles.disabled, style]}
    >
      <Icon name={icon} size={iconSize ?? Math.round(size * 0.44)} color={fg} />
    </PressableScale>
  );
}

const variants = StyleSheet.create({
  glass: { backgroundColor: colors.glassStrong, borderWidth: 1, borderColor: colors.hairline, ...shadows.soft },
  solid: { backgroundColor: colors.ink },
  plain: { backgroundColor: colors.transparent },
  hero: { backgroundColor: colors.heroGlass, borderWidth: 1, borderColor: colors.heroGlassBorder },
});

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.4 },
});
