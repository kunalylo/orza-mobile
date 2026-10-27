/** The More tab's header card: avatar initial, name, email and the AI-credit balance. */
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Avatar, initialOf } from '@/features/settings/parts';
import { formatNumber } from '@/features/settings/options';
import { haptics } from '@/lib/haptics';
import type { PublicUser } from '@/lib/types';
import { colors, radii, spacing } from '@/theme';
import { GlassCard, Icon, Text } from '@/ui';

export function AccountCard({ user }: { user: PublicUser }) {
  const credits = user.credits ?? 0;
  const low = credits <= 5;
  return (
    <GlassCard
      tone="strong"
      glow
      padding={spacing.lg}
      onPress={() => router.push('/settings')}
      accessibilityLabel={`${user.name || 'You'}, ${user.email}. Open settings`}
      style={styles.card}
    >
      <View style={styles.top}>
        <Avatar initial={initialOf(user.name, user.email)} size={56} />
        <View style={styles.text}>
          <Text variant="h3" numberOfLines={1}>
            {user.name || 'You'}
          </Text>
          <Text variant="small" tone="muted" numberOfLines={1}>
            {user.email}
          </Text>
        </View>
        <Icon name="chevron-right" size={18} color={colors.subtle} />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${formatNumber(credits)} AI credits. Open AI credits`}
        hitSlop={6}
        onPress={() => {
          haptics.tap();
          router.push('/credits');
        }}
        style={({ pressed }) => [styles.credits, low && styles.creditsLow, pressed && styles.pressed]}
      >
        <Icon name="zap" size={14} color={low ? colors.warning : colors.energyInk} />
        <Text variant="label" color={low ? colors.warning : colors.energyInk}>
          {formatNumber(credits)} AI credits
        </Text>
        <Text variant="caption" tone="muted" style={styles.creditsHint} numberOfLines={2}>
          {low ? 'Running low — top up' : 'Balance & history'}
        </Text>
        <Icon name="arrow-up-right" size={14} color={colors.muted} />
      </Pressable>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  text: { flex: 1, minWidth: 0 },
  credits: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radii.pill,
    backgroundColor: colors.energyBg,
    borderWidth: 1,
    borderColor: 'rgba(255,122,106,0.28)',
  },
  creditsLow: { backgroundColor: colors.warningBg, borderColor: 'rgba(176,106,0,0.25)' },
  creditsHint: { flex: 1, textAlign: 'right' },
  pressed: { opacity: 0.75 },
});
