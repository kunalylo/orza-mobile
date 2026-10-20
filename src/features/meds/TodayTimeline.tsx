/**
 * Today's doses on a vertical timeline, grouped by time: large photo, name / strength / dose, status + timing chips,
 * and Take · Snooze 10 min · Skip (or "Taken early" / "Take after all").
 */
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';

import { colors, fonts, radii, spacing } from '@/theme';
import { Button, Icon, IconButton, PressableScale, Skeleton, Tag, Text } from '@/ui';

import { MedPhoto } from './MedPhoto';
import { doseKey, formatTime12, medicineTitle, SNOOZE_MINUTES, STATUS_META, statusDetail, TIMING_LABEL } from './shared';
import type { DoseAction, DoseItem } from './types';

export function TimelineSkeleton() {
  return (
    <View style={styles.list} accessibilityLabel="Loading today's doses">
      {[0, 1, 2].map((i) => (
        <View key={i} style={styles.group}>
          <View style={styles.rail}>
            <Skeleton width={40} height={18} />
          </View>
          <View style={[styles.row, styles.skeletonRow]}>
            <View style={styles.rowTop}>
              <Skeleton width={72} height={72} radius={radii.sm} />
              <View style={styles.flex}>
                <Skeleton width="80%" height={16} />
                <Skeleton width="50%" height={12} style={styles.gapTop} />
                <Skeleton width={90} height={22} radius={radii.pill} style={styles.gapTop} />
              </View>
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}

function DoseActions({ dose, pending, onAct }: { dose: DoseItem; pending?: DoseAction; onAct: (a: DoseAction) => void }) {
  const busy = !!pending;
  if (dose.status === 'due' || dose.status === 'missed' || dose.status === 'snoozed') {
    return (
      <View style={styles.actions}>
        <Button
          label="Take"
          icon={pending === 'take' ? undefined : 'check'}
          variant="energy"
          size="sm"
          loading={pending === 'take'}
          disabled={busy}
          onPress={() => onAct('take')}
          accessibilityLabel={`Take ${dose.name}`}
          style={styles.takeBtn}
        />
        <Button
          label={`Snooze ${SNOOZE_MINUTES} min`}
          icon={pending === 'snooze' ? undefined : 'clock'}
          variant="secondary"
          size="sm"
          loading={pending === 'snooze'}
          disabled={busy}
          onPress={() => onAct('snooze')}
          accessibilityLabel={`Snooze ${dose.name} for ${SNOOZE_MINUTES} minutes`}
        />
        <Button
          label="Skip"
          icon={pending === 'skip' ? undefined : 'skip-forward'}
          variant="ghost"
          size="sm"
          loading={pending === 'skip'}
          disabled={busy}
          onPress={() => onAct('skip')}
          accessibilityLabel={`Skip ${dose.name}`}
        />
      </View>
    );
  }
  if (dose.status === 'upcoming') {
    return (
      <View style={styles.actions}>
        <Button
          label="Taken early"
          icon={pending === 'take' ? undefined : 'check'}
          variant="secondary"
          size="sm"
          loading={pending === 'take'}
          disabled={busy}
          onPress={() => onAct('take')}
          accessibilityLabel={`Mark ${dose.name} as taken now`}
        />
      </View>
    );
  }
  if (dose.status === 'skipped') {
    return (
      <View style={styles.actions}>
        <Button
          label="Take after all"
          icon={pending === 'take' ? undefined : 'rotate-ccw'}
          variant="secondary"
          size="sm"
          loading={pending === 'take'}
          disabled={busy}
          onPress={() => onAct('take')}
          accessibilityLabel={`Take ${dose.name} after all`}
        />
      </View>
    );
  }
  return null;
}

export function DoseRow({ dose, tz, pending, onAct, linkToMedicine = true }: { dose: DoseItem; tz: string; pending?: DoseAction; onAct: (d: DoseItem, a: DoseAction) => void; linkToMedicine?: boolean }) {
  const meta = STATUS_META[dose.status];
  const done = dose.status === 'taken' || dose.status === 'skipped';
  const due = dose.status === 'due';
  const title = medicineTitle(dose);

  const info = (
    <View style={styles.rowTop}>
      <View>
        <MedPhoto url={dose.photo_urls[0]} size={72} accessibilityLabel={`Photo of ${title}`} />
        {dose.status === 'taken' ? (
          <View style={styles.check}>
            <Icon name="check" size={13} color={colors.white} />
          </View>
        ) : null}
      </View>
      <View style={styles.flex}>
        <Text variant="title" numberOfLines={2} style={dose.status === 'skipped' ? styles.strike : undefined}>
          {title}
        </Text>
        <Text variant="small" tone="muted" numberOfLines={1}>
          {dose.dose}
        </Text>
        <View style={styles.tags}>
          <Tag label={statusDetail(dose, tz)} tone={meta.tone} dot />
          {dose.timing !== 'any' ? <Tag label={TIMING_LABEL[dose.timing]} tone="warning" /> : null}
          {dose.for_person ? <Tag label={`For ${dose.for_person}`} tone="violet" /> : null}
        </View>
      </View>
    </View>
  );

  return (
    <Animated.View layout={LinearTransition.springify().damping(20).stiffness(100).mass(1)} style={[styles.row, due && styles.rowDue, done && styles.rowDone]}>
      {linkToMedicine ? (
        <PressableScale
          haptic="soft"
          scaleTo={0.985}
          onPress={() => router.push({ pathname: '/med/[id]', params: { id: dose.medication_id } })}
          accessibilityRole="button"
          accessibilityLabel={`${title}, ${dose.dose}, ${statusDetail(dose, tz)}`}
          accessibilityHint="Opens the medicine"
        >
          {info}
        </PressableScale>
      ) : (
        info
      )}
      {dose.status === 'taken' ? null : (
        <View style={styles.actionRow}>
          <View style={styles.flex}>
            <DoseActions dose={dose} pending={pending} onAct={(a) => onAct(dose, a)} />
          </View>
          {dose.status === 'due' || dose.status === 'snoozed' ? (
            <IconButton
              icon="maximize-2"
              variant="plain"
              size={38}
              iconSize={16}
              accessibilityLabel={`Open the full-screen alarm for ${dose.name}`}
              onPress={() => router.push({ pathname: '/alarm', params: { med: dose.medication_id, at: dose.scheduled_for } })}
            />
          ) : null}
        </View>
      )}
    </Animated.View>
  );
}

/** Today's doses grouped by time. */
export function TodayTimeline({
  doses,
  tz,
  pendingFor,
  onAct,
}: {
  doses: DoseItem[];
  tz: string;
  pendingFor: (d: DoseItem) => DoseAction | undefined;
  onAct: (d: DoseItem, a: DoseAction) => void;
}) {
  const map = new Map<string, DoseItem[]>();
  for (const d of doses) map.set(d.local_time, [...(map.get(d.local_time) ?? []), d]);
  const groups = [...map.entries()].sort(([a], [b]) => a.localeCompare(b));

  return (
    <View style={styles.list} accessibilityLabel="Today's doses">
      {groups.map(([time, list], gi) => {
        const [clock, suffix] = formatTime12(time).split(' ');
        const allDone = list.every((d) => d.status === 'taken' || d.status === 'skipped');
        const anyDue = list.some((d) => d.status === 'due');
        return (
          <Animated.View key={time} entering={FadeInDown.delay(Math.min(gi, 6) * 60).springify().damping(18).stiffness(100).mass(1)} style={styles.group}>
            {gi < groups.length - 1 ? <View style={styles.line} /> : null}
            <View style={styles.rail} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <View style={[styles.dot, allDone ? styles.dotDone : anyDue ? styles.dotDue : null]} />
              <Text style={styles.clock}>{clock}</Text>
              <Text variant="eyebrow" tone="subtle" style={styles.suffix}>
                {suffix}
              </Text>
            </View>
            <View style={styles.flexList} accessibilityLabel={`Doses at ${formatTime12(time)}`}>
              {list.map((d) => (
                <DoseRow key={doseKey(d)} dose={d} tz={tz} pending={pendingFor(d)} onAct={onAct} />
              ))}
            </View>
          </Animated.View>
        );
      })}
    </View>
  );
}

const RAIL = 48;

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  flexList: { flex: 1, minWidth: 0, gap: spacing.md },
  list: { gap: spacing.xl },
  group: { flexDirection: 'row', gap: spacing.sm },
  rail: { width: RAIL, alignItems: 'center', paddingTop: 2 },
  line: { position: 'absolute', left: RAIL / 2 - 0.5, top: 30, bottom: -spacing.xl, width: 1, backgroundColor: colors.hairline },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.canvas,
    backgroundColor: 'rgba(20,20,20,0.25)',
    marginBottom: 4,
  },
  dotDone: { backgroundColor: colors.success },
  dotDue: { backgroundColor: colors.coral, boxShadow: '0px 0px 0px 4px rgba(255,122,106,0.18)' },
  clock: { fontFamily: fonts.display, fontSize: 18, lineHeight: 22, color: colors.ink, fontVariant: ['tabular-nums'] },
  suffix: { fontSize: 10, letterSpacing: 1.2 },
  row: {
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: 'rgba(255,255,255,0.66)',
  },
  rowDue: { borderColor: 'rgba(255,122,106,0.40)', backgroundColor: 'rgba(255,241,234,0.95)', boxShadow: '0px 10px 30px rgba(255,122,106,0.14)' },
  rowDone: { opacity: 0.82 },
  skeletonRow: { flex: 1 },
  rowTop: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  gapTop: { marginTop: spacing.sm },
  strike: { textDecorationLine: 'line-through', color: colors.muted },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm },
  check: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.white,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  takeBtn: { minWidth: 88 },
});
