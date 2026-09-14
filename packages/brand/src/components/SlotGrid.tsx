import * as React from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { Icon } from './Icon';
import { SkeletonSlotGrid } from './Skeleton';
import { Text } from './Text';
import { slotGridStyles } from '../styles';
import { color, radius, spacing } from '../tokens';

export type SlotStatus = 'available' | 'taken' | 'mine' | 'unavailable';

export type SlotView = {
  /** ISO-8601 UTC instant. */
  startUtc: string;
  /** Already rendered in the *viewer's* timezone, e.g. `6:30 pm`. */
  label: string;
  status: SlotStatus;
  /** Optional suffix such as `pm` or a fee hint. */
  meta?: string;
};

export type SlotGridProps = {
  slots: readonly SlotView[];
  selectedStartUtc?: string | null;
  onSelect: (slot: SlotView) => void;
  loading?: boolean;
  /** Explicit timezone label — always rendered above the grid (PRD R9 / X4). */
  tzLabel?: string;
  /** e.g. `Last synced 2 min ago` — availability freshness (PRD X3). */
  freshnessLabel?: string | null;
  showLegend?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  style?: ViewStyle;
};

const statusCopy: Record<SlotStatus, string> = {
  available: 'available',
  taken: 'already booked',
  mine: 'your appointment',
  unavailable: 'not available',
};

/**
 * Slot grid. Every slot is a ≥44pt target that announces its *status* to
 * screen readers, not just its time — a sighted user gets this from colour.
 */
export function SlotGrid({
  slots,
  selectedStartUtc,
  onSelect,
  loading = false,
  tzLabel,
  freshnessLabel,
  showLegend = true,
  emptyTitle = 'No open slots',
  emptyDescription = 'Try another day, or pick a different consultation type.',
  style,
}: SlotGridProps) {
  if (loading) {
    return (
      <View style={style}>
        <SkeletonSlotGrid count={9} />
      </View>
    );
  }

  return (
    <View style={[styles.wrap, style]}>
      {tzLabel ? (
        <View style={styles.tzRow}>
          <Icon name="globe" size={14} color={color.textMuted} />
          <Text variant="caption">Times shown in {tzLabel}</Text>
        </View>
      ) : null}

      {freshnessLabel ? (
        <View style={styles.freshRow}>
          <Icon name="refresh" size={13} color={color.textMuted} />
          <Text variant="caption">{freshnessLabel}</Text>
        </View>
      ) : null}

      {slots.length === 0 ? (
        <View style={slotGridStyles.empty}>
          <Icon name="calendar" size={26} color={color.textMuted} />
          <Text variant="bodyMedium" align="center">
            {emptyTitle}
          </Text>
          <Text variant="small" align="center">
            {emptyDescription}
          </Text>
        </View>
      ) : (
        <View style={slotGridStyles.grid} accessibilityRole="list">
          {slots.map((slot) => {
            const selected = slot.startUtc === selectedStartUtc;
            const selectable = slot.status === 'available';
            return (
              <Pressable
                key={slot.startUtc}
                accessible
                accessibilityRole="button"
                accessibilityState={{ selected, disabled: !selectable }}
                accessibilityLabel={`${slot.label}, ${statusCopy[slot.status]}`}
                accessibilityHint={selectable ? 'Selects this slot and starts a 5 minute hold' : undefined}
                disabled={!selectable}
                onPress={() => onSelect(slot)}
                style={({ pressed }) => [
                  slotGridStyles.cell,
                  slot.status === 'available' && slotGridStyles.cellAvailable,
                  slot.status === 'taken' && slotGridStyles.cellTaken,
                  slot.status === 'unavailable' && slotGridStyles.cellTaken,
                  slot.status === 'mine' && slotGridStyles.cellMine,
                  selected && slotGridStyles.cellSelected,
                  pressed && selectable && { opacity: 0.85 },
                ]}
              >
                <Text
                  variant="smallMedium"
                  style={{
                    color:
                      selected
                        ? color.white
                        : slot.status === 'available'
                          ? color.dark
                          : slot.status === 'mine'
                            ? color.success
                            : color.textMuted,
                    textDecorationLine: slot.status === 'unavailable' ? 'line-through' : 'none',
                  }}
                >
                  {slot.label}
                </Text>
                {slot.meta ? (
                  <Text
                    variant="caption"
                    style={{ color: selected ? color.white : color.textMuted }}
                  >
                    {slot.meta}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      )}

      {showLegend ? (
        <View style={slotGridStyles.legendRow}>
          <LegendDot tone={color.surface} border={color.primaryTint} label="Available" />
          <LegendDot tone={color.border} label="Taken" />
          <LegendDot tone={color.mint} border={color.success} label="Yours" />
        </View>
      ) : null}
    </View>
  );
}

function LegendDot({ tone, border, label }: { tone: string; border?: string; label: string }) {
  return (
    <View style={slotGridStyles.legendItem}>
      <View
        style={[
          slotGridStyles.legendDot,
          { backgroundColor: tone, borderWidth: border ? 1 : 0, borderColor: border ?? 'transparent' },
        ]}
      />
      <Text variant="caption">{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  tzRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  freshRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    backgroundColor: color.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
});
