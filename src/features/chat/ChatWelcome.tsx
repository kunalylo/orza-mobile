/** Welcome screen for a fresh conversation: the landing-page prompts as chips, plus the quick actions. */
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';

import { colors, radii, spacing } from '@/theme';
import { Icon, Orb, PressableScale, Text, type IconName } from '@/ui';

import { QUICK_ACTIONS, STARTER_PROMPTS, type QuickAction, type StarterPrompt } from './prompts';

export function PromptChip({
  label,
  icon,
  onPress,
  disabled,
  hint,
  compact,
}: {
  label: string;
  icon: IconName;
  onPress: () => void;
  disabled?: boolean;
  hint?: string;
  compact?: boolean;
}) {
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      haptic="soft"
      scaleTo={0.95}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !!disabled }}
      style={[styles.chip, compact && styles.chipCompact, disabled && styles.disabled]}
    >
      <Icon name={icon} size={compact ? 13 : 14} color={colors.cyan600} />
      <Text variant={compact ? 'caption' : 'small'} weight="medium" style={styles.chipText}>
        {label}
      </Text>
    </PressableScale>
  );
}

/** Horizontal quick-action strip shown above the composer once a conversation has started. */
export function QuickActionStrip({ onAction, busy }: { onAction: (a: QuickAction) => void; busy: boolean }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.strip}
      style={styles.stripWrap}
      accessibilityLabel="Quick actions"
    >
      {QUICK_ACTIONS.map((a) => (
        <PromptChip
          key={a.label}
          compact
          label={a.label}
          icon={a.icon}
          disabled={busy && !!a.prompt}
          onPress={() => onAction(a)}
          hint={a.prompt ? 'Asks ÖRZA straight away' : 'Adds a starter to your message'}
        />
      ))}
    </ScrollView>
  );
}

export function ChatWelcome({
  firstName,
  onPick,
  onQuickAction,
  busy,
}: {
  firstName?: string;
  onPick: (p: StarterPrompt) => void;
  onQuickAction: (a: QuickAction) => void;
  busy: boolean;
}) {
  const reduce = useReducedMotion();
  const rise = (delay: number) => (reduce ? undefined : FadeInDown.delay(delay).springify().damping(18).stiffness(100).mass(1));

  return (
    <ScrollView
      contentContainerStyle={styles.wrap}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
    >
      <Animated.View entering={rise(0)} style={styles.orb}>
        <Orb size={128} tone="light" orbits={false} active={busy} />
      </Animated.View>
      <Animated.View entering={rise(70)} style={styles.head}>
        <Text variant="eyebrow" tone="subtle" align="center">
          {firstName ? `Namaste, ${firstName}` : 'Namaste'}
        </Text>
        <Text variant="h1" align="center" accessibilityRole="header" style={styles.title}>
          How can I help today?
        </Text>
        <Text variant="callout" tone="muted" align="center" style={styles.body}>
          Ask me about meals, recipes, wellness tips, or just chat about your health goals. Type or speak in English, Hindi or Hinglish
          — tell me what you ate and I&apos;ll log it.
        </Text>
      </Animated.View>

      <Animated.View entering={rise(140)} style={styles.chips} accessibilityLabel="Try asking">
        {STARTER_PROMPTS.map((p) => (
          <PromptChip
            key={p.text}
            label={p.text}
            icon={p.send ? 'mci:star-four-points-outline' : 'edit-3'}
            disabled={busy && p.send}
            onPress={() => onPick(p)}
            hint={p.send ? 'Asks ÖRZA straight away' : 'Adds it to your message so you can edit before sending'}
          />
        ))}
      </Animated.View>

      <Animated.View entering={rise(210)} style={styles.quick}>
        <View style={styles.divider} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={styles.rule} />
          <Text variant="eyebrow" tone="subtle" style={styles.dividerText}>
            Quick actions
          </Text>
          <View style={styles.rule} />
        </View>
        <View style={styles.chips} accessibilityLabel="Quick actions">
          {QUICK_ACTIONS.map((a) => (
            <PromptChip
              key={a.label}
              compact
              label={a.label}
              icon={a.icon}
              disabled={busy && !!a.prompt}
              onPress={() => onQuickAction(a)}
              hint={a.prompt ? 'Asks ÖRZA straight away' : 'Adds a starter to your message'}
            />
          ))}
        </View>
      </Animated.View>

      <Text variant="caption" tone="subtle" align="center" style={styles.note}>
        Wellness guidance, not medical advice. For medical concerns, please consult your doctor.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.xxl },
  orb: { alignSelf: 'center' },
  head: { marginTop: spacing.md, alignItems: 'center' },
  title: { marginTop: spacing.sm },
  body: { marginTop: spacing.md, maxWidth: 420 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.xxl },
  quick: { marginTop: spacing.sm },
  divider: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.xl },
  rule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.hairlineStrong },
  dividerText: { fontSize: 10 },
  note: { marginTop: spacing.xxl, paddingHorizontal: spacing.lg },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    maxWidth: '100%',
    minHeight: 40,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: 'rgba(255,255,255,0.72)',
  },
  chipCompact: { minHeight: 34, paddingHorizontal: 12, paddingVertical: 6, gap: 6 },
  chipText: { flexShrink: 1 },
  disabled: { opacity: 0.5 },
  stripWrap: { flexGrow: 0, marginHorizontal: -spacing.lg },
  strip: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
});
