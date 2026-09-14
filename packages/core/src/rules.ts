/**
 * Business rules — PRD §13, implemented as pure functions over an explicit
 * config so every constant is visible to tests (TRD §10.7: "no rule constants in
 * code paths that tests can't see").
 *
 * This module is the *authoritative* implementation. The backend re-exports it
 * from `services/api/src/domain/rules.ts`, and the offline mock API evaluates the
 * same functions, so a policy preview shown in the app can never disagree with
 * what the server would do.
 */
import type { ErrorCode } from './errors.ts';
import type { ApprovalMode, ConsultType } from './types.ts';
import { HOUR_MS, MINUTE_MS, fromIso } from './time.ts';

/** Platform-wide defaults (ADM-011 knobs). Values from PRD §13. */
export type PlatformConfig = {
  /** R12 — slot hold during checkout. */
  hold_minutes: number;
  /** R12 — one active hold per patient. */
  max_active_holds_per_patient: number;
  /** R1 — booking window, lower bound. */
  min_notice_minutes: number;
  /** R1 — booking window, upper bound. */
  booking_window_days: number;
  /** R3 — how late a patient may still reschedule. */
  reschedule_min_hours: number;
  /** R3 — how many times an appointment may be moved. */
  max_reschedules: number;
  /** R2 — free cancellation tier. */
  cancel_free_hours: number;
  /** R2 — partial-refund tier lower bound. */
  cancel_partial_hours: number;
  /** R2 — partial-refund percentage for the 2–24h tier. */
  cancel_partial_percent: 50;
  /** R5 — default buffer between appointments. */
  buffer_minutes: number;
  /** R13 — manual-approval auto-decline window. */
  approval_auto_decline_minutes: number;
  /** R7 — no-show grace, video. */
  no_show_grace_minutes_video: number;
  /** R7 — no-show grace, in-clinic. */
  no_show_grace_minutes_clinic: number;
  /** R14 — max active upcoming bookings per patient per doctor per day. */
  max_active_per_doctor_per_day: number;
  /** PAT-004 — maximum dependents per account. */
  max_dependents: number;
  /** APT-009 — join window opens this many minutes before start. */
  join_window_minutes_before: number;
  /** APT-009 — join window closes this many minutes after start. */
  join_grace_minutes_after: number;
  /** R15 — review edit window. */
  review_edit_hours: number;
  /** OTP validity. */
  otp_ttl_minutes: number;
  /** OTP attempt cap before cooldown (PAT-001). */
  otp_max_attempts: number;
  /** Cooldown after the attempt cap is hit. */
  otp_lockout_seconds: number;
  /** OTP resend cooldown. */
  otp_resend_cooldown_seconds: number;
  /** Default consult durations per type, used when a doctor hasn't configured one. */
  default_duration_minutes: Record<ConsultType, number>;
};

export const defaultPlatformConfig: PlatformConfig = {
  hold_minutes: 5,
  max_active_holds_per_patient: 1,
  min_notice_minutes: 120,
  booking_window_days: 60,
  reschedule_min_hours: 4,
  max_reschedules: 2,
  cancel_free_hours: 24,
  cancel_partial_hours: 2,
  cancel_partial_percent: 50,
  buffer_minutes: 5,
  approval_auto_decline_minutes: 15,
  no_show_grace_minutes_video: 10,
  no_show_grace_minutes_clinic: 15,
  max_active_per_doctor_per_day: 1,
  max_dependents: 10,
  join_window_minutes_before: 5,
  join_grace_minutes_after: 15,
  review_edit_hours: 24,
  otp_ttl_minutes: 10,
  otp_max_attempts: 3,
  otp_lockout_seconds: 60,
  otp_resend_cooldown_seconds: 30,
  default_duration_minutes: { in_person: 20, video: 15 },
};

/** Per-doctor overrides (DOC-007). Every field is optional; falls back to platform config. */
export type DoctorPolicyOverrides = {
  min_notice_minutes?: number;
  booking_window_days?: number;
  reschedule_min_hours?: number;
  max_reschedules?: number;
  approval_mode?: ApprovalMode;
  approval_auto_decline_minutes?: number;
  no_show_grace_minutes_video?: number;
  no_show_grace_minutes_clinic?: number;
  buffer_minutes?: number;
};

/** Effective policy = platform defaults overlaid with the doctor's settings. */
export function effectivePolicy(
  overrides: DoctorPolicyOverrides = {},
  config: PlatformConfig = defaultPlatformConfig,
): Required<DoctorPolicyOverrides> {
  return {
    min_notice_minutes: overrides.min_notice_minutes ?? config.min_notice_minutes,
    booking_window_days: overrides.booking_window_days ?? config.booking_window_days,
    reschedule_min_hours: overrides.reschedule_min_hours ?? config.reschedule_min_hours,
    max_reschedules: overrides.max_reschedules ?? config.max_reschedules,
    approval_mode: overrides.approval_mode ?? 'auto',
    approval_auto_decline_minutes:
      overrides.approval_auto_decline_minutes ?? config.approval_auto_decline_minutes,
    no_show_grace_minutes_video:
      overrides.no_show_grace_minutes_video ?? config.no_show_grace_minutes_video,
    no_show_grace_minutes_clinic:
      overrides.no_show_grace_minutes_clinic ?? config.no_show_grace_minutes_clinic,
    buffer_minutes: overrides.buffer_minutes ?? config.buffer_minutes,
  };
}

export type PolicyContext = {
  startUtc: string;
  nowMs: number;
  policy: Required<DoctorPolicyOverrides>;
  config?: PlatformConfig;
};

/* --------------------------------------------------------------------- R1 */

export type BookingWindowViolation = { code: ErrorCode; message: string };

/**
 * R1 — a slot must be between `min_notice_minutes` and `booking_window_days`
 * from now. Boundary is inclusive at min-notice and inclusive at the horizon
 * (PRD EC-23).
 */
export function bookingWindowViolation({ startUtc, nowMs, policy }: PolicyContext): BookingWindowViolation | null {
  const start = fromIso(startUtc);
  const delta = start - nowMs;
  const minNoticeMs = policy.min_notice_minutes * MINUTE_MS;

  if (delta < 0) {
    return { code: 'APT_SLOT_PAST', message: 'That time has already passed.' };
  }
  if (delta < minNoticeMs) {
    return {
      code: 'APT_MIN_NOTICE',
      message: `This doctor needs at least ${formatDuration(policy.min_notice_minutes)} notice.`,
    };
  }
  const horizonMs = policy.booking_window_days * 24 * HOUR_MS;
  if (delta > horizonMs) {
    return {
      code: 'APT_OUTSIDE_WINDOW',
      message: `Bookings open up to ${policy.booking_window_days} days ahead.`,
    };
  }
  return null;
}

/* --------------------------------------------------------------------- R2 */

export type CancellationPolicyInput = {
  startUtc: string;
  nowMs: number;
  feeMinor: number;
  currency: string;
  /** Who is cancelling — R8 makes doctor/admin cancellations always 100%. */
  actor: 'patient' | 'doctor' | 'admin' | 'system';
  config?: PlatformConfig;
};

export type CancellationPolicy = {
  refund_percent: 0 | 50 | 100;
  refund_minor: number;
  currency: string;
  rule: 'R2' | 'R8';
  hours_until_start: number;
  summary: string;
};

/**
 * R2 — patient refund tiering: ≥24 h → 100%, 2–24 h → 50%, <2 h → 0%.
 * R8 — doctor/admin cancellations always refund 100%, no fee.
 */
export function cancellationPolicy({
  startUtc,
  nowMs,
  feeMinor,
  currency,
  actor,
  config = defaultPlatformConfig,
}: CancellationPolicyInput): CancellationPolicy {
  const hoursUntilStart = (fromIso(startUtc) - nowMs) / HOUR_MS;

  if (actor !== 'patient') {
    return {
      refund_percent: 100,
      refund_minor: feeMinor,
      currency,
      rule: 'R8',
      hours_until_start: hoursUntilStart,
      summary:
        feeMinor > 0
          ? `Cancelled by the clinic — you get a full refund of ${formatMoney(feeMinor, currency)}.`
          : 'Cancelled by the clinic. No payment was taken.',
    };
  }

  let percent: 0 | 50 | 100;
  if (hoursUntilStart >= config.cancel_free_hours) percent = 100;
  else if (hoursUntilStart >= config.cancel_partial_hours) percent = config.cancel_partial_percent;
  else percent = 0;

  const refundMinor = Math.round((feeMinor * percent) / 100);
  const summary =
    feeMinor === 0
      ? 'This consultation is free — nothing to refund.'
      : percent === 100
        ? `Cancelling now refunds 100% (${formatMoney(refundMinor, currency)}).`
        : percent === 50
          ? `You are inside 24 hours of your appointment — 50% (${formatMoney(refundMinor, currency)}) is refunded.`
          : `You are inside 2 hours of your appointment — this visit is non-refundable.`;

  return {
    refund_percent: percent,
    refund_minor: refundMinor,
    currency,
    rule: 'R2',
    hours_until_start: hoursUntilStart,
    summary,
  };
}

/* --------------------------------------------------------------------- R3 */

export type ReschedulePolicyInput = PolicyContext & {
  /** How many times this appointment has already been moved. */
  rescheduleCount: number;
  /** Set when a reschedule moved the appointment to a *pending* state. */
  currentStatus?: string;
};

export type ReschedulePolicy = {
  allowed: boolean;
  reason_code?: ErrorCode;
  reason?: string;
  remaining_reschedules: number;
  hours_until_start: number;
  summary: string;
};

/**
 * R3 — reschedules allowed `max_reschedules` times, at least
 * `reschedule_min_hours` before the start, and inside the doctor's booking
 * window. Same-type/same-fee moves are free.
 */
export function reschedulePolicy({
  startUtc,
  nowMs,
  policy,
  rescheduleCount,
}: ReschedulePolicyInput): ReschedulePolicy {
  const hoursUntilStart = (fromIso(startUtc) - nowMs) / HOUR_MS;
  const remaining = Math.max(0, policy.max_reschedules - rescheduleCount);

  if (remaining <= 0) {
    return {
      allowed: false,
      reason_code: 'APT_RESCHEDULE_LIMIT',
      reason: `This appointment can be rescheduled ${policy.max_reschedules} time${policy.max_reschedules === 1 ? '' : 's'}.`,
      remaining_reschedules: 0,
      hours_until_start: hoursUntilStart,
      summary: 'Reschedule limit reached. Cancel and book again, or contact support.',
    };
  }
  if (hoursUntilStart < policy.reschedule_min_hours) {
    return {
      allowed: false,
      reason_code: 'APT_RESCHEDULE_TOO_LATE',
      reason: `Reschedules need at least ${formatDuration(policy.reschedule_min_hours * 60)} notice.`,
      remaining_reschedules: remaining,
      hours_until_start: hoursUntilStart,
      summary: 'Too close to the appointment time to reschedule — you can still cancel per policy.',
    };
  }
  return {
    allowed: true,
    remaining_reschedules: remaining,
    hours_until_start: hoursUntilStart,
    summary:
      remaining === 1
        ? 'You can reschedule this appointment once more. Moving it is free.'
        : `You can reschedule this appointment ${remaining} more times. Moving it is free.`,
  };
}

/* --------------------------------------------------------------------- R5 */

/**
 * R5 — buffer between consecutive appointments. Returns the extra minutes of
 * padding a slot claims at its end, so the slot engine can reject overlaps.
 */
export function bufferMinutes(policy: Required<DoctorPolicyOverrides>, config = defaultPlatformConfig): number {
  const value = policy.buffer_minutes ?? config.buffer_minutes;
  return Math.min(30, Math.max(0, value));
}

/* --------------------------------------------------------------------- R7 */

/** R7 — no-show grace period in minutes, per consult type. */
export function noShowGraceMinutes(
  consultType: ConsultType,
  policy: Required<DoctorPolicyOverrides>,
  config = defaultPlatformConfig,
): number {
  return consultType === 'video'
    ? (policy.no_show_grace_minutes_video ?? config.no_show_grace_minutes_video)
    : (policy.no_show_grace_minutes_clinic ?? config.no_show_grace_minutes_clinic);
}

/* -------------------------------------------------------------------- R12 */

/** R12 — when a hold created at `nowMs` expires. */
export function holdExpiry(nowMs: number, config = defaultPlatformConfig): number {
  return nowMs + config.hold_minutes * MINUTE_MS;
}

/* -------------------------------------------------------------------- R13 */

/**
 * R13 — the status a new booking lands in, based on the doctor's approval mode.
 * Manual mode returns `pending_approval`, which auto-declines (with refund)
 * after `approval_auto_decline_minutes`.
 */
export function statusForNewBooking(approvalMode: ApprovalMode): 'confirmed' | 'pending_approval' {
  return approvalMode === 'manual' ? 'pending_approval' : 'confirmed';
}

/** R13 — deadline for the doctor to respond in manual mode. */
export function autoDeclineDeadline(createdMs: number, policy: Required<DoctorPolicyOverrides>): number {
  return createdMs + policy.approval_auto_decline_minutes * MINUTE_MS;
}

/* -------------------------------------------------------------------- R14 */

/**
 * R14 — a patient may hold at most one *active upcoming* appointment per doctor
 * per local clinic day. Returns the clash when the limit is exceeded.
 */
export function maxActivePerDoctorPerDayViolation(params: {
  startUtc: string;
  existingStartUtcList: readonly string[];
  /** Clinic-local dates of the existing appointments. */
  existingLocalDates: readonly string[];
  startLocalDate: string;
  limit?: number;
}): BookingWindowViolation | null {
  const limit = params.limit ?? defaultPlatformConfig.max_active_per_doctor_per_day;
  const sameDay = params.existingLocalDates.filter((date) => date === params.startLocalDate).length;
  if (sameDay >= limit) {
    return {
      code: 'APT_ALREADY_BOOKED_WITH_DOCTOR',
      message: `You already have ${limit} appointment${limit === 1 ? '' : 's'} with this doctor that day.`,
    };
  }
  return null;
}

/* ------------------------------------------------------------------ R15 */

/** R15 — whether a review may still be created/edited. */
export function reviewWindow(completedAtIso: string, nowMs: number, config = defaultPlatformConfig): {
  canCreate: boolean;
  canEdit: boolean;
  closesAtUtc: string;
} {
  const completed = fromIso(completedAtIso);
  const closesAt = completed + config.review_edit_hours * HOUR_MS;
  return {
    canCreate: nowMs <= closesAt + 30 * 24 * HOUR_MS,
    canEdit: nowMs <= closesAt,
    closesAtUtc: new Date(closesAt).toISOString(),
  };
}

/* --------------------------------------------------------------- helpers */

/** `₹500` / `$12.50` — display formatting for fees and refunds. */
export function formatMoney(minor: number, currency: string): string {
  const symbol =
    currency === 'INR' ? '₹' : currency === 'USD' ? '$' : currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : '';
  const major = minor / 100;
  const body = Number.isInteger(major) ? major.toLocaleString('en-IN') : major.toFixed(2);
  return symbol ? `${symbol}${body}` : `${body} ${currency}`;
}

/** `2 hours` / `30 minutes` / `1 day`. */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  if (minutes < 60 * 24) {
    const hours = Math.round(minutes / 60);
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  const days = Math.round(minutes / (60 * 24));
  return `${days} day${days === 1 ? '' : 's'}`;
}
