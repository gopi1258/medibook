/**
 * Domain → view-model mappers.
 *
 * Screens hand the output of these straight to `@medibook/brand` components. The
 * two shapes are kept identical on purpose: if a mapper drifts, the app's
 * typecheck fails, which is the cheapest possible contract test.
 */
import { defaultPlatformConfig, type PlatformConfig } from './rules.ts';
import {
  clockLabel,
  dateInZone,
  dayLabel,
  dayParts,
  fromIso,
  relativeTimeLabel,
  tzLabel,
  zonesDiffer,
} from './time.ts';
import type {
  Appointment,
  AppointmentStatus,
  AvailabilityDay,
  AvailabilityResponse,
  ConsultType,
  DoctorPolicy,
  DoctorSummary,
  PatientVisitSummary,
  ReviewSummary,
  Slot,
} from './types.ts';

/** Never renders "4.799999" or "-0.0". */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Age in whole years from a `YYYY-MM-DD` date of birth. */
export function ageFromDob(dob: string | null | undefined, nowMs?: number): number | null {
  if (!dob) return null;
  const [y, m, d] = dob.split('-').map(Number);
  if (!y || !m || !d) return null;
  const now = new Date(nowMs ?? Date.now());
  let age = now.getUTCFullYear() - y;
  const monthDelta = now.getUTCMonth() + 1 - m;
  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < d)) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

/** "34 yrs" / "7 yrs" / "—". */
export function ageLabel(age: number | null): string {
  return age === null ? '—' : `${age} yr${age === 1 ? '' : 's'}`;
}

/* ------------------------------------------------------------ appointment */

export type AppointmentCardModel = {
  id: string;
  code: string;
  doctorName: string;
  doctorSpecialty: string;
  patientName: string;
  patientIsDependent: boolean;
  consultType: ConsultType;
  status: AppointmentStatus;
  startUtc: string;
  timeLabel: string;
  dateLabel: string;
  tzLabel: string;
  locationLabel: string | null;
  joinWindowOpen: boolean;
  feeMinor: number;
  currency: string;
  rescheduleCount: number;
  conflictNote: string | null;
};

/**
 * Patient-facing appointment card. `viewerTz` is the *patient's* timezone — the
 * doctor's clinic timezone is included in the label when they differ (R9).
 */
export function toAppointmentCardModel(
  appointment: Appointment,
  options: {
    viewerTz: string;
    nowMs?: number;
    conflictNote?: string | null;
    config?: PlatformConfig;
  },
): AppointmentCardModel {
  const config = options.config ?? defaultPlatformConfig;
  const nowMs = options.nowMs ?? Date.now();
  const startMs = fromIso(appointment.start_utc);
  const viewerTz = options.viewerTz;
  const clinicTz = appointment.doctor_timezone;

  const showDual = zonesDiffer(viewerTz, clinicTz, startMs);
  const tzText = showDual
    ? `${tzLabel(viewerTz, startMs)} · clinic time ${clockLabel(startMs, clinicTz)}`
    : tzLabel(viewerTz, startMs);

  return {
    id: appointment.id,
    code: appointment.code,
    doctorName: appointment.doctor_name,
    doctorSpecialty: appointment.doctor_specialty,
    patientName: appointment.for_name,
    patientIsDependent: appointment.dependent_id !== null,
    consultType: appointment.consult_type,
    status: appointment.status,
    startUtc: appointment.start_utc,
    timeLabel: clockLabel(startMs, viewerTz),
    dateLabel: dayLabel(startMs, viewerTz),
    tzLabel: tzText,
    locationLabel: appointment.clinic_address ?? appointment.clinic_name ?? null,
    joinWindowOpen: isJoinWindowOpen(appointment, { nowMs, config }),
    feeMinor: appointment.fee_minor,
    currency: appointment.currency,
    rescheduleCount: appointment.reschedule_count,
    conflictNote: options.conflictNote ?? null,
  };
}

/** APT-009 — the join window runs T−5m → T+grace. */
export function isJoinWindowOpen(
  appointment: Appointment,
  options: { nowMs?: number; config?: PlatformConfig } = {},
): boolean {
  if (appointment.consult_type !== 'video') return false;
  if (appointment.status !== 'confirmed' && appointment.status !== 'in_progress') return false;
  const config = options.config ?? defaultPlatformConfig;
  const nowMs = options.nowMs ?? Date.now();
  const startMs = fromIso(appointment.start_utc);
  const opens = startMs - config.join_window_minutes_before * 60_000;
  const closes = startMs + config.join_grace_minutes_after * 60_000;
  return nowMs >= opens && nowMs <= closes;
}

/** Cheap status buckets used by list screens and tab badges. */
export function isUpcoming(appointment: Appointment, nowMs?: number): boolean {
  const now = nowMs ?? Date.now();
  const startMs = fromIso(appointment.start_utc);
  const active: AppointmentStatus[] = ['held', 'pending_approval', 'confirmed', 'in_progress'];
  return active.includes(appointment.status) && startMs >= now - 15 * 60_000;
}

export function isPast(appointment: Appointment, nowMs?: number): boolean {
  return !isUpcoming(appointment, nowMs);
}

/* --------------------------------------------------------------- doctor */

export type DoctorCardModel = {
  id: string;
  name: string;
  specialties: string[];
  experienceYears: number;
  rating: number;
  reviewCount: number;
  feeMinor: number;
  currency: string;
  area: string;
  languages: string[];
  verified: boolean;
  nextSlotLabel: string | null;
  consultationTypes: ConsultType[];
  isFavorite: boolean;
};

export function toDoctorCardModel(
  doctor: DoctorSummary,
  options: { viewerTz: string; nowMs?: number } = { viewerTz: 'UTC' },
): DoctorCardModel {
  const nowMs = options.nowMs ?? Date.now();
  const nextSlotLabel =
    doctor.next_slot_utc === null
      ? null
      : relativeTimeLabel(fromIso(doctor.next_slot_utc), options.viewerTz, nowMs);

  return {
    id: doctor.id,
    name: doctor.name,
    specialties: doctor.specialties,
    experienceYears: doctor.experience_years,
    rating: round1(doctor.rating),
    reviewCount: doctor.review_count,
    feeMinor: doctor.fee_minor,
    currency: doctor.currency,
    area: doctor.area,
    languages: doctor.languages,
    verified: doctor.verified && doctor.verification_status === 'approved',
    nextSlotLabel,
    consultationTypes: [...doctor.consultation_types],
    isFavorite: doctor.is_favorite === true,
  };
}

export function toRatingDistribution(summary: ReviewSummary): {
  average: number;
  total: number;
  distribution: [number, number, number, number, number];
} {
  return { average: round1(summary.average), total: summary.total, distribution: summary.distribution };
}

/* --------------------------------------------------------- availability */

export type SlotViewModel = {
  startUtc: string;
  label: string;
  status: 'available' | 'taken' | 'mine' | 'unavailable';
  meta?: string;
};

/** Render a slot in the *viewer's* timezone (PRD R9). */
export function toSlotViewModel(slot: Slot, viewerTz: string): SlotViewModel {
  const startMs = fromIso(slot.start_utc);
  const model: SlotViewModel = {
    startUtc: slot.start_utc,
    label: clockLabel(startMs, viewerTz),
    status: slot.status,
  };
  if (slot.status === 'taken' && slot.blocked_by === 'appointment') {
    return { ...model, meta: 'booked' };
  }
  return model;
}

export type DayViewModel = {
  date: string;
  weekdayLabel: string;
  dayLabel: string;
  monthLabel: string;
  slotCount: number;
  isToday: boolean;
  disabled: boolean;
};

/** Day strip entries for the whole availability window. */
export function toDayViewModels(
  response: AvailabilityResponse,
  options: { nowMs?: number } = {},
): DayViewModel[] {
  const nowMs = options.nowMs ?? Date.now();
  const todayLocal = dateInZone(nowMs, response.doctor_timezone);

  return response.days.map((day) => {
    const parts = dayParts(fromIso(`${day.date}T12:00:00Z`), 'UTC');
    const available = day.slots.filter((slot) => slot.status === 'available').length;
    return {
      date: day.date,
      weekdayLabel: parts.weekdayLabel,
      dayLabel: parts.dayLabel,
      monthLabel: parts.monthLabel,
      slotCount: available,
      isToday: day.date === todayLocal,
      disabled: day.date < todayLocal,
    };
  });
}

/** Slots of one clinic-local day, rendered in the viewer's timezone. */
export function toSlotViewModels(day: AvailabilityDay | undefined, viewerTz: string): SlotViewModel[] {
  if (!day) return [];
  return day.slots.map((slot) => toSlotViewModel(slot, viewerTz));
}

/* -------------------------------------------------------- doctor context */

/** Compact one-line summary of a patient's history with this doctor. */
export function toVisitSummaryLines(visits: readonly PatientVisitSummary[], viewerTz: string): string[] {
  return visits.map(
    (visit) => `${dayLabel(fromIso(visit.start_utc), viewerTz)} · ${visit.status.replace(/_/g, ' ')}`,
  );
}

/** Policy as a bullet list for the doctor's Schedule → Booking policy card. */
export function describePolicy(policy: DoctorPolicy): string[] {
  const minutes = policy.min_notice_minutes;
  const notice =
    minutes % 60 === 0 ? `${minutes / 60} hour${minutes === 60 ? '' : 's'}` : `${minutes} minutes`;
  return [
    `Minimum notice: ${notice}`,
    `Booking window: ${policy.booking_window_days} days`,
    `Approval: ${policy.approval_mode === 'manual' ? 'I approve each request' : 'Auto-confirm bookings'}`,
    policy.approval_mode === 'manual' ? `Auto-decline after ${policy.approval_auto_decline_minutes} min` : null,
    `No-show grace: ${policy.no_show_grace_minutes_video} min video · ${policy.no_show_grace_minutes_clinic} min clinic`,
    `Buffer between patients: ${policy.buffer_minutes} min`,
    `Reschedules allowed: ${policy.max_reschedules} (at least ${policy.reschedule_min_hours} h before)`,
  ].filter((line): line is string => line !== null);
}

/** Turn a country/area code list into the "Languages" line. */
export function joinLanguages(languages: readonly string[]): string {
  return languages.length === 0 ? 'Not specified' : languages.join(' · ');
}
