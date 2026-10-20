/**
 * ÖRZA design tokens for the mobile app — ported from the web app (tailwind.config.ts + globals.css):
 * warm cream canvas, frosted glass, Playfair Display headings, Figtree body, JetBrains Mono eyebrows,
 * dark hero with the amber → coral → pink energy orb, cyan focus/accents.
 */
import { Platform, type TextStyle, type ViewStyle } from 'react-native';

/* ───────────────────────────── Colour ───────────────────────────── */

export const colors = {
  // canvas
  canvas: '#FBF7F1',
  canvas1: '#F6F0E8',
  canvas2: '#EFE7DD',
  canvas3: '#E7DDD1',
  // text
  ink: '#141414',
  text: '#2A2A2A',
  muted: '#5B5B5B',
  subtle: '#666666',
  inverse: '#F7F4EF',
  // lines
  hairline: 'rgba(20,20,20,0.10)',
  hairlineStrong: 'rgba(20,20,20,0.16)',
  divider: 'rgba(20,20,20,0.08)',
  track: 'rgba(20,20,20,0.07)',
  // glass
  glass: 'rgba(255,255,255,0.62)',
  glassStrong: 'rgba(255,255,255,0.78)',
  glassSubtle: 'rgba(255,255,255,0.46)',
  glassSolid: 'rgba(255,255,255,0.92)',
  // dark hero
  hero: '#07090C',
  hero2: '#0B0F14',
  heroText: '#F7F4EF',
  heroMuted: 'rgba(247,244,239,0.72)',
  heroSubtle: 'rgba(247,244,239,0.50)',
  heroHairline: 'rgba(247,244,239,0.14)',
  heroGlass: 'rgba(255,255,255,0.08)',
  heroGlassBorder: 'rgba(255,255,255,0.14)',
  // energy
  amber: '#FFB454',
  coral: '#FF7A6A',
  pink: '#FF5FA2',
  cream: '#FFE7C8',
  /** Deepened energy tones for text on the cream canvas (≥ 3.9:1, like `.orza-energy-text`). */
  energyInk: '#C2410C',
  energyInk2: '#D63A4A',
  // accents
  cyan: '#0BBEDC',
  cyan50: '#E8FBFF',
  cyan100: '#CFF6FF',
  cyan300: '#63E2FA',
  cyan400: '#2FD2F0',
  cyan600: '#0B8FA6',
  cyan700: '#0A6F82',
  violet: '#8757F2',
  violet50: '#F4F1FF',
  violet300: '#BFA8FF',
  violet600: '#6E3ED6',
  // status
  success: '#127A56',
  successBg: '#EAF7F1',
  warning: '#B06A00',
  warningBg: '#FFF4E6',
  error: '#B02C2C',
  errorBg: '#FDECEC',
  errorInk: '#8F2424',
  info: '#0B8FA6',
  infoBg: '#EAF6FF',
  energyBg: '#FFF1EA',
  white: '#FFFFFF',
  black: '#000000',
  transparent: 'transparent',
} as const;

/** Gradient stops (expo-linear-gradient / react-native-svg). */
export const gradients = {
  energy: ['#FFB454', '#FF7A6A', '#FF5FA2'] as const,
  energyDeep: ['#C2410C', '#D63A4A', '#BE185D'] as const,
  cyan: ['#63E2FA', '#0BBEDC'] as const,
  violet: ['#BFA8FF', '#8757F2'] as const,
  success: ['#5FD3A4', '#127A56'] as const,
  hero: ['#07090C', '#0B0F14'] as const,
};

/** 135° — top-left → bottom-right, like the web's `linear-gradient(135deg, …)`. */
export const diagonal = { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } } as const;

/* ───────────────────────────── Space & shape ───────────────────────────── */

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
  giant: 56,
} as const;

/** Horizontal page gutter. */
export const gutter = 20;

export const radii = {
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

/* ───────────────────────────── Type ───────────────────────────── */

/** Font family names — the keys passed to `useFonts` in `src/lib/fonts.ts`. */
export const fonts = {
  display: 'PlayfairDisplay_600SemiBold',
  displayItalic: 'PlayfairDisplay_600SemiBold_Italic',
  displayBold: 'PlayfairDisplay_700Bold',
  body: 'Figtree_400Regular',
  bodyMedium: 'Figtree_500Medium',
  bodySemiBold: 'Figtree_600SemiBold',
  bodyBold: 'Figtree_700Bold',
  mono: 'JetBrainsMono_500Medium',
} as const;

export const typography = {
  display: { fontFamily: fonts.display, fontSize: 40, lineHeight: 46, letterSpacing: -0.9 },
  h1: { fontFamily: fonts.display, fontSize: 30, lineHeight: 36, letterSpacing: -0.6 },
  h2: { fontFamily: fonts.display, fontSize: 24, lineHeight: 30, letterSpacing: -0.35 },
  h3: { fontFamily: fonts.display, fontSize: 20, lineHeight: 26, letterSpacing: -0.2 },
  stat: { fontFamily: fonts.display, fontSize: 34, lineHeight: 38, letterSpacing: -0.6, fontVariant: ['tabular-nums'] },
  title: { fontFamily: fonts.bodySemiBold, fontSize: 17, lineHeight: 22, letterSpacing: -0.1 },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 24 },
  callout: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22 },
  small: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20 },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 14, lineHeight: 18 },
  caption: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 17 },
  eyebrow: { fontFamily: fonts.mono, fontSize: 11, lineHeight: 14, letterSpacing: 1.5, textTransform: 'uppercase' },
  mono: { fontFamily: fonts.mono, fontSize: 12, lineHeight: 16, letterSpacing: 0.4 },
} satisfies Record<string, TextStyle>;

export type TypographyVariant = keyof typeof typography;

/* ───────────────────────────── Depth ───────────────────────────── */

/**
 * Shadows as CSS `boxShadow` (React Native 0.76+, New Architecture) so iOS and Android match the web.
 */
export const shadows = {
  none: {},
  glass: { boxShadow: '0px 10px 30px rgba(20,20,20,0.08)' },
  glassHover: { boxShadow: '0px 16px 44px rgba(20,20,20,0.10)' },
  floating: { boxShadow: '0px 18px 60px rgba(20,20,20,0.12)' },
  cta: { boxShadow: '0px 14px 36px rgba(20,20,20,0.22)' },
  energy: { boxShadow: '0px 14px 34px rgba(255,122,106,0.38)' },
  soft: { boxShadow: '0px 4px 14px rgba(20,20,20,0.06)' },
} satisfies Record<string, ViewStyle>;

/* ───────────────────────────── Motion ───────────────────────────── */

/**
 * Reanimated 4 springs default to mass 4 and stiffness 900: a layout-animation builder given only `.damping(18)` has a
 * damping ratio of ~0.15 and wobbles past its slot for ~2 s (a toast swells to 1.4×). Every
 * `.springify().damping(n)` chain therefore also sets `.stiffness(…)` and `.mass(1)`, and `withSpring` configs carry
 * all three — like the presets below.
 */
export const motion = {
  /** Snappy, slightly bouncy — buttons, chips, tab indicator. */
  spring: { damping: 18, stiffness: 260, mass: 0.8 },
  /** Softer settle — cards, sheets, toasts. */
  springSoft: { damping: 22, stiffness: 180, mass: 1 },
  pressScale: 0.965,
  fast: 160,
  base: 240,
  slow: 420,
  ring: 900,
} as const;

/* ───────────────────────────── Layout ───────────────────────────── */

export const layout = {
  /** Floating tab bar: bar height, distance from the bottom safe edge, and the raised Snap button. */
  tabBarHeight: 64,
  tabBarGap: 10,
  snapSize: 62,
  /** Comfortable touch target. */
  hit: 44,
  maxContentWidth: 560,
} as const;

export const isIOS = Platform.OS === 'ios';
export const isAndroid = Platform.OS === 'android';
