import * as React from 'react';
import { View, type ViewStyle } from 'react-native';

import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { emptyStyles } from '../styles';
import { color, spacing } from '../tokens';

export type EmptyStateProps = {
  title: string;
  description?: string;
  icon?: IconName;
  /** Primary recovery action. */
  actionLabel?: string;
  onAction?: () => void;
  /** Secondary action, e.g. "Clear filters". */
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  tone?: 'neutral' | 'error';
  style?: ViewStyle;
  compact?: boolean;
};

/**
 * Friendly zero-state. Always tells the user *why* the screen is empty and
 * offers the next step — never a bare "No data".
 */
export function EmptyState({
  title,
  description,
  icon,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  tone = 'neutral',
  style,
  compact = false,
}: EmptyStateProps) {
  return (
    <View style={[emptyStyles.wrap, compact ? { paddingVertical: spacing.xxl } : null, style]}>
      <View
        style={[
          emptyStyles.art,
          tone === 'error' ? { backgroundColor: color.dangerTint } : null,
          compact ? { width: 64, height: 64 } : null,
        ]}
      >
        <Icon
          name={icon ?? (tone === 'error' ? 'alert-circle' : 'calendar-check')}
          size={compact ? 28 : 38}
          color={tone === 'error' ? color.danger : color.primary}
        />
      </View>
      <Text variant="h3" align="center" accessibilityRole="header">
        {title}
      </Text>
      {description ? (
        <Text variant="small" align="center" style={{ maxWidth: 300 }}>
          {description}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} block={false} style={{ minWidth: 200 }} />
      ) : null}
      {secondaryActionLabel && onSecondaryAction ? (
        <Button
          label={secondaryActionLabel}
          variant="ghost"
          onPress={onSecondaryAction}
          block={false}
          size="sm"
        />
      ) : null}
    </View>
  );
}
