/** Building blocks shared by the Settings hub and its sub-pages (and the More tab's account header). */
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';

import { haptics } from '@/lib/haptics';
import { colors, diagonal, gradients, gutter, isIOS, radii, spacing } from '@/theme';
import { Button, GlassCard, Icon, Text, type IconName } from '@/ui';

/* ───────────────────────────── Avatar ───────────────────────────── */

export function initialOf(name: string | undefined, email: string | undefined): string {
  return ((name || email || '').trim().charAt(0) || 'Ö').toUpperCase();
}

/** Energy-gradient disc with the user's initial. */
export function Avatar({ initial, size = 56 }: { initial: string; size?: number }) {
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <LinearGradient colors={gradients.energy} start={diagonal.start} end={diagonal.end} style={StyleSheet.absoluteFill} />
      <Text variant={size >= 52 ? 'h2' : 'h3'} color={colors.white}>
        {initial}
      </Text>
    </View>
  );
}

/* ───────────────────────────── Rows & groups ───────────────────────────── */

export interface Tint {
  tint: string;
  bg: string;
}

export const TINTS = {
  energy: { tint: colors.energyInk, bg: colors.energyBg },
  cyan: { tint: colors.cyan700, bg: colors.cyan50 },
  violet: { tint: colors.violet600, bg: colors.violet50 },
  ink: { tint: colors.ink, bg: 'rgba(20,20,20,0.05)' },
  success: { tint: colors.success, bg: colors.successBg },
  danger: { tint: colors.error, bg: colors.errorBg },
} satisfies Record<string, Tint>;

/** Eyebrow + frosted card that holds a list of rows. */
export function SettingsGroup({ title, children, delay = 0, footer, style }: { title?: string; children: ReactNode; delay?: number; footer?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <Animated.View entering={FadeInDown.delay(delay).springify().damping(18).stiffness(100).mass(1)} style={[styles.group, style]}>
      {title ? (
        <Text variant="eyebrow" tone="subtle" style={styles.groupTitle} accessibilityRole="header">
          {title}
        </Text>
      ) : null}
      <GlassCard padding={0}>{children}</GlassCard>
      {footer ? (
        <Text variant="caption" tone="subtle" style={styles.groupFooter}>
          {footer}
        </Text>
      ) : null}
    </Animated.View>
  );
}

export interface SettingsRowProps {
  icon: IconName;
  tint?: Tint;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  /** Shown before the chevron (a value, a tag…). */
  trailing?: ReactNode;
  /** Hide the chevron (action rows). */
  chevron?: boolean;
  loading?: boolean;
  destructive?: boolean;
  last?: boolean;
  accessibilityHint?: string;
}

export function SettingsRow({ icon, tint = TINTS.ink, title, subtitle, onPress, trailing, chevron = true, loading, destructive, last, accessibilityHint }: SettingsRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ busy: !!loading, disabled: !!loading }}
      disabled={loading || !onPress}
      onPress={() => {
        haptics.tap();
        onPress?.();
      }}
      style={({ pressed }) => [styles.row, !last && styles.rowDivider, pressed && styles.rowPressed]}
    >
      <View style={[styles.rowIcon, { backgroundColor: tint.bg }]}>
        <Icon name={icon} size={20} color={tint.tint} />
      </View>
      <View style={styles.rowText}>
        <Text variant="title" numberOfLines={1} color={destructive ? colors.error : undefined}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="muted" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {loading ? <ActivityIndicator size="small" color={colors.coral} /> : trailing}
      {chevron && !loading ? <Icon name="chevron-right" size={18} color={colors.subtle} /> : null}
    </Pressable>
  );
}

/* ───────────────────────────── Form pieces ───────────────────────────── */

/** Label + control + error / hint — for chip groups and custom controls (TextField has its own). */
export function FieldGroup({ label, error, hint, children, style }: { label: string; error?: string | null; hint?: string | null; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.field, style]} accessibilityLabel={label}>
      <Text variant="label" tone="ink" style={styles.fieldLabel}>
        {label}
      </Text>
      {children}
      {error ? (
        <Animated.View entering={FadeIn.duration(160)} accessibilityLiveRegion="polite" style={styles.fieldMsg}>
          <Icon name="alert-circle" size={13} color={colors.error} />
          <Text variant="caption" color={colors.error} style={styles.flex}>
            {error}
          </Text>
        </Animated.View>
      ) : hint ? (
        <Text variant="caption" tone="subtle" style={styles.fieldHint}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

/** Vertical radio cards with a hint line (activity, household). */
export function ChoiceList<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string; hint?: string }[];
  value: T | '';
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.choices}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={o.hint ? `${o.label}, ${o.hint}` : o.label}
            onPress={() => {
              if (on) return;
              haptics.select();
              onChange(o.value);
            }}
            style={({ pressed }) => [styles.choice, on && styles.choiceOn, pressed && !on && styles.rowPressed]}
          >
            <View style={[styles.radio, on && styles.radioOn]}>{on ? <View style={styles.radioDot} /> : null}</View>
            <View style={styles.flex}>
              <Text variant="label" color={on ? colors.ink : colors.text}>
                {o.label}
              </Text>
              {o.hint ? (
                <Text variant="caption" tone="muted">
                  {o.hint}
                </Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A preference row with an on/off switch. */
export function ToggleRow({
  title,
  description,
  value,
  onChange,
  pending,
  last,
  children,
}: {
  title: string;
  description?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  pending?: boolean;
  last?: boolean;
  children?: ReactNode;
}) {
  return (
    <View style={[styles.toggle, !last && styles.rowDivider]}>
      <View style={styles.flex}>
        <Text variant="title">{title}</Text>
        {description ? (
          <Text variant="small" tone="muted" style={styles.toggleDesc}>
            {description}
          </Text>
        ) : null}
        {children}
      </View>
      <Switch
        value={value}
        onValueChange={(v) => {
          haptics.select();
          onChange(v);
        }}
        disabled={pending}
        accessibilityLabel={title}
        accessibilityHint={description}
        trackColor={{ false: 'rgba(20,20,20,0.16)', true: colors.coral }}
        thumbColor={isIOS ? undefined : value ? colors.white : '#F4F1EC'}
        ios_backgroundColor="rgba(20,20,20,0.16)"
        style={pending ? styles.pending : undefined}
      />
    </View>
  );
}

/** Sticky footer for forms: unsaved note + Discard + Save. */
export function SaveBar({
  dirty,
  saving,
  onSave,
  onDiscard,
  label,
  idleNote,
}: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  label: string;
  idleNote?: string;
}) {
  return (
    <View style={styles.saveBar}>
      <Animated.View layout={LinearTransition.springify().damping(20).stiffness(100).mass(1)}>
        <Text variant="caption" tone={dirty ? 'energy' : 'subtle'} align="center" accessibilityLiveRegion="polite" style={styles.saveNote} numberOfLines={2}>
          {dirty ? 'You have unsaved changes.' : idleNote ?? 'Everything is saved.'}
        </Text>
      </Animated.View>
      <View style={styles.saveRow}>
        {dirty ? (
          <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)}>
            <Button label="Discard" variant="ghost" icon="rotate-ccw" onPress={onDiscard} disabled={saving} haptic="soft" />
          </Animated.View>
        ) : null}
        <Button label={label} variant="energy" block loading={saving} disabled={!dirty} onPress={onSave} style={styles.flex} />
      </View>
    </View>
  );
}

/** Small "Saved ✓" pill that fades in and out (auto-saving screens). */
export function SavedPill({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(220)} style={styles.saved} accessibilityLiveRegion="polite">
      <Icon name="check" size={13} color={colors.success} />
      <Text variant="caption" weight="semibold" color={colors.success}>
        Saved
      </Text>
    </Animated.View>
  );
}

/** Soft tinted note with an icon (privacy notes, tips). */
export function Note({ icon, children, tint = TINTS.violet, style }: { icon: IconName; children: ReactNode; tint?: Tint; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.note, { backgroundColor: tint.bg }, style]}>
      <Icon name={icon} size={15} color={tint.tint} />
      <View style={styles.flex}>{typeof children === 'string' ? <Text variant="small" tone="muted">{children}</Text> : children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  avatar: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center', boxShadow: '0px 10px 26px rgba(255,122,106,0.35)' },
  group: { marginTop: spacing.xxl },
  groupTitle: { marginBottom: spacing.sm, marginLeft: spacing.xs },
  groupFooter: { marginTop: spacing.sm, marginHorizontal: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: 14, minHeight: 64 },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hairlineStrong },
  rowPressed: { backgroundColor: 'rgba(20,20,20,0.04)' },
  rowIcon: { width: 40, height: 40, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, minWidth: 0 },
  field: { gap: spacing.sm },
  fieldLabel: { marginLeft: 2 },
  fieldMsg: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 2 },
  fieldHint: { marginLeft: 2 },
  choices: { gap: spacing.sm },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 56,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.glassSubtle,
  },
  choiceOn: { borderColor: 'rgba(255,122,106,0.55)', backgroundColor: colors.energyBg },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: colors.hairlineStrong, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: colors.coral },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.coral },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.lg },
  toggleDesc: { marginTop: 2 },
  pending: { opacity: 0.6 },
  saveBar: {
    paddingHorizontal: gutter,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
    backgroundColor: 'rgba(251,247,241,0.94)',
  },
  saveNote: { paddingHorizontal: spacing.lg },
  saveRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  saved: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.pill, backgroundColor: colors.successBg },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: spacing.md, borderRadius: radii.md },
});
