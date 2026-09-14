import * as React from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';

import { Icon } from './Icon';
import { Text } from './Text';
import { starStyles } from '../styles';
import { color, spacing } from '../tokens';

export type StarRatingProps = {
  /** Current value. For read-only mode this is the doctor's average. */
  value: number;
  /** Interactive mode: called with the tapped star (1–5). */
  onChange?: (value: number) => void;
  /** Star diameter in points. Defaults to 18 (read-only) / 28 (interactive). */
  size?: number;
  /** Show the numeric value next to the stars. */
  showValue?: boolean;
  /** Append a review count, e.g. `4.8 (126)`. */
  count?: number;
  /** Read-only if no `onChange` is supplied. */
  accessibilityLabel?: string;
  style?: ViewStyle;
};

/**
 * Star rating — read-only (doctor cards, reviews) and interactive (rate & review).
 * Interactive renders 44pt hit targets per star.
 */
export function StarRating({
  value,
  onChange,
  size,
  showValue = false,
  count,
  accessibilityLabel,
  style,
}: StarRatingProps) {
  const interactive = typeof onChange === 'function';
  const starSize = size ?? (interactive ? 30 : 18);
  const rounded = Math.round(value);

  const stars = (
    <View style={starStyles.row}>
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = star <= rounded;
        const icon = <Icon name={filled ? 'star-filled' : 'star'} size={starSize} color={color.star} strokeWidth={1.6} />;
        if (!interactive) return <View key={star}>{icon}</View>;
        return (
          <Pressable
            key={star}
            accessible
            accessibilityRole="button"
            accessibilityLabel={`${star} star${star === 1 ? '' : 's'}`}
            accessibilityState={{ selected: star === rounded }}
            onPress={() => onChange(star)}
            hitSlop={6}
            style={starStyles.hit}
          >
            {icon}
          </Pressable>
        );
      })}
    </View>
  );

  if (!showValue && !count) {
    return (
      <View
        style={style}
        accessible
        accessibilityRole="text"
        accessibilityLabel={accessibilityLabel ?? `Rated ${value.toFixed(1)} out of 5`}
      >
        {stars}
      </View>
    );
  }

  return (
    <View
      style={[{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, style]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={
        accessibilityLabel ?? `Rated ${value.toFixed(1)} out of 5${count ? `, ${count} reviews` : ''}`
      }
    >
      {stars}
      {showValue ? (
        <Text variant="smallMedium" style={{ color: color.dark }}>
          {value.toFixed(1)}
          {count !== undefined ? ` (${count})` : ''}
        </Text>
      ) : null}
    </View>
  );
}

/** Horizontal 5→1 histogram used on the doctor profile reviews section. */
export function RatingDistribution({
  distribution,
  total,
  style,
}: {
  /** Index 0 = 5 stars, index 4 = 1 star. */
  distribution: readonly [number, number, number, number, number];
  total: number;
  style?: ViewStyle;
}) {
  return (
    <View style={[{ gap: spacing.sm }, style]}>
      {distribution.map((n, index) => {
        const stars = 5 - index;
        const ratio = total > 0 ? n / total : 0;
        return (
          <View key={stars} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Text variant="caption" style={{ width: 26 }}>
              {stars}★
            </Text>
            <View
              style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: color.border, overflow: 'hidden' }}
              accessibilityRole="progressbar"
              accessibilityLabel={`${stars} star reviews: ${n}`}
            >
              <View
                style={{
                  width: `${Math.round(ratio * 100)}%`,
                  height: '100%',
                  borderRadius: 4,
                  backgroundColor: color.star,
                }}
              />
            </View>
            <Text variant="caption" style={{ width: 32, textAlign: 'right' }}>
              {n}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
