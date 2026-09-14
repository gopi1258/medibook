import * as React from 'react';
import {
  Text as RNText,
  type StyleProp,
  type TextProps as RNTextProps,
  type TextStyle,
} from 'react-native';

import { textStyles } from '../styles';
import { textVariants, type TextVariant } from '../theme';
import { color } from '../tokens';

export type TextProps = Omit<RNTextProps, 'style'> & {
  /** Typography scale variant. Defaults to `body`. */
  variant?: TextVariant;
  /** Any brand colour token value, or a raw colour string. */
  color?: string;
  align?: 'auto' | 'left' | 'right' | 'center' | 'justify';
  /** Semantic role — defaults to `text`. Override for headings/labels. */
  accessibilityRole?: RNTextProps['accessibilityRole'];
  /** Explicit override used by callers that need one-off tweaks. */
  style?: StyleProp<TextStyle>;
};

/**
 * Themed text. All app copy renders through this so dynamic type, contrast and
 * font family stay consistent.
 */
export const Text = React.forwardRef<RNText, TextProps>(function Text(
  { variant = 'body', color: colorProp, align, style, children, ...rest },
  ref,
) {
  const variantStyle = textVariants[variant];
  const resolved: StyleProp<TextStyle>[] = [variantStyle, textStyles.base];

  if (colorProp) resolved.push({ color: colorProp });
  if (align && align !== 'auto') resolved.push({ textAlign: align });
  if (style) resolved.push(style);

  return (
    <RNText ref={ref} allowFontScaling maxFontSizeMultiplier={1.6} style={resolved} {...rest}>
      {children}
    </RNText>
  );
});

/** Convenience alias so screens can read `Typography.h1`. */
export const Typography = textVariants;

export const textColor = color;
