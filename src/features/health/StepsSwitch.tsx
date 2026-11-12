/**
 * "Count steps automatically" outside Today (steps v2, `docs/notes/steps-v2.md` §6, P9, P19, U3, U4): the Health
 * screen's Steps card (`StepsSwitchCard`, with the "both ways" line) and the Settings › Privacy & data row
 * (`StepsSwitchRow`). What they show is `lib/steps/switchCard.ts` (tested); both read nothing themselves
 * (`useTodaySteps({live: false})`: the app reads at launch and on every return, an answer reads at once).
 *
 * - Off → the confirmation sheet (§6): ÖRZA stops reading; the phone's own settings keep its access until the member
 *   removes it there (the sheet says where; the Health screen's Disconnect revokes Health Connect).
 * - On → the member's consents count again, or — never agreed on this install — Today's ask: the same one-button
 *   disclosure as Today (`StepsDisclosure.tsx`), or Settings / Health Connect / Google Play. "Not now" on Today never
 *   hides this way back (P19).
 * - Health card, counting from Health Connect without its background reading (V2 B1): "Steps are saved only while
 *   ÖRZA is open." + "Allow background access" (Health Connect's background screen), or — refused on this visit —
 *   "Open Health Connect" with where to allow it.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, LinearTransition, useReducedMotion } from 'react-native-reanimated';

import { TINTS } from '@/features/settings/parts';
import { useStepsDisclosure } from '@/features/today/StepsDisclosure';
import { haptics } from '@/lib/haptics';
import { bothWaysLine, offSheet, switchView, type OffSheetCopy } from '@/lib/steps/switchCard';
import { motionButtonCopy, type CardAction } from '@/lib/steps/todayCard';
import { useTodaySteps } from '@/lib/steps/useSteps';
import { colors, isIOS, radii, spacing } from '@/theme';
import { Button, GlassCard, Icon, Sheet, Switch, switchBoxStyle, Text, toast } from '@/ui';

const TITLE = 'Count steps automatically';

/** The switch's state, its answers and its sheets — shared by the Health card and the Settings row. */
function useStepsSwitchFlow() {
  const steps = useTodaySteps({ live: false });
  const flow = useStepsDisclosure(steps, { againLabel: TITLE });
  const [offOpen, setOffOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // B1: Health Connect's background screen refused on this visit (it may not show again) → "Open Health Connect".
  const [backgroundRefused, setBackgroundRefused] = useState(false);
  const [askingBackground, setAskingBackground] = useState(false);

  const view = switchView({
    platform: steps.platform,
    on: steps.autoOn,
    agreed: steps.agreed,
    sources: steps.sources,
    access: steps.access,
    ask: steps.ask,
    hcRefused: steps.hcRefused,
    backgroundRefused,
  });
  const off = offSheet(steps.platform, steps.sources, steps.access);

  const resume = async () => {
    setBusy(true);
    try {
      await steps.setAutoSteps(true);
      haptics.success();
      toast.success(steps.agreed ? 'Step counting is back on — Today fills in by itself.' : 'Turned on — Today shows how to count your steps.');
    } catch {
      toast.error('That didn’t work — please try again.');
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    try {
      await steps.setAutoSteps(false);
      setOffOpen(false);
      haptics.success();
      toast.info('Step counting is off. You can log steps on Today any time.');
    } catch {
      toast.error('That didn’t work — please try again.');
    } finally {
      setBusy(false);
    }
  };

  /** B1: "Allow background access" (Health Connect's background screen), or Health Connect after a refusal. */
  const allowBackground = async () => {
    if (view.background === 'store_settings') {
      flow.act({ type: 'store_settings' });
      return;
    }
    if (askingBackground) return;
    setAskingBackground(true);
    try {
      if (await steps.requestBackground()) {
        haptics.success();
        toast.success('Done — your steps are saved even when ÖRZA is closed.');
      } else {
        haptics.warning();
        setBackgroundRefused(true);
        toast.info('No problem — your steps are saved whenever you open ÖRZA.');
      }
    } catch {
      toast.info('That didn’t open — please try again in a moment.');
    } finally {
      setAskingBackground(false);
    }
  };

  const toggle = (next: boolean) => {
    if (busy || flow.asking || flow.askingFallback) return;
    if (!next) {
      if (!view.checked) return;
      haptics.warning();
      setOffOpen(true);
      return;
    }
    const action = view.turnOn;
    if (!action) return;
    if (action.type === 'resume') void resume();
    else flow.act(action);
  };

  const sheets = (
    <>
      {flow.sheet}
      <OffSheet
        visible={offOpen}
        copy={off}
        busy={busy}
        onKeep={() => setOffOpen(false)}
        onTurnOff={() => void turnOff()}
        onOpen={() => {
          if (off.open) flow.act({ type: off.open });
        }}
      />
    </>
  );

  return { steps, view, flow, toggle, waiting: busy || flow.asking || flow.askingFallback, sheets, allowBackground, askingBackground };
}

/** What a "get it counting again" button says (the motion fallback's: `motionButtonCopy`). */
function actionLabel(a: CardAction): string {
  if (a.type === 'settings') return 'Open Settings';
  if (a.type === 'store_settings') return 'Open Health Connect';
  if (a.type === 'store_install') return 'Get Health Connect';
  return a.sheet.variant === 'turn_on' ? 'Turn on' : 'Allow access';
}

function actionIcon(a: CardAction) {
  if (a.type === 'settings') return 'settings' as const;
  if (a.type === 'store_settings') return 'mci:heart-pulse' as const;
  if (a.type === 'store_install') return 'mci:google-play' as const;
  return 'mci:shoe-print' as const;
}

/**
 * The switch itself (a spinner while an answer is on its way): the app's switch with its whole 48 × 48 dp box laid out
 * (`fit="box"`, `ui/Switch`) — the track stays centred and the whole box toggles.
 */
function Toggle({ value, enabled, waiting, hint, onChange }: { value: boolean; enabled: boolean; waiting: boolean; hint: string; onChange: (v: boolean) => void }) {
  if (waiting) return <ActivityIndicator size="small" color={colors.coral} accessibilityLabel="Working" style={switchBoxStyle} />;
  return (
    <Switch
      fit="box"
      value={value}
      onValueChange={(v) => {
        haptics.select();
        onChange(v);
      }}
      disabled={!enabled}
      accessibilityLabel={TITLE}
      accessibilityHint={hint}
      trackColor={{ false: 'rgba(20,20,20,0.16)', true: colors.coral }}
      thumbColor={isIOS ? undefined : value ? colors.white : '#F4F1EC'}
      ios_backgroundColor="rgba(20,20,20,0.16)"
    />
  );
}

/** "Get it counting again" (on, nothing counts) and the motion sensor after a Health Connect refusal. */
function FixActions({ flow, steps, fix, motion, small }: {
  flow: ReturnType<typeof useStepsSwitchFlow>['flow'];
  steps: ReturnType<typeof useStepsSwitchFlow>['steps'];
  fix: CardAction | null;
  motion: CardAction | null;
  small?: boolean;
}) {
  const { platform } = steps;
  // "Use this phone’s motion sensor instead", or "Allow Physical activity" ↗ once it opens Settings (V2 B2).
  const motionCopy = motion ? motionButtonCopy(platform, motion, steps.permissionName, steps.settingsPath) : null;
  if (!fix && !motion) return null;
  return (
    <Animated.View entering={FadeIn} style={[styles.fixes, small && styles.fixesRow]}>
      {fix ? (
        <Button
          label={actionLabel(fix)}
          size="sm"
          variant="secondary"
          icon={actionIcon(fix)}
          iconRight={fix.type === 'sheet' ? undefined : 'arrow-up-right'}
          loading={flow.asking}
          onPress={() => flow.act(fix)}
          style={styles.fixButton}
        />
      ) : null}
      {motion && motionCopy ? (
        <>
          <Button
            label={motionCopy.label}
            size="sm"
            variant={fix ? 'ghost' : 'secondary'}
            icon="smartphone"
            iconRight={motionCopy.external ? 'arrow-up-right' : undefined}
            loading={flow.askingFallback}
            onPress={() => flow.act(motion)}
            accessibilityHint={motionCopy.hint}
            style={styles.fixButton}
          />
          {motionCopy.caption ? (
            <Text variant="caption" tone="subtle">
              {motionCopy.caption}
            </Text>
          ) : null}
        </>
      ) : null}
    </Animated.View>
  );
}

/* ───────────────────────────── Health screen ───────────────────────────── */

/** The Health screen's Steps card: the switch, what counts, the "both ways" line (§6, §2.8). */
export function StepsSwitchCard() {
  const reduce = useReducedMotion();
  const { steps, view, flow, toggle, waiting, sheets, allowBackground, askingBackground } = useStepsSwitchFlow();
  const both = bothWaysLine(steps.platform, steps.access?.features, steps.sources);
  const lit = view.checked;

  return (
    <Animated.View
      entering={reduce ? undefined : FadeInDown.delay(80).springify().damping(18).stiffness(100).mass(1)}
      layout={reduce ? undefined : LinearTransition.springify().damping(20).stiffness(100).mass(1)}
    >
      <GlassCard padding={spacing.lg}>
        <View style={styles.head}>
          <View style={[styles.disc, lit ? styles.discOn : styles.discOff]}>
            <Icon name="mci:shoe-print" size={20} color={lit ? colors.energyInk : colors.muted} />
          </View>
          <View style={styles.flex}>
            <Text variant="label" tone="ink">
              {TITLE}
            </Text>
            <Text variant="caption" tone="muted" style={styles.subtitle}>
              {view.subtitle}
            </Text>
          </View>
          {view.state !== 'unsupported' ? <Toggle value={view.checked} enabled={view.enabled} waiting={waiting} hint={view.subtitle} onChange={toggle} /> : null}
        </View>

        <FixActions flow={flow} steps={steps} fix={view.fix} motion={view.motion} />

        {view.background ? (
          <Animated.View entering={reduce ? undefined : FadeIn} style={styles.background}>
            <View style={styles.backgroundLine}>
              <Icon name="info" size={14} color={colors.cyan700} />
              <Text variant="caption" tone="text" style={styles.flex}>
                {view.background === 'ask'
                  ? 'Steps are saved only while ÖRZA is open.'
                  : 'Steps are saved only while ÖRZA is open. To save them when it’s closed, allow background access in Health Connect › App permissions › ÖRZA.'}
              </Text>
            </View>
            <Button
              label={view.background === 'ask' ? 'Allow background access' : 'Open Health Connect'}
              size="sm"
              variant="secondary"
              icon={view.background === 'ask' ? 'refresh-cw' : 'mci:heart-pulse'}
              iconRight={view.background === 'ask' ? undefined : 'arrow-up-right'}
              loading={askingBackground}
              onPress={() => void allowBackground()}
              accessibilityHint={
                view.background === 'ask'
                  ? 'Asks Health Connect to let ÖRZA read your steps while it’s closed'
                  : 'Opens Health Connect, where you can allow ÖRZA to read in the background'
              }
              style={styles.fixButton}
            />
          </Animated.View>
        ) : null}

        {both ? (
          <View style={styles.both}>
            <Icon name="repeat" size={14} color={colors.cyan700} />
            <Text variant="caption" tone="muted" style={styles.flex}>
              {both}
            </Text>
          </View>
        ) : null}

        {view.state === 'counting' ? (
          <Button label="See today’s steps" variant="ghost" size="sm" onPress={() => router.navigate('/')} style={styles.link} />
        ) : null}
      </GlassCard>
      {sheets}
    </Animated.View>
  );
}

/* ───────────────────────────── Settings › Privacy & data ───────────────────────────── */

/** The Settings row (U4): the same switch, as a row of the Privacy & data group. Nothing on a non-phone build. */
export function StepsSwitchRow({ last }: { last?: boolean }) {
  const { steps, view, flow, toggle, waiting, sheets } = useStepsSwitchFlow();
  if (view.state === 'unsupported') return null;
  return (
    <View style={[styles.row, !last && styles.rowDivider]}>
      <View style={[styles.rowIcon, { backgroundColor: TINTS.energy.bg }]}>
        <Icon name="mci:shoe-print" size={20} color={TINTS.energy.tint} />
      </View>
      <View style={styles.flex}>
        <Text variant="title" numberOfLines={2}>
          {TITLE}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={3}>
          {view.subtitle}
        </Text>
        <FixActions flow={flow} steps={steps} fix={view.fix} motion={view.motion} small />
      </View>
      <Toggle value={view.checked} enabled={view.enabled} waiting={waiting} hint={view.subtitle} onChange={toggle} />
      {sheets}
    </View>
  );
}

/* ───────────────────────────── The off sheet (§6) ───────────────────────────── */

function OffSheet({
  visible,
  copy,
  busy,
  onKeep,
  onTurnOff,
  onOpen,
}: {
  visible: boolean;
  copy: OffSheetCopy;
  busy: boolean;
  onKeep: () => void;
  onTurnOff: () => void;
  onOpen: () => void;
}) {
  // Equal halves while "Keep counting" fits; with large text (or a narrow phone) "Turn off" wraps below instead of
  // cutting the label (as Today's empty-meal actions, D1).
  const { fontScale } = useWindowDimensions();
  const half = [styles.footerButton, { minWidth: FOOTER_BUTTON_MIN_WIDTH * fontScale }];
  return (
    <Sheet
      visible={visible}
      onClose={onKeep}
      dismissible={!busy}
      eyebrow="Steps"
      title={copy.title}
      footer={
        <View style={styles.footer}>
          <Button label="Keep counting" variant="ghost" onPress={onKeep} disabled={busy} style={half} />
          <Button label="Turn off" variant="primary" onPress={onTurnOff} loading={busy} style={half} />
        </View>
      }
    >
      <Text variant="callout" tone="text">
        {copy.body}
      </Text>
      {copy.note ? (
        <View style={styles.note}>
          <Icon name="info" size={16} color={colors.cyan700} />
          <View style={[styles.flex, styles.noteBody]}>
            <Text variant="small" tone="text">
              {copy.note}
            </Text>
            {copy.open ? (
              <Button
                label={copy.open === 'store_settings' ? 'Open Health Connect' : 'Open Settings'}
                size="sm"
                variant="secondary"
                icon="external-link"
                onPress={onOpen}
                style={styles.noteButton}
                accessibilityHint={copy.open === 'store_settings' ? 'Opens Health Connect’s permissions for ÖRZA' : 'Opens ÖRZA’s page in Settings'}
              />
            ) : null}
          </View>
        </View>
      ) : null}
    </Sheet>
  );
}

/** "Keep counting" at font scale 1 (label + padding), dp. */
const FOOTER_BUTTON_MIN_WIDTH = 156;

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  disc: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  discOn: { backgroundColor: colors.energyBg },
  discOff: { backgroundColor: colors.canvas2 },
  subtitle: { marginTop: 2 },
  fixes: { gap: spacing.sm, marginTop: spacing.md },
  fixesRow: { marginTop: spacing.sm },
  fixButton: { alignSelf: 'flex-start' },
  both: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  link: { alignSelf: 'flex-start', marginTop: spacing.sm },
  background: {
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: 'rgba(11,143,166,0.18)',
    backgroundColor: colors.infoBg,
  },
  backgroundLine: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: 14, minHeight: 64 },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hairlineStrong },
  rowIcon: { width: 40, height: 40, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center' },
  footer: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  // flexBasis 0 + a font-scaled minWidth: the row wraps on the minWidth, then each line shares its width equally.
  footerButton: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
  note: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    padding: spacing.md,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: 'rgba(11,143,166,0.18)',
    backgroundColor: colors.infoBg,
  },
  noteBody: { gap: spacing.sm },
  noteButton: { alignSelf: 'flex-start' },
});
