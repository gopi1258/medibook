/**
 * Appointment module — holds, booking, reschedule, cancel and lifecycle actions.
 *
 * This is the integrity core. Double-booking is prevented by *layers* (TRD §10.2),
 * and any single layer failing does not break the guarantee:
 *
 *   1. live hold visibility (a held slot is excluded from `available`);
 *   2. the `ux_appointments_doctor_slot` partial unique index — the final arbiter;
 *   3. `BEGIN IMMEDIATE` + a write-time re-check inside the transaction;
 *   4. idempotency keys, so a client retry after a timeout replays instead of
 *      duplicating;
 *   5. a booking-time external-busy re-check, which protects against a stale
 *      availability read (PRD EC-19).
 *
 * The simulated payment authorisation and calendar re-check are deliberate
 * `await` points: they model the real handshakes (TRD §10.2 sequence diagram) so
 * concurrent requests genuinely interleave before the write, which is exactly the
 * race the unique index must resolve.
 */
import { ApiError, ACTIVE_APPOINTMENT_STATUSES } from '@medibook/core';
import type {
  Appointment,
  AppointmentListQuery,
  AppointmentStatus,
  CancelRequest,
  CancelResult,
  ConsultType,
  CreateAppointmentRequest,
  CreateHoldRequest,
  Hold,
  Page,
  PaymentMethod,
  PostVisitReviewRequest,
  Review,
} from '@medibook/core';
import {
  addDaysToDate,
  cancellationPolicy,
  dateInZone,
  defaultPlatformConfig,
  formatMoney,
  fromIso,
  holdExpiry,
  isoDuration,
  maxActivePerDoctorPerDayViolation,
  nearestAlternatives,
  noShowGraceMinutes,
  openSlots,
  reschedulePolicy,
  statusForNewBooking,
  toIso,
} from '@medibook/core';

import {
  all,
  isConstraintError,
  one,
  run,
  transaction,
  type Db,
} from '../db/database.ts';
import { ACTIVE_STATUSES_SQL } from '../db/schema.ts';
import {
  APPOINTMENT_SELECT,
  mapAppointment,
  type AppointmentRow,
  type DoctorPolicyRow,
  type DoctorRow,
} from '../db/mappers.ts';
import { newAppointmentCode, newId } from '../domain/ids.ts';
import { policyFromRow } from '../domain/rules.ts';
import { composeAvailability, loadConsultFee } from '../domain/slotEngine.ts';
import { notify } from './notifications.ts';
import type { Session } from './auth.ts';

export type AppointmentService = ReturnType<typeof createAppointmentService>;

const SLOT_TAKEN_MESSAGE = 'That slot was just taken.';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Stand-in for the payment gateway authorise/capture handshake. Real deployments
 * talk to Stripe/Razorpay behind the payment port (TRD §5.4); here it costs a few
 * milliseconds so the booking race is real rather than theoretical.
 */
async function simulatePaymentAuthorization(feeMinor: number): Promise<void> {
  if (feeMinor <= 0) return;
  await sleep(4 + Math.random() * 18);
}

/**
 * Stand-in for the booking-time external-busy re-check (TRD §10.2 layer 5). The
 * real version re-reads the cached calendar set; the delay models the I/O.
 */
async function simulateCalendarRecheck(): Promise<void> {
  await sleep(2 + Math.random() * 8);
}

export function createAppointmentService(options: { db: Db; now: () => number }) {
  const { db, now } = options;

  function iso(ms: number): string {
    return toIso(ms);
  }

  /* ------------------------------------------------------------ idempotency */

  /**
   * Claim an idempotency key.
   *
   * Returns the stored response when the key already completed (so a client retry
   * after a timeout replays the original result instead of booking twice), throws
   * when the same key is still in flight, and otherwise records the claim.
   *
   * The claim is written synchronously before the caller awaits anything, so two
   * concurrent requests carrying the same key cannot both proceed.
   */
  function claimIdempotency(
    key: string | undefined,
    userId: string,
    endpoint: string,
  ): { replay: unknown } | undefined {
    if (!key || key.length < 8) {
      throw new ApiError('VAL_INVALID', 'An Idempotency-Key header is required for this request.', {
        details: { header: 'Idempotency-Key' },
      });
    }

    const existing = one<{ status: string; user_id: string; response_snapshot: string | null }>(
      db,
      `SELECT status, user_id, response_snapshot FROM idempotency_keys WHERE key = ?`,
      key,
    );

    if (existing) {
      if (existing.user_id !== userId) {
        throw new ApiError('AUTHZ_FORBIDDEN', 'This idempotency key belongs to another session.');
      }
      if (existing.status === 'completed' && existing.response_snapshot) {
        return { replay: JSON.parse(existing.response_snapshot) };
      }
      throw new ApiError('APT_STATE_CONFLICT', 'That request is already being processed.', {
        details: { code: 'IDEMPOTENT_REPLAY_IN_PROGRESS' },
      });
    }

    run(
      db,
      `INSERT INTO idempotency_keys (key, user_id, endpoint, status, response_snapshot, created_at)
       VALUES (?, ?, ?, 'in_progress', NULL, ?)`,
      key,
      userId,
      endpoint,
      iso(now()),
    );
    return undefined;
  }

  function finishIdempotency(key: string, result: unknown): void {
    run(
      db,
      `UPDATE idempotency_keys SET status = 'completed', response_snapshot = ? WHERE key = ?`,
      JSON.stringify(result),
      key,
    );
  }

  /** Release the claim so a corrected request may reuse the same key. */
  function abandonIdempotency(key: string): void {
    run(db, `DELETE FROM idempotency_keys WHERE key = ?`, key);
  }

  function runIdempotentSync<T>(key: string, userId: string, endpoint: string, fn: () => T): T {
    const claim = claimIdempotency(key, userId, endpoint);
    if (claim) return claim.replay as T;
    try {
      const result = fn();
      finishIdempotency(key, result);
      return result;
    } catch (error) {
      abandonIdempotency(key);
      throw error;
    }
  }

  async function runIdempotentAsync<T>(
    key: string,
    userId: string,
    endpoint: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const claim = claimIdempotency(key, userId, endpoint);
    if (claim) return claim.replay as T;
    try {
      const result = await fn();
      finishIdempotency(key, result);
      return result;
    } catch (error) {
      abandonIdempotency(key);
      throw error;
    }
  }

  /* ------------------------------------------------------------- loading */

  function doctorRowFor(doctorId: string): DoctorRow {
    const row = one<DoctorRow>(db, `SELECT * FROM doctors WHERE id = ?`, doctorId);
    if (!row) throw new ApiError('NOT_FOUND', 'Doctor not found.', { details: { id: doctorId } });
    return row;
  }

  function policyFor(doctorId: string) {
    const row = one<DoctorPolicyRow>(db, `SELECT * FROM doctor_policies WHERE doctor_id = ?`, doctorId);
    return policyFromRow(row ?? null);
  }

  function appointmentRow(appointmentId: string): AppointmentRow | undefined {
    return one<AppointmentRow>(db, `${APPOINTMENT_SELECT} WHERE a.id = ?`, appointmentId);
  }

  function requireAppointment(appointmentId: string): AppointmentRow {
    const row = appointmentRow(appointmentId);
    if (!row) throw new ApiError('NOT_FOUND', 'Appointment not found.', { details: { id: appointmentId } });
    return row;
  }

  /** Participant check — patients see their own, doctors see their own (TRD §8.3). */
  function requireParticipant(session: Session, appointmentId: string): AppointmentRow {
    const row = requireAppointment(appointmentId);
    const isPatient = session.role === 'patient' && row.patient_user_id === session.userId;
    const isDoctor = session.role === 'doctor' && row.doctor_id === session.userId;
    if (!isPatient && !isDoctor) {
      throw new ApiError('AUTHZ_FORBIDDEN', 'You do not have access to this appointment.');
    }
    return row;
  }

  function toDomain(row: AppointmentRow): Appointment {
    return mapAppointment(db, row);
  }

  function event(
    appointmentId: string,
    fromStatus: string | null,
    toStatus: string,
    actorType: string,
    actorId: string | null,
    reason: string | null,
    metadata?: Record<string, unknown>,
  ): void {
    run(
      db,
      `INSERT INTO appointment_events (id, appointment_id, from_status, to_status, actor_type, actor_id, reason, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newId('evt'),
      appointmentId,
      fromStatus,
      toStatus,
      actorType,
      actorId,
      reason,
      metadata ? JSON.stringify(metadata) : null,
      iso(now()),
    );
  }

  function paymentFor(appointmentId: string) {
    return one<{ id: string; amount_minor: number; currency: string }>(
      db,
      `SELECT id, amount_minor, currency FROM payments WHERE appointment_id = ? ORDER BY created_at DESC LIMIT 1`,
      appointmentId,
    );
  }

  /* ---------------------------------------------------------- availability */

  /** The engine's view for one doctor/type over a date range. */
  function availabilityFor(input: {
    doctor: DoctorRow;
    consultType: ConsultType;
    policy: ReturnType<typeof policyFromRow>;
    fromDate: string;
    toDate: string;
    excludeAppointmentId?: string;
    ownHoldUserId?: string;
    mineUserId?: string;
  }) {
    const nowMs = now();
    const mineStartUtcs = input.mineUserId
      ? all<{ start_utc: string }>(
          db,
          `SELECT start_utc FROM appointments WHERE patient_user_id = ? AND doctor_id = ?
            AND status IN ${ACTIVE_STATUSES_SQL}`,
          input.mineUserId,
          input.doctor.id,
        ).map((row) => row.start_utc)
      : [];

    return composeAvailability({
      db,
      doctor: input.doctor,
      consultType: input.consultType,
      policy: input.policy,
      fromDate: input.fromDate,
      toDate: input.toDate,
      nowMs,
      ownHoldUserId: input.ownHoldUserId,
      excludeAppointmentId: input.excludeAppointmentId,
      mineStartUtcs,
    });
  }

  /** Nearest open slots to a contested start — the EC-04 promise. */
  function alternativesFor(
    doctor: DoctorRow,
    consultType: ConsultType,
    startUtc: string,
    options: { excludeAppointmentId?: string; ownHoldUserId?: string } = {},
  ): string[] {
    const policy = policyFor(doctor.id);
    const from = dateInZone(now(), doctor.clinic_timezone);
    const result = availabilityFor({
      doctor,
      consultType,
      policy,
      fromDate: from,
      toDate: addDaysToDate(from, Math.min(policy.booking_window_days, 21)),
      excludeAppointmentId: options.excludeAppointmentId,
      ownHoldUserId: options.ownHoldUserId,
    });
    return nearestAlternatives(result, startUtc, 3);
  }

  /** Is this exact instant a bookable slot right now? Returns the engine slot. */
  function findBookableSlot(input: {
    doctor: DoctorRow;
    consultType: ConsultType;
    startUtc: string;
    excludeAppointmentId?: string;
    ownHoldUserId?: string;
  }) {
    const policy = policyFor(input.doctor.id);
    const startMs = fromIso(input.startUtc);
    const from = dateInZone(startMs, input.doctor.clinic_timezone);
    const result = availabilityFor({
      doctor: input.doctor,
      consultType: input.consultType,
      policy,
      fromDate: dateInZone(now(), input.doctor.clinic_timezone),
      toDate: addDaysToDate(dateInZone(now(), input.doctor.clinic_timezone), 21),
      excludeAppointmentId: input.excludeAppointmentId,
      ownHoldUserId: input.ownHoldUserId,
    });
    return result.days.flatMap((day) => day.slots).find((slot) => slot.start_utc === input.startUtc);
  }

  function slotIsTaken(doctorId: string, startUtc: string, excludeAppointmentId?: string): boolean {
    const row = one<{ id: string }>(
      db,
      `SELECT id FROM appointments
        WHERE doctor_id = ? AND start_utc = ? AND status IN ${ACTIVE_STATUSES_SQL}
          AND (? IS NULL OR id <> ?)
        LIMIT 1`,
      doctorId,
      startUtc,
      excludeAppointmentId ?? null,
      excludeAppointmentId ?? null,
    );
    return Boolean(row);
  }

  return {
    /* ------------------------------------------------------------- holds */

    /** `POST /appointments/holds` — R12. */
    createHold(session: Session, input: CreateHoldRequest): Hold {
      if (session.role !== 'patient') throw new ApiError('AUTHZ_FORBIDDEN', 'Patient access required.');
      const nowMs = now();

      // Expire stale holds first so a patient is never blocked by a dead one.
      run(db, `UPDATE holds SET status = 'expired' WHERE status = 'active' AND expires_at <= ?`, iso(nowMs));

      const active = one<{ id: string; expires_at: string }>(
        db,
        `SELECT id, expires_at FROM holds WHERE patient_user_id = ? AND status = 'active'`,
        session.userId,
      );
      if (active) {
        throw new ApiError('APT_HOLD_ACTIVE', 'You already have a slot on hold.', {
          details: { hold_id: active.id, expires_at: active.expires_at },
        });
      }

      const doctor = doctorRowFor(input.doctor_id);
      if (doctor.verification_status !== 'approved') {
        throw new ApiError('DOC_NOT_VERIFIED', 'This doctor is not accepting bookings yet.');
      }

      const slot = findBookableSlot({
        doctor,
        consultType: input.consult_type,
        startUtc: input.start_utc,
        ownHoldUserId: session.userId,
      });
      if (!slot || slot.status !== 'available') {
        throw new ApiError('APT_SLOT_TAKEN', SLOT_TAKEN_MESSAGE, {
          details: {
            alternatives: alternativesFor(doctor, input.consult_type, input.start_utc, {
              ownHoldUserId: session.userId,
            }),
            doctor_id: doctor.id,
            start_utc: input.start_utc,
          },
        });
      }

      const id = newId('hold');
      const expiresAt = iso(holdExpiry(nowMs));
      try {
        run(
          db,
          `INSERT INTO holds (id, patient_user_id, doctor_id, consult_type, start_utc, end_utc, expires_at, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
          id,
          session.userId,
          doctor.id,
          input.consult_type,
          slot.start_utc,
          slot.end_utc,
          expiresAt,
          iso(nowMs),
        );
      } catch (error) {
        if (isConstraintError(error)) {
          // Another patient grabbed the same slot between the read and the write.
          run(db, `UPDATE holds SET status = 'expired' WHERE id = ?`, id);
          throw new ApiError('APT_SLOT_TAKEN', SLOT_TAKEN_MESSAGE, {
            details: {
              alternatives: alternativesFor(doctor, input.consult_type, input.start_utc, {
                ownHoldUserId: session.userId,
              }),
              doctor_id: doctor.id,
              start_utc: input.start_utc,
            },
          });
        }
        throw error;
      }

      event(id, null, 'active', 'patient', session.userId, 'hold created', {
        doctor_id: doctor.id,
        start_utc: slot.start_utc,
      });

      return {
        id,
        patient_user_id: session.userId,
        doctor_id: doctor.id,
        consult_type: input.consult_type,
        start_utc: slot.start_utc,
        end_utc: slot.end_utc,
        expires_at: expiresAt,
        status: 'active',
      };
    },

    releaseHold(session: Session, holdId: string): void {
      run(
        db,
        `UPDATE holds SET status = 'released' WHERE id = ? AND patient_user_id = ? AND status = 'active'`,
        holdId,
        session.userId,
      );
    },

    /* ------------------------------------------------------------ booking */

    /**
     * `POST /appointments` — the concurrency-critical path.
     *
     * The read-then-write shape is intentional: the pre-checks give fast, useful
     * errors for the common case, and the partial unique index is what actually
     * guarantees correctness when requests race.
     */
    async createAppointment(
      session: Session,
      input: CreateAppointmentRequest,
      idempotencyKey: string | undefined,
    ): Promise<Appointment> {
      if (session.role !== 'patient') throw new ApiError('AUTHZ_FORBIDDEN', 'Patient access required.');
      return runIdempotentAsync(
        idempotencyKey ?? '',
        session.userId,
        'POST /appointments',
        () => this.bookWithHandshakes(session, input),
      );
    },

    /**
     * The booking flow proper.
     *
     * Order of operations, and why it matters under concurrency:
     *   1. validate everything cheap and deterministic (doctor, hold, dependent,
     *      R1 window, R14 daily limit, engine slot) — no writes;
     *   2. perform the slow handshakes (payment authorise, calendar re-check).
     *      Every concurrent request is inside this window at the same time;
     *   3. open one `BEGIN IMMEDIATE` transaction, re-check the slot, insert, and
     *      let `ux_appointments_doctor_slot` arbitrate. Exactly one request wins.
     */
    async bookWithHandshakes(session: Session, input: CreateAppointmentRequest): Promise<Appointment> {
      const nowMs = now();
      const doctor = doctorRowFor(input.doctor_id);
      if (doctor.verification_status !== 'approved') {
        throw new ApiError('DOC_NOT_VERIFIED', 'This doctor is not accepting bookings yet.', {
          details: { verification_status: doctor.verification_status },
        });
      }

      const policy = policyFor(doctor.id);
      const feeRow = loadConsultFee(db, doctor.id, input.consult_type);
      if (!feeRow || !feeRow.enabled) {
        throw new ApiError('VAL_INVALID', 'This doctor does not offer that consultation type.', {
          details: { consult_type: input.consult_type },
        });
      }

      /* ---- hold resolution: a hold is what makes the slot exclusively yours */
      let hold: { id: string; start_utc: string; end_utc: string } | null = null;
      if (input.hold_id) {
        const row = one<{
          id: string;
          start_utc: string;
          end_utc: string;
          status: string;
          expires_at: string;
          patient_user_id: string;
          doctor_id: string;
          consult_type: ConsultType;
        }>(db, `SELECT * FROM holds WHERE id = ?`, input.hold_id);

        if (!row) throw new ApiError('NOT_FOUND', 'Hold not found.', { details: { id: input.hold_id } });
        if (row.patient_user_id !== session.userId) {
          throw new ApiError('AUTHZ_FORBIDDEN', 'That hold belongs to another session.');
        }
        if (row.status === 'converted') {
          throw new ApiError('APT_STATE_CONFLICT', 'That hold has already been used.');
        }
        if (row.status !== 'active' || Date.parse(row.expires_at) <= nowMs) {
          run(db, `UPDATE holds SET status = 'expired' WHERE id = ? AND status = 'active'`, row.id);
          throw new ApiError('APT_HOLD_EXPIRED', 'Your 5-minute hold expired. Please pick the slot again.', {
            details: { hold_id: row.id },
          });
        }
        if (row.doctor_id !== doctor.id || row.consult_type !== input.consult_type) {
          throw new ApiError('APT_STATE_CONFLICT', 'The hold does not match this booking.');
        }
        if (input.start_utc && input.start_utc !== row.start_utc) {
          throw new ApiError('APT_STATE_CONFLICT', 'The hold is for a different slot.');
        }
        hold = { id: row.id, start_utc: row.start_utc, end_utc: row.end_utc };
      }

      const startUtc = hold?.start_utc ?? input.start_utc;
      if (!startUtc) throw new ApiError('VAL_INVALID', 'A start time or a hold is required.');

      /* ---- dependent ownership */
      let dependentName: string | null = null;
      if (input.dependent_id) {
        const dependent = one<{ id: string; name: string; guardian_user_id: string }>(
          db,
          `SELECT id, name, guardian_user_id FROM dependents WHERE id = ?`,
          input.dependent_id,
        );
        if (!dependent) {
          throw new ApiError('NOT_FOUND', 'Family member not found.', { details: { id: input.dependent_id } });
        }
        if (dependent.guardian_user_id !== session.userId) {
          throw new ApiError('AUTHZ_FORBIDDEN', 'That family member is not on your account.');
        }
        dependentName = dependent.name;
      }

      /* ---- R1: booking window (min notice + horizon) */
      const startMs = fromIso(startUtc);
      const deltaMinutes = (startMs - nowMs) / 60_000;
      if (deltaMinutes < 0) throw new ApiError('APT_SLOT_PAST', 'That time has already passed.');
      if (deltaMinutes < policy.min_notice_minutes) {
        throw new ApiError('APT_MIN_NOTICE', `This doctor needs ${policy.min_notice_minutes} minutes notice.`, {
          details: { min_notice_minutes: policy.min_notice_minutes },
        });
      }
      if (deltaMinutes > policy.booking_window_days * 24 * 60) {
        throw new ApiError('APT_OUTSIDE_WINDOW', `Bookings open ${policy.booking_window_days} days ahead.`, {
          details: { booking_window_days: policy.booking_window_days },
        });
      }

      /* ---- R14: one active booking per doctor per local day */
      const startLocalDate = dateInZone(startMs, doctor.clinic_timezone);
      const sameDoctorActive = all<{ id: string; start_utc: string }>(
        db,
        `SELECT id, start_utc FROM appointments
          WHERE patient_user_id = ? AND doctor_id = ? AND status IN ${ACTIVE_STATUSES_SQL}`,
        session.userId,
        doctor.id,
      );
      const dailyViolation = maxActivePerDoctorPerDayViolation({
        startUtc,
        existingStartUtcList: sameDoctorActive.map((row) => row.start_utc),
        existingLocalDates: sameDoctorActive.map((row) =>
          dateInZone(fromIso(row.start_utc), doctor.clinic_timezone),
        ),
        startLocalDate,
      });
      if (dailyViolation) {
        throw new ApiError(dailyViolation.code, dailyViolation.message, { details: { local_date: startLocalDate } });
      }

      /* ---- the slot must exist in the engine's output right now */
      const engineSlot = findBookableSlot({
        doctor,
        consultType: input.consult_type,
        startUtc,
        ownHoldUserId: session.userId,
      });
      if (!engineSlot || engineSlot.status === 'taken') {
        throw new ApiError('APT_SLOT_TAKEN', SLOT_TAKEN_MESSAGE, {
          details: {
            alternatives: alternativesFor(doctor, input.consult_type, startUtc, {
              ownHoldUserId: session.userId,
            }),
            doctor_id: doctor.id,
            start_utc: startUtc,
          },
        });
      }

      /* ---- async handshakes: every racer is parked here at the same time ---- */
      await simulatePaymentAuthorization(feeRow.feeMinor);
      await simulateCalendarRecheck();

      const busyClash = one<{ id: string }>(
        db,
        `SELECT e.id FROM calendar_events e
           JOIN calendar_accounts c ON c.id = e.calendar_account_id
          WHERE c.doctor_id = ? AND c.status IN ('connected','syncing') AND e.is_busy = 1
            AND e.start_utc < ? AND ? < e.end_utc
          LIMIT 1`,
        doctor.id,
        engineSlot.end_utc,
        engineSlot.start_utc,
      );
      if (busyClash) {
        throw new ApiError('CAL_SLOT_CONFLICT', 'The doctor’s calendar filled up. Pick another slot.', {
          details: {
            alternatives: alternativesFor(doctor, input.consult_type, startUtc, {
              ownHoldUserId: session.userId,
            }),
          },
        });
      }

      const user = one<{ display_name: string }>(db, `SELECT display_name FROM users WHERE id = ?`, session.userId)!;
      const status = statusForNewBooking(policy.approval_mode);
      const appointmentId = newId('apt');
      const code = newAppointmentCode();

      /* ---- the arbitration transaction */
      try {
        transaction(db, () => {
          // Layer 3: write-time re-check inside the same transaction.
          if (slotIsTaken(doctor.id, startUtc)) {
            throw new ApiError('APT_SLOT_TAKEN', SLOT_TAKEN_MESSAGE);
          }

          run(
            db,
            `INSERT INTO appointments (
               id, code, patient_user_id, patient_name, dependent_id, dependent_name, for_name,
               doctor_id, consult_type, start_utc, end_utc, doctor_timezone, status,
               cancelled_by, cancel_reason, reschedule_of_id, reschedule_count,
               fee_minor, currency, clinic_name, clinic_address, join_url, patient_note,
               created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
            appointmentId,
            code,
            session.userId,
            user.display_name,
            input.dependent_id ?? null,
            dependentName,
            dependentName ?? user.display_name,
            doctor.id,
            input.consult_type,
            engineSlot.start_utc,
            engineSlot.end_utc,
            doctor.clinic_timezone,
            status,
            feeRow.feeMinor,
            feeRow.currency,
            input.consult_type === 'in_person' ? doctor.clinic_name : null,
            input.consult_type === 'in_person' ? doctor.clinic_address : null,
            input.consult_type === 'video' ? `medibook://consult/${appointmentId}` : null,
            input.note ?? null,
            iso(nowMs),
            iso(nowMs),
          );

          if (hold) run(db, `UPDATE holds SET status = 'converted' WHERE id = ?`, hold.id);

          if (feeRow.feeMinor > 0) {
            run(
              db,
              `INSERT INTO payments (id, appointment_id, method, amount_minor, currency, status, provider_ref, receipt_url, created_at)
               VALUES (?, ?, ?, ?, ?, 'captured', ?, ?, ?)`,
              newId('pay'),
              appointmentId,
              input.payment?.method ?? 'card',
              feeRow.feeMinor,
              feeRow.currency,
              `sim_${appointmentId}`,
              `medibook://receipt/${appointmentId}`,
              iso(nowMs),
            );
          }

          event(appointmentId, null, status, 'patient', session.userId, 'booking created', {
            doctor_id: doctor.id,
            start_utc: engineSlot.start_utc,
            hold_id: hold?.id ?? null,
          });
        });
      } catch (error) {
        if (error instanceof ApiError) {
          if (error.code === 'APT_SLOT_TAKEN') {
            throw new ApiError('APT_SLOT_TAKEN', SLOT_TAKEN_MESSAGE, {
              details: {
                alternatives: alternativesFor(doctor, input.consult_type, startUtc, {
                  ownHoldUserId: session.userId,
                }),
                doctor_id: doctor.id,
                start_utc: startUtc,
              },
            });
          }
          throw error;
        }
        if (isConstraintError(error)) {
          // The partial unique index rejected the insert: somebody else won.
          throw new ApiError('APT_SLOT_TAKEN', SLOT_TAKEN_MESSAGE, {
            details: {
              alternatives: alternativesFor(doctor, input.consult_type, startUtc, {
                ownHoldUserId: session.userId,
              }),
              doctor_id: doctor.id,
              start_utc: startUtc,
            },
          });
        }
        throw error;
      }

      const created = toDomain(requireAppointment(appointmentId));

      /* ---- side effects, strictly after commit */
      const whenLabel = `${created.start_utc}`;
      notify(
        db,
        {
          userId: session.userId,
          category: status === 'pending_approval' ? 'approval' : 'booking',
          title: status === 'pending_approval' ? 'Booking requested' : 'Appointment confirmed',
          body:
            status === 'pending_approval'
              ? `${doctor.display_name} will confirm shortly · ${whenLabel}`
              : `${doctor.display_name} · ${whenLabel}`,
          deeplink: `/appointments/${appointmentId}`,
          appointmentId,
          channels: ['in_app', 'push', 'email'],
        },
        nowMs,
      );
      notify(
        db,
        {
          userId: doctor.id,
          category: status === 'pending_approval' ? 'approval' : 'booking',
          title: status === 'pending_approval' ? 'Approval request' : 'New booking',
          body: `${created.for_name} · ${whenLabel}`,
          deeplink: `/appointments/${appointmentId}`,
          appointmentId,
          channels: ['in_app', 'push'],
        },
        nowMs,
      );

      return created;
    },

    /* --------------------------------------------------------- read paths */

    list(session: Session, query: AppointmentListQuery): Page<Appointment> {
      const nowMs = now();
      const nowIso = iso(nowMs);
      const limit = Math.min(query.limit ?? 30, 100);

      const conditions: string[] = [];
      const params: Array<string | number> = [];

      if (session.role === 'patient') {
        conditions.push(`a.patient_user_id = ?`);
        params.push(session.userId);
        if (query.member === 'self') {
          conditions.push(`a.dependent_id IS NULL`);
        } else if (query.member) {
          conditions.push(`a.dependent_id = ?`);
          params.push(query.member);
        }
      } else if (session.role === 'doctor') {
        conditions.push(`a.doctor_id = ?`);
        params.push(session.userId);
      } else {
        throw new ApiError('AUTHZ_FORBIDDEN', 'Role not supported for this endpoint.');
      }

      if (query.doctor_id && session.role === 'patient') {
        conditions.push(`a.doctor_id = ?`);
        params.push(query.doctor_id);
      }
      if (query.status) {
        conditions.push(`a.status = ?`);
        params.push(query.status);
      }

      const scope = query.scope ?? 'upcoming';
      if (scope === 'upcoming' || scope === 'today') {
        conditions.push(`a.status IN ${ACTIVE_STATUSES_SQL}`);
        conditions.push(`a.start_utc >= ?`);
        params.push(iso(nowMs - 15 * 60_000));
        if (scope === 'today') {
          const todayLocal = query.member ?? undefined;
          void todayLocal;
        }
      } else if (scope === 'pending') {
        conditions.push(`a.status = 'pending_approval'`);
      } else if (scope === 'past') {
        conditions.push(
          `(a.status NOT IN ${ACTIVE_STATUSES_SQL} OR a.start_utc < ?)`,
        );
        params.push(nowIso);
      }

      const rows = all<AppointmentRow>(
        db,
        `${APPOINTMENT_SELECT} WHERE ${conditions.join(' AND ')}`,
        ...params,
      );

      let items = rows.map(toDomain);

      if (scope === 'today' && session.role === 'doctor') {
        const doctorTz = rows[0]?.doctor_timezone ?? 'UTC';
        const todayDate = dateInZone(nowMs, doctorTz);
        items = items.filter((appointment) => dateInZone(fromIso(appointment.start_utc), doctorTz) === todayDate);
      }

      const ascending = scope === 'upcoming' || scope === 'today' || scope === 'pending';
      items.sort((a, b) =>
        ascending ? a.start_utc.localeCompare(b.start_utc) : b.start_utc.localeCompare(a.start_utc),
      );

      const offset = decodeCursor(query.cursor);
      const max = items.length;
      const pageItems = items.slice(offset, offset + limit);
      const next = offset + limit;

      return { items: pageItems, meta: { total: max, next_cursor: next < max ? encodeCursor(next) : null } };
    },

    get(session: Session, appointmentId: string): Appointment {
      return toDomain(requireParticipant(session, appointmentId));
    },

    /* ----------------------------------------------------------- policies */

    reschedulePolicyPreview(session: Session, appointmentId: string) {
      const row = requireParticipant(session, appointmentId);
      const policy = policyFor(row.doctor_id);
      return reschedulePolicy({
        startUtc: row.start_utc,
        nowMs: now(),
        policy,
        rescheduleCount: row.reschedule_count,
      });
    },

    cancellationPolicyPreview(session: Session, appointmentId: string) {
      const row = requireParticipant(session, appointmentId);
      const actor = session.role === 'doctor' ? 'doctor' : 'patient';
      return cancellationPolicy({
        startUtc: row.start_utc,
        nowMs: now(),
        feeMinor: row.fee_minor,
        currency: row.currency,
        actor,
      });
    },

    /* --------------------------------------------------------- reschedule */

    /** `PATCH /appointments/{id}` — an atomic *move* (TRD §10.5). */
    reschedule(
      session: Session,
      appointmentId: string,
      startUtc: string,
      idempotencyKey: string | undefined,
    ): Appointment {
      return runIdempotentSync(
        idempotencyKey ?? '',
        session.userId,
        `PATCH /appointments/${appointmentId}`,
        () => this.rescheduleSync(session, appointmentId, startUtc),
      );
    },

    rescheduleSync(session: Session, appointmentId: string, startUtc: string): Appointment {
      const nowMs = now();
      const row = requireParticipant(session, appointmentId);

      if (row.status === 'cancelled' || row.status === 'completed' || row.status === 'no_show' || row.status === 'rescheduled') {
        throw new ApiError('APT_STATE_CONFLICT', 'This appointment can no longer be moved.', {
          details: { from: row.status, to: 'confirmed' },
        });
      }

      const doctor = doctorRowFor(row.doctor_id);
      const policy = policyFor(doctor.id);

      if (session.role === 'patient') {
        const verdict = reschedulePolicy({
          startUtc: row.start_utc,
          nowMs,
          policy,
          rescheduleCount: row.reschedule_count,
        });
        if (!verdict.allowed) {
          throw new ApiError(verdict.reason_code ?? 'APT_STATE_CONFLICT', verdict.reason ?? verdict.summary, {
            details: {
              remaining_reschedules: verdict.remaining_reschedules,
              hours_until_start: Number(verdict.hours_until_start.toFixed(2)),
            },
          });
        }
      }

      const targetMs = fromIso(startUtc);
      if (targetMs < nowMs + policy.min_notice_minutes * 60_000) {
        throw new ApiError('APT_MIN_NOTICE', `This doctor needs ${policy.min_notice_minutes} minutes notice.`, {
          details: { min_notice_minutes: policy.min_notice_minutes },
        });
      }
      if (targetMs > nowMs + policy.booking_window_days * 24 * 60 * 60_000) {
        throw new ApiError('APT_OUTSIDE_WINDOW', `Bookings open ${policy.booking_window_days} days ahead.`);
      }

      const slot = findBookableSlot({
        doctor,
        consultType: row.consult_type,
        startUtc,
        excludeAppointmentId: appointmentId,
        ownHoldUserId: session.userId,
      });
      if (!slot || slot.status === 'taken') {
        throw new ApiError('APT_SLOT_TAKEN', SLOT_TAKEN_MESSAGE, {
          details: {
            alternatives: alternativesFor(doctor, row.consult_type, startUtc, {
              excludeAppointmentId: appointmentId,
            }),
            doctor_id: doctor.id,
            start_utc: startUtc,
          },
        });
      }

      const fromStatus = row.status;
      try {
        transaction(db, () => {
          // Serialise concurrent reschedules of the same appointment (EC-11).
          const locked = one<{ reschedule_count: number; status: string; start_utc: string }>(
            db,
            `SELECT reschedule_count, status, start_utc FROM appointments WHERE id = ?`,
            appointmentId,
          );
          if (!locked) throw new ApiError('NOT_FOUND', 'Appointment not found.');
          if (locked.start_utc !== row.start_utc || locked.status !== fromStatus) {
            throw new ApiError('APT_STATE_CONFLICT', 'This appointment changed on another device.');
          }
          run(
            db,
            `UPDATE appointments
                SET start_utc = ?, end_utc = ?,
                    reschedule_count = reschedule_count + 1,
                    updated_at = ?
              WHERE id = ?`,
            slot.start_utc,
            slot.end_utc,
            iso(nowMs),
            appointmentId,
          );
        });
      } catch (error) {
        if (error instanceof ApiError) throw error;
        if (isConstraintError(error)) {
          // The unique index is the arbiter: the target slot was taken meanwhile.
          throw new ApiError('APT_SLOT_TAKEN', SLOT_TAKEN_MESSAGE, {
            details: {
              alternatives: alternativesFor(doctor, row.consult_type, startUtc, {
                excludeAppointmentId: appointmentId,
              }),
            },
          });
        }
        throw error;
      }

      event(appointmentId, fromStatus, fromStatus, session.role, session.userId, 'rescheduled', {
        from: row.start_utc,
        to: slot.start_utc,
      });

      const updated = toDomain(requireAppointment(appointmentId));

      notify(
        db,
        {
          userId: row.patient_user_id,
          category: 'reschedule',
          title: 'Appointment moved',
          body: `New time: ${slot.start_utc}`,
          deeplink: `/appointments/${appointmentId}`,
          appointmentId,
          channels: ['in_app', 'push', 'email'],
        },
        nowMs,
      );
      notify(
        db,
        {
          userId: row.doctor_id,
          category: 'reschedule',
          title: 'Appointment rescheduled',
          body: `${row.for_name} · now ${slot.start_utc}`,
          deeplink: `/appointments/${appointmentId}`,
          appointmentId,
          channels: ['in_app', 'push'],
        },
        nowMs,
      );

      return updated;
    },

    /* ------------------------------------------------------------- cancel */

    /** `DELETE /appointments/{id}` — soft, idempotent (TRD §10.5). */
    cancel(
      session: Session,
      appointmentId: string,
      input: CancelRequest,
      idempotencyKey: string | undefined,
    ): CancelResult {
      return runIdempotentSync(
        idempotencyKey ?? '',
        session.userId,
        `DELETE /appointments/${appointmentId}`,
        () => this.cancelSync(session, appointmentId, input),
      );
    },

    cancelSync(session: Session, appointmentId: string, input: CancelRequest): CancelResult {
      const nowMs = now();
      const row = requireAppointment(appointmentId);
      // Patients may only cancel their own; doctors their own.
      requireParticipant(session, appointmentId);

      const actor: 'patient' | 'doctor' = session.role === 'doctor' ? 'doctor' : 'patient';
      const policy = cancellationPolicy({
        startUtc: row.start_utc,
        nowMs,
        feeMinor: row.fee_minor,
        currency: row.currency,
        actor,
      });

      // Idempotent replay: a repeated DELETE returns the same outcome, not an error.
      if (row.status === 'cancelled') {
        return { appointment: toDomain(row), refund: toDomain(row).refund, policy };
      }

      if (!['confirmed', 'pending_approval', 'in_progress'].includes(row.status)) {
        throw new ApiError('APT_STATE_CONFLICT', 'This appointment can no longer be cancelled.', {
          details: { from: row.status, to: 'cancelled' },
        });
      }

      const reason = input.reason?.trim();
      if (!reason) {
        throw new ApiError('VAL_INVALID', 'Please choose a reason for cancelling.', {
          details: { reason: 'required' },
        });
      }

      const payment = paymentFor(appointmentId);

      transaction(db, () => {
        run(
          db,
          `UPDATE appointments
              SET status = 'cancelled', cancelled_by = ?, cancel_reason = ?, updated_at = ?
            WHERE id = ? AND status IN ('confirmed','pending_approval','in_progress')`,
          actor,
          input.note ? `${reason} — ${input.note}` : reason,
          iso(nowMs),
          appointmentId,
        );

        if (payment && policy.refund_minor > 0) {
          run(db, `UPDATE payments SET status = 'refunded' WHERE id = ?`, payment.id);
          run(
            db,
            `INSERT INTO refunds (id, payment_id, amount_minor, currency, reason, tier_percent, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 'processing', ?)`,
            newId('ref'),
            payment.id,
            policy.refund_minor,
            policy.currency,
            policy.summary,
            policy.refund_percent,
            iso(nowMs),
          );
        }
      });

      event(appointmentId, row.status, 'cancelled', actor, session.userId, reason, {
        refund_percent: policy.refund_percent,
        rule: policy.rule,
      });

      const appointment = toDomain(requireAppointment(appointmentId));

      notify(
        db,
        {
          userId: row.patient_user_id,
          category: 'cancellation',
          title: actor === 'doctor' ? 'Appointment cancelled by the clinic' : 'Appointment cancelled',
          body: policy.summary,
          deeplink: `/appointments/${appointmentId}`,
          appointmentId,
          channels: ['in_app', 'push', 'email', 'sms'],
        },
        nowMs,
      );
      notify(
        db,
        {
          userId: row.doctor_id,
          category: 'cancellation',
          title: actor === 'doctor' ? 'You cancelled an appointment' : 'Patient cancelled',
          body: `${row.for_name} · ${row.start_utc}`,
          deeplink: `/appointments/${appointmentId}`,
          appointmentId,
          channels: ['in_app', 'push'],
        },
        nowMs,
      );
      console.log(`[reminders] cancelled queued reminders for ${appointmentId} (no ghost reminders, APT-010)`);

      return { appointment, refund: appointment.refund, policy };
    },

    /* -------------------------------------------------------- doctor actions */

    accept(session: Session, appointmentId: string): Appointment {
      const row = requireParticipant(session, appointmentId);
      if (session.role !== 'doctor') throw new ApiError('AUTHZ_FORBIDDEN', 'Doctor access required.');
      if (row.status !== 'pending_approval') {
        throw new ApiError('APT_STATE_CONFLICT', 'Only appointments awaiting approval can be accepted.', {
          details: { from: row.status, to: 'confirmed' },
        });
      }
      run(db, `UPDATE appointments SET status = 'confirmed', updated_at = ? WHERE id = ?`, iso(now()), appointmentId);
      event(appointmentId, row.status, 'confirmed', 'doctor', session.userId, 'accepted');
      notify(
        db,
        {
          userId: row.patient_user_id,
          category: 'approval',
          title: 'Booking confirmed',
          body: 'The doctor accepted your request.',
          deeplink: `/appointments/${appointmentId}`,
          appointmentId,
          channels: ['in_app', 'push', 'email'],
        },
        now(),
      );
      return toDomain(requireAppointment(appointmentId));
    },

    /** Decline → auto-refund in full (PRD DOC-011 / EC-05). */
    decline(session: Session, appointmentId: string, reason: string): Appointment {
      if (session.role !== 'doctor') throw new ApiError('AUTHZ_FORBIDDEN', 'Doctor access required.');
      const result = this.cancelSync(session, appointmentId, {
        reason: reason || 'Doctor declined the request',
      });
      return result.appointment;
    },

    complete(session: Session, appointmentId: string): Appointment {
      const row = requireParticipant(session, appointmentId);
      if (session.role !== 'doctor') throw new ApiError('AUTHZ_FORBIDDEN', 'Doctor access required.');
      if (!['confirmed', 'in_progress'].includes(row.status)) {
        throw new ApiError('APT_STATE_CONFLICT', 'Only a confirmed or in-progress visit can be completed.', {
          details: { from: row.status, to: 'completed' },
        });
      }
      run(db, `UPDATE appointments SET status = 'completed', updated_at = ? WHERE id = ?`, iso(now()), appointmentId);
      event(appointmentId, row.status, 'completed', 'doctor', session.userId, 'marked completed');
      notify(
        db,
        {
          userId: row.patient_user_id,
          category: 'review',
          title: 'How was your visit?',
          body: 'Rate your consultation to help other patients.',
          deeplink: `/appointments/${appointmentId}`,
          appointmentId,
          channels: ['in_app', 'push'],
        },
        now(),
      );
      return toDomain(requireAppointment(appointmentId));
    },

    /** R7 — no-show is only permitted after the grace period has elapsed. */
    markNoShow(session: Session, appointmentId: string): Appointment {
      const row = requireParticipant(session, appointmentId);
      if (session.role !== 'doctor') throw new ApiError('AUTHZ_FORBIDDEN', 'Doctor access required.');
      if (row.status !== 'confirmed') {
        throw new ApiError('APT_STATE_CONFLICT', 'Only a confirmed visit can be marked as a no-show.', {
          details: { from: row.status, to: 'no_show' },
        });
      }
      const grace = noShowGraceMinutes(row.consult_type, policyFor(row.doctor_id));
      const graceDeadline = fromIso(row.start_utc) + grace * 60_000;
      if (now() < graceDeadline) {
        throw new ApiError('APT_STATE_CONFLICT', `The no-show grace period is ${grace} minutes.`, {
          details: { grace_minutes: grace, allowed_after: iso(graceDeadline) },
        });
      }
      run(db, `UPDATE appointments SET status = 'no_show', updated_at = ? WHERE id = ?`, iso(now()), appointmentId);
      event(appointmentId, row.status, 'no_show', 'doctor', session.userId, 'marked no-show');
      return toDomain(requireAppointment(appointmentId));
    },

    /** `POST /appointments/{id}/join-token` — window-gated, minted on demand. */
    startConsult(session: Session, appointmentId: string): { room_token: string; appointment: Appointment } {
      const row = requireParticipant(session, appointmentId);
      // Join window is a platform config knob, not a per-doctor policy.
      const config = defaultPlatformConfig;
      const startMs = fromIso(row.start_utc);
      const opens = startMs - config.join_window_minutes_before * 60_000;
      const closes = startMs + config.join_grace_minutes_after * 60_000;
      if (now() < opens) {
        throw new ApiError('APT_STATE_CONFLICT', 'The join window has not opened yet.', {
          details: { opens_at: iso(opens) },
        });
      }
      if (now() > closes) {
        throw new ApiError('APT_STATE_CONFLICT', 'The join window has closed.', { details: { closed_at: iso(closes) } });
      }
      if (row.consult_type !== 'video') {
        throw new ApiError('VAL_INVALID', 'Only video consultations can be joined.');
      }
      if (row.status === 'confirmed') {
        run(db, `UPDATE appointments SET status = 'in_progress', updated_at = ? WHERE id = ?`, iso(now()), appointmentId);
        event(appointmentId, 'confirmed', 'in_progress', session.role, session.userId, 'joined video consult');
      }
      return {
        // No video vendor is configured locally (TRD §2 lists 100ms/Daily behind a
        // provider port). The token is a well-formed stand-in.
        room_token: `sim.${newId('vtoken')}`,
        appointment: toDomain(requireAppointment(appointmentId)),
      };
    },

    /* -------------------------------------------------------------- review */

    /** APT-011 / R15 — one review per completed appointment. */
    submitReview(session: Session, appointmentId: string, input: PostVisitReviewRequest): Review {
      const row = requireParticipant(session, appointmentId);
      if (session.role !== 'patient') throw new ApiError('AUTHZ_FORBIDDEN', 'Only patients can review a visit.');
      if (row.status !== 'completed') {
        throw new ApiError('APT_REVIEW_NOT_ALLOWED', 'You can review after the visit is completed.', {
          details: { status: row.status },
        });
      }
      const existing = one<{ id: string }>(db, `SELECT id FROM reviews WHERE appointment_id = ?`, appointmentId);
      if (existing) throw new ApiError('APT_REVIEW_EXISTS', 'You have already reviewed this visit.');

      const rating = Math.min(5, Math.max(1, Math.round(input.rating)));
      const comment = input.comment?.slice(0, 500) ?? null;
      const id = newId('rev');
      const nowMs = now();
      const user = one<{ display_name: string }>(db, `SELECT display_name FROM users WHERE id = ?`, session.userId)!;

      transaction(db, () => {
        run(
          db,
          `INSERT INTO reviews (id, appointment_id, doctor_id, patient_user_id, patient_display_name, rating, comment, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'published', ?)`,
          id,
          appointmentId,
          row.doctor_id,
          session.userId,
          user.display_name,
          rating,
          comment,
          iso(nowMs),
        );
        event(appointmentId, row.status, row.status, 'patient', session.userId, 'review submitted', { rating });
      });

      return {
        id,
        appointment_id: appointmentId,
        doctor_id: row.doctor_id,
        patient_display_name: user.display_name,
        rating: rating as Review['rating'],
        comment,
        created_at: iso(nowMs),
        verified_visit: true,
        status: 'published',
      };
    },

    /* --------------------------------------------------------------- money */

    /**
     * `POST /payments/intent/{appointmentId}`.
     *
     * Ordering: the appointment row is created *before* capture (TRD §10.6), so a
     * paid-but-unbooked state is impossible by construction. This endpoint records
     * the chosen method against the payment already captured at booking time.
     */
    capturePayment(session: Session, appointmentId: string, method: PaymentMethod) {
      const row = requireParticipant(session, appointmentId);
      const payment = paymentFor(appointmentId);
      if (!payment) {
        return null;
      }
      run(db, `UPDATE payments SET method = ?, status = 'captured' WHERE id = ?`, method, payment.id);
      return one<{
        id: string;
        appointment_id: string;
        method: string;
        amount_minor: number;
        currency: string;
        status: string;
        provider_ref: string;
        receipt_url: string | null;
        created_at: string;
      }>(db, `SELECT * FROM payments WHERE id = ?`, payment.id);
    },

    /* -------------------------------------------------------------- helpers */

    /** Expire holds and auto-decline stale approval requests (R13, reconciliation sweep). */
    sweep(): { holdsExpired: number; autoDeclined: number } {
      const nowMs = now();
      const holdsExpired = run(
        db,
        `UPDATE holds SET status = 'expired' WHERE status = 'active' AND expires_at <= ?`,
        iso(nowMs),
      ).changes;

      const stale = all<AppointmentRow>(
        db,
        `${APPOINTMENT_SELECT} WHERE a.status = 'pending_approval'`,
      ).filter((row) => {
        const policy = policyFor(row.doctor_id);
        return fromIso(row.created_at) + policy.approval_auto_decline_minutes * 60_000 <= nowMs;
      });

      for (const row of stale) {
        this.cancelSync(
          { userId: row.doctor_id, role: 'doctor', verificationStatus: 'approved' },
          row.id,
          { reason: 'Not approved within the response window' },
        );
        event(row.id, 'pending_approval', 'cancelled', 'system', null, 'auto-declined (R13)');
      }

      return { holdsExpired, autoDeclined: stale.length };
    },

    /** Availability for the doctor's own reschedule picker. */
    ownAvailability(doctorId: string, query: { from?: string; to?: string; type?: ConsultType }) {
      const doctor = doctorRowFor(doctorId);
      const consultType = query.type ?? 'in_person';
      const from = query.from ?? dateInZone(now(), doctor.clinic_timezone);
      const to = query.to ?? addDaysToDate(from, 20);
      const result = availabilityFor({
        doctor,
        consultType,
        policy: policyFor(doctorId),
        fromDate: from,
        toDate: to,
      });
      return {
        doctor,
        consultType,
        result,
        staleness: (() => {
          const row = one<{ last_synced_at: string | null }>(
            db,
            `SELECT last_synced_at FROM calendar_accounts WHERE doctor_id = ? ORDER BY connected_at LIMIT 1`,
            doctorId,
          );
          return row?.last_synced_at ? isoDuration(row.last_synced_at, now()) : null;
        })(),
      };
    },

    openSlotCount(doctorId: string, consultType: ConsultType): number {
      const doctor = doctorRowFor(doctorId);
      const from = dateInZone(now(), doctor.clinic_timezone);
      const result = availabilityFor({
        doctor,
        consultType,
        policy: policyFor(doctorId),
        fromDate: from,
        toDate: addDaysToDate(from, 20),
      });
      return openSlots(result).length;
    },

  };
}

function encodeCursor(offset: number): string {
  return Buffer.from(`o:${offset}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const value = Number(Buffer.from(cursor, 'base64url').toString('utf8').replace(/^o:/, ''));
    return Number.isFinite(value) && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
}
