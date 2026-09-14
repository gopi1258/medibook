/**
 * Slot picker (PRD §7.1 / APT-001, J3 step 1).
 *
 * Day strip + slot grid, both rendered in the **viewer's** timezone with an
 * explicit tz label, plus the availability freshness cue ("Last synced 2 min
 * ago") that powers the X3 honesty promise. Selecting a slot starts the booking
 * flow, which creates the 5-minute hold.
 *
 * `APT_SLOT_TAKEN` from a stale grid is handled here rather than on the next
 * screen: the user sees the nearest alternatives immediately, in place.
 */
import * as React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import {
  ApiError,
  formatMoney,
  toDayViewModels,
  toSlotViewModel,
  toSlotViewModels,
} from '@medibook/core';
import type { ConsultType, Slot } from '@medibook/core';
import {
  Button,
  Chip,
  ChipRow,
  DayStrip,
  EmptyState,
  PolicyNote,
  Screen,
  ScreenHeader,
  SectionHeading,
  SkeletonSlotGrid,
  SlotGrid,
  Text,
  color,
  spacing,
} from '@medibook/brand';

import { useAvailability, useDoctor } from '../../src/lib/hooks';
import { useViewerTimeZone } from '../../src/lib/session';
import { useNow } from '../../src/lib/useNow';
import { consultTypeLabel, slotFreshnessLabel } from '../../src/lib/format';
import { ErrorState } from '../../src/components/states';
import { bookingDraftStore, startDraft } from '../../src/lib/bookingDraft';

export default function SlotPickerScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ doctorId?: string; consultType?: string }>();
  const doctorId = params.doctorId ?? '';
  const viewerTz = useViewerTimeZone();
  const now = useNow(60_000);

  const doctor = useDoctor(doctorId);
  const fees = doctor.data?.consult_fees.filter((fee) => fee.enabled) ?? [];
  const [consultType, setConsultType] = React.useState<ConsultType>(
    params.consultType === 'video' ? 'video' : 'in_person',
  );
  const [selectedDate, setSelectedDate] = React.useState<string | null>(null);
  const [raceAlternatives, setRaceAlternatives] = React.useState<string[] | null>(null);

  const availability = useAvailability(doctorId, { type: consultType });

  const dayModels = React.useMemo(
    () => (availability.data ? toDayViewModels(availability.data, { nowMs: now }) : []),
    [availability.data, now],
  );

  // Default to the first day that actually has open slots (J2 step 4).
  React.useEffect(() => {
    if (selectedDate !== null) return;
    const firstOpen = dayModels.find((day) => day.slotCount > 0 && !day.disabled);
    if (firstOpen) setSelectedDate(firstOpen.date);
  }, [dayModels, selectedDate]);

  const activeDay = availability.data?.days.find((day) => day.date === selectedDate);
  const slots = React.useMemo(() => toSlotViewModels(activeDay, viewerTz), [activeDay, viewerTz]);
  const freshness = availability.data
    ? slotFreshnessLabel(availability.data.calendar_sync.staleness, availability.data.calendar_sync.last_synced_at)
    : null;

  const onSelectSlot = (slotView: { startUtc: string; status: string }) => {
    if (slotView.status !== 'available') return;
    const doctorName = doctor.data?.name ?? 'Doctor';
    // The draft (and its idempotency key) is what makes the retry safe.
    startDraft({ doctorId, doctorName, consultType, startUtc: slotView.startUtc });
    setRaceAlternatives(null);
    router.push({
      pathname: '/booking/[doctorId]',
      params: { doctorId, consultType, startUtc: slotView.startUtc },
    });
  };

  const alternativeSlots: Slot[] = React.useMemo(() => {
    if (!raceAlternatives || !availability.data) return [];
    const all = availability.data.days.flatMap((day) => day.slots);
    return raceAlternatives
      .map((startUtc) => all.find((slot) => slot.start_utc === startUtc))
      .filter((slot): slot is Slot => slot !== undefined);
  }, [raceAlternatives, availability.data]);

  const fee = fees.find((entry) => entry.consult_type === consultType);

  return (
    <Screen edges={['top']} contentContainerStyle={{ gap: spacing.lg }}>
      <ScreenHeader
        title="Pick a time"
        subtitle={doctor.data ? `${doctor.data.name} · ${consultTypeLabel(consultType)}` : 'Loading…'}
        onBack={() => router.back()}
      />

      {fees.length > 1 ? (
        <ChipRow>
          {fees.map((entry) => (
            <Chip
              key={entry.consult_type}
              label={consultTypeLabel(entry.consult_type)}
              selected={consultType === entry.consult_type}
              onPress={() => {
                setConsultType(entry.consult_type);
                setSelectedDate(null);
                setRaceAlternatives(null);
                bookingDraftStore.set({ consultType: entry.consult_type });
              }}
            />
          ))}
        </ChipRow>
      ) : null}

      {availability.isLoading ? (
        <View style={{ gap: spacing.lg }}>
          <SkeletonSlotGrid count={9} />
        </View>
      ) : availability.isError ? (
        <ErrorState error={availability.error} onRetry={() => void availability.refetch()} />
      ) : dayModels.length === 0 ? (
        <EmptyState
          icon="calendar"
          title="No availability published"
          description="This doctor has not opened any slots for this consultation type yet. Try the other type or check back later."
        />
      ) : (
        <>
          <DayStrip
            days={dayModels}
            selectedDate={selectedDate}
            onSelect={(date) => {
              setSelectedDate(date);
              setRaceAlternatives(null);
            }}
            tzLabel={`Times shown in ${viewerTz.replace(/_/g, ' ')}`}
          />

          {raceAlternatives && alternativeSlots.length > 0 ? (
            <PolicyNote
              tone="warning"
              title="That slot was just taken"
              body="Another patient booked it first. Nothing was charged. These are the nearest openings — tap one to continue."
            />
          ) : null}

          {raceAlternatives ? (
            <View style={{ gap: spacing.md }}>
              <SectionHeading title="Nearest alternatives" />
              <SlotGrid
                slots={alternativeSlots.map((slot) => toSlotViewModel(slot, viewerTz))}
                onSelect={(slot) => onSelectSlot(slot)}
                showLegend={false}
                tzLabel={`Times in ${viewerTz.replace(/_/g, ' ')}`}
              />
            </View>
          ) : (
            <SlotGrid
              slots={slots}
              onSelect={onSelectSlot}
              tzLabel={`Times shown in ${viewerTz.replace(/_/g, ' ')}`}
              freshnessLabel={freshness}
              emptyTitle="No open slots this day"
              emptyDescription="Pick another day above — the strip only shows days this doctor actually works."
            />
          )}

          <View style={{ gap: spacing.xs }}>
            {fee ? (
              <Text variant="small">
                {consultTypeLabel(consultType)} · {fee.duration_minutes} minutes · {formatMoney(fee.fee_minor, fee.currency)}
              </Text>
            ) : null}
            <Text variant="caption">
              Slots marked “booked” are taken. Slots marked “yours” are your own appointments — open them from the
              Appointments tab to reschedule.
            </Text>
          </View>

          <PolicyNote
            tone="info"
            title="A hold protects your slot"
            body="When you pick a slot we hold it for 5 minutes while you pay. Nothing is charged until you confirm, and the hold is released automatically if you walk away."
          />
        </>
      )}

      <Button label="Back to profile" variant="ghost" onPress={() => router.back()} />
      {doctor.data === undefined && !doctor.isLoading ? (
        <Text variant="caption" color={color.danger}>
          {doctor.error instanceof ApiError ? doctor.error.message : 'This doctor could not be loaded.'}
        </Text>
      ) : null}
    </Screen>
  );
}
