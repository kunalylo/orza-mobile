/**
 * Polished stand-in for screens that the feature streams (Phase B/C) fill in: header + a calm empty card.
 * Replace the whole screen file when the feature lands — nothing else depends on this component.
 */
import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { spacing } from '@/theme';
import { EmptyState, GlassCard, Screen, ScreenHeader, type IconName } from '@/ui';

export interface FeaturePlaceholderProps {
  title: string;
  eyebrow?: string;
  subtitle?: string;
  icon?: IconName;
  /** What this screen will do, in a sentence. */
  body: string;
  /** Card heading (default "<title> is on its way"). */
  cardTitle?: string;
  /** Tab root: large title, room for the tab bar, no back button. */
  tab?: boolean;
  /** Decorative layer drawn behind the header (e.g. a greeting orb, absolutely positioned). */
  decoration?: ReactNode;
}

export function FeaturePlaceholder({ title, eyebrow, subtitle, icon, body, cardTitle, tab, decoration }: FeaturePlaceholderProps) {
  return (
    <Screen backdrop="orb" tabBar={tab}>
      {decoration}
      <ScreenHeader back={!tab} eyebrow={eyebrow} title={title} subtitle={subtitle} large={tab} />
      <Animated.View entering={FadeInDown.delay(60).springify().damping(18)}>
        <GlassCard glow padding={spacing.sm} style={styles.card}>
          <EmptyState icon={icon} eyebrow="Coming in the next build step" title={cardTitle ?? `${title} is on its way`} body={body} />
        </GlassCard>
      </Animated.View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: spacing.xs },
});
