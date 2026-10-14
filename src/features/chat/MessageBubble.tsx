/** Conversation pieces: user / assistant bubbles, the inline "Logged" meal card, typing dots and day separators. */
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInUp,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { haptics } from '@/lib/haptics';
import { colors, diagonal, gradients, radii, spacing } from '@/theme';
import { Icon, PressableScale, Tag, Text, toast } from '@/ui';

import { MEAL_TYPE_LABEL, clockTime, formatNumber, grams, itemLabel, mealDateLabel } from './format';
import { RichText } from './RichText';
import type { Meal, UIMessage } from './types';

/**
 * The conversation is an inverted FlatList, whose cells are flipped vertically — so `FadeInUp` (which starts
 * above its final spot) appears to rise from below, like a new message should.
 */
const ENTER_USER = FadeInUp.springify().damping(18).stiffness(220);
const ENTER_ASSISTANT = FadeInUp.springify().damping(20).stiffness(160);

function OrzaLabel({ time }: { time?: string }) {
  return (
    <View style={styles.labelRow}>
      <View style={styles.labelLeft}>
        <LinearGradient colors={gradients.energy} {...diagonal} style={styles.labelDot} />
        <Text variant="eyebrow" color={colors.cyan600} style={styles.labelText}>
          ÖRZA
        </Text>
      </View>
      {time ? (
        <Text variant="mono" tone="subtle" style={styles.time}>
          {time}
        </Text>
      ) : null}
    </View>
  );
}

export function UserBubble({ message, onRetry, onGetCredits }: { message: UIMessage; onRetry?: (m: UIMessage) => void; onGetCredits?: () => void }) {
  const reduce = useReducedMotion();
  const failed = message.status === 'failed';
  const sending = message.status === 'sending';
  return (
    <Animated.View entering={message.fresh && !reduce ? ENTER_USER : undefined} style={styles.userRow}>
      <View
        style={[styles.bubble, styles.user, (sending || failed) && styles.dim]}
        accessible
        accessibilityLabel={`You: ${message.content}${failed ? '. Not sent.' : sending ? '. Sending.' : ''}`}
      >
        <Text variant="callout" color={colors.inverse} selectable>
          {message.content}
        </Text>
      </View>
      {failed ? (
        <View style={styles.failedRow} accessibilityLiveRegion="polite">
          <Icon name="alert-circle" size={14} color={colors.error} />
          <Text variant="caption" tone="error">
            Not sent
          </Text>
          {onGetCredits && message.failure?.needsCredits ? (
            <Pressable onPress={onGetCredits} hitSlop={8} accessibilityRole="button" style={styles.failedAction}>
              <Icon name="mci:lightning-bolt" size={14} color={colors.energyInk} />
              <Text variant="caption" weight="semibold" tone="energy">
                Get credits
              </Text>
            </Pressable>
          ) : null}
          {onRetry ? (
            <Pressable onPress={() => onRetry(message)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Retry sending" style={styles.failedAction}>
              <Icon name="rotate-ccw" size={13} color={colors.ink} />
              <Text variant="caption" weight="semibold">
                Retry
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : !sending ? (
        <Text variant="mono" tone="subtle" style={styles.userTime}>
          {clockTime(message.created_at)}
        </Text>
      ) : null}
    </Animated.View>
  );
}

export function AssistantBubble({ message }: { message: UIMessage }) {
  const reduce = useReducedMotion();
  const remembered = message.meta?.remembered ?? [];

  async function copy() {
    try {
      await Clipboard.setStringAsync(message.content);
      haptics.soft();
      toast.info('Reply copied');
    } catch {
      // clipboard unavailable — nothing to do
    }
  }

  return (
    <Animated.View entering={message.fresh && !reduce ? ENTER_ASSISTANT : undefined} style={styles.assistantRow}>
      <Pressable
        onLongPress={copy}
        delayLongPress={350}
        style={[styles.bubble, styles.assistant]}
        accessibilityHint="Long press to copy the reply"
      >
        <OrzaLabel time={clockTime(message.created_at)} />
        <RichText text={message.content} />
      </Pressable>
      {message.loggedMeal ? <LoggedMealCard meal={message.loggedMeal} /> : null}
      {remembered.length > 0 ? (
        <View style={styles.remembered}>
          <Icon name="mci:bookmark-check" size={15} color={colors.violet600} />
          <Text variant="caption" tone="muted">
            Remembered
          </Text>
          {remembered.map((f) => (
            <Tag key={f} label={f} tone="violet" />
          ))}
          <Pressable onPress={() => router.push('/settings')} hitSlop={8} accessibilityRole="link" accessibilityLabel="Manage what ÖRZA remembers">
            <Text variant="caption" tone="subtle" style={styles.underline}>
              Manage
            </Text>
          </Pressable>
        </View>
      ) : null}
      {message.notice ? (
        <View style={styles.notice}>
          <Icon name="info" size={13} color={colors.subtle} />
          <Text variant="caption" tone="subtle" style={styles.noticeText}>
            {message.notice}
          </Text>
        </View>
      ) : null}
    </Animated.View>
  );
}

/** Inline confirmation under a reply that logged a meal. */
export function LoggedMealCard({ meal }: { meal: Meal }) {
  const summary = meal.items.length ? meal.items.map(itemLabel).join(', ') : meal.description;
  const day = mealDateLabel(meal.date);
  const type = MEAL_TYPE_LABEL[meal.meal_type] ?? 'Meal';
  return (
    <PressableScale
      onPress={() => router.push('/meals')}
      haptic="soft"
      style={styles.mealCard}
      accessibilityRole="button"
      accessibilityLabel={`Logged ${type}${day !== 'Today' ? `, ${day}` : ''}: ${summary}, ${formatNumber(meal.totals.calories)} kcal`}
      accessibilityHint="Opens your meal log"
    >
      <LinearGradient colors={gradients.energy} {...diagonal} style={styles.mealDisc}>
        <Icon name="check" size={18} color={colors.white} />
      </LinearGradient>
      <View style={styles.mealBody}>
        <Text variant="eyebrow" tone="energy" style={styles.mealEyebrow} numberOfLines={1}>
          Logged · {type}
          {day !== 'Today' ? ` · ${day}` : ''}
        </Text>
        <Text variant="small" numberOfLines={2}>
          {summary}
        </Text>
        <Text variant="caption" tone="muted" style={styles.mealMacros}>
          P {grams(meal.totals.protein_g)} g · C {grams(meal.totals.carbs_g)} g · F {grams(meal.totals.fat_g)} g
        </Text>
      </View>
      <View style={styles.mealRight}>
        <Text variant="h3" style={styles.kcal}>
          {formatNumber(meal.totals.calories)}
        </Text>
        <Text variant="caption" tone="subtle">
          kcal
        </Text>
        <View style={styles.mealLink}>
          <Text variant="caption" weight="semibold" tone="cyan">
            Meal log
          </Text>
          <Icon name="arrow-up-right" size={12} color={colors.cyan700} />
        </View>
      </View>
    </PressableScale>
  );
}

function Dot({ t, delay }: { t: SharedValue<number>; delay: number }) {
  const style = useAnimatedStyle(() => {
    const phase = (t.get() * 3 - delay + 3) % 3;
    const up = phase < 1 ? Math.sin(phase * Math.PI) : 0;
    return { transform: [{ translateY: -3 * up }], opacity: 0.35 + up * 0.65 };
  });
  return <Animated.View style={[styles.dot, style]} />;
}

export function TypingIndicator() {
  const reduce = useReducedMotion();
  const t = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    t.set(withRepeat(withTiming(1, { duration: 1100 }), -1));
  }, [reduce, t]);
  return (
    <Animated.View entering={reduce ? undefined : FadeIn.duration(200)} style={styles.assistantRow} accessible accessibilityLabel="ÖRZA is typing" accessibilityLiveRegion="polite">
      <View style={[styles.bubble, styles.assistant, styles.typingBubble]}>
        <OrzaLabel />
        <View style={styles.dots}>
          <Dot t={t} delay={0} />
          <Dot t={t} delay={1} />
          <Dot t={t} delay={2} />
        </View>
      </View>
    </Animated.View>
  );
}

export function DaySeparator({ label }: { label: string }) {
  return (
    <View style={styles.separator} accessibilityRole="header" accessibilityLabel={label}>
      <View style={styles.rule} />
      <Text variant="eyebrow" tone="subtle" style={styles.separatorText}>
        {label}
      </Text>
      <View style={styles.rule} />
    </View>
  );
}

const styles = StyleSheet.create({
  userRow: { alignItems: 'flex-end', paddingLeft: spacing.huge, marginBottom: spacing.md },
  assistantRow: { alignItems: 'flex-start', paddingRight: spacing.lg, marginBottom: spacing.md },
  bubble: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 22, maxWidth: '100%' },
  user: { backgroundColor: colors.ink, borderBottomRightRadius: 6, boxShadow: '0px 10px 26px rgba(20,20,20,0.14)' },
  assistant: {
    backgroundColor: colors.glassSolid,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderTopLeftRadius: 6,
    boxShadow: '0px 10px 30px rgba(20,20,20,0.07)',
  },
  dim: { opacity: 0.72 },
  userTime: { marginTop: 4, marginRight: 4, fontSize: 10 },
  failedRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  failedAction: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radii.pill, backgroundColor: colors.glassStrong },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.lg, marginBottom: 6 },
  labelLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  labelDot: { width: 8, height: 8, borderRadius: 4 },
  labelText: { fontSize: 10, letterSpacing: 1.4 },
  time: { fontSize: 10 },
  remembered: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: spacing.sm },
  underline: { textDecorationLine: 'underline' },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 6 },
  noticeText: { flexShrink: 1 },
  mealCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: 'rgba(255,255,255,0.8)',
    boxShadow: '0px 10px 30px rgba(20,20,20,0.07)',
    alignSelf: 'stretch',
  },
  mealDisc: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  mealBody: { flex: 1, gap: 2 },
  mealEyebrow: { fontSize: 10, letterSpacing: 1.2 },
  mealMacros: { marginTop: 2, fontVariant: ['tabular-nums'] },
  mealRight: { alignItems: 'flex-end' },
  kcal: { fontVariant: ['tabular-nums'] },
  mealLink: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 4 },
  typingBubble: { minWidth: 92 },
  dots: { flexDirection: 'row', gap: 5, paddingVertical: 4 },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors.coral },
  separator: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginVertical: spacing.md },
  rule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.hairlineStrong },
  separatorText: { fontSize: 10 },
});
