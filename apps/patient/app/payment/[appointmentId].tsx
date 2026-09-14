/**
 * Payment for an existing appointment (APT-004 / PAY-001).
 *
 * The in-flow payment happens inside the booking sheet; this route exists for the
 * recovery paths the PRD calls out: a payment that failed, a booking restored
 * after a lost connection (EC-08), or a free consult upgraded to a paid type.
 * It re-authorises against the existing appointment, which is why the button
 * disappears once the payment is captured.
 */
import * as React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { formatMoney, type PaymentMethod } from '@medibook/core';
import {
  Button,
  Card,
  CountdownPill,
  PolicyNote,
  Sheet,
  SheetRow,
  Text,
  color,
  spacing,
} from '@medibook/brand';

import { useAppointment, usePayForAppointment } from '../../src/lib/hooks';
import { useViewerTimeZone } from '../../src/lib/session';
import { useNow } from '../../src/lib/useNow';
import { appointmentTimeLabel, appointmentTzLabel, consultTypeLabel, describeError } from '../../src/lib/format';
import { ErrorState, ListSkeleton, InlineNotice } from '../../src/components/states';

const METHODS: ReadonlyArray<{ key: PaymentMethod; label: string; hint: string }> = [
  { key: 'card', label: 'Card', hint: 'Visa, Mastercard, RuPay' },
  { key: 'upi', label: 'UPI', hint: 'Any UPI app' },
  { key: 'netbanking', label: 'Net banking', hint: 'All major banks' },
  { key: 'wallet', label: 'Wallet', hint: 'Paytm, PhonePe' },
];

export default function PaymentScreen() {
  const router = useRouter();
  const { appointmentId } = useLocalSearchParams<{ appointmentId?: string }>();
  const viewerTz = useViewerTimeZone();
  const now = useNow(1000);

  const appointment = useAppointment(appointmentId);
  const pay = usePayForAppointment();
  const [method, setMethod] = React.useState<PaymentMethod>('card');
  const [failure, setFailure] = React.useState<unknown>(null);

  const data = appointment.data;
  const captured = data?.payment?.status === 'captured';

  const onPay = async () => {
    if (!appointmentId) return;
    setFailure(null);
    try {
      await pay.mutateAsync({ appointmentId, method });
      router.replace(`/confirmation/${appointmentId}`);
    } catch (caught) {
      setFailure(caught);
    }
  };

  return (
    <Sheet
      visible
      onClose={() => router.back()}
      title="Payment"
      subtitle={data ? `${data.doctor_name} · ${consultTypeLabel(data.consult_type)}` : 'Loading…'}
      footer={
        <View style={{ gap: spacing.sm }}>
          {captured ? (
            <Button label="View confirmation" onPress={() => router.replace(`/confirmation/${appointmentId ?? ''}`)} />
          ) : (
            <Button
              label={pay.isPending ? 'Processing…' : `Pay ${data ? formatMoney(data.fee_minor, data.currency) : ''}`}
              loading={pay.isPending}
              icon="lock"
              onPress={() => void onPay()}
            />
          )}
          <Button label="Not now" variant="ghost" onPress={() => router.back()} />
        </View>
      }
    >
      {appointment.isLoading ? (
        <ListSkeleton count={2} />
      ) : appointment.isError || !data ? (
        <ErrorState error={appointment.error} onRetry={() => void appointment.refetch()} compact />
      ) : (
        <View style={{ gap: spacing.lg }}>
          {!captured ? (
            <CountdownPill
              remainingMs={24 * 60 * 60 * 1000}
              totalMs={24 * 60 * 60 * 1000}
              label="Pay to secure this appointment"
              expiredLabel="Payment overdue"
            />
          ) : null}

          <Card variant="flat" style={{ gap: spacing.md }}>
            <SheetRow label="Appointment" value={data.code} emphasis />
            <SheetRow label="Doctor" value={data.doctor_name} />
            <SheetRow label="For" value={data.for_name} />
            <SheetRow label="When" value={appointmentTimeLabel(data, viewerTz, now)} />
            <SheetRow label="Timezone" value={appointmentTzLabel(data, viewerTz)} tone="muted" />
            <SheetRow
              label="Payment status"
              value={captured ? 'Captured' : (data.payment?.status ?? 'Not started')}
              tone={captured ? 'success' : 'danger'}
            />
          </Card>

          {captured ? (
            <PolicyNote
              tone="success"
              title="Already paid"
              body={`This appointment is paid in full (${formatMoney(data.payment?.amount_minor ?? data.fee_minor, data.currency)}). Receipts live on the appointment detail screen.`}
            />
          ) : (
            <>
              <View style={{ gap: spacing.sm }}>
                <Text variant="label">Payment method</Text>
                {METHODS.map((option) => (
                  <Card
                    key={option.key}
                    variant={method === option.key ? 'mint' : 'flat'}
                    onPress={() => setMethod(option.key)}
                    accessibilityLabel={`Pay by ${option.label}`}
                  >
                    <Text variant="bodyStrong">{option.label}</Text>
                    <Text variant="caption">{option.hint}</Text>
                  </Card>
                ))}
              </View>

              <Card variant="flat" style={{ gap: spacing.md }}>
                <SheetRow label="Consultation fee" value={formatMoney(data.fee_minor, data.currency)} />
                <SheetRow label="Amount due" value={formatMoney(data.fee_minor, data.currency)} emphasis />
              </Card>
            </>
          )}

          {failure ? <InlineNotice message={describeError(failure).message} /> : null}

          <PolicyNote
            tone="info"
            title="Simulated gateway"
            body="No payment provider is wired up in this build: the authorisation is local and no card data is ever collected. Booking and refund ordering still follows TRD §10.6 — the appointment row is created before capture, so money can never be taken without a booking."
          />

          {!captured ? (
            <Text variant="caption" color={color.textMuted}>
              A failed payment releases nothing that was yours: the slot stays reserved for the hold window, then returns
              to the pool automatically.
            </Text>
          ) : null}
        </View>
      )}
    </Sheet>
  );
}
