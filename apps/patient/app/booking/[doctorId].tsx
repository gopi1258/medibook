/**
 * Booking sheet + simulated payment — one modal route covering J3 steps 2–3.
 *
 * Integrity behaviour implemented here (TRD §10.2):
 *   - a **hold is created on entry** and the 5-minute countdown is visible the
 *     whole time (APT-002 / R12);
 *   - the hold is released on dismissal, so walking away frees the slot;
 *   - a losing race surfaces the server's `APT_SLOT_TAKEN` **with its nearest
 *     alternatives** instead of a generic error (EC-04);
 *   - hold expiry returns the user to the slot picker with nothing charged
 *     (APT-002 / EC-08);
 *   - the draft's stable idempotency key means a retried confirm cannot
 *     double-book (EC-08/EC-09).
 */
import * as React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import {
  ApiError,
  cancellationPolicy,
  clockLabel,
  cryptoRandomIdempotencyKey,
  formatMoney,
  fromIso,
  statusForNewBooking,
  type ConsultType,
  type Hold,
  type PaymentMethod,
} from '@medibook/core';
import {
  Button,
  Card,
  Chip,
  ChipRow,
  CountdownPill,
  PolicyNote,
  Sheet,
  SheetRow,
  Text,
  TextArea,
  color,
  spacing,
} from '@medibook/brand';

import { patientApi } from '../../src/lib/api';
import { attachHold, bookingDraftStore, resetDraft, setDraftMember, setDraftNote, useBookingDraft } from '../../src/lib/bookingDraft';
import { useDependents, useDoctor } from '../../src/lib/hooks';
import { useViewerTimeZone } from '../../src/lib/session';
import { useNow } from '../../src/lib/useNow';
import { consultTypeLabel, describeError, relationshipLabel } from '../../src/lib/format';
import { InlineNotice } from '../../src/components/states';
import { queryKeys } from '../../src/lib/query';

type Phase = 'holding' | 'ready' | 'paying' | 'expired' | 'conflict' | 'failed';

const PAYMENT_METHODS: ReadonlyArray<{ key: PaymentMethod; label: string; hint: string }> = [
  { key: 'card', label: 'Card', hint: 'Visa, Mastercard, RuPay' },
  { key: 'upi', label: 'UPI', hint: 'Pay by any UPI app' },
  { key: 'netbanking', label: 'Net banking', hint: 'All major banks' },
  { key: 'wallet', label: 'Wallet', hint: 'Paytm, PhonePe' },
];

export default function BookingSheetRoute() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ doctorId?: string; consultType?: string; startUtc?: string }>();
  const doctorId = params.doctorId ?? '';
  const consultType: ConsultType = params.consultType === 'video' ? 'video' : 'in_person';
  const startUtc = params.startUtc ?? '';
  const viewerTz = useViewerTimeZone();
  const now = useNow(1000);

  const draft = useBookingDraft();
  const doctor = useDoctor(doctorId);
  const dependents = useDependents();

  const [phase, setPhase] = React.useState<Phase>('holding');
  const [hold, setHold] = React.useState<Hold | null>(null);
  const [holdError, setHoldError] = React.useState<unknown>(null);
  const [payError, setPayError] = React.useState<unknown>(null);
  const [alternatives, setAlternatives] = React.useState<string[]>([]);
  const [submitting, setSubmitting] = React.useState(false);
  const [methodPickerOpen, setMethodPickerOpen] = React.useState(false);
  const [memberPickerOpen, setMemberPickerOpen] = React.useState(false);
  const idempotencyKey = React.useRef(cryptoRandomIdempotencyKey());

  const fee = doctor.data?.consult_fees.find((entry) => entry.consult_type === consultType);
  const feeMinor = fee?.fee_minor ?? 0;
  const currency = fee?.currency ?? 'INR';
  const free = feeMinor === 0;

  /* ------------------------------------------------------------ the hold */

  const acquireHold = React.useCallback(
    async (releaseExisting: boolean) => {
      setPhase('holding');
      setHoldError(null);
      try {
        const created = await patientApi.createHold({
          doctor_id: doctorId,
          consult_type: consultType,
          start_utc: startUtc,
        });
        attachHold(created);
        setHold(created);
        setPhase('ready');
      } catch (caught) {
        if (caught instanceof ApiError && caught.code === 'APT_HOLD_ACTIVE' && !releaseExisting) {
          const previous = caught.details['hold_id'];
          if (typeof previous === 'string') {
            await patientApi.releaseHold(previous).catch(() => undefined);
            await acquireHold(true);
            return;
          }
        }
        if (caught instanceof ApiError && (caught.code === 'APT_SLOT_TAKEN' || caught.code === 'CAL_SLOT_CONFLICT')) {
          setAlternatives(caught.alternatives);
          setPhase('conflict');
          return;
        }
        setHoldError(caught);
        setPhase('failed');
      }
    },
    [consultType, doctorId, startUtc],
  );

  React.useEffect(() => {
    if (!doctorId || !startUtc) return;
    bookingDraftStore.set({
      doctorId,
      doctorName: doctor.data?.name ?? null,
      consultType,
      startUtc,
      idempotencyKey: idempotencyKey.current,
    });
    void acquireHold(false);
    // Acquire once per (doctor, type, slot) — re-running would drop the hold.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctorId, consultType, startUtc]);

  const close = React.useCallback(
    (release: boolean) => {
      if (release && hold) void patientApi.releaseHold(hold.id).catch(() => undefined);
      attachHold(null);
      resetDraft();
      router.back();
    },
    [hold, router],
  );

  const remainingMs = hold ? fromIso(hold.expires_at) - now : 0;
  const expired = hold !== null && remainingMs <= 0;

  React.useEffect(() => {
    if (expired && phase !== 'expired' && phase !== 'paying') {
      setPhase('expired');
      void queryClient.invalidateQueries({ queryKey: ['availability'] });
    }
  }, [expired, phase, queryClient]);

  /* --------------------------------------------------------- the commit */

  const confirm = React.useCallback(
    async (method: PaymentMethod) => {
      if (!hold) return;
      setSubmitting(true);
      setPayError(null);
      try {
        const appointment = await patientApi.createAppointment(
          {
            hold_id: hold.id,
            doctor_id: doctorId,
            consult_type: consultType,
            start_utc: hold.start_utc,
            dependent_id: draft.dependentId,
            note: draft.note.trim().length > 0 ? draft.note.trim() : null,
            payment: free ? null : { method },
          },
          idempotencyKey.current,
        );
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['appointments'] }),
          queryClient.invalidateQueries({ queryKey: ['availability'] }),
          queryClient.invalidateQueries({ queryKey: ['notifications'] }),
          queryClient.invalidateQueries({ queryKey: queryKeys.appointment(appointment.id) }),
          queryClient.invalidateQueries({ queryKey: ['patient', 'dependents'] }),
        ]);
        resetDraft();
        setMethodPickerOpen(false);
        router.replace(`/confirmation/${appointment.id}`);
      } catch (caught) {
        if (caught instanceof ApiError && caught.code === 'APT_HOLD_EXPIRED') {
          setPhase('expired');
        } else if (
          caught instanceof ApiError &&
          (caught.code === 'APT_SLOT_TAKEN' || caught.code === 'CAL_SLOT_CONFLICT' || caught.code === 'APT_HOLD_ACTIVE')
        ) {
          setAlternatives(caught.alternatives);
          setPhase('conflict');
        } else if (caught instanceof ApiError && caught.code === 'APT_ALREADY_BOOKED_WITH_DOCTOR') {
          setPayError(caught);
        } else {
          setPayError(caught);
        }
      } finally {
        setSubmitting(false);
      }
    },
    [consultType, doctorId, draft.dependentId, draft.note, free, hold, queryClient, router],
  );

  const policyPreview = React.useMemo(
    () =>
      cancellationPolicy({
        startUtc: hold?.start_utc ?? startUtc,
        nowMs: now,
        feeMinor,
        currency,
        actor: 'patient',
      }),
    [currency, feeMinor, hold?.start_utc, now, startUtc],
  );

  const forName = draft.dependentName ?? 'Myself';
  const doctorName = doctor.data?.name ?? draft.doctorName ?? 'Doctor';

  return (
    <>
      <Sheet
        visible
        onClose={() => close(phase !== 'paying')}
        title="Confirm your booking"
        subtitle={`${doctorName} · ${consultTypeLabel(consultType)}`}
        footer={
          phase === 'ready' ? (
            <Button
              label={free ? 'Confirm booking' : `Confirm & pay ${formatMoney(feeMinor, currency)}`}
              onPress={() => {
                if (free) void confirm('free');
                else setMethodPickerOpen(true);
              }}
              disabled={expired}
              icon={free ? 'check' : 'credit-card'}
            />
          ) : phase === 'conflict' ? (
            <Button label="Choose another time" onPress={() => router.replace({ pathname: '/slots/[doctorId]', params: { doctorId, consultType } })} />
          ) : phase === 'expired' ? (
            <Button label="Pick the slot again" onPress={() => router.replace({ pathname: '/slots/[doctorId]', params: { doctorId, consultType } })} />
          ) : (
            <Button label="Close" variant="secondary" onPress={() => close(false)} />
          )
        }
      >
        {phase === 'conflict' ? (
          <View style={{ gap: spacing.lg }}>
            <PolicyNote
              tone="danger"
              title="That slot was just taken"
              body="Someone booked it a moment before you. You have not been charged — a hold never takes money."
            />
            {alternatives.length > 0 ? (
              <View style={{ gap: spacing.sm }}>
                <Text variant="label">Nearest open slots</Text>
                {alternatives.map((alternative) => (
                  <Card
                    key={alternative}
                    variant="flat"
                    onPress={() =>
                      router.replace({
                        pathname: '/booking/[doctorId]',
                        params: { doctorId, consultType, startUtc: alternative },
                      })
                    }
                    accessibilityLabel={`Book ${clockLabel(fromIso(alternative), viewerTz)}`}
                  >
                    <Text variant="bodyMedium">{clockLabel(fromIso(alternative), viewerTz)}</Text>
                    <Text variant="caption">{viewerTz.replace(/_/g, ' ')}</Text>
                  </Card>
                ))}
              </View>
            ) : (
              <Text variant="small">No nearby slots were free. Pick a different day.</Text>
            )}
          </View>
        ) : phase === 'expired' ? (
          <View style={{ gap: spacing.lg }}>
            <PolicyNote
              tone="warning"
              title="Your 5-minute hold expired"
              body="The slot was released so another patient could take it. Nothing was charged. Pick a time again to continue."
            />
            <Text variant="small">
              If you had already entered payment details, they were never submitted — MediBook never stores card numbers.
            </Text>
          </View>
        ) : phase === 'failed' ? (
          <View style={{ gap: spacing.lg }}>
            <InlineNotice message={describeError(holdError).message} />
            <Button label="Try again" variant="secondary" onPress={() => void acquireHold(true)} />
          </View>
        ) : (
          <View style={{ gap: spacing.lg }}>
            {hold ? (
              <CountdownPill remainingMs={Math.max(0, remainingMs)} label="Slot held for you" />
            ) : (
              <Text variant="small">Reserving the slot…</Text>
            )}

            <Card variant="flat" style={{ gap: spacing.md }}>
              <SheetRow
                label="When"
                value={hold ? `${clockLabel(fromIso(hold.start_utc), viewerTz)} · ${viewerTz.replace(/_/g, ' ')}` : '—'}
                emphasis
              />
              <SheetRow label="Doctor" value={doctorName} />
              <SheetRow label="Consultation" value={consultTypeLabel(consultType)} />
              <SheetRow
                label="Duration"
                value={fee ? `${fee.duration_minutes} minutes` : '—'}
                tone="muted"
              />
              {doctor.data && doctor.data.clinic_timezone !== viewerTz ? (
                <SheetRow
                  label="Clinic time"
                  value={`${clockLabel(fromIso(hold?.start_utc ?? startUtc), doctor.data.clinic_timezone)} (${doctor.data.clinic_timezone.replace(/_/g, ' ')})`}
                  tone="muted"
                />
              ) : null}
            </Card>

            <View style={{ gap: spacing.sm }}>
              <Text variant="label">Who is this for?</Text>
              <ChipRow>
                <Chip
                  label="Myself"
                  selected={draft.dependentId === null}
                  onPress={() => setDraftMember(null, null)}
                />
                {(dependents.data ?? []).map((dependent) => (
                  <Chip
                    key={dependent.id}
                    label={dependent.name.split(' ')[0] ?? dependent.name}
                    meta={relationshipLabel(dependent.relationship)}
                    selected={draft.dependentId === dependent.id}
                    onPress={() => setDraftMember(dependent.id, dependent.name)}
                  />
                ))}
                <Chip label="Add someone" icon="user-plus" onPress={() => setMemberPickerOpen(true)} />
              </ChipRow>
              <Text variant="caption">
                Booking for {forName}. The account holder stays responsible for payment and for the visit happening.
              </Text>
            </View>

            <TextArea
              label="Anything the doctor should know? (optional)"
              value={draft.note}
              onChangeText={setDraftNote}
              placeholder="e.g. rash on the left forearm for a week"
              maxLength={300}
            />

            <Card variant="flat" style={{ gap: spacing.md }}>
              <Text variant="label">Fee breakdown</Text>
              <SheetRow label={consultTypeLabel(consultType)} value={free ? 'Free' : formatMoney(feeMinor, currency)} />
              <SheetRow label="Platform fee" value="Included" tone="muted" />
              <SheetRow label="Total payable now" value={free ? 'Nothing to pay' : formatMoney(feeMinor, currency)} emphasis />
              {doctor.data?.policy.approval_mode === 'manual' ? (
                <PolicyNote
                  tone="warning"
                  title="This doctor approves each request"
                  body={`Your slot is reserved straight away, but the appointment shows as “awaiting confirmation” until the doctor accepts. If they do not respond within ${doctor.data.policy.approval_auto_decline_minutes} minutes the booking is declined and refunded in full.`}
                />
              ) : null}
            </Card>

            <Card variant="flat" style={{ gap: spacing.sm, backgroundColor: color.surfaceAlt }}>
              <Text variant="label">Cancellation policy</Text>
              <Text variant="small">{policyPreview.summary}</Text>
              <Text variant="caption">
                Rule {policyPreview.rule} · 100% refund at 24 h or more before the start, 50% between 2 and 24 hours,
                nothing inside 2 hours. Doctors who cancel always trigger a full refund.
              </Text>
            </Card>

            {payError ? (
              <InlineNotice
                message={describeError(payError).message}
                action={{ label: 'Retry payment', onPress: () => setMethodPickerOpen(true) }}
              />
            ) : null}

            <Text variant="caption">
              Booking lands as{' '}
              {doctor.data
                ? statusForNewBooking(doctor.data.policy.approval_mode) === 'confirmed'
                  ? 'confirmed immediately'
                  : 'pending the doctor’s approval'
                : 'confirmed'}
              . You will get a confirmation in Alerts and by email.
            </Text>
          </View>
        )}
      </Sheet>

      <Sheet
        visible={methodPickerOpen}
        onClose={() => setMethodPickerOpen(false)}
        title="Payment"
        subtitle={feeMinor > 0 ? `${formatMoney(feeMinor, currency)} for ${consultTypeLabel(consultType)}` : 'Nothing to pay'}
        footer={
          <View style={{ gap: spacing.sm }}>
            <Button
              label={submitting ? 'Processing…' : `Pay ${formatMoney(feeMinor, currency)}`}
              loading={submitting}
              onPress={() => void confirm(draft.paymentMethod)}
              disabled={expired}
              icon="lock"
            />
            <Button label="Back to details" variant="ghost" onPress={() => setMethodPickerOpen(false)} />
          </View>
        }
      >
        <View style={{ gap: spacing.lg }}>
          <CountdownPill remainingMs={Math.max(0, remainingMs)} label="Complete payment before the hold expires" />

          {PAYMENT_METHODS.map((option) => (
            <Card
              key={option.key}
              variant={draft.paymentMethod === option.key ? 'mint' : 'flat'}
              onPress={() => bookingDraftStore.set({ paymentMethod: option.key })}
              accessibilityLabel={`Pay by ${option.label}`}
            >
              <Text variant="bodyStrong">{option.label}</Text>
              <Text variant="caption">{option.hint}</Text>
            </Card>
          ))}

          <PolicyNote
            tone="info"
            title="Simulated gateway"
            body="No payment provider is configured in this build. Card details are never collected or stored — the gateway integration sits behind a port in the real deployment."
          />

          {payError ? <InlineNotice message={describeError(payError).message} /> : null}
        </View>
      </Sheet>

      <Sheet
        visible={memberPickerOpen}
        onClose={() => setMemberPickerOpen(false)}
        title="Book for someone else"
        subtitle="Family members on your account"
        footer={<Button label="Done" variant="secondary" onPress={() => setMemberPickerOpen(false)} />}
      >
        {(dependents.data ?? []).length === 0 ? (
          <Text variant="small">
            You have no family members yet. Add them from Profile → Family and they will appear here.
          </Text>
        ) : (
          (dependents.data ?? []).map((dependent) => (
            <Card
              key={dependent.id}
              variant={draft.dependentId === dependent.id ? 'mint' : 'flat'}
              onPress={() => {
                setDraftMember(dependent.id, dependent.name);
                setMemberPickerOpen(false);
              }}
            >
              <Text variant="bodyStrong">{dependent.name}</Text>
              <Text variant="caption">
                {relationshipLabel(dependent.relationship)} · born {dependent.dob}
              </Text>
            </Card>
          ))
        )}
      </Sheet>
    </>
  );
}
