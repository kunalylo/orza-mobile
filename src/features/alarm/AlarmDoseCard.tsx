/**
 * One medicine on the alarm: its photos, name / strength, dose, food timing, instructions, who it's for and
 * Take / Snooze 10 min / Skip. Once handled it collapses to a status row (taken, snoozed, skipped, gone).
 */
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';

import { MedPhoto } from '@/features/meds/MedPhoto';
import { clockIn, formatTime12, SNOOZE_MINUTES, statusDetail, TIMING_INSTRUCTION } from '@/features/meds/shared';
import type { DoseAction, DoseItem } from '@/features/meds/types';
import { colors, fonts, radii, spacing } from '@/theme';
import { Button, Icon, PressableScale, Text, type IconName } from '@/ui';

import type { HandledDose } from './api';
import { PhotoCarousel } from './PhotoCarousel';

/** "Take 1 tablet" when the dose reads as an amount, else "Take now". */
function takeLabel(dose: string): string {
  return /^[0-9½¼¾]/.test(dose) && dose.length <= 18 ? `Take ${dose}` : 'Take now';
}

function StatusPill({ dose, tz }: { dose: DoseItem; tz: string }) {
  if (dose.status === 'snoozed' && dose.snooze_until) {
    return (
      <View style={[styles.pill, styles.pillInfo]}>
        <Icon name="clock" size={12} color={colors.cyan300} />
        <Text variant="caption" color={colors.cyan300}>
          Snoozed until {clockIn(tz, new Date(dose.snooze_until))}
        </Text>
      </View>
    );
  }
  if (dose.status === 'missed') {
    return (
      <View style={[styles.pill, styles.pillMissed]}>
        <Text variant="caption" color="#FFB4A8">
          Was due at {formatTime12(dose.local_time)}
        </Text>
      </View>
    );
  }
  if (dose.status === 'upcoming') {
    return (
      <View style={[styles.pill, styles.pillNeutral]}>
        <Text variant="caption" tone="heroMuted">
          Due at {formatTime12(dose.local_time)}
        </Text>
      </View>
    );
  }
  return null;
}

export function AlarmDoseCard({
  dose,
  tz,
  primary,
  pending,
  onAct,
  onAddPhoto,
}: {
  dose: DoseItem;
  tz: string;
  /** The first medicine on the alarm — larger photo and title. */
  primary: boolean;
  pending?: DoseAction;
  onAct: (action: DoseAction) => void;
  /**
   * "Add a photo" when the medicine has none. Default: open the medicine form. The alarm screen passes its own (it
   * asks for the phone's unlock first when showing over the lock screen); null hides it (the test alarm).
   */
  onAddPhoto?: (() => void) | null;
}) {
  const busy = !!pending;
  const timing = TIMING_INSTRUCTION[dose.timing];
  return (
    <Animated.View
      entering={FadeInDown.springify().damping(18).stiffness(100).mass(1)}
      exiting={FadeOut.duration(180)}
      layout={LinearTransition.springify().damping(20).stiffness(100).mass(1)}
      style={[styles.card, primary && styles.cardPrimary]}
    >
      <PhotoCarousel
        urls={dose.photo_urls}
        title={dose.name}
        aspect={primary ? 4 / 3 : 16 / 10}
        onAddPhoto={
          onAddPhoto === null ? undefined : (onAddPhoto ?? (() => router.push({ pathname: '/med/edit', params: { id: dose.medication_id } })))
        }
      />

      <View style={styles.info}>
        <StatusPill dose={dose} tz={tz} />
        <Text style={[styles.name, !primary && styles.nameSmall]} accessibilityRole="header">
          {dose.name}
          {dose.strength ? <Text style={styles.strength}>{`  ${dose.strength}`}</Text> : null}
        </Text>
        <Text style={styles.dose}>{dose.dose}</Text>
        {timing ? (
          <View style={styles.timing}>
            <Icon name="mci:silverware-fork-knife" size={14} color="#FFD08A" />
            <Text variant="label" color="#FFD08A">
              {timing}
            </Text>
          </View>
        ) : null}
        {dose.instructions ? (
          <Text variant="small" tone="heroMuted">
            {dose.instructions}
          </Text>
        ) : null}
        {dose.for_person ? (
          <View style={styles.forRow}>
            <Icon name="user" size={14} color={colors.heroMuted} />
            <Text variant="small" tone="heroMuted">
              For {dose.for_person}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.actions}>
        <Button
          label={takeLabel(dose.dose)}
          icon="check-circle"
          variant="energy"
          size="lg"
          block
          haptic="firm"
          loading={pending === 'take'}
          disabled={busy}
          onPress={() => onAct('take')}
          accessibilityLabel={`Take ${dose.name}, ${dose.dose}`}
        />
        <View style={styles.row}>
          <Button
            label={`Snooze ${SNOOZE_MINUTES} min`}
            icon="clock"
            variant="heroOutline"
            loading={pending === 'snooze'}
            disabled={busy}
            onPress={() => onAct('snooze')}
            accessibilityLabel={`Snooze ${dose.name} for ${SNOOZE_MINUTES} minutes`}
            style={styles.flex}
          />
          <PressableScale
            onPress={() => onAct('skip')}
            disabled={busy}
            haptic="tap"
            style={[styles.skip, busy && styles.disabled]}
            accessibilityRole="button"
            accessibilityLabel={`Skip this dose of ${dose.name}`}
            accessibilityState={{ disabled: busy, busy: pending === 'skip' }}
          >
            <Text variant="label" tone="heroMuted">
              {pending === 'skip' ? 'Skipping…' : 'Skip this dose'}
            </Text>
          </PressableScale>
        </View>
      </View>
    </Animated.View>
  );
}

const DONE_META: Record<'taken' | 'snoozed' | 'skipped' | 'gone', { icon: IconName; color: string }> = {
  taken: { icon: 'check-circle', color: '#7EE2B8' },
  snoozed: { icon: 'clock', color: colors.cyan300 },
  skipped: { icon: 'skip-forward', color: colors.heroMuted },
  gone: { icon: 'slash', color: colors.heroSubtle },
};

/** A dose that's already been handled (here or before the alarm opened). */
export function HandledDoseRow({ dose, tz }: { dose: HandledDose; tz: string }) {
  const kind = dose.gone ? 'gone' : dose.status === 'taken' ? 'taken' : dose.status === 'skipped' ? 'skipped' : 'snoozed';
  const meta = DONE_META[kind];
  const detail = dose.gone ? 'No longer on its schedule' : statusDetail(dose, tz);
  return (
    <Animated.View
      entering={FadeIn.duration(220)}
      exiting={FadeOut.duration(160)}
      layout={LinearTransition.springify().damping(20).stiffness(100).mass(1)}
      style={styles.done}
      accessible
      accessibilityLabel={`${dose.name}${dose.strength ? ` ${dose.strength}` : ''}: ${detail}`}
    >
      <MedPhoto url={dose.photo_urls[0]} size={48} style={styles.doneThumb} />
      <View style={styles.flex}>
        <Text variant="label" tone="inverse" numberOfLines={1}>
          {dose.name}
          {dose.strength ? <Text variant="caption" tone="heroMuted">{`  ${dose.strength}`}</Text> : null}
        </Text>
        <Text variant="caption" color={meta.color}>
          {detail}
        </Text>
      </View>
      <Icon name={meta.icon} size={20} color={meta.color} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: {
    padding: spacing.md,
    borderRadius: radii.xl,
    backgroundColor: colors.heroGlass,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.heroGlassBorder,
  },
  cardPrimary: { backgroundColor: 'rgba(255,255,255,0.06)' },
  info: { marginTop: spacing.lg, gap: spacing.sm, paddingHorizontal: spacing.xs },
  name: { fontFamily: fonts.display, fontSize: 34, lineHeight: 39, letterSpacing: -0.6, color: colors.heroText },
  nameSmall: { fontSize: 26, lineHeight: 31 },
  strength: { fontFamily: fonts.body, fontSize: 18, letterSpacing: 0, color: colors.heroMuted },
  dose: { fontFamily: fonts.bodySemiBold, fontSize: 20, lineHeight: 26, color: colors.heroText },
  timing: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(255,184,77,0.16)',
  },
  forRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.pill },
  pillInfo: { backgroundColor: 'rgba(47,210,240,0.14)' },
  pillMissed: { backgroundColor: 'rgba(255,122,106,0.2)' },
  pillNeutral: { backgroundColor: colors.heroGlass },
  actions: { marginTop: spacing.xl, gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  skip: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill },
  disabled: { opacity: 0.5 },
  done: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.heroGlass,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.heroGlassBorder,
  },
  doneThumb: { borderColor: colors.heroGlassBorder },
});
