import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInUp,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import type { PlanSummary } from '@/lib/onboarding';
import { colors, radii, spacing } from '@/theme';
import { EnergyRing, GlassCard, Icon, Orb, Text, type IconName } from '@/ui';

/** One rendered line of the conversation. */
export interface ChatItem {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  /** Friendly validation nudge (answer not accepted). */
  tone?: 'hint';
  summary?: PlanSummary;
  /** Restored from history — appears without animation. */
  instant?: boolean;
}

function Paragraphs({ text, color }: { text: string; color: string }) {
  const parts = text.split(/\n{2,}/).filter((p) => p.trim());
  return (
    <View style={styles.paragraphs}>
      {parts.map((p, i) => (
        <Text key={i} variant="callout" color={color}>
          {p.trim()}
        </Text>
      ))}
    </View>
  );
}

export function Avatar() {
  return (
    <View style={styles.avatar}>
      <Orb size={48} tone="light" orbits={false} paused style={styles.avatarOrb} />
    </View>
  );
}

export function Bubble({ item }: { item: ChatItem }) {
  const mine = item.role === 'user';
  const entering = item.instant ? undefined : mine ? FadeInUp.springify().damping(18).stiffness(200) : FadeInDown.springify().damping(18).stiffness(160);
  if (item.summary) {
    return (
      <Animated.View entering={entering} style={styles.rowAssistant}>
        <Avatar />
        <View style={styles.summaryCol}>
          {item.content ? (
            <View style={[styles.bubble, styles.assistant]}>
              <Paragraphs text={item.content} color={colors.ink} />
            </View>
          ) : null}
          <SummaryCard summary={item.summary} />
        </View>
      </Animated.View>
    );
  }
  return (
    <Animated.View entering={entering} style={mine ? styles.rowUser : styles.rowAssistant} accessibilityLabel={`${mine ? 'You' : 'ÖRZA'}: ${item.content}`}>
      {mine ? null : <Avatar />}
      <View style={[styles.bubble, mine ? styles.user : styles.assistant, item.tone === 'hint' && styles.hint]}>
        <Paragraphs text={item.content} color={mine ? colors.inverse : colors.ink} />
      </View>
    </Animated.View>
  );
}

function Dot({ t, delay }: { t: SharedValue<number>; delay: number }) {
  const style = useAnimatedStyle(() => {
    const phase = (t.get() * 3 - delay + 3) % 3;
    const up = phase < 1 ? Math.sin(phase * Math.PI) : 0;
    return { transform: [{ translateY: -4 * up }], opacity: 0.35 + up * 0.65 };
  });
  return <Animated.View style={[styles.dot, style]} />;
}

export function Typing() {
  const reduce = useReducedMotion();
  const t = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    t.set(withRepeat(withTiming(1, { duration: 1050 }), -1));
  }, [reduce, t]);
  return (
    <Animated.View entering={FadeIn.duration(180)} style={styles.rowAssistant} accessibilityLabel="ÖRZA is typing">
      <Avatar />
      <View style={[styles.bubble, styles.assistant, styles.typing]}>
        <Dot t={t} delay={0} />
        <Dot t={t} delay={1} />
        <Dot t={t} delay={2} />
      </View>
    </Animated.View>
  );
}

/* ───────────────────────────── Plan summary card ───────────────────────────── */

const MACROS = [
  { key: 'protein_g', label: 'Protein', dot: colors.coral },
  { key: 'carbs_g', label: 'Carbs', dot: colors.amber },
  { key: 'fat_g', label: 'Fat', dot: colors.pink },
] as const;

export function SummaryCard({ summary }: { summary: PlanSummary }) {
  const t = summary.targets;
  const extras: { icon: IconName; label: string; value: string }[] = [
    { icon: 'mci:water-outline', label: 'Water', value: `${t.water_glasses} glasses` },
    { icon: 'mci:shoe-print', label: 'Steps', value: t.steps.toLocaleString('en-IN') },
    { icon: 'mci:barley', label: 'Fibre', value: `${t.fiber_g} g` },
  ];
  return (
    <GlassCard tone="strong" glow padding={spacing.lg} radius={radii.lg} style={styles.summary}>
      <Text variant="eyebrow" tone="subtle">
        Your starting plan
      </Text>
      <View style={styles.energyRow}>
        <EnergyRing progress={1} size={92} stroke={8} accessibilityLabel={`About ${t.calories} kilocalories a day`}>
          <Icon name="zap" size={20} color={colors.energyInk} />
        </EnergyRing>
        <View style={styles.energyText}>
          <Text variant="stat">{t.calories.toLocaleString('en-IN')}</Text>
          <Text variant="small" tone="muted">
            kcal a day
          </Text>
        </View>
      </View>
      <Text variant="small" tone="muted">
        {summary.goal_line}
      </Text>
      <View style={styles.macros}>
        {MACROS.map((m) => (
          <View key={m.key} style={styles.macro}>
            <View style={styles.macroLabel}>
              <View style={[styles.macroDot, { backgroundColor: m.dot }]} />
              <Text variant="eyebrow" tone="subtle" style={styles.macroEyebrow}>
                {m.label}
              </Text>
            </View>
            <Text variant="title">
              {t[m.key]}
              <Text variant="caption" tone="subtle">
                {' '}
                g
              </Text>
            </Text>
          </View>
        ))}
      </View>
      <View style={styles.extras}>
        {extras.map((e) => (
          <View key={e.label} style={styles.extra}>
            <Icon name={e.icon} size={15} color={colors.cyan600} />
            <Text variant="caption" tone="subtle">
              {e.label}
            </Text>
            <Text variant="caption" weight="semibold">
              {e.value}
            </Text>
          </View>
        ))}
      </View>
      {summary.facts.length ? (
        <View style={styles.facts}>
          <Text variant="eyebrow" tone="subtle" style={styles.macroEyebrow}>
            Based on
          </Text>
          <View style={styles.factWrap}>
            {summary.facts.map((f) => (
              <View key={f.label} style={styles.fact}>
                <Text variant="caption" tone="subtle">
                  {f.label}:{' '}
                  <Text variant="caption" weight="medium">
                    {f.value}
                  </Text>
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
      <Text variant="small" style={styles.note}>
        These are gentle starting points — you can fine-tune them anytime in Settings. Shall I save this?
      </Text>
      <Text variant="caption" tone="subtle">
        ÖRZA offers general wellness guidance, not medical advice.
      </Text>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  rowAssistant: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, marginBottom: spacing.md, paddingRight: spacing.xxl },
  rowUser: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: spacing.md, paddingLeft: spacing.huge },
  avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.hairline, overflow: 'hidden' },
  avatarOrb: { margin: -8 },
  bubble: { paddingHorizontal: 16, paddingVertical: 11, borderRadius: 22, flexShrink: 1 },
  assistant: { backgroundColor: colors.glassSolid, borderWidth: 1, borderColor: colors.hairline, borderBottomLeftRadius: 6 },
  user: { backgroundColor: colors.ink, borderBottomRightRadius: 6 },
  hint: { backgroundColor: colors.warningBg, borderColor: 'rgba(176,106,0,0.2)' },
  paragraphs: { gap: 8 },
  typing: { flexDirection: 'row', gap: 5, paddingVertical: 16, paddingHorizontal: 18 },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors.muted },
  summaryCol: { flex: 1, gap: spacing.sm },
  summary: { gap: spacing.md },
  energyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  energyText: { flex: 1 },
  macros: { flexDirection: 'row', gap: spacing.sm },
  macro: { flex: 1, padding: 10, borderRadius: radii.sm, borderWidth: 1, borderColor: colors.divider, backgroundColor: 'rgba(255,255,255,0.7)' },
  macroLabel: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 2 },
  macroDot: { width: 6, height: 6, borderRadius: 3 },
  macroEyebrow: { fontSize: 9.5, letterSpacing: 1 },
  extras: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.lg, rowGap: 6 },
  extra: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  facts: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairlineStrong, paddingTop: spacing.md, gap: 8 },
  factWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  fact: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.hairline, backgroundColor: 'rgba(255,255,255,0.75)' },
  note: { marginTop: 2 },
});
