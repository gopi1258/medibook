/**
 * Presentation helpers. All time rendering goes through `@medibook/core`'s tz
 * utilities so both apps and the API agree on labels (PRD R9 / X4).
 */
import {
  ApiError,
  ageFromDob,
  clockLabel,
  dayLabel,
  deviceTimeZone,
  errorCopy,
  formatMoney,
  fromIso,
  isSlotRace,
  longDateLabel,
  relativeTimeLabel,
  stalenessLabel,
  tzLabel,
  zonesDiffer,
} from '@medibook/core';
import type { Appointment, ConsultType, Slot } from '@medibook/core';

export {
  ageFromDob,
  ageLabel,
  formatDuration,
  formatMoney,
  joinLanguages,
  describePolicy,
  isJoinWindowOpen,
  isPast,
  isUpcoming,
} from '@medibook/core';

/** The viewer's timezone: their profile setting, else the device's. */
export function viewerTimeZone(profileTz?: string | null): string {
  return profileTz && profileTz.length > 0 ? profileTz : deviceTimeZone();
}

/** `Today · 6:30 PM` in the viewer's zone. */
export function appointmentTimeLabel(appointment: Appointment, viewerTz: string, nowMs?: number): string {
  return relativeTimeLabel(fromIso(appointment.start_utc), viewerTz, nowMs);
}

/** `Sun, 20 Sep` in the viewer's zone. */
export function appointmentDateLabel(appointment: Appointment, viewerTz: string): string {
  return dayLabel(fromIso(appointment.start_utc), viewerTz);
}

export function appointmentLongDateLabel(appointment: Appointment, viewerTz: string): string {
  return longDateLabel(fromIso(appointment.start_utc), viewerTz);
}

export function appointmentClockLabel(appointment: Appointment, viewerTz: string): string {
  return clockLabel(fromIso(appointment.start_utc), viewerTz);
}

/**
 * Explicit timezone label for an appointment, with the clinic's clock appended
 * whenever the two zones disagree (PRD R9: "cross-tz bookings display both").
 */
export function appointmentTzLabel(appointment: Appointment, viewerTz: string): string {
  const startMs = fromIso(appointment.start_utc);
  const clinicTz = appointment.doctor_timezone;
  if (zonesDiffer(viewerTz, clinicTz, startMs)) {
    return `${tzLabel(viewerTz, startMs)} · clinic ${clockLabel(startMs, clinicTz)}`;
  }
  return tzLabel(viewerTz, startMs);
}

export function slotFreshnessLabel(staleness: string | null, lastSyncedAt: string | null): string | null {
  if (!lastSyncedAt) return null;
  return stalenessLabel(lastSyncedAt) ?? `Synced ${staleness ?? ''}`.trim();
}

export function consultTypeLabel(consultType: ConsultType): string {
  return consultType === 'video' ? 'Video consult' : 'In-clinic visit';
}

export function consultTypeIcon(consultType: ConsultType): 'video' | 'map-pin' {
  return consultType === 'video' ? 'video' : 'map-pin';
}

export function feeLabel(feeMinor: number, currency: string): string {
  return feeMinor === 0 ? 'Free' : formatMoney(feeMinor, currency);
}

/** Fee for one slot, from the availability payload. */
export function slotFeeLabel(slot: Slot): string {
  return feeLabel(slot.fee_minor, slot.currency);
}

/**
 * A user-facing sentence for any failure. `ApiError` codes map through
 * `errorCopy`; slot races get their own branch because the caller usually wants
 * to show alternatives instead.
 */
export function describeError(error: unknown): { message: string; code: string | null; alternatives: string[] } {
  if (error instanceof ApiError) {
    return {
      message: error.message || errorCopy[error.code],
      code: error.code,
      alternatives: error.alternatives,
    };
  }
  if (error instanceof Error && error.message) return { message: error.message, code: null, alternatives: [] };
  return { message: 'Something went wrong on our side. Please retry.', code: null, alternatives: [] };
}

export { isSlotRace };

/** `MB-8H2K4` → `MB-8H2K4` (kept as its own helper so screens read well). */
export function appointmentCodeLabel(code: string): string {
  return code;
}

export function pluralise(count: number, singular: string, plural?: string): string {
  return `${count} ${count === 1 ? singular : (plural ?? `${singular}s`)}`;
}

/** Human relationship label for dependents. */
export function relationshipLabel(relationship: string): string {
  const map: Record<string, string> = {
    son: 'Son',
    daughter: 'Daughter',
    spouse: 'Spouse',
    parent: 'Parent',
    sibling: 'Sibling',
    other: 'Family member',
  };
  return map[relationship] ?? 'Family member';
}

export function genderLabel(gender: string | null | undefined): string {
  if (!gender || gender === 'undisclosed') return 'Not specified';
  return gender.charAt(0).toUpperCase() + gender.slice(1);
}
