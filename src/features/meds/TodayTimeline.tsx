/**
 * Today's doses on a vertical timeline, grouped by time: large photo, name / strength / dose, status + timing chips,
 * and Take · Snooze 10 min · Skip (or "Taken early" / "Take after all").
 */
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import Animated, { FadeIn, FadeInDown, ZoomIn } from 'react-native-reanimated';

import { colors, fonts, radii, spacing } from '@/theme';
import { Button, Icon, IconButton, PressableScale, Skeleton, Tag, Text } from '@/ui';

import { MedPhoto } from './MedPhoto';
import { clockIn, doseKey, formatTime12, medicineTitle, SNOOZE_MINUTES, STATUS_META, statusDetail, TIMING_LABEL } from './shared';
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

/**
 * Take · Snooze · Skip wrap on a narrow card: Take and Snooze share the first line (growing to fill it), Skip and the
 * optional `trailing` control (the full-screen alarm button, pushed to the right) the next — instead of three lone
 * buttons stacked one per line beside a separate icon column.
 */
function DoseActions({ dose, pending, onAct, trailing }: { dose: DoseItem; pending?: DoseAction; onAct: (a: DoseAction) => void; trailing?: ReactNode }) {
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
          style={[styles.takeBtn, styles.grow]}
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
          style={styles.grow}
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
        {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
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

/** The status pill: like `statusDetail`, but "Snoozed · 5:40 pm" — the long form didn't fit beside the photo. */
function statusTag(dose: DoseItem, tz: string): string {
  if (dose.status === 'snoozed' && dose.snooze_until) return `Snoozed · ${clockIn(tz, new Date(dose.snooze_until))}`;
  return statusDetail(dose, tz);
}

/**
 * One dose. `showTime` (the medicine's own page, no time rail beside it): the heading is the dose's time, not the
 * medicine's name — two "Zinc 50 mg" rows, one "Taken", one "Upcoming", didn't say which was 11:05 am and which 11:00 pm.
 */
export function DoseRow({
  dose,
  tz,
  pending,
  onAct,
  linkToMedicine = true,
  showTime = false,
}: {
  dose: DoseItem;
  tz: string;
  pending?: DoseAction;
  onAct: (d: DoseItem, a: DoseAction) => void;
  linkToMedicine?: boolean;
  showTime?: boolean;
}) {
  const meta = STATUS_META[dose.status];
  const done = dose.status === 'taken' || dose.status === 'skipped';
  const due = dose.status === 'due';
  const title = medicineTitle(dose);
  const heading = showTime ? formatTime12(dose.local_time) : title;
  // Large text in a narrow row (a small phone, the time rail beside it): the text column beside the 72 pt photo got
  // so thin that Android broke names mid-word ("Pantopr / azole"). Then the photo sits above the text instead.
  const { fontScale } = useWindowDimensions();
  const [stacked, setStacked] = useState(false);
  const measure = (e: LayoutChangeEvent) => {
    const textColumn = e.nativeEvent.layout.width - 2 * spacing.md - PHOTO - spacing.md;
    const next = textColumn < MIN_TEXT_COLUMN * fontScale;
    if (next !== stacked) setStacked(next);
  };

  const info = (
    <View style={stacked ? styles.rowTopStacked : styles.rowTop}>
      <View>
        <MedPhoto url={dose.photo_urls[0]} size={PHOTO} accessibilityLabel={`Photo of ${title}`} />
        {dose.status === 'taken' ? (
          <Animated.View entering={ZoomIn.springify().damping(14).stiffness(180)} style={styles.check}>
            <Icon name="check" size={13} color={colors.white} />
          </Animated.View>
        ) : null}
      </View>
      <View style={stacked ? styles.stackedText : styles.flex}>
        <Text variant="title" numberOfLines={2} style={[showTime && styles.tabular, dose.status === 'skipped' && styles.strike]}>
          {heading}
        </Text>
        <Text variant="small" tone="muted" numberOfLines={1}>
          {dose.dose}
        </Text>
        <View style={styles.tags}>
          {/* Re-mounts (fades in) when the status changes; see the row's note on why the row itself doesn't animate. */}
          <Animated.View key={dose.status} entering={FadeIn.duration(220)} style={styles.tagWrap}>
            <Tag label={statusTag(dose, tz)} tone={meta.tone} dot />
          </Animated.View>
          {dose.timing !== 'any' ? <Tag label={TIMING_LABEL[dose.timing]} tone="warning" /> : null}
          {dose.for_person ? <Tag label={`For ${dose.for_person}`} tone="violet" /> : null}
        </View>
      </View>
    </View>
  );

  // No `layout` transition on the row: its parents (the time group, the Today card) and everything below re-lay out at
  // once, so a row springing from its old, taller size overlapped the next group for half a second after Take.
  return (
    <View style={[styles.row, due && styles.rowDue, done && styles.rowDone]} onLayout={measure}>
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
        <DoseActions
          dose={dose}
          pending={pending}
          onAct={(a) => onAct(dose, a)}
          trailing={
            dose.status === 'due' || dose.status === 'snoozed' ? (
              <IconButton
                icon="maximize-2"
                variant="plain"
                size={38}
                iconSize={16}
                accessibilityLabel={`Open the full-screen alarm for ${dose.name}`}
                onPress={() => router.push({ pathname: '/alarm', params: { med: dose.medication_id, at: dose.scheduled_for } })}
              />
            ) : null
          }
        />
      )}
    </View>
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
              {/* One line always: "10:00" in large text broke into "10:0 / 0" in the 48 pt rail. */}
              <Text style={styles.clock} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
                {clock}
              </Text>
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
const PHOTO = 72;
/** Narrowest text column (at font scale 1) that still fits a long medicine name such as "Pantoprazole" on a line. */
const MIN_TEXT_COLUMN = 118;

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
  rowTopStacked: { gap: spacing.sm, alignItems: 'flex-start' },
  stackedText: { alignSelf: 'stretch' },
  gapTop: { marginTop: spacing.sm },
  strike: { textDecorationLine: 'line-through', color: colors.muted },
  tabular: { fontVariant: ['tabular-nums'] },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm },
  tagWrap: { maxWidth: '100%' },
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
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  takeBtn: { minWidth: 88 },
  grow: { flexGrow: 1 },
  trailing: { marginLeft: 'auto' },
});
