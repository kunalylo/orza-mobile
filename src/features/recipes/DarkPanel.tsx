/** Dark ÖRZA hero panel with the energy orb glowing from a corner (Recipes "Cooking for you", Rebalance cards). */
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, gradients, radii, spacing } from '@/theme';
import { Orb } from '@/ui';

export function DarkPanel({
  children,
  orb = 'top-right',
  style,
  accessibilityLabel,
}: {
  children: ReactNode;
  orb?: 'top-right' | 'bottom-right';
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  return (
    <View style={[styles.panel, style]} accessibilityLabel={accessibilityLabel}>
      <LinearGradient colors={gradients.hero} style={StyleSheet.absoluteFill} pointerEvents="none" />
      <View pointerEvents="none" style={[styles.orb, orb === 'top-right' ? styles.orbTop : styles.orbBottom]} importantForAccessibility="no-hide-descendants">
        <Orb size={230} tone="dark" orbits={false} />
      </View>
      <LinearGradient colors={['rgba(7,9,12,0)', 'rgba(11,15,20,0.55)']} style={StyleSheet.absoluteFill} pointerEvents="none" />
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderRadius: radii.xl,
    overflow: 'hidden',
    backgroundColor: colors.hero,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    boxShadow: '0px 18px 60px rgba(20,20,20,0.16)',
  },
  orb: { position: 'absolute', opacity: 0.85 },
  orbTop: { right: -95, top: -105 },
  orbBottom: { right: -95, bottom: -110 },
  content: { padding: spacing.xl },
});
