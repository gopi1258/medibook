/**
 * Appointment detail (doctor side) — PRD §7.2 / DOC-010…DOC-015.
 *
 * One screen carries every lifecycle action the doctor owns: accept, decline,
 * reschedule from open slots, cancel with a mandatory reason (auto full refund),
 * mark no-show, mark completed, and the scoped patient context.
 *
 * State machine guards live on the server; this screen only offers the transitions
 * that are legal for the appointment's current status, and it surfaces
 * `APT_STATE_CONFLICT` honestly when another device moved it first.
 */
import * as React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { ApiError, isJoinWindowOpen, toAppointmentCardModel } from '@medibook/core';
import {
  AppointmentCard,
  Badge,
  Button,
  Card,
  Icon,
  ListRow,
  PolicyNote,
  Screen,
  ScreenHeader,
  SectionHeading,
  Sheet,
  SheetRow,
  Text,
  TextArea,
  color,
  spacing,
} from '@medibook/brand';

import {
  useAppointmentAction,
  useDoctorAppointment,
  usePatientContext,
  usePolicy,
} from '../../../src/lib/hooks';
import { useClinicTimeZone } from '../../../src/lib/session';
import { useNow } from '../../../src/lib/useNow';
import {
  ageLabel,
  appointmentLongDateLabel,
  appointmentClockLabel,
  consultTypeLabel,
  describeError,
  formatMoney,
  genderLabel,
} from '../../../src/lib/format';
import { DetailRow, ErrorState, InlineNotice, ListSkeleton } from '../../../src/components/states';

export default function DoctorAppointmentDetailScreen() {
  const router = useRouter();
  const { appointmentId } = useLocalSearchParams<{ appointmentId?: string }>();
  const clinicTz = useClinicTimeZone();
  const now = useNow(1000);

  const appointment = useDoctorAppointment(appointmentId);
  const context = usePatientContext(appointmentId ? appointmentId : undefined);
  const policy = usePolicy();

  const accept = useAppointmentAction('accept');
  const decline = useAppointmentAction('decline');
  const complete = useAppointmentAction('complete');
  const noShow = useAppointmentAction('no-show');

  const [declineOpen, setDeclineOpen] = React.useState(false);
  const [declineReason, setDeclineReason] = React.useState('Slot no longer available');
  const [joinedAt, setJoinedAt] = React.useState<number | null>(null);
  const [inCall, setInCall] = React.useState(false);
  const [failure, setFailure] = React.useState<unknown>(null);

  const data = appointment.data;
  const joinOpen = data ? isJoinWindowOpen(data, { nowMs: now }) : false;
  const graceMinutes =
    data?.consult_type === 'video'
      ? (policy.data?.no_show_grace_minutes_video ?? 10)
      : (policy.data?.no_show_grace_minutes_clinic ?? 15);
  const gracePassed = data ? now >= Date.parse(data.start_utc) + graceMinutes * 60_000 : false;
  const callSeconds = joinedAt ? Math.max(0, Math.floor((now - joinedAt) / 1000)) : 0;

  return (
    <Screen
      scroll
      edges={['top']}
      contentContainerStyle={{ gap: spacing.xl, paddingBottom: spacing.huge }}
      refreshing={appointment.isRefetching && !appointment.isLoading}
      onRefresh={() => void appointment.refetch()}
    >
      <ScreenHeader
        title={data ? data.for_name : 'Appointment'}
        subtitle={data?.code}
        onBack={() => router.back()}
        action={{ icon: 'help', onPress: () => router.push('/settings/help'), accessibilityLabel: 'Help' }}
      />

      {appointment.isLoading ? (
        <ListSkeleton count={3} />
      ) : appointment.isError || !data ? (
        <ErrorState error={appointment.error} onRetry={() => void appointment.refetch()} />
      ) : (
        <>
          <AppointmentCard
            viewer="doctor"
            appointment={toAppointmentCardModel(data, { viewerTz: clinicTz, nowMs: now })}
            onJoin={() => {
              if (data.status === 'in_progress') {
                setJoinedAt((current) => current ?? Date.now());
                setInCall(true);
              } else {
                setJoinedAt(Date.now());
                setInCall(true);
              }
            }}
            onReschedule={() => router.push(`/appointment/${data.id}/reschedule`)}
            onCancel={() => router.push(`/appointment/${data.id}/cancel`)}
          />

          {failure ? <InlineNotice message={describeError(failure).message} /> : null}

          <View style={{ gap: spacing.md }}>
            <SectionHeading title="Visit" />
            <Card variant="flat" style={{ gap: spacing.md }}>
              <DetailRow label="Patient" value={data.for_name} />
              <DetailRow label="Booked by" value={data.patient_name} />
              <DetailRow label="Consultation" value={consultTypeLabel(data.consult_type)} />
              <DetailRow
                label="When"
                value={`${appointmentLongDateLabel(data, clinicTz)} · ${appointmentClockLabel(data, clinicTz)}`}
              />
              <DetailRow label="Timezone" value={data.doctor_timezone.replace(/_/g, ' ')} />
              <DetailRow label="Fee" value={data.fee_minor === 0 ? 'Free' : formatMoney(data.fee_minor, data.currency)} />
              <DetailRow label="Payment" value={data.payment ? data.payment.status : 'No payment'} />
              {data.patient_note ? <DetailRow label="Patient note" value={data.patient_note} /> : null}
              {data.cancel_reason ? <DetailRow label="Cancelled" value={`${data.cancelled_by}: ${data.cancel_reason}`} /> : null}
            </Card>
          </View>

          <View style={{ gap: spacing.md }}>
            <SectionHeading
              title="Patient context"
              action={
                <Button
                  label="Full context"
                  size="sm"
                  variant="ghost"
                  block={false}
                  onPress={() => router.push(`/appointment/${data.id}/patient`)}
                />
              }
            />
            {context.isLoading ? (
              <ListSkeleton count={1} />
            ) : context.isError ? (
              <ErrorState error={context.error} onRetry={() => void context.refetch()} compact />
            ) : context.data ? (
              <Card variant="flat" style={{ gap: spacing.md }}>
                <DetailRow
                  label="Patient"
                  value={`${context.data.display_name} · ${ageLabel(context.data.age)} · ${genderLabel(context.data.gender)}`}
                />
                {context.data.relationship ? <DetailRow label="Relationship" value={context.data.relationship} /> : null}
                {context.data.phone_masked ? <DetailRow label="Phone" value={context.data.phone_masked} /> : null}
                <DetailRow
                  label="History with you"
                  value={`${context.data.completed_count_with_doctor} completed · ${context.data.no_show_count_with_doctor} no-show`}
                />
                {context.data.visits_with_doctor.length > 0 ? (
                  <View style={{ gap: spacing.xs }}>
                    <Text variant="label">Recent visits with you</Text>
                    {context.data.visits_with_doctor.slice(0, 4).map((visit) => (
                      <Text key={visit.appointment_id} variant="small">
                        {visit.start_utc.slice(0, 10)} · {visit.status.replace(/_/g, ' ')} ·{' '}
                        {consultTypeLabel(visit.consult_type)}
                        {visit.note ? ` · ${visit.note}` : ''}
                      </Text>
                    ))}
                  </View>
                ) : (
                  <Text variant="small">First visit with you.</Text>
                )}
                <Text variant="caption">
                  This view is scoped to your own visits only. Visits with other clinicians are never visible.
                </Text>
              </Card>
            ) : null}
          </View>

          <View style={{ gap: spacing.md }}>
            <SectionHeading title="Actions" />
            <Card variant="flat">
              {data.status === 'pending_approval' ? (
                <>
                  <ListRow
                    title="Accept request"
                    subtitle="Confirms the appointment and notifies the patient"
                    icon="check-circle"
                    onPress={() => accept.mutate({ appointmentId: data.id }, { onError: setFailure })}
                  />
                  <ListRow
                    title="Decline request"
                    subtitle="Full refund is triggered automatically"
                    icon="close"
                    destructive
                    onPress={() => setDeclineOpen(true)}
                  />
                </>
              ) : null}

              {data.status === 'confirmed' || data.status === 'in_progress' ? (
                <>
                  {data.consult_type === 'video' ? (
                    <ListRow
                      title={joinOpen ? 'Join video consult' : 'Join window not open'}
                      subtitle={
                        joinOpen
                          ? 'Opens T−5m and stays open for 15 minutes after the start'
                          : `Available from ${appointmentClockLabel({ ...data, start_utc: new Date(Date.parse(data.start_utc) - 5 * 60_000).toISOString() }, clinicTz)}`
                      }
                      icon="video"
                      disabled={!joinOpen && data.status !== 'in_progress'}
                      onPress={() => {
                        setJoinedAt((current) => current ?? Date.now());
                        setInCall(true);
                      }}
                    />
                  ) : null}
                  <ListRow
                    title="Reschedule from my open slots"
                    subtitle="Moves the appointment and notifies the patient with a revert offer"
                    icon="refresh"
                    onPress={() => router.push(`/appointment/${data.id}/reschedule`)}
                  />
                  <ListRow
                    title="Mark completed"
                    subtitle="Closes the visit and opens the patient’s review window"
                    icon="check"
                    onPress={() => complete.mutate({ appointmentId: data.id }, { onError: setFailure })}
                  />
                  <ListRow
                    title={gracePassed ? 'Mark no-show' : `No-show available after ${graceMinutes} min`}
                    subtitle="Fee policy applies; the patient can dispute it"
                    icon="alert-circle"
                    disabled={!gracePassed}
                    onPress={() => noShow.mutate({ appointmentId: data.id }, { onError: setFailure })}
                  />
                  <ListRow
                    title="Cancel appointment"
                    subtitle="Always a full refund, with an apology and rebooking help"
                    icon="close"
                    destructive
                    onPress={() => router.push(`/appointment/${data.id}/cancel`)}
                  />
                </>
              ) : null}

              {['completed', 'cancelled', 'no_show'].includes(data.status) ? (
                <ListRow
                  title="Open patient context"
                  subtitle="History with you, no-show count and booking notes"
                  icon="user"
                  onPress={() => router.push(`/appointment/${data.id}/patient`)}
                />
              ) : null}
            </Card>
          </View>

          {data.status === 'pending_approval' ? (
            <PolicyNote
              tone="warning"
              title="Waiting for your decision"
              body={`This request auto-declines after ${policy.data?.approval_auto_decline_minutes ?? 15} minutes with a full refund to the patient.`}
            />
          ) : null}

          {data.status === 'in_progress' ? (
            <PolicyNote tone="success" title="Consultation in progress" body="Mark it completed when you finish, or no-show if the patient never joined." />
          ) : null}
        </>
      )}

      <Sheet
        visible={declineOpen}
        onClose={() => setDeclineOpen(false)}
        title="Decline this request"
        subtitle="The patient is refunded in full and offered alternatives"
        footer={
          <View style={{ gap: spacing.sm }}>
            <Button
              label="Decline and refund"
              variant="destructive"
              onPress={() => {
                setDeclineOpen(false);
                if (data) decline.mutate({ appointmentId: data.id, reason: declineReason }, { onError: setFailure });
              }}
            />
            <Button label="Keep the request" variant="ghost" onPress={() => setDeclineOpen(false)} />
          </View>
        }
      >
        <View style={{ gap: spacing.lg }}>
          <Text variant="small">
            Declining frees the slot immediately and is recorded against the appointment trail. The patient sees the reason
            category and a rebooking shortcut.
          </Text>
          <TextArea label="Reason" value={declineReason} onChangeText={setDeclineReason} maxLength={200} />
          <PolicyNote
            tone="info"
            title="Declines are monitored"
            body="A high decline rate is a marketplace signal, and repeated declines cost you ranking in discovery."
          />
        </View>
      </Sheet>

      <Sheet
        visible={inCall}
        onClose={() => setInCall(false)}
        title="Video consultation"
        subtitle={data ? `${data.for_name} · ${data.code}` : undefined}
        footer={
          <Button
            label="End consultation"
            variant="destructive"
            onPress={() => {
              setInCall(false);
              void appointment.refetch();
            }}
          />
        }
      >
        <View style={{ gap: spacing.lg }}>
          <View
            style={{
              height: 200,
              borderRadius: 20,
              backgroundColor: color.dark,
              alignItems: 'center',
              justifyContent: 'center',
              gap: spacing.sm,
            }}
          >
            <Icon name="video" size={40} color="#FFFFFF" />
            <Text variant="bodyStrong" color="#FFFFFF">
              {Math.floor(callSeconds / 60)}:{String(callSeconds % 60).padStart(2, '0')}
            </Text>
            <Text variant="caption" color="#E5E7EB">
              Simulated call · no WebRTC vendor configured
            </Text>
          </View>
          <SheetRow label="Patient" value={data?.for_name ?? '—'} />
          <SheetRow label="Note on file" value={data?.patient_note ?? 'None'} tone="muted" />
          <PolicyNote
            tone="info"
            title="After the call"
            body="Mark the appointment completed to close it and open the review window. If the patient never joined, wait out the grace period and mark a no-show."
          />
        </View>
      </Sheet>

      {data && data.status === 'cancelled' ? (
        <Card variant="flat" style={{ backgroundColor: color.dangerTint, gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
            <Icon name="alert-circle" size={18} color={color.danger} />
            <Text variant="bodyStrong" color={color.danger}>
              Cancelled by {data.cancelled_by ?? 'unknown'}
            </Text>
            <Badge label="Refunded per policy" tone="danger" />
          </View>
          <Text variant="small">{data.cancel_reason ?? 'No reason recorded.'}</Text>
        </Card>
      ) : null}

      {failure instanceof ApiError && failure.code === 'APT_STATE_CONFLICT' ? (
        <PolicyNote
          tone="warning"
          title="This appointment changed elsewhere"
          body={`${failure.message} Reload to see the current state before acting.`}
        />
      ) : null}

    </Screen>
  );
}
