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
 * - a counted day can still be corrected ("Edit": the member's number, plus steps counted after it).
 * It also renders without Today's data (offline / loading): the phone's own count needs no network.
 *
 * Reading + saving lives in `@/lib/steps` (`useTodaySteps`): it reads on focus, every minute while Today is visible and
 * on return to the app, and saves the count through `POST /api/track/steps` so the website shows the same number.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import { useSignedInUser } from '@/lib/auth';
import { haptics } from '@/lib/haptics';
import { shownSteps, type ShownSource } from '@/lib/steps/policy';
import { useDayRecord } from '@/lib/steps/store';
import { disclosureCopy, todayCard, type CardAction, type DisclosureSheet, type PointIcon } from '@/lib/steps/todayCard';
import type { StepPermission } from '@/lib/steps/types';
import { useTodaySteps } from '@/lib/steps/useSteps';
import { colors, radii, spacing } from '@/theme';
import { Button, EnergyRing, GlassCard, Icon, Orb, Sheet, Text, toast, type IconName } from '@/ui';

import { formatNumber, formatTime } from '@/features/meals/utils';

import { TrackerHead } from './TrackerHead';

/** Used when the member has no step target. */
export const DEFAULT_STEP_TARGET = 10_000;

/** iPhone: the system sheet waits this long after the disclosure's own sheet has gone (one modal at a time). */
const PROMPT_AFTER_SHEET_MS = Platform.OS === 'ios' ? 300 : 0;

const STORE_ICON: IconName = Platform.OS === 'ios' ? 'mci:apple' : 'mci:heart-pulse';

const SOURCE: Record<ShownSource, { icon: IconName; label: string }> = {
  phone: { icon: 'smartphone', label: 'Counted by this phone' },
  health_connect: { icon: 'mci:heart-pulse', label: 'From Health Connect' },
  apple_health: { icon: 'mci:apple', label: 'From Apple Health' },
  saved: { icon: 'check-circle', label: 'Saved' },
  edited: { icon: 'edit-3', label: 'Edited by you' },
};

const POINT_ICON: Record<PointIcon, IconName> = {
  store: STORE_ICON,
  watch: 'watch',
  phone: 'smartphone',
  share: 'share-2',
  history: 'calendar',
  saved: 'lock',
  off: 'toggle-right',
};

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
  const android = steps.platform === 'android';

  // The disclosure: what it shows (kept while it slides out), whether it is open, and a system prompt to show once it
  // has gone (P6: "Continue" opens the prompt; one modal at a time).
  const [disclosure, setDisclosure] = useState<DisclosureSheet | null>(null);
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [turningOn, setTurningOn] = useState(false);
  const promptNext = useRef<DisclosureSheet | null>(null);

  // Back from Settings / Health Connect / Google Play (opened here): check again at once — the answer shows without
  // waiting for the next minute's read.
  const away = useRef(false);
  const { recheck } = steps;
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && away.current) {
        away.current = false;
        recheck();
      }
    });
    return () => sub.remove();
  }, [recheck]);

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
  let sourceLabel = shown.approximate ? `${source.label} · approximate` : source.label;
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

  /* ─── the member's answers ─── */

  const goAway = (opener: () => Promise<void>) => {
    away.current = true;
    void opener().catch(() => {
      away.current = false;
      toast.error('That didn’t open — please try again.');
    });
  };

  const act = (action: CardAction) => {
    if (action.type === 'sheet') {
      // iPhone: "Use iPhone motion instead" is offered once — taken now.
      if (action.sheet.fallback && steps.platform === 'ios') steps.markMotionOffered();
      setDisclosure(action.sheet);
      setOpen(true);
    } else if (action.type === 'settings') goAway(steps.openSettings);
    else if (action.type === 'store_settings') goAway(steps.openStoreSettings);
    else goAway(steps.openStoreInstall);
  };

  /** The system prompt's answer, once the disclosure has gone. */
  const answer = (s: DisclosureSheet, result: StepPermission) => {
    if (result === 'granted') {
      haptics.success();
      toast.success('Step counting is on — Today fills in by itself.');
    } else if (result === 'blocked') {
      // Refused for good (iPhone: any refusal of Motion & Fitness) — the card offers Settings from now on.
      haptics.warning();
      toast.info(`No problem — you can log steps yourself. To count them later, turn on ${steps.permissionName} in ${steps.settingsPath}.`);
    } else if (result === 'unavailable') {
      toast.info(
        s.kind === 'hc'
          ? 'Health Connect isn’t available on this phone right now. You can still log steps yourself.'
          : 'This phone doesn’t have a step counter. You can still log steps yourself.'
      );
    } else if (result === 'undetermined') {
      toast.info('That didn’t open — please try again in a moment.');
    } else {
      haptics.warning();
      toast.info(
        s.kind === 'hc'
          ? steps.access?.phoneAvailable
            ? 'No problem — log steps yourself, or use this phone’s motion sensor instead.'
            : 'No problem — you can log steps yourself any time.'
          : s.fallback
            ? 'No problem — you can log steps yourself any time.'
            : `No problem — tap “Count my steps automatically” whenever you’d like to turn on ${steps.permissionName}.`
      );
    }
  };

  const onContinue = () => {
    if (!disclosure || asking) return;
    promptNext.current = disclosure;
    setAsking(true);
    setOpen(false);
  };

  const onClosed = () => {
    const s = promptNext.current;
    promptNext.current = null;
    if (!s) return;
    setTimeout(() => {
      void (async () => {
        try {
          answer(s, s.fallback ? await steps.motionInstead() : await steps.requestAccess(s.kind));
        } catch {
          toast.info('That didn’t open — please try again in a moment.');
        } finally {
          setAsking(false);
        }
      })();
    }, PROMPT_AFTER_SHEET_MS);
  };

  const onTurnOn = async () => {
    if (!disclosure || turningOn) return;
    setTurningOn(true);
    try {
      await steps.turnOn(disclosure.kind);
      haptics.success();
      toast.success('Step counting is on — Today fills in by itself.');
      setOpen(false);
    } catch {
      toast.error('That didn’t work — please try again.');
    } finally {
      setTurningOn(false);
    }
  };

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
        loading={asking && !disclosure?.fallback}
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
              loading={asking && !!disclosure?.fallback}
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

      {disclosure ? (
        <StepsDisclosureSheet
          visible={open}
          sheet={disclosure}
          fullBackfill={steps.fullBackfill}
          android={android}
          busy={turningOn}
          onContinue={onContinue}
          onTurnOn={() => void onTurnOn()}
          onClose={() => setOpen(false)}
          onClosed={onClosed}
        />
      ) : null}
    </GlassCard>
  );
}

/* ───────────────────────────── The disclosure (P6, §6) ───────────────────────────── */

function Point({ icon, children, index }: { icon: IconName; children: string; index: number }) {
  const reduce = useReducedMotion();
  return (
    <Animated.View entering={reduce ? undefined : FadeIn.delay(90 + index * 60)} style={styles.point}>
      <View style={styles.pointIcon}>
        <Icon name={icon} size={16} color={colors.energyInk} />
      </View>
      <Text variant="small" tone="text" style={styles.flex}>
        {children}
      </Text>
    </Animated.View>
  );
}

/** A small picture of what the sheet is about: the source → ÖRZA. */
function SourceFlow({ icon }: { icon: IconName }) {
  const reduce = useReducedMotion();
  return (
    <View style={styles.flow} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.flowTile}>
        <Icon name={icon} size={22} color={colors.energyInk} />
      </View>
      <View style={styles.flowLine}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={styles.flowDot} />
        ))}
        <Icon name="mci:shoe-print" size={16} color={colors.coral} />
        {[0, 1, 2].map((i) => (
          <View key={i + 3} style={styles.flowDot} />
        ))}
      </View>
      <Orb size={52} tone="light" orbits={false} paused={reduce} />
    </View>
  );
}

/**
 * P6: one button. "Continue" — the system prompt follows once the sheet has gone; there is no other way out on iPhone
 * (no close button, swipe or backdrop), only the system back on Android. "Turn on" — the permission is there already:
 * the member's OK only, and the sheet closes like any other.
 */
function StepsDisclosureSheet({
  visible,
  sheet,
  fullBackfill,
  android,
  busy,
  onContinue,
  onTurnOn,
  onClose,
  onClosed,
}: {
  visible: boolean;
  sheet: DisclosureSheet;
  fullBackfill: boolean;
  android: boolean;
  busy: boolean;
  onContinue: () => void;
  onTurnOn: () => void;
  onClose: () => void;
  onClosed: () => void;
}) {
  const copy = disclosureCopy(sheet.path, sheet.variant, fullBackfill);
  const turnOn = sheet.variant === 'turn_on';
  const lead = copy.points[0]?.icon ?? 'phone';
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      onClosed={onClosed}
      eyebrow="Steps"
      title={copy.title}
      dismissible={turnOn && !busy}
      closeButton={turnOn}
      onBack={!turnOn && android ? onClose : undefined}
      footer={
        <Button
          label={copy.button}
          variant="energy"
          icon={turnOn ? 'check' : undefined}
          iconRight={turnOn ? undefined : 'arrow-right'}
          block
          loading={busy}
          haptic="firm"
          onPress={turnOn ? onTurnOn : onContinue}
          accessibilityHint={turnOn ? 'Turns on step counting for your account' : (copy.caption ?? undefined)}
        />
      }
    >
      <SourceFlow icon={POINT_ICON[lead]} />
      <View style={styles.points}>
        {copy.points.map((p, i) => (
          <Point key={p.text} icon={POINT_ICON[p.icon]} index={i}>
            {p.text}
          </Point>
        ))}
      </View>
      {copy.caption ? (
        <Text variant="caption" tone="subtle" style={styles.next}>
          {copy.caption}
        </Text>
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
  flow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.md, marginBottom: spacing.xs },
  flowTile: {
    width: 52,
    height: 52,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.energyBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(194,65,12,0.16)',
  },
  flowLine: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  flowDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.hairlineStrong },
  points: { gap: spacing.md },
  point: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  pointIcon: { width: 32, height: 32, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.energyBg },
  next: { marginTop: spacing.sm },
});
