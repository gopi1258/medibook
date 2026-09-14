/**
 * Cancel (J7 / APT-008, R2) — reason picker, a policy preview computed by the
 * server, and the resulting refund status.
 *
 * The preview comes from `cancelPreview` so the number the patient sees before
 * confirming is the number the server will actually refund. After confirming we
 * show the refund lifecycle (APT-014) rather than a bare "done".
 */
import * as React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError, cryptoRandomIdempotencyKey, formatMoney } from '@medibook/core';
import {
  Badge,
  Button,
  Card,
  Chip,
  ChipRow,
  PolicyNote,
  Sheet,
  SheetRow,
  Text,
  TextArea,
  color,
  spacing,
} from '@medibook/brand';

import { patientApi } from '../../../src/lib/api';
import { useAppointment } from '../../../src/lib/hooks';
import { useViewerTimeZone } from '../../../src/lib/session';
import { appointmentTimeLabel, consultTypeLabel, describeError } from '../../../src/lib/format';
import { InlineNotice, ListSkeleton } from '../../../src/components/states';

const REASONS = [
  'Schedule clash',
  'Feeling better',
  'Found another doctor',
  'Cannot travel',
  'Cost',
  'Doctor asked me to cancel',
  'Other',
];

export default function CancelScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { appointmentId } = useLocalSearchParams<{ appointmentId?: string }>();
  const viewerTz = useViewerTimeZone();

  const appointment = useAppointment(appointmentId);
  const preview = useQuery({
    queryKey: ['appointment', appointmentId ?? 'unknown', 'cancel-preview'],
    queryFn: () => patientApi.cancelPreview(appointmentId as string),
    enabled: Boolean(appointmentId),
  });

  const [reason, setReason] = React.useState<string>('Schedule clash');
  const [note, setNote] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [failure, setFailure] = React.useState<unknown>(null);
  const [result, setResult] = React.useState<Awaited<ReturnType<typeof patientApi.cancelAppointment>> | null>(null);
  const idempotencyKey = React.useRef(cryptoRandomIdempotencyKey());

  const data = appointment.data;

  const submit = async () => {
    if (!appointmentId) return;
    setSubmitting(true);
    setFailure(null);
    try {
      const cancelled = await patientApi.cancelAppointment(
        appointmentId,
        { reason, note: note.trim().length > 0 ? note.trim() : null },
        idempotencyKey.current,
      );
      setResult(cancelled);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['appointment'] }),
        queryClient.invalidateQueries({ queryKey: ['appointments'] }),
        queryClient.invalidateQueries({ queryKey: ['availability'] }),
        queryClient.invalidateQueries({ queryKey: ['notifications'] }),
      ]);
    } catch (caught) {
      setFailure(caught);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet
      visible
      onClose={() => router.back()}
      title={result ? 'Appointment cancelled' : 'Cancel appointment'}
      subtitle={data ? `${data.doctor_name} · ${data.code}` : 'Loading…'}
      footer={
        result ? (
          <View style={{ gap: spacing.sm }}>
            <Button label="Book another time" onPress={() => router.replace({ pathname: '/slots/[doctorId]', params: { doctorId: result.appointment.doctor_id, consultType: result.appointment.consult_type } })} />
            <Button label="View appointment" variant="secondary" onPress={() => router.replace(`/appointment/${result.appointment.id}`)} />
            <Button label="Done" variant="ghost" onPress={() => router.back()} />
          </View>
        ) : (
          <View style={{ gap: spacing.sm }}>
            <Button
              label={submitting ? 'Cancelling…' : 'Confirm cancellation'}
              variant="destructive"
              loading={submitting}
              disabled={!data || submitting}
              onPress={() => void submit()}
            />
            <Button label="Keep my appointment" variant="ghost" onPress={() => router.back()} />
          </View>
        )
      }
    >
      {appointment.isLoading || preview.isLoading ? (
        <ListSkeleton count={2} />
      ) : !data ? (
        <InlineNotice message={describeError(appointment.error).message} />
      ) : result ? (
        <View style={{ gap: spacing.lg }}>
          <PolicyNote
            tone={result.refund && result.refund.amount_minor > 0 ? 'success' : 'warning'}
            title={result.refund && result.refund.amount_minor > 0 ? 'Refund initiated' : 'No refund due'}
            body={
              result.refund
                ? `${formatMoney(result.refund.amount_minor, result.refund.currency)} (${result.refund.tier_percent}% of the fee) is on its way back to your original payment method. Status: ${result.refund.status}.`
                : 'The cancellation policy for this timing does not include a refund. Nothing further will be charged.'
            }
          />

          <Card variant="flat" style={{ gap: spacing.md }}>
            <SheetRow label="Appointment" value={result.appointment.code} />
            <SheetRow label="Was at" value={appointmentTimeLabel(result.appointment, viewerTz)} />
            <SheetRow label="Cancelled by" value={result.appointment.cancelled_by ?? 'patient'} />
            <SheetRow label="Reason" value={result.appointment.cancel_reason ?? reason} />
            <SheetRow label="Policy applied" value={`Rule ${result.policy.rule}`} tone="muted" />
            {result.refund ? (
              <>
                <SheetRow label="Refund amount" value={formatMoney(result.refund.amount_minor, result.refund.currency)} emphasis />
                <SheetRow label="Refund status" value={result.refund.status} tone="success" />
              </>
            ) : (
              <SheetRow label="Refund" value="None" tone="muted" />
            )}
          </Card>

          <Text variant="small">
            The slot was released immediately, so another patient can take it. {data.doctor_name} has been notified.
          </Text>
        </View>
      ) : (
        <View style={{ gap: spacing.lg }}>
          <Card variant="flat" style={{ gap: spacing.md }}>
            <SheetRow label="When" value={appointmentTimeLabel(data, viewerTz)} emphasis />
            <SheetRow label="Consultation" value={consultTypeLabel(data.consult_type)} />
            <SheetRow label="For" value={data.for_name} />
            <SheetRow label="Fee paid" value={data.fee_minor === 0 ? 'Nothing — free consult' : formatMoney(data.fee_minor, data.currency)} />
          </Card>

          <PolicyNote
            tone={preview.data && preview.data.refund_percent === 100 ? 'success' : preview.data && preview.data.refund_percent === 50 ? 'warning' : 'danger'}
            title={
              preview.data
                ? preview.data.refund_percent === 100
                  ? 'Full refund'
                  : preview.data.refund_percent === 50
                    ? 'Half refund'
                    : 'No refund'
                : 'Checking policy…'
            }
            body={preview.data ? preview.data.summary : 'Working out what the policy allows right now.'}
          />

          <View style={{ gap: spacing.sm }}>
            <Text variant="label">Why are you cancelling?</Text>
            <ChipRow>
              {REASONS.map((option) => (
                <Chip key={option} label={option} selected={reason === option} onPress={() => setReason(option)} />
              ))}
            </ChipRow>
          </View>

          <TextArea
            label="Anything else? (optional)"
            value={note}
            onChangeText={setNote}
            placeholder="This is shared with the clinic to help them improve."
            maxLength={300}
          />

          <Card variant="flat" style={{ backgroundColor: color.surfaceAlt, gap: spacing.sm }}>
            <Text variant="bodyStrong">Before you cancel</Text>
            <Text variant="small">
              • Rescheduling is often a better option and stays free — you may have moves left on this appointment.
            </Text>
            <Text variant="small">
              • Cancelling inside 2 hours of the start is non-refundable; that rule is disclosed before you ever pay.
            </Text>
            <Text variant="small">• The slot is freed immediately, so acting sooner helps another patient.</Text>
            <Button
              label="Reschedule instead"
              variant="ghost"
              size="sm"
              block={false}
              onPress={() => router.replace(`/appointment/${data.id}/reschedule`)}
            />
          </Card>

          {preview.data ? (
            <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
              <Badge label={`Refund ${preview.data.refund_percent}%`} tone={preview.data.refund_percent > 0 ? 'verified' : 'danger'} icon="credit-card" />
              <Badge label={`Rule ${preview.data.rule}`} tone="neutral" icon="info" />
              {preview.data.refund_minor > 0 ? (
                <Badge label={formatMoney(preview.data.refund_minor, preview.data.currency)} tone="accent" icon="receipt" />
              ) : null}
            </View>
          ) : null}

          {failure ? <InlineNotice message={describeError(failure).message} /> : null}

          {failure instanceof ApiError && failure.code === 'APT_STATE_CONFLICT' ? (
            <Text variant="caption">
              This appointment changed on another device. Close this sheet and reload the appointment.
            </Text>
          ) : null}
        </View>
      )}
    </Sheet>
  );
}
