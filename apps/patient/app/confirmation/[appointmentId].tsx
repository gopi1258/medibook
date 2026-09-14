/**
 * Confirmation (J3 step 4) — appointment code, add-to-calendar, directions or
 * how-to-join, and the receipt.
 *
 * Deliberately the only screen in the app with a full-bleed gradient header: it
 * is the moment the booking integrity promise pays off, so it gets the most
 * visual weight.
 */
import * as React from 'react';
import { Linking, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';

import {
  Badge,
  BrandHero,
  Button,
  Card,
  Icon,
  PolicyNote,
  Screen,
  SectionHeading,
  Sheet,
  SheetRow,
  Text,
  color,
  gradient,
  spacing,
} from '@medibook/brand';

import { useAppointment } from '../../src/lib/hooks';
import { useViewerTimeZone } from '../../src/lib/session';
import {
  appointmentLongDateLabel,
  appointmentClockLabel,
  appointmentTzLabel,
  consultTypeLabel,
  formatMoney,
} from '../../src/lib/format';
import { ErrorState, InlineNotice, ListSkeleton } from '../../src/components/states';

export default function ConfirmationScreen() {
  const router = useRouter();
  const { appointmentId } = useLocalSearchParams<{ appointmentId?: string }>();
  const viewerTz = useViewerTimeZone();

  const appointment = useAppointment(appointmentId);
  const [receiptOpen, setReceiptOpen] = React.useState(false);
  const [calendarAdded, setCalendarAdded] = React.useState(false);
  const [directionsError, setDirectionsError] = React.useState<string | null>(null);

  const data = appointment.data;

  const openDirections = async () => {
    if (!data?.clinic_address) return;
    const url = `https://maps.google.com/?q=${encodeURIComponent(data.clinic_address)}`;
    try {
      await Linking.openURL(url);
      setDirectionsError(null);
    } catch {
      setDirectionsError(`We could not open maps. The clinic address is: ${data.clinic_address}`);
    }
  };

  return (
    <Screen scroll edges={['top', 'bottom']} contentContainerStyle={{ gap: spacing.xl, paddingBottom: spacing.huge }}>
      <LinearGradient
        colors={[gradient.brand[0], gradient.brand[1]]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ borderRadius: 28, padding: spacing.xl, gap: spacing.sm }}
      >
        <Icon name="check-circle" size={40} color="#FFFFFF" />
        <Text variant="h1" color="#FFFFFF">
          {data?.status === 'pending_approval' ? 'Request sent' : 'Appointment confirmed'}
        </Text>
        <Text variant="small" color="#FFF1F6">
          {data
            ? data.status === 'pending_approval'
              ? `${data.doctor_name} reviews each request — you will hear back shortly, and the request auto-expires with a full refund if they do not respond in time.`
              : 'Your slot is locked in and both sides have been notified.'
            : 'Loading your appointment…'}
        </Text>
      </LinearGradient>

      {appointment.isLoading ? (
        <ListSkeleton count={2} />
      ) : appointment.isError || !data ? (
        <ErrorState error={appointment.error} onRetry={() => void appointment.refetch()} />
      ) : (
        <>
          <Card style={{ gap: spacing.lg }}>
            <View style={{ alignItems: 'center', gap: spacing.xs }}>
              <Text variant="label">Appointment code</Text>
              <Text variant="display" accessibilityLabel={`Appointment code ${data.code}`}>
                {data.code}
              </Text>
              <Text variant="caption">Quote this at the clinic reception</Text>
            </View>

            <View style={{ gap: spacing.md }}>
              <SheetRow label="Doctor" value={data.doctor_name} emphasis />
              <SheetRow label="Specialty" value={data.doctor_specialty} tone="muted" />
              <SheetRow label="For" value={data.for_name} />
              <SheetRow label="Consultation" value={consultTypeLabel(data.consult_type)} />
              <SheetRow
                label="Date"
                value={`${appointmentLongDateLabel(data, viewerTz)} · ${appointmentClockLabel(data, viewerTz)}`}
                emphasis
              />
              <SheetRow label="Timezone" value={appointmentTzLabel(data, viewerTz)} tone="muted" />
              {data.consult_type === 'in_person' && data.clinic_address ? (
                <SheetRow label="Clinic" value={`${data.clinic_name ?? ''} · ${data.clinic_address}`} />
              ) : null}
            </View>

            <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
              <Badge
                label={data.status === 'pending_approval' ? 'Awaiting doctor' : 'Confirmed'}
                tone={data.status === 'pending_approval' ? 'warning' : 'verified'}
                icon={data.status === 'pending_approval' ? 'clock' : 'check-circle'}
              />
              <Badge
                label={data.payment ? `Paid ${formatMoney(data.payment.amount_minor, data.currency)}` : 'Nothing to pay'}
                tone={data.payment ? 'accent' : 'neutral'}
                icon="credit-card"
              />
              <Badge label={data.reschedule_count > 0 ? `Rescheduled ${data.reschedule_count}×` : 'Original time'} tone="neutral" icon="refresh" />
            </View>
          </Card>

          <View style={{ gap: spacing.md }}>
            <SectionHeading title="Next steps" />
            <View style={{ gap: spacing.sm }}>
              <Button
                label={calendarAdded ? 'Added to your calendar' : 'Add to calendar'}
                icon={calendarAdded ? 'check' : 'calendar-plus'}
                variant={calendarAdded ? 'secondary' : 'primary'}
                onPress={() => setCalendarAdded(true)}
              />
              {data.consult_type === 'in_person' ? (
                <Button label="Get directions" icon="map-pin" variant="secondary" onPress={() => void openDirections()} />
              ) : (
                <Button
                  label="How to join the video consult"
                  icon="video"
                  variant="secondary"
                  onPress={() => router.push(`/appointment/${data.id}`)}
                />
              )}
              <Button label="View appointment" icon="calendar" variant="secondary" onPress={() => router.replace(`/appointment/${data.id}`)} />
              <Button label="Go to Home" variant="ghost" onPress={() => router.replace('/(tabs)')} />
            </View>
          </View>

          {directionsError ? <InlineNotice message={directionsError} tone="warning" /> : null}

          {calendarAdded ? (
            <PolicyNote
              tone="info"
              title="Calendar handoff is simulated here"
              body="This build has no native calendar module wired in, so nothing was written to your device calendar. In production this exports a timezone-correct .ics (APT-013) or hands off to the native calendar intent."
            />
          ) : null}

          <Card variant="flat" style={{ backgroundColor: color.surfaceAlt, gap: spacing.sm }}>
            <Text variant="bodyStrong">
              {data.consult_type === 'in_person' ? 'Before you go' : 'Before you join'}
            </Text>
            <Text variant="small">
              {data.consult_type === 'in_person'
                ? 'Carry any previous prescriptions and a list of medicines you take. Arrive 10 minutes early if it is your first visit.'
                : 'Find a quiet, well-lit spot. The join button opens 5 minutes before the start time and stays open for 15 minutes after it.'}
            </Text>
            {data.patient_note ? (
              <>
                <Text variant="label">Your note to the doctor</Text>
                <Text variant="small">{data.patient_note}</Text>
              </>
            ) : null}
          </Card>

          <Button label="Receipt & payment details" variant="ghost" onPress={() => setReceiptOpen(true)} />
        </>
      )}

      <BrandHero>
        <Text variant="bodyStrong" color="#FFFFFF">
          A hold was used, then released
        </Text>
        <Text variant="small" color="#FFF1F6">
          Your slot was reserved for 5 minutes during checkout so nobody else could take it, then converted into this
          appointment exactly once. That is the MediBook integrity guarantee.
        </Text>
      </BrandHero>

      <Sheet
        visible={receiptOpen}
        onClose={() => setReceiptOpen(false)}
        title="Receipt"
        subtitle={data ? `Appointment ${data.code}` : undefined}
        footer={<Button label="Close" variant="secondary" onPress={() => setReceiptOpen(false)} />}
      >
        {data ? (
          <View style={{ gap: spacing.md }}>
            <SheetRow label="Consultation" value={consultTypeLabel(data.consult_type)} />
            <SheetRow label="Doctor" value={data.doctor_name} />
            <SheetRow label="For" value={data.for_name} />
            {data.payment ? (
              <>
                <SheetRow label="Payment id" value={data.payment.id} tone="muted" />
                <SheetRow label="Method" value={data.payment.method.toUpperCase()} />
                <SheetRow label="Status" value={data.payment.status} tone="success" />
                <SheetRow label="Amount" value={formatMoney(data.payment.amount_minor, data.currency)} emphasis />
                <SheetRow label="Paid at" value={data.payment.created_at.slice(0, 16).replace('T', ' ')} tone="muted" />
              </>
            ) : (
              <SheetRow label="Amount" value="Free consultation" tone="muted" />
            )}
            {data.refund ? (
              <>
                <SheetRow label="Refund" value={`${data.refund.tier_percent}% · ${formatMoney(data.refund.amount_minor, data.refund.currency)}`} />
                <SheetRow label="Refund status" value={data.refund.status} tone="danger" />
              </>
            ) : null}
            <PolicyNote
              tone="info"
              title="Invoice PDF"
              body="Downloadable PDF invoices with market-specific tax fields are a Phase 2 item (PAY-003 / Q2). Receipts are emailed today."
            />
          </View>
        ) : (
          <ListSkeleton count={2} />
        )}
      </Sheet>
    </Screen>
  );
}
