/**
 * MediBook domain types.
 *
 * Mirrors TRD §6.2 (entity dictionary) and §7 (API shapes). These are the wire
 * types: the mobile apps, the mock API and the real `services/api` all speak
 * exactly this vocabulary, so screens never branch on where data came from.
 */
import type { ErrorCode } from './errors.ts';

/* ------------------------------------------------------------------ enums */

export type Role = 'patient' | 'doctor' | 'admin';

export type Gender = 'female' | 'male' | 'other' | 'undisclosed';

export type ConsultType = 'in_person' | 'video';

export type AppointmentStatus =
  | 'held'
  | 'pending_approval'
  | 'confirmed'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'no_show'
  | 'rescheduled';

/** Statuses that occupy a slot (TRD §6.3 partial unique index predicate). */
export const ACTIVE_APPOINTMENT_STATUSES: readonly AppointmentStatus[] = [
  'held',
  'pending_approval',
  'confirmed',
  'in_progress',
];

export type VerificationStatus = 'pending' | 'under_review' | 'approved' | 'rejected' | 'suspended';

export type CancelledBy = 'patient' | 'doctor' | 'admin' | 'system';

export type CalendarProvider = 'google' | 'microsoft';

export type CalendarAccountStatus = 'connected' | 'syncing' | 'error' | 'revoked' | 'expired';

export type ApprovalMode = 'auto' | 'manual';

export type NotificationChannel = 'push' | 'email' | 'sms' | 'in_app';

export type NotificationCategory =
  | 'booking'
  | 'approval'
  | 'reminder'
  | 'join_window'
  | 'reschedule'
  | 'cancellation'
  | 'payment'
  | 'calendar'
  | 'verification'
  | 'security'
  | 'review';

export type PaymentStatus = 'initiated' | 'authorized' | 'captured' | 'failed' | 'refunded';

export type RefundStatus = 'initiated' | 'processing' | 'completed' | 'failed';

export type PaymentMethod = 'card' | 'upi' | 'netbanking' | 'wallet' | 'free';

export type ExceptionKind = 'leave' | 'block';

/* -------------------------------------------------------------- catalogue */

export type Specialization = {
  id: string;
  name: string;
  slug: string;
  /** Brand icon name, rendered with `@medibook/brand`'s `Icon`. */
  icon: string;
  is_active: boolean;
  doctor_count?: number;
};

export type Qualification = {
  id: string;
  degree: string;
  institution: string;
  year: number;
};

export type ConsultFee = {
  consult_type: ConsultType;
  enabled: boolean;
  duration_minutes: number;
  fee_minor: number;
  currency: string;
};

/** DOC-004 — a doctor's per-type fees and durations. */
export type ConsultationConfig = {
  fees: ConsultFee[];
};

/** APT-011 / REV-001 — one review per completed appointment. */
export type PostVisitReviewRequest = {
  rating: 1 | 2 | 3 | 4 | 5;
  comment?: string | null;
};

/* ------------------------------------------------------------------- auth */

export type OtpChannel = 'phone' | 'email';

export type OtpRequest = {
  channel: OtpChannel;
  /** E.164 phone or RFC-5322 email. */
  destination: string;
  purpose: 'login' | 'register';
  role?: Role;
};

export type OtpVerifyRequest = {
  channel: OtpChannel;
  destination: string;
  code: string;
  role: Role;
  register?: boolean;
  profile_draft?: { display_name?: string; gender?: Gender; dob?: string };
};

export type AuthUser = {
  id: string;
  role: Role;
  phone: string | null;
  email: string | null;
  display_name: string;
  gender: Gender | null;
  dob: string | null;
  default_timezone: string;
  verification_status: VerificationStatus | null;
  onboarding_state: OnboardingState;
  created_at: string;
};

export type OnboardingState =
  | 'needs_profile'
  | 'needs_dependent_prompt'
  | 'complete'
  /** Doctor app only. */
  | 'needs_verification'
  | 'under_review'
  | 'ready_to_go_live'
  | 'live'
  | 'rejected';

export type AuthSession = {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  user: AuthUser;
};

/* --------------------------------------------------------------- patients */

export type PatientProfile = {
  user_id: string;
  display_name: string;
  phone: string | null;
  email: string | null;
  gender: Gender | null;
  dob: string | null;
  default_timezone: string;
  emergency_contact: string | null;
  created_at: string;
};

export type Dependent = {
  id: string;
  guardian_user_id: string;
  name: string;
  relationship: 'son' | 'daughter' | 'spouse' | 'parent' | 'sibling' | 'other';
  dob: string;
  gender: Gender;
  notes: string | null;
  is_active: boolean;
  /** Populated so the UI can block deletion while visits are upcoming. */
  upcoming_appointments?: number;
};

export type NotificationPreference = {
  user_id: string;
  phone: string | null;
  email: string | null;
  /** Per-category channel toggles. */
  entries: Array<{
    category: NotificationCategory;
    push: boolean;
    email: boolean;
    sms: boolean;
    /** Critical categories ignore quiet hours and cannot be muted. */
    critical: boolean;
  }>;
  quiet_hours: { enabled: boolean; start: string; end: string };
};

/* ---------------------------------------------------------------- doctors */

export type DoctorSummary = {
  id: string;
  name: string;
  /** Primary specialty first. */
  specialties: string[];
  primary_specialization_slug: string;
  experience_years: number;
  rating: number;
  review_count: number;
  fee_minor: number;
  currency: string;
  area: string;
  languages: string[];
  gender: Gender;
  verified: boolean;
  verification_status: VerificationStatus;
  consultation_types: ConsultType[];
  /** ISO-8601 UTC start of the next bookable slot; null if none in the window. */
  next_slot_utc: string | null;
  is_favorite?: boolean;
};

export type DoctorDetail = DoctorSummary & {
  bio: string;
  qualifications: Qualification[];
  /** Masked per policy Q9: `MH-1234••••`. */
  registration_number_masked: string;
  council: string;
  clinic_name: string;
  clinic_address: string;
  clinic_geo?: { lat: number; lng: number } | null;
  clinic_timezone: string;
  consult_fees: ConsultFee[];
  review_summary: ReviewSummary;
  reviews: Review[];
  policy: DoctorPolicy;
  calendar_connected: boolean;
};

export type DoctorPolicy = {
  min_notice_minutes: number;
  booking_window_days: number;
  reschedule_min_hours: number;
  max_reschedules: number;
  approval_mode: ApprovalMode;
  approval_auto_decline_minutes: number;
  no_show_grace_minutes_video: number;
  no_show_grace_minutes_clinic: number;
  buffer_minutes: number;
};

export type ReviewSummary = {
  average: number;
  total: number;
  /** Index 0 = 5★ … index 4 = 1★. */
  distribution: [number, number, number, number, number];
};

export type Review = {
  id: string;
  appointment_id: string;
  doctor_id: string;
  patient_display_name: string;
  rating: 1 | 2 | 3 | 4 | 5;
  comment: string | null;
  created_at: string;
  verified_visit: boolean;
  status: 'published' | 'hidden';
};

export type DoctorQuery = {
  q?: string;
  specialization?: string;
  consult_type?: ConsultType;
  /** `today` | `tomorrow` | `YYYY-MM-DD` */
  available?: string;
  fee_min_minor?: number;
  fee_max_minor?: number;
  language?: string;
  gender?: Gender;
  sort?: 'relevance' | 'rating' | 'fee_asc' | 'fee_desc' | 'experience' | 'next_available';
  limit?: number;
  cursor?: string;
};

/* ----------------------------------------------------------- availability */

export type SlotStatus = 'available' | 'taken' | 'mine' | 'unavailable';

export type Slot = {
  start_utc: string;
  end_utc: string;
  /** ISO-8601 with offset, in the doctor's clinic timezone. */
  local_start: string;
  status: SlotStatus;
  fee_minor: number;
  currency: string;
  /** Set when the slot is blocked by an external calendar event (doctor UI only). */
  blocked_by?: 'appointment' | 'exception' | 'calendar' | 'buffer' | 'policy';
};

export type AvailabilityDay = {
  /** Clinic-local calendar date `YYYY-MM-DD`. */
  date: string;
  slots: Slot[];
};

export type CalendarSyncInfo = {
  connected: boolean;
  last_synced_at: string | null;
  /** ISO-8601 duration, e.g. `PT2M`. */
  staleness: string | null;
};

export type AvailabilityResponse = {
  doctor_id: string;
  consult_type: ConsultType;
  doctor_timezone: string;
  generated_at: string;
  /** Timezone the request asked for; slots carry UTC + clinic-local times. */
  requested_timezone: string;
  calendar_sync: CalendarSyncInfo;
  days: AvailabilityDay[];
};

export type AvailabilityQuery = {
  tz?: string;
  from?: string;
  to?: string;
  type?: ConsultType;
};

/* ------------------------------------------------------------ appointments */

export type Hold = {
  id: string;
  patient_user_id: string;
  doctor_id: string;
  consult_type: ConsultType;
  start_utc: string;
  end_utc: string;
  expires_at: string;
  status: 'active' | 'released' | 'expired' | 'converted';
};

export type Payment = {
  id: string;
  appointment_id: string;
  method: PaymentMethod;
  amount_minor: number;
  currency: string;
  status: PaymentStatus;
  provider_ref: string;
  receipt_url: string | null;
  created_at: string;
};

export type Refund = {
  id: string;
  payment_id: string;
  amount_minor: number;
  currency: string;
  reason: string;
  /** Percentage of the fee returned per PRD §13 R2. */
  tier_percent: 0 | 50 | 100;
  status: RefundStatus;
  created_at: string;
};

export type Appointment = {
  id: string;
  code: string;
  patient_user_id: string;
  patient_name: string;
  dependent_id: string | null;
  dependent_name: string | null;
  /** Who the visit is for — `self` or the dependent's name. */
  for_name: string;
  doctor_id: string;
  doctor_name: string;
  doctor_specialty: string;
  doctor_timezone: string;
  consult_type: ConsultType;
  start_utc: string;
  end_utc: string;
  status: AppointmentStatus;
  cancelled_by: CancelledBy | null;
  cancel_reason: string | null;
  reschedule_of_id: string | null;
  reschedule_count: number;
  fee_minor: number;
  currency: string;
  clinic_name: string | null;
  clinic_address: string | null;
  /** Deep link / room for video consults; minted on demand in production. */
  join_url: string | null;
  patient_note: string | null;
  payment: Payment | null;
  refund: Refund | null;
  review_id: string | null;
  created_at: string;
  updated_at: string;
};

export type CreateHoldRequest = {
  doctor_id: string;
  consult_type: ConsultType;
  start_utc: string;
};

export type CreateAppointmentRequest = {
  hold_id?: string | null;
  doctor_id: string;
  consult_type: ConsultType;
  start_utc: string;
  dependent_id?: string | null;
  note?: string | null;
  payment?: { method: PaymentMethod } | null;
};

export type RescheduleRequest = { start_utc: string };

export type CancelRequest = { reason: string; note?: string | null };

export type CancelResult = {
  appointment: Appointment;
  refund: Refund | null;
  /** Policy copy shown before the user confirmed. */
  policy: CancellationPolicyPreview;
};

export type CancellationPolicyPreview = {
  /** Percentage of the fee refunded if cancelled now. */
  refund_percent: 0 | 50 | 100;
  refund_minor: number;
  currency: string;
  /** Human summary, e.g. "Cancelling now refunds 100% (₹500)". */
  summary: string;
  /** Rule id from PRD §13. */
  rule: 'R2' | 'R8';
};

export type ReschedulePolicyPreview = {
  allowed: boolean;
  /** Set when `allowed` is false. */
  reason_code?: ErrorCode;
  reason?: string;
  remaining_reschedules: number;
  hours_until_start: number;
  summary: string;
};

export type AppointmentListQuery = {
  /** `today` and `pending` are doctor-side views (DOC-010). */
  scope?: 'upcoming' | 'past' | 'all' | 'today' | 'pending';
  /** Filter to a dependent id, or `self`. */
  member?: string;
  doctor_id?: string;
  status?: AppointmentStatus;
  limit?: number;
  cursor?: string;
};

/* --------------------------------------------------------- notifications */

export type AppNotification = {
  id: string;
  user_id: string;
  category: NotificationCategory;
  channel: NotificationChannel;
  title: string;
  body: string;
  /** Deep-link target, e.g. `/appointments/apt_771`. */
  deeplink: string | null;
  appointment_id: string | null;
  read_at: string | null;
  sent_at: string;
  created_at: string;
};

/* ------------------------------------------------------- doctor-side types */

export type AvailabilityRule = {
  id: string;
  doctor_id: string;
  /** 0=Sunday … 6=Saturday. */
  weekday: number;
  start_local_time: string;
  end_local_time: string;
  slot_minutes: number;
  buffer_minutes: number;
  consult_types: ConsultType[];
  effective_from: string;
};

export type AvailabilityException = {
  id: string;
  doctor_id: string;
  start_utc: string;
  end_utc: string;
  kind: ExceptionKind;
  reason: string;
  created_at: string;
  /** Booked appointments that this exception now overlaps (PRD EC-01). */
  affected_appointments: Array<{
    id: string;
    code: string;
    patient_name: string;
    for_name: string;
    start_utc: string;
    status: AppointmentStatus;
  }>;
};

export type CalendarAccount = {
  id: string;
  doctor_id: string;
  provider: CalendarProvider;
  account_email: string;
  status: CalendarAccountStatus;
  last_synced_at: string | null;
  busy_events_90d: number;
  conflicts_open: number;
  connected_at: string;
};

export type DoctorStats = {
  today_total: number;
  today_completed: number;
  today_cancellations: number;
  pending_approvals: number;
  next_free_slot_utc: string | null;
  conflicts_open: number;
  /** Appointments an external calendar event currently overlaps (PRD EC-03). */
  conflict_appointment_ids: string[];
  calendar_status: CalendarAccountStatus | 'not_connected';
  last_synced_at: string | null;
};

export type PatientVisitSummary = {
  appointment_id: string;
  code: string;
  start_utc: string;
  status: AppointmentStatus;
  consult_type: ConsultType;
  note: string | null;
};

export type PatientContext = {
  patient_user_id: string;
  dependent_id: string | null;
  display_name: string;
  relationship: string | null;
  age: number | null;
  gender: Gender | null;
  phone_masked: string | null;
  note: string | null;
  /** Visits with *this* doctor only — PRD DOC-015 scoping. */
  visits_with_doctor: PatientVisitSummary[];
  no_show_count_with_doctor: number;
  completed_count_with_doctor: number;
};

export type SeenPatient = {
  patient_user_id: string;
  dependent_id: string | null;
  display_name: string;
  age: number | null;
  gender: Gender | null;
  last_seen_utc: string;
  visits_with_doctor: number;
  no_show_count_with_doctor: number;
};

export type VerificationSubmission = {
  status: VerificationStatus;
  registration_number: string;
  council: string;
  country: string;
  specialization_slugs: string[];
  documents: Array<{ id: string; kind: 'license' | 'government_id' | 'degree'; filename: string; uploaded_at: string }>;
  submitted_at: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  /** Progress toward "ready to go live". */
  checklist: Array<{ key: string; label: string; done: boolean }>;
};

export type DoctorProfile = {
  user_id: string;
  display_name: string;
  phone: string | null;
  email: string | null;
  gender: Gender;
  bio: string;
  experience_years: number;
  languages: string[];
  qualifications: Qualification[];
  specialization_slugs: string[];
  clinic_name: string;
  clinic_address: string;
  clinic_timezone: string;
  clinic_geo?: { lat: number; lng: number } | null;
  consultation_config: ConsultationConfig;
  policy: DoctorPolicy;
  verification_status: VerificationStatus;
  verified_at: string | null;
  deactivation_requested_at: string | null;
};

/* ------------------------------------------------------------- paging etc */

export type Page<T> = {
  items: T[];
  meta: { next_cursor: string | null; total?: number };
};

export type HealthResponse = {
  status: 'ok';
  version: string;
  time: string;
  database: string;
};
