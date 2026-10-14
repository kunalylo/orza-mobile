/**
 * Medicine detail — photo carousel, schedule, stock, today's doses, adherence history, edit / pause / delete.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import {
  useAdherence,
  useDeleteMedication,
  useDoseActions,
  useLocalToday,
  useMedication,
  useMedsEventRefresh,
  useMedsTimezone,
  useSetMedicationActive,
  useTodayDoses,
} from '@/features/meds/api';
import { MedPhoto } from '@/features/meds/MedPhoto';
import {
  daysLeftText,
  doseKey,
  formatDateShort,
  formatTime12,
  medicineSubtitle,
  needsRefill,
  refillThreshold,
  repeatSummary,
  scheduleSummary,
  TIMING_INSTRUCTION,
  TIMING_LABEL,
} from '@/features/meds/shared';
import { ErrorPanel } from '@/features/meds/StatusViews';
import { DoseRow } from '@/features/meds/TodayTimeline';
import type { AdherenceMedicine, MedicationClient } from '@/features/meds/types';
import { ApiError, errorMessage } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { colors, fonts, gutter, radii, spacing } from '@/theme';
import { Button, EmptyState, EnergyRing, GlassCard, Icon, IconButton, Screen, ScreenHeader, Skeleton, Tag, Text, toast } from '@/ui';

function Carousel({ med, width }: { med: MedicationClient; width: number }) {
  const [page, setPage] = useState(0);
  const height = Math.round(width * 0.75);
  const photos = med.photo_urls;
  const onEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => setPage(Math.round(e.nativeEvent.contentOffset.x / width));

  if (!photos.length) {
    return (
      <View style={[styles.carousel, { width, height: Math.round(width * 0.56) }]}>
        <MedPhoto url={null} fill radius={radii.lg} />
        <View style={styles.noPhoto}>
          <Button label="Add a photo — alarms show it" icon="camera" variant="secondary" size="sm" onPress={() => router.push({ pathname: '/med/edit', params: { id: med.id } })} />
        </View>
      </View>
    );
  }

  return (
    <View>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onEnd}
        style={[styles.carousel, { width, height }]}
        accessibilityLabel={`${photos.length} photo${photos.length > 1 ? 's' : ''} of ${med.name}`}
      >
        {photos.map((url, i) => (
          <View key={url} style={{ width, height }}>
            <MedPhoto url={url} fill radius={0} accessibilityLabel={`${med.name} photo ${i + 1} of ${photos.length}${i === 0 ? ', shown on alarms' : ''}`} />
          </View>
        ))}
      </ScrollView>
      {photos.length > 1 ? (
        <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {photos.map((url, i) => (
            <View key={url} style={[styles.dot, i === page && styles.dotOn]} />
          ))}
        </View>
      ) : null}
      {page === 0 ? (
        <View style={styles.onAlarm}>
          <Icon name="bell" size={11} color={colors.white} />
          <Text variant="caption" color={colors.white} style={styles.onAlarmText}>
            On alarm
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
    </View>
  );
}

function HistoryBlock({ title, t }: { title: string; t?: AdherenceMedicine }) {
  if (!t) {
    return (
      <View style={styles.historyRow}>
        <EnergyRing progress={0} size={52} stroke={6} accessibilityLabel={`${title}: no doses due`}>
          <Text variant="caption" tone="subtle">
            –
          </Text>
        </EnergyRing>
        <View style={styles.flex}>
          <Text variant="label">{title}</Text>
          <Text variant="small" tone="muted">
            No doses were due.
          </Text>
        </View>
      </View>
    );
  }
  const pct = t.rate != null ? Math.round(t.rate * 100) : null;
  const extra = [t.missed ? `${t.missed} missed` : null, t.skipped ? `${t.skipped} skipped` : null].filter(Boolean).join(' · ');
  return (
    <View style={styles.historyRow}>
      <EnergyRing
        progress={t.rate ?? 0}
        size={52}
        stroke={6}
        palette={pct != null && pct >= 90 ? 'success' : 'energy'}
        accessibilityLabel={`${title}: ${t.taken} of ${t.total} doses taken`}
      >
        <Text variant="caption" weight="semibold">
          {pct != null ? `${pct}%` : '–'}
        </Text>
      </EnergyRing>
      <View style={styles.flex}>
        <Text variant="label">{title}</Text>
        <Text variant="small" tone="muted">
          {t.total ? `${t.taken} of ${t.total} doses taken` : 'Nothing due yet.'}
        </Text>
        {extra ? (
          <Text variant="caption" tone={t.missed ? 'error' : 'subtle'}>
            {extra}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export default function MedicineDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();
  const tz = useMedsTimezone();
  const today = useLocalToday(tz);
  const medQ = useMedication(id);
  const todayQ = useTodayDoses(today);
  const week = useAdherence(7);
  const month = useAdherence(30);
  const { act, pendingFor } = useDoseActions(today, tz);
  const setActive = useSetMedicationActive();
  const del = useDeleteMedication();
  const [refreshing, setRefreshing] = useState(false);
  useMedsEventRefresh();

  const med = medQ.data;
  const contentWidth = Math.min(width, 640) - gutter * 2;
  const year = Number(today.slice(0, 4));

  async function onRefresh() {
    haptics.soft();
    setRefreshing(true);
    try {
      const results = await Promise.all([medQ.refetch(), todayQ.refetch(), week.refetch(), month.refetch()]);
      const failed = results.find((r) => r.isError);
      if (failed) toast.error(errorMessage(failed.error));
    } finally {
      setRefreshing(false);
    }
  }

  function toggleActive() {
    if (!med) return;
    setActive.mutate(
      { id: med.id, active: !med.active },
      {
        onSuccess: (m) => toast.success(m.active ? `Reminders for ${m.name} are back on` : `Reminders for ${m.name} paused`),
        onError: (e) => toast.error(errorMessage(e)),
      }
    );
  }

  function confirmDelete() {
    if (!med) return;
    haptics.warning();
    Alert.alert(`Delete ${med.name}?`, 'This deletes the medicine, its photos and its dose history. It can’t be undone.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Yes, delete',
        style: 'destructive',
        onPress: () =>
          del.mutate(med.id, {
            onSuccess: () => {
              toast.success(`${med.name} deleted`);
              if (router.canGoBack()) router.back();
              else router.replace('/medicines');
            },
            onError: (e) => toast.error(errorMessage(e)),
          }),
      },
    ]);
  }

  if (!med) {
    const notFound = medQ.error instanceof ApiError && medQ.error.status === 404;
    return (
      <Screen backdrop="orb">
        <ScreenHeader back eyebrow="Medicine" title={notFound ? 'Not found' : 'Loading…'} large={false} />
        {medQ.isError ? (
          notFound ? (
            <GlassCard padding={spacing.sm}>
              <EmptyState icon="mci:pill-off" title="This medicine isn't here any more" body="It may have been deleted on another device." actionLabel="Back to medicines" onAction={() => router.replace('/medicines')} />
            </GlassCard>
          ) : (
            <ErrorPanel error={medQ.error} onRetry={() => void medQ.refetch()} retrying={medQ.isFetching} />
          )
        ) : (
          <View style={styles.gapLg}>
            <Skeleton height={Math.round(contentWidth * 0.75)} radius={radii.lg} />
            <Skeleton width="60%" height={22} />
            <Skeleton height={120} radius={radii.lg} />
            <Skeleton height={160} radius={radii.lg} />
          </View>
        )}
      </Screen>
    );
  }

  const ended = !!med.schedule.end_date && med.schedule.end_date < today;
  const refill = needsRefill(med);
  const left = daysLeftText(med);
  const myDoses = (todayQ.data?.doses ?? []).filter((d) => d.medication_id === med.id);
  const weekT = week.data?.medicines.find((m) => m.medication_id === med.id);
  const monthT = month.data?.medicines.find((m) => m.medication_id === med.id);
  const timingLine = TIMING_INSTRUCTION[med.timing];

  return (
    <Screen
      backdrop="orb"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.coral} colors={[colors.coral]} progressBackgroundColor={colors.canvas} />}
    >
      <ScreenHeader
        back
        large={false}
        eyebrow={med.for_person ? `Medicine · for ${med.for_person}` : 'Medicine'}
        title={[med.name, med.strength].filter(Boolean).join(' ')}
        subtitle={medicineSubtitle({ ...med, strength: undefined }) || undefined}
        right={<IconButton icon="edit-3" accessibilityLabel={`Edit ${med.name}`} onPress={() => router.push({ pathname: '/med/edit', params: { id: med.id } })} />}
      />

      <Animated.View entering={FadeInDown.springify().damping(18)}>
        <Carousel med={med} width={contentWidth} />
        {med.uses_prescription_photo ? (
          <View style={styles.rxNote}>
            <Icon name="camera" size={14} color={colors.warning} />
            <Text variant="caption" color={colors.warning} style={styles.flex}>
              Showing your prescription for now. Your first pill photo replaces it on alarms.
            </Text>
          </View>
        ) : null}
      </Animated.View>

      <View style={styles.tags}>
        {!med.active ? <Tag label="Paused" icon="pause-circle" tone="neutral" /> : null}
        {med.active && ended ? <Tag label="Course finished" tone="neutral" /> : null}
        {med.as_needed ? <Tag label="SOS" tone="info" /> : null}
        {med.timing !== 'any' ? <Tag label={TIMING_LABEL[med.timing]} tone="warning" /> : null}
        {med.for_person ? <Tag label={`For ${med.for_person}`} tone="violet" /> : null}
        {refill ? <Tag label="Refill soon" tone="error" dot /> : null}
      </View>

      {/* Schedule */}
      <Animated.View entering={FadeInDown.delay(60).springify().damping(18)}>
        <GlassCard padding={spacing.lg} style={styles.section}>
          <Text variant="eyebrow" tone="subtle">
            Schedule
          </Text>
          <Text variant="callout" style={styles.gapSm}>
            {scheduleSummary(med, today)}
          </Text>
          {!med.as_needed && med.schedule.times.length ? (
            <View style={styles.times}>
              {med.schedule.times.map((t) => (
                <View key={t} style={styles.timePill}>
                  <Icon name="bell" size={13} color={colors.energyInk} />
                  <Text variant="label" style={styles.tabular}>
                    {formatTime12(t)}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
          <View style={styles.statsRow}>
            {!med.as_needed ? <Stat label="Repeat" value={repeatSummary(med.schedule)} /> : null}
            <Stat label="Started" value={formatDateShort(med.schedule.start_date, year)} />
            <Stat label={ended ? 'Ended' : 'Until'} value={med.schedule.end_date ? formatDateShort(med.schedule.end_date, year) : 'Ongoing'} />
          </View>
          {timingLine || med.instructions ? (
            <View style={styles.instructions}>
              <Icon name="info" size={15} color={colors.cyan700} />
              <Text variant="small" style={styles.flex}>
                {[timingLine ? `${timingLine}.` : null, med.instructions].filter(Boolean).join(' ')}
              </Text>
            </View>
          ) : null}
        </GlassCard>
      </Animated.View>

      {/* Stock */}
      {med.stock ? (
        <Animated.View entering={FadeInDown.delay(100).springify().damping(18)}>
          <GlassCard padding={spacing.lg} tone={refill ? 'energy' : 'default'} style={styles.section}>
            <Text variant="eyebrow" tone="subtle">
              Stock
            </Text>
            <View style={styles.stockRow}>
              <Text style={styles.stockCount}>{med.stock.count}</Text>
              <Text variant="callout" tone="muted">
                {med.stock.unit} left
              </Text>
            </View>
            <Text variant="small" tone={refill ? 'error' : 'muted'}>
              {refill ? `Refill soon — the alert is set at ${refillThreshold(med)}.` : left ?? `Refill alert at ${refillThreshold(med)}.`}
            </Text>
            <Text variant="caption" tone="subtle" style={styles.gapXs}>
              Goes down by one each time you tap Take.
            </Text>
          </GlassCard>
        </Animated.View>
      ) : null}

      {/* Today */}
      {myDoses.length > 0 ? (
        <Animated.View entering={FadeInDown.delay(140).springify().damping(18)}>
          <GlassCard padding={spacing.lg} style={styles.section}>
            <Text variant="eyebrow" tone="subtle" style={styles.gapBottom}>
              Today
            </Text>
            <View style={styles.gapMd}>
              {myDoses.map((d) => (
                <DoseRow key={doseKey(d)} dose={d} tz={tz} pending={pendingFor(d)} onAct={(x, a) => void act(x, a)} linkToMedicine={false} />
              ))}
            </View>
          </GlassCard>
        </Animated.View>
      ) : null}

      {/* History */}
      {!med.as_needed ? (
        <Animated.View entering={FadeInDown.delay(180).springify().damping(18)}>
          <GlassCard padding={spacing.lg} style={styles.section}>
            <Text variant="eyebrow" tone="subtle" style={styles.gapBottom}>
              History
            </Text>
            {week.data && month.data ? (
              <View style={styles.gapLg}>
                <HistoryBlock title="Last 7 days" t={weekT} />
                <HistoryBlock title="Last 30 days" t={monthT} />
              </View>
            ) : week.isError || month.isError ? (
              <ErrorPanel
                error={week.error ?? month.error}
                onRetry={() => {
                  void week.refetch();
                  void month.refetch();
                }}
              />
            ) : (
              <View style={styles.gapLg}>
                <Skeleton height={52} radius={radii.sm} />
                <Skeleton height={52} radius={radii.sm} />
              </View>
            )}
          </GlassCard>
        </Animated.View>
      ) : null}

      {/* Actions */}
      <View style={styles.actions}>
        <Button label="Edit medicine" icon="edit-3" variant="primary" block onPress={() => router.push({ pathname: '/med/edit', params: { id: med.id } })} />
        <Button
          label={med.active ? 'Pause reminders' : 'Resume reminders'}
          icon={med.active ? 'pause-circle' : 'play-circle'}
          variant="secondary"
          block
          loading={setActive.isPending}
          onPress={toggleActive}
        />
        <Button label="Delete medicine" icon="trash-2" variant="danger" block loading={del.isPending} onPress={confirmDelete} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  gapXs: { marginTop: spacing.xs },
  gapSm: { marginTop: spacing.sm },
  gapMd: { gap: spacing.md },
  gapLg: { gap: spacing.lg },
  gapBottom: { marginBottom: spacing.md },
  section: { marginTop: spacing.lg },
  carousel: { borderRadius: radii.lg, overflow: 'hidden', backgroundColor: colors.canvas2 },
  noPhoto: { position: 'absolute', left: 0, right: 0, bottom: spacing.lg, alignItems: 'center' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: spacing.sm },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(20,20,20,0.18)' },
  dotOn: { width: 18, backgroundColor: colors.coral },
  onAlarm: {
    position: 'absolute',
    left: spacing.md,
    top: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(7,9,12,0.66)',
  },
  onAlarmText: { fontSize: 11, lineHeight: 14 },
  rxNote: { flexDirection: 'row', gap: 6, alignItems: 'center', marginTop: spacing.sm, padding: spacing.sm, borderRadius: radii.sm, backgroundColor: colors.warningBg },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.md },
  times: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  timePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    minHeight: 34,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.glassSolid,
  },
  tabular: { fontVariant: ['tabular-nums'] },
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, marginTop: spacing.lg },
  stat: { minWidth: 84, flexShrink: 1 },
  statValue: { fontFamily: fonts.bodySemiBold, fontSize: 15, lineHeight: 20, color: colors.ink },
  instructions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg, padding: spacing.md, borderRadius: radii.sm, backgroundColor: colors.infoBg },
  stockRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, marginTop: spacing.xs },
  stockCount: { fontFamily: fonts.display, fontSize: 34, lineHeight: 40, color: colors.ink, fontVariant: ['tabular-nums'] },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  actions: { gap: spacing.md, marginTop: spacing.xxl },
});
