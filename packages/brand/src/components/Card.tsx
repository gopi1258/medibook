import * as React from 'react';
import { Pressable, type PressableProps, StyleSheet, View, type ViewStyle } from 'react-native';

import { Text } from './Text';
import { cardStyles } from '../styles';
import { color, spacing } from '../tokens';

export type CardVariant = 'default' | 'flat' | 'peach' | 'mint' | 'dark' | 'outline';

export type CardProps = {
  children: React.ReactNode;
  variant?: CardVariant;
  /** Makes the whole card tappable with an accessible button role. */
  onPress?: PressableProps['onPress'];
  accessibilityLabel?: string;
  accessibilityHint?: string;
  padding?: number;
  style?: ViewStyle;
  testID?: string;
};

const variantOverrides: Record<CardVariant, ViewStyle> = {
  default: {},
  flat: { shadowOpacity: 0, elevation: 0 },
  peach: { backgroundColor: color.surfaceAlt },
  mint: { backgroundColor: color.mint },
  dark: { backgroundColor: color.darkSurface },
  outline: {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
    shadowOpacity: 0,
    elevation: 0,
  },
};

/**
 * White large-radius surface with a soft pink-tinted shadow — the core visual
 * unit of both apps.
 */
export function Card({
  children,
  variant = 'default',
  onPress,
  accessibilityLabel,
  accessibilityHint,
  padding,
  style,
  testID,
}: CardProps) {
  const base: ViewStyle[] = [
    cardStyles.base,
    variantOverrides[variant],
    padding !== undefined ? { padding } : null,
    style,
  ].filter(Boolean) as ViewStyle[];

  if (!onPress) {
    return (
      <View style={base} testID={testID}>
        {children}
      </View>
    );
  }

  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [...base, pressed ? cardStyles.pressed : null]}
    >
      {children}
    </Pressable>
  );
}

/** Section header used above groups of cards. */
export function SectionHeading({
  title,
  action,
  style,
}: {
  title: string;
  action?: React.ReactNode;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.headingRow, style]}>
      <Text variant="h3" accessibilityRole="header" style={styles.headingText}>
        {title}
      </Text>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  headingText: { flexShrink: 1 },
});
