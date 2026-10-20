/**
 * Alarms are set — what a prescription created: each medicine with its photo (the prescription photo until a pill photo
 * is added), dose, schedule and alarm times, plus "Add pill photo". Back to Medicines / Notification settings / Scan another.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, ZoomIn } from 'react-native-reanimated';

import { useLocalToday, useMedsTimezone } from '@/features/meds/api';
import { MedPhoto } from '@/features/meds/MedPhoto';
import { formatTime12, medicineTitle, scheduleSummary } from '@/features/meds/shared';
import { ErrorPanel } from '@/features/meds/StatusViews';
import type { MedicationClient } from '@/features/meds/types';
import { useCreatedMedications, usePrescription } from '@/features/rx/api';
import { colors, radii, spacing } from '@/theme';
import { Button, EnergyRing, GlassCard, Icon, Screen, ScreenHeader, Skeleton, Text } from '@/ui';

function CreatedRow({ med, today, index }: { med: MedicationClient; today: string; index: number }) {
  const times = med.as_needed ? [] : med.schedule.times;
  return (
    <Animated.View entering={FadeInDown.delay(220 + Math.min(index, 8) * 60).springify().damping(18).stiffness(100).mass(1)}>
      <GlassCard padding={spacing.md} style={styles.med}>
        <View style={styles.medTop}>
          <MedPhoto url={med.photo_urls[0]} size={56} accessibilityLabel={`${med.name} photo`} />
          <View style={styles.flex}>
            <Text variant="title" numberOfLines={2}>
              {medicineTitle(med)}
            </Text>
            <Text variant="caption" tone="muted" numberOfLines={2}>
              {med.dose} · {scheduleSummary(med, today)}
              {med.for_person ? ` · for ${med.for_person}` : ''}
            </Text>
          </View>
        </View>
        <View style={styles.times}>
          {times.length ? (
            times.map((t) => (
              <View key={t} style={styles.time}>
                <Icon name="bell" size={12} color={colors.energyInk} />
                <Text variant="caption" weight="semibold">
                  {formatTime12(t)}
                </Text>
              </View>
            ))
          ) : (
            <View style={[styles.time, styles.sos]}>
              <Text variant="caption" color={colors.cyan700}>
                SOS · no alarms
              </Text>
            </View>
          )}
        </View>
        {med.uses_prescription_photo || med.photo_urls.length === 0 ? (
          <Button
            label="Add pill photo"
            icon="camera"
            size="sm"
            variant="secondary"
            onPress={() => router.push({ pathname: '/med/edit', params: { id: med.id } })}
            accessibilityLabel={`Add a pill photo for ${med.name}`}
            style={styles.photoBtn}
          />
        ) : null}
      </GlassCard>
    </Animated.View>
  );
}

export default function PrescriptionDone() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const tz = useMedsTimezone();
  const today = useLocalToday(tz);
  const rxQ = usePrescription(id);
  const { medications, query } = useCreatedMedications(rxQ.data);
  const loading = (rxQ.isPending && !!id) || (query.isPending && !medications.length);
  const failed = !loading && !medications.length && (rxQ.isError || query.isError);
  const count = medications.length || rxQ.data?.applied_medication_ids?.length || 0;
  const alarms = medications.filter((m) => !m.as_needed).length;

  const toMedicines = () => router.dismissTo('/medicines');

  return (
    <Screen backdrop="orb">
      <ScreenHeader back large={false} eyebrow="Care · Prescriptions" title="Alarms are set" />

      <Animated.View entering={FadeInDown.delay(40).springify().damping(16).stiffness(100).mass(1)}>
        <GlassCard tone="dark" glow padding={spacing.xl} style={styles.hero}>
          <EnergyRing progress={1} size={92} stroke={8} palette="success" trackColor="rgba(255,255,255,0.12)" accessibilityLabel="Done">
            <Animated.View entering={ZoomIn.delay(380).springify().damping(12).stiffness(100).mass(1)}>
              <Icon name="check" size={34} color={colors.white} />
            </Animated.View>
          </EnergyRing>
          <Text variant="h2" tone="inverse" align="center" style={styles.heroTitle} accessibilityRole="header">
            {count ? `${count} medicine${count === 1 ? '' : 's'} added` : 'Medicines added'}
          </Text>
          <Text variant="small" tone="heroMuted" align="center" style={styles.heroBody}>
            {alarms
              ? `${alarms === count ? 'Every one' : `${alarms} of them`} will ring with its photo at the times below. Add a photo of each strip or bottle so everyone can match the right medicine at a glance.`
              : 'Alarms show the prescription photo for now. Add a photo of each strip or bottle so everyone can match the right medicine at a glance.'}
          </Text>
        </GlassCard>
      </Animated.View>

      <View style={styles.list}>
        {loading ? (
          [0, 1].map((i) => (
            <GlassCard key={i} padding={spacing.md} style={styles.med}>
              <View style={styles.medTop}>
                <Skeleton width={56} height={56} radius={radii.sm} />
                <View style={styles.flex}>
                  <Skeleton width="60%" height={16} />
                  <Skeleton width="80%" height={12} style={styles.gap} />
                </View>
              </View>
            </GlassCard>
          ))
        ) : failed ? (
          <ErrorPanel error={rxQ.error ?? query.error} onRetry={() => void Promise.all([rxQ.refetch(), query.refetch()])} retrying={rxQ.isFetching || query.isFetching} />
        ) : (
          medications.map((m, i) => <CreatedRow key={m.id} med={m} today={today} index={i} />)
        )}
      </View>

      <Animated.View entering={FadeInDown.delay(320).springify().damping(18).stiffness(100).mass(1)} style={styles.actions}>
        <Button label="See today's doses" iconRight="chevron-right" variant="primary" size="lg" block onPress={toMedicines} />
        <View style={styles.row}>
          <Button label="Notifications" icon="bell" variant="secondary" onPress={() => router.push('/reminders')} style={styles.flex} />
          <Button label="Scan another" icon="mci:line-scan" variant="ghost" onPress={() => router.dismissTo('/rx')} style={styles.flex} />
        </View>
      </Animated.View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { marginTop: spacing.sm },
  hero: { marginTop: spacing.lg, alignItems: 'center' },
  heroTitle: { marginTop: spacing.lg },
  heroBody: { marginTop: spacing.sm, maxWidth: 340 },
  list: { marginTop: spacing.lg, gap: spacing.sm },
  med: { gap: spacing.md },
  medTop: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  times: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  time: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.energyBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(194,65,12,0.18)',
  },
  sos: { backgroundColor: colors.cyan50, borderColor: 'rgba(11,143,166,0.22)' },
  photoBtn: { alignSelf: 'flex-start' },
  actions: { marginTop: spacing.xxl, gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
});
