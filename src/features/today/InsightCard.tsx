/**
 * "ÖRZA says" — the day's one-liner on the dark hero glass with the glowing amber → coral → pink orb.
 */
import { LinearGradient } from 'expo-linear-gradient';
import { useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, useReducedMotion } from 'react-native-reanimated';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { colors, gradients, radii, shadows, spacing } from '@/theme';
import { Icon, Orb, PressableScale, Text } from '@/ui';

/** Cool cyan light top-left, violet bottom-right (like the web's ambient hero light). */
function Ambient() {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <RadialGradient id={`c${id}`} cx="10%" cy="0%" rx="60%" ry="70%">
          <Stop offset="0" stopColor="#2FD2F0" stopOpacity={0.16} />
          <Stop offset="1" stopColor="#07090C" stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id={`v${id}`} cx="90%" cy="100%" rx="60%" ry="70%">
          <Stop offset="0" stopColor="#BFA8FF" stopOpacity={0.18} />
          <Stop offset="1" stopColor="#07090C" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect width="100%" height="100%" fill={`url(#c${id})`} />
      <Rect width="100%" height="100%" fill={`url(#v${id})`} />
    </Svg>
  );
}

export function InsightCard({ insight, onTalk }: { insight: string | null; onTalk: () => void }) {
  const reduce = useReducedMotion();
  return (
    <View style={styles.card} accessibilityLabel="ÖRZA says">
      <LinearGradient colors={gradients.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <Ambient />
      <View style={styles.orb} pointerEvents="none">
        <Orb size={170} tone="dark" orbits={false} paused={reduce} />
      </View>

      <View style={styles.head}>
        <View style={styles.dotRing}>
          <LinearGradient colors={gradients.energy} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.dot} />
        </View>
        <Text variant="eyebrow" tone="heroSubtle">
          ÖRZA says
        </Text>
      </View>

      <View style={styles.body} accessibilityLiveRegion="polite">
        {insight == null ? (
          <View style={styles.skeleton}>
            <View style={[styles.line, { width: '100%' }]} />
            <View style={[styles.line, { width: '80%' }]} />
            <View style={[styles.line, { width: '62%' }]} />
          </View>
        ) : (
          <Animated.View key={insight} entering={reduce ? undefined : FadeIn.duration(360)} exiting={reduce ? undefined : FadeOut.duration(160)}>
            <Text variant="h3" color={colors.heroText} style={styles.quote}>
              “{insight}”
            </Text>
          </Animated.View>
        )}
      </View>

      <View style={styles.foot}>
        <PressableScale onPress={onTalk} haptic="soft" accessibilityRole="button" accessibilityLabel="Talk it through with ÖRZA" style={styles.talk}>
          <Text variant="label" color={colors.hero2}>
            Talk it through
          </Text>
          <Icon name="arrow-up-right" size={14} color={colors.hero2} />
        </PressableScale>
        <Text variant="caption" tone="heroSubtle" style={styles.flexShrink}>
          Wellness guidance, not medical advice.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flexShrink: { flexShrink: 1 },
  card: {
    borderRadius: radii.lg,
    overflow: 'hidden',
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.heroGlassBorder,
    backgroundColor: colors.hero,
    ...shadows.floating,
  },
  orb: { position: 'absolute', top: -58, right: -58, opacity: 0.95 },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  dotRing: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  dot: { width: 10, height: 10, borderRadius: 5, boxShadow: '0px 0px 12px rgba(255,180,84,0.85)' },
  body: { marginTop: spacing.lg, minHeight: 84, paddingRight: spacing.xxl },
  quote: { fontSize: 20, lineHeight: 29 },
  skeleton: { gap: spacing.sm, paddingTop: spacing.xs },
  line: { height: 14, borderRadius: 7, backgroundColor: 'rgba(255,255,255,0.1)' },
  foot: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, marginTop: spacing.xl },
  talk: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 40,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    backgroundColor: colors.white,
    boxShadow: '0px 14px 40px rgba(255,255,255,0.14)',
  },
});
