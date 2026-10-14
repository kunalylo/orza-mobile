/**
 * Brand fonts (Google Fonts via @expo-google-fonts, imported per weight so only these files ship)
 * plus the icon fonts, loaded while the splash screen is up.
 */
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { Figtree_400Regular } from '@expo-google-fonts/figtree/400Regular';
import { Figtree_500Medium } from '@expo-google-fonts/figtree/500Medium';
import { Figtree_600SemiBold } from '@expo-google-fonts/figtree/600SemiBold';
import { Figtree_700Bold } from '@expo-google-fonts/figtree/700Bold';
import { JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono/500Medium';
import { PlayfairDisplay_600SemiBold } from '@expo-google-fonts/playfair-display/600SemiBold';
import { PlayfairDisplay_600SemiBold_Italic } from '@expo-google-fonts/playfair-display/600SemiBold_Italic';
import { PlayfairDisplay_700Bold } from '@expo-google-fonts/playfair-display/700Bold';
import { useFonts } from 'expo-font';

/** Keys are the `fontFamily` names used in `src/theme` (`fonts`). */
export const FONT_MAP = {
  PlayfairDisplay_600SemiBold,
  PlayfairDisplay_600SemiBold_Italic,
  PlayfairDisplay_700Bold,
  Figtree_400Regular,
  Figtree_500Medium,
  Figtree_600SemiBold,
  Figtree_700Bold,
  JetBrainsMono_500Medium,
  ...Feather.font,
  ...MaterialCommunityIcons.font,
};

/** `[ready]` once fonts loaded — or failed (system fonts then stand in; never block the app on fonts). */
export function useBrandFonts(): boolean {
  const [loaded, error] = useFonts(FONT_MAP);
  return loaded || !!error;
}
