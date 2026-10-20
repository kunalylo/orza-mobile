/** Where the numbers came from (per-source summary) and the privacy note — same wording as the web Health page. */
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';

import { colors, radii, spacing } from '@/theme';
import { GlassCard, Icon, Text } from '@/ui';

import { openWebHealth } from './ConnectCard';
import { formatDay, timeAgo } from './format';
import type { HealthDaysResponse, HealthRange } from './types';

export function SourcesCard({ data, range }: { data: HealthDaysResponse; range: HealthRange }) {
  const reduce = useReducedMotion();
  return (
    <Animated.View entering={reduce ? undefined : FadeInDown.delay(120).springify().damping(18).stiffness(100).mass(1)}>
      <GlassCard padding={spacing.lg}>
        <Text variant="h3" tone="ink">
          Sources
        </Text>
        <Text variant="caption" tone="muted" style={styles.sub}>
          {data.last_sync ? `Last data received ${timeAgo(data.last_sync)}` : 'Nothing received yet'} · where sources overlap, ÖRZA keeps
          the higher daily total
        </Text>
        {data.sources.length ? (
          <View style={styles.list}>
            {data.sources.map((s, i) => (
              <View key={s.source} style={[styles.row, i > 0 && styles.rowBorder]}>
                <View style={styles.dot} />
                <View style={styles.flex}>
                  <Text variant="label" tone="ink">
                    {s.label}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {`${s.days} ${s.days === 1 ? 'day' : 'days'} in view · ${formatDay(s.first_date)} – ${formatDay(s.last_date)}`}
                  </Text>
                  <Text variant="caption" tone="subtle">
                    {`Updated ${timeAgo(s.last_updated)}`}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        ) : (
          <Text variant="small" tone="muted" style={styles.sub}>
            {`No data from any source in the last ${range} days.`}
          </Text>
        )}
      </GlassCard>
    </Animated.View>
  );
}

/** What ÖRZA stores, plus a pointer to the web importers (Apple Health export, CSV, automation apps). */
export function PrivacyNote() {
  return (
    <View style={styles.note}>
      <View style={styles.noteRow}>
        <Icon name="shield" size={16} color={colors.subtle} />
        <Text variant="caption" tone="muted" style={styles.flex}>
          ÖRZA stores one row of daily totals per source — never your raw samples, workouts, locations or clinical records. Synced steps
          can raise your step count for the day, and a synced weight fills days you haven’t logged; your own entries are never
          overwritten.
        </Text>
      </View>
      <Pressable
        accessibilityRole="link"
        accessibilityHint="Opens the ÖRZA website"
        onPress={openWebHealth}
        hitSlop={8}
        style={({ pressed }) => [styles.noteRow, pressed && styles.pressed]}
      >
        <Icon name="external-link" size={16} color={colors.cyan700} />
        <Text variant="caption" tone="cyan" weight="semibold" style={styles.flex}>
          Older history, a CSV file or an automation app? Use the importers on the ÖRZA website.
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  sub: { marginTop: spacing.xs },
  list: { marginTop: spacing.md },
  row: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.md, alignItems: 'flex-start' },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6, backgroundColor: colors.coral },
  flex: { flex: 1 },
  note: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.glassSubtle,
  },
  noteRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  pressed: { opacity: 0.6 },
});
