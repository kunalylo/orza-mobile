import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';

import { colors, typography, type TypographyVariant } from '@/theme';

export type TextTone =
  | 'ink'
  | 'text'
  | 'muted'
  | 'subtle'
  | 'inverse'
  | 'heroMuted'
  | 'heroSubtle'
  | 'energy'
  | 'cyan'
  | 'violet'
  | 'success'
  | 'warning'
  | 'error';

const toneColor: Record<TextTone, string> = {
  ink: colors.ink,
  text: colors.text,
  muted: colors.muted,
  subtle: colors.subtle,
  inverse: colors.inverse,
  heroMuted: colors.heroMuted,
  heroSubtle: colors.heroSubtle,
  energy: colors.energyInk,
  cyan: colors.cyan700,
  violet: colors.violet600,
  success: colors.success,
  warning: colors.warning,
  error: colors.error,
};

/** Big display type gets a lower font-scale cap so headlines never break the layout at large accessibility sizes. */
const scaleCap: Partial<Record<TypographyVariant, number>> = {
  display: 1.25,
  h1: 1.3,
  h2: 1.35,
  stat: 1.3,
  eyebrow: 1.4,
};

export interface TextProps extends RNTextProps {
  variant?: TypographyVariant;
  tone?: TextTone;
  /** Overrides `tone` with any colour. */
  color?: string;
  align?: TextStyle['textAlign'];
  italic?: boolean;
  weight?: 'regular' | 'medium' | 'semibold' | 'bold';
}

const bodyWeights = {
  regular: 'Figtree_400Regular',
  medium: 'Figtree_500Medium',
  semibold: 'Figtree_600SemiBold',
  bold: 'Figtree_700Bold',
} as const;

/**
 * Brand text: `display/h1/h2/h3` (Playfair Display), `title/body/callout/small/label/caption` (Figtree),
 * `eyebrow/mono` (JetBrains Mono, uppercase eyebrows).
 */
export function Text({ variant = 'body', tone = 'ink', color, align, italic, weight, style, maxFontSizeMultiplier, ...rest }: TextProps) {
  const base = typography[variant];
  const isDisplay = base.fontFamily.startsWith('Playfair');
  const family = italic && isDisplay ? 'PlayfairDisplay_600SemiBold_Italic' : weight && !isDisplay && variant !== 'eyebrow' && variant !== 'mono' ? bodyWeights[weight] : base.fontFamily;
  return (
    <RNText
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? scaleCap[variant] ?? 1.6}
      style={[base, { color: color ?? toneColor[tone], fontFamily: family }, align ? { textAlign: align } : null, style]}
      {...rest}
    />
  );
}
