/**
 * Full-screen medicine alarm (`/alarm?med=<id>&at=<iso>` — opened by the phone's alarm / notification, or in-app; it
 * renders from the params alone). Immersive dark screen with a breathing energy glow, live clock and, for every dose
 * due at that instant, large swipeable photos (or a pill illustration), name / strength / dose / food timing / who it's
 * for and Take / Snooze 10 min / Skip — plus "Take all" when several are due together. Handled doses collapse; the
 * alarm closes itself once everything is handled. Stale or unknown ids get a calm "already handled" state.
 *
 * With the phone's alarm (`features/alarm/ringing`): opened by a tap → its notification is dismissed at once; raised by
 * the ringing alarm (Android full screen over the lock screen, or `ringing=1` while ÖRZA was open) → it rings until the
 * first press. Leaving for the rest of the app asks for the phone's unlock first. Offline, the alarm is rebuilt from the
 * data on this phone and the presses are queued (`features/alarm/api`). `?test=<id>` is the "Test alarm" demo: same
 * look, records nothing.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, LinearTransition, useReducedMotion, ZoomIn } from 'react-native-reanimated';

import { AlarmDoseCard, HandledDoseRow } from '@/features/alarm/AlarmDoseCard';
import { AlarmGlow } from '@/features/alarm/AlarmGlow';
import { isValidInstant, useAlarmActions, useAlarmDoses, type HandledDose } from '@/features/alarm/api';
import { alarmKeysFor, useAlarmRinging } from '@/features/alarm/ringing';
import { useMedsTimezone } from '@/features/meds/api';
import { MedPhoto } from '@/features/meds/MedPhoto';
import { clockIn, doseKey, formatTime12, isOpen, medicineTitle, todayIn } from '@/features/meds/shared';
import type { DoseAction, DoseItem } from '@/features/meds/types';
import { utcToZoned } from '@/lib/alarms/schedule';
import { testAlarmDetails, testAlarmKey } from '@/lib/alarms/test';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { haptics } from '@/lib/haptics';
import { colors, fonts, radii, spacing } from '@/theme';
import { Button, EnergyRing, Icon, IconButton, Orb, Screen, Text, toast } from '@/ui';

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
const param = (v: string | string[] | undefined): string | null => (typeof v === 'string' && v ? v : null);

function Centered({ children }: { children: ReactNode }) {
  return <View style={styles.centered}>{children}</View>;
}

function NextDose({ dose, tz }: { dose: DoseItem; tz: string }) {
  const tomorrow = dose.local_date !== todayIn(tz);
  return (
    <Animated.View entering={FadeInDown.delay(120).springify().damping(18).stiffness(100).mass(1)} style={styles.next}>
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

export default function AlarmRoute() {
  const params = useLocalSearchParams<{ med?: string; at?: string; test?: string; ringing?: string }>();
  const test = param(params.test);
  const ringing = param(params.ringing) === '1';
  const at = param(params.at);
  // Keyed by the alarm: a link to another alarm while this screen is showing starts it afresh (state, presence).
  if (test) return <TestAlarm key={`test:${test}`} test={test} ringing={ringing} />;
  return <MedicineAlarm key={at ?? 'due'} at={at} med={param(params.med) ?? undefined} ringing={ringing} />;
}

function MedicineAlarm({ at, med, ringing }: { at: string | null; med?: string; ringing: boolean }) {
  const { user } = useAuth();
  const memberTz = useMedsTimezone();
  const q = useAlarmDoses(at, user?.id ?? null);
  const offline = !!q.data?.offline;
  const tz = q.data?.tz ?? memberTz;
  const clock = useClock(tz);
  const { act, takeAll, handled, pendingFor, anyPending } = useAlarmActions(tz, offline);
  const { raisedByAlarm, dismiss, silence, close, leave } = useAlarmRinging({ at, test: null, ringing });
  const [takingAll, setTakingAll] = useState(false);
  const buzzed = useRef(false);
  // With Reduce Motion, Reanimated leaves a view with a layout transition where it was when its siblings change size —
  // no layout transitions then (the rows just move).
  const reduceMotion = useReducedMotion();
  const layout = reduceMotion ? undefined : LinearTransition.springify().damping(20).stiffness(100).mass(1);

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
  const alarmKeys = alarmKeysFor(q.data?.doses ?? [], at, med).join('|');

  // Opened by a tap on the alarm: its notification goes now. Raised by the ringing alarm: it stays until handled.
  useEffect(() => {
    if (loaded && raisedByAlarm === false) dismiss(alarmKeys.split('|'));
  }, [loaded, raisedByAlarm, alarmKeys, dismiss]);

  // Every dose handled (here or elsewhere): nothing left to ring for.
  useEffect(() => {
    if (allDone) dismiss(alarmKeys.split('|'));
  }, [allDone, alarmKeys, dismiss]);

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
    const t = setTimeout(() => void close(), AUTO_CLOSE_MS);
    return () => clearTimeout(t);
  }, [leaving, close]);

  const onClose = () => void close();
  const goMedicines = () => void leave(toMedicines);
  const addPhoto = (d: DoseItem) => () => void leave(() => router.push({ pathname: '/med/edit', params: { id: d.medication_id } }));

  const confirmTakeAll = () => {
    if (open.length < 2 || takingAll) return;
    silence();
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
        <Text variant="h2" tone="inverse" align="center" style={styles.heading} accessibilityRole="header">
          We couldn&apos;t load this alarm
        </Text>
        <Text variant="small" tone="heroMuted" align="center" style={styles.message}>
          {errorMessage(q.error)}
        </Text>
        <View style={styles.rowCenter}>
          <Button label="Try again" icon="refresh-cw" variant="hero" onPress={() => void q.refetch()} loading={q.isFetching} />
          <Button label="Medicines" variant="heroOutline" onPress={goMedicines} />
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
        <Animated.View entering={ZoomIn.springify().damping(14).stiffness(100).mass(1)}>
          <EnergyRing progress={1} size={96} stroke={7} palette="success" trackColor="rgba(255,255,255,0.12)" accessibilityLabel="Done">
            <Icon name="check" size={36} color="#7EE2B8" />
          </EnergyRing>
        </Animated.View>
        <Text variant="h1" tone="inverse" align="center" style={styles.heading} accessibilityRole="header">
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
          onPress={leaving || allDone || stale ? onClose : goMedicines}
          style={styles.gapXl}
        />
        {!leaving && (allDone || stale) ? <Button label="Go to medicines" variant="heroOutline" onPress={goMedicines} style={styles.gapSm} /> : null}
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

        {offline ? <OfflineNote slow={!!q.data?.slow} /> : null}

        {several ? (
          <Animated.View entering={FadeInDown.delay(80).springify().damping(18).stiffness(100).mass(1)} layout={layout}>
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

        <Animated.View layout={layout} style={styles.cards}>
          {open.map((d, i) => (
            <AlarmDoseCard
              key={doseKey(d)}
              dose={d}
              tz={tz}
              primary={i === 0}
              pending={pendingFor(d)}
              onAct={(a) => {
                silence();
                void act(d, a);
              }}
              onAddPhoto={offline ? null : addPhoto(d)}
            />
          ))}
        </Animated.View>

        {closed.length ? (
          <Animated.View layout={layout} style={styles.doneSection}>
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
    <AlarmFrame live={open.length > 0} onClose={onClose}>
      {body}
    </AlarmFrame>
  );
}

function AlarmFrame({ live, label = 'ÖRZA · Medicine alarm', onClose, children }: { live: boolean; label?: string; onClose: () => void; children: ReactNode }) {
  return (
    <Screen backdrop="hero" contentContainerStyle={styles.content}>
      <StatusBar style="light" />
      <AlarmGlow active={live} />
      <View style={styles.bar}>
        <View style={styles.brand}>
          <View style={[styles.liveDot, live ? styles.liveDotOn : null]} />
          <Text style={styles.brandText}>{label}</Text>
        </View>
        <IconButton icon="x" variant="hero" accessibilityLabel="Close alarm" onPress={onClose} />
      </View>
      {children}
    </Screen>
  );
}

/** `slow`: no answer from ÖRZA in time (slow server or weak network) — "No connection" would be wrong then. */
function OfflineNote({ slow }: { slow: boolean }) {
  return (
    <Animated.View entering={FadeIn.duration(240)} style={styles.offline} accessibilityRole="alert">
      <Icon name={slow ? 'clock' : 'wifi-off'} size={14} color={colors.heroMuted} />
      <Text variant="caption" tone="heroMuted" style={styles.flex}>
        {slow
          ? 'ÖRZA is taking a while to answer — this alarm was saved on your phone. Your answers sync automatically.'
          : "No connection — this alarm was saved on your phone. Your answers sync when you're back online."}
      </Text>
    </Animated.View>
  );
}

/**
 * "Test alarm" demo (`/alarm?test=<id>`): the alarm screen exactly as a dose would show it, with the photo the test
 * rang with (the first medicine's, or the sample strip). Nothing is recorded.
 */
function TestAlarm({ test, ringing }: { test: string; ringing: boolean }) {
  const tz = useMedsTimezone();
  const clock = useClock(tz);
  const { raisedByAlarm, dismiss, silence, close } = useAlarmRinging({ at: null, test, ringing });
  const [dose] = useState<DoseItem>(() => {
    const details = testAlarmDetails(test);
    const now = new Date();
    return {
      medication_id: `test:${test}`,
      name: details.medicine ?? 'Your medicine',
      dose: '1 tablet',
      timing: 'after_food',
      form: 'tablet',
      photo_urls: details.photoUri ? [details.photoUri] : [],
      scheduled_for: now.toISOString(),
      local_date: todayIn(tz),
      local_time: utcToZoned(now, tz).time,
      status: 'due',
    };
  });
  const [done, setDone] = useState<DoseAction | null>(null);
  const key = testAlarmKey(test);

  useEffect(() => {
    if (raisedByAlarm === false) dismiss([key]);
  }, [raisedByAlarm, key, dismiss]);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => void close(), AUTO_CLOSE_MS + 1200);
    return () => clearTimeout(t);
  }, [done, close]);

  const onAct = (a: DoseAction) => {
    silence();
    dismiss([key]);
    haptics.success();
    setDone(a);
    toast.info('That was a test — nothing was recorded.');
  };

  return (
    <AlarmFrame live={!done} label="ÖRZA · Test alarm" onClose={() => void close()}>
      {done ? (
        <Centered>
          <Animated.View entering={ZoomIn.springify().damping(14).stiffness(100).mass(1)}>
            <EnergyRing progress={1} size={96} stroke={7} palette="success" trackColor="rgba(255,255,255,0.12)" accessibilityLabel="Done">
              <Icon name="check" size={36} color="#7EE2B8" />
            </EnergyRing>
          </Animated.View>
          <Text variant="h1" tone="inverse" align="center" style={styles.heading} accessibilityRole="header">
            Your alarms are ready
          </Text>
          <Text variant="callout" tone="heroMuted" align="center" style={styles.message}>
            Each dose rings like this at its time — with the photo of every medicine — even offline, with the phone locked or ÖRZA
            closed.
          </Text>
          <Button label="Close" variant="hero" size="lg" onPress={() => void close()} style={styles.gapXl} />
        </Centered>
      ) : (
        <>
          <Animated.View entering={FadeIn.duration(320)} style={styles.top} accessible accessibilityRole="header" accessibilityLabel={`Test alarm. It's ${clock}.`}>
            <Text variant="eyebrow" tone="heroSubtle">
              Test alarm · nothing is recorded
            </Text>
            <Text style={styles.clock}>{clock}</Text>
            <Text variant="small" tone="heroMuted">
              This is how ÖRZA rings for a dose
            </Text>
          </Animated.View>
          <View style={styles.cards}>
            <AlarmDoseCard dose={dose} tz={tz} primary onAct={onAct} onAddPhoto={null} />
          </View>
          <Text variant="caption" tone="heroSubtle" style={styles.disclaimer}>
            Real alarms show each medicine due at that time, its photos, dose and food timing — and record what you press.
          </Text>
        </>
      )}
    </AlarmFrame>
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
  // Buttons default to alignSelf flex-start: centre them like the rest of the column.
  gapSm: { marginTop: spacing.sm, alignSelf: 'center' },
  gapLg: { marginTop: spacing.xl },
  gapXl: { marginTop: spacing.xxl, minWidth: 200, alignSelf: 'center' },
  // Full width: a shrink-wrapped centred heading (negative letterSpacing) was measured one line tall on Android and its
  // wrapped last word cut off ("Your alarms are" without "ready").
  heading: { marginTop: spacing.xl, alignSelf: 'stretch' },
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
  offline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.heroGlass,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.heroGlassBorder,
  },
});
