import { LinearGradient } from 'expo-linear-gradient';
import { router, type Href } from 'expo-router';
import type { ReactNode } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { useAuth, useSignedInUser } from '@/lib/auth';
import { APP_VERSION } from '@/lib/config';
import { haptics } from '@/lib/haptics';
import { colors, diagonal, gradients, radii, spacing } from '@/theme';
import { Button, GlassCard, Icon, Screen, ScreenHeader, Tag, Text, type IconName } from '@/ui';

interface Item {
  href: Href;
  title: string;
  subtitle: string;
  icon: IconName;
  tint: string;
  bg: string;
}

const warm = { tint: colors.energyInk, bg: colors.energyBg };
const cool = { tint: colors.cyan700, bg: colors.cyan50 };
const violet = { tint: colors.violet600, bg: colors.violet50 };

const SECTIONS: { title: string; items: Item[] }[] = [
  {
    title: 'Your coach',
    items: [
      { href: '/ask', title: 'Ask ÖRZA', subtitle: 'Chat about food, habits and your plan', icon: 'mci:chat-processing-outline', ...warm },
      { href: '/goals', title: 'Goals', subtitle: 'Weight goal, pace and targets', icon: 'mci:target', ...warm },
      { href: '/recipes', title: 'Recipes', subtitle: 'Ideas that fit your diet and region', icon: 'mci:chef-hat', ...warm },
      { href: '/rebalance', title: 'Rebalance', subtitle: 'Gently even out a heavy day', icon: 'mci:scale-balance', ...violet },
      { href: '/reports', title: 'Reports', subtitle: 'Weekly trends and insights', icon: 'mci:chart-box-outline', ...violet },
    ],
  },
  {
    title: 'Care & connections',
    items: [
      { href: '/health', title: 'Health sync', subtitle: 'Steps, sleep and heart rate from your phone', icon: 'mci:heart-pulse', ...cool },
      { href: '/calendar', title: 'Calendar', subtitle: 'Your plans and medicine times together', icon: 'mci:calendar-month-outline', ...cool },
      { href: '/reminders', title: 'Reminders', subtitle: 'Water, meals, walks — your way', icon: 'mci:bell-ring-outline', ...cool },
    ],
  },
  {
    title: 'Account',
    items: [
      { href: '/credits', title: 'AI credits', subtitle: 'Balance and top-ups', icon: 'mci:lightning-bolt-outline', ...warm },
      { href: '/settings', title: 'Settings', subtitle: 'Profile, targets, privacy and data', icon: 'mci:cog-outline', tint: colors.ink, bg: 'rgba(20,20,20,0.05)' },
    ],
  },
];

function Row({ item, last, trailing }: { item: Item; last: boolean; trailing?: ReactNode }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item.title}
      accessibilityHint={item.subtitle}
      onPress={() => {
        haptics.tap();
        router.push(item.href);
      }}
      style={({ pressed }) => [styles.row, !last && styles.rowDivider, pressed && styles.rowPressed]}
    >
      <View style={[styles.rowIcon, { backgroundColor: item.bg }]}>
        <Icon name={item.icon} size={20} color={item.tint} />
      </View>
      <View style={styles.rowText}>
        <Text variant="title" numberOfLines={1}>
          {item.title}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={2}>
          {item.subtitle}
        </Text>
      </View>
      {trailing}
      <Icon name="chevron-right" size={18} color={colors.subtle} />
    </Pressable>
  );
}

export default function More() {
  const user = useSignedInUser();
  const { signOut } = useAuth();
  const initial = (user.name || user.email).trim().charAt(0).toUpperCase() || 'Ö';

  const confirmSignOut = () => {
    haptics.warning();
    Alert.alert('Sign out of ÖRZA?', 'Medicine alarms on this phone stop until you sign in again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ]);
  };

  return (
    <Screen backdrop="orb" tabBar>
      <ScreenHeader eyebrow="ÖRZA" title="More" />

      <Animated.View entering={FadeInDown.springify().damping(18)}>
        <GlassCard glow onPress={() => router.push('/settings')} accessibilityLabel={`${user.name}, ${user.email}. Open settings`} style={styles.account}>
          <View style={styles.avatar}>
            <LinearGradient colors={gradients.energy} start={diagonal.start} end={diagonal.end} style={StyleSheet.absoluteFill} />
            <Text variant="h2" color={colors.white}>
              {initial}
            </Text>
          </View>
          <View style={styles.accountText}>
            <Text variant="title" numberOfLines={1}>
              {user.name}
            </Text>
            <Text variant="small" tone="muted" numberOfLines={1}>
              {user.email}
            </Text>
          </View>
          <Tag label={`${user.credits ?? 0} credits`} tone="energy" icon="zap" />
        </GlassCard>
      </Animated.View>

      {SECTIONS.map((section, si) => (
        <Animated.View key={section.title} entering={FadeInDown.delay(80 + si * 70).springify().damping(18)} style={styles.section}>
          <Text variant="eyebrow" tone="subtle" style={styles.sectionTitle}>
            {section.title}
          </Text>
          <GlassCard padding={0}>
            {section.items.map((item, i) => (
              <Row key={item.title} item={item} last={i === section.items.length - 1} />
            ))}
          </GlassCard>
        </Animated.View>
      ))}

      <Button label="Sign out" icon="log-out" variant="secondary" block onPress={confirmSignOut} style={styles.signOut} />
      <Text variant="caption" tone="subtle" align="center" style={styles.version}>
        ÖRZA {APP_VERSION} · Wellness guidance, not medical advice
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  account: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg },
  avatar: { width: 52, height: 52, borderRadius: 26, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  accountText: { flex: 1, minWidth: 0 },
  section: { marginTop: spacing.xxl },
  sectionTitle: { marginBottom: spacing.sm, marginLeft: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: 14, minHeight: 64 },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hairlineStrong },
  rowPressed: { backgroundColor: 'rgba(20,20,20,0.04)' },
  rowIcon: { width: 40, height: 40, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, minWidth: 0 },
  signOut: { marginTop: spacing.xxxl },
  version: { marginTop: spacing.lg },
});
