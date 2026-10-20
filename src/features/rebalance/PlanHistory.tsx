/** Past rebalance plans — tap to expand and revisit, delete with a native confirm. */
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, LinearTransition, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { formatNumber } from '@/features/chat/format';
import { errorMessage } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { colors, radii, spacing } from '@/theme';
import { EmptyState, Icon, IconButton, PressableScale, Skeleton, Tag, Text, toast } from '@/ui';

import { useDeletePlan } from './api';
import { PlanView } from './PlanView';
import { createdLabel, formatShortDate, type RebalancePlan } from './types';

function Chevron({ open }: { open: boolean }) {
  const reduce = useReducedMotion();
  const turn = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    turn.set(reduce ? (open ? 1 : 0) : withTiming(open ? 1 : 0, { duration: 220 }));
  }, [open, reduce, turn]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.get() * 180}deg` }] }));
  return (
    <Animated.View style={style}>
      <Icon name="chevron-down" size={20} color={colors.muted} />
    </Animated.View>
  );
}

function PlanRow({ plan, highlighted, onDelete, deleting }: { plan: RebalancePlan; highlighted?: boolean; onDelete: () => void; deleting: boolean }) {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const n = plan.days.length;
  const first = plan.days[0]?.date;
  const last = plan.days[n - 1]?.date;
  const range = first && last ? ` · ${formatShortDate(first)} – ${formatShortDate(last)}` : '';

  return (
    <Animated.View layout={reduce ? undefined : LinearTransition.springify().damping(20).stiffness(100).mass(1)} style={[styles.row, open && styles.rowOpen, deleting && styles.dim]}>
      <View style={styles.rowHead}>
        <PressableScale
          onPress={() => setOpen((o) => !o)}
          haptic="select"
          scaleTo={0.985}
          style={styles.rowMain}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={`${plan.occasion}. ${formatNumber(plan.extra_calories)} kcal over ${n} day${n === 1 ? '' : 's'}${range}`}
          accessibilityHint={open ? 'Hides the plan' : 'Shows the plan'}
        >
          <View style={styles.titleRow}>
            <Text variant="h3" numberOfLines={1} style={styles.shrink}>
              {plan.occasion}
            </Text>
            {highlighted ? <Tag label="New" tone="energy" /> : null}
            {plan.ai ? <Tag label="AI" tone="violet" /> : null}
          </View>
          <Text variant="caption" tone="muted" style={styles.sub}>
            {formatNumber(plan.extra_calories)} kcal over {n} day{n === 1 ? '' : 's'}
            {range} · created {createdLabel(plan.created_at)}
          </Text>
        </PressableScale>
        <Chevron open={open} />
        <IconButton icon="trash-2" variant="plain" size={40} iconSize={16} color={colors.subtle} accessibilityLabel={`Delete the ${plan.occasion} plan`} onPress={onDelete} disabled={deleting} />
      </View>
      {open ? (
        <Animated.View entering={reduce ? undefined : FadeIn.duration(220)} style={styles.panel}>
          {plan.description ? (
            <Text variant="small" tone="muted" style={styles.ate}>
              <Text variant="small" weight="semibold">
                What you ate:
              </Text>{' '}
              {plan.description}
            </Text>
          ) : null}
          <PlanView plan={plan} />
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

export function PlanHistory({ plans, loading, highlightId, onDeleted }: { plans: RebalancePlan[]; loading: boolean; highlightId?: string | null; onDeleted: (id: string) => void }) {
  const reduce = useReducedMotion();
  const del = useDeletePlan();

  function confirmDelete(plan: RebalancePlan) {
    haptics.warning();
    Alert.alert('Delete this plan?', `Your “${plan.occasion}” rebalance plan will be removed.`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          del.mutate(plan.id, {
            onSuccess: (id) => {
              haptics.success();
              toast.success('Plan deleted.');
              onDeleted(id);
            },
            onError: (e) => {
              haptics.error();
              toast.error(errorMessage(e));
            },
          }),
      },
    ]);
  }

  if (loading) {
    return (
      <View style={styles.list} accessibilityLabel="Loading past plans">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} height={76} radius={radii.lg} />
        ))}
      </View>
    );
  }

  if (!plans.length) {
    return (
      <EmptyState
        icon="mci:history"
        title="No plans yet"
        body="Your rebalance plans will live here, so you can look back whenever you need a gentle reset."
      />
    );
  }

  return (
    <View style={styles.list}>
      {plans.map((p, i) => (
        <Animated.View key={p.id} entering={reduce ? undefined : FadeInDown.delay(Math.min(i, 8) * 40).springify().damping(18).stiffness(100).mass(1)}>
          <PlanRow plan={p} highlighted={p.id === highlightId} deleting={del.isPending && del.variables === p.id} onDelete={() => confirmDelete(p)} />
        </Animated.View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  row: { borderRadius: radii.lg, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.glass, overflow: 'hidden' },
  rowOpen: { backgroundColor: colors.glassSolid, boxShadow: '0px 10px 30px rgba(20,20,20,0.08)' },
  dim: { opacity: 0.6 },
  rowHead: { flexDirection: 'row', alignItems: 'center', paddingRight: spacing.xs },
  rowMain: { flex: 1, paddingVertical: spacing.lg, paddingLeft: spacing.lg, paddingRight: spacing.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  shrink: { flexShrink: 1 },
  sub: { marginTop: 4 },
  panel: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, paddingTop: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairlineStrong },
  ate: { marginBottom: spacing.lg },
});
