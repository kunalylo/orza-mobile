/**
 * The AI consent sheet (`docs/notes/ai-consent.md` §4): names OpenAI and what each AI feature sends, then Allow / Not
 * now. Shown by `AiConsentHost` the first time a member starts an AI feature. Not now, the backdrop, the close button
 * and Android back all mean "no" (Google Play: navigating away is not consent); while Allow saves, nothing dismisses it.
 * `ConsentPoints` is shared with Settings › Privacy & data › AI features.
 */
import { Platform, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';

import { AI_PRIVACY_PATH, consentCopy, type ConsentContext, type ConsentCopy, type ConsentPointIcon } from '@/lib/aiConsent';
import { haptics } from '@/lib/haptics';
import { openWebsite } from '@/lib/web';
import { colors, radii, spacing } from '@/theme';
import { Button, Icon, Orb, Sheet, Text, toast, type IconName } from '@/ui';

const POINT_ICON: Record<ConsentPointIcon, IconName> = {
  meals: 'camera',
  chat: 'message-circle',
  recipes: 'mci:chef-hat',
  rx: 'file-text',
  never: 'lock',
};

/** The feature the sheet opened for, as the More menu and the tabs show it. */
const FEATURE_ICON: Record<ConsentContext, IconName> = {
  chat: 'mci:chat-processing-outline',
  meal_text: 'mci:silverware-fork-knife',
  snap: 'camera',
  recipe: 'mci:chef-hat',
  rebalance: 'mci:scale-balance',
  rx: 'file-text',
  settings: 'mci:creation',
};

export const CONSENT_PLATFORM: 'ios' | 'android' = Platform.OS === 'ios' ? 'ios' : 'android';

/** The website's privacy policy, AI section, in the in-app browser. */
export function openAiPrivacy() {
  haptics.tap();
  void openWebsite(AI_PRIVACY_PATH, { toolbarColor: colors.canvas, controlsColor: colors.energyInk }).catch(() =>
    toast.error("Couldn't open the page. Please try again.")
  );
}

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

function FlowDots() {
  return (
    <View style={styles.flowLine}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={styles.flowDot} />
      ))}
    </View>
  );
}

/**
 * A small picture of what the sheet asks about, as the steps disclosure has one: the feature → ÖRZA → the AI provider
 * (a generic sparkle, no provider logo). Decorative: the lead says it in words.
 */
function AiFlow({ context }: { context: ConsentContext }) {
  const reduce = useReducedMotion();
  return (
    <View style={styles.flow} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.flowTile, styles.flowFeature]}>
        <Icon name={FEATURE_ICON[context]} size={22} color={colors.energyInk} />
      </View>
      <FlowDots />
      <Orb size={52} tone="light" orbits={false} paused={reduce} />
      <FlowDots />
      <View style={[styles.flowTile, styles.flowAi]}>
        <Icon name="mci:creation" size={22} color={colors.violet600} />
      </View>
    </View>
  );
}

/** Who runs the AI features, what each one sends, what never goes, and the privacy policy link. */
export function ConsentPoints({ copy }: { copy: ConsentCopy }) {
  return (
    <View style={styles.body}>
      <Text variant="callout" tone="text">
        {copy.lead}
      </Text>
      <View style={styles.points}>
        {copy.points.map((p, i) => (
          <Point key={p.icon} icon={POINT_ICON[p.icon]} index={i}>
            {p.text}
          </Point>
        ))}
      </View>
      <View style={styles.after}>
        {copy.after.map((t) => (
          <Text key={t} variant="small" tone="muted">
            {t}
          </Text>
        ))}
      </View>
      <Button
        label={copy.link}
        variant="ghost"
        size="sm"
        iconRight="arrow-up-right"
        onPress={openAiPrivacy}
        accessibilityHint="Opens ÖRZA’s privacy policy"
        style={styles.link}
      />
    </View>
  );
}

/** A failed save, in the footer right above its buttons (the points above may be scrolled away). */
export function ConsentError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Animated.View entering={FadeIn.duration(180)} style={styles.error} accessibilityLiveRegion="polite" accessibilityRole="alert">
      <Icon name="alert-circle" size={15} color={colors.error} />
      <Text variant="small" color={colors.errorInk} style={styles.flex}>
        {message}
      </Text>
    </Animated.View>
  );
}

export function AiConsentSheet({
  visible,
  context,
  saving,
  error,
  onAllow,
  onNotNow,
  onClosed,
}: {
  visible: boolean;
  context: ConsentContext;
  saving: boolean;
  error: string | null;
  onAllow: () => void;
  onNotNow: () => void;
  /** The sheet has slid away (the next modal may open). */
  onClosed?: () => void;
}) {
  const copy = consentCopy(context, CONSENT_PLATFORM);
  return (
    <Sheet
      visible={visible}
      onClose={onNotNow}
      onClosed={onClosed}
      dismissible={!saving}
      eyebrow={copy.eyebrow}
      title={copy.title}
      footer={
        <View style={styles.footer}>
          <ConsentError message={error} />
          <Button
            label={copy.allow}
            icon="check"
            variant="energy"
            size="lg"
            block
            loading={saving}
            haptic="firm"
            onPress={onAllow}
            accessibilityHint="Lets ÖRZA send what each AI feature needs to OpenAI"
          />
          {/* Full width under Allow, like the app's other two-choice footers — not a stray label at the left edge. */}
          <Button label={copy.notNow} variant="ghost" block onPress={onNotNow} disabled={saving} />
        </View>
      }
    >
      <AiFlow context={context} />
      <ConsentPoints copy={copy} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  body: { gap: spacing.lg },
  points: { gap: spacing.md },
  point: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  pointIcon: { width: 32, height: 32, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.energyBg },
  after: { gap: spacing.sm },
  link: { alignSelf: 'flex-start', marginLeft: -spacing.sm },
  flow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.md, marginBottom: spacing.xs },
  flowTile: { width: 52, height: 52, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  flowFeature: { backgroundColor: colors.energyBg, borderColor: 'rgba(194,65,12,0.16)' },
  flowAi: { backgroundColor: colors.violet50, borderColor: 'rgba(110,62,214,0.18)' },
  flowLine: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  flowDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.hairlineStrong },
  footer: { gap: spacing.xs },
  error: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    marginBottom: spacing.xs,
    borderRadius: radii.sm,
    backgroundColor: colors.errorBg,
  },
});
