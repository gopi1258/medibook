/**
 * @module domain/rules
 *
 * The API's rules module — PRD §13 (R1, R2, R3, R5, R7, R12, R13, R14).
 *
 * The pure implementations live in `@medibook/core` so that the mobile apps'
 * offline mock evaluates *exactly* the same policy maths (a policy preview shown
 * in the appointment sheet can never disagree with what this server would do).
 * This module re-exports them and adds the server-side guards that need request
 * context: the ones that throw the TRD §7 error envelope instead of returning a
 * verdict.
 *
 * One module, one set of constants, fully unit-testable — TRD §10.7.
 */
import { ApiError, apiErrors } from '@medibook/core';
import type { DoctorPolicyOverrides, ErrorCode } from '@medibook/core';

import {
  bookingWindowViolation,
  cancellationPolicy,
  effectivePolicy,
  holdExpiry,
  maxActivePerDoctorPerDayViolation,
  noShowGraceMinutes,
  reschedulePolicy,
  reviewWindow,
  statusForNewBooking,
  autoDeclineDeadline,
  bufferMinutes,
  defaultPlatformConfig,
  formatDuration,
  formatMoney,
  type BookingWindowViolation,
  type CancellationPolicy,
  type ReschedulePolicy,
} from '@medibook/core';

export {
  bookingWindowViolation,
  bufferMinutes,
  cancellationPolicy,
  defaultPlatformConfig,
  effectivePolicy,
  formatDuration,
  formatMoney,
  holdExpiry,
  maxActivePerDoctorPerDayViolation,
  noShowGraceMinutes,
  reschedulePolicy,
  reviewWindow,
  statusForNewBooking,
  autoDeclineDeadline,
};
export type { BookingWindowViolation, CancellationPolicy, DoctorPolicyOverrides, ReschedulePolicy };

/** Throw the mapped API error when a slot is outside the booking window (R1). */
export function assertWithinBookingWindow(violation: BookingWindowViolation | null): void {
  if (!violation) return;
  throw new ApiError(violation.code, violation.message);
}

/** Throw when the patient already holds the maximum bookings with this doctor that day (R14). */
export function assertUnderDailyLimit(violation: BookingWindowViolation | null): void {
  if (!violation) return;
  throw new ApiError(violation.code, violation.message);
}

/** Throw when a reschedule is not permitted (R3). */
export function assertReschedulable(policy: ReschedulePolicy): void {
  if (policy.allowed) return;
  const code: ErrorCode = policy.reason_code ?? 'APT_STATE_CONFLICT';
  throw new ApiError(code, policy.reason ?? policy.summary, {
    details: {
      remaining_reschedules: policy.remaining_reschedules,
      hours_until_start: Number(policy.hours_until_start.toFixed(2)),
    },
  });
}

/** Resolve the effective policy for a doctor row, filling platform defaults. */
export function policyFromRow(row: {
  min_notice_minutes: number | null;
  booking_window_days: number | null;
  reschedule_min_hours: number | null;
  max_reschedules: number | null;
  approval_mode: string | null;
  approval_auto_decline_minutes: number | null;
  no_show_grace_minutes_video: number | null;
  no_show_grace_minutes_clinic: number | null;
  buffer_minutes: number | null;
} | null): Required<DoctorPolicyOverrides> {
  if (!row) return effectivePolicy({});
  return effectivePolicy({
    min_notice_minutes: row.min_notice_minutes ?? undefined,
    booking_window_days: row.booking_window_days ?? undefined,
    reschedule_min_hours: row.reschedule_min_hours ?? undefined,
    max_reschedules: row.max_reschedules ?? undefined,
    approval_mode: (row.approval_mode as 'auto' | 'manual' | null) ?? undefined,
    approval_auto_decline_minutes: row.approval_auto_decline_minutes ?? undefined,
    no_show_grace_minutes_video: row.no_show_grace_minutes_video ?? undefined,
    no_show_grace_minutes_clinic: row.no_show_grace_minutes_clinic ?? undefined,
    buffer_minutes: row.buffer_minutes ?? undefined,
  });
}

/** Re-exported so callers surface the same 404 shape for missing doctors. */
export function assertDoctorExists<T>(doctor: T | undefined, doctorId: string): T {
  if (!doctor) throw apiErrors.notFound('Doctor', doctorId);
  return doctor;
}
