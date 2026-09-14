/**
 * Leaves & blocks (DOC-006 / EC-01) — date-range unavailability with the
 * **affected-bookings resolution list**.
 *
 * The rule the PRD cares about most: blocking time that overlaps a booked
 * appointment never cancels it. The exception is created, the appointment stands,
 * and the resolution list is shown so the doctor reschedules or cancels each one
 * deliberately.
 */
import * as React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import { addDaysToDate, dateInZone, toIso, wallTimeToUtc } from '@medibook/core';
import {
  Badge,
  Button,
  Card,
  Chip,
  ChipRow,
  EmptyState,
  PolicyNote,
  Screen,
  ScreenHeader,
  SectionHeading,
  Sheet,
  Text,
  TextField,
  color,
  spacing,
} from '@medibook/brand';

import { useCreateException, useDeleteException, useExceptions } from '../../src/lib/hooks';
import { useClinicTimeZone } from '../../src/lib/session';
import { describeError } from '../../src/lib/format';
import { ErrorState, InlineNotice, ListSkeleton } from '../../src/components/states';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export default function ExceptionsScreen() {
  const router = useRouter();
  const clinicTz = useClinicTimeZone();
  const exceptions = useExceptions();
  const create = useCreateException();
  const remove = useDeleteException();

  const today = React.useMemo(() => dateInZone(Date.now(), clinicTz), [clinicTz]);
  const [open, setOpen] = React.useState(false);
  const [kind, setKind] = React.useState<'leave' | 'block'>('leave');
  const [fromDate, setFromDate] = React.useState(addDaysToDate(today, 1));
  const [toDate, setToDate] = React.useState(addDaysToDate(today, 1));
  const [allDay, setAllDay] = React.useState(true);
  const [startTime, setStartTime] = React.useState('10:00');
  const [endTime, setEndTime] = React.useState('13:00');
  const [reason, setReason] = React.useState('');
  const [formError, setFormError] = React.useState<string | null>(null);
  const [failure, setFailure] = React.useState<unknown>(null);

  const resolve = (): { startUtc: string; endUtc: string } | null => {
    if (!DATE_PATTERN.test(fromDate) || !DATE_PATTERN.test(toDate)) return null;
    if (toDate < fromDate) return null;
    if (allDay) {
      return { startUtc: toIso(wallTimeToUtc(fromDate, '00:00', clinicTz)), endUtc: toIso(wallTimeToUtc(toDate, '23:59', clinicTz)) };
    }
    if (!TIME_PATTERN.test(startTime) || !TIME_PATTERN.test(endTime)) return null;
    if (endTime <= startTime) return null;
    return { startUtc: toIso(wallTimeToUtc(fromDate, startTime, clinicTz)), endUtc: toIso(wallTimeToUtc(toDate, endTime, clinicTz)) };
  };

  const save = async () => {
    const range = resolve();
    if (!range) {
      setFormError('Check the dates and times — the end must be after the start.');
      return;
    }
    setFormError(null);
    setFailure(null);
    try {
      await create.mutateAsync({
        start_utc: range.startUtc,
        end_utc: range.endUtc,
        kind,
        reason: reason.trim().length > 0 ? reason.trim() : kind === 'leave' ? 'Leave' : 'Blocked time',
      });
      setOpen(false);
      setReason('');
    } catch (caught) {
      setFailure(caught);
    }
  };

  const affected = (exceptions.data ?? []).reduce((sum, exception) => sum + exception.affected_appointments.length, 0);

  return (
    <Screen
      scroll
      edges={['top']}
      contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.huge }}
      refreshing={exceptions.isRefetching && !exceptions.isLoading}
      onRefresh={() => void exceptions.refetch()}
    >
      <ScreenHeader
        title="Leaves & blocks"
        subtitle={`Times in ${clinicTz.replace(/_/g, ' ')}`}
        onBack={() => router.back()}
        action={{ icon: 'plus', onPress: () => setOpen(true), accessibilityLabel: 'Add exception' }}
      />

      {affected > 0 ? (
        <Card variant="flat" style={{ backgroundColor: color.dangerTint, gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
            <Badge label={`${affected} booked appointment${affected === 1 ? '' : 's'} affected`} tone="danger" icon="alert-triangle" />
          </View>
          <Text variant="small">
            These appointments still stand. Patients are never silently cancelled — reschedule or cancel each one below.
          </Text>
        </Card>
      ) : null}

      {exceptions.isLoading ? (
        <ListSkeleton count={2} />
      ) : exceptions.isError ? (
        <ErrorState error={exceptions.error} onRetry={() => void exceptions.refetch()} />
      ) : (exceptions.data ?? []).length === 0 ? (
        <EmptyState
          icon="calendar"
          title="No leaves or blocks"
          description="Add a vacation week or a one-off block. Slots inside the range simply stop being offered to patients."
          actionLabel="Add an exception"
          onAction={() => setOpen(true)}
        />
      ) : (
        <View style={{ gap: spacing.md }}>
          {(exceptions.data ?? []).map((exception) => (
            <Card key={exception.id} variant="flat" style={{ gap: spacing.md }}>
              <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center', flexWrap: 'wrap' }}>
                <Badge
                  label={exception.kind === 'leave' ? 'Leave' : 'Blocked'}
                  tone={exception.kind === 'leave' ? 'accent' : 'warning'}
                  icon="calendar"
                />
                <Text variant="bodyMedium">
                  {exception.start_utc.slice(0, 10)} → {exception.end_utc.slice(0, 10)}
                </Text>
              </View>
              <Text variant="small">{exception.reason}</Text>

              {exception.affected_appointments.length > 0 ? (
                <View style={{ gap: spacing.sm }}>
                  <SectionHeading title="Resolution list" />
                  {exception.affected_appointments.map((affectedAppointment) => (
                    <Card key={affectedAppointment.id} variant="flat" style={{ gap: spacing.sm, backgroundColor: color.starTint }}>
                      <Text variant="smallMedium">
                        {affectedAppointment.code} · {affectedAppointment.for_name}
                      </Text>
                      <Text variant="caption">
                        {affectedAppointment.start_utc.slice(0, 16).replace('T', ' ')} · {affectedAppointment.status}
                      </Text>
                      <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
                        <Button
                          label="Reschedule"
                          size="sm"
                          block={false}
                          onPress={() => router.push(`/appointment/${affectedAppointment.id}/reschedule`)}
                        />
                        <Button
                          label="Cancel + refund"
                          size="sm"
                          variant="ghost"
                          block={false}
                          onPress={() => router.push(`/appointment/${affectedAppointment.id}/cancel`)}
                        />
                      </View>
                    </Card>
                  ))}
                </View>
              ) : (
                <Text variant="caption">No booked appointments overlap this range.</Text>
              )}

              <Button
                label="Remove exception"
                size="sm"
                variant="ghost"
                block={false}
                onPress={() => void remove.mutateAsync(exception.id).catch((error: unknown) => setFailure(error))}
              />
            </Card>
          ))}
        </View>
      )}

      {failure ? <InlineNotice message={describeError(failure).message} /> : null}

      <PolicyNote
        tone="info"
        title="Recurring time off"
        body="Weekly recurring unavailability belongs in your template — delete or shorten the window for that weekday. Use leaves here for specific dates."
      />

      <Button label="Add leave or block" icon="plus" variant="secondary" onPress={() => setOpen(true)} />

      <Sheet
        visible={open}
        onClose={() => setOpen(false)}
        title="Add leave or block"
        subtitle="Nothing already booked is cancelled automatically"
        footer={
          <View style={{ gap: spacing.sm }}>
            <Button label={create.isPending ? 'Saving…' : 'Add exception'} loading={create.isPending} onPress={() => void save()} />
            <Button label="Cancel" variant="ghost" onPress={() => setOpen(false)} />
          </View>
        }
      >
        <View style={{ gap: spacing.lg }}>
          <Text variant="label">Kind</Text>
          <ChipRow>
            <Chip label="Leave (time off)" selected={kind === 'leave'} onPress={() => setKind('leave')} />
            <Chip label="Block (one-off)" selected={kind === 'block'} onPress={() => setKind('block')} />
          </ChipRow>

          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <View style={{ flex: 1 }}>
              <TextField label="From" value={fromDate} onChangeText={setFromDate} placeholder={today} />
            </View>
            <View style={{ flex: 1 }}>
              <TextField label="To" value={toDate} onChangeText={setToDate} placeholder={today} />
            </View>
          </View>

          <ChipRow>
            <Chip label="Whole days" selected={allDay} onPress={() => setAllDay(true)} />
            <Chip label="Specific hours" selected={!allDay} onPress={() => setAllDay(false)} />
          </ChipRow>

          {!allDay ? (
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <View style={{ flex: 1 }}>
                <TextField label="Start" value={startTime} onChangeText={setStartTime} placeholder="10:00" />
              </View>
              <View style={{ flex: 1 }}>
                <TextField label="End" value={endTime} onChangeText={setEndTime} placeholder="13:00" />
              </View>
            </View>
          ) : null}

          <TextField
            label="Reason (internal, not shown to patients)"
            value={reason}
            onChangeText={setReason}
            placeholder="Annual leave, conference, hospital duty…"
          />

          {formError ? <InlineNotice message={formError} tone="warning" /> : null}
          {failure ? <InlineNotice message={describeError(failure).message} /> : null}

          <Card variant="flat" style={{ backgroundColor: color.surfaceAlt, gap: spacing.xs }}>
            <Text variant="bodyStrong">What this does</Text>
            <Text variant="small">
              Future patients stop seeing slots inside the range. If an existing booking overlaps it, you get a resolution
              list here and the patient keeps their appointment until you act.
            </Text>
          </Card>
        </View>
      </Sheet>
    </Screen>
  );
}
