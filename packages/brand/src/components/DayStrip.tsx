import * as React from 'react';
import { Pressable, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';

import { Text } from './Text';
import { dayStripStyles } from '../styles';
import { color, radius, spacing } from '../tokens';

export type DayView = {
  /** Clinic-local calendar date, `YYYY-MM-DD`. */
  date: string;
  /** e.g. `Sun` */
  weekdayLabel: string;
  /** e.g. `20` */
  dayLabel: string;
  /** e.g. `Sep` */
  monthLabel: string;
  /** Number of bookable slots; 0 renders the day as unavailable. */
  slotCount: number;
  isToday?: boolean;
  /** Force-disable (e.g. past days / beyond the booking window). */
  disabled?: boolean;
};

export type DayStripProps = {
  days: readonly DayView[];
  selectedDate?: string | null;
  onSelect: (date: string) => void;
  /** Explicit tz label under the strip (PRD R9). */
  tzLabel?: string;
  /** Shown when `days` is empty. */
  emptyLabel?: string;
  style?: ViewStyle;
  accessibilityLabel?: string;
};

/**
 * Horizontal day selector. Days with zero slots remain tappable=false but stay
 * visible so the user can see *why* (greyed) rather than guessing.
 */
export function DayStrip({
  days,
  selectedDate,
  onSelect,
  tzLabel,
  emptyLabel = 'No days available in this range',
  style,
  accessibilityLabel = 'Choose a day',
}: DayStripProps) {
  if (days.length === 0) {
    return (
      <View style={[styles.empty, style]}>
        <Text variant="small" align="center">
          {emptyLabel}
        </Text>
      </View>
    );
  }

  return (
    <View style={style}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={dayStripStyles.list}
        accessibilityLabel={accessibilityLabel}
      >
        {days.map((day) => {
          const selected = day.date === selectedDate;
          const disabled = day.disabled === true || (day.slotCount === 0 && !selected);
          return (
            <Pressable
              key={day.date}
              accessible
              accessibilityRole="button"
              accessibilityState={{ selected, disabled }}
              accessibilityLabel={`${day.weekdayLabel} ${day.dayLabel} ${day.monthLabel}${
                day.isToday ? ', today' : ''
              }, ${day.slotCount} slot${day.slotCount === 1 ? '' : 's'} available`}
              disabled={disabled}
              onPress={() => onSelect(day.date)}
              style={({ pressed }) => [
                dayStripStyles.day,
                day.isToday && !selected && dayStripStyles.dayToday,
                selected && dayStripStyles.daySelected,
                disabled && dayStripStyles.dayDisabled,
                pressed && !selected && { opacity: 0.85 },
              ]}
            >
              <Text variant="caption" style={{ color: selected ? color.white : color.textMuted }}>
                {day.isToday ? 'Today' : day.weekdayLabel}
              </Text>
              <Text
                variant="h4"
                style={{ color: selected ? color.white : disabled ? color.textMuted : color.dark }}
              >
                {day.dayLabel}
              </Text>
              <Text variant="caption" style={{ color: selected ? color.white : color.textMuted }}>
                {day.slotCount > 0 ? `${day.slotCount} slots` : '—'}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {tzLabel ? (
        <Text variant="caption" style={styles.tz}>
          Clinic timezone: {tzLabel}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    alignItems: 'center',
  },
  tz: { marginTop: spacing.xs, marginLeft: spacing.xs },
});
