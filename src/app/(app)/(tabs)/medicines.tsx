/**
 * Medicines tab — scan-a-prescription hero, "Alarms on this phone" (compact: next alarm / what to fix / quiet-hour doses),
 * today's dose timeline (Take / Snooze / Skip), 7-day adherence,
 * person filter (caregiver mode) and the medicine list. Pull to refresh; refreshes itself every minute and on dose events.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { AlarmStatusCard } from '@/features/alarms/AlarmStatusCard';
import { AdherenceSkeleton, AdherenceStrip } from '@/features/meds/AdherenceStrip';
import { useAdherence, useDoseActions, useLocalToday, useMedications, useMedsEventRefresh, useMedsTimezone, useTodayDoses } from '@/features/meds/api';
import { MedicineCard, MedicineCardSkeleton } from '@/features/meds/MedicineCard';
import { formatDateShort, matchesPerson, needsRefill } from '@/features/meds/shared';
import { DashedNote, ErrorPanel } from '@/features/meds/StatusViews';
import { TimelineSkeleton, TodayTimeline } from '@/features/meds/TodayTimeline';
import type { PersonFilter } from '@/features/meds/types';
import { errorMessage } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { colors, gutter, spacing } from '@/theme';
import { Button, Chip, EmptyState, GlassCard, Icon, IconButton, Orb, ProgressBar, Screen, ScreenHeader, SectionHeader, Tag, Text, toast } from '@/ui';

const openAdd = () => router.push('/med/edit');
const openScan = () => router.push('/rx');

function ScanHero() {
  return (
    <GlassCard tone="hero" glow padding={spacing.xl} style={styles.hero}>
      <View style={styles.heroOrb} pointerEvents="none">
        <Orb size={110} tone="dark" orbits={false} />
      </View>
      <View style={styles.heroIcon}>
        <Icon name="mci:line-scan" size={22} color={colors.cream} />
      </View>
      <Text variant="eyebrow" tone="heroSubtle" style={styles.heroEyebrow}>
        Auto alarms
      </Text>
      <Text variant="h3" tone="inverse" style={styles.heroTitle}>
        Scan a prescription, get alarms automatically
      </Text>
      <Text variant="small" tone="heroMuted" style={styles.heroBody}>
        Snap your doctor&apos;s prescription — ÖRZA reads 1-0-1, BD, TDS, “after food” and “x 5 days”, and sets every alarm for you to review.
      </Text>
      <Button label="Scan a prescription" icon="camera" variant="energy" onPress={openScan} style={styles.heroBtn} />
    </GlassCard>
  );
}

export default function Medicines() {
  const tz = useMedsTimezone();
  const today = useLocalToday(tz);
  const meds = useMedications();
  const todayQ = useTodayDoses(today);
  const adherence = useAdherence(7);
  const { act, pendingFor } = useDoseActions(today, tz);
  const [person, setPerson] = useState<PersonFilter>('all');
  const [refreshing, setRefreshing] = useState(false);
  useMedsEventRefresh();

  const medsList = meds.data ?? [];
  const people = [...new Set(medsList.map((m) => m.for_person).filter((p): p is string => !!p))].sort();
  const filter: PersonFilter = person === 'all' || person === 'me' || people.includes(person) ? person : 'all';
  const filteredMeds = medsList.filter((m) => matchesPerson(m.for_person, filter));
  const doses = (todayQ.data?.doses ?? []).filter((d) => matchesPerson(d.for_person, filter));
  const taken = doses.filter((d) => d.status === 'taken').length;
  const dueNow = doses.filter((d) => d.status === 'due').length;
  // Follows the person filter: under "Mom" a refill note about Papa's medicine pointed at a card that isn't listed.
  const refillCount = filteredMeds.filter(needsRefill).length;
  const noMeds = meds.isSuccess && medsList.length === 0;
  const year = Number(today.slice(0, 4));

  async function onRefresh() {
    haptics.soft();
    setRefreshing(true);
    try {
      const results = await Promise.all([meds.refetch(), todayQ.refetch(), adherence.refetch()]);
      const failed = results.find((r) => r.isError && r.data !== undefined);
      if (failed) toast.error(errorMessage(failed.error));
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <Screen
      backdrop="orb"
      tabBar
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.coral} colors={[colors.coral]} progressBackgroundColor={colors.canvas} />
      }
    >
      <ScreenHeader
        eyebrow="Care · Medicines"
        title="Medicines"
        subtitle="Every alarm shows the medicine's photo — so the right strip is never in doubt."
        right={<IconButton icon="plus" variant="solid" accessibilityLabel="Add a medicine" onPress={openAdd} haptic="firm" />}
      />

      <Animated.View entering={FadeInDown.delay(40).springify().damping(18).stiffness(100).mass(1)}>
        <ScanHero />
      </Animated.View>

      {/* Alarms on this phone: the next alarm, or what stops them ringing; doses inside quiet hours. */}
      <Animated.View entering={FadeInDown.delay(70).springify().damping(18).stiffness(100).mass(1)}>
        <AlarmStatusCard variant="compact" hideWhenIdle={noMeds} style={styles.section} />
      </Animated.View>

      {people.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.peopleScroll}
          contentContainerStyle={styles.people}
          accessibilityRole="radiogroup"
          accessibilityLabel="Show medicines for"
        >
          {[{ key: 'all', label: 'Everyone' }, { key: 'me', label: 'Me' }, ...people.map((p) => ({ key: p, label: p }))].map((o) => (
            <Chip
              key={o.key}
              label={o.label}
              size="sm"
              role="radio"
              selected={filter === o.key}
              icon={o.key === 'all' ? 'users' : o.key === 'me' ? 'user' : undefined}
              onPress={() => setPerson(o.key)}
            />
          ))}
        </ScrollView>
      ) : null}

      {noMeds ? (
        <Animated.View entering={FadeInDown.delay(100).springify().damping(18).stiffness(100).mass(1)}>
          <GlassCard padding={spacing.sm} style={styles.section}>
            <EmptyState
              icon="mci:pill"
              title="No medicines yet"
              body="Add a medicine with a photo of its strip or bottle, or scan a prescription and ÖRZA sets the alarms for you."
              actionLabel="Scan a prescription"
              actionVariant="energy"
              onAction={openScan}
            />
            <Button label="Add manually" icon="plus" variant="secondary" onPress={openAdd} style={styles.emptySecond} />
          </GlassCard>
        </Animated.View>
      ) : (
        <>
          {/* Today */}
          <Animated.View entering={FadeInDown.delay(100).springify().damping(18).stiffness(100).mass(1)}>
            <GlassCard padding={spacing.lg} style={styles.section}>
              <View style={styles.todayHead}>
                <View style={styles.flex}>
                  <Text variant="eyebrow" tone="subtle">
                    {formatDateShort(today, year)}
                  </Text>
                  <Text variant="h2" accessibilityRole="header">
                    Today
                  </Text>
                </View>
                {doses.length > 0 ? (
                  <View style={styles.todayCount}>
                    {dueNow > 0 ? <Tag label={`${dueNow} due now`} tone="energy" dot /> : null}
                    <Text variant="small" tone="muted">
                      <Text variant="small" weight="semibold" tone="ink">
                        {taken}
                      </Text>{' '}
                      of {doses.length} taken
                    </Text>
                  </View>
                ) : null}
              </View>
              {doses.length > 0 ? (
                <ProgressBar
                  value={taken / doses.length}
                  height={6}
                  palette={taken === doses.length ? 'success' : 'energy'}
                  style={styles.progress}
                  accessibilityLabel={`${taken} of ${doses.length} doses taken today`}
                />
              ) : null}

              {/* Wait for the medicine list too: an empty day answered first flashed "No doses scheduled today" before a
                  member with no medicines saw the "No medicines yet" empty state. */}
              {todayQ.isPending || (meds.isPending && doses.length === 0) ? (
                <TimelineSkeleton />
              ) : todayQ.isError && !todayQ.data ? (
                <ErrorPanel error={todayQ.error} onRetry={() => void todayQ.refetch()} retrying={todayQ.isFetching} />
              ) : doses.length === 0 ? (
                <DashedNote
                  title="No doses scheduled today"
                  body={
                    filter !== 'all'
                      ? 'Nothing is scheduled today for this person. Choose Everyone to see all doses.'
                      : medsList.some((m) => m.active && !m.as_needed)
                        ? 'Nothing is due today on your current schedules. Enjoy the day.'
                        : 'Medicines with alarm times will show up here with Take, Snooze and Skip.'
                  }
                />
              ) : (
                <TodayTimeline doses={doses} tz={tz} pendingFor={pendingFor} onAct={(d, a) => void act(d, a)} />
              )}
            </GlassCard>
          </Animated.View>

          {/* Adherence */}
          <Animated.View entering={FadeInDown.delay(160).springify().damping(18).stiffness(100).mass(1)}>
            <GlassCard padding={spacing.lg} style={styles.section}>
              <Text variant="eyebrow" tone="subtle" style={styles.cardEyebrow}>
                {/* Adherence comes for all medicines together — say so while the list is filtered to one person. */}
                {filter === 'all' ? 'Last 7 days' : 'Last 7 days · everyone'}
              </Text>
              {adherence.data ? (
                <AdherenceStrip data={adherence.data} today={today} />
              ) : adherence.isError ? (
                <ErrorPanel error={adherence.error} onRetry={() => void adherence.refetch()} retrying={adherence.isFetching} />
              ) : (
                <AdherenceSkeleton />
              )}
            </GlassCard>
          </Animated.View>

          {/* Medicine list */}
          <SectionHeader title="Your medicines" actionLabel="Add" onAction={openAdd} style={styles.listHeader} />
          {refillCount > 0 ? (
            <View style={styles.refill} accessibilityRole="alert">
              <Icon name="alert-circle" size={15} color={colors.error} />
              <Text variant="small" tone="error">
                {refillCount === 1 ? '1 medicine needs a refill soon.' : `${refillCount} medicines need a refill soon.`}
              </Text>
            </View>
          ) : null}
          <View style={styles.cards}>
            {meds.isPending ? (
              [0, 1, 2].map((i) => <MedicineCardSkeleton key={i} />)
            ) : meds.isError && !meds.data ? (
              <ErrorPanel error={meds.error} onRetry={() => void meds.refetch()} retrying={meds.isFetching} />
            ) : filteredMeds.length === 0 ? (
              <DashedNote body="No medicines for this person yet." />
            ) : (
              filteredMeds.map((m, i) => (
                <Animated.View key={m.id} entering={FadeInDown.delay(Math.min(i, 8) * 45).springify().damping(18).stiffness(100).mass(1)}>
                  <MedicineCard med={m} today={today} onPress={() => router.push({ pathname: '/med/[id]', params: { id: m.id } })} />
                </Animated.View>
              ))
            )}
          </View>

          <View style={styles.footerLinks}>
            <Button label="Reminder settings" icon="bell" variant="ghost" size="sm" onPress={() => router.push('/reminders')} />
            <Button label="Prescriptions" icon="file-text" variant="ghost" size="sm" onPress={openScan} />
          </View>
          <Text variant="caption" tone="subtle" align="center" style={styles.disclaimer}>
            ÖRZA reminds you to take medicines as your doctor prescribed — it never changes doses. Always follow your doctor&apos;s advice.
          </Text>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  hero: { overflow: 'hidden', marginTop: spacing.xs },
  heroOrb: { position: 'absolute', right: -24, top: -26, opacity: 0.9 },
  heroIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: colors.heroGlassBorder,
  },
  heroEyebrow: { marginTop: spacing.lg },
  heroTitle: { marginTop: spacing.xs, paddingRight: spacing.xxxl },
  heroBody: { marginTop: spacing.sm },
  heroBtn: { marginTop: spacing.lg, alignSelf: 'flex-start' },
  peopleScroll: { marginHorizontal: -gutter, marginTop: spacing.lg, flexGrow: 0 },
  people: { paddingHorizontal: gutter, gap: spacing.sm },
  section: { marginTop: spacing.lg },
  emptySecond: { alignSelf: 'center', marginBottom: spacing.lg },
  todayHead: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md, marginBottom: spacing.md },
  todayCount: { alignItems: 'flex-end', gap: spacing.xs },
  progress: { marginBottom: spacing.lg },
  cardEyebrow: { marginBottom: spacing.md },
  listHeader: { marginTop: spacing.xxl },
  refill: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.md },
  cards: { gap: spacing.md },
  footerLinks: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.xl },
  disclaimer: { marginTop: spacing.sm, paddingHorizontal: spacing.md },
});
