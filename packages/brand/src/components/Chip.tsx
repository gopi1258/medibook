import * as React from 'react';
import { Pressable, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { chipStyles } from '../styles';
import { color, spacing } from '../tokens';

export type ChipProps = {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
  /** Optional count/meta rendered after the label. */
  meta?: string;
  disabled?: boolean;
  /** Render as a static, non-interactive pill. */
  readOnly?: boolean;
  style?: ViewStyle;
  accessibilityLabel?: string;
};

/** Filter / selection pill. Selected = filled primary. */
export function Chip({
  label,
  selected = false,
  onPress,
  icon,
  meta,
  disabled = false,
  readOnly = false,
  style,
  accessibilityLabel,
}: ChipProps) {
  const tint = selected ? color.white : color.textSecondary;

  const content = (
    <>
      {icon ? <Icon name={icon} size={16} color={tint} /> : null}
      <Text variant="smallMedium" style={{ color: selected ? color.white : color.dark }}>
        {label}
      </Text>
      {meta ? (
        <Text variant="caption" style={{ color: tint }}>
          {meta}
        </Text>
      ) : null}
    </>
  );

  if (readOnly || !onPress) {
    return (
      <View
        style={[chipStyles.base, selected && chipStyles.selected, style]}
        accessible
        accessibilityRole="text"
        accessibilityLabel={accessibilityLabel ?? label}
      >
        {content}
      </View>
    );
  }

  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={accessibilityLabel ?? label}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        chipStyles.base,
        selected && chipStyles.selected,
        pressed && { opacity: 0.85 },
        disabled && { opacity: 0.5 },
        style,
      ]}
    >
      {content}
    </Pressable>
  );
}

/** Horizontally scrolling chip row used on Home / Discover. */
export function ChipRow({
  children,
  contentContainerStyle,
}: {
  children: React.ReactNode;
  contentContainerStyle?: ViewStyle;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[styles.row, contentContainerStyle]}
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.sm, paddingVertical: spacing.xs, paddingRight: spacing.xl },
});
