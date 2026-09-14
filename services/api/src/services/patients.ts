/**
 * Patient module — profile, dependents, favourites, account lifecycle.
 * PRD §9.1 (PAT-003 → PAT-007).
 */
import { ApiError, defaultPlatformConfig } from '@medibook/core';
import type { Dependent, DoctorSummary, PatientProfile } from '@medibook/core';
import { fromIso } from '@medibook/core';

import { all, one, run, type Db } from '../db/database.ts';
import { ACTIVE_STATUSES_SQL } from '../db/schema.ts';
import { mapDependentRow, mapPatientProfile, type PatientProfileRow } from '../db/mappers.ts';
import { newId } from '../domain/ids.ts';

export type PatientService = ReturnType<typeof createPatientService>;

export function createPatientService(options: { db: Db; now: () => number }) {
  const { db, now } = options;

  function requirePatient(userId: string): PatientProfileRow {
    const row = one<PatientProfileRow>(
      db,
      `SELECT u.*, p.emergency_contact, p.photo_key
         FROM users u
         LEFT JOIN patient_profiles p ON p.user_id = u.id
        WHERE u.id = ?`,
      userId,
    );
    if (!row) throw new ApiError('NOT_FOUND', 'Patient not found.');
    return row;
  }

  function upcomingCountFor(dependentId: string): number {
    const row = one<{ count: number }>(
      db,
      `SELECT COUNT(*) AS count FROM appointments
        WHERE dependent_id = ? AND status IN ${ACTIVE_STATUSES_SQL} AND start_utc > ?`,
      dependentId,
      new Date(now()).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    );
    return row?.count ?? 0;
  }

  return {
    profile(userId: string): PatientProfile {
      return mapPatientProfile(requirePatient(userId));
    },

    /** PAT-003 — DOB is required before a first booking, but stored as given here. */
    updateProfile(userId: string, patch: Partial<PatientProfile>): PatientProfile {
      // An email change requires re-verification in production (PAT-003); the local
      // build stores it and flags the pending verification.
      const current = requirePatient(userId);
      run(
        db,
        `UPDATE users
            SET display_name = COALESCE(?, display_name),
                gender = COALESCE(?, gender),
                dob = COALESCE(?, dob),
                email = COALESCE(?, email),
                default_timezone = COALESCE(?, default_timezone)
          WHERE id = ?`,
        patch.display_name ?? null,
        patch.gender ?? null,
        patch.dob ?? null,
        patch.email ?? null,
        patch.default_timezone ?? null,
        userId,
      );
      if (patch.emergency_contact !== undefined) {
        run(db, `INSERT OR IGNORE INTO patient_profiles (user_id) VALUES (?)`, userId);
        run(
          db,
          `UPDATE patient_profiles SET emergency_contact = ? WHERE user_id = ?`,
          patch.emergency_contact,
          userId,
        );
      }
      if (current.dob === null && patch.dob) {
        run(db, `UPDATE users SET onboarding_state = 'complete' WHERE id = ?`, userId);
      }
      return this.profile(userId);
    },

    listDependents(userId: string): Dependent[] {
      return all<Parameters<typeof mapDependentRow>[0]>(
        db,
        `SELECT * FROM dependents WHERE guardian_user_id = ? AND is_active = 1 ORDER BY name`,
        userId,
      ).map((row) => ({ ...mapDependentRow(row), upcoming_appointments: upcomingCountFor(row.id) }));
    },

    createDependent(
      userId: string,
      input: Omit<Dependent, 'id' | 'guardian_user_id' | 'is_active' | 'upcoming_appointments'>,
    ): Dependent {
      const existing = all<{ id: string }>(
        db,
        `SELECT id FROM dependents WHERE guardian_user_id = ? AND is_active = 1`,
        userId,
      );
      if (existing.length >= defaultPlatformConfig.max_dependents) {
        throw new ApiError(
          'VAL_INVALID',
          `You can add up to ${defaultPlatformConfig.max_dependents} family members.`,
        );
      }
      if (!input.name?.trim() || !input.dob) {
        throw new ApiError('VAL_INVALID', 'A name and date of birth are required.', {
          details: { name: !input.name?.trim() ? 'required' : undefined, dob: !input.dob ? 'required' : undefined },
        });
      }
      const id = newId('dep');
      run(
        db,
        `INSERT INTO dependents (id, guardian_user_id, name, relationship, dob, gender, notes, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
        id,
        userId,
        input.name.trim(),
        input.relationship,
        input.dob,
        input.gender,
        input.notes ?? null,
      );
      return { ...input, id, guardian_user_id: userId, is_active: true, upcoming_appointments: 0 };
    },

    updateDependent(userId: string, dependentId: string, patch: Partial<Dependent>): Dependent {
      const row = one<Parameters<typeof mapDependentRow>[0]>(
        db,
        `SELECT * FROM dependents WHERE id = ? AND guardian_user_id = ?`,
        dependentId,
        userId,
      );
      if (!row) throw new ApiError('NOT_FOUND', 'Family member not found.', { details: { id: dependentId } });

      run(
        db,
        `UPDATE dependents
            SET name = COALESCE(?, name),
                relationship = COALESCE(?, relationship),
                dob = COALESCE(?, dob),
                gender = COALESCE(?, gender),
                notes = COALESCE(?, notes)
          WHERE id = ?`,
        patch.name ?? null,
        patch.relationship ?? null,
        patch.dob ?? null,
        patch.gender ?? null,
        patch.notes ?? null,
        dependentId,
      );
      const updated = one<Parameters<typeof mapDependentRow>[0]>(
        db,
        `SELECT * FROM dependents WHERE id = ?`,
        dependentId,
      )!;
      return { ...mapDependentRow(updated), upcoming_appointments: upcomingCountFor(dependentId) };
    },

    /**
     * PAT-004 / EC-14 — a dependent with upcoming appointments cannot be removed;
     * their visits must be reassigned or cancelled first.
     */
    deleteDependent(userId: string, dependentId: string): void {
      const row = one<{ id: string }>(
        db,
        `SELECT id FROM dependents WHERE id = ? AND guardian_user_id = ?`,
        dependentId,
        userId,
      );
      if (!row) throw new ApiError('NOT_FOUND', 'Family member not found.', { details: { id: dependentId } });

      const upcoming = all<{ id: string; code: string }>(
        db,
        `SELECT id, code FROM appointments
          WHERE dependent_id = ? AND status IN ${ACTIVE_STATUSES_SQL} AND start_utc > ?`,
        dependentId,
        new Date(now()).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      );
      if (upcoming.length > 0) {
        throw new ApiError(
          'APT_DEPENDENT_HAS_APPOINTMENTS',
          'This family member has upcoming appointments. Move or cancel them first.',
          { details: { appointment_ids: upcoming.map((entry) => entry.id), codes: upcoming.map((entry) => entry.code) } },
        );
      }
      run(db, `UPDATE dependents SET is_active = 0 WHERE id = ?`, dependentId);
    },

    listSavedDoctors(userId: string, summaries: DoctorSummary[]): DoctorSummary[] {
      const saved = new Set(
        all<{ doctor_id: string }>(db, `SELECT doctor_id FROM saved_doctors WHERE patient_user_id = ?`, userId).map(
          (row) => row.doctor_id,
        ),
      );
      return summaries.filter((doctor) => saved.has(doctor.id)).map((doctor) => ({ ...doctor, is_favorite: true }));
    },

    setSavedDoctor(userId: string, doctorId: string, saved: boolean): { doctor_id: string; saved: boolean } {
      const doctor = one<{ id: string }>(db, `SELECT id FROM doctors WHERE id = ?`, doctorId);
      if (!doctor) throw new ApiError('NOT_FOUND', 'Doctor not found.', { details: { id: doctorId } });
      if (saved) {
        run(
          db,
          `INSERT OR IGNORE INTO saved_doctors (patient_user_id, doctor_id, created_at) VALUES (?, ?, ?)`,
          userId,
          doctorId,
          new Date(now()).toISOString().replace(/\.\d{3}Z$/, 'Z'),
        );
      } else {
        run(db, `DELETE FROM saved_doctors WHERE patient_user_id = ? AND doctor_id = ?`, userId, doctorId);
      }
      return { doctor_id: doctorId, saved };
    },

    /**
     * PAT-007 / EC-26 — deletion is *requested*, never immediate. Blocking
     * appointments are listed so the patient resolves them first.
     */
    requestAccountDeletion(userId: string, reason?: string): { requested_at: string; resolve_first: string[] } {
      const requestedAt = new Date(now()).toISOString().replace(/\.\d{3}Z$/, 'Z');
      const blocking = all<{ code: string }>(
        db,
        `SELECT code FROM appointments
          WHERE patient_user_id = ? AND status IN ('held','pending_approval','confirmed') AND start_utc > ?`,
        userId,
        requestedAt,
      );
      run(
        db,
        `INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, after_json, created_at)
         VALUES (?, 'patient', ?, 'account.deletion_requested', 'user', ?, ?, ?)`,
        newId('aud'),
        userId,
        userId,
        JSON.stringify({ reason: reason ?? null, blocking: blocking.length }),
        requestedAt,
      );
      return { requested_at: requestedAt, resolve_first: blocking.map((entry) => entry.code) };
    },

    savedDoctorIds(userId: string): Set<string> {
      return new Set(
        all<{ doctor_id: string }>(db, `SELECT doctor_id FROM saved_doctors WHERE patient_user_id = ?`, userId).map(
          (row) => row.doctor_id,
        ),
      );
    },

    /** Helper for the notification module's timezone-aware quiet hours. */
    timeZone(userId: string): string {
      const row = one<{ default_timezone: string }>(db, `SELECT default_timezone FROM users WHERE id = ?`, userId);
      return row?.default_timezone ?? 'Asia/Kolkata';
    },

    isUpcoming(startUtc: string): boolean {
      return fromIso(startUtc) > now();
    },
  };
}
