import * as React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { badgeStyles } from '../styles';
import { color, spacing } from '../tokens';

export type BadgeTone = 'verified' | 'neutral' | 'accent' | 'warning' | 'danger' | 'info';

export type BadgeProps = {
  label: string;
  tone?: BadgeTone;
  icon?: IconName;
  style?: ViewStyle;
  /** Rendered inside a card the user taps — keeps SR output short. */
  accessibilityLabel?: string;
};

const toneIcon: Record<BadgeTone, string> = {
  verified: color.success,
  neutral: color.textSecondary,
  accent: color.accent,
  warning: '#B45309',
  danger: color.danger,
  info: '#3B5BDB',
};

const toneStyle: Record<BadgeTone, ViewStyle> = {
  verified: badgeStyles.verified,
  neutral: badgeStyles.neutral,
  accent: badgeStyles.accent,
  warning: badgeStyles.warning,
  danger: badgeStyles.danger,
  info: badgeStyles.info,
};

/** Small status pill. `tone="verified"` renders the green trust badge. */
export function Badge({ label, tone = 'neutral', icon, style, accessibilityLabel }: BadgeProps) {
  const resolvedIcon = icon ?? (tone === 'verified' ? 'shield-check' : undefined);
  return (
    <View
      style={[badgeStyles.base, toneStyle[tone], style]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel ?? label}
    >
      {resolvedIcon ? <Icon name={resolvedIcon} size={12} color={toneIcon[tone]} strokeWidth={2.2} /> : null}
      <Text variant="captionStrong" style={{ color: toneIcon[tone] }}>
        {label}
      </Text>
    </View>
  );
}

/**
 * The verified-doctor trust badge (PRD X5 / DOC-002). Renders nothing when the
 * doctor is unverified — unverified supply must never look verified.
 */
export function VerifiedBadge({
  status,
  verifiedAt,
  style,
}: {
  status: 'pending' | 'under_review' | 'approved' | 'rejected' | 'suspended';
  verifiedAt?: string | null;
  style?: ViewStyle;
}) {
  if (status !== 'approved') return null;
  return (
    <Badge
      label={verifiedAt ? `Verified ${verifiedAt}` : 'Verified'}
      tone="verified"
      style={style}
      accessibilityLabel={`Verified doctor${verifiedAt ? `, since ${verifiedAt}` : ''}`}
    />
  );
}

/** Unread-count bubble used in tab bars and list rows. */
export function CountBubble({ count, style }: { count: number; style?: ViewStyle }) {
  if (count <= 0) return null;
  return (
    <View style={[styles.bubble, style]}>
      <Text variant="captionStrong" style={{ color: color.white }}>
        {count > 99 ? '99+' : count}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: spacing.xs,
    borderRadius: 11,
    backgroundColor: color.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
