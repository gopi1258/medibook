/**
 * @module domain/slotEngine
 *
 * The slot engine itself is `expandSlots` in `@medibook/core` — a pure,
 * deterministic function with no I/O, unit-tested here including DST cases.
 *
 * This module is the *database-facing composer*: it assembles the engine's input
 * from SQL evidence (weekly rules, exceptions, active appointments, imported
 * calendar busy time, live holds) and returns the TRD §7.3.3 availability
 * payload. Nothing here re-implements expansion; it only gathers and adapts.
 */
import { expandSlots, nearestAlternatives, openSlots } from '@medibook/core';
import type {
  AvailabilityDay,
  AvailabilityResponse,
  ConsultType,
  Slot,
  SlotBusyInterval,
  SlotEngineInput,
  SlotEngineResult,
  SlotEngineRule,
} from '@medibook/core';
import type { DoctorPolicyOverrides } from '@medibook/core';
import { all, json, one, type Db } from '../db/database.ts';
import { ACTIVE_STATUSES_SQL } from '../db/schema.ts';

export { expandSlots, nearestAlternatives, openSlots };
export type { Slot, SlotEngineInput, SlotEngineResult, SlotEngineRule };

export type DoctorRow = {
  id: string;
  display_name: string;
  clinic_timezone: string;
  currency: string;
  verification_status: string;
  clinic_name: string;
  clinic_address: string;
};

export type ComposeAvailabilityOptions = {
  db: Db;
  doctor: DoctorRow;
  consultType: ConsultType;
  policy: Required<DoctorPolicyOverrides>;
  fromDate: string;
  toDate: string;
  nowMs: number;
  /** Excluded from the busy set — a patient's own holds must not hide their slot. */
  ownHoldUserId?: string;
  /** Excluded from the busy set — used when validating a reschedule of that appointment. */
  excludeAppointmentId?: string;
  /** Start instants of the requesting patient's bookings, rendered as `mine`. */
  mineStartUtcs?: readonly string[];
  /** Publish simulated external busy time (no real provider is contacted). */
  calendarBusy?: readonly SlotBusyInterval[];
  includeEmptyDays?: boolean;
};

/** Weekly rules for a doctor + consult type, in the shape the engine wants. */
function loadRules(db: Db, doctorId: string, consultType: ConsultType): SlotEngineRule[] {
  const rows = all<{
    weekday: number;
    start_local_time: string;
    end_local_time: string;
    slot_minutes: number;
    buffer_minutes: number;
    consult_types: string;
    effective_from: string;
  }>(
    db,
    `SELECT weekday, start_local_time, end_local_time, slot_minutes, buffer_minutes, consult_types, effective_from
       FROM availability_rules
      WHERE doctor_id = ?`,
    doctorId,
  );

  return rows
    .map((row) => ({
      weekday: row.weekday,
      startLocalTime: row.start_local_time,
      endLocalTime: row.end_local_time,
      slotMinutes: row.slot_minutes,
      bufferMinutes: row.buffer_minutes,
      consultTypes: json<ConsultType[]>(row.consult_types, []),
      effectiveFrom: row.effective_from,
    }))
    .filter((rule) => rule.consultTypes.includes(consultType));
}

/** Leaves and blocks. */
function loadExceptions(db: Db, doctorId: string): Array<{ startUtc: string; endUtc: string }> {
  const rows = all<{ start_utc: string; end_utc: string }>(
    db,
    `SELECT start_utc, end_utc FROM availability_exceptions WHERE doctor_id = ?`,
    doctorId,
  );
  return rows.map((row) => ({ startUtc: row.start_utc, endUtc: row.end_utc }));
}

/** Active appointments (held → in_progress) plus live checkout holds. */
function loadBusy(
  db: Db,
  doctorId: string,
  nowMs: number,
  options: Pick<ComposeAvailabilityOptions, 'excludeAppointmentId' | 'ownHoldUserId'>,
): SlotBusyInterval[] {
  const nowIso = new Date(nowMs).toISOString().replace(/\.\d{3}Z$/, 'Z');

  const appointments = all<{ id: string; start_utc: string; end_utc: string }>(
    db,
    `SELECT id, start_utc, end_utc FROM appointments
      WHERE doctor_id = ? AND status IN ${ACTIVE_STATUSES_SQL}`,
    doctorId,
  );

  const busy: SlotBusyInterval[] = appointments
    .filter((row) => row.id !== options.excludeAppointmentId)
    .map((row) => ({ startUtc: row.start_utc, endUtc: row.end_utc, source: 'appointment' }));

  const holds = all<{ start_utc: string; end_utc: string; patient_user_id: string }>(
    db,
    `SELECT start_utc, end_utc, patient_user_id FROM holds
      WHERE doctor_id = ? AND status = 'active' AND expires_at > ?`,
    doctorId,
    nowIso,
  );
  for (const hold of holds) {
    // A patient's own hold is theirs to convert; it must not hide the slot from
    // them, but it does hide it from everybody else.
    if (options.ownHoldUserId && hold.patient_user_id === options.ownHoldUserId) continue;
    busy.push({ startUtc: hold.start_utc, endUtc: hold.end_utc, source: 'hold' });
  }

  // Imported external busy time, unioned across every connected account.
  const events = all<{ start_utc: string; end_utc: string }>(
    db,
    `SELECT e.start_utc, e.end_utc
       FROM calendar_events e
       JOIN calendar_accounts a ON a.id = e.calendar_account_id
      WHERE a.doctor_id = ? AND a.status IN ('connected','syncing') AND e.is_busy = 1`,
    doctorId,
  );
  for (const event of events) {
    busy.push({ startUtc: event.start_utc, endUtc: event.end_utc, source: 'calendar' });
  }

  return busy;
}

/** Duration + fee for a consult type. */
export function loadConsultFee(
  db: Db,
  doctorId: string,
  consultType: ConsultType,
): { durationMinutes: number; feeMinor: number; currency: string; enabled: boolean } | undefined {
  const row = one<{ duration_minutes: number; fee_minor: number; currency: string; enabled: number }>(
    db,
    `SELECT duration_minutes, fee_minor, currency, enabled FROM consult_fees WHERE doctor_id = ? AND consult_type = ?`,
    doctorId,
    consultType,
  );
  if (!row) return undefined;
  return {
    durationMinutes: row.duration_minutes,
    feeMinor: row.fee_minor,
    currency: row.currency,
    enabled: row.enabled === 1,
  };
}

/**
 * Expand availability for a doctor & consult type over a clinic-local date range.
 * This is the single entry point used by every availability-shaped response.
 */
export function composeAvailability(options: ComposeAvailabilityOptions): SlotEngineResult {
  const { db, doctor, consultType, policy, fromDate, toDate, nowMs } = options;

  const fee = loadConsultFee(db, doctor.id, consultType);
  const durationMinutes = fee?.durationMinutes ?? (consultType === 'video' ? 15 : 20);

  const busy = loadBusy(db, doctor.id, nowMs, options);
  if (options.calendarBusy) busy.push(...options.calendarBusy);

  return expandSlots({
    timeZone: doctor.clinic_timezone,
    rules: loadRules(db, doctor.id, consultType),
    exceptions: loadExceptions(db, doctor.id),
    busy,
    fromDate,
    toDate,
    consultType,
    durationMinutes,
    feeMinor: fee?.feeMinor ?? 0,
    currency: fee?.currency ?? doctor.currency,
    nowMs,
    minNoticeMinutes: policy.min_notice_minutes,
    bookingWindowDays: policy.booking_window_days,
    bufferMinutes: policy.buffer_minutes,
    mineStartUtcs: options.mineStartUtcs ?? [],
    includeEmptyDays: options.includeEmptyDays ?? false,
  });
}

/** TRD §7.3.3 availability payload. */
export function toAvailabilityResponse(input: {
  doctor: DoctorRow;
  consultType: ConsultType;
  result: SlotEngineResult;
  requestedTimezone: string;
  nowMs: number;
  calendarSync: { connected: boolean; last_synced_at: string | null; staleness: string | null };
}): AvailabilityResponse {
  const days: AvailabilityDay[] = input.result.days.map((day) => ({ date: day.date, slots: day.slots }));
  return {
    doctor_id: input.doctor.id,
    consult_type: input.consultType,
    doctor_timezone: input.doctor.clinic_timezone,
    generated_at: new Date(input.nowMs).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    requested_timezone: input.requestedTimezone,
    calendar_sync: input.calendarSync,
    days,
  };
}

/** Calendar freshness metadata (PRD X3 / CAL-002). */
export function loadCalendarSync(
  db: Db,
  doctorId: string,
  nowMs: number,
  isoDuration: (iso: string, nowMs?: number) => string,
): { connected: boolean; last_synced_at: string | null; staleness: string | null } {
  const row = one<{ status: string; last_synced_at: string | null }>(
    db,
    `SELECT status, last_synced_at FROM calendar_accounts WHERE doctor_id = ? ORDER BY connected_at LIMIT 1`,
    doctorId,
  );
  const connected = row ? ['connected', 'syncing'].includes(row.status) : false;
  const lastSyncedAt = row?.last_synced_at ?? null;
  return {
    connected,
    last_synced_at: lastSyncedAt,
    staleness: lastSyncedAt ? isoDuration(lastSyncedAt, nowMs) : null,
  };
}
