import * as React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { IconButton } from './Button';
import { Icon, type IconName } from './Icon';
import { Text, type TextProps } from './Text';
import { color, spacing } from '../tokens';

export type ScreenHeaderProps = {
  /** Centred title. */
  title: string;
  /** Renders a back chevron; omit for root screens. */
  onBack?: () => void;
  backLabel?: string;
  /** Right-hand action: an icon + handler, or arbitrary node. */
  action?: { icon: IconName; onPress: () => void; accessibilityLabel: string } | React.ReactNode;
  /** Optional eyebrow above the title. */
  subtitle?: string;
  /** Show a hairline divider under the header (for scrolled content). */
  bordered?: boolean;
  /** Left slot override (replaces the back chevron). */
  left?: React.ReactNode;
  titleVariant?: TextProps['variant'];
  backgroundColor?: string;
  style?: ViewStyle;
};

function isActionNode(
  value: ScreenHeaderProps['action'],
): value is { icon: IconName; onPress: () => void; accessibilityLabel: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !React.isValidElement(value) &&
    'icon' in (value as Record<string, unknown>)
  );
}

/**
 * Stacked screen header: back chevron (left) + centred title + right action.
 * Matches the BRAND_SPEC layout pattern used across both apps.
 */
export function ScreenHeader({
  title,
  onBack,
  backLabel = 'Go back',
  action,
  subtitle,
  bordered = false,
  left,
  titleVariant = 'h3',
  backgroundColor,
  style,
}: ScreenHeaderProps) {
  const leftSlot = left ?? (onBack ? <IconButton name="chevron-left" accessibilityLabel={backLabel} onPress={onBack} /> : null);

  const rightSlot = isActionNode(action) ? (
    <IconButton
      name={action.icon}
      accessibilityLabel={action.accessibilityLabel}
      onPress={action.onPress}
    />
  ) : (
    (action as React.ReactNode) ?? null
  );

  return (
    <View style={[styles.wrap, backgroundColor ? { backgroundColor } : null, style]}>
      <View style={styles.side}>{leftSlot}</View>
      <View style={styles.center}>
        <Text variant={titleVariant} align="center" numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" align="center" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={[styles.side, styles.rightSide]}>{rightSlot}</View>
      {bordered ? <View style={styles.divider} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
  },
  side: { minWidth: 60, flexDirection: 'row', alignItems: 'center' },
  rightSide: { justifyContent: 'flex-end' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  divider: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: color.border,
  },
});

/** Small helper used on several screens for a title + icon pair. */
export function HeaderIcon({ name, color: tint = color.dark }: { name: IconName; color?: string }) {
  return <Icon name={name} size={20} color={tint} />;
}
