/** "What costs credits" — the per-action price list plus what always stays free. */
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, radii, spacing } from '@/theme';
import { GlassCard, Icon, Text } from '@/ui';

import { ACTION_ICONS, ACTION_TONES, CREDIT_ACTION_ROWS } from './options';
import type { CreditCosts } from './types';

export function CostsCard({ costs, aiEnabled }: { costs: CreditCosts; aiEnabled: boolean }) {
  return (
    <GlassCard tone="strong">
      <Text variant="eyebrow" tone="subtle">
        What costs credits
      </Text>
      <Text variant="h3" accessibilityRole="header" style={styles.title}>
        Only AI uses credits
      </Text>

      <View style={styles.list}>
        {CREDIT_ACTION_ROWS.map((row, i) => {
          const cost = costs[row.key] ?? 0;
          const tone = ACTION_TONES[row.key];
          return (
            <View
              key={row.key}
              style={[styles.row, i > 0 && styles.rowBorder]}
              accessible
              accessibilityLabel={`${row.label}: ${cost} ${cost === 1 ? 'credit' : 'credits'}. ${row.hint}`}
            >
              <View style={[styles.icon, { backgroundColor: tone.bg }]}>
                <Icon name={ACTION_ICONS[row.key]} size={15} color={tone.fg} />
              </View>
              <View style={styles.flex}>
                <Text variant="label">{row.label}</Text>
                <Text variant="caption" tone="subtle">
                  {row.hint}
                </Text>
              </View>
              <View style={styles.cost}>
                <Text variant="h3" style={styles.tabular}>
                  {cost}
                </Text>
                <Text variant="caption" tone="subtle">
                  {cost === 1 ? 'credit' : 'credits'}
                </Text>
              </View>
            </View>
          );
        })}
      </View>

      <View style={styles.free}>
        <FreeLine icon={null}>
          <Text variant="small" weight="semibold">
            Non-AI logging is always free
          </Text>{' '}
          — manual meals, water, steps and weight never use credits.
        </FreeLine>
        <FreeLine icon={null}>
          <Text variant="small" weight="semibold">
            {aiEnabled ? 'If AI is ever unavailable' : 'While AI is unavailable'}
          </Text>
          , ÖRZA&apos;s built-in engine handles logging, chat, recipes and plans — for free.
        </FreeLine>
        <FreeLine icon="rotate-ccw">If an AI request fails, the credits are refunded automatically.</FreeLine>
      </View>
    </GlassCard>
  );
}

function FreeLine({ icon, children }: { icon: 'rotate-ccw' | null; children: ReactNode }) {
  return (
    <View style={styles.freeLine}>
      {icon ? <Icon name={icon} size={13} color={colors.success} /> : <View style={styles.bullet} />}
      <Text variant="small" style={styles.flex}>
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  title: { marginTop: 4 },
  list: { marginTop: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  icon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  cost: { alignItems: 'flex-end' },
  tabular: { fontVariant: ['tabular-nums'] },
  free: {
    marginTop: spacing.md,
    gap: spacing.sm,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: 'rgba(18,122,86,0.18)',
    backgroundColor: 'rgba(234,247,241,0.7)',
    padding: spacing.lg,
  },
  freeLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  bullet: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success, marginTop: 7 },
});
