/**
 * Small building blocks shared by the Reminders and Calendar screens: an icon tile, a card header
 * (icon + mono eyebrow + Playfair title + optional right slot), a labelled switch row and an inline confirm strip.
 */
import type { ReactNode } from 'react';
import { StyleSheet, Switch, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { haptics } from '@/lib/haptics';
import { colors, radii, spacing } from '@/theme';
import { Button, Icon, Text, type IconName } from '@/ui';

export type TileTone = 'energy' | 'cyan' | 'violet' | 'amber' | 'success' | 'neutral';

const TILE: Record<TileTone, { bg: string; fg: string }> = {
  energy: { bg: colors.energyBg, fg: colors.energyInk },
  cyan: { bg: colors.cyan50, fg: colors.cyan700 },
  violet: { bg: colors.violet50, fg: colors.violet600 },
  amber: { bg: colors.warningBg, fg: colors.warning },
  success: { bg: colors.successBg, fg: colors.success },
  neutral: { bg: 'rgba(20,20,20,0.05)', fg: colors.muted },
};

export function IconTile({ icon, tone = 'energy', size = 40, bg, fg }: { icon: IconName; tone?: TileTone; size?: number; bg?: string; fg?: string }) {
  const c = TILE[tone];
  return (
    <View style={[styles.tile, { width: size, height: size, borderRadius: size * 0.32, backgroundColor: bg ?? c.bg }]}>
      <Icon name={icon} size={Math.round(size * 0.48)} color={fg ?? c.fg} />
    </View>
  );
}

export function CardHeader({
  icon,
  tone,
  eyebrow,
  title,
  body,
  right,
  style,
}: {
  icon: IconName;
  tone?: TileTone;
  eyebrow?: string;
  title: string;
  body?: string;
  right?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={style}>
      <View style={styles.headRow}>
        <IconTile icon={icon} tone={tone} />
        <View style={styles.flex}>
          {eyebrow ? (
            <Text variant="eyebrow" tone="subtle">
              {eyebrow}
            </Text>
          ) : null}
          <Text variant="h3" accessibilityRole="header">
            {title}
          </Text>
        </View>
        {right}
      </View>
      {body ? (
        <Text variant="small" tone="muted" style={styles.body}>
          {body}
        </Text>
      ) : null}
    </View>
  );
}

export function BrandSwitch({
  value,
  onValueChange,
  disabled,
  accessibilityLabel,
}: {
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
  accessibilityLabel: string;
}) {
  return (
    <Switch
      value={value}
      disabled={disabled}
      onValueChange={(v) => {
        haptics.select();
        onValueChange(v);
      }}
      trackColor={{ true: colors.coral, false: colors.canvas3 }}
      thumbColor={colors.white}
      ios_backgroundColor={colors.canvas3}
      accessibilityLabel={accessibilityLabel}
    />
  );
}

/** A title + hint on the left, a switch on the right (whole row is one accessible switch). */
export function SwitchRow({
  icon,
  title,
  hint,
  value,
  onChange,
  disabled,
  style,
}: {
  icon?: IconName;
  title: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.switchRow, disabled && styles.disabled, style]}>
      {icon ? <Icon name={icon} size={18} color={value ? colors.energyInk : colors.subtle} /> : null}
      <View style={styles.flex}>
        <Text variant="label">{title}</Text>
        {hint ? (
          <Text variant="caption" tone="muted" style={styles.hint}>
            {hint}
          </Text>
        ) : null}
      </View>
      <BrandSwitch value={value} onValueChange={onChange} disabled={disabled} accessibilityLabel={title} />
    </View>
  );
}

/** An inline "Are you sure?" strip that fades in under a destructive button. */
export function ConfirmStrip({
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  busy,
  tone = 'danger',
}: {
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  tone?: 'danger' | 'primary';
}) {
  return (
    <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(140)} style={styles.confirm} accessibilityRole="alert">
      <Text variant="small" tone="text">
        {message}
      </Text>
      <View style={styles.confirmRow}>
        <Button label="Cancel" variant="ghost" size="sm" onPress={onCancel} disabled={busy} />
        <Button label={confirmLabel} variant={tone} size="sm" onPress={onConfirm} loading={busy} haptic="firm" />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  tile: { alignItems: 'center', justifyContent: 'center' },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  body: { marginTop: spacing.sm },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.glassStrong,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  hint: { marginTop: 2 },
  disabled: { opacity: 0.55 },
  confirm: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.errorBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(176,44,44,0.18)',
    gap: spacing.sm,
  },
  confirmRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
});
