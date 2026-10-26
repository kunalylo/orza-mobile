/**
 * "Alarms on this phone". Two sizes:
 * - `full` (Reminders screen): the state of every permission the alarms need with a one-tap fix (notifications;
 *   Android: exact alarm times, full-screen over the lock screen, battery "Unrestricted"; iOS: Time Sensitive hint),
 *   the next alarm with its medicine names, the doses inside quiet hours that won't ring, offline note, and
 *   "Test alarm" (rings in 10 s with a medicine photo, or the sample strip).
 * - `compact` (Medicines tab): one row — next alarm, or what needs fixing — plus the quiet-hours warning; tap → Reminders.
 */
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn, LinearTransition, useReducedMotion } from 'react-native-reanimated';

import { useMedications, useMedsTimezone } from '@/features/meds/api';
import { MedPhoto } from '@/features/meds/MedPhoto';
import { CardHeader } from '@/features/reminders/parts';
import { scheduleTestAlarm, TEST_ALARM_DELAY_MS } from '@/lib/alarms/test';
import { haptics } from '@/lib/haptics';
import { colors, radii, spacing } from '@/theme';
import { Button, GlassCard, Icon, PressableScale, Skeleton, Tag, Text, toast, type IconName } from '@/ui';

import { namesText, quietDosesText, usePhoneAlarmStatus, whenText, type PhoneAlarmStatus } from './status';

const isAndroid = Platform.OS === 'android';

/* ───────────────────────────── Pieces ───────────────────────────── */

type RowState = 'ok' | 'warn' | 'tip';

function CheckRow({ state, title, body, action }: { state: RowState; title: string; body?: string; action?: ReactNode }) {
  const icon: IconName = state === 'ok' ? 'check-circle' : state === 'warn' ? 'alert-triangle' : 'info';
  const color = state === 'ok' ? colors.success : state === 'warn' ? colors.warning : colors.info;
  return (
    <View style={styles.check}>
      <Icon name={icon} size={18} color={color} />
      <View style={styles.flex}>
        <Text variant="label" tone="ink">
          {title}
        </Text>
        {body ? (
          <Text variant="caption" tone="muted" style={styles.checkBody}>
            {body}
          </Text>
        ) : null}
        {action ? <View style={styles.checkAction}>{action}</View> : null}
      </View>
    </View>
  );
}

function QuietWarning({ s, withLink }: { s: PhoneAlarmStatus; withLink?: boolean }) {
  const text = quietDosesText(s.engine.quietDoses);
  if (!text) return null;
  return (
    <Animated.View entering={FadeIn.duration(200)} style={styles.quiet} accessibilityRole="alert">
      <Icon name="moon" size={16} color={colors.warning} />
      <View style={styles.flex}>
        <Text variant="label" tone="warning">
          {text.title}
        </Text>
        <Text variant="caption" tone="text" style={styles.checkBody}>
          {text.detail}
        </Text>
        {withLink ? <Button label="Quiet hours" icon="moon" variant="ghost" size="sm" onPress={() => router.push('/reminders')} style={styles.quietLink} /> : null}
      </View>
    </Animated.View>
  );
}

function useTestAlarm() {
  const meds = useMedications();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (busy) return;
    haptics.firm();
    setBusy(true);
    try {
      const r = await scheduleTestAlarm(meds.data ?? []);
      const secs = Math.round(TEST_ALARM_DELAY_MS / 1000);
      if (r.ok) {
        haptics.success();
        toast.success(
          isAndroid
            ? `Test alarm rings in ${secs} s. Lock the phone to see the full-screen alarm.`
            : `Test alarm rings in ${secs} s. Lock the phone or go to the home screen to see it.`
        );
      } else if (r.reason === 'permission') {
        haptics.warning();
        toast.info('Allow notifications first — then the test alarm can ring.');
      } else if (r.reason === 'unsupported') {
        toast.info("This version of the app can't ring alarms. Install the ÖRZA app build to test.");
      } else {
        haptics.error();
        toast.error("Couldn't set the test alarm. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  };
  return { run, busy };
}

/* ───────────────────────────── Full ───────────────────────────── */

function FullCard({ browserCount = 0 }: { browserCount?: number }) {
  const s = usePhoneAlarmStatus();
  const tz = useMedsTimezone();
  const test = useTestAlarm();
  const [asking, setAsking] = useState(false);
  // No layout transition with Reduce Motion: Reanimated then leaves the rows where they were when the header above
  // grows (the tag "On" → "On · check" wraps the title) and they overlap the description.
  const reduceMotion = useReducedMotion();
  const { status, engine, native } = s;
  const nextDose = engine.next.find((n) => n.ring);
  const nextOther = engine.next.find((n) => !n.ring);
  // What else is set besides medicine alarms — refill alerts are not reminders (a phone with no reminders on said
  // "27 medicine alarms and 2 reminders" because of two refill alerts).
  const reminders = Math.max(0, engine.reminderAlarms ?? 0);
  const refills = Math.max(0, engine.scheduled - engine.doseAlarms - reminders);
  const setOnPhone = joinCounts([
    count(engine.doseAlarms, 'medicine alarm'),
    count(reminders, 'reminder'),
    count(refills, 'refill alert'),
  ]);

  const allow = async () => {
    setAsking(true);
    try {
      const next = await s.allowNotifications();
      if (next?.notifications === 'granted') {
        haptics.success();
        toast.success('Notifications on — your alarms are being set on this phone.');
      }
    } finally {
      setAsking(false);
    }
  };

  let tag: ReactNode;
  if (!s.supported) tag = <Tag label="Not available" tone="neutral" />;
  else if (!status) tag = <Skeleton width={64} height={22} radius={radii.pill} />;
  else if (s.ready && !s.needsAttention) tag = <Tag label="On" tone="success" dot />;
  else if (s.ready) tag = <Tag label="On · check" tone="warning" dot />;
  else if (status.notifications === 'granted' && status.silenced) tag = <Tag label="Silent" tone="warning" dot />;
  else tag = <Tag label="Off" tone="warning" dot />;

  return (
    <GlassCard padding={spacing.lg}>
      <CardHeader
        icon="mci:alarm-check"
        tone="energy"
        eyebrow="This phone"
        title="Alarms on this phone"
        right={tag}
        body={
          s.supported
            ? 'Medicine alarms ring from the phone itself — offline, locked, or with ÖRZA closed — and show the photo of every medicine.'
            : "This version of the app can't ring alarms (Expo Go or the web preview). Install the ÖRZA app to get them."
        }
      />

      {s.supported && status ? (
        <Animated.View layout={reduceMotion ? undefined : LinearTransition.springify().damping(20).stiffness(100).mass(1)} style={styles.checks}>
          {/* Next alarm */}
          {s.ready ? (
            nextDose ? (
              <View style={styles.next}>
                <MedPhoto url={nextDose.photo} size={48} />
                <View style={styles.flex}>
                  <Text variant="eyebrow" tone="subtle">
                    Next alarm · {whenText(nextDose.at, tz)}
                  </Text>
                  <Text variant="title" numberOfLines={2}>
                    {namesText(nextDose.labels)}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {`${setOnPhone} set on this phone`}
                  </Text>
                </View>
              </View>
            ) : (
              <CheckRow
                state="tip"
                title={engine.lastSyncAt ? 'No medicine alarms in the next 7 days' : 'Setting your alarms…'}
                body={
                  nextOther
                    ? `Next: ${nextOther.title.replace(/^\S+\s/, '')} · ${whenText(nextOther.at, tz)}`
                    : 'Add a medicine with alarm times — or scan a prescription — and its alarms are set here.'
                }
              />
            )
          ) : null}

          {/* Notifications */}
          {status.notifications === 'granted' ? (
            <CheckRow state="ok" title="Notifications allowed" />
          ) : (
            <CheckRow
              state="warn"
              title="Notifications are off"
              body="Alarms can't ring on this phone until ÖRZA may show notifications."
              action={
                <Button
                  label={status.canAskNotifications ? 'Allow notifications' : 'Open Settings'}
                  icon={status.canAskNotifications ? 'bell' : 'settings'}
                  variant="energy"
                  size="sm"
                  loading={asking}
                  onPress={() => void allow()}
                />
              }
            />
          )}

          {/* Allowed, but silenced: Android "Medicine alarms" set to Silent / no sound; iOS Notification Center only */}
          {status.notifications === 'granted' && status.silenced ? (
            <CheckRow
              state="warn"
              title="Alarms are silenced"
              body={
                isAndroid
                  ? 'The "Medicine alarms" notifications are set to Silent (or no sound), so doses only appear in the list. Turn their sound back on.'
                  : 'ÖRZA notifications go to Notification Center only — sounds, banners and the lock screen are off. Turn them on so doses ring.'
              }
              action={<Button label="Fix" icon="volume-2" variant="secondary" size="sm" onPress={() => void s.openSettings('notifications')} />}
            />
          ) : null}

          {/* Android: the alarm channel may not pop up (also stops the full-screen alarm) */}
          {status.notifications === 'granted' && status.popup === false ? (
            <CheckRow
              state="warn"
              title="Alarms don't pop up"
              body={'Turn on "Pop on screen" for "Medicine alarms" so a dose fills the screen with its photo.'}
              action={<Button label="Fix" icon="maximize" variant="secondary" size="sm" onPress={() => void s.openSettings('notifications')} />}
            />
          ) : null}

          {/* Android: exact alarm times */}
          {status.exact === true ? <CheckRow state="ok" title="Exact alarm times" /> : null}
          {status.exact === false ? (
            <CheckRow
              state="warn"
              title="Alarms may ring late"
              body={'Turn on "Alarms & reminders" for ÖRZA so each dose rings on the minute.'}
              action={<Button label="Allow" icon="clock" variant="secondary" size="sm" onPress={() => void s.openSettings('exactAlarms')} />}
            />
          ) : null}

          {/* Android 14+: full screen over the lock screen */}
          {status.fullScreen === true ? <CheckRow state="ok" title="Full-screen alarm over the lock screen" /> : null}
          {status.fullScreen === false ? (
            <CheckRow
              state="warn"
              title="Full-screen alarms are off"
              body="Without them a dose shows as a notification instead of filling the locked screen with its photo."
              action={<Button label="Allow" icon="maximize" variant="secondary" size="sm" onPress={() => void s.openSettings('fullScreen')} />}
            />
          ) : null}

          {/* Android: battery optimisation */}
          {isAndroid && native && native.batteryUnrestricted === true ? <CheckRow state="ok" title="Battery: unrestricted" /> : null}
          {isAndroid && native && native.batteryUnrestricted === false ? (
            <CheckRow
              state="tip"
              title="Tip: set battery to Unrestricted"
              body="Some phones' battery savers hold alarms back or clear them. Set ÖRZA to Unrestricted (Battery › App battery usage)."
              action={<Button label="Battery settings" icon="battery-charging" variant="secondary" size="sm" onPress={() => void s.openSettings('battery')} />}
            />
          ) : null}

          {/* iOS: Time Sensitive + silent switch */}
          {Platform.OS === 'ios' && status.notifications === 'granted' ? (
            <CheckRow
              state="tip"
              title="Keep Time Sensitive on"
              body="Settings › ÖRZA › Notifications › Time Sensitive lets dose alarms through Focus. With the ring switch on silent they vibrate and show, without sound."
              action={<Button label="Open Settings" icon="settings" variant="secondary" size="sm" onPress={() => void s.openSettings('notifications')} />}
            />
          ) : null}
        </Animated.View>
      ) : s.supported ? (
        <View style={styles.skel}>
          <Skeleton width="80%" height={12} />
          <Skeleton width="60%" height={12} />
        </View>
      ) : null}

      {s.supported ? <QuietWarning s={s} /> : null}

      {engine.offline ? (
        <View style={styles.note}>
          <Icon name="wifi-off" size={14} color={colors.subtle} />
          <Text variant="caption" tone="subtle" style={styles.flex}>
            Offline — the alarms use the data saved on this phone and update when you&apos;re back online.
          </Text>
        </View>
      ) : null}
      {browserCount > 0 || engine.alarmsLocal ? (
        <View style={styles.note}>
          <Icon name="monitor" size={14} color={colors.subtle} />
          <Text variant="caption" tone="subtle" style={styles.flex}>
            {browserCount > 0 ? `Web notifications are also on in ${browserCount} browser${browserCount === 1 ? '' : 's'}.` : ''}
            {browserCount > 0 && engine.alarmsLocal ? ' ' : ''}
            {engine.alarmsLocal ? 'While this phone rings your medicine alarms, ÖRZA doesn’t also send them to your browsers.' : ''}
          </Text>
        </View>
      ) : null}

      {s.supported ? (
        <View style={styles.actions}>
          <Button
            label="Test alarm"
            icon="play-circle"
            variant={s.ready ? 'primary' : 'secondary'}
            size="sm"
            loading={test.busy}
            onPress={() => void test.run()}
            accessibilityHint={`Rings in ${Math.round(TEST_ALARM_DELAY_MS / 1000)} seconds, like a real dose alarm. Nothing is recorded.`}
          />
          <Text variant="caption" tone="subtle" style={styles.flex}>
            Rings in {Math.round(TEST_ALARM_DELAY_MS / 1000)} s with a medicine photo — nothing is recorded.
          </Text>
        </View>
      ) : null}
    </GlassCard>
  );
}

/* ───────────────────────────── Compact ───────────────────────────── */

function CompactCard({ hideWhenIdle, style }: { hideWhenIdle?: boolean; style?: StyleProp<ViewStyle> }) {
  const s = usePhoneAlarmStatus();
  const tz = useMedsTimezone();
  const { status, engine } = s;
  if (!s.supported || !status) return null;
  const nextDose = engine.next.find((n) => n.ring);
  const quiet = engine.quietDoses.length > 0;
  if (s.ready && !nextDose && !quiet && hideWhenIdle) return null;

  const openReminders = () => router.push('/reminders');
  let icon: IconName;
  let tone: string;
  let title: string;
  let body: string;
  let action: ReactNode = null;
  if (!s.ready) {
    icon = 'alert-triangle';
    tone = colors.warning;
    if (status.notifications !== 'granted') {
      title = "Alarms can't ring on this phone";
      body = 'Allow notifications so every dose rings here — even offline or locked.';
      action = (
        <Button
          label={status.canAskNotifications ? 'Allow' : 'Settings'}
          variant="energy"
          size="sm"
          onPress={() => {
            haptics.firm();
            void s.allowNotifications();
          }}
        />
      );
    } else if (status.silenced) {
      title = 'Alarms are silenced on this phone';
      body = Platform.OS === 'ios' ? 'Turn on sounds, banners or the lock screen for ÖRZA.' : 'Turn the sound back on for "Medicine alarms".';
      action = <Button label="Fix" variant="secondary" size="sm" onPress={() => void s.openSettings('notifications')} />;
    } else {
      title = 'Alarms may ring late';
      body = 'Allow exact alarm times for ÖRZA.';
      action = <Button label="Allow" variant="secondary" size="sm" onPress={() => void s.openSettings('exactAlarms')} />;
    }
  } else if (nextDose) {
    icon = 'bell';
    tone = colors.energyInk;
    title = `Next alarm ${whenText(nextDose.at, tz)}`;
    body = namesText(nextDose.labels);
  } else {
    icon = 'bell';
    tone = colors.energyInk;
    title = 'Alarms on this phone are on';
    body = engine.lastSyncAt ? 'No medicine alarms in the next 7 days.' : 'Setting your alarms…';
  }

  const extra = s.ready && (status.fullScreen === false || status.popup === false) ? ' · Full-screen alarms are off' : '';
  return (
    <GlassCard padding={spacing.md} style={style}>
      <View style={styles.compactRow}>
        <PressableScale
          haptic="tap"
          onPress={openReminders}
          accessibilityRole="button"
          accessibilityLabel={`${title}. ${body}${extra}`}
          accessibilityHint="Opens Reminders & alarms"
          style={[styles.compactRow, styles.flex]}
        >
          {nextDose && s.ready ? <MedPhoto url={nextDose.photo} size={40} /> : <Icon name={icon} size={20} color={tone} />}
          <View style={styles.flex}>
            <Text variant="label" tone={s.ready ? 'ink' : 'warning'} numberOfLines={1}>
              {title}
            </Text>
            <Text variant="caption" tone="muted" numberOfLines={2}>
              {body}
              {extra}
            </Text>
          </View>
          {action ? null : <Icon name="chevron-right" size={18} color={colors.subtle} />}
        </PressableScale>
        {action}
      </View>
      <QuietWarning s={s} withLink />
    </GlassCard>
  );
}

/* ───────────────────────────── Export ───────────────────────────── */

export function AlarmStatusCard({
  variant = 'full',
  hideWhenIdle,
  browserCount,
  style,
}: {
  variant?: 'full' | 'compact';
  /** Compact: render nothing when alarms are fine and nothing is coming up. */
  hideWhenIdle?: boolean;
  /** Full: browsers with ÖRZA web notifications on (GET /api/integrations → push.subscriptions). */
  browserCount?: number;
  /** Compact: applied to the card (it may render nothing, so spacing belongs here). */
  style?: StyleProp<ViewStyle>;
}) {
  return variant === 'compact' ? <CompactCard hideWhenIdle={hideWhenIdle} style={style} /> : <FullCard browserCount={browserCount} />;
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  checks: { marginTop: spacing.lg, gap: spacing.md },
  check: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  checkBody: { marginTop: 2 },
  checkAction: { marginTop: spacing.sm, alignSelf: 'flex-start' },
  next: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.energyBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(194,65,12,0.18)',
  },
  quiet: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.warningBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(176,106,0,0.22)',
  },
  quietLink: { alignSelf: 'flex-start', marginTop: spacing.xs, marginLeft: -spacing.sm },
  skel: { marginTop: spacing.md, gap: 8 },
  note: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.md },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.lg },
  compactRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 44 },
});

/** "3 medicine alarms" — empty for 0 (except medicine alarms, which are always named). */
function count(n: number, noun: string): string {
  if (!n && noun !== 'medicine alarm') return '';
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** ["a", "b", "c"] → "a, b and c". */
function joinCounts(parts: string[]): string {
  const p = parts.filter(Boolean);
  return p.length > 1 ? `${p.slice(0, -1).join(', ')} and ${p[p.length - 1]}` : (p[0] ?? '');
}
