/** One medicine in the list: photo, name + dose, schedule summary, stock / "Refill soon", tags. Opens the detail screen. */
import { StyleSheet, View } from 'react-native';

import { colors, radii, spacing } from '@/theme';
import { GlassCard, Icon, Skeleton, Tag, Text } from '@/ui';

import { MedPhoto } from './MedPhoto';
import { daysLeftText, medicineSubtitle, needsRefill, scheduleSummary, TIMING_LABEL } from './shared';
import type { MedicationClient } from './types';

export function MedicineCardSkeleton() {
  return (
    <GlassCard padding={spacing.md}>
      <View style={styles.row}>
        <Skeleton width={88} height={88} radius={radii.sm} />
        <View style={styles.flex}>
          <Skeleton width="65%" height={16} />
          <Skeleton width="45%" height={12} style={styles.gap} />
          <Skeleton width="90%" height={12} style={styles.gap} />
          <Skeleton width={110} height={22} radius={radii.pill} style={styles.gap} />
        </View>
      </View>
    </GlassCard>
  );
}

export function MedicineCard({ med, today, onPress }: { med: MedicationClient; today: string; onPress: () => void }) {
  const refill = needsRefill(med);
  const left = daysLeftText(med);
  const ended = !!med.schedule.end_date && med.schedule.end_date < today;
  const photos = med.photo_urls.length;
  const subtitle = medicineSubtitle(med);

  return (
    <GlassCard
      padding={spacing.md}
      onPress={onPress}
      haptic="soft"
      accessibilityLabel={`${med.name}${subtitle ? `, ${subtitle}` : ''}. ${scheduleSummary(med, today)}${refill ? '. Refill soon' : ''}${!med.active ? '. Paused' : ''}`}
      style={!med.active ? styles.paused : undefined}
    >
      <View style={styles.row}>
        <View>
          <MedPhoto url={med.photo_urls[0]} size={88} />
          {photos > 1 ? (
            <View style={styles.count}>
              <Icon name="image" size={10} color={colors.white} />
              <Text variant="caption" color={colors.white} style={styles.countText}>
                {photos}
              </Text>
            </View>
          ) : null}
        </View>
        <View style={styles.flex}>
          <View style={styles.titleRow}>
            <Text variant="title" numberOfLines={1} style={styles.flex}>
              {med.name}
            </Text>
            <Icon name="chevron-right" size={18} color={colors.subtle} />
          </View>
          {subtitle ? (
            <Text variant="small" tone="muted" numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
          <Text variant="small" tone="text" numberOfLines={2} style={styles.gapXs}>
            {scheduleSummary(med, today)}
          </Text>
          <View style={styles.tags}>
            {!med.active ? <Tag label="Paused" icon="pause-circle" tone="neutral" /> : null}
            {med.active && ended ? <Tag label="Course finished" tone="neutral" /> : null}
            {med.as_needed ? <Tag label="SOS" tone="info" /> : null}
            {med.timing !== 'any' ? <Tag label={TIMING_LABEL[med.timing]} tone="warning" /> : null}
            {med.for_person ? <Tag label={`For ${med.for_person}`} tone="violet" /> : null}
            {med.stock ? (
              <Tag label={`${refill ? 'Refill soon · ' : ''}${med.stock.count} ${med.stock.unit} left`} tone={refill ? 'error' : 'neutral'} dot />
            ) : null}
          </View>
          {med.stock && left && !refill ? (
            <Text variant="caption" tone="subtle" style={styles.gapXs}>
              {left}
            </Text>
          ) : null}
          {!photos || med.uses_prescription_photo ? (
            <View style={styles.nudge}>
              <Icon name="camera" size={13} color={colors.energyInk} />
              <Text variant="caption" weight="medium" color={colors.energyInk} style={styles.flex}>
                {photos ? 'Showing the prescription — add a pill photo' : 'Add a photo — alarms show it'}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  paused: { opacity: 0.78 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  gap: { marginTop: spacing.sm },
  gapXs: { marginTop: spacing.xs },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm },
  count: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(7,9,12,0.62)',
  },
  countText: { fontSize: 10, lineHeight: 13 },
  nudge: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm },
});
