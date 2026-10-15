/**
 * Today's medicines: the next doses with their photos, a taken-today bar and a quick Take.
 * Always the real today (only shown on today's view); refreshes on dose events from anywhere in the app.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, LinearTransition, useReducedMotion } from 'react-native-reanimated';

import { errorMessage } from '@/lib/api';
import { colors, radii, spacing } from '@/theme';
import { Button, GlassCard, Icon, PressableScale, ProgressBar, Skeleton, Tag, Text } from '@/ui';

import { medsKeys, useDoseActions, useLocalToday, useMedsTimezone, useTodayDoses } from '@/features/meds/api';
import { onDoseEvent } from '@/features/meds/events';
import { MedPhoto } from '@/features/meds/MedPhoto';
import { STATUS_META, attentionRank, clockIn, doseKey, formatTime12, isOpen, medicineTitle } from '@/features/meds/shared';
import type { DoseItem } from '@/features/meds/types';

const SHOW = 3;

export function MedsCard({ onOpenMedicines, onAddMedicine, onScanPrescription }: { onOpenMedicines: () => void; onAddMedicine: () => void; onScanPrescription: () => void }) {
  const reduce = useReducedMotion();
  const qc = useQueryClient();
  const tz = useMedsTimezone();
  const date = useLocalToday(tz);
  const q = useTodayDoses(date);
  const { act, pendingFor } = useDoseActions(date, tz);

  // A dose taken from the alarm / a reminder / the Medicines tab shows up here straight away.
  useEffect(() => onDoseEvent(() => void qc.invalidateQueries({ queryKey: medsKeys.todayAll() }, { cancelRefetch: false })), [qc]);

  const doses = q.data?.doses ?? [];
  const taken = doses.filter((d) => d.status === 'taken').length;
  const open = doses
    .filter(isOpen)
    .sort((a, b) => Math.min(attentionRank(a.status), 3) - Math.min(attentionRank(b.status), 3) || a.scheduled_for.localeCompare(b.scheduled_for));
  const shown = open.slice(0, SHOW);
  const pct = doses.length ? taken / doses.length : 0;

  let body: ReactNode;
  if (q.isPending) {
    body = (
      <View style={styles.list} accessibilityLabel="Loading medicines">
        {[0, 1].map((i) => (
          <View key={i} style={styles.skRow}>
            <Skeleton width={48} height={48} radius={radii.sm} />
            <View style={styles.flex}>
              <Skeleton height={14} width="60%" />
              <Skeleton height={11} width="35%" style={styles.skLine} />
            </View>
            <Skeleton width={64} height={34} radius={radii.pill} />
          </View>
        ))}
      </View>
    );
  } else if (q.isError && !q.data) {
    body = (
      <View style={styles.errorRow} accessibilityRole="alert">
        <Text variant="small" tone="muted" style={styles.flex}>
          {errorMessage(q.error)}
        </Text>
        <Button label="Retry" icon="refresh-cw" variant="secondary" size="sm" loading={q.isFetching} onPress={() => void q.refetch()} />
      </View>
    );
  } else if (!doses.length) {
    body = (
      <View style={styles.emptyBlock}>
        <Text variant="small" tone="muted">
          No medicines scheduled today. Add yours and every alarm shows the medicine&apos;s photo — or scan a prescription and ÖRZA sets them up.
        </Text>
        <View style={styles.actions}>
          <Button label="Add medicine" icon="plus" variant="secondary" size="sm" onPress={onAddMedicine} />
          <Button label="Scan prescription" icon="mci:line-scan" variant="ghost" size="sm" onPress={onScanPrescription} />
        </View>
      </View>
    );
  } else {
    body = (
      <>
        <View style={styles.progressHead}>
          <Text variant="caption" tone="muted">
            <Text variant="caption" weight="semibold" tone="ink">
              {taken}
            </Text>{' '}
            of {doses.length} taken today
          </Text>
          <Text variant="mono" tone="muted">
            {Math.round(pct * 100)}%
          </Text>
        </View>
        <ProgressBar value={pct} palette="energy" height={6} accessibilityLabel={`${taken} of ${doses.length} doses taken today`} />
        {shown.length === 0 ? (
          <Animated.View entering={reduce ? undefined : FadeIn.duration(260)} style={styles.allDone}>
            <Icon name="check-circle" size={17} color={colors.success} />
            <Text variant="small" weight="medium" tone="success" style={styles.flex}>
              All done for today — nicely handled.
            </Text>
          </Animated.View>
        ) : (
          <View style={styles.list}>
            {shown.map((d) => (
              <Animated.View key={doseKey(d)} layout={reduce ? undefined : LinearTransition.springify().damping(20)}>
                <DoseLine dose={d} tz={tz} pending={!!pendingFor(d)} taking={pendingFor(d) === 'take'} onTake={() => void act(d, 'take')} onOpen={onOpenMedicines} />
              </Animated.View>
            ))}
          </View>
        )}
        {open.length > SHOW ? (
          <PressableScale onPress={onOpenMedicines} haptic="tap" accessibilityRole="link" style={styles.more}>
            <Text variant="caption" weight="medium" tone="muted">
              +{open.length - SHOW} more today
            </Text>
          </PressableScale>
        ) : null}
      </>
    );
  }

  return (
    <GlassCard tone="strong" padding={spacing.lg}>
      <View style={styles.head}>
        <View style={styles.flex}>
          <Text variant="eyebrow" tone="subtle">
            Medicines
          </Text>
          <Text variant="h3" tone="ink" style={styles.title} accessibilityRole="header">
            {open.length ? 'Next doses' : "Today's doses"}
          </Text>
        </View>
        <PressableScale onPress={onOpenMedicines} haptic="tap" accessibilityRole="link" accessibilityLabel="All medicines" hitSlop={8} style={styles.all}>
          <Text variant="label" tone="muted">
            All
          </Text>
          <Icon name="chevron-right" size={15} color={colors.muted} />
        </PressableScale>
      </View>
      <View style={styles.body}>{body}</View>
    </GlassCard>
  );
}

function DoseLine({ dose, tz, pending, taking, onTake, onOpen }: { dose: DoseItem; tz: string; pending: boolean; taking: boolean; onTake: () => void; onOpen: () => void }) {
  const meta = STATUS_META[dose.status];
  const quickTake = dose.status === 'due' || dose.status === 'missed' || dose.status === 'snoozed';
  const title = medicineTitle(dose);
  const tag = dose.status === 'snoozed' && dose.snooze_until ? `Until ${clockIn(tz, new Date(dose.snooze_until))}` : meta.label;
  return (
    <View style={[styles.dose, dose.status === 'due' && styles.doseDue]}>
      <PressableScale
        onPress={onOpen}
        haptic="tap"
        scaleTo={0.98}
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${formatTime12(dose.local_time)}, ${dose.dose}. ${meta.label}`}
        accessibilityHint="Opens your medicines"
        style={styles.doseMain}
      >
        <MedPhoto url={dose.photo_urls[0]} size={48} radius={radii.sm} style={styles.photo} />
        <View style={styles.flex}>
          <Text variant="label" tone="ink" numberOfLines={1}>
            {title}
          </Text>
          <View style={styles.doseMeta}>
            <Text variant="caption" tone="muted" style={styles.tabular}>
              {formatTime12(dose.local_time)}
            </Text>
            <Text variant="caption" tone="subtle">
              ·
            </Text>
            <Text variant="caption" tone="muted" numberOfLines={1} style={styles.shrink}>
              {dose.dose}
            </Text>
          </View>
          {dose.status !== 'upcoming' ? <Tag tone={meta.tone} label={tag} style={styles.tag} /> : null}
        </View>
      </PressableScale>
      {quickTake ? (
        <Button label="Take" variant="energy" size="sm" onPress={onTake} loading={taking} disabled={pending} accessibilityLabel={`Take ${dose.name}`} />
      ) : (
        <View style={styles.pillIcon}>
          <Icon name="mci:pill" size={16} color={colors.subtle} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1 },
  tabular: { fontVariant: ['tabular-nums'] },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  title: { marginTop: 2 },
  all: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 32 },
  body: { marginTop: spacing.md },
  progressHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  list: { marginTop: spacing.md, gap: spacing.sm },
  skRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  skLine: { marginTop: 6 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  emptyBlock: { gap: spacing.md },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  allDone: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radii.sm,
    backgroundColor: colors.successBg,
  },
  dose: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: 6, borderRadius: radii.sm },
  doseDue: { backgroundColor: 'rgba(255,241,234,0.9)' },
  doseMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  photo: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.divider },
  doseMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  tag: { alignSelf: 'flex-start', marginTop: 4 },
  pillIcon: { width: 36, alignItems: 'center' },
  more: { marginTop: spacing.md, alignSelf: 'flex-start', minHeight: 28, justifyContent: 'center' },
});
