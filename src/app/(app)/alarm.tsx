/**
 * Full-screen medicine alarm (`/alarm?med=<id>&at=<iso>`, also opened from notifications in Phase C — it renders from
 * the params alone). Immersive dark screen with a breathing energy glow, live clock and, for every dose due at that
 * instant, large swipeable photos (or a pill illustration), name / strength / dose / food timing / who it's for and
 * Take / Snooze 10 min / Skip — plus "Take all" when several are due together. Handled doses collapse; the alarm closes
 * itself once everything is handled. Stale or unknown ids get a calm "already handled" state.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, LinearTransition, ZoomIn } from 'react-native-reanimated';

import { AlarmDoseCard, HandledDoseRow } from '@/features/alarm/AlarmDoseCard';
import { AlarmGlow } from '@/features/alarm/AlarmGlow';
import { isValidInstant, useAlarmActions, useAlarmDoses, type HandledDose } from '@/features/alarm/api';
import { useMedsTimezone } from '@/features/meds/api';
import { MedPhoto } from '@/features/meds/MedPhoto';
import { clockIn, doseKey, formatTime12, isOpen, medicineTitle, todayIn } from '@/features/meds/shared';
import type { DoseItem } from '@/features/meds/types';
import { errorMessage } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { colors, fonts, radii, spacing } from '@/theme';
import { Button, EnergyRing, Icon, IconButton, Orb, Screen, Text, goBackOrHome } from '@/ui';

const AUTO_CLOSE_MS = 1400;

/** Wall clock in the member's timezone, refreshed every 15 s. */
function useClock(tz: string): string {
  const [clock, setClock] = useState(() => clockIn(tz));
  useEffect(() => {
    const t = setInterval(() => setClock(clockIn(tz)), 15_000);
    return () => clearInterval(t);
  }, [tz]);
  return clock;
}

const toMedicines = () => router.dismissTo('/medicines');

function Centered({ children }: { children: ReactNode }) {
  return <View style={styles.centered}>{children}</View>;
}

function NextDose({ dose, tz }: { dose: DoseItem; tz: string }) {
  const tomorrow = dose.local_date !== todayIn(tz);
  return (
    <Animated.View entering={FadeInDown.delay(120).springify().damping(18)} style={styles.next}>
      <MedPhoto url={dose.photo_urls[0]} size={56} />
      <View style={styles.flex}>
        <Text variant="eyebrow" tone="heroSubtle">
          Next up
        </Text>
        <Text variant="title" tone="inverse" numberOfLines={1}>
          {medicineTitle(dose)}
        </Text>
        <Text variant="caption" tone="heroMuted">
          {dose.dose} · {formatTime12(dose.local_time)}
          {tomorrow ? ' tomorrow' : ''}
        </Text>
      </View>
    </Animated.View>
  );
}

export default function Alarm() {
  const params = useLocalSearchParams<{ med?: string; at?: string }>();
  const med = typeof params.med === 'string' && params.med ? params.med : undefined;
  const at = typeof params.at === 'string' && params.at ? params.at : null;
  const tz = useMedsTimezone();
  const clock = useClock(tz);
  const q = useAlarmDoses(at);
  const { act, takeAll, handled, pendingFor, anyPending } = useAlarmActions(tz);
  const [takingAll, setTakingAll] = useState(false);
  const buzzed = useRef(false);

  // The medicine from the link first, then by time and name; this session's actions applied on top.
  const sorted = [...(q.data?.doses ?? [])].sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for) || a.name.localeCompare(b.name));
  const first = med ? sorted.findIndex((d) => d.medication_id === med) : -1;
  if (first > 0) sorted.unshift(...sorted.splice(first, 1));
  const view: HandledDose[] = sorted.map((d) => handled[doseKey(d)] ?? d);
  const open = view.filter((d) => !d.gone && !handled[doseKey(d)] && isOpen(d));
  const closed = view.filter((d) => !open.includes(d));
  const userActed = Object.keys(handled).length > 0;
  const loaded = !!q.data;
  const allDone = loaded && view.length > 0 && open.length === 0;
  const leaving = allDone && userActed && !anyPending;
  const mode = q.data?.mode ?? 'due';
  const lead = open[0];

  // A firm buzz when the alarm opens with something to take (Phase C adds sound + the notification).
  useEffect(() => {
    if (buzzed.current || !open.length) return;
    buzzed.current = true;
    haptics.warning();
  }, [open.length]);

  // Everything handled here → celebrate briefly, then close.
  useEffect(() => {
    if (!leaving) return;
    haptics.success();
    const t = setTimeout(goBackOrHome, AUTO_CLOSE_MS);
    return () => clearTimeout(t);
  }, [leaving]);

  const confirmTakeAll = () => {
    if (open.length < 2 || takingAll) return;
    haptics.warning();
    Alert.alert(`Mark all ${open.length} as taken?`, open.map((d) => `• ${medicineTitle(d)} — ${d.dose}`).join('\n'), [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Take all',
        onPress: () => {
          setTakingAll(true);
          void takeAll(open).finally(() => setTakingAll(false));
        },
      },
    ]);
  };

  let body: ReactNode;

  if (q.isPending) {
    body = (
      <Centered>
        <Orb size={180} tone="dark" active />
        <Text variant="callout" tone="heroMuted" align="center" style={styles.gapLg} accessibilityRole="text" accessibilityLiveRegion="polite">
          Opening your alarm…
        </Text>
      </Centered>
    );
  } else if (!q.data) {
    body = (
      <Centered>
        <View style={styles.iconDisc}>
          <Icon name="wifi-off" size={26} color={colors.heroText} />
        </View>
        <Text variant="h2" tone="inverse" align="center" style={styles.gapLg} accessibilityRole="header">
          We couldn&apos;t load this alarm
        </Text>
        <Text variant="small" tone="heroMuted" align="center" style={styles.message}>
          {errorMessage(q.error)}
        </Text>
        <View style={styles.rowCenter}>
          <Button label="Try again" icon="refresh-cw" variant="hero" onPress={() => void q.refetch()} loading={q.isFetching} />
          <Button label="Medicines" variant="heroOutline" onPress={toMedicines} />
        </View>
      </Centered>
    );
  } else if (!open.length) {
    const stale = view.length === 0 && (!!med || isValidInstant(at));
    const title = allDone ? (userActed ? 'All done — nicely handled' : 'All set for this alarm') : stale ? 'Already handled' : 'Nothing due right now';
    const text = allDone
      ? leaving
        ? 'Taking you back…'
        : 'Every medicine on this alarm has already been taken, skipped or snoozed.'
      : stale
        ? 'This alarm has already been taken care of, or its medicine was changed. Nothing to do here.'
        : q.data.next
          ? 'Nothing else is due right now.'
          : "You're all caught up.";
    body = (
      <Centered>
        <Animated.View entering={ZoomIn.springify().damping(14)}>
          <EnergyRing progress={1} size={96} stroke={7} palette="success" trackColor="rgba(255,255,255,0.12)" accessibilityLabel="Done">
            <Icon name="check" size={36} color="#7EE2B8" />
          </EnergyRing>
        </Animated.View>
        <Text variant="h1" tone="inverse" align="center" style={styles.gapLg} accessibilityRole="header">
          {title}
        </Text>
        <Text variant="callout" tone="heroMuted" align="center" style={styles.message}>
          {text}
        </Text>
        {closed.length ? (
          <View style={styles.doneList}>
            {closed.map((d) => (
              <HandledDoseRow key={doseKey(d)} dose={d} tz={tz} />
            ))}
          </View>
        ) : null}
        {!allDone && q.data.next ? <NextDose dose={q.data.next} tz={tz} /> : null}
        <Button
          label={leaving ? 'Back now' : allDone || stale ? 'Close' : 'Go to medicines'}
          variant="hero"
          size="lg"
          onPress={leaving || allDone || stale ? goBackOrHome : toMedicines}
          style={styles.gapXl}
        />
        {!leaving && (allDone || stale) ? <Button label="Go to medicines" variant="heroOutline" onPress={toMedicines} style={styles.gapSm} /> : null}
      </Centered>
    );
  } else {
    const several = open.length > 1;
    const when = lead.status === 'missed' ? `Was due at ${formatTime12(lead.local_time)}` : `Scheduled ${formatTime12(lead.local_time)}`;
    body = (
      <>
        <Animated.View entering={FadeIn.duration(320)} style={styles.top} accessible accessibilityRole="header" accessibilityLabel={`Time for your medicine. It's ${clock}.`}>
          <Text variant="eyebrow" tone="heroSubtle">
            Time for your medicine
          </Text>
          <Text style={styles.clock}>{clock}</Text>
          <Text variant="small" tone="heroMuted">
            {several ? `${open.length} medicines ${mode === 'at' ? `at ${formatTime12(lead.local_time)}` : 'due now'}` : when}
          </Text>
        </Animated.View>

        {several ? (
          <Animated.View entering={FadeInDown.delay(80).springify().damping(18)} layout={LinearTransition.springify().damping(20)}>
            <Button
              label={`Take all ${open.length}`}
              icon="check-circle"
              variant="hero"
              size="lg"
              block
              haptic="firm"
              loading={takingAll}
              disabled={anyPending}
              onPress={confirmTakeAll}
              accessibilityHint="Asks before marking every medicine on this alarm as taken"
            />
          </Animated.View>
        ) : null}

        <Animated.View layout={LinearTransition.springify().damping(20)} style={styles.cards}>
          {open.map((d, i) => (
            <AlarmDoseCard key={doseKey(d)} dose={d} tz={tz} primary={i === 0} pending={pendingFor(d)} onAct={(a) => void act(d, a)} />
          ))}
        </Animated.View>

        {closed.length ? (
          <Animated.View layout={LinearTransition.springify().damping(20)} style={styles.doneSection}>
            <Text variant="eyebrow" tone="heroSubtle">
              Already handled
            </Text>
            {closed.map((d) => (
              <HandledDoseRow key={doseKey(d)} dose={d} tz={tz} />
            ))}
          </Animated.View>
        ) : null}

        <Text variant="caption" tone="heroSubtle" style={styles.disclaimer}>
          Take medicines as your doctor prescribed. Unsure about a dose? Check with your doctor or pharmacist.
        </Text>
      </>
    );
  }

  return (
    <Screen backdrop="hero" contentContainerStyle={styles.content}>
      <StatusBar style="light" />
      <AlarmGlow active={open.length > 0} />
      <View style={styles.bar}>
        <View style={styles.brand}>
          <View style={[styles.liveDot, open.length ? styles.liveDotOn : null]} />
          <Text style={styles.brandText}>ÖRZA · Medicine alarm</Text>
        </View>
        <IconButton icon="x" variant="hero" accessibilityLabel="Close alarm" onPress={goBackOrHome} />
      </View>
      {body}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { overflow: 'hidden' },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.sm },
  brand: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.heroSubtle },
  liveDotOn: { backgroundColor: colors.coral, boxShadow: '0px 0px 10px rgba(255,122,106,0.9)' },
  brandText: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1.6, textTransform: 'uppercase', color: colors.heroMuted },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.huge },
  iconDisc: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.heroGlass,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.heroGlassBorder,
  },
  gapSm: { marginTop: spacing.sm },
  gapLg: { marginTop: spacing.xl },
  gapXl: { marginTop: spacing.xxl, minWidth: 200 },
  message: { marginTop: spacing.sm, maxWidth: 320 },
  rowCenter: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl },
  top: { marginTop: spacing.lg, marginBottom: spacing.xl },
  clock: { fontFamily: fonts.display, fontSize: 56, lineHeight: 62, letterSpacing: -1.2, color: colors.heroText, fontVariant: ['tabular-nums'], marginVertical: 2 },
  cards: { gap: spacing.lg, marginTop: spacing.lg },
  doneSection: { gap: spacing.sm, marginTop: spacing.xxl },
  doneList: { alignSelf: 'stretch', gap: spacing.sm, marginTop: spacing.xl },
  next: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    gap: spacing.md,
    marginTop: spacing.xl,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.heroGlass,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.heroGlassBorder,
  },
  disclaimer: { marginTop: spacing.xxl },
});
