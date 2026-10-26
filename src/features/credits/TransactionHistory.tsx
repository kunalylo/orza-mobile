/** Credit activity: newest first, grouped by day, filterable (All / Used / Added), 15 at a time. */
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, LinearTransition, useReducedMotion } from 'react-native-reanimated';

import { formatNumber } from '@/features/goals/math';
import { colors, spacing } from '@/theme';
import { Button, EmptyState, GlassCard, Icon, Segmented, Text, type IconName } from '@/ui';

import { ACTION_ICONS, dayGroup, formatClock, formatDateTime, isRefund, transactionAction, transactionLabel } from './options';
import type { CreditTransaction } from './types';

type Filter = 'all' | 'used' | 'added';
const PAGE = 15;

function txIcon(tx: CreditTransaction): { icon: IconName; bg: string; fg: string } {
  if (isRefund(tx.reason)) return { icon: 'rotate-ccw', bg: colors.cyan50, fg: colors.cyan700 };
  const action = transactionAction(tx);
  if (tx.amount < 0 && action) return { icon: ACTION_ICONS[action], bg: 'rgba(255,255,255,0.85)', fg: colors.muted };
  return { icon: /welcome/i.test(tx.reason || '') ? 'gift' : 'zap', bg: colors.energyBg, fg: colors.energyInk };
}

export function TransactionHistory({ transactions }: { transactions: CreditTransaction[] }) {
  const reduce = useReducedMotion();
  const [filter, setFilter] = useState<Filter>('all');
  const [shown, setShown] = useState(PAGE);

  const rows = useMemo(() => transactions.filter((t) => (filter === 'all' ? true : filter === 'used' ? t.amount < 0 : t.amount > 0)), [transactions, filter]);
  const visible = rows.slice(0, shown);
  const groups = useMemo(() => {
    const out: { day: string; items: CreditTransaction[] }[] = [];
    for (const tx of visible) {
      const day = dayGroup(tx.created_at);
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(tx);
      else out.push({ day, items: [tx] });
    }
    return out;
  }, [visible]);

  return (
    <GlassCard tone="strong">
      <Text variant="eyebrow" tone="subtle">
        History
      </Text>
      <Text variant="h3" accessibilityRole="header" style={styles.title}>
        Credit activity
      </Text>
      {transactions.length > 0 ? (
        <Segmented<Filter>
          size="sm"
          accessibilityLabel="Filter credit activity"
          value={filter}
          onChange={(v) => {
            setFilter(v);
            setShown(PAGE);
          }}
          options={[
            { value: 'all', label: 'All' },
            { value: 'used', label: 'Used' },
            { value: 'added', label: 'Added' },
          ]}
          style={styles.filter}
        />
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          icon="clock"
          title={transactions.length === 0 ? 'No activity yet' : filter === 'used' ? 'Nothing used yet' : 'Nothing added yet'}
          body={transactions.length === 0 ? 'When you use an AI feature or receive credits, it will show up here.' : 'Try another filter to see the rest of your activity.'}
          style={styles.empty}
        />
      ) : (
        <Animated.View key={filter} entering={reduce ? undefined : FadeIn.duration(200)} layout={reduce ? undefined : LinearTransition.springify().damping(20).stiffness(100).mass(1)}>
          {groups.map((g) => (
            <View key={g.day} style={styles.group}>
              <Text variant="eyebrow" tone="subtle" style={styles.groupLabel} accessibilityRole="header">
                {g.day}
              </Text>
              {g.items.map((tx, i) => {
                const plus = tx.amount > 0;
                const ic = txIcon(tx);
                return (
                  <View
                    key={tx.id}
                    style={[styles.row, i > 0 && styles.rowBorder]}
                    accessible
                    accessibilityLabel={`${transactionLabel(tx.reason)}. ${plus ? 'Added' : 'Used'} ${Math.abs(tx.amount)} ${Math.abs(tx.amount) === 1 ? 'credit' : 'credits'}. Balance ${formatNumber(tx.balance_after)}. ${formatDateTime(tx.created_at)}`}
                  >
                    <View style={[styles.icon, { backgroundColor: ic.bg }]}>
                      <Icon name={ic.icon} size={15} color={ic.fg} />
                    </View>
                    <View style={styles.flex}>
                      <Text variant="label" numberOfLines={1}>
                        {transactionLabel(tx.reason)}
                      </Text>
                      <Text variant="caption" tone="subtle">
                        {formatClock(tx.created_at)}
                      </Text>
                    </View>
                    <View style={styles.amountCol}>
                      <Text variant="title" color={plus ? colors.success : tx.amount < 0 ? colors.energyInk : colors.muted} style={styles.tabular}>
                        {plus ? '+' : tx.amount < 0 ? '−' : ''}
                        {formatNumber(Math.abs(tx.amount))}
                      </Text>
                      <Text variant="caption" tone="subtle" style={styles.tabular}>
                        Balance {formatNumber(tx.balance_after)}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          ))}
          <View style={styles.foot}>
            <Text variant="caption" tone="subtle" style={styles.flex}>
              Showing {visible.length} of {rows.length}
              {transactions.length >= 100 ? ' · your latest 100 transactions' : ''}
            </Text>
            {rows.length > shown ? <Button label="Show more" variant="ghost" size="sm" iconRight="chevron-down" onPress={() => setShown((n) => n + PAGE)} /> : null}
          </View>
        </Animated.View>
      )}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  title: { marginTop: 4 },
  filter: { marginTop: spacing.lg },
  empty: { paddingHorizontal: 0, paddingVertical: spacing.xl },
  group: { marginTop: spacing.lg },
  groupLabel: { fontSize: 10, marginBottom: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  icon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  amountCol: { alignItems: 'flex-end' },
  tabular: { fontVariant: ['tabular-nums'] },
  foot: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
});
