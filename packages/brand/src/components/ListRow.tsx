import * as React from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { color, radius, spacing } from '../tokens';

/** Tappable settings/navigation row used across Profile, Schedule and Alerts. */
export function ListRow({
  title,
  subtitle,
  icon,
  value,
  onPress,
  trailing,
  destructive = false,
  badge,
  disabled = false,
  style,
  accessibilityHint,
}: {
  title: string;
  subtitle?: string;
  icon?: IconName;
  /** Right-aligned value, e.g. `English`. */
  value?: string;
  onPress?: () => void;
  trailing?: React.ReactNode;
  destructive?: boolean;
  badge?: number;
  disabled?: boolean;
  style?: ViewStyle;
  accessibilityHint?: string;
}) {
  const tint = destructive ? color.danger : color.dark;

  const body = (
    <>
      {icon ? (
        <View style={[styles.iconWrap, destructive && { backgroundColor: color.dangerTint }]}>
          <Icon name={icon} size={20} color={destructive ? color.danger : color.primary} />
        </View>
      ) : null}
      <View style={styles.textCol}>
        <Text variant="bodyStrong" style={{ color: tint }} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="small" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {badge !== undefined && badge > 0 ? (
        <View style={styles.badge}>
          <Text variant="captionStrong" style={{ color: color.white }}>
            {badge}
          </Text>
        </View>
      ) : null}
      {value ? (
        <Text variant="smallMedium" style={{ color: color.textSecondary }} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {trailing ?? (onPress ? <Icon name="chevron-right" size={18} color={color.textMuted} /> : null)}
    </>
  );

  if (!onPress) {
    return <View style={[styles.row, style]}>{body}</View>;
  }

  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={value ? `${title}, ${value}` : title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: color.bg }, disabled && { opacity: 0.5 }, style]}
    >
      {body}
    </Pressable>
  );
}

/**
 * Thin labelled divider + group container. Renders a card-like surface with
 * hairline separators so settings screens stay scannable.
 */
export function ListCard({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={[styles.card, style]}>
      {items.map((child, index) => (
        <View key={index}>
          {index > 0 ? <View style={styles.separator} /> : null}
          {child}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: color.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textCol: { flex: 1, gap: 2 },
  badge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: spacing.xs,
    borderRadius: 11,
    backgroundColor: color.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    backgroundColor: color.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: color.border,
    marginLeft: spacing.lg,
  },
});
