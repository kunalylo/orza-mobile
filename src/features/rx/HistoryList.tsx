/**
 * "Your prescriptions": past scans and typed prescriptions with their photo and status. Tapping one opens a sheet with
 * the photo, what was read, and Review / See medicines / Delete.
 */
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';

import { dateIn, formatDateShort, medicineTitle } from '@/features/meds/shared';
import { ErrorPanel } from '@/features/meds/StatusViews';
import { errorMessage, mediaSource } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { colors, fonts, radii, spacing } from '@/theme';
import { Button, EmptyState, GlassCard, Icon, Sheet, Skeleton, Tag, Text, toast } from '@/ui';

import { useDeletePrescription } from './api';
import { rowSummary, timesText, toRows } from './rows';
import type { PrescriptionClient } from './types';

export function rxTitle(p: PrescriptionClient): string {
  return p.doctor || (p.medicines.length ? p.medicines.slice(0, 3).map((m) => m.name).join(', ') : 'Prescription');
}

/**
 * The date to show: the one written on the prescription, else the day it was scanned or typed in the member's
 * timezone (`created_at` is a UTC instant — a 01:30 IST scan is the previous day in UTC).
 */
function rxDate(p: PrescriptionClient, tz: string): string {
  if (p.issued_on) return p.issued_on.slice(0, 10);
  const at = new Date(p.created_at);
  return Number.isNaN(at.getTime()) ? p.created_at.slice(0, 10) : dateIn(tz, at);
}

function medicineCount(p: PrescriptionClient): number {
  return p.status === 'applied' ? (p.applied_medication_ids?.length ?? p.medicines.length) : p.medicines.length;
}

function Thumb({ url, size = 56 }: { url: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  return (
    <View style={[styles.thumb, { width: size, height: size }]}>
      {url && !failed ? (
        <Image source={mediaSource(url)} style={StyleSheet.absoluteFill} contentFit="cover" transition={160} cachePolicy="memory-disk" onError={() => setFailed(true)} />
      ) : (
        <Icon name="file-text" size={20} color={colors.muted} />
      )}
    </View>
  );
}

export function HistorySkeleton() {
  return (
    <View style={styles.list} accessibilityLabel="Loading your prescriptions">
      {[0, 1, 2].map((i) => (
        <GlassCard key={i} padding={spacing.md} style={styles.row}>
          <Skeleton width={56} height={56} radius={radii.sm} />
          <View style={styles.flex}>
            <Skeleton width="70%" height={16} />
            <Skeleton width="45%" height={12} style={styles.skelGap} />
          </View>
        </GlassCard>
      ))}
    </View>
  );
}

function HistoryRow({ p, index, year, tz, onPress }: { p: PrescriptionClient; index: number; year: number; tz: string; onPress: () => void }) {
  const applied = p.status === 'applied';
  const count = medicineCount(p);
  const title = rxTitle(p);
  const date = formatDateShort(rxDate(p, tz), year);
  return (
    <Animated.View entering={FadeInDown.delay(Math.min(index, 6) * 45).springify().damping(18)} exiting={FadeOut.duration(180)} layout={LinearTransition.springify().damping(20)}>
      <GlassCard
        padding={spacing.md}
        onPress={onPress}
        haptic="tap"
        accessibilityLabel={`${title}, ${date}, ${count} medicine${count === 1 ? '' : 's'}, ${applied ? 'alarms created' : 'needs review'}`}
        style={styles.row}
      >
        <Thumb url={p.photo_url} />
        <View style={styles.flex}>
          <Text variant="title" numberOfLines={1}>
            {title}
          </Text>
          <View style={styles.meta}>
            <Text variant="caption" tone="muted">
              {date} · {count} medicine{count === 1 ? '' : 's'}
            </Text>
            <Tag label={applied ? 'Alarms created' : 'Needs review'} tone={applied ? 'success' : 'warning'} dot />
          </View>
        </View>
        <Icon name="chevron-right" size={18} color={colors.subtle} />
      </GlassCard>
    </Animated.View>
  );
}

function DetailSheet({ p, year, tz, onClose }: { p: PrescriptionClient | null; year: number; tz: string; onClose: () => void }) {
  const { height } = useWindowDimensions();
  const remove = useDeletePrescription();
  const [shown, setShown] = useState<PrescriptionClient | null>(p);
  // Keep the last prescription on screen while the sheet animates out.
  if (p && p !== shown) setShown(p);
  const rx = p ?? shown;
  if (!rx) return null;
  const applied = rx.status === 'applied';
  const rows = toRows(rx.medicines);

  const confirmDelete = () => {
    haptics.warning();
    Alert.alert('Delete this prescription?', applied ? 'Medicines created from it keep their alarms.' : 'This removes the scan and its photo.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          remove.mutate(rx.id, {
            onSuccess: () => {
              toast.success('Prescription deleted');
              onClose();
            },
            onError: (e) => toast.error(errorMessage(e)),
          }),
      },
    ]);
  };

  const open = () => {
    onClose();
    if (applied) router.dismissTo('/medicines');
    else router.push({ pathname: '/rx/review', params: { id: rx.id } });
  };

  return (
    <Sheet
      visible={!!p}
      onClose={onClose}
      eyebrow={formatDateShort(rxDate(rx, tz), year)}
      title={rxTitle(rx)}
      dismissible={!remove.isPending}
      footer={
        <View style={styles.sheetActions}>
          <Button
            label="Delete"
            icon="trash-2"
            variant="ghost"
            onPress={confirmDelete}
            loading={remove.isPending}
            accessibilityLabel={`Delete prescription ${rxTitle(rx)}`}
          />
          <Button
            label={applied ? 'See medicines' : 'Review & create alarms'}
            icon={applied ? 'mci:pill' : 'bell'}
            variant={applied ? 'secondary' : 'energy'}
            onPress={open}
            disabled={remove.isPending}
            style={styles.flex}
          />
        </View>
      }
    >
      {rx.photo_url ? (
        <View style={[styles.photo, { height: Math.round(height * 0.42) }]}>
          <Image source={mediaSource(rx.photo_url)} style={StyleSheet.absoluteFill} contentFit="contain" transition={200} accessibilityLabel="Prescription photo" />
        </View>
      ) : (
        <Text variant="small" tone="muted">
          No photo was attached.
        </Text>
      )}

      <View style={styles.facts}>
        <Tag label={applied ? 'Alarms created' : 'Needs review'} tone={applied ? 'success' : 'warning'} dot />
        {rx.patient_name ? <Fact label="Patient" value={rx.patient_name} /> : null}
        {rx.notes ? <Fact label="Notes" value={rx.notes} /> : null}
      </View>

      {rows.length ? (
        <View style={styles.meds}>
          <Text variant="eyebrow" tone="subtle">
            {rows.length} medicine{rows.length === 1 ? '' : 's'}
          </Text>
          {rows.map((r) => (
            <View key={r.key} style={styles.medRow}>
              <Icon name="mci:pill" size={16} color={colors.energyInk} />
              <View style={styles.flex}>
                <Text variant="label">{medicineTitle(r)}</Text>
                <Text variant="caption" tone="muted">
                  {rowSummary(r)}
                </Text>
                <Text variant="caption" tone="subtle">
                  {timesText(r)}
                </Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </Sheet>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text variant="small">{value}</Text>
    </View>
  );
}

export function HistoryList({
  items,
  isPending,
  error,
  onRetry,
  retrying,
  year,
  tz,
}: {
  items: PrescriptionClient[] | undefined;
  isPending: boolean;
  error: unknown;
  onRetry: () => void;
  retrying: boolean;
  year: number;
  /** The member's timezone — dates prescriptions that have no written date. */
  tz: string;
}) {
  const [selected, setSelected] = useState<PrescriptionClient | null>(null);

  let body;
  if (isPending) body = <HistorySkeleton />;
  else if (error && !items) body = <ErrorPanel error={error} onRetry={onRetry} retrying={retrying} />;
  else if (!items?.length)
    body = (
      <GlassCard padding={spacing.sm}>
        <EmptyState icon="file-text" title="No prescriptions yet" body="Prescriptions you scan or type appear here, with their photo and the alarms they created." />
      </GlassCard>
    );
  else
    body = (
      <View style={styles.list}>
        {items.map((p, i) => (
          <HistoryRow key={p.id} p={p} index={i} year={year} tz={tz} onPress={() => setSelected(p)} />
        ))}
      </View>
    );

  return (
    <>
      {body}
      <DetailSheet p={selected} year={year} tz={tz} onClose={() => setSelected(null)} />
    </>
  );
}


const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  skelGap: { marginTop: spacing.sm },
  thumb: {
    borderRadius: radii.sm,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.canvas2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, marginTop: 4 },
  photo: { borderRadius: radii.md, overflow: 'hidden', backgroundColor: colors.canvas2 },
  facts: { marginTop: spacing.lg, gap: spacing.md, alignItems: 'flex-start' },
  fact: { gap: 2 },
  factLabel: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 1.4, textTransform: 'uppercase', color: colors.subtle },
  meds: { marginTop: spacing.xl, gap: spacing.md },
  medRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  sheetActions: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
});
