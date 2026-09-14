import * as React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { color, radius, spacing } from '../tokens';

/**
 * Visible 5-minute hold countdown (PRD APT-002 / R12). Renders the remaining
 * time, a progress rail, and announces politely for screen readers.
 */
export function CountdownPill({
  remainingMs,
  totalMs = 5 * 60 * 1000,
  label = 'Slot held',
  expiredLabel = 'Hold expired',
  style,
}: {
  remainingMs: number;
  totalMs?: number;
  label?: string;
  expiredLabel?: string;
  style?: ViewStyle;
}) {
  const expired = remainingMs <= 0;
  const clamped = Math.max(0, Math.min(remainingMs, totalMs));
  const ratio = totalMs > 0 ? clamped / totalMs : 0;
  const totalSeconds = Math.ceil(clamped / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const clock = `${minutes}:${String(seconds).padStart(2, '0')}`;
  const urgent = !expired && clamped <= 60_000;
  const tint = expired || urgent ? color.danger : color.primary;

  return (
    <View
      style={[
        styles.wrap,
        { borderColor: tint, backgroundColor: expired ? color.dangerTint : color.primaryTint },
        style,
      ]}
      accessibilityRole="timer"
      accessibilityLiveRegion="polite"
      accessibilityLabel={
        expired
          ? expiredLabel
          : `${label}, ${minutes} minute${minutes === 1 ? '' : 's'} ${seconds} seconds remaining`
      }
    >
      <Icon name={expired ? 'alert-circle' : 'clock'} size={18} color={tint} />
      <View style={styles.body}>
        <Text variant="caption" style={{ color: tint }}>
          {expired ? expiredLabel : label}
        </Text>
        {!expired ? (
          <Text variant="h4" style={{ color: tint }}>
            {clock}
          </Text>
        ) : null}
      </View>
      <View style={styles.rail}>
        <View style={[styles.railFill, { width: `${Math.round(ratio * 100)}%`, backgroundColor: tint }]} />
      </View>
    </View>
  );
}

/**
 * Inline "why can't I do this" explainer that surfaces the governing policy
 * rule (PRD §13 R2 / R3) on reschedule and cancel flows.
 */
export function PolicyNote({
  title,
  body,
  tone = 'info',
  style,
}: {
  title: string;
  body: string;
  tone?: 'info' | 'warning' | 'success' | 'danger';
  style?: ViewStyle;
}) {
  const map: Record<string, { bg: string; fg: string; icon: IconName }> = {
    info: { bg: color.infoTint, fg: '#3B5BDB', icon: 'info' },
    warning: { bg: color.starTint, fg: '#B45309', icon: 'alert-triangle' },
    success: { bg: color.mint, fg: color.success, icon: 'check-circle' },
    danger: { bg: color.dangerTint, fg: color.danger, icon: 'alert-circle' },
  };
  const tone_ = map[tone] ?? map.info!;

  return (
    <View style={[styles.note, { backgroundColor: tone_.bg }, style]}>
      <Icon name={tone_.icon} size={18} color={tone_.fg} />
      <View style={styles.noteBody}>
        <Text variant="bodyStrong" style={{ color: tone_.fg }}>
          {title}
        </Text>
        <Text variant="small" style={{ color: tone_.fg }}>
          {body}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  body: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, flex: 1 },
  rail: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  railFill: { height: '100%' },
  note: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.md,
  },
  noteBody: { flex: 1, gap: 2 },
});
