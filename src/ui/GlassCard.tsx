import { LinearGradient } from 'expo-linear-gradient';
import { useId, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import type { HapticKind } from '@/lib/haptics';
import { colors, gradients, radii, shadows, spacing } from '@/theme';

import { PressableScale } from './PressableScale';

export interface GlassCardProps extends Omit<ViewProps, 'style'> {
  children?: ReactNode;
  /**
   * `default` frosted white, `strong` more opaque, `energy` warm-tinted. `hero` is the solid dark ÖRZA hero surface for
   * light pages; `dark` is translucent glass for screens that already sit on the dark hero backdrop (it is nearly
   * invisible on a light page — white text on cream).
   */
  tone?: 'default' | 'strong' | 'dark' | 'hero' | 'energy';
  /** A soft warm glow in the top-right corner (like the web's plan cards). */
  glow?: boolean;
  padding?: number;
  radius?: number;
  onPress?: () => void;
  haptic?: HapticKind;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

function CornerGlow({ id }: { id: string }) {
  return (
    <View pointerEvents="none" style={styles.glow}>
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={colors.amber} stopOpacity={0.32} />
            <Stop offset="0.45" stopColor={colors.coral} stopOpacity={0.14} />
            <Stop offset="1" stopColor={colors.white} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

/** Frosted glass surface with a hairline border and soft depth. Pass `onPress` to make it a springy button. */
export function GlassCard({ children, tone = 'default', glow, padding = spacing.xl, radius = radii.lg, onPress, haptic, accessibilityLabel, style, ...rest }: GlassCardProps) {
  const glowId = `orza-glow-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const surface = [styles.base, toneStyle[tone], { padding, borderRadius: radius }, style];
  const content = (
    <>
      {tone === 'hero' ? <LinearGradient colors={gradients.hero} style={StyleSheet.absoluteFill} pointerEvents="none" /> : null}
      {glow ? <CornerGlow id={glowId} /> : null}
      {children}
    </>
  );
  if (onPress) {
    return (
      <PressableScale onPress={onPress} haptic={haptic ?? 'soft'} scaleTo={0.98} accessibilityLabel={accessibilityLabel} style={surface} {...rest}>
        {content}
      </PressableScale>
    );
  }
  return (
    <View style={surface} accessibilityLabel={accessibilityLabel} {...rest}>
      {content}
    </View>
  );
}

const toneStyle = StyleSheet.create({
  default: { backgroundColor: colors.glass, borderColor: colors.hairline, ...shadows.glass },
  strong: { backgroundColor: colors.glassSolid, borderColor: colors.hairline, ...shadows.glass },
  dark: { backgroundColor: colors.heroGlass, borderColor: colors.heroGlassBorder },
  hero: { backgroundColor: colors.hero, borderColor: 'rgba(255,255,255,0.08)', ...shadows.floating },
  energy: { backgroundColor: colors.energyBg, borderColor: 'rgba(255,122,106,0.22)', ...shadows.glass },
});

const styles = StyleSheet.create({
  base: { borderWidth: 1, overflow: 'hidden' },
  glow: { position: 'absolute', right: -70, top: -80, width: 220, height: 220 },
});
