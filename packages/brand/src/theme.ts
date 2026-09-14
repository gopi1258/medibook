/**
 * Composed theme object + typography scale.
 *
 * `theme` is the object screens pass around when they need raw values, and
 * `textVariants` is what `Text` (and `TextField`, `Button`) resolve from.
 */
import type { TextStyle } from 'react-native';

import {
  borderWidth,
  brand,
  color,
  fontFamily,
  fontSize,
  fontWeight,
  gradient,
  motion,
  radius,
  screenPadding,
  shadow,
  spacing,
  TOUCH_TARGET,
} from './tokens';

export const textVariants = {
  /** 28 · Poppins SemiBold — hero / onboarding headline */
  display: {
    fontFamily: fontFamily.heading,
    fontSize: fontSize.display,
    lineHeight: 34,
    fontWeight: fontWeight.semibold,
    color: color.dark,
    letterSpacing: -0.4,
  },
  /** 24 · Poppins SemiBold — screen titles */
  h1: {
    fontFamily: fontFamily.heading,
    fontSize: fontSize.h1,
    lineHeight: 30,
    fontWeight: fontWeight.semibold,
    color: color.dark,
    letterSpacing: -0.3,
  },
  /** 20 · Poppins SemiBold — section headers */
  h2: {
    fontFamily: fontFamily.heading,
    fontSize: fontSize.h2,
    lineHeight: 26,
    fontWeight: fontWeight.semibold,
    color: color.dark,
    letterSpacing: -0.2,
  },
  /** 17 · Poppins SemiBold — card titles */
  h3: {
    fontFamily: fontFamily.heading,
    fontSize: fontSize.h3,
    lineHeight: 23,
    fontWeight: fontWeight.semibold,
    color: color.dark,
  },
  /** 15 · Poppins SemiBold — compact emphasis titles (list rows) */
  h4: {
    fontFamily: fontFamily.heading,
    fontSize: fontSize.body,
    lineHeight: 21,
    fontWeight: fontWeight.semibold,
    color: color.dark,
  },
  /** 15 · Inter Regular — default body copy */
  body: {
    fontFamily: fontFamily.body,
    fontSize: fontSize.body,
    lineHeight: 22,
    fontWeight: fontWeight.regular,
    color: color.dark,
  },
  /** 15 · Inter Medium */
  bodyMedium: {
    fontFamily: fontFamily.bodyMedium,
    fontSize: fontSize.body,
    lineHeight: 22,
    fontWeight: fontWeight.medium,
    color: color.dark,
  },
  /** 15 · Inter SemiBold — inline emphasis */
  bodyStrong: {
    fontFamily: fontFamily.bodySemibold,
    fontSize: fontSize.body,
    lineHeight: 22,
    fontWeight: fontWeight.semibold,
    color: color.dark,
  },
  /** 13 · Inter Regular */
  small: {
    fontFamily: fontFamily.body,
    fontSize: fontSize.small,
    lineHeight: 19,
    fontWeight: fontWeight.regular,
    color: color.textSecondary,
  },
  /** 13 · Inter Medium — secondary meta rows */
  smallMedium: {
    fontFamily: fontFamily.bodyMedium,
    fontSize: fontSize.small,
    lineHeight: 19,
    fontWeight: fontWeight.medium,
    color: color.textSecondary,
  },
  /** 13 · Inter SemiBold — eyebrow / section labels */
  label: {
    fontFamily: fontFamily.bodySemibold,
    fontSize: fontSize.small,
    lineHeight: 18,
    fontWeight: fontWeight.semibold,
    color: color.textSecondary,
    letterSpacing: 0.4,
  },
  /** 15 · Inter SemiBold — control labels (buttons, chips) */
  button: {
    fontFamily: fontFamily.bodySemibold,
    fontSize: fontSize.body,
    lineHeight: 20,
    fontWeight: fontWeight.semibold,
  },
  /** 11 · Inter Medium — captions, tz labels, freshness notes */
  caption: {
    fontFamily: fontFamily.bodyMedium,
    fontSize: fontSize.caption,
    lineHeight: 15,
    fontWeight: fontWeight.medium,
    color: color.textMuted,
    letterSpacing: 0.2,
  },
  /** 11 · Inter SemiBold — small uppercase pills */
  captionStrong: {
    fontFamily: fontFamily.bodySemibold,
    fontSize: fontSize.caption,
    lineHeight: 15,
    fontWeight: fontWeight.semibold,
    color: color.textSecondary,
    letterSpacing: 0.6,
  },
} as const satisfies Record<string, TextStyle>;

export type TextVariant = keyof typeof textVariants;

export const theme = {
  color,
  brand,
  fontSize,
  fontWeight,
  fontFamily,
  radius,
  spacing,
  shadow,
  motion,
  gradient,
  borderWidth,
  touchTarget: TOUCH_TARGET,
  screenPadding,
  textVariants,
} as const;

export type Theme = typeof theme;
