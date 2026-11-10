/**
 * Steps on Today — counted automatically (steps v2, `docs/notes/steps-v2.md` §2.2, §6, U1, U2). A live number and an
 * energy ring to the member's step goal, where the count comes from ("From Health Connect" / "From Apple Health" /
 * "Counted by this phone", "· approximate" for the sampler's estimate), and, while nothing counts for the member, what
 * Today asks (`lib/steps/todayCard.ts`, tested):
 * - one disclosure sheet with one button (P6): "Continue" right before the system prompt — on iPhone it can't be left
 *   any other way, on Android only by the system back — or "Turn on" when the permission is already there (a second
 *   member, the switch was off: a consent screen, closable);
 * - "Log steps" whenever nothing counts today (P7), "Not now — I'll log steps" after a refusal (P19, 30 days);
 * - after a Health Connect refusal: "Open Health Connect" and "Use this phone's motion sensor instead" (never chained);
 *   the phone counting where Health Connect doesn't count it: "Include your watch or fitness app"; iPhone with Apple
 *   Health empty: its status and, once, "Use iPhone motion instead" (U2);
 * - a counted day can still be corrected ("Edit": the member's number, plus steps counted after it);
 * - U5: Health Connect's day total from one known app → "From Samsung Health" / "From this phone" (`originLabel`); the
 *   phone's time zone on another offset than the profile's → a hint (steps count by the profile's days, `zoneHint`).
 * The disclosure sheet and the actions live in `StepsDisclosure.tsx` (shared with "Count steps automatically" on the
 * Health screen and in Settings). It also renders without Today's data (offline / loading): the phone's own count
 * needs no network.
 *
 * Reading + saving lives in `@/lib/steps` (`useTodaySteps`): it reads on focus, every minute while Today is visible and
 * on return to the app, and saves the count through `POST /api/track/steps` so the website shows the same number.
 */
import { router } from 'expo-router';
import { useEffect, useRef, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import { useSignedInUser } from '@/lib/auth';
import { deviceTimeZone } from '@/lib/device';
import { haptics } from '@/lib/haptics';
import { shownSteps, type ShownSource } from '@/lib/steps/policy';
import { useDayRecord } from '@/lib/steps/store';
import { originLabel, todayCard, zoneHint } from '@/lib/steps/todayCard';
import { useTodaySteps } from '@/lib/steps/useSteps';
import { colors, radii, spacing } from '@/theme';
import { Button, EnergyRing, GlassCard, Icon, Text, toast, type IconName } from '@/ui';

import { formatNumber, formatTime } from '@/features/meals/utils';

import { useStepsDisclosure } from './StepsDisclosure';
import { TrackerHead } from './TrackerHead';

/** Used when the member has no step target. */
export const DEFAULT_STEP_TARGET = 10_000;

const SOURCE: Record<ShownSource, { icon: IconName; label: string }> = {
  phone: { icon: 'smartphone', label: 'Counted by this phone' },
  health_connect: { icon: 'mci:heart-pulse', label: 'From Health Connect' },
  apple_health: { icon: 'mci:apple', label: 'From Apple Health' },
  saved: { icon: 'check-circle', label: 'Saved' },
  edited: { icon: 'edit-3', label: 'Edited by you' },
};

const tzLabel = (tz: string) => tz.replace(/_/g, ' ');

function LivePill() {
  const reduce = useReducedMotion();
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (reduce) {
      pulse.set(1);
      return;
    }
    pulse.set(withRepeat(withSequence(withTiming(0.35, { duration: 900 }), withTiming(1, { duration: 900 })), -1));
  }, [reduce, pulse]);
  const dot = useAnimatedStyle(() => ({ opacity: pulse.get() }));
  return (
    // One TalkBack stop ("Updating live"), not that and the pill's "LIVE" text.
    <View style={styles.live} accessible accessibilityLabel="Updating live">
      <Animated.View style={[styles.liveDot, dot]} />
      <Text variant="eyebrow" tone="success">
        Live
      </Text>
    </View>
  );
}

export function StepsCard({
  date,
  today,
  serverSteps,
  target: targetIn,
  tz,
  onLog,
}: {
  /** The day on screen. */
  date: string;
  /** The member's today. */
  today: string;
  /** The day's count on the server (Today's data; null when it isn't loaded — offline). */
  serverSteps: number | null;
  target: number;
  tz: string;
  /** Opens the entry sheet: "log" (the typing fallback) or "edit" (correct a counted day) with the number shown. */
  onLog?: (mode: 'log' | 'edit', shown: number) => void;
}) {
  const user = useSignedInUser();
  const steps = useTodaySteps();
  const record = useDayRecord(user.id, date);
  const target = targetIn > 0 ? targetIn : DEFAULT_STEP_TARGET;
  const isToday = date === today;
  // The disclosure sheet and what the card's buttons open (P6; shared with the switch outside Today).
  const disclosure = useStepsDisclosure(steps, { againLabel: 'Count my steps automatically' });
  const { act } = disclosure;

  const live = isToday && steps.reading && steps.reading.date === date ? steps.reading : null;
  const card = todayCard({
    platform: steps.platform,
    isToday,
    access: steps.access,
    busy: steps.busy,
    ask: steps.ask,
    askFolded: steps.askFolded,
    sources: steps.sources,
    countingToday: !!live,
    healthEmpty: steps.healthEmpty,
    motionOffered: steps.motionOffered,
    hcRefused: steps.hcRefused,
  });
  const autoOn = steps.sources.length > 0;
  const counting = card.state === 'counting';

  const liveValue = live ? steps.value : null;
  // The counting source's coverage starting after midnight ("Counting since …") and its long-gap estimate.
  const winner = liveValue?.winner;
  const partialFrom = live && winner && winner.coverFrom > live.day.start ? winner.coverFrom : null;
  const estimated = liveValue?.estimated ?? 0;
  const shown = shownSteps(liveValue, record, serverSteps, isToday) ?? { steps: serverSteps ?? 0, source: 'saved' as const, approximate: false };
  const value = shown.steps;
  const progress = target > 0 ? value / target : 0;
  const reached = target > 0 && value >= target;
  const pct = Math.round(Math.min(progress, 9.99) * 100);
  let source = SOURCE[shown.source];
  // U5: Health Connect's total from one known app is named ("From Samsung Health", "From this phone").
  const fromApp = shown.source === 'health_connect' && winner?.source === 'health_connect' ? originLabel(winner.origins) : null;
  let sourceLabel = fromApp ?? (shown.approximate ? `${source.label} · approximate` : source.label);
  if (shown.source === 'saved') {
    if (value > 0) sourceLabel = autoOn ? (isToday ? 'Saved earlier today' : 'Saved for this day') : isToday ? 'Logged today' : 'Logged for this day';
    else {
      sourceLabel = autoOn ? (isToday ? 'Not counted yet' : 'No steps saved') : isToday ? 'Not logged yet' : 'No steps logged';
      source = { ...source, icon: isToday && autoOn ? 'clock' : 'circle' };
    }
  }

  // A gentle tick when the live count crosses the goal while Today is open (not when switching days).
  const prev = useRef<{ date: string; value: number } | null>(null);
  useEffect(() => {
    const before = prev.current;
    prev.current = { date, value };
    if (isToday && before?.date === date && before.value < target && value >= target) haptics.success();
  }, [date, value, target, isToday]);

  const base = record?.base;
  const toGo = `${formatNumber(Math.max(0, target - value))} to go`;
  let status: string;
  if (reached) status = isToday ? 'Step goal reached — lovely work.' : 'Step goal reached.';
  else if (isToday && shown.source === 'edited') status = autoOn ? `${toGo} · your number, plus steps counted since` : `${toGo} · your number`;
  else if (isToday && partialFrom) {
    const since = formatTime(new Date(partialFrom).toISOString(), tz);
    status =
      base?.kind === 'start' && base.steps > 0
        ? `Counting since ${since}, on top of the ${formatNumber(base.steps)} saved earlier today.`
        : winner?.source === 'health_connect' && steps.access?.features?.stepTracking
          ? `Counting since ${since} — Health Connect starts counting this phone’s steps when you turn this on.`
          : `Counting since ${since} — earlier steps today weren’t seen by this phone.`;
  } else if (isToday && estimated > 0 && shown.source === 'phone')
    status = `${toGo} · about ${formatNumber(estimated)} of these are estimated from hours the phone couldn’t check.`;
  else if (isToday && counting) status = `${toGo} · updates on its own`;
  else if (isToday && card.state === 'health_empty')
    status = 'Apple Health has no steps for ÖRZA yet. If Steps is off for ÖRZA, turn it on in Settings › Health › Data Access & Devices › ÖRZA.';
  else if (isToday && card.state === 'waiting' && value === 0)
    status = steps.counter ? 'Counting is on — steps show up here as you walk.' : `Counting is on — steps show up here once ${steps.storeName} has some for today.`;
  else if (isToday && card.state === 'none' && value === 0)
    status = steps.platform === 'none' ? 'Log your steps here — the ÖRZA phone app counts them by itself.' : 'This phone can’t count steps by itself — log them here.';
  else if (isToday) status = value > 0 ? toGo : 'A short walk after meals is a great place to start.';
  else status = value > 0 ? `${formatNumber(target - value)} short of the goal` : 'No steps for this day.';

  // U5 (R8d): the phone's zone on another offset than the profile's while something counts — steps count by the
  // profile's days. Measured at the reading's time (no clock read in render).
  const zone = isToday && live && autoOn ? zoneHint(tz, deviceTimeZone(), live.at) : null;

  /* ─── the member's answers ─── */

  const notNow = () => {
    steps.notNow();
    toast.info('Okay — Today won’t ask again for 30 days. Log steps here any time.');
  };

  /* ─── buttons ─── */

  const cta = isToday ? card.cta : null;
  const motion = isToday ? card.motion : null;
  const watch = isToday ? card.watch : null;
  const motionLabel = steps.platform === 'ios' ? 'Use iPhone motion instead' : 'Use this phone’s motion sensor instead';

  let ctaView: ReactNode = null;
  if (cta?.type === 'sheet') {
    const turnOn = cta.sheet.variant === 'turn_on';
    ctaView = (
      <Button
        label={turnOn ? 'Turn on step counting' : 'Count my steps automatically'}
        variant="energy"
        icon="mci:shoe-print"
        block
        loading={disclosure.asking}
        onPress={() => act(cta)}
        accessibilityHint={turnOn ? 'Explains step counting, then turns it on for your account' : 'Explains step counting, then asks for permission'}
      />
    );
  } else if (cta) {
    const label = cta.type === 'settings' ? 'Open Settings' : cta.type === 'store_settings' ? 'Open Health Connect' : 'Get Health Connect';
    const caption =
      cta.type === 'settings'
        ? `To count steps automatically, turn on ${steps.permissionName}: ${steps.settingsPath}.`
        : cta.type === 'store_settings'
          ? 'To count steps automatically, allow Steps for ÖRZA in Health Connect › App permissions › ÖRZA.'
          : 'Health Connect brings in the steps your watch or fitness app counts.';
    ctaView = (
      <>
        <Button
          label={label}
          variant="secondary"
          icon={cta.type === 'settings' ? 'settings' : cta.type === 'store_settings' ? 'mci:heart-pulse' : 'mci:google-play'}
          iconRight="arrow-up-right"
          block
          onPress={() => act(cta)}
          accessibilityHint={
            cta.type === 'settings'
              ? `Opens Settings to turn on ${steps.permissionName} for ÖRZA`
              : cta.type === 'store_settings'
                ? 'Opens Health Connect, where you can allow ÖRZA to read your steps'
                : 'Opens Google Play to install or update Health Connect'
          }
        />
        <Text variant="caption" tone="subtle" align="center">
          {caption}
        </Text>
      </>
    );
  }

  return (
    <GlassCard>
      <TrackerHead icon="mci:shoe-print" tone="energy" label="Steps" right={isToday && counting ? <LivePill /> : undefined} />

      <View
        style={styles.body}
        accessible
        accessibilityLabel={`Steps ${isToday ? 'today' : 'this day'}: ${formatNumber(value)} of ${formatNumber(target)}, ${pct}% of your goal. ${sourceLabel}.`}
      >
        <EnergyRing progress={progress} size={92} stroke={9} palette="energy" accessibilityLabel={`${pct}% of your step goal`}>
          <View style={styles.ringCenter}>
            {reached ? <Icon name="check" size={22} color={colors.success} /> : <Icon name="mci:shoe-print" size={20} color={colors.energyInk} />}
            <Text variant="mono" tone="muted">
              {pct}%
            </Text>
          </View>
        </EnergyRing>
        <View style={styles.numbers}>
          <Text variant="stat" tone="ink" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
            {formatNumber(value)}
          </Text>
          <Text variant="small" tone="muted">
            of {formatNumber(target)} steps
          </Text>
          <View style={styles.sourceRow}>
            <Icon name={source.icon} size={13} color={colors.muted} />
            <Text variant="caption" tone="muted" numberOfLines={2} style={styles.flex}>
              {sourceLabel}
            </Text>
          </View>
        </View>
      </View>

      <Text variant="caption" tone={reached ? 'success' : 'subtle'} weight={reached ? 'semibold' : undefined} style={styles.status}>
        {status}
      </Text>

      {ctaView || motion ? (
        <View style={styles.cta}>
          {motion ? (
            <Button
              label={motionLabel}
              variant="secondary"
              icon="smartphone"
              block
              loading={disclosure.askingFallback}
              onPress={() => act(motion)}
              accessibilityHint={
                motion.type !== 'sheet'
                  ? `Opens Settings to turn on ${steps.permissionName} for ÖRZA`
                  : motion.sheet.variant === 'turn_on'
                    ? 'Explains counting with the motion sensor, then turns it on for your account'
                    : `Explains counting with the motion sensor, then asks for ${steps.permissionName}`
              }
            />
          ) : null}
          {ctaView}
        </View>
      ) : null}

      {(onLog && (card.log || card.edit)) || (isToday && card.notNow) ? (
        <View style={styles.actions}>
          {onLog && card.log ? (
            <Button
              label="Log steps"
              variant="ghost"
              size="sm"
              icon="edit-3"
              onPress={() => onLog('log', value)}
              accessibilityHint={isToday ? 'Type today’s steps yourself' : 'Type this day’s steps yourself'}
            />
          ) : null}
          {onLog && card.edit ? (
            <Button
              label={isToday ? 'Not right? Edit' : 'Edit'}
              variant="ghost"
              size="sm"
              icon="edit-3"
              onPress={() => onLog('edit', value)}
              accessibilityHint={isToday ? 'Set today’s steps yourself; steps counted after that are added on' : 'Set this day’s steps yourself'}
            />
          ) : null}
          {isToday && card.notNow ? (
            <Button
              label="Not now — I’ll log steps"
              variant="ghost"
              size="sm"
              onPress={notNow}
              accessibilityHint="Hides this for 30 days; you can still log steps here"
            />
          ) : null}
        </View>
      ) : null}

      {watch ? (
        <View style={styles.watch}>
          <Button
            label="Include your watch or fitness app"
            variant="ghost"
            size="sm"
            icon="watch"
            iconRight={watch.type === 'sheet' ? undefined : 'arrow-up-right'}
            onPress={() => act(watch)}
            accessibilityHint={
              watch.type === 'store_install'
                ? 'Opens Google Play to install Health Connect'
                : watch.type === 'store_settings'
                  ? 'Opens Health Connect, where you can allow ÖRZA to read your steps'
                  : watch.type === 'sheet' && watch.sheet.variant === 'turn_on'
                    ? 'Explains reading steps from Health Connect, then turns it on for your account'
                    : 'Explains reading steps from Health Connect, then asks for permission'
            }
          />
          <Text variant="caption" tone="subtle" style={styles.watchHint}>
            Reads Health Connect — Samsung Health, Fitbit and others write there.
          </Text>
        </View>
      ) : null}

      {zone ? (
        <Pressable
          accessibilityRole="link"
          accessibilityHint="Opens Preferences, where you can change your time zone"
          onPress={() => {
            haptics.tap();
            router.push('/account/preferences');
          }}
          hitSlop={6}
          style={({ pressed }) => [styles.zone, pressed && styles.pressed]}
        >
          <Icon name="globe" size={14} color={colors.cyan700} />
          <Text variant="caption" tone="muted" style={styles.flex}>
            {`Steps count by your days in ${tzLabel(zone.profile)}. This phone is set to ${tzLabel(zone.device)}.`}{' '}
            <Text variant="caption" tone="cyan" weight="semibold">
              Change time zone
            </Text>
          </Text>
        </Pressable>
      ) : null}

      {disclosure.sheet}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  body: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, marginTop: spacing.md },
  ringCenter: { alignItems: 'center', gap: 2 },
  numbers: { flex: 1, minWidth: 0 },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm },
  status: { marginTop: spacing.md },
  cta: { gap: spacing.sm, marginTop: spacing.lg },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm },
  watch: { marginTop: spacing.xs, gap: 2 },
  watchHint: { paddingHorizontal: spacing.md + 2 },
  live: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: colors.successBg,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
  zone: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: colors.infoBg,
  },
  pressed: { opacity: 0.7 },
});
