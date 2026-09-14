/**
 * Appointment detail (PRD §7.1 / APT-006) — the single place a patient acts on a
 * booking: join video, reschedule, cancel, directions, add to calendar, receipt
 * and help.
 *
 * APT-009 (join video) is implemented end to end against the contract: the join
 * window is evaluated with `isJoinWindowOpen` (T−5m → T+grace), joining calls
 * `startConsult` which mints a room token and moves the appointment to
 * `in_progress`, and the in-call shell offers mute/camera/end plus a timer. The
 * call itself is simulated — no WebRTC vendor is configured (TRD §2 puts 100ms /
 * Daily behind a provider port).
 */
import * as React from 'react';
import { Linking, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient, useQuery } from '@tanstack/react-query';

import {
  ApiError,
  cancellationPolicy,
  formatMoney,
  isJoinWindowOpen,
} from '@medibook/core';
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
  color,
  spacing,
} from '@medibook/brand';
import { toAppointmentCardModel } from '@medibook/core';

import { patientApi } from '../../../src/lib/api';
import { useAppointment, usePatientProfile } from '../../../src/lib/hooks';
import { useViewerTimeZone } from '../../../src/lib/session';
import { useNow } from '../../../src/lib/useNow';
import {
  appointmentLongDateLabel,
  appointmentClockLabel,
  appointmentTzLabel,
  consultTypeLabel,
  describeError,
} from '../../../src/lib/format';
import { DetailRow, ErrorState, InlineNotice, ListSkeleton } from '../../../src/components/states';

export default function AppointmentDetailScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { appointmentId } = useLocalSearchParams<{ appointmentId?: string }>();
  const viewerTz = useViewerTimeZone();
  const now = useNow(1000);

  const appointment = useAppointment(appointmentId);
  const profile = usePatientProfile();

  const [preJoinOpen, setPreJoinOpen] = React.useState(false);
  const [inCall, setInCall] = React.useState(false);
  const [joinedAt, setJoinedAt] = React.useState<number | null>(null);
  const [muted, setMuted] = React.useState(false);
  const [cameraOn, setCameraOn] = React.useState(true);
  const [joining, setJoining] = React.useState(false);
  const [receiptOpen, setReceiptOpen] = React.useState(false);
  const [failure, setFailure] = React.useState<unknown>(null);
  const [calendarAdded, setCalendarAdded] = React.useState(false);

  const data = appointment.data;
  const joinOpen = data ? isJoinWindowOpen(data, { nowMs: now }) : false;
  const policy = data ? cancellationPolicy({ startUtc: data.start_utc, nowMs: now, feeMinor: data.fee_minor, currency: data.currency, actor: 'patient' }) : null;

  // The server owns the reschedule verdict (R3) — never re-derive it locally.
  const reschedulePreview = useQuery({
    queryKey: ['appointment', appointmentId ?? 'unknown', 'reschedule-preview'],
    queryFn: () => patientApi.reschedulePreview(appointmentId as string),
    enabled: Boolean(appointmentId) && data !== undefined,
  });
  const canReschedule = reschedulePreview.data?.allowed ?? false;

  const refresh = React.useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['appointment'] }),
      queryClient.invalidateQueries({ queryKey: ['appointments'] }),
      queryClient.invalidateQueries({ queryKey: ['notifications'] }),
    ]);
  }, [queryClient]);

  const join = async () => {
    if (!appointmentId) return;
    setJoining(true);
    setFailure(null);
    try {
      const updated = await patientApi.startConsult(appointmentId);
      setJoinedAt(Date.now());
      setInCall(true);
      setPreJoinOpen(false);
      void updated;
      await refresh();
    } catch (caught) {
      setFailure(caught);
    } finally {
      setJoining(false);
    }
  };

  const openDirections = async () => {
    if (!data?.clinic_address) return;
    try {
      await Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(data.clinic_address)}`);
      setFailure(null);
    } catch {
      setFailure(new Error(`We could not open maps. Address: ${data.clinic_address}`));
    }
  };

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
        title="Appointment"
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
            appointment={toAppointmentCardModel(data, { viewerTz, nowMs: now })}
            onReschedule={() => router.push(`/appointment/${data.id}/reschedule`)}
            onCancel={() => router.push(`/appointment/${data.id}/cancel`)}
            onRate={() => router.push(`/appointment/${data.id}/review`)}
            onDirections={() => void openDirections()}
          />

          {failure ? <InlineNotice message={describeError(failure).message} /> : null}

          <View style={{ gap: spacing.md }}>
            <SectionHeading title="Details" />
            <Card variant="flat" style={{ gap: spacing.md }}>
              <DetailRow label="Doctor" value={data.doctor_name} />
              <DetailRow label="Specialty" value={data.doctor_specialty} />
              <DetailRow label="For" value={data.for_name} />
              <DetailRow label="Consultation" value={consultTypeLabel(data.consult_type)} />
              <DetailRow
                label="Date & time"
                value={`${appointmentLongDateLabel(data, viewerTz)} · ${appointmentClockLabel(data, viewerTz)}`}
              />
              <DetailRow label="Timezone" value={appointmentTzLabel(data, viewerTz)} />
              {data.clinic_address ? <DetailRow label="Location" value={data.clinic_address} /> : null}
              {data.patient_note ? <DetailRow label="Your note" value={data.patient_note} /> : null}
              <DetailRow label="Booked on" value={data.created_at.slice(0, 10)} />
              {data.reschedule_count > 0 ? (
                <DetailRow label="Rescheduled" value={`${data.reschedule_count} time${data.reschedule_count === 1 ? '' : 's'}`} />
              ) : null}
            </Card>
          </View>

          {data.consult_type === 'video' ? (
            <View style={{ gap: spacing.md }}>
              <SectionHeading title="Video consultation" />
              <Card variant="flat" style={{ gap: spacing.md }}>
                <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                  <Icon name={joinOpen ? 'video' : 'clock'} size={18} color={joinOpen ? color.success : color.textMuted} />
                  <Text variant="bodyMedium">
                    {joinOpen
                      ? 'You can join now'
                      : `The join button opens 5 minutes before ${appointmentClockLabel(data, viewerTz)}`}
                  </Text>
                </View>
                <Text variant="small">
                  {data.status === 'in_progress'
                    ? 'You are currently in this consultation.'
                    : 'Have your camera and microphone ready, and sit somewhere quiet with a stable connection.'}
                </Text>
                <Button
                  label={data.status === 'in_progress' ? 'Return to the call' : 'Join video consult'}
                  icon="video"
                  disabled={!joinOpen && data.status !== 'in_progress'}
                  onPress={() => {
                    if (data.status === 'in_progress') {
                      setJoinedAt((current) => current ?? Date.now());
                      setInCall(true);
                    } else {
                      setPreJoinOpen(true);
                    }
                  }}
                />
                {!joinOpen && data.status !== 'in_progress' ? (
                  <Text variant="caption">
                    Joining early is intentionally disabled: the doctor is not in the room until the window opens.
                  </Text>
                ) : null}
              </Card>
            </View>
          ) : null}

          <View style={{ gap: spacing.md }}>
            <SectionHeading title="Actions" />
            <Card variant="flat">
              <ListRow
                title="Reschedule"
                subtitle={canReschedule ? 'Pick a new time with the same doctor — free' : 'Not available for this visit'}
                icon="refresh"
                disabled={!canReschedule}
                onPress={() => router.push(`/appointment/${data.id}/reschedule`)}
              />
              <ListRow
                title="Cancel appointment"
                subtitle={policy ? policy.summary : undefined}
                icon="close"
                destructive
                disabled={!['confirmed', 'pending_approval'].includes(data.status)}
                onPress={() => router.push(`/appointment/${data.id}/cancel`)}
              />
              <ListRow
                title={calendarAdded ? 'Added to your calendar' : 'Add to calendar'}
                subtitle="Timezone-correct, with the join link for video consults"
                icon="calendar-plus"
                onPress={() => setCalendarAdded(true)}
              />
              {data.clinic_address ? (
                <ListRow
                  title="Get directions"
                  subtitle={data.clinic_name ?? undefined}
                  icon="map-pin"
                  onPress={() => void openDirections()}
                />
              ) : null}
              <ListRow title="Receipt & payment" subtitle={data.payment ? `${data.payment.status} · ${formatMoney(data.payment.amount_minor, data.currency)}` : 'Nothing to pay'} icon="receipt" onPress={() => setReceiptOpen(true)} />
              <ListRow
                title={data.review_id ? 'Your review' : 'Rate this visit'}
                subtitle={['completed', 'no_show'].includes(data.status) ? 'One review per completed visit' : 'Available after the visit completes'}
                icon="star"
                disabled={!['completed', 'no_show'].includes(data.status)}
                onPress={() => router.push(`/appointment/${data.id}/review`)}
              />
              <ListRow title="Help with this appointment" icon="help" onPress={() => router.push('/settings/help')} />
              {['completed', 'cancelled', 'no_show'].includes(data.status) ? (
                <ListRow
                  title="Rebook this doctor"
                  subtitle="Same doctor, same consultation type"
                  icon="calendar"
                  onPress={() =>
                    router.push({
                      pathname: '/slots/[doctorId]',
                      params: { doctorId: data.doctor_id, consultType: data.consult_type },
                    })
                  }
                />
              ) : null}
            </Card>
          </View>

          {calendarAdded ? (
            <PolicyNote
              tone="info"
              title="Calendar handoff is simulated here"
              body="No native calendar module is bundled in this build, so nothing was written to your device calendar. Production exports a timezone-correct .ics or hands off to the native calendar intent (APT-013)."
            />
          ) : null}

          <Card variant="flat" style={{ backgroundColor: color.surfaceAlt, gap: spacing.xs }}>
            <Text variant="bodyStrong">Who can see this visit?</Text>
            <Text variant="small">
              You, and {data.doctor_name} — scoped to visits with them only. Your phone number is masked from the doctor
              unless you share it. Other family members’ bookings never appear on your doctor’s side.
            </Text>
            {profile.data?.emergency_contact ? (
              <Text variant="caption">Emergency contact on file: {profile.data.emergency_contact}</Text>
            ) : null}
          </Card>
        </>
      )}

      {/* Pre-join check (APT-009). */}
      <Sheet
        visible={preJoinOpen}
        onClose={() => setPreJoinOpen(false)}
        title="Ready to join?"
        subtitle="A quick check before the room opens"
        footer={
          <View style={{ gap: spacing.sm }}>
            <Button label={joining ? 'Joining…' : 'Join now'} loading={joining} icon="video" onPress={() => void join()} />
            <Button label="Not yet" variant="ghost" onPress={() => setPreJoinOpen(false)} />
          </View>
        }
      >
        <View style={{ gap: spacing.md }}>
          <CheckRow label="Camera and microphone" detail="Permissions are requested when the room opens. Allow both for a proper consultation." icon="camera" />
          <CheckRow label="Connection" detail="Wi-Fi or 4G recommended. If the connection drops you can rejoin during the window." icon="refresh" />
          <CheckRow label="Privacy" detail="The consultation is not recorded by MediBook. No video vendor is configured in this build." icon="lock" />
          <PolicyNote
            tone="warning"
            title="If the doctor is late"
            body="After the grace period you will see an honest status and can flag a no-show, which opens the refund path. You never lose money because the other side did not turn up."
          />
        </View>
      </Sheet>

      {/* Simulated in-call shell (APT-009). */}
      <Sheet
        visible={inCall}
        onClose={() => setInCall(false)}
        title="Video consultation"
        subtitle={data ? `${data.doctor_name} · ${data.code}` : undefined}
        footer={
          <Button
            label="End consultation"
            variant="destructive"
            icon="close"
            onPress={() => {
              setInCall(false);
              void refresh();
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
              Simulated call · no WebRTC vendor connected
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <Button label={muted ? 'Unmute' : 'Mute'} variant="secondary" block={false} onPress={() => setMuted((value) => !value)} />
            <Button label={cameraOn ? 'Camera off' : 'Camera on'} variant="secondary" block={false} onPress={() => setCameraOn((value) => !value)} />
          </View>
          <PolicyNote
            tone="info"
            title="What happens after the call"
            body="The doctor marks the visit complete, which opens the rating window. If the consultation could not happen, flag it and the refund path opens automatically."
          />
        </View>
      </Sheet>

      <Sheet
        visible={receiptOpen}
        onClose={() => setReceiptOpen(false)}
        title="Receipt"
        footer={<Button label="Close" variant="secondary" onPress={() => setReceiptOpen(false)} />}
      >
        {data ? (
          <View style={{ gap: spacing.md }}>
            <SheetRow label="Appointment" value={data.code} />
            <SheetRow label="Consultation" value={consultTypeLabel(data.consult_type)} />
            <SheetRow label="Fee" value={formatMoney(data.fee_minor, data.currency)} />
            {data.payment ? (
              <>
                <SheetRow label="Method" value={data.payment.method.toUpperCase()} />
                <SheetRow label="Status" value={data.payment.status} tone={data.payment.status === 'refunded' ? 'danger' : 'success'} />
                <SheetRow label="Provider ref" value={data.payment.provider_ref} tone="muted" />
                <SheetRow label="Paid at" value={data.payment.created_at.slice(0, 16).replace('T', ' ')} tone="muted" />
              </>
            ) : (
              <SheetRow label="Payment" value="No payment required" tone="muted" />
            )}
            {data.refund ? (
              <>
                <SheetRow label="Refund" value={formatMoney(data.refund.amount_minor, data.refund.currency)} />
                <SheetRow label="Refund tier" value={`${data.refund.tier_percent}%`} />
                <SheetRow label="Refund status" value={data.refund.status} tone="danger" />
                <PolicyNote
                  tone="warning"
                  title="Refund lifecycle"
                  body="Refunds move initiated → processing → completed. If the gateway rejects one we retry with backoff and escalate to the refunds queue; you always see the honest status here."
                />
              </>
            ) : null}
          </View>
        ) : (
          <ListSkeleton count={2} />
        )}
      </Sheet>

      {data && data.status === 'cancelled' ? (
        <Card variant="flat" style={{ backgroundColor: color.dangerTint, gap: spacing.xs }}>
          <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
            <Icon name="alert-circle" size={18} color={color.danger} />
            <Text variant="bodyStrong" color={color.danger}>
              Cancelled
            </Text>
            <Badge label={data.cancelled_by ?? 'unknown'} tone="danger" />
          </View>
          <Text variant="small">{data.cancel_reason ?? 'No reason recorded.'}</Text>
        </Card>
      ) : null}

      {data && data.status === 'pending_approval' ? (
        <PolicyNote
          tone="warning"
          title="Waiting for the doctor to accept"
          body="If the doctor does not respond within the approval window the booking is declined automatically and refunded in full. You will get an alert either way."
        />
      ) : null}

      {data && data.status === 'no_show' ? (
        <PolicyNote
          tone="danger"
          title="Marked as a no-show"
          body="The doctor recorded that the visit did not happen. If that is wrong, contact support and we will review the appointment trail."
        />
      ) : null}

      {failure instanceof ApiError && failure.code === 'APT_STATE_CONFLICT' ? (
        <PolicyNote tone="warning" title="This appointment changed" body={failure.message} />
      ) : null}
    </Screen>
  );
}

function CheckRow({
  label,
  detail,
  icon,
}: {
  label: string;
  detail: string;
  icon: 'camera' | 'refresh' | 'lock';
}) {
  return (
    <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}>
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: color.primaryTint,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} size={18} color={color.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong">{label}</Text>
        <Text variant="small">{detail}</Text>
      </View>
    </View>
  );
}
