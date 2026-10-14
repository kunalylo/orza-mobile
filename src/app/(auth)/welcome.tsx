import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { useAuth } from '@/lib/auth';
import { colors, spacing } from '@/theme';
import { Button, Icon, Orb, Screen, Text } from '@/ui';

const enter = (i: number) => FadeInDown.delay(180 + i * 90).springify().damping(18).stiffness(140);

const SIGNALS = [
  { icon: 'mci:silverware-fork-knife', value: '450 kcal', label: 'Lunch' },
  { icon: 'mci:pill', value: '8:00 am', label: 'Next dose' },
  { icon: 'mci:water-outline', value: '6 / 8', label: 'Water' },
] as const;

/** Dark ÖRZA hero with the living orb, the website's promise, and the two ways in. */
export default function Welcome() {
  const { width, height } = useWindowDimensions();
  const { sessionExpired } = useAuth();
  const compact = height < 700;
  const orbSize = Math.round(Math.min(width * 0.8, height * (compact ? 0.28 : 0.4), 360));

  // The server ended the session (401): go straight to sign-in, which explains why.
  useEffect(() => {
    if (sessionExpired) router.push('/sign-in');
  }, [sessionExpired]);

  return (
    <Screen backdrop="hero" contentContainerStyle={styles.content}>
      <StatusBar style="light" />
      <Animated.View entering={FadeIn.duration(500)} style={styles.brandRow}>
        <Text variant="h3" tone="inverse" style={styles.wordmark}>
          ÖRZA
        </Text>
        <View style={styles.pill}>
          <Icon name="zap" size={11} color={colors.cyan400} />
          <Text variant="eyebrow" tone="heroMuted" style={styles.pillText}>
            AI wellness
          </Text>
        </View>
      </Animated.View>

      <Animated.View entering={FadeIn.duration(900)} style={[styles.orbWrap, { height: orbSize }]}>
        <Orb size={orbSize} tone="dark" />
      </Animated.View>

      <View style={[styles.signals, compact && styles.hidden]}>
        {SIGNALS.map((s, i) => (
          <Animated.View key={s.label} entering={FadeInDown.delay(500 + i * 110).springify().damping(16)} style={styles.signal}>
            <Icon name={s.icon} size={14} color={i === 1 ? colors.violet300 : i === 2 ? colors.cyan300 : colors.amber} />
            <View style={styles.signalText}>
              <Text variant="label" tone="inverse" numberOfLines={1} style={styles.signalValue}>
                {s.value}
              </Text>
              <Text variant="caption" tone="heroSubtle" numberOfLines={1}>
                {s.label}
              </Text>
            </View>
          </Animated.View>
        ))}
      </View>

      <View style={styles.copy}>
        <Animated.View entering={enter(0)}>
          <Text variant="display" tone="inverse" accessibilityRole="header" style={compact ? styles.headlineCompact : undefined}>
            Your health,{' '}
            <Text variant="display" italic color={colors.coral} style={compact ? styles.headlineCompact : undefined}>
              reimagined
            </Text>
          </Text>
          <Text variant="h2" color="rgba(255,231,200,0.94)" style={styles.lineTwo}>
            by AI that evolves with you
          </Text>
        </Animated.View>
        <Animated.View entering={enter(1)}>
          <Text variant="callout" tone="heroMuted" style={styles.body}>
            Snap your meals, chat naturally, get instant nutritional insights. AI that learns your lifestyle, respects your choices, and helps you
            thrive — judgment-free.
          </Text>
        </Animated.View>
      </View>

      <Animated.View entering={enter(2)} style={styles.actions}>
        <Button label="Get started" iconRight="arrow-right" variant="energy" size="lg" block onPress={() => router.push('/sign-up')} />
        <Button label="I have an account" variant="heroOutline" size="lg" block onPress={() => router.push('/sign-in')} />
        <Text variant="eyebrow" tone="heroSubtle" align="center" style={styles.langs}>
          English · Hindi · Hinglish
        </Text>
      </Animated.View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { justifyContent: 'space-between', paddingTop: spacing.md },
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  wordmark: { letterSpacing: 1.5 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.heroGlassBorder,
    backgroundColor: colors.heroGlass,
  },
  pillText: { fontSize: 10, lineHeight: 12 },
  orbWrap: { alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm },
  signals: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  hidden: { display: 'none' },
  signal: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.heroGlassBorder,
    backgroundColor: colors.heroGlass,
  },
  signalText: { flex: 1, minWidth: 0 },
  signalValue: { fontSize: 13 },
  copy: { marginTop: spacing.xxl },
  headlineCompact: { fontSize: 34, lineHeight: 40 },
  lineTwo: { marginTop: 2 },
  body: { marginTop: spacing.md },
  actions: { gap: spacing.md, marginTop: spacing.xxl },
  langs: { marginTop: spacing.xs },
});
