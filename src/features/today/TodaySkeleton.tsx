/** First-load placeholder for the Today screen — mirrors the real layout so nothing jumps when data arrives. */
import { StyleSheet, View } from 'react-native';

import { radii, spacing } from '@/theme';
import { GlassCard, Skeleton } from '@/ui';

export function TodaySkeleton() {
  return (
    <View accessibilityLabel="Loading your day" accessible>
      <Skeleton height={102} radius={radii.md} />
      <GlassCard tone="strong" style={styles.gap}>
        <View style={styles.center}>
          <Skeleton circle height={190} />
        </View>
        <Skeleton height={12} width={110} style={styles.mtXl} />
        <Skeleton height={30} width={150} style={styles.mtSm} />
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={styles.mtMd}>
            <Skeleton height={12} width="40%" />
            <Skeleton height={7} radius={4} style={styles.mtXs} />
          </View>
        ))}
      </GlassCard>
      <Skeleton height={168} radius={radii.lg} style={styles.gap} />
      <View style={[styles.row, styles.gap]}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} height={118} radius={radii.md} style={styles.flex} />
        ))}
      </View>
      <Skeleton height={190} radius={radii.lg} style={styles.gap} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: spacing.sm },
  gap: { marginTop: spacing.lg },
  center: { alignItems: 'center' },
  mtXs: { marginTop: spacing.xs },
  mtSm: { marginTop: spacing.sm },
  mtMd: { marginTop: spacing.md },
  mtXl: { marginTop: spacing.xl },
});
