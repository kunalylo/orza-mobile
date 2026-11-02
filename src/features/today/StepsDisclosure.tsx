/**
 * The steps disclosure and what Today's ask does (steps v2, `docs/notes/steps-v2.md` §2.2, §6, P6, U1–U4) — shared by
 * Today's steps card and "Count steps automatically" on the Health screen and in Settings › Privacy & data.
 *
 * `useStepsDisclosure(steps)` → `act(action)` runs one of `lib/steps/todayCard`'s actions:
 * - `sheet`: one disclosure sheet with one button (P6). "Continue" closes it and the system prompt opens once it has
 *   gone (one modal at a time) — on iPhone it can't be left any other way, on Android only by the system back. "Turn
 *   on" when the permission is already there (a second member, the switch was off): a consent screen, closable.
 * - `settings` / `store_settings` / `store_install`: the app's Settings page, Health Connect, Google Play — and a
 *   re-check as soon as the member comes back.
 * Render `sheet` once, next to the button that acts.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';

import { haptics } from '@/lib/haptics';
import { disclosureCopy, type CardAction, type DisclosureSheet, type PointIcon } from '@/lib/steps/todayCard';
import type { StepPermission } from '@/lib/steps/types';
import type { useTodaySteps } from '@/lib/steps/useSteps';
import { colors, radii, spacing } from '@/theme';
import { Button, Icon, Orb, Sheet, Text, toast, type IconName } from '@/ui';

type TodaySteps = ReturnType<typeof useTodaySteps>;

/** iPhone: the system sheet waits this long after the disclosure's own sheet has gone (one modal at a time). */
const PROMPT_AFTER_SHEET_MS = Platform.OS === 'ios' ? 300 : 0;

const STORE_ICON: IconName = Platform.OS === 'ios' ? 'mci:apple' : 'mci:heart-pulse';

const POINT_ICON: Record<PointIcon, IconName> = {
  store: STORE_ICON,
  watch: 'watch',
  phone: 'smartphone',
  share: 'share-2',
  history: 'calendar',
  saved: 'lock',
  ai: 'mci:creation',
  off: 'toggle-right',
};

export interface StepsDisclosureOptions {
  /** The button the member would tap to be asked again (the "maybe later" toast names it). */
  againLabel: string;
}

export interface StepsDisclosure {
  /** Runs a card action: its disclosure sheet, or the app's Settings / Health Connect / Google Play. */
  act: (action: CardAction) => void;
  /** The system prompt for the main ask is on its way (the button that asked shows a spinner). */
  asking: boolean;
  /** The same for the motion fallback ("Use … motion … instead"). */
  askingFallback: boolean;
  /** The sheet — render it once. */
  sheet: ReactNode;
}

export function useStepsDisclosure(steps: TodaySteps, { againLabel }: StepsDisclosureOptions): StepsDisclosure {
  // The disclosure: what it shows (kept while it slides out), whether it is open, and a system prompt to show once it
  // has gone (P6: "Continue" opens the prompt; one modal at a time).
  const [disclosure, setDisclosure] = useState<DisclosureSheet | null>(null);
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [turningOn, setTurningOn] = useState(false);
  const promptNext = useRef<DisclosureSheet | null>(null);

  // Back from Settings / Health Connect / Google Play (opened here): check again at once — the answer shows without
  // waiting for the next read.
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
      // Refused for good (iPhone: any refusal of Motion & Fitness) — Settings is the way from now on.
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
            : `No problem — tap “${againLabel}” whenever you’d like to turn on ${steps.permissionName}.`
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

  const sheet = disclosure ? (
    <StepsDisclosureSheet
      visible={open}
      sheet={disclosure}
      fullBackfill={steps.fullBackfill}
      android={steps.platform === 'android'}
      busy={turningOn}
      onContinue={onContinue}
      onTurnOn={() => void onTurnOn()}
      onClose={() => setOpen(false)}
      onClosed={onClosed}
    />
  ) : null;

  return { act, asking: asking && !disclosure?.fallback, askingFallback: asking && !!disclosure?.fallback, sheet };
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
