import * as React from 'react';
import { Animated, Easing, StyleSheet, View, type ViewStyle } from 'react-native';

import { skeletonStyles } from '../styles';
import { color, radius, spacing } from '../tokens';

export type SkeletonProps = {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: ViewStyle;
};

/**
 * Pulsing placeholder. Uses the RN Animated driver (no Reanimated dependency)
 * so it works in the simplest possible Expo runtime.
 */
export function Skeleton({ width = '100%', height = 14, radius: r = radius.sm, style }: SkeletonProps) {
  const progress = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(progress, {
          toValue: 0,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [progress]);

  const opacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });

  return (
    <Animated.View
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[skeletonStyles.base, { width, height, borderRadius: r, opacity }, style]}
    />
  );
}

/** Skeleton shaped like an appointment/doctor card. */
export function SkeletonCard({ lines = 3, height }: { lines?: number; height?: number }) {
  return (
    <View style={[skeletonStyles.base, styles.card, height !== undefined ? { height } : null]}>
      <View style={skeletonStyles.row}>
        <Skeleton width={48} height={48} radius={24} />
        <View style={[skeletonStyles.col, styles.flex]}>
          <Skeleton width="70%" height={16} />
          <Skeleton width="45%" height={12} />
        </View>
      </View>
      {Array.from({ length: Math.max(0, lines - 2) }).map((_, index) => (
        <Skeleton key={index} width={index % 2 === 0 ? '90%' : '60%'} height={12} />
      ))}
    </View>
  );
}

/** Small row of pills, used under a search bar while results load. */
export function SkeletonChips({ count = 5 }: { count?: number }) {
  return (
    <View style={[skeletonStyles.row, { paddingVertical: spacing.xs }]}>
      {Array.from({ length: count }).map((_, index) => (
        <Skeleton key={index} width={72 + (index % 3) * 18} height={34} radius={radius.pill} />
      ))}
    </View>
  );
}

/** A grid of slot-shaped placeholders for the slot picker. */
export function SkeletonSlotGrid({ count = 9 }: { count?: number }) {
  return (
    <View style={styles.slotGrid}>
      {Array.from({ length: count }).map((_, index) => (
        <Skeleton key={index} width="30%" height={44} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  flex: { flex: 1 },
  slotGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
