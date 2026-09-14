/**
 * Appointments (PRD §7.2 / DOC-010, DOC-011) — Upcoming · Pending approval · Past
 * segmented list with the accept/decline queue surfaced as a badge.
 *
 * Manual-approval mode is the only place a booking needs a doctor decision, so
 * the pending segment explains the auto-decline window rather than leaving the
 * doctor to guess (R13).
 */
import * as React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { toAppointmentCardModel } from '@medibook/core';
import {
  AppointmentCard,
  Badge,
  Button,
  Card,
  EmptyState,
  PolicyNote,
  Screen,
  ScreenHeader,
  SectionHeading,
  SegmentedControl,
  Text,
  color,
  spacing,
} from '@medibook/brand';
import type { AppointmentListQuery } from '@medibook/core';

import { useAppointmentAction, useDoctorAppointments, usePolicy } from '../../src/lib/hooks';
import { useClinicTimeZone } from '../../src/lib/session';
import { useNow } from '../../src/lib/useNow';
import { describeError } from '../../src/lib/format';
import { ErrorState, InlineNotice, ListSkeleton } from '../../src/components/states';

type Scope = 'upcoming' | 'pending' | 'past';

export default function DoctorAppointmentsScreen() {
  const router = useRouter();
  const clinicTz = useClinicTimeZone();
  const now = useNow(30_000);
  const params = useLocalSearchParams<{ scope?: string }>();

  const [scope, setScope] = React.useState<Scope>(
    params.scope === 'pending' ? 'pending' : params.scope === 'past' ? 'past' : 'upcoming',
  );
  const [failure, setFailure] = React.useState<unknown>(null);

  const policy = usePolicy();
  const pendingCount = useDoctorAppointments({ scope: 'pending', limit: 50 });

  const query = React.useMemo<AppointmentListQuery>(() => ({ scope, limit: 50 }), [scope]);
  const appointments = useDoctorAppointments(query);
  const accept = useAppointmentAction('accept');
  const decline = useAppointmentAction('decline');

  const items = appointments.data?.items ?? [];

  return (
    <Screen
      scroll
      edges={['top']}
      contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.huge }}
      refreshing={appointments.isRefetching && !appointments.isLoading}
      onRefresh={() => void appointments.refetch()}
    >
      <ScreenHeader title="Appointments" subtitle="Everything booked with you" />

      <SegmentedControl
        accessibilityLabel="Appointment list view"
        options={[
          { value: 'upcoming', label: 'Upcoming' },
          { value: 'pending', label: 'Pending', badge: pendingCount.data?.items.length || undefined },
          { value: 'past', label: 'Past' },
        ]}
        value={scope}
        onChange={(next) => setScope(next as Scope)}
      />

      {policy.data?.approval_mode === 'auto' && scope === 'pending' ? (
        <PolicyNote
          tone="info"
          title="You approve bookings automatically"
          body="This list is only used when you switch on manual approval in Schedule → Booking policy. Requests that appear while manual mode is on auto-decline after the configured window and refund the patient in full."
        />
      ) : null}

      {scope === 'pending' && policy.data?.approval_mode === 'manual' ? (
        <Card variant="flat" style={{ backgroundColor: color.starTint, gap: spacing.xs }}>
          <Text variant="bodyStrong">
            {items.length} request{items.length === 1 ? '' : 's'} waiting
          </Text>
          <Text variant="small">
            Each request auto-declines after {policy.data.approval_auto_decline_minutes} minutes with a full refund, so
            decide before then or the slot goes back to the pool.
          </Text>
        </Card>
      ) : null}

      {failure ? <InlineNotice message={describeError(failure).message} /> : null}

      {appointments.isLoading ? (
        <ListSkeleton count={3} />
      ) : appointments.isError ? (
        <ErrorState error={appointments.error} onRetry={() => void appointments.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="calendar"
          title={scope === 'pending' ? 'No requests waiting' : scope === 'past' ? 'No past appointments' : 'Nothing upcoming'}
          description={
            scope === 'pending'
              ? 'Requests land here only when manual approval is switched on.'
              : scope === 'past'
                ? 'Completed and no-show visits appear here with the patient context you recorded.'
                : 'Open slots in your weekly template will fill this list as patients book.'
          }
          actionLabel="Open my schedule"
          onAction={() => router.push('/(tabs)/schedule')}
        />
      ) : (
        <View style={{ gap: spacing.md }}>
          {items.map((appointment) => (
            <AppointmentCard
              key={appointment.id}
              viewer="doctor"
              appointment={toAppointmentCardModel(appointment, { viewerTz: clinicTz, nowMs: now })}
              onPress={() => router.push(`/appointment/${appointment.id}`)}
              onAccept={
                appointment.status === 'pending_approval'
                  ? () =>
                      accept.mutate({ appointmentId: appointment.id }, { onError: (error) => setFailure(error) })
                  : undefined
              }
              onDecline={
                appointment.status === 'pending_approval'
                  ? () =>
                      decline.mutate(
                        { appointmentId: appointment.id, reason: 'Slot no longer available' },
                        { onError: (error) => setFailure(error) },
                      )
                  : undefined
              }
              onComplete={
                appointment.status === 'confirmed' || appointment.status === 'in_progress'
                  ? () => router.push(`/appointment/${appointment.id}`)
                  : undefined
              }
              onReschedule={() => router.push(`/appointment/${appointment.id}/reschedule`)}
              onCancel={() => router.push(`/appointment/${appointment.id}/cancel`)}
              onJoin={() => router.push(`/appointment/${appointment.id}`)}
            />
          ))}
        </View>
      )}

      <View style={{ gap: spacing.sm }}>
        <SectionHeading title="Actions available per state" />
        <Card variant="flat" style={{ gap: spacing.sm }}>
          <Text variant="small">• Pending approval → accept, or decline (auto-refund + suggested alternatives).</Text>
          <Text variant="small">• Confirmed → reschedule from your open slots, cancel (always a full refund), mark completed or no-show.</Text>
          <Text variant="small">
            • Completed → the visit is closed, the patient can review, and it appears in your Patients list.
          </Text>
          <Text variant="small">
            • No-show → permitted after the grace period ({policy.data?.no_show_grace_minutes_clinic ?? 15} min clinic ·{' '}
            {policy.data?.no_show_grace_minutes_video ?? 10} min video). Patients can dispute it.
          </Text>
        </Card>
      </View>

      <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
        <Badge label={`Approval: ${policy.data?.approval_mode ?? 'auto'}`} tone="neutral" icon="check" />
        <Badge label={`Min notice ${policy.data?.min_notice_minutes ?? 120} min`} tone="neutral" icon="clock" />
        <Badge label={`Buffer ${policy.data?.buffer_minutes ?? 5} min`} tone="neutral" icon="clock" />
      </View>

      <Button label="Booking policy" variant="ghost" icon="settings" onPress={() => router.push('/schedule/policy')} />
    </Screen>
  );
}
