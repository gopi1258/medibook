/**
 * MediBook design tokens.
 *
 * Single source of truth: `docs/BRAND_SPEC.md`. Do not hard-code brand values in
 * screens — import from here so both apps stay visually identical.
 */
import { Platform } from 'react-native';

/* ------------------------------------------------------------------ colour */

export const color = {
  /** Primary brand pink — buttons, active states. */
  primary: '#EC4899',
  /** Pressed / emphasis rose. */
  primaryStrong: '#E11D6E',
  /** Gradient start, soft accents. */
  coral: '#FB7185',
  /** Secondary accent — charts, badges. */
  accent: '#A855F7',
  gradientStart: '#FB7185',
  gradientEnd: '#E11D6E',
  /** App background (blush). */
  bg: '#FDF2F4',
  /** Cards. */
  surface: '#FFFFFF',
  /** Peach secondary surface — imagery backdrops, highlight cards. */
  surfaceAlt: '#FFDCCF',
  /** Success / positive surface. */
  mint: '#DFF5E4',
  /** Primary text / dark surfaces. */
  dark: '#1A1A2E',
  /** Dark cards. */
  darkSurface: '#141414',
  /** Secondary text. */
  textSecondary: '#6B7280',
  /** Captions. */
  textMuted: '#9CA3AF',
  /** Dividers, input fills. */
  border: '#EFEFF1',
  /** Verified badge, positive. */
  success: '#34C759',
  /** Destructive / emergency. */
  danger: '#EF4444',
  /** Ratings. */
  star: '#FFC529',
  /** Informational accents. */
  info: '#AEC4F7',

  /* supporting values (not in the spec table, derived for legibility/contrast) */
  white: '#FFFFFF',
  primaryTint: '#FCE7F3',
  accentTint: '#F3E8FF',
  successTint: '#DFF5E4',
  dangerTint: '#FEE2E2',
  infoTint: '#E8EEFD',
  starTint: '#FFF4D6',
  /** Modal scrim. */
  scrim: 'rgba(26, 26, 46, 0.45)',
  /** Disabled control fill. */
  disabled: '#E5E7EB',
  disabledText: '#9CA3AF',
} as const;

export type ColorToken = keyof typeof color;

/* -------------------------------------------------------------- typography */

export const fontSize = {
  display: 28,
  h1: 24,
  h2: 20,
  h3: 17,
  body: 15,
  small: 13,
  caption: 11,
} as const;

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

/**
 * Font family names as registered by `expo-font` via `@expo-google-fonts/*`.
 * Use {@link useBrandFonts} to load them.
 */
export const fontFamily = {
  heading: 'Poppins_600SemiBold',
  headingBold: 'Poppins_700Bold',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemibold: 'Inter_600SemiBold',
  bodyBold: 'Inter_700Bold',
} as const;

export type FontFamilyToken = keyof typeof fontFamily;

/* ------------------------------------------------------- shape & spacing */

export const radius = {
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  pill: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
} as const;

export type SpacingToken = keyof typeof spacing;

/** WCAG 2.2 AA / PRD §16 — every interactive target is at least this tall. */
export const TOUCH_TARGET = 44;

export const borderWidth = {
  none: 0,
  hairline: StyleSheetHairline(),
  thin: 1,
  thick: 2,
} as const;

function StyleSheetHairline(): number {
  return Platform.OS === 'android' ? 0.6 : 0.5;
}

/* ---------------------------------------------------------------- shadows */

export type ShadowStyle = {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowOpacity: number;
  shadowRadius: number;
  elevation: number;
};

/** Soft, low-opacity pink-tinted shadows. */
export const shadow = {
  none: {
    shadowColor: 'transparent',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  sm: {
    shadowColor: color.primaryStrong,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  md: {
    shadowColor: color.primaryStrong,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 4,
  },
  lg: {
    shadowColor: color.primaryStrong,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.12,
    shadowRadius: 26,
    elevation: 8,
  },
} as const satisfies Record<string, ShadowStyle>;

export type ShadowToken = keyof typeof shadow;

/* --------------------------------------------------------------- motion */

export const motion = {
  fast: 140,
  base: 220,
  slow: 320,
} as const;

/* ------------------------------------------------------------- gradients */

export const gradient = {
  brand: [color.gradientStart, color.gradientEnd] as const,
  brandSoft: [color.gradientStart, color.primary] as const,
  peach: ['#FFDCCF', '#FFC9B4'] as const,
  blossom: [color.gradientStart, color.accent] as const,
} as const;

/* ------------------------------------------------------------ brand meta */

export const brand = {
  productName: 'MediBook',
  tagline: 'Real appointments. Every time.',
  supportEmail: 'support@medibook.example',
  supportPhone: '+91 1800 000 000',
} as const;

/** Standard page padding used by `Screen`. */
export const screenPadding = spacing.xl;
