/**
 * Doctor reschedule (DOC-012) — pick from the doctor's **own open slots**.
 *
 * The picker uses `getOwnAvailability`, which excludes the appointment being
 * moved, so a doctor can never propose a slot that collides with the very
 * appointment they are moving. The move is atomic on the server: one transaction
 * frees the old slot and takes the new one, so a race can never leave two
 * bookings or none.
 */
import * as React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { ApiError, toDayViewModels, toSlotViewModel, toSlotViewModels } from '@medibook/core';
import type { Slot } from '@medibook/core';
import {
  Button,
  Card,
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

import { useDoctorAppointment, useOwnAvailability, useRescheduleAppointment } from '../../../src/lib/hooks';
import { useClinicTimeZone } from '../../../src/lib/session';
import { useNow } from '../../../src/lib/useNow';
import { appointmentTimeLabel, consultTypeLabel, describeError } from '../../../src/lib/format';
import { ErrorState, InlineNotice, ListSkeleton } from '../../../src/components/states';

export default function DoctorRescheduleScreen() {
  const router = useRouter();
  const { appointmentId } = useLocalSearchParams<{ appointmentId?: string }>();
  const clinicTz = useClinicTimeZone();
  const now = useNow(60_000);

  const appointment = useDoctorAppointment(appointmentId);
  const data = appointment.data;
  const consultType = data?.consult_type ?? 'in_person';

  const availability = useOwnAvailability({ type: consultType });
  const reschedule = useRescheduleAppointment();

  const [selectedDate, setSelectedDate] = React.useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = React.useState<string | null>(null);
  const [failure, setFailure] = React.useState<unknown>(null);
  const [alternatives, setAlternatives] = React.useState<string[]>([]);

  const dayModels = React.useMemo(
    () => (availability.data ? toDayViewModels(availability.data, { nowMs: now }) : []),
    [availability.data, now],
  );

  React.useEffect(() => {
    if (selectedDate !== null) return;
    const first = dayModels.find((day) => day.slotCount > 0 && !day.disabled);
    if (first) setSelectedDate(first.date);
  }, [dayModels, selectedDate]);

  const days = availability.data?.days ?? [];
  const activeDay = days.find((day) => day.date === selectedDate);
  const slots = React.useMemo(
    () => toSlotViewModels(activeDay, clinicTz).filter((slot) => slot.startUtc !== data?.start_utc),
    [activeDay, data?.start_utc, clinicTz],
  );

  const alternativeSlots: Slot[] = React.useMemo(() => {
    if (alternatives.length === 0) return [];
    const all = days.flatMap((day) => day.slots);
    return alternatives
      .map((startUtc) => all.find((slot) => slot.start_utc === startUtc))
      .filter((slot): slot is Slot => slot !== undefined);
  }, [alternatives, days]);

  const submit = async () => {
    if (!appointmentId || !selectedSlot) return;
    setFailure(null);
    setAlternatives([]);
    try {
      await reschedule.mutateAsync({ appointmentId, startUtc: selectedSlot });
      router.back();
    } catch (caught) {
      setFailure(caught);
      if (caught instanceof ApiError) setAlternatives(caught.alternatives);
      await availability.refetch();
    }
  };

  return (
    <Screen scroll edges={['top']} contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.huge }}>
      <ScreenHeader
        title="Reschedule"
        subtitle={data ? `${data.for_name} · ${data.code}` : 'Loading…'}
        onBack={() => router.back()}
      />

      {appointment.isLoading ? (
        <ListSkeleton count={2} />
      ) : appointment.isError || !data ? (
        <ErrorState error={appointment.error} onRetry={() => void appointment.refetch()} />
      ) : (
        <>
          <Card variant="flat" style={{ gap: spacing.md }}>
            <Text variant="label">Currently booked</Text>
            <Text variant="h3">{appointmentTimeLabel(data, clinicTz, now)}</Text>
            <Text variant="small">
              {consultTypeLabel(data.consult_type)} · patient {data.for_name}
            </Text>
          </Card>

          <PolicyNote
            tone="info"
            title="What the patient sees"
            body="A doctor-initiated move is applied immediately, with the new details and a one-hour offer to revert to the original time. Repeated doctor moves are monitored as a marketplace signal."
          />

          <SectionHeading title="Your open slots" />
          {availability.isLoading ? (
            <SkeletonSlotGrid count={9} />
          ) : availability.isError ? (
            <ErrorState error={availability.error} onRetry={() => void availability.refetch()} compact />
          ) : dayModels.every((day) => day.slotCount === 0) ? (
            <EmptyState
              icon="clock"
              title="No open slots"
              description="Open a window in your weekly template or free up an existing appointment first."
              actionLabel="Open schedule"
              onAction={() => router.replace('/(tabs)/schedule')}
            />
          ) : (
            <>
              <DayStrip
                days={dayModels}
                selectedDate={selectedDate}
                onSelect={(date) => {
                  setSelectedDate(date);
                  setSelectedSlot(null);
                }}
                tzLabel="Clinic timezone"
              />

              {alternatives.length > 0 && alternativeSlots.length > 0 ? (
                <View style={{ gap: spacing.md }}>
                  <PolicyNote
                    tone="warning"
                    title="That slot is no longer free"
                    body="Somebody took it while you were deciding. The appointment has not moved — pick another slot."
                  />
                  <SlotGrid
                    slots={alternativeSlots.map((slot) => toSlotViewModel(slot, clinicTz))}
                    selectedStartUtc={selectedSlot}
                    onSelect={(slot) => setSelectedSlot(slot.startUtc)}
                    showLegend={false}
                    tzLabel="Clinic timezone"
                  />
                </View>
              ) : (
                <SlotGrid
                  slots={slots}
                  selectedStartUtc={selectedSlot}
                  onSelect={(slot) => setSelectedSlot(slot.startUtc)}
                  tzLabel="Clinic timezone"
                  emptyTitle="Nothing open this day"
                  emptyDescription="Pick another day — the strip only lists days your template covers."
                />
              )}
            </>
          )}

          {failure ? <InlineNotice message={describeError(failure).message} /> : null}

          <Card variant="flat" style={{ backgroundColor: color.surfaceAlt, gap: spacing.sm }}>
            <Text variant="label">On confirm</Text>
            <Text variant="small">• The new slot is taken and the old one released in a single transaction.</Text>
            <Text variant="small">• {data.for_name} is notified with the new time and a revert option.</Text>
            <Text variant="small">• Reminders are recomputed; the fee does not change for a same-type move.</Text>
          </Card>

          <Button
            label={reschedule.isPending ? 'Moving…' : selectedSlot ? 'Move appointment' : 'Pick a slot first'}
            loading={reschedule.isPending}
            disabled={!selectedSlot || reschedule.isPending}
            onPress={() => void submit()}
            icon="refresh"
          />
          <Button label="Keep the current time" variant="ghost" onPress={() => router.back()} />
        </>
      )}
    </Screen>
  );
}
