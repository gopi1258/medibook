import * as React from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { Text } from './Text';
import { segmentedStyles } from '../styles';
import { color, spacing } from '../tokens';

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  /** Optional count bubble, e.g. `Upcoming · 3`. */
  badge?: number;
};

export type SegmentedControlProps<T extends string> = {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible group label, e.g. "Appointment list view". */
  accessibilityLabel?: string;
  style?: ViewStyle;
};

/**
 * Pill segmented switcher (Upcoming / Past pattern from the brand spec).
 * Generic over the option union so callers keep exhaustive types.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel = 'Segment',
  style,
}: SegmentedControlProps<T>) {
  return (
    <View
      style={[segmentedStyles.track, style]}
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessible
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={option.badge !== undefined ? `${option.label}, ${option.badge}` : option.label}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              segmentedStyles.segment,
              active && segmentedStyles.active,
              pressed && !active && { opacity: 0.7 },
            ]}
          >
            <View style={styles.labelRow}>
              <Text
                variant={active ? 'bodyStrong' : 'bodyMedium'}
                style={{ color: active ? color.dark : color.textSecondary }}
                numberOfLines={1}
              >
                {option.label}
              </Text>
              {option.badge !== undefined && option.badge > 0 ? (
                <View style={[styles.badge, active ? styles.badgeActive : styles.badgeIdle]}>
                  <Text variant="captionStrong" style={{ color: active ? color.white : color.textSecondary }}>
                    {option.badge}
                  </Text>
                </View>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeActive: { backgroundColor: color.primary },
  badgeIdle: { backgroundColor: color.border },
});
