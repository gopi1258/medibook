import * as React from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { Image, type ImageSourcePropType, StyleSheet, View, type ViewStyle } from 'react-native';

import { Text } from './Text';
import { avatarStyles } from '../styles';
import { color, gradient } from '../tokens';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type AvatarTone = 'peach' | 'blossom' | 'mint';

export type AvatarProps = {
  /** Full name — initials are derived. Never a remote URL. */
  name: string;
  size?: AvatarSize;
  /**
   * Optional *local / bundled* image. Remote images are intentionally not
   * supported: the apps must render offline.
   */
  source?: ImageSourcePropType;
  /** Backdrop gradient. Defaults to the brand peach surface. */
  tone?: AvatarTone;
  /** Small overlay in the corner (e.g. a verified tick). */
  overlay?: React.ReactNode;
  style?: ViewStyle;
  /** Set when the avatar is the only label for an entity. */
  accessibilityLabel?: string;
};

const dimensions: Record<AvatarSize, number> = {
  xs: 28,
  sm: 36,
  md: 48,
  lg: 64,
  xl: 96,
};

/** Ratio of the font size to the avatar diameter, tuned per size. */
const scale: Record<AvatarSize, number> = {
  xs: 0.4,
  sm: 0.38,
  md: 0.36,
  lg: 0.34,
  xl: 0.32,
};

const toneGradients: Record<AvatarTone, readonly [string, string]> = {
  peach: gradient.peach,
  blossom: gradient.brand,
  mint: [color.mint, '#BFE8CA'],
};

const toneTextColors: Record<AvatarTone, string> = {
  peach: color.dark,
  blossom: color.white,
  mint: color.dark,
};

/** Deterministic initials: "Dr. Arjun Mehta" -> "AM", "Priya" -> "P". */
export function initialsOf(name: string): string {
  const cleaned = name
    .replace(/\b(dr|mr|mrs|ms|miss|prof|professor)\b\.?/gi, ' ')
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .trim();
  if (!cleaned) return '?';
  const parts = cleaned.split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first) return '?';
  if (parts.length === 1) return first.slice(0, 1).toUpperCase();
  const last = parts[parts.length - 1] ?? first;
  return `${first.slice(0, 1)}${last.slice(0, 1)}`.toUpperCase();
}

/**
 * Initials avatar on a gradient backdrop. No network fetch, no remote asset —
 * satisfies the "works offline" constraint and avoids placeholder imagery.
 */
export function Avatar({
  name,
  size = 'md',
  source,
  tone = 'peach',
  overlay,
  style,
  accessibilityLabel,
}: AvatarProps) {
  const dimension = dimensions[size];
  const fontSize = Math.max(11, Math.round(dimension * scale[size]));

  return (
    <View
      style={[
        avatarStyles.wrap,
        { width: dimension, height: dimension, borderRadius: dimension / 2 },
        style,
      ]}
      accessible={accessibilityLabel !== undefined}
      accessibilityRole={accessibilityLabel ? 'image' : 'none'}
      accessibilityLabel={accessibilityLabel}
    >
      {source ? (
        <Image source={source} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <>
          <LinearGradient
            colors={toneGradients[tone]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <Text
            variant="bodyStrong"
            allowFontScaling={false}
            style={{ color: toneTextColors[tone], fontSize, lineHeight: fontSize * 1.25 }}
          >
            {initialsOf(name)}
          </Text>
        </>
      )}
      {overlay ? <View style={avatarStyles.overlay}>{overlay}</View> : null}
    </View>
  );
}
