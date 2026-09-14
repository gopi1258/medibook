/**
 * Row → domain mappers.
 *
 * Every SQL result leaves the database through this module, so the wire shapes in
 * `@medibook/core` are produced in exactly one place. Columns are snake_case and
 * already match the domain types, which keeps the mapping honest and cheap.
 */
import type {
  Appointment,
  AppointmentStatus,
  AuthUser,
  AvailabilityException,
  AvailabilityRule,
  CalendarAccount,
  ConsultationConfig,
  ConsultFee,
  ConsultType,
  Dependent,
  DoctorDetail,
  DoctorPolicy,
  DoctorProfile,
  DoctorSummary,
  Gender,
  NotificationChannel,
  NotificationCategory,
  NotificationPreference,
  AppNotification,
  PatientProfile,
  Payment,
  PaymentMethod,
  PaymentStatus,
  Refund,
  RefundStatus,
  Review,
  ReviewSummary,
  Specialization,
  VerificationStatus,
} from '@medibook/core';
import { defaultPlatformConfig, effectivePolicy } from '@medibook/core';

import { all, json, one, type Db } from './database.ts';
import { ACTIVE_STATUSES_SQL } from './schema.ts';

export type UserRow = {
  id: string;
  role: 'patient' | 'doctor' | 'admin';
  phone: string | null;
  email: string | null;
  display_name: string;
  gender: string | null;
  dob: string | null;
  default_timezone: string;
  locale: string;
  status: string;
  onboarding_state: string;
  created_at: string;
};

export type PatientProfileRow = UserRow & {
  emergency_contact: string | null;
  photo_key: string | null;
};

export type DoctorRow = {
  id: string;
  display_name: string;
  bio: string;
  gender: string;
  experience_years: number;
  languages: string;
  registration_number: string;
  council: string;
  country: string;
  clinic_name: string;
  clinic_address: string;
  area: string;
  clinic_timezone: string;
  currency: string;
  verification_status: string;
  verified_at: string | null;
  rejection_reason: string | null;
  deactivation_requested_at: string | null;
  rating_seed: number;
  review_count_seed: number;
  created_at: string;
  specialties: string | null;
  primary_slug: string | null;
  min_fee_minor: number | null;
  video_enabled: number | null;
  in_person_enabled: number | null;
};

export type DoctorPolicyRow = {
  doctor_id: string;
  min_notice_minutes: number | null;
  booking_window_days: number | null;
  reschedule_min_hours: number | null;
  max_reschedules: number | null;
  approval_mode: string;
  approval_auto_decline_minutes: number | null;
  no_show_grace_minutes_video: number | null;
  no_show_grace_minutes_clinic: number | null;
  buffer_minutes: number | null;
};

export type AppointmentRow = {
  id: string;
  code: string;
  patient_user_id: string;
  patient_name: string;
  dependent_id: string | null;
  dependent_name: string | null;
  for_name: string;
  doctor_id: string;
  consult_type: ConsultType;
  start_utc: string;
  end_utc: string;
  doctor_timezone: string;
  status: AppointmentStatus;
  cancelled_by: string | null;
  cancel_reason: string | null;
  reschedule_of_id: string | null;
  reschedule_count: number;
  fee_minor: number;
  currency: string;
  clinic_name: string | null;
  clinic_address: string | null;
  join_url: string | null;
  patient_note: string | null;
  created_at: string;
  updated_at: string;
  doctor_name: string;
  doctor_specialty: string | null;
};

/** Columns every appointment read shares. */
export const APPOINTMENT_SELECT = `
  SELECT a.*, d.display_name AS doctor_name, d.clinic_timezone,
         (SELECT s.name
            FROM doctor_specializations ds
            JOIN specializations s ON s.id = ds.specialization_id
           WHERE ds.doctor_id = d.id AND ds.is_primary = 1
           LIMIT 1) AS doctor_specialty
    FROM appointments a
    JOIN doctors d ON d.id = a.doctor_id`;

export function mapAuthUser(row: UserRow, verificationStatus: VerificationStatus | null): AuthUser {
  return {
    id: row.id,
    role: row.role,
    phone: row.phone,
    email: row.email,
    display_name: row.display_name,
    gender: (row.gender as Gender | null) ?? null,
    dob: row.dob,
    default_timezone: row.default_timezone,
    verification_status: verificationStatus,
    onboarding_state: row.onboarding_state as AuthUser['onboarding_state'],
    created_at: row.created_at,
  };
}

export function mapPatientProfile(row: PatientProfileRow): PatientProfile {
  return {
    user_id: row.id,
    display_name: row.display_name,
    phone: row.phone,
    email: row.email,
    gender: (row.gender as Gender | null) ?? null,
    dob: row.dob,
    default_timezone: row.default_timezone,
    emergency_contact: row.emergency_contact,
    created_at: row.created_at,
  };
}

export function mapDependentRow(row: {
  id: string;
  guardian_user_id: string;
  name: string;
  relationship: string;
  dob: string;
  gender: string;
  notes: string | null;
  is_active: number;
}): Dependent {
  return {
    id: row.id,
    guardian_user_id: row.guardian_user_id,
    name: row.name,
    relationship: row.relationship as Dependent['relationship'],
    dob: row.dob,
    gender: row.gender as Gender,
    notes: row.notes,
    is_active: row.is_active === 1,
  };
}

export function mapSpecialization(row: {
  id: string;
  name: string;
  slug: string;
  icon: string;
  is_active: number;
  doctor_count?: number;
}): Specialization {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    icon: row.icon,
    is_active: row.is_active === 1,
    doctor_count: row.doctor_count ?? 0,
  };
}

export function mapDoctorSummary(row: DoctorRow): DoctorSummary {
  const specialties = json<string[]>(row.specialties, []);
  const consultationTypes: ConsultType[] = [];
  if (row.in_person_enabled === 1) consultationTypes.push('in_person');
  if (row.video_enabled === 1) consultationTypes.push('video');

  return {
    id: row.id,
    name: row.display_name,
    specialties: specialties.length > 0 ? specialties : ['Specialist'],
    primary_specialization_slug: row.primary_slug ?? 'general-medicine',
    experience_years: row.experience_years,
    rating: Math.round(row.rating_seed * 10) / 10,
    review_count: row.review_count_seed,
    fee_minor: row.min_fee_minor ?? 0,
    currency: row.currency,
    area: row.area,
    languages: json<string[]>(row.languages, []),
    gender: row.gender as Gender,
    verified: row.verification_status === 'approved',
    verification_status: row.verification_status as VerificationStatus,
    consultation_types: consultationTypes,
    next_slot_utc: null,
  };
}

export function mapDoctorPolicy(row: DoctorPolicyRow | null): DoctorPolicy {
  const effective = effectivePolicy({
    min_notice_minutes: row?.min_notice_minutes ?? undefined,
    booking_window_days: row?.booking_window_days ?? undefined,
    reschedule_min_hours: row?.reschedule_min_hours ?? undefined,
    max_reschedules: row?.max_reschedules ?? undefined,
    approval_mode: (row?.approval_mode as 'auto' | 'manual' | undefined) ?? undefined,
    approval_auto_decline_minutes: row?.approval_auto_decline_minutes ?? undefined,
    no_show_grace_minutes_video: row?.no_show_grace_minutes_video ?? undefined,
    no_show_grace_minutes_clinic: row?.no_show_grace_minutes_clinic ?? undefined,
    buffer_minutes: row?.buffer_minutes ?? undefined,
  });
  return {
    min_notice_minutes: effective.min_notice_minutes,
    booking_window_days: effective.booking_window_days,
    reschedule_min_hours: effective.reschedule_min_hours,
    max_reschedules: effective.max_reschedules,
    approval_mode: effective.approval_mode,
    approval_auto_decline_minutes: effective.approval_auto_decline_minutes,
    no_show_grace_minutes_video: effective.no_show_grace_minutes_video,
    no_show_grace_minutes_clinic: effective.no_show_grace_minutes_clinic,
    buffer_minutes: effective.buffer_minutes,
  };
}

export function mapConsultFees(db: Db, doctorId: string): ConsultFee[] {
  const rows = all<{
    consult_type: ConsultType;
    enabled: number;
    duration_minutes: number;
    fee_minor: number;
    currency: string;
  }>(
    db,
    `SELECT consult_type, enabled, duration_minutes, fee_minor, currency FROM consult_fees WHERE doctor_id = ?`,
    doctorId,
  );
  return rows.map((row) => ({
    consult_type: row.consult_type,
    enabled: row.enabled === 1,
    duration_minutes: row.duration_minutes,
    fee_minor: row.fee_minor,
    currency: row.currency,
  }));
}

export function mapReviewRow(row: {
  id: string;
  appointment_id: string;
  doctor_id: string;
  patient_display_name: string;
  rating: number;
  comment: string | null;
  created_at: string;
  status: string;
}): Review {
  return {
    id: row.id,
    appointment_id: row.appointment_id,
    doctor_id: row.doctor_id,
    patient_display_name: row.patient_display_name,
    rating: Math.min(5, Math.max(1, row.rating)) as Review['rating'],
    comment: row.comment,
    created_at: row.created_at,
    verified_visit: true,
    status: row.status === 'hidden' ? 'hidden' : 'published',
  };
}

/**
 * Review aggregate. Seeded totals (`rating_seed`, `review_count_seed`) represent
 * reviews imported from the doctor's pre-MediBook history; the local reviews
 * table is folded in on top.
 */
export function mapReviewSummary(db: Db, row: DoctorRow): ReviewSummary {
  const seededCount = Math.max(0, row.review_count_seed);
  const seededAverage = row.rating_seed;
  const seededTotalStars = Math.round(seededAverage * seededCount);

  const local = all<{ rating: number; count: number }>(
    db,
    `SELECT rating, COUNT(*) AS count FROM reviews WHERE doctor_id = ? AND status = 'published' GROUP BY rating`,
    row.id,
  );
  const byRating = new Map<number, number>();
  for (const entry of local) byRating.set(entry.rating, entry.count);

  const localTotal = [...byRating.values()].reduce((sum, value) => sum + value, 0);
  const localStars = [...byRating.entries()].reduce((sum, [rating, count]) => sum + rating * count, 0);

  const total = seededCount + localTotal;
  const stars = seededTotalStars + localStars;
  const average = total > 0 ? stars / total : 0;

  // Seeded reviews are assumed to follow the doctor's average; the distribution
  // is therefore a plausible spread rather than a fabrication of exact counts.
  const distribution: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  if (seededCount > 0) {
    const weights = [0.74, 0.17, 0.06, 0.02, 0.01];
    weights.forEach((weight, index) => {
      distribution[index] = Math.round(seededCount * weight);
    });
  }
  for (const [rating, count] of byRating) {
    const index = 5 - rating;
    distribution[index] = (distribution[index] ?? 0) + count;
  }
  const drift = total - distribution.reduce((sum, value) => sum + value, 0);
  distribution[0] = (distribution[0] ?? 0) + drift;

  return { average: Math.round(average * 10) / 10, total, distribution };
}

export function mapAppointment(
  db: Db,
  row: AppointmentRow,
  extras: { specialties?: string[] } = {},
): Appointment {
  const payment = one<{
    id: string;
    appointment_id: string;
    method: string;
    amount_minor: number;
    currency: string;
    status: string;
    provider_ref: string;
    receipt_url: string | null;
    created_at: string;
  }>(db, `SELECT * FROM payments WHERE appointment_id = ? ORDER BY created_at DESC LIMIT 1`, row.id);

  const mappedPayment: Payment | null = payment
    ? {
        id: payment.id,
        appointment_id: payment.appointment_id,
        method: payment.method as PaymentMethod,
        amount_minor: payment.amount_minor,
        currency: payment.currency,
        status: payment.status as PaymentStatus,
        provider_ref: payment.provider_ref,
        receipt_url: payment.receipt_url,
        created_at: payment.created_at,
      }
    : null;

  const refundRow = payment
    ? one<{
        id: string;
        payment_id: string;
        amount_minor: number;
        currency: string;
        reason: string;
        tier_percent: number;
        status: string;
        created_at: string;
      }>(db, `SELECT * FROM refunds WHERE payment_id = ? ORDER BY created_at DESC LIMIT 1`, payment.id)
    : undefined;

  const refund: Refund | null = refundRow
    ? {
        id: refundRow.id,
        payment_id: refundRow.payment_id,
        amount_minor: refundRow.amount_minor,
        currency: refundRow.currency,
        reason: refundRow.reason,
        tier_percent: refundRow.tier_percent as Refund['tier_percent'],
        status: refundRow.status as RefundStatus,
        created_at: refundRow.created_at,
      }
    : null;

  const review = one<{ id: string }>(db, `SELECT id FROM reviews WHERE appointment_id = ?`, row.id);

  return {
    id: row.id,
    code: row.code,
    patient_user_id: row.patient_user_id,
    patient_name: row.patient_name,
    dependent_id: row.dependent_id,
    dependent_name: row.dependent_name,
    for_name: row.for_name,
    doctor_id: row.doctor_id,
    doctor_name: row.doctor_name,
    doctor_specialty:
      row.doctor_specialty ?? extras.specialties?.[0] ?? 'Specialist',
    doctor_timezone: row.doctor_timezone,
    consult_type: row.consult_type,
    start_utc: row.start_utc,
    end_utc: row.end_utc,
    status: row.status,
    cancelled_by: (row.cancelled_by as Appointment['cancelled_by']) ?? null,
    cancel_reason: row.cancel_reason,
    reschedule_of_id: row.reschedule_of_id,
    reschedule_count: row.reschedule_count,
    fee_minor: row.fee_minor,
    currency: row.currency,
    clinic_name: row.clinic_name,
    clinic_address: row.clinic_address,
    join_url: row.consult_type === 'video' ? `medibook://consult/${row.id}` : null,
    patient_note: row.patient_note,
    payment: mappedPayment,
    refund,
    review_id: review?.id ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function mapNotificationRow(row: {
  id: string;
  user_id: string;
  category: string;
  channel: string;
  title: string;
  body: string;
  deeplink: string | null;
  appointment_id: string | null;
  read_at: string | null;
  sent_at: string;
  created_at: string;
}): AppNotification {
  return {
    id: row.id,
    user_id: row.user_id,
    category: row.category as NotificationCategory,
    channel: row.channel as NotificationChannel,
    title: row.title,
    body: row.body,
    deeplink: row.deeplink,
    appointment_id: row.appointment_id,
    read_at: row.read_at,
    sent_at: row.sent_at,
    created_at: row.created_at,
  };
}

export function mapPreferences(db: Db, userId: string, user: UserRow): NotificationPreference {
  const entries = all<{ category: string; push: number; email: number; sms: number; critical: number }>(
    db,
    `SELECT category, push, email, sms, critical FROM notification_preferences WHERE user_id = ? ORDER BY category`,
    userId,
  );
  const quiet = one<{ enabled: number; start: string; end: string }>(
    db,
    `SELECT enabled, start, end FROM quiet_hours WHERE user_id = ?`,
    userId,
  );
  return {
    user_id: userId,
    phone: user.phone,
    email: user.email,
    entries: entries.map((entry) => ({
      category: entry.category as NotificationCategory,
      push: entry.push === 1,
      email: entry.email === 1,
      sms: entry.sms === 1,
      critical: entry.critical === 1,
    })),
    quiet_hours: {
      enabled: quiet ? quiet.enabled === 1 : false,
      start: quiet?.start ?? '22:00',
      end: quiet?.end ?? '07:00',
    },
  };
}

export function mapRuleRow(row: {
  id: string;
  doctor_id: string;
  weekday: number;
  start_local_time: string;
  end_local_time: string;
  slot_minutes: number;
  buffer_minutes: number;
  consult_types: string;
  effective_from: string;
}): AvailabilityRule {
  return {
    id: row.id,
    doctor_id: row.doctor_id,
    weekday: row.weekday,
    start_local_time: row.start_local_time,
    end_local_time: row.end_local_time,
    slot_minutes: row.slot_minutes,
    buffer_minutes: row.buffer_minutes,
    consult_types: json<ConsultType[]>(row.consult_types, []),
    effective_from: row.effective_from,
  };
}

export function mapExceptionRow(
  db: Db,
  row: {
    id: string;
    doctor_id: string;
    start_utc: string;
    end_utc: string;
    kind: string;
    reason: string;
    created_at: string;
  },
): AvailabilityException {
  // Booked appointments the block now overlaps — the PRD EC-01 "resolution list".
  const affected = all<{
    id: string;
    code: string;
    patient_name: string;
    for_name: string;
    start_utc: string;
    status: AppointmentStatus;
  }>(
    db,
    `SELECT id, code, patient_name, for_name, start_utc, status
       FROM appointments
      WHERE doctor_id = ?
        AND status IN ${ACTIVE_STATUSES_SQL}
        AND start_utc < ?
        AND end_utc > ?`,
    row.doctor_id,
    row.end_utc,
    row.start_utc,
  );

  return {
    id: row.id,
    doctor_id: row.doctor_id,
    start_utc: row.start_utc,
    end_utc: row.end_utc,
    kind: row.kind === 'leave' ? 'leave' : 'block',
    reason: row.reason,
    created_at: row.created_at,
    affected_appointments: affected.map((appointment) => ({
      id: appointment.id,
      code: appointment.code,
      patient_name: appointment.patient_name,
      for_name: appointment.for_name,
      start_utc: appointment.start_utc,
      status: appointment.status,
    })),
  };
}

export function mapCalendarAccountRow(row: {
  id: string;
  doctor_id: string;
  provider: string;
  account_email: string;
  status: string;
  last_synced_at: string | null;
  busy_events_90d: number;
  conflicts_open: number;
  connected_at: string;
}): CalendarAccount {
  return {
    id: row.id,
    doctor_id: row.doctor_id,
    provider: row.provider as CalendarAccount['provider'],
    account_email: row.account_email,
    status: row.status as CalendarAccount['status'],
    last_synced_at: row.last_synced_at,
    busy_events_90d: row.busy_events_90d,
    conflicts_open: row.conflicts_open,
    connected_at: row.connected_at,
  };
}

export function mapDoctorProfile(row: DoctorRow, policy: DoctorPolicy, fees: ConsultFee[]): DoctorProfile {
  return {
    user_id: row.id,
    display_name: row.display_name,
    phone: null,
    email: null,
    gender: row.gender as Gender,
    bio: row.bio,
    experience_years: row.experience_years,
    languages: json<string[]>(row.languages, []),
    qualifications: [],
    specialization_slugs: [],
    clinic_name: row.clinic_name,
    clinic_address: row.clinic_address,
    clinic_timezone: row.clinic_timezone,
    clinic_geo: null,
    consultation_config: { fees } satisfies ConsultationConfig,
    policy,
    verification_status: row.verification_status as VerificationStatus,
    verified_at: row.verified_at,
    deactivation_requested_at: row.deactivation_requested_at,
  };
}

export function mapDoctorDetail(input: {
  db: Db;
  row: DoctorRow;
  fees: ConsultFee[];
  policy: DoctorPolicy;
  reviews: Review[];
  reviewSummary: ReviewSummary;
  calendarConnected: boolean;
}): DoctorDetail {
  const { db, row } = input;
  const qualifications = all<{ id: string; degree: string; institution: string; year: number }>(
    db,
    `SELECT id, degree, institution, year FROM qualifications WHERE doctor_id = ? ORDER BY year`,
    row.id,
  );

  const summary = mapDoctorSummary(row);
  return {
    ...summary,
    bio: row.bio,
    qualifications,
    registration_number_masked: maskRegistration(row.registration_number),
    council: row.council,
    clinic_name: row.clinic_name,
    clinic_address: row.clinic_address,
    clinic_geo: null,
    clinic_timezone: row.clinic_timezone,
    consult_fees: input.fees,
    review_summary: input.reviewSummary,
    reviews: input.reviews,
    policy: input.policy,
    calendar_connected: input.calendarConnected,
  };
}

/** `MH-2014-44821` → `MH-2014-•••••` (PRD Q9: mask unless policy says otherwise). */
export function maskRegistration(value: string): string {
  if (value.length <= 6) return value;
  return `${value.slice(0, value.length - 4)}••••`;
}

export const PLATFORM_DEFAULT_BUFFER = defaultPlatformConfig.buffer_minutes;
