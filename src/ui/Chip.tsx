import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radii } from '@/theme';

import { Icon, type IconName } from './Icon';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

export interface ChipProps {
  label: string;
  onPress?: () => void;
  selected?: boolean;
  icon?: IconName;
  disabled?: boolean;
  /** `radio` for single choice, `checkbox` for multi-select (screen readers announce the state). */
  role?: 'button' | 'radio' | 'checkbox';
  size?: 'sm' | 'md';
  tone?: 'light' | 'hero';
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}

/** Selectable pill — quick replies, filters, multi-select. */
export function Chip({ label, onPress, selected, icon, disabled, role = 'button', size = 'md', tone = 'light', accessibilityHint, style }: ChipProps) {
  const hero = tone === 'hero';
  const fg = selected ? (hero ? colors.hero2 : colors.white) : hero ? colors.heroText : colors.ink;
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      haptic="soft"
      scaleTo={0.95}
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled, selected: role === 'button' ? !!selected : undefined, checked: role !== 'button' ? !!selected : undefined }}
      style={[
        styles.chip,
        size === 'sm' ? styles.sm : styles.md,
        hero ? styles.hero : styles.light,
        selected && (hero ? styles.heroSelected : styles.selected),
        disabled && styles.disabled,
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={size === 'sm' ? 13 : 15} color={fg} /> : null}
      <Text variant={size === 'sm' ? 'caption' : 'small'} weight="medium" color={fg} numberOfLines={2}>
        {label}
      </Text>
    </PressableScale>
  );
}

export type TagTone = 'neutral' | 'success' | 'warning' | 'error' | 'info' | 'energy' | 'violet' | 'hero';

const tagColors: Record<TagTone, { bg: string; fg: string; border: string }> = {
  neutral: { bg: 'rgba(255,255,255,0.75)', fg: colors.muted, border: colors.hairline },
  success: { bg: colors.successBg, fg: colors.success, border: 'rgba(18,122,86,0.18)' },
  warning: { bg: colors.warningBg, fg: colors.warning, border: 'rgba(176,106,0,0.18)' },
  error: { bg: colors.errorBg, fg: colors.error, border: 'rgba(176,44,44,0.18)' },
  info: { bg: colors.cyan50, fg: colors.cyan700, border: 'rgba(11,143,166,0.20)' },
  energy: { bg: colors.energyBg, fg: colors.energyInk, border: 'rgba(255,122,106,0.25)' },
  violet: { bg: colors.violet50, fg: colors.violet600, border: 'rgba(135,87,242,0.20)' },
  hero: { bg: colors.heroGlass, fg: colors.heroMuted, border: colors.heroGlassBorder },
};

export interface TagProps {
  label: string;
  tone?: TagTone;
  icon?: IconName;
  /** Small leading dot instead of an icon. */
  dot?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Non-interactive status pill (eyebrow type). */
export function Tag({ label, tone = 'neutral', icon, dot, style }: TagProps) {
  const c = tagColors[tone];
  return (
    <View style={[styles.tag, { backgroundColor: c.bg, borderColor: c.border }, style]}>
      {dot ? <View style={[styles.dot, { backgroundColor: c.fg }]} /> : null}
      {icon ? <Icon name={icon} size={12} color={c.fg} /> : null}
      <Text variant="eyebrow" color={c.fg} style={styles.tagText} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radii.pill,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  md: { minHeight: 42, paddingHorizontal: 16, paddingVertical: 9 },
  sm: { minHeight: 32, paddingHorizontal: 12, paddingVertical: 6 },
  light: { backgroundColor: colors.glassStrong, borderColor: colors.hairlineStrong },
  selected: { backgroundColor: colors.ink, borderColor: colors.ink },
  hero: { backgroundColor: colors.heroGlass, borderColor: colors.heroGlassBorder },
  heroSelected: { backgroundColor: colors.white, borderColor: colors.white },
  disabled: { opacity: 0.45 },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    borderRadius: radii.pill,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  tagText: { fontSize: 10, lineHeight: 13, letterSpacing: 1.1 },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
