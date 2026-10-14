/**
 * Icons: Feather (thin strokes like the web's lucide set) with MaterialCommunityIcons for the few glyphs
 * Feather lacks (pill, food, etc.). Both fonts are preloaded in `src/lib/fonts.ts`.
 */
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

import { colors } from '@/theme';

export type FeatherName = ComponentProps<typeof Feather>['name'];
export type MciName = ComponentProps<typeof MaterialCommunityIcons>['name'];

/** `"camera"` = Feather; `"mci:pill"` = MaterialCommunityIcons. */
export type IconName = FeatherName | `mci:${MciName}`;

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
}

export function Icon({ name, size = 20, color = colors.ink }: IconProps) {
  if (typeof name === 'string' && name.startsWith('mci:')) {
    return <MaterialCommunityIcons name={name.slice(4) as MciName} size={size} color={color} accessibilityElementsHidden importantForAccessibility="no" />;
  }
  return <Feather name={name as FeatherName} size={size} color={color} accessibilityElementsHidden importantForAccessibility="no" />;
}
