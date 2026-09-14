/**
 * Doctor cancel (DOC-013 / R8) — a reason is mandatory and the refund is always
 * full, because the patient did nothing wrong.
 *
 * Cancelling is the destructive path, so the sheet spells out the consequences in
 * order: refund, patient notification with rebooking help, slot freed, and the
 * pattern-monitoring note. Nothing here can silently strand a patient.
 */
import * as React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { formatMoney } from '@medibook/core';
import {
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

import { useAppointmentAction, useDoctorAppointment } from '../../../src/lib/hooks';
import { useClinicTimeZone } from '../../../src/lib/session';
import { useNow } from '../../../src/lib/useNow';
import { appointmentTimeLabel, consultTypeLabel, describeError } from '../../../src/lib/format';
import { InlineNotice, ListSkeleton } from '../../../src/components/states';

const REASONS = [
  'Emergency — cannot attend',
  'Running late beyond the appointment',
  'Clinic closed unexpectedly',
  'Patient moved to another clinician',
  'Illness',
  'Other',
];

export default function DoctorCancelScreen() {
  const router = useRouter();
  const { appointmentId } = useLocalSearchParams<{ appointmentId?: string }>();
  const clinicTz = useClinicTimeZone();
  const now = useNow(30_000);

  const appointment = useDoctorAppointment(appointmentId);
  const cancel = useAppointmentAction('cancel');

  const [reason, setReason] = React.useState(REASONS[0]!);
  const [note, setNote] = React.useState('');
  const [failure, setFailure] = React.useState<unknown>(null);

  const data = appointment.data;

  const submit = async () => {
    if (!appointmentId) return;
    setFailure(null);
    try {
      await cancel.mutateAsync({
        appointmentId,
        reason: note.trim().length > 0 ? `${reason} — ${note.trim()}` : reason,
      });
      router.replace('/(tabs)/appointments');
    } catch (caught) {
      setFailure(caught);
    }
  };

  return (
    <Sheet
      visible
      onClose={() => router.back()}
      title="Cancel this appointment"
      subtitle={data ? `${data.for_name} · ${data.code}` : 'Loading…'}
      footer={
        <View style={{ gap: spacing.sm }}>
          <Button
            label={cancel.isPending ? 'Cancelling…' : 'Cancel appointment and refund in full'}
            variant="destructive"
            loading={cancel.isPending}
            disabled={!data || cancel.isPending}
            onPress={() => void submit()}
          />
          <Button label="Keep the appointment" variant="ghost" onPress={() => router.back()} />
        </View>
      }
    >
      {appointment.isLoading ? (
        <ListSkeleton count={2} />
      ) : !data ? (
        <InlineNotice message={describeError(appointment.error).message} />
      ) : (
        <View style={{ gap: spacing.lg }}>
          <Card variant="flat" style={{ gap: spacing.md }}>
            <SheetRow label="Patient" value={data.for_name} emphasis />
            <SheetRow label="When" value={appointmentTimeLabel(data, clinicTz, now)} />
            <SheetRow label="Consultation" value={consultTypeLabel(data.consult_type)} />
            <SheetRow
              label="Refund"
              value={data.fee_minor === 0 ? 'Nothing to refund' : `${formatMoney(data.fee_minor, data.currency)} (100%)`}
              tone="success"
            />
          </Card>

          <PolicyNote
            tone="warning"
            title="A full refund is automatic"
            body="Patient-initiated cancellations are tiered, but a clinic-side cancellation is always refunded in full with no fee. This runs on the platform, not on you."
          />

          <View style={{ gap: spacing.sm }}>
            <Text variant="label">Reason (shared with the patient)</Text>
            <ChipRow>
              {REASONS.map((option) => (
                <Chip key={option} label={option} selected={reason === option} onPress={() => setReason(option)} />
              ))}
            </ChipRow>
          </View>

          <TextArea
            label="Apology note (optional)"
            value={note}
            onChangeText={setNote}
            placeholder="The patient sees this alongside the rebooking shortcut."
            maxLength={300}
          />

          <Card variant="flat" style={{ gap: spacing.sm, backgroundColor: color.surfaceAlt }}>
            <Text variant="bodyStrong">What happens next</Text>
            <Text variant="small">1. The slot is freed immediately and can be rebooked.</Text>
            <Text variant="small">
              2. {data.for_name} gets an apology message, the refund status, and a one-tap rebooking link.
            </Text>
            <Text variant="small">3. Any queued reminders for this appointment are cancelled.</Text>
            <Text variant="small">4. The cancellation is recorded on the appointment trail for support.</Text>
          </Card>

          {failure ? <InlineNotice message={describeError(failure).message} /> : null}

          <Text variant="caption">
            Clinic-initiated cancellations are monitored: a persistently high rate triggers a marketplace review and
            affects discovery ranking.
          </Text>
        </View>
      )}
    </Sheet>
  );
}
