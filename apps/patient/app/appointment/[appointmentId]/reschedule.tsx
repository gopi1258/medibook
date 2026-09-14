/**
 * Reschedule (J6 / APT-007, R3).
 *
 * The policy verdict comes from the server (`reschedulePreview`) — never
 * re-derived on the client — so a blocked reschedule shows the real reason code
 * and the remaining allowance. Picking a new slot performs an atomic move: the
 * new slot is validated and taken in one transaction, and the old slot is freed
 * automatically.
 */
import * as React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError, cryptoRandomIdempotencyKey, toDayViewModels, toSlotViewModel, toSlotViewModels } from '@medibook/core';
import {
  Button,
  Card,
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
import type { ConsultType, Slot } from '@medibook/core';

import { patientApi } from '../../../src/lib/api';
import { useAppointment, useAvailability, useDoctor } from '../../../src/lib/hooks';
import { useViewerTimeZone } from '../../../src/lib/session';
import { useNow } from '../../../src/lib/useNow';
import { appointmentTimeLabel, consultTypeLabel, describeError } from '../../../src/lib/format';
import { ErrorState, InlineNotice, ListSkeleton } from '../../../src/components/states';

export default function RescheduleScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { appointmentId } = useLocalSearchParams<{ appointmentId?: string }>();
  const viewerTz = useViewerTimeZone();
  const now = useNow(60_000);

  const appointment = useAppointment(appointmentId);
  const data = appointment.data;
  const doctor = useDoctor(data?.doctor_id);
  const consultType: ConsultType = data?.consult_type ?? 'in_person';

  const [selectedDate, setSelectedDate] = React.useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [failure, setFailure] = React.useState<unknown>(null);
  const [alternatives, setAlternatives] = React.useState<string[]>([]);
  const idempotencyKey = React.useRef(cryptoRandomIdempotencyKey());

  const preview = useQuery({
    queryKey: ['appointment', appointmentId ?? 'unknown', 'reschedule-preview'],
    queryFn: () => patientApi.reschedulePreview(appointmentId as string),
    enabled: Boolean(appointmentId),
  });

  const availability = useAvailability(data?.doctor_id, { type: consultType, from: undefined });
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
  // The appointment's own slot must not be offered as its replacement.
  const slots = React.useMemo(
    () => toSlotViewModels(activeDay, viewerTz).filter((slot) => slot.startUtc !== data?.start_utc),
    [activeDay, data?.start_utc, viewerTz],
  );

  const submit = async () => {
    if (!appointmentId || !selectedSlot) return;
    setSubmitting(true);
    setFailure(null);
    setAlternatives([]);
    try {
      await patientApi.rescheduleAppointment(appointmentId, selectedSlot, idempotencyKey.current);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['appointment'] }),
        queryClient.invalidateQueries({ queryKey: ['appointments'] }),
        queryClient.invalidateQueries({ queryKey: ['availability'] }),
        queryClient.invalidateQueries({ queryKey: ['notifications'] }),
      ]);
      router.back();
    } catch (caught) {
      setFailure(caught);
      if (caught instanceof ApiError && (caught.code === 'APT_SLOT_TAKEN' || caught.code === 'APT_STATE_CONFLICT')) {
        setAlternatives(caught.alternatives);
        await availability.refetch();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const alternativeSlots: Slot[] = React.useMemo(() => {
    if (alternatives.length === 0) return [];
    const all = days.flatMap((day) => day.slots);
    return alternatives
      .map((startUtc) => all.find((slot) => slot.start_utc === startUtc))
      .filter((slot): slot is Slot => slot !== undefined);
  }, [alternatives, days]);

  return (
    <Screen scroll edges={['top']} contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.huge }}>
      <ScreenHeader
        title="Reschedule"
        subtitle={data ? `${data.doctor_name} · ${data.code}` : 'Loading…'}
        onBack={() => router.back()}
      />

      {appointment.isLoading || preview.isLoading ? (
        <ListSkeleton count={2} />
      ) : appointment.isError || !data ? (
        <ErrorState error={appointment.error} onRetry={() => void appointment.refetch()} />
      ) : (
        <>
          <Card variant="flat" style={{ gap: spacing.md }}>
            <Text variant="label">Currently booked</Text>
            <Text variant="h3">{appointmentTimeLabel(data, viewerTz, now)}</Text>
            <Text variant="small">
              {consultTypeLabel(data.consult_type)} · {data.for_name}
            </Text>
          </Card>

          {preview.data && !preview.data.allowed ? (
            <>
              <PolicyNote
                tone="danger"
                title="This appointment cannot be rescheduled"
                body={preview.data.summary}
              />
              <Button label="Cancel instead" variant="secondary" onPress={() => router.replace(`/appointment/${data.id}/cancel`)} />
              <Button label="Back" variant="ghost" onPress={() => router.back()} />
            </>
          ) : (
            <>
              {preview.data ? (
                <PolicyNote
                  tone="info"
                  title={`${preview.data.remaining_reschedules} reschedule${preview.data.remaining_reschedules === 1 ? '' : 's'} left`}
                  body={`${preview.data.summary} Moving a slot is free when the consultation type and fee stay the same, and your old slot is released the moment you confirm.`}
                />
              ) : null}

              <SectionHeading title="Pick a new time" />
              {availability.isLoading ? (
                <SkeletonSlotGrid count={9} />
              ) : availability.isError ? (
                <ErrorState error={availability.error} onRetry={() => void availability.refetch()} compact />
              ) : dayModels.every((day) => day.slotCount === 0) ? (
                <EmptyState
                  icon="calendar"
                  title="No alternative slots"
                  description="This doctor has no other openings in the booking window. You can cancel per policy instead."
                  actionLabel="Cancel this appointment"
                  onAction={() => router.replace(`/appointment/${data.id}/cancel`)}
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
                    tzLabel={`Times shown in ${viewerTz.replace(/_/g, ' ')}`}
                  />

                  {alternatives.length > 0 && alternativeSlots.length > 0 ? (
                    <View style={{ gap: spacing.md }}>
                      <PolicyNote
                        tone="warning"
                        title="That new time was taken"
                        body="Someone booked it while you were deciding. Your original appointment is untouched — pick again."
                      />
                      <SlotGrid
                        slots={alternativeSlots.map((slot) => toSlotViewModel(slot, viewerTz))}
                        selectedStartUtc={selectedSlot}
                        onSelect={(slot) => setSelectedSlot(slot.startUtc)}
                        showLegend={false}
                        tzLabel={`Times in ${viewerTz.replace(/_/g, ' ')}`}
                      />
                    </View>
                  ) : (
                    <SlotGrid
                      slots={slots}
                      selectedStartUtc={selectedSlot}
                      onSelect={(slot) => setSelectedSlot(slot.startUtc)}
                      tzLabel={`Times shown in ${viewerTz.replace(/_/g, ' ')}`}
                      emptyTitle="Nothing open this day"
                      emptyDescription="Try another day on the strip above."
                    />
                  )}
                </>
              )}

              {failure ? <InlineNotice message={describeError(failure).message} /> : null}

              <Card variant="flat" style={{ gap: spacing.sm, backgroundColor: color.surfaceAlt }}>
                <Text variant="label">What happens when you confirm</Text>
                <Text variant="small">
                  1. We lock the new slot and move the appointment in a single step — nobody can take it in between.
                </Text>
                <Text variant="small">2. Your original slot is released immediately.</Text>
                <Text variant="small">
                  3. Both you and {data.doctor_name} get a notification, and your reminders are recalculated.
                </Text>
                <Text variant="small">
                  4. The fee stays the same for a same-type move, so there is nothing extra to pay and no partial refund.
                </Text>
              </Card>

              <Button
                label={submitting ? 'Moving…' : selectedSlot ? 'Confirm new time' : 'Pick a slot first'}
                loading={submitting}
                disabled={!selectedSlot || submitting}
                onPress={() => void submit()}
                icon="check"
              />
              <Button label="Keep my current time" variant="ghost" onPress={() => router.back()} />
            </>
          )}
        </>
      )}

      {doctor.data ? (
        <Text variant="caption">
          Rescheduling with {doctor.data.name} · {doctor.data.clinic_timezone.replace(/_/g, ' ')} clinic time.
        </Text>
      ) : null}

      <ChipRow>
        <Chip label="Reschedule policy" icon="info" readOnly />
        <Chip label="Free to move" icon="check-circle" readOnly />
      </ChipRow>
    </Screen>
  );
}
