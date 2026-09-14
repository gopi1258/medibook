import * as React from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, G, LinearGradient as SvgLinearGradient, Path, Stop } from 'react-native-svg';
import { View, type ViewStyle } from 'react-native';

import { Text } from './Text';
import { color, fontFamily, gradient } from '../tokens';

export type LogoProps = {
  /** Mark size in points. Defaults to 40. */
  size?: number;
  /** Render the "MediBook" wordmark next to the mark. */
  withWordmark?: boolean;
  /** Wordmark size in points (defaults to a sensible ratio of `size`). */
  wordmarkSize?: number;
  /** Wordmark colour. */
  wordmarkColor?: string;
  /** Layout direction when the wordmark is shown. */
  direction?: 'row' | 'column';
  style?: ViewStyle;
  accessibilityLabel?: string;
};

/** Number of petals in the blossom mark (BRAND_SPEC: 4–5). */
const PETAL_COUNT = 5;

/**
 * The MediBook flower/pinwheel mark.
 *
 * Five rounded petals rotated around a common centre, filled with the brand
 * pink→magenta gradient. Drawn entirely with `react-native-svg` so it scales
 * crisply and needs no image asset.
 */
export function LogoMark({ size = 40, style }: { size?: number; style?: ViewStyle }) {
  const petal = PETAL_COUNT > 0 ? 360 / PETAL_COUNT : 0;

  return (
    <View
      style={style}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Defs>
          <SvgLinearGradient id="medibookPetal" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={gradient.brand[0]} />
            <Stop offset="1" stopColor={gradient.brand[1]} />
          </SvgLinearGradient>
          <SvgLinearGradient id="medibookPetalSoft" x1="0" y1="1" x2="1" y2="0">
            <Stop offset="0" stopColor={color.primary} stopOpacity="0.85" />
            <Stop offset="1" stopColor={color.accent} stopOpacity="0.9" />
          </SvgLinearGradient>
        </Defs>
        <G>
          {Array.from({ length: PETAL_COUNT }).map((_, index) => (
            <Path
              key={index}
              // Teardrop petal anchored at the centre (50,50), bulging outward.
              d="M50 50 C 50 26, 62 14, 78 18 C 84 34, 74 48, 50 50 Z"
              fill={index % 2 === 0 ? 'url(#medibookPetal)' : 'url(#medibookPetalSoft)'}
              opacity={index % 2 === 0 ? 1 : 0.82}
              transform={`rotate(${index * petal} 50 50)`}
            />
          ))}
          {/* Centre pip keeps the petals visually joined. */}
          <Path d="M50 40 A 10 10 0 1 1 49.9 40 Z" fill={color.gradientStart} opacity={0.95} />
        </G>
      </Svg>
    </View>
  );
}

/**
 * Brand lockup: the pinwheel mark, optionally with the "MediBook" wordmark in
 * Poppins SemiBold. Products must never render a different wordmark.
 */
export function Logo({
  size = 40,
  withWordmark = true,
  wordmarkSize,
  wordmarkColor = color.dark,
  direction = 'row',
  style,
  accessibilityLabel = 'MediBook',
}: LogoProps) {
  const mark = <LogoMark size={size} />;
  if (!withWordmark) {
    return (
      <View style={style} accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
        {mark}
      </View>
    );
  }

  const textSize = wordmarkSize ?? Math.max(15, Math.round(size * 0.62));

  return (
    <View
      style={[
        { flexDirection: direction === 'row' ? 'row' : 'column', alignItems: 'center', gap: size * 0.22 },
        style,
      ]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
    >
      {mark}
      <Text
        allowFontScaling={false}
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={{
          fontFamily: fontFamily.heading,
          fontSize: textSize,
          lineHeight: textSize * 1.25,
          color: wordmarkColor,
          letterSpacing: -0.4,
        }}
      >
        MediBook
      </Text>
    </View>
  );
}

/** Gradient hero backdrop used by onboarding and the confirmation screen. */
export function BrandHero({
  children,
  style,
  height,
}: {
  children?: React.ReactNode;
  style?: ViewStyle;
  height?: number;
}) {
  return (
    <LinearGradient
      colors={[gradient.brand[0], gradient.brand[1]]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[{ borderRadius: 32, padding: 24, overflow: 'hidden' }, height !== undefined ? { height } : null, style]}
    >
      {children}
    </LinearGradient>
  );
}
