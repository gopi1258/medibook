/**
 * Shared screen-level states: skeletons, empty and error.
 *
 * Every list in the app renders through one of these so loading, empty and
 * failure never look like an afterthought (PRD §16, TRD §4.6/4.7).
 */
import * as React from 'react';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import {
  Button,
  Card,
  EmptyState,
  SkeletonCard,
  SkeletonChips,
  Text,
  color,
  spacing,
} from '@medibook/brand';

import { describeError } from '../lib/format';

/** Stack of skeleton cards for a list that is still loading. */
export function ListSkeleton({ count = 3, chips = false }: { count?: number; chips?: boolean }) {
  return (
    <View style={{ gap: spacing.md }}>
      {chips ? <SkeletonChips count={4} /> : null}
      {Array.from({ length: count }).map((_, index) => (
        <SkeletonCard key={index} lines={2} />
      ))}
    </View>
  );
}

/**
 * Error state with retry. Slot races get the alternatives-aware copy because
 * "that slot was just taken" needs a different recovery than "network failed".
 */
export function ErrorState({
  error,
  onRetry,
  retryLabel = 'Try again',
  compact = false,
}: {
  error: unknown;
  onRetry?: () => void;
  retryLabel?: string;
  compact?: boolean;
}) {
  const { message, code } = describeError(error);
  const isRace = code === 'APT_SLOT_TAKEN' || code === 'APT_HOLD_EXPIRED' || code === 'CAL_SLOT_CONFLICT';

  return (
    <EmptyState
      tone="error"
      icon="alert-circle"
      title={isRace ? 'That slot was just taken' : 'We could not load this'}
      description={message}
      actionLabel={onRetry ? retryLabel : undefined}
      onAction={onRetry}
      compact={compact}
    />
  );
}

/** Inline banner for non-fatal problems (failed refresh, failed write). */
export function InlineNotice({
  message,
  tone = 'danger',
  action,
  style,
}: {
  message: string;
  tone?: 'danger' | 'warning' | 'info' | 'success';
  action?: { label: string; onPress: () => void };
  style?: ViewStyle;
}) {
  const palette = {
    danger: { bg: color.dangerTint, fg: color.danger, icon: 'alert-circle' as const },
    warning: { bg: color.starTint, fg: '#8A6100', icon: 'alert-triangle' as const },
    info: { bg: color.infoTint, fg: '#2B4C8C', icon: 'info' as const },
    success: { bg: color.mint, fg: '#1D6B34', icon: 'check-circle' as const },
  }[tone];

  return (
    <Card variant="flat" style={{ backgroundColor: palette.bg, gap: spacing.sm, ...style }}>
      <Text variant="smallMedium" color={palette.fg}>
        {message}
      </Text>
      {action ? (
        <Button label={action.label} size="sm" variant="ghost" block={false} onPress={action.onPress} />
      ) : null}
    </Card>
  );
}

/** A labelled key/value row used across detail screens. */
export function DetailRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}>
      <Text variant="small" style={{ minWidth: 108 }}>
        {label}
      </Text>
      <Text variant="bodyMedium" color={valueColor} style={{ flex: 1 }}>
        {value}
      </Text>
    </View>
  );
}
