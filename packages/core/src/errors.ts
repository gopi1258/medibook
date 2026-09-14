/**
 * Error taxonomy (TRD §7.1 / §14).
 *
 * Every error the API can return is enumerated here; clients map codes to UX in
 * one place instead of string-matching messages.
 */

export const errorCodes = [
  // 400
  'VAL_INVALID',
  // 401
  'AUTH_REQUIRED',
  'AUTH_TOKEN_EXPIRED',
  'AUTH_INVALID_REFRESH',
  // 403
  'AUTHZ_FORBIDDEN',
  // 404
  'NOT_FOUND',
  // 409 — booking races & state machine
  'APT_SLOT_TAKEN',
  'APT_HOLD_ACTIVE',
  'APT_STATE_CONFLICT',
  // 410 — holds & windows
  'APT_HOLD_EXPIRED',
  'APT_SLOT_EXPIRED',
  'APT_SLOT_PAST',
  // 422 — domain rejections
  'APT_OUTSIDE_WINDOW',
  'APT_MIN_NOTICE',
  'APT_RESCHEDULE_LIMIT',
  'APT_RESCHEDULE_TOO_LATE',
  'APT_ALREADY_BOOKED_WITH_DOCTOR',
  'APT_REVIEW_NOT_ALLOWED',
  'APT_REVIEW_EXISTS',
  'APT_DEPENDENT_HAS_APPOINTMENTS',
  // auth-specific 422 / 410 / 423
  'AUTH_OTP_INVALID',
  'AUTH_OTP_EXPIRED',
  'AUTH_LOCKED',
  'DOC_NOT_VERIFIED',
  'CAL_SLOT_CONFLICT',
  'PAY_FAILED',
  // 429
  'RATE_LIMITED',
  // 500
  'SYS_INTERNAL',
] as const;

export type ErrorCode = (typeof errorCodes)[number];

/** HTTP status per code — single source of truth for the API and clients. */
export const errorStatus: Record<ErrorCode, number> = {
  VAL_INVALID: 400,
  AUTH_REQUIRED: 401,
  AUTH_TOKEN_EXPIRED: 401,
  AUTH_INVALID_REFRESH: 401,
  AUTHZ_FORBIDDEN: 403,
  NOT_FOUND: 404,
  APT_SLOT_TAKEN: 409,
  APT_HOLD_ACTIVE: 409,
  APT_STATE_CONFLICT: 409,
  APT_HOLD_EXPIRED: 410,
  APT_SLOT_EXPIRED: 410,
  APT_SLOT_PAST: 410,
  APT_OUTSIDE_WINDOW: 422,
  APT_MIN_NOTICE: 422,
  APT_RESCHEDULE_LIMIT: 422,
  APT_RESCHEDULE_TOO_LATE: 422,
  APT_ALREADY_BOOKED_WITH_DOCTOR: 422,
  APT_REVIEW_NOT_ALLOWED: 422,
  APT_REVIEW_EXISTS: 422,
  APT_DEPENDENT_HAS_APPOINTMENTS: 422,
  AUTH_OTP_INVALID: 422,
  AUTH_OTP_EXPIRED: 410,
  AUTH_LOCKED: 423,
  DOC_NOT_VERIFIED: 422,
  CAL_SLOT_CONFLICT: 422,
  PAY_FAILED: 402,
  RATE_LIMITED: 429,
  SYS_INTERNAL: 500,
};

/** Wire format of the error envelope. */
export type ApiErrorBody = {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
    trace_id: string;
  };
};

/** Details payloads for the codes that carry structured context. */
export type SlotTakenDetails = {
  /** ISO-8601 UTC start times of nearby open slots (PRD EC-04). */
  alternatives: string[];
  doctor_id?: string;
  start_utc?: string;
};

export type ApiErrorOptions = {
  details?: Record<string, unknown>;
  traceId?: string;
  /** HTTP override; defaults to `errorStatus[code]`. */
  status?: number;
};

/**
 * Typed API failure. Thrown by the real client; the mock client throws the very
 * same class so screens never branch on transport.
 */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown>;
  readonly traceId: string;
  readonly status: number;

  constructor(code: ErrorCode, message: string, options: ApiErrorOptions = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = options.details ?? {};
    this.traceId = options.traceId ?? 'local';
    this.status = options.status ?? errorStatus[code] ?? 500;
    Object.setPrototypeOf(this, ApiError.prototype);
  }

  /** Nearest open alternatives offered with `APT_SLOT_TAKEN`. */
  get alternatives(): string[] {
    const value = this.details['alternatives'];
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  }

  toBody(): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(Object.keys(this.details).length > 0 ? { details: this.details } : {}),
        trace_id: this.traceId,
      },
    };
  }

  static fromBody(body: unknown, status?: number): ApiError {
    const parsed = body as Partial<ApiErrorBody> | null;
    const err = parsed?.error;
    if (err && typeof err.code === 'string') {
      return new ApiError(err.code as ErrorCode, err.message ?? 'Request failed', {
        details: err.details,
        traceId: err.trace_id,
        status,
      });
    }
    return new ApiError('SYS_INTERNAL', 'Unexpected server response', { status });
  }
}

/** Convenience constructors for the booking path. */
export const apiErrors = {
  slotTaken: (alternatives: string[], doctorId?: string, startUtc?: string) =>
    new ApiError('APT_SLOT_TAKEN', 'That slot was just taken.', {
      details: { alternatives, ...(doctorId ? { doctor_id: doctorId } : {}), ...(startUtc ? { start_utc: startUtc } : {}) },
    }),
  holdExpired: () => new ApiError('APT_HOLD_EXPIRED', 'Your 5-minute hold expired. Please pick the slot again.'),
  holdActive: (holdId: string) =>
    new ApiError('APT_HOLD_ACTIVE', 'You already have a slot on hold.', { details: { hold_id: holdId } }),
  stateConflict: (from: string, to: string) =>
    new ApiError('APT_STATE_CONFLICT', `Cannot move an appointment from ${from} to ${to}.`, {
      details: { from, to },
    }),
  notFound: (what: string, id?: string) =>
    new ApiError('NOT_FOUND', `${what} not found.`, { details: id ? { id } : {} }),
  invalid: (details: Record<string, unknown>, message = 'Some details need fixing.') =>
    new ApiError('VAL_INVALID', message, { details }),
  authRequired: () => new ApiError('AUTH_REQUIRED', 'Please sign in again.'),
  forbidden: (message = 'You do not have access to this.') => new ApiError('AUTHZ_FORBIDDEN', message),
} as const;

/** Human-facing copy for a code, used by the apps' error mapper. */
export const errorCopy: Record<ErrorCode, string> = {
  VAL_INVALID: 'Please check the highlighted fields.',
  AUTH_REQUIRED: 'Please sign in to continue.',
  AUTH_TOKEN_EXPIRED: 'Your session expired. Signing you back in…',
  AUTH_INVALID_REFRESH: 'Please sign in again.',
  AUTHZ_FORBIDDEN: 'You do not have access to this.',
  NOT_FOUND: 'We could not find that.',
  APT_SLOT_TAKEN: 'That slot was just taken. Here are the nearest openings.',
  APT_HOLD_ACTIVE: 'You already have a slot on hold.',
  APT_STATE_CONFLICT: 'This appointment changed on another device. Reloading the latest state.',
  APT_HOLD_EXPIRED: 'Your hold expired. Pick the slot again — nothing was charged.',
  APT_SLOT_EXPIRED: 'That slot is no longer bookable.',
  APT_SLOT_PAST: 'That time has already passed.',
  APT_OUTSIDE_WINDOW: 'That date is outside this doctor’s booking window.',
  APT_MIN_NOTICE: 'That slot is too soon — the doctor needs more notice.',
  APT_RESCHEDULE_LIMIT: 'This appointment has reached its reschedule limit.',
  APT_RESCHEDULE_TOO_LATE: 'It is too close to the appointment time to reschedule.',
  APT_ALREADY_BOOKED_WITH_DOCTOR: 'You already have an appointment with this doctor that day.',
  APT_REVIEW_NOT_ALLOWED: 'You can review after the visit is completed.',
  APT_REVIEW_EXISTS: 'You have already reviewed this visit.',
  APT_DEPENDENT_HAS_APPOINTMENTS: 'This family member has upcoming appointments. Move or cancel them first.',
  AUTH_OTP_INVALID: 'That code is not right. Check the digits and try again.',
  AUTH_OTP_EXPIRED: 'That code has expired. Send a new one.',
  AUTH_LOCKED: 'Too many attempts. Try again in a minute.',
  DOC_NOT_VERIFIED: 'This doctor is not yet approved to take bookings.',
  CAL_SLOT_CONFLICT: 'The doctor’s calendar filled up. Pick another slot.',
  PAY_FAILED: 'Payment did not go through. You were not charged.',
  RATE_LIMITED: 'Too many attempts. Please wait a moment.',
  SYS_INTERNAL: 'Something went wrong on our side. Please retry.',
};

/** True when the client should consider silently refreshing and retrying. */
export function isAuthError(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'AUTH_REQUIRED' || error.code === 'AUTH_TOKEN_EXPIRED');
}

/** True for slot races that surface "nearest alternatives" (PRD EC-04). */
export function isSlotRace(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === 'APT_SLOT_TAKEN' || error.code === 'APT_HOLD_EXPIRED' || error.code === 'CAL_SLOT_CONFLICT')
  );
}
