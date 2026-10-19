/**
 * Steps on Today — counted automatically. A live number and an energy ring to the member's step goal, where the count
 * comes from ("Counted by this phone" / "From Health Connect" / "From Apple Health"), and, when the phone may not
 * count yet, one friendly tap: "Count my steps automatically" (why, then the system prompt; blocked → Settings).
 * Typing steps stays only as a fallback when no automatic source exists (no step counter / permission refused / web).
 *
 * Reading + saving lives in `@/lib/steps` (`useTodaySteps`): it reads on focus, every minute while Today is visible and
 * on return to the app, and saves the count through `POST /api/track/steps` so the website shows the same number.
 */
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import { useSignedInUser } from '@/lib/auth';
import { haptics } from '@/lib/haptics';
import { shownSteps, type ShownSource } from '@/lib/steps/policy';
import { useDayRecord } from '@/lib/steps/store';
import type { StepPermission } from '@/lib/steps/types';
import { useTodaySteps } from '@/lib/steps/useSteps';
import { colors, radii, spacing } from '@/theme';
import { Button, EnergyRing, GlassCard, Icon, Sheet, Text, toast, type IconName } from '@/ui';

import { formatNumber, formatTime } from '@/features/meals/utils';

import { TrackerHead } from './TrackerHead';

/** Used when the member has no step target. */
export const DEFAULT_STEP_TARGET = 10_000;

const SOURCE: Record<ShownSource, { icon: IconName; label: string }> = {
  phone: { icon: 'smartphone', label: 'Counted by this phone' },
  health_connect: { icon: 'mci:heart-pulse', label: 'From Health Connect' },
  apple_health: { icon: 'mci:apple', label: 'From Apple Health' },
  saved: { icon: 'check-circle', label: 'Saved' },
};

const ASKABLE: StepPermission[] = ['undetermined', 'denied', 'blocked'];

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
    <View style={styles.live} accessibilityLabel="Updating live">
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
  /** The day's count on the server (Today's data). */
  serverSteps: number;
  target: number;
  tz: string;
  /** Opens the manual entry sheet (fallback only). */
  onLog: () => void;
}) {
  const user = useSignedInUser();
  const steps = useTodaySteps();
  const record = useDayRecord(user.id, date);
  const [explain, setExplain] = useState(false);
  const target = targetIn > 0 ? targetIn : DEFAULT_STEP_TARGET;
  const isToday = date === today;

  const access = steps.access;
  const live = isToday && steps.reading && steps.reading.date === date ? steps.reading : null;
  const phoneCounting = !!access?.phoneAvailable && access.phonePermission === 'granted';
  const counting = !!live || phoneCounting;
  const permission = access?.phonePermission;
  const canAsk = !!access?.phoneAvailable && !!permission && ASKABLE.includes(permission) && !live;
  // Typing is the fallback only: no step counter here (or web), or the member said no to counting.
  const manual = !!access && !counting && (!access.phoneAvailable || permission === 'denied' || permission === 'blocked');

  const shown = shownSteps(live, record, serverSteps) ?? { steps: serverSteps, source: 'saved' as const };
  const value = shown.steps;
  const progress = target > 0 ? value / target : 0;
  const reached = target > 0 && value >= target;
  const pct = Math.round(Math.min(progress, 9.99) * 100);
  const source = SOURCE[shown.source];
  const sourceLabel =
    shown.source === 'saved' ? (value > 0 ? (isToday ? 'Saved earlier today' : 'Saved for this day') : isToday ? 'Not counted yet' : 'No steps saved') : source.label;

  // A gentle tick when the live count crosses the goal while Today is open (not when switching days).
  const prev = useRef<{ date: string; value: number } | null>(null);
  useEffect(() => {
    const before = prev.current;
    prev.current = { date, value };
    if (isToday && before?.date === date && before.value < target && value >= target) haptics.success();
  }, [date, value, target, isToday]);

  let status: string;
  if (reached) status = isToday ? 'Step goal reached — lovely work.' : 'Step goal reached.';
  else if (isToday && live?.partialFrom && shown.source === 'phone') status = `Counting since ${formatTime(new Date(live.partialFrom).toISOString(), tz)} — earlier steps today weren’t seen by this phone.`;
  else if (isToday && counting) status = `${formatNumber(target - value)} to go · updates on its own`;
  else if (isToday) status = value > 0 ? `${formatNumber(target - value)} to go` : 'A short walk after meals is a great place to start.';
  else status = value > 0 ? `${formatNumber(target - value)} short of the goal` : 'No steps for this day.';

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
            <Text variant="caption" tone="muted" numberOfLines={1} style={styles.flex}>
              {sourceLabel}
            </Text>
          </View>
        </View>
      </View>

      <Text variant="caption" tone={reached ? 'success' : 'subtle'} weight={reached ? 'semibold' : undefined} style={styles.status}>
        {status}
      </Text>

      {isToday && canAsk ? (
        <View style={styles.cta}>
          {permission === 'blocked' ? (
            <>
              <Button
                label="Open Settings"
                variant="secondary"
                icon="settings"
                block
                onPress={() => void steps.openSettings()}
                accessibilityHint={`Turn on ${steps.permissionName} for ÖRZA`}
              />
              <Text variant="caption" tone="subtle" align="center">
                {`To count steps automatically, turn on ${steps.permissionName}: ${steps.settingsPath}.`}
              </Text>
            </>
          ) : (
            <Button
              label="Count my steps automatically"
              variant="energy"
              icon="mci:shoe-print"
              block
              onPress={() => setExplain(true)}
              accessibilityHint="Explains step counting, then asks for permission"
            />
          )}
        </View>
      ) : null}

      {manual ? <Button label="Log steps" variant="ghost" size="sm" icon="edit-3" onPress={onLog} style={styles.log} /> : null}

      <StepsPermissionSheet visible={explain} onClose={() => setExplain(false)} steps={steps} />
    </GlassCard>
  );
}

/* ───────────────────────────── Why + system prompt ───────────────────────────── */

type Steps = ReturnType<typeof useTodaySteps>;

function Point({ icon, children }: { icon: IconName; children: string }) {
  return (
    <View style={styles.point}>
      <View style={styles.pointIcon}>
        <Icon name={icon} size={16} color={colors.energyInk} />
      </View>
      <Text variant="small" tone="text" style={styles.flex}>
        {children}
      </Text>
    </View>
  );
}

function StepsPermissionSheet({ visible, onClose, steps }: { visible: boolean; onClose: () => void; steps: Steps }) {
  const [asking, setAsking] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setBlocked(steps.access?.phonePermission === 'blocked');
  }
  const android = steps.platform === 'android';
  const store = android ? 'Health Connect' : 'Apple Health';

  const allow = async () => {
    if (asking) return;
    setAsking(true);
    try {
      const result = await steps.requestAccess();
      if (result === 'granted') {
        haptics.success();
        toast.success('Step counting is on — Today fills in by itself.');
        onClose();
      } else if (result === 'blocked') {
        haptics.warning();
        setBlocked(true);
      } else if (result === 'unavailable') {
        toast.info('This phone doesn’t have a step counter. You can still log steps yourself.');
        onClose();
      } else {
        haptics.warning();
        toast.info(`No problem — tap “Count my steps automatically” whenever you’d like to turn on ${steps.permissionName}.`);
        onClose();
      }
    } finally {
      setAsking(false);
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      eyebrow="Steps"
      title="Let ÖRZA count your steps"
      dismissible={!asking}
      footer={
        blocked ? (
          <Button
            label="Open Settings"
            variant="primary"
            icon="settings"
            block
            onPress={() => {
              void steps.openSettings();
              onClose();
            }}
          />
        ) : (
          <Button label="Allow step counting" variant="energy" icon="check" block loading={asking} onPress={() => void allow()} haptic="firm" />
        )
      }
    >
      <View style={styles.points}>
        <Point icon="smartphone">Your phone already counts steps with a low-power motion sensor — you never need to type them.</Point>
        <Point icon="clock">It keeps counting all day, even when ÖRZA is closed, and Today updates on its own.</Point>
        <Point icon="lock">Only each day’s total is saved to ÖRZA — never where you go.</Point>
      </View>
      {blocked ? (
        <View style={styles.blocked} accessibilityRole="alert">
          <Icon name="info" size={16} color={colors.cyan700} />
          <Text variant="caption" tone="text" style={styles.flex}>
            {`${steps.permissionName} is turned off for ÖRZA. Turn it on in ${steps.settingsPath}, then come back — counting starts right away.`}
          </Text>
        </View>
      ) : (
        <Text variant="caption" tone="subtle" style={styles.next}>
          {`Next, your phone asks to allow “${steps.permissionName}”.`}
        </Text>
      )}
      {!steps.healthConnected && steps.platform !== 'none' ? (
        <Button
          label={`Wear a watch? Connect ${store}`}
          variant="ghost"
          size="sm"
          iconRight="arrow-up-right"
          onPress={() => {
            onClose();
            router.push('/health');
          }}
          disabled={asking}
          style={styles.watch}
        />
      ) : null}
    </Sheet>
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
  log: { alignSelf: 'flex-start', marginTop: spacing.sm },
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
  points: { gap: spacing.md },
  point: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  pointIcon: { width: 32, height: 32, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.energyBg },
  next: { marginTop: spacing.lg },
  blocked: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radii.sm,
    borderWidth: 1,
    backgroundColor: colors.infoBg,
    borderColor: 'rgba(11,143,166,0.18)',
  },
  watch: { alignSelf: 'flex-start', marginTop: spacing.md },
});
