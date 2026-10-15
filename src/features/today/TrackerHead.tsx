/** Shared header row for the Today trackers (water / steps / weight): tinted icon tile, eyebrow label, right accessory. */
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, radii, spacing } from '@/theme';
import { Icon, Text, type IconName } from '@/ui';

export type TrackerTone = 'cyan' | 'energy' | 'violet';

const TONE: Record<TrackerTone, { bg: string; fg: string }> = {
  cyan: { bg: colors.cyan50, fg: colors.cyan700 },
  energy: { bg: colors.energyBg, fg: colors.energyInk },
  violet: { bg: colors.violet50, fg: colors.violet600 },
};

export function TrackerHead({ icon, tone, label, right }: { icon: IconName; tone: TrackerTone; label: string; right?: ReactNode }) {
  const t = TONE[tone];
  return (
    <View style={styles.row}>
      <View style={[styles.tile, { backgroundColor: t.bg }]}>
        <Icon name={icon} size={17} color={t.fg} />
      </View>
      <Text variant="eyebrow" tone="subtle" style={styles.label}>
        {label}
      </Text>
      {typeof right === 'string' ? (
        <Text variant="mono" tone="muted">
          {right}
        </Text>
      ) : (
        right
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  tile: { width: 36, height: 36, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center' },
  label: { flex: 1 },
});
