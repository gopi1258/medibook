/**
 * Booking draft — the client-side state of the linear booking flow
 * (doctor → slot → who it's for → payment). PRD §8.1 J3 / BRAND_SPEC "Booking is
 * a linear flow".
 *
 * The draft owns the **idempotency key** for the booking POST: it is generated
 * once per draft and reused on retry, which is what makes a timeout-then-retry
 * safe (TRD §14, EC-08).
 */
import { useCallback } from 'react';

import { clockLabel, cryptoRandomIdempotencyKey, formatMoney, fromIso, type ConsultType, type Hold, type PaymentMethod } from '@medibook/core';

import { createStore, useStoreState } from './store';

export type BookingDraft = {
  doctorId: string | null;
  doctorName: string | null;
  consultType: ConsultType;
  startUtc: string | null;
  /** Live server-side hold (APT-002). */
  hold: Hold | null;
  dependentId: string | null;
  dependentName: string | null;
  note: string;
  paymentMethod: PaymentMethod;
  /** Stable for the lifetime of the draft. */
  idempotencyKey: string | null;
};

const empty: BookingDraft = {
  doctorId: null,
  doctorName: null,
  consultType: 'in_person',
  startUtc: null,
  hold: null,
  dependentId: null,
  dependentName: null,
  note: '',
  paymentMethod: 'card',
  idempotencyKey: null,
};

export const bookingDraftStore = createStore<BookingDraft>(empty);

export function useBookingDraft(): BookingDraft {
  return useStoreState(bookingDraftStore);
}

export function useResetBookingDraft(): () => void {
  return useCallback(() => {
    bookingDraftStore.replace({ ...empty });
  }, []);
}

export function startDraft(input: {
  doctorId: string;
  doctorName: string;
  consultType: ConsultType;
  startUtc: string;
}): void {
  bookingDraftStore.replace({
    ...empty,
    doctorId: input.doctorId,
    doctorName: input.doctorName,
    consultType: input.consultType,
    startUtc: input.startUtc,
    idempotencyKey: cryptoRandomIdempotencyKey(),
  });
}

export function attachHold(hold: Hold | null): void {
  bookingDraftStore.set({ hold });
}

export function setDraftDoctorAndType(input: { doctorId: string; doctorName: string; consultType: ConsultType }): void {
  bookingDraftStore.set(input);
}

export function setDraftSlot(startUtc: string): void {
  bookingDraftStore.set({ startUtc });
}

export function setDraftMember(dependentId: string | null, dependentName: string | null): void {
  bookingDraftStore.set({ dependentId, dependentName });
}

export function setDraftNote(note: string): void {
  bookingDraftStore.set({ note });
}

export function setDraftPaymentMethod(method: PaymentMethod): void {
  bookingDraftStore.set({ paymentMethod: method });
}

export function resetDraft(): void {
  bookingDraftStore.replace({ ...empty });
}

/** One-line summary of the draft, used by the booking sheet header. */
export function describeDraft(draft: BookingDraft, viewerTz: string): string {
  if (!draft.startUtc) return 'Pick a slot to continue';
  const day = clockLabel(fromIso(draft.startUtc), viewerTz);
  const fee = ` · ${draft.consultType === 'video' ? 'Video consult' : 'In-clinic'}`;
  return `${day}${fee}`;
}

export function draftFeeLabel(draft: BookingDraft, feeMinor: number, currency: string): string {
  void draft;
  return feeMinor === 0 ? 'Free' : formatMoney(feeMinor, currency);
}
