/** Health screen note: steps now count by themselves on Today (this phone, or the health store when it has more). */
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import type { HealthPlatform } from '@/lib/health/types';
import { colors, spacing } from '@/theme';
import { Button, GlassCard, Icon, Text } from '@/ui';

export function StepsAutoCard({ platform, connected }: { platform: HealthPlatform; connected: boolean }) {
  const body =
    platform === 'android'
      ? connected
        ? 'Today counts your steps live with this phone’s step counter and Health Connect — whichever counted more (a watch, Samsung Health, Google Fit) — and saves them for you. No typing needed.'
        : 'Today counts your steps live with this phone’s step counter and saves them for you — no typing needed. Connect Health Connect above to include a watch or other fitness apps.'
      : platform === 'ios'
        ? connected
          ? 'Today counts your steps live from your iPhone and Apple Health — whichever counted more, so your Apple Watch is included — and saves them for you. No typing needed.'
          : 'Today counts your steps live from your iPhone and saves them for you — no typing needed. Connect Apple Health above to include your Apple Watch.'
        : 'In the ÖRZA phone app, Today counts your steps automatically — no typing needed.';
  return (
    <GlassCard padding={spacing.lg}>
      <View style={styles.row}>
        <View style={styles.disc}>
          <Icon name="mci:shoe-print" size={20} color={colors.energyInk} />
        </View>
        <View style={styles.flex}>
          <Text variant="label" tone="ink">
            Steps now count automatically
          </Text>
          <Text variant="caption" tone="muted" style={styles.body}>
            {body}
          </Text>
        </View>
      </View>
      {platform !== 'none' ? (
        <Button label="See today’s steps" variant="ghost" size="sm" iconRight="arrow-up-right" onPress={() => router.navigate('/')} style={styles.link} />
      ) : null}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  flex: { flex: 1, minWidth: 0 },
  disc: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.energyBg },
  body: { marginTop: 2 },
  link: { alignSelf: 'flex-start', marginTop: spacing.sm },
});
