/**
 * Doctor module — public discovery plus doctor self-management (TRD §5.2, §7.2).
 *
 * Rule R10 is enforced structurally here: unverified doctors are excluded from
 * every discovery query and a direct `GET /doctors/{id}` for an unverified doctor
 * answers `404`, never a partial profile.
 */
import { ApiError, apiErrors } from '@medibook/core';
import type {
  AvailabilityQuery,
  AvailabilityResponse,
  AvailabilityRule,
  CalendarAccount,
  CalendarProvider,
  ConsultFee,
  ConsultType,
  DoctorDetail,
  DoctorProfile,
  DoctorQuery,
  DoctorStats,
  DoctorSummary,
  Gender,
  Page,
  PatientContext,
  SeenPatient,
  Specialization,
  VerificationSubmission,
} from '@medibook/core';
import {
  addDaysToDate,
  dateInZone,
  fromIso,
  isoDuration,
  openSlots,
  toIso,
} from '@medibook/core';

import { all, json, one, run, type Db } from '../db/database.ts';
import {
  APPOINTMENT_SELECT,
  mapAppointment,
  mapCalendarAccountRow,
  mapConsultFees,
  mapDoctorDetail,
  mapDoctorPolicy,
  mapDoctorProfile,
  mapDoctorSummary,
  mapExceptionRow,
  mapReviewRow,
  mapReviewSummary,
  mapRuleRow,
  mapSpecialization,
  type AppointmentRow,
  type DoctorPolicyRow,
  type DoctorRow,
} from '../db/mappers.ts';
import { newId } from '../domain/ids.ts';
import { policyFromRow } from '../domain/rules.ts';
import { composeAvailability, loadCalendarSync, toAvailabilityResponse } from '../domain/slotEngine.ts';

const DOCTOR_SELECT = `
  SELECT d.*,
         (SELECT GROUP_CONCAT(s.name, '||') FROM doctor_specializations ds
            JOIN specializations s ON s.id = ds.specialization_id
           WHERE ds.doctor_id = d.id ORDER BY ds.is_primary DESC) AS specialties,
         (SELECT s.slug FROM doctor_specializations ds
            JOIN specializations s ON s.id = ds.specialization_id
           WHERE ds.doctor_id = d.id AND ds.is_primary = 1 LIMIT 1) AS primary_slug,
         (SELECT MIN(f.fee_minor) FROM consult_fees f WHERE f.doctor_id = d.id AND f.enabled = 1) AS min_fee_minor,
         (SELECT MAX(f.enabled) FROM consult_fees f WHERE f.doctor_id = d.id AND f.consult_type = 'video') AS video_enabled,
         (SELECT MAX(f.enabled) FROM consult_fees f WHERE f.doctor_id = d.id AND f.consult_type = 'in_person') AS in_person_enabled
    FROM doctors d`;

/** `specialties` arrives as `A||B`; expose it as an array. */
function hydrateDoctorRow(row: DoctorRow): DoctorRow {
  const raw = row.specialties;
  if (typeof raw === 'string') {
    return { ...row, specialties: JSON.stringify(raw.split('||').filter(Boolean)) };
  }
  return row;
}

function iso(ms: number): string {
  return toIso(ms);
}

export type DoctorService = ReturnType<typeof createDoctorService>;

export function createDoctorService(options: { db: Db; now: () => number }) {
  const { db, now } = options;

  function policyRowFor(doctorId: string): DoctorPolicyRow | null {
    return (
      one<DoctorPolicyRow>(db, `SELECT * FROM doctor_policies WHERE doctor_id = ?`, doctorId) ?? null
    );
  }

  function policyFor(doctorId: string) {
    return policyFromRow(policyRowFor(doctorId));
  }

  function doctorRow(doctorId: string): DoctorRow | undefined {
    const row = one<DoctorRow>(db, `${DOCTOR_SELECT} WHERE d.id = ?`, doctorId);
    return row ? hydrateDoctorRow(row) : undefined;
  }

  function requireVerifiedDoctorRow(doctorId: string): DoctorRow {
    const row = doctorRow(doctorId);
    if (!row || row.verification_status !== 'approved') {
      // Never expose unverified supply — not even the fact that it exists.
      throw apiErrors.notFound('Doctor', doctorId);
    }
    return row;
  }

  /** Fee/languages/gender filters that SQL can express, plus the ones it cannot. */
  function summarize(row: DoctorRow, viewerTimezone: string, mineStartUtcs: string[] = []): DoctorSummary {
    const summary = mapDoctorSummary(row);
    const policy = policyFor(row.id);
    const consultType = summary.consultation_types[0] ?? 'in_person';
    const nextSlot = nextSlotFor(row, policy, consultType, viewerTimezone);
    void mineStartUtcs;
    return { ...summary, next_slot_utc: nextSlot };
  }

  function nextSlotFor(
    row: DoctorRow,
    policy: ReturnType<typeof policyFromRow>,
    consultType: ConsultType,
    _viewerTimezone: string,
  ): string | null {
    const nowMs = now();
    const from = dateInZone(nowMs, row.clinic_timezone);
    const to = addDaysToDate(from, Math.min(policy.booking_window_days, 14));
    const result = composeAvailability({
      db,
      doctor: row,
      consultType,
      policy,
      fromDate: from,
      toDate: to,
      nowMs,
      ownHoldUserId: undefined,
    });
    return openSlots(result)[0]?.start_utc ?? null;
  }

  return {
    listSpecializations(): Specialization[] {
      const rows = all<{
        id: string;
        name: string;
        slug: string;
        icon: string;
        is_active: number;
        doctor_count: number;
      }>(
        db,
        `SELECT s.id, s.name, s.slug, s.icon, s.is_active,
                (SELECT COUNT(*) FROM doctor_specializations ds
                   JOIN doctors d ON d.id = ds.doctor_id
                  WHERE ds.specialization_id = s.id AND d.verification_status = 'approved') AS doctor_count
           FROM specializations s
          WHERE s.is_active = 1
          ORDER BY s.name`,
      );
      return rows.map(mapSpecialization);
    },

    /** `GET /doctors` — search, filter, sort, paginate. */
    listDoctors(query: DoctorQuery, viewerTimezone: string): Page<DoctorSummary> {
      const nowMs = now();
      const limit = Math.min(query.limit ?? 20, 50);

      const conditions: string[] = [`d.verification_status = 'approved'`];
      const params: Array<string | number> = [];

      if (query.q) {
        conditions.push(
          `(LOWER(d.display_name) LIKE ? OR LOWER(d.area) LIKE ?
            OR EXISTS (SELECT 1 FROM doctor_specializations ds JOIN specializations s ON s.id = ds.specialization_id
                        WHERE ds.doctor_id = d.id AND LOWER(s.name) LIKE ?))`,
        );
        const needle = `%${query.q.trim().toLowerCase()}%`;
        params.push(needle, needle, needle);
      }
      if (query.specialization) {
        conditions.push(
          `EXISTS (SELECT 1 FROM doctor_specializations ds JOIN specializations s ON s.id = ds.specialization_id
                    WHERE ds.doctor_id = d.id AND s.slug = ?)`,
        );
        params.push(query.specialization);
      }
      if (query.consult_type) {
        conditions.push(
          `EXISTS (SELECT 1 FROM consult_fees f WHERE f.doctor_id = d.id AND f.enabled = 1 AND f.consult_type = ?)`,
        );
        params.push(query.consult_type);
      }
      if (query.gender) {
        conditions.push(`d.gender = ?`);
        params.push(query.gender);
      }
      if (query.language) {
        conditions.push(`LOWER(d.languages) LIKE ?`);
        params.push(`%${query.language.toLowerCase()}%`);
      }
      if (query.fee_min_minor !== undefined) {
        conditions.push(
          `COALESCE((SELECT MIN(f.fee_minor) FROM consult_fees f WHERE f.doctor_id = d.id AND f.enabled = 1), 0) >= ?`,
        );
        params.push(query.fee_min_minor);
      }
      if (query.fee_max_minor !== undefined) {
        conditions.push(
          `COALESCE((SELECT MIN(f.fee_minor) FROM consult_fees f WHERE f.doctor_id = d.id AND f.enabled = 1), 0) <= ?`,
        );
        params.push(query.fee_max_minor);
      }

      const rows = all<DoctorRow>(
        db,
        `${DOCTOR_SELECT} WHERE ${conditions.join(' AND ')}`,
        ...params,
      ).map(hydrateDoctorRow);

      let summaries = rows.map((row) => summarize(row, viewerTimezone));

      // Availability filter needs the slot engine, so it runs after hydration.
      if (query.available) {
        const targetDate = resolveAvailabilityDate(query.available, viewerTimezone, nowMs);
        summaries = summaries.filter((summary) => {
          const row = rows.find((candidate) => candidate.id === summary.id);
          if (!row) return false;
          const types: ConsultType[] = query.consult_type
            ? [query.consult_type]
            : summary.consultation_types;
          return types.some((type) => {
            const result = composeAvailability({
              db,
              doctor: row,
              consultType: type,
              policy: policyFor(row.id),
              fromDate: targetDate,
              toDate: targetDate,
              nowMs,
            });
            return openSlots(result).length > 0;
          });
        });
      }

      summaries = sortDoctors(summaries, query.sort);

      const offset = decodeCursor(query.cursor);
      const page = summaries.slice(offset, offset + limit);
      const nextOffset = offset + limit;
      return {
        items: page,
        meta: {
          total: summaries.length,
          next_cursor: nextOffset < summaries.length ? encodeCursor(nextOffset) : null,
        },
      };
    },

    /** `GET /doctors/{id}` */
    getDoctor(doctorId: string, viewerTimezone: string): DoctorDetail {
      const row = requireVerifiedDoctorRow(doctorId);
      const fees = mapConsultFees(db, doctorId);
      const reviews = all<Parameters<typeof mapReviewRow>[0]>(
        db,
        `SELECT id, appointment_id, doctor_id, patient_display_name, rating, comment, created_at, status
           FROM reviews WHERE doctor_id = ? AND status = 'published' ORDER BY created_at DESC LIMIT 20`,
        doctorId,
      ).map(mapReviewRow);

      const calendar = loadCalendarSync(db, doctorId, now(), isoDuration);
      const summary = summarize(row, viewerTimezone);

      return mapDoctorDetail({
        db,
        row,
        fees,
        policy: mapDoctorPolicy(policyRowFor(doctorId)),
        reviews,
        reviewSummary: mapReviewSummary(db, row),
        calendarConnected: calendar.connected,
      });
      // `summary` is intentionally unused here: mapDoctorDetail re-derives it so
      // the detail payload stays internally consistent (single source).
      void summary;
    },

    /** `GET /doctors/{id}/availability` */
    getAvailability(
      doctorId: string,
      query: AvailabilityQuery,
      options: { requesterId?: string; mineUserId?: string } = {},
    ): AvailabilityResponse {
      const row = requireVerifiedDoctorRow(doctorId);
      const consultType: ConsultType = query.type ?? 'in_person';
      const fee = mapConsultFees(db, doctorId).find((entry) => entry.consult_type === consultType);
      if (!fee || !fee.enabled) {
        throw apiErrors.invalid(
          { type: `This doctor does not offer ${consultType} consultations.` },
          'Unsupported consultation type.',
        );
      }

      const nowMs = now();
      const requestedTimezone = query.tz ?? options.mineUserId
        ? query.tz ?? 'UTC'
        : 'UTC';
      const today = dateInZone(nowMs, row.clinic_timezone);
      const from = query.from ?? today;
      const to = query.to ?? addDaysToDate(from, 13);

      // Mine = the requesting patient's own active bookings with this doctor.
      const mineStartUtcs = options.mineUserId
        ? all<{ start_utc: string }>(
            db,
            `SELECT start_utc FROM appointments WHERE patient_user_id = ? AND doctor_id = ?
              AND status IN ('held','pending_approval','confirmed','in_progress')`,
            options.mineUserId,
            doctorId,
          ).map((entry) => entry.start_utc)
        : [];

      const result = composeAvailability({
        db,
        doctor: row,
        consultType,
        policy: policyFor(doctorId),
        fromDate: from,
        toDate: to,
        nowMs,
        ownHoldUserId: options.requesterId,
        mineStartUtcs,
      });

      return toAvailabilityResponse({
        doctor: row,
        consultType,
        result,
        requestedTimezone,
        nowMs,
        calendarSync: loadCalendarSync(db, doctorId, nowMs, isoDuration),
      });
    },

    /* ------------------------------------------------------- self management */

    profile(doctorId: string): DoctorProfile {
      const row = doctorRow(doctorId);
      if (!row) throw apiErrors.notFound('Doctor profile', doctorId);
      const profile = mapDoctorProfile(row, mapDoctorPolicy(policyRowFor(doctorId)), mapConsultFees(db, doctorId));
      profile.specialization_slugs = all<{ slug: string }>(
        db,
        `SELECT s.slug FROM doctor_specializations ds JOIN specializations s ON s.id = ds.specialization_id
          WHERE ds.doctor_id = ? ORDER BY ds.is_primary DESC`,
        doctorId,
      ).map((entry) => entry.slug);
      profile.qualifications = all<{ id: string; degree: string; institution: string; year: number }>(
        db,
        `SELECT id, degree, institution, year FROM qualifications WHERE doctor_id = ? ORDER BY year`,
        doctorId,
      );
      const user = one<{ phone: string | null; email: string | null }>(
        db,
        `SELECT phone, email FROM users WHERE id = ?`,
        doctorId,
      );
      profile.phone = user?.phone ?? null;
      profile.email = user?.email ?? null;
      return profile;
    },

    updateProfile(doctorId: string, patch: Partial<DoctorProfile>): DoctorProfile {
      const row = doctorRow(doctorId);
      if (!row) throw apiErrors.notFound('Doctor profile', doctorId);
      const nowMs = now();

      const licensedFieldsChanged =
        (patch.display_name !== undefined && patch.display_name !== row.display_name) ||
        (patch.clinic_address !== undefined && patch.clinic_address !== row.clinic_address);

      run(
        db,
        `UPDATE doctors SET
           display_name = COALESCE(?, display_name),
           bio = COALESCE(?, bio),
           gender = COALESCE(?, gender),
           experience_years = COALESCE(?, experience_years),
           languages = COALESCE(?, languages),
           clinic_name = COALESCE(?, clinic_name),
           clinic_address = COALESCE(?, clinic_address),
           -- Licensed-field edits re-trigger review (PRD R10 / DOC-003).
           verification_status = CASE WHEN ? = 1 THEN 'under_review' ELSE verification_status END
         WHERE id = ?`,
        patch.display_name ?? null,
        patch.bio ?? null,
        patch.gender ?? null,
        patch.experience_years ?? null,
        patch.languages ? JSON.stringify(patch.languages) : null,
        patch.clinic_name ?? null,
        patch.clinic_address ?? null,
        licensedFieldsChanged ? 1 : 0,
        doctorId,
      );

      if (patch.specialization_slugs) {
        run(db, `DELETE FROM doctor_specializations WHERE doctor_id = ?`, doctorId);
        patch.specialization_slugs.slice(0, 4).forEach((slug, index) => {
          const spec = one<{ id: string }>(db, `SELECT id FROM specializations WHERE slug = ?`, slug);
          if (!spec) return;
          run(
            db,
            `INSERT INTO doctor_specializations (doctor_id, specialization_id, is_primary) VALUES (?, ?, ?)`,
            doctorId,
            spec.id,
            index === 0 ? 1 : 0,
          );
        });
      }

      if (patch.qualifications) {
        run(db, `DELETE FROM qualifications WHERE doctor_id = ?`, doctorId);
        for (const qualification of patch.qualifications) {
          run(
            db,
            `INSERT INTO qualifications (id, doctor_id, degree, institution, year) VALUES (?, ?, ?, ?, ?)`,
            newId('qual'),
            doctorId,
            qualification.degree,
            qualification.institution,
            qualification.year,
          );
        }
      }

      if (patch.consultation_config) {
        this.updateConsultationConfig(doctorId, patch.consultation_config);
      }

      if (patch.policy) {
        this.updatePolicy(doctorId, patch.policy);
      }

      if (patch.deactivation_requested_at !== undefined) {
        run(
          db,
          `UPDATE doctors SET deactivation_requested_at = ? WHERE id = ?`,
          patch.deactivation_requested_at,
          doctorId,
        );
      }

      if (licensedFieldsChanged) {
        run(
          db,
          `INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, after_json, created_at)
           VALUES (?, 'doctor', ?, 'profile.licensed_field_changed', 'doctor', ?, ?, ?)`,
          newId('aud'),
          doctorId,
          doctorId,
          JSON.stringify({ fields: Object.keys(patch) }),
          iso(nowMs),
        );
      }

      return this.profile(doctorId);
    },

    updateConsultationConfig(doctorId: string, config: { fees: ConsultFee[] }) {
      for (const fee of config.fees) {
        run(
          db,
          `INSERT INTO consult_fees (id, doctor_id, consult_type, enabled, duration_minutes, fee_minor, currency)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(doctor_id, consult_type) DO UPDATE SET
             enabled = excluded.enabled,
             duration_minutes = excluded.duration_minutes,
             fee_minor = excluded.fee_minor,
             currency = excluded.currency`,
          newId('fee'),
          doctorId,
          fee.consult_type,
          fee.enabled ? 1 : 0,
          Math.max(10, Math.min(120, fee.duration_minutes)),
          Math.max(0, fee.fee_minor),
          fee.currency,
        );
      }
      return { fees: mapConsultFees(db, doctorId) };
    },

    updatePolicy(doctorId: string, patch: Partial<DoctorProfile['policy']>) {
      run(db, `INSERT OR IGNORE INTO doctor_policies (doctor_id) VALUES (?)`, doctorId);
      run(
        db,
        `UPDATE doctor_policies SET
           min_notice_minutes = COALESCE(?, min_notice_minutes),
           booking_window_days = COALESCE(?, booking_window_days),
           reschedule_min_hours = COALESCE(?, reschedule_min_hours),
           max_reschedules = COALESCE(?, max_reschedules),
           approval_mode = COALESCE(?, approval_mode),
           approval_auto_decline_minutes = COALESCE(?, approval_auto_decline_minutes),
           no_show_grace_minutes_video = COALESCE(?, no_show_grace_minutes_video),
           no_show_grace_minutes_clinic = COALESCE(?, no_show_grace_minutes_clinic),
           buffer_minutes = COALESCE(?, buffer_minutes)
         WHERE doctor_id = ?`,
        patch.min_notice_minutes ?? null,
        patch.booking_window_days ?? null,
        patch.reschedule_min_hours ?? null,
        patch.max_reschedules ?? null,
        patch.approval_mode ?? null,
        patch.approval_auto_decline_minutes ?? null,
        patch.no_show_grace_minutes_video ?? null,
        patch.no_show_grace_minutes_clinic ?? null,
        patch.buffer_minutes ?? null,
        doctorId,
      );
      return mapDoctorPolicy(policyRowFor(doctorId));
    },

    listRules(doctorId: string): AvailabilityRule[] {
      return all<Parameters<typeof mapRuleRow>[0]>(
        db,
        `SELECT * FROM availability_rules WHERE doctor_id = ? ORDER BY weekday, start_local_time`,
        doctorId,
      ).map(mapRuleRow);
    },

    /**
     * Create or update a weekly rule. Overlapping windows on the same weekday are
     * rejected — PRD DOC-005 requires it, and overlapping rules would silently
     * duplicate slots.
     */
    upsertRule(
      doctorId: string,
      input: Omit<AvailabilityRule, 'id' | 'doctor_id'> & { id?: string },
    ): AvailabilityRule {
      if (input.start_local_time >= input.end_local_time) {
        throw apiErrors.invalid(
          { end_local_time: 'The end time must be after the start time.' },
          'Invalid availability window.',
        );
      }
      if (input.consult_types.length === 0) {
        throw apiErrors.invalid(
          { consult_types: 'Pick at least one consultation type.' },
          'Invalid availability window.',
        );
      }

      const existing = this.listRules(doctorId);
      const clash = existing.some(
        (rule) =>
          rule.id !== input.id &&
          rule.weekday === input.weekday &&
          input.start_local_time < rule.end_local_time &&
          rule.start_local_time < input.end_local_time,
      );
      if (clash) {
        throw apiErrors.invalid(
          { start_local_time: 'This window overlaps another window on the same day.' },
          'Overlapping availability windows are not allowed.',
        );
      }

      const id = input.id ?? newId('rule');
      run(
        db,
        `INSERT INTO availability_rules (id, doctor_id, weekday, start_local_time, end_local_time, slot_minutes, buffer_minutes, consult_types, effective_from)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           weekday = excluded.weekday,
           start_local_time = excluded.start_local_time,
           end_local_time = excluded.end_local_time,
           slot_minutes = excluded.slot_minutes,
           buffer_minutes = excluded.buffer_minutes,
           consult_types = excluded.consult_types,
           effective_from = excluded.effective_from`,
        id,
        doctorId,
        input.weekday,
        input.start_local_time,
        input.end_local_time,
        input.slot_minutes,
        input.buffer_minutes,
        JSON.stringify(input.consult_types),
        input.effective_from,
      );
      return this.listRules(doctorId).find((rule) => rule.id === id)!;
    },

    deleteRule(doctorId: string, ruleId: string): void {
      run(db, `DELETE FROM availability_rules WHERE id = ? AND doctor_id = ?`, ruleId, doctorId);
    },

    listExceptions(doctorId: string) {
      return all<Parameters<typeof mapExceptionRow>[1]>(
        db,
        `SELECT * FROM availability_exceptions WHERE doctor_id = ? ORDER BY start_utc`,
        doctorId,
      ).map((row) => mapExceptionRow(db, row));
    },

    /**
     * Add a leave/block. Existing bookings inside the window are **never** touched;
     * they are returned in `affected_appointments` as the resolution list (EC-01).
     */
    createException(
      doctorId: string,
      input: { start_utc: string; end_utc: string; kind: 'leave' | 'block'; reason: string },
    ) {
      if (fromIso(input.end_utc) <= fromIso(input.start_utc)) {
        throw apiErrors.invalid({ end_utc: 'The end must be after the start.' }, 'Invalid block window.');
      }
      const id = newId('exc');
      run(
        db,
        `INSERT INTO availability_exceptions (id, doctor_id, start_utc, end_utc, kind, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        id,
        doctorId,
        input.start_utc,
        input.end_utc,
        input.kind,
        input.reason,
        iso(now()),
      );
      const row = one<Parameters<typeof mapExceptionRow>[1]>(
        db,
        `SELECT * FROM availability_exceptions WHERE id = ?`,
        id,
      )!;
      return mapExceptionRow(db, row);
    },

    deleteException(doctorId: string, exceptionId: string): void {
      run(db, `DELETE FROM availability_exceptions WHERE id = ? AND doctor_id = ?`, exceptionId, doctorId);
    },

    /* ------------------------------------------------------------- calendar */

    listCalendarAccounts(doctorId: string): CalendarAccount[] {
      return all<Parameters<typeof mapCalendarAccountRow>[0]>(
        db,
        `SELECT * FROM calendar_accounts WHERE doctor_id = ? ORDER BY connected_at`,
        doctorId,
      ).map(mapCalendarAccountRow);
    },

    /**
     * Simulated OAuth (TRD §9.2). The real implementation returns a signed,
     * doctor-bound authorization URL and exchanges the code server-side; here the
     * URL is well-formed but points at a non-existent consent screen, and no
     * provider tokens are ever issued or stored.
     */
    connectCalendar(doctorId: string, provider: CalendarProvider): { authorization_url: string; state: string } {
      const state = `${newId('state')}.${doctorId}`;
      const host = provider === 'google' ? 'accounts.google.com' : 'login.microsoftonline.com';
      const scope = provider === 'google'
        ? 'https://www.googleapis.com/auth/calendar.events.readonly'
        : 'Calendars.Read';
      return {
        authorization_url: `https://${host}/oauth2/authorize?scope=${encodeURIComponent(scope)}&state=${state}&access_type=offline&prompt=consent`,
        state,
      };
    },

    completeCalendarConnect(doctorId: string, provider: CalendarProvider, email: string): CalendarAccount {
      const existing = one<{ id: string }>(
        db,
        `SELECT id FROM calendar_accounts WHERE doctor_id = ? AND provider = ?`,
        doctorId,
        provider,
      );
      const nowMs = now();
      const accountId = existing?.id ?? newId('cal');
      run(
        db,
        `INSERT INTO calendar_accounts (id, doctor_id, provider, account_email, status, token_placeholder, last_synced_at, busy_events_90d, conflicts_open, connected_at)
         VALUES (?, ?, ?, ?, 'connected', ?, ?, 0, 0, ?)
         ON CONFLICT(id) DO UPDATE SET status = 'connected', last_synced_at = excluded.last_synced_at, account_email = excluded.account_email`,
        accountId,
        doctorId,
        provider,
        email,
        'simulated-oauth-no-token-stored',
        iso(nowMs),
        iso(nowMs),
      );
      this.syncCalendar(doctorId, accountId);
      return this.listCalendarAccounts(doctorId).find((account) => account.id === accountId)!;
    },

    /**
     * "Sync" a connected account. No provider API is contacted: deterministic busy
     * intervals are materialised instead, so availability, conflict detection and
     * the freshness indicators all exercise real code paths.
     */
    syncCalendar(
      doctorId: string,
      accountId: string,
    ): { queued: boolean; job_id: string; busy_events_imported: number; conflicts: number } {
      const account = one<{ id: string; provider: string; status: string }>(
        db,
        `SELECT id, provider, status FROM calendar_accounts WHERE id = ? AND doctor_id = ?`,
        accountId,
        doctorId,
      );
      if (!account) throw apiErrors.notFound('Calendar account', accountId);

      const doctor = doctorRow(doctorId);
      if (!doctor) throw apiErrors.notFound('Doctor', doctorId);

      const nowMs = now();
      const from = dateInZone(nowMs, doctor.clinic_timezone);
      let imported = 0;

      for (let offset = 0; offset < 90; offset += 1) {
        const date = addDaysToDate(from, offset);
        const dayStart = fromIso(`${date}T00:00:00Z`);
        const seed = doctorId.length + offset;
        const minutes = 30 + ((seed * 17) % 180);
        const startMs = dayStart + minutes * 60_000;
        const endMs = startMs + (20 + (seed % 20)) * 60_000;
        const externalId = `${date}-${accountId}-slot`;
        run(
          db,
          `INSERT INTO calendar_events (id, calendar_account_id, external_id, start_utc, end_utc, is_busy)
           VALUES (?, ?, ?, ?, ?, 1)
           ON CONFLICT(calendar_account_id, external_id) DO UPDATE SET start_utc = excluded.start_utc, end_utc = excluded.end_utc`,
          newId('cev'),
          accountId,
          externalId,
          iso(startMs),
          iso(endMs),
        );
        imported += 1;
      }

      const conflicts = all<{ id: string }>(
        db,
        `SELECT a.id FROM appointments a
          WHERE a.doctor_id = ? AND a.status IN ('confirmed','in_progress','pending_approval')
            AND EXISTS (SELECT 1 FROM calendar_events e
                          JOIN calendar_accounts c ON c.id = e.calendar_account_id
                         WHERE c.doctor_id = a.doctor_id AND c.status IN ('connected','syncing')
                           AND e.is_busy = 1
                           AND e.start_utc < a.end_utc AND a.start_utc < e.end_utc)`,
        doctorId,
      );

      run(
        db,
        `UPDATE calendar_accounts SET status = 'connected', last_synced_at = ?, busy_events_90d = ?, conflicts_open = ? WHERE id = ?`,
        iso(nowMs),
        imported,
        conflicts.length,
        accountId,
      );

      return {
        queued: true,
        job_id: newId('job'),
        busy_events_imported: imported,
        conflicts: conflicts.length,
      };
    },

    disconnectCalendar(doctorId: string, accountId: string): void {
      const account = one<{ id: string }>(
        db,
        `SELECT id FROM calendar_accounts WHERE id = ? AND doctor_id = ?`,
        accountId,
        doctorId,
      );
      if (!account) throw apiErrors.notFound('Calendar account', accountId);
      run(
        db,
        `INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, created_at)
         VALUES (?, 'doctor', ?, 'calendar.disconnected', 'calendar_account', ?, ?)`,
        newId('aud'),
        doctorId,
        accountId,
        iso(now()),
      );
      // Tokens and derived busy data are deleted with the account (PRD CAL-009).
      run(db, `DELETE FROM calendar_accounts WHERE id = ?`, accountId);
    },

    /* --------------------------------------------------------------- stats */

    stats(doctorId: string): DoctorStats {
      const rows = all<AppointmentRow>(
        db,
        `${APPOINTMENT_SELECT} WHERE a.doctor_id = ?`,
        doctorId,
      );
      const nowMs = now();
      const doctor = doctorRow(doctorId);
      const todayDate = dateInZone(nowMs, doctor?.clinic_timezone ?? 'UTC');
      const today = rows.filter((row) => dateInZone(fromIso(row.start_utc), row.doctor_timezone) === todayDate);

      const openResult = composeAvailability({
        db,
        doctor: doctor!,
        consultType: 'in_person',
        policy: policyFor(doctorId),
        fromDate: todayDate,
        toDate: addDaysToDate(todayDate, 14),
        nowMs,
      });

      const accounts = this.listCalendarAccounts(doctorId);
      const conflictsOpen = accounts.reduce((sum, account) => sum + account.conflicts_open, 0);
      const conflictIds =
        conflictsOpen > 0
          ? today
              .filter((row) => ['confirmed', 'in_progress', 'pending_approval'].includes(row.status))
              .slice(0, 1)
              .map((row) => row.id)
          : [];

      return {
        today_total: today.length,
        today_completed: today.filter((row) => row.status === 'completed').length,
        today_cancellations: today.filter((row) => row.status === 'cancelled').length,
        pending_approvals: rows.filter((row) => row.status === 'pending_approval').length,
        next_free_slot_utc: openSlots(openResult)[0]?.start_utc ?? null,
        conflicts_open: conflictsOpen,
        conflict_appointment_ids: conflictIds,
        calendar_status: accounts.length === 0 ? 'not_connected' : accounts[0]!.status,
        last_synced_at: accounts[0]?.last_synced_at ?? null,
      };
    },

    listSeenPatients(doctorId: string): SeenPatient[] {
      const rows = all<{
        patient_user_id: string;
        dependent_id: string | null;
        for_name: string;
        start_utc: string;
        status: string;
        gender: string | null;
        dob: string | null;
      }>(
        db,
        `SELECT a.patient_user_id, a.dependent_id, a.for_name, a.start_utc, a.status,
                COALESCE(dep.gender, u.gender) AS gender,
                COALESCE(dep.dob, u.dob) AS dob
           FROM appointments a
           JOIN users u ON u.id = a.patient_user_id
           LEFT JOIN dependents dep ON dep.id = a.dependent_id
          WHERE a.doctor_id = ? AND a.status IN ('completed','no_show','in_progress')
          ORDER BY a.start_utc DESC`,
        doctorId,
      );

      const byKey = new Map<string, SeenPatient>();
      for (const row of rows) {
        const key = `${row.patient_user_id}:${row.dependent_id ?? 'self'}`;
        const existing = byKey.get(key);
        if (existing) {
          existing.visits_with_doctor += 1;
          if (row.status === 'no_show') existing.no_show_count_with_doctor += 1;
          continue;
        }
        byKey.set(key, {
          patient_user_id: row.patient_user_id,
          dependent_id: row.dependent_id,
          display_name: row.for_name,
          age: ageFrom(row.dob, now()),
          gender: (row.gender as Gender | null) ?? null,
          last_seen_utc: row.start_utc,
          visits_with_doctor: 1,
          no_show_count_with_doctor: row.status === 'no_show' ? 1 : 0,
        });
      }
      return [...byKey.values()].sort((a, b) => b.last_seen_utc.localeCompare(a.last_seen_utc));
    },

    /**
     * DOC-015 — patient context for one appointment. Scoped hard: only visits with
     * *this* doctor, no cross-doctor history, masked phone.
     */
    patientContext(doctorId: string, appointmentId: string): PatientContext {
      const appointment = one<AppointmentRow>(
        db,
        `${APPOINTMENT_SELECT} WHERE a.id = ? AND a.doctor_id = ?`,
        appointmentId,
        doctorId,
      );
      if (!appointment) throw apiErrors.notFound('Appointment', appointmentId);

      const visits = all<AppointmentRow>(
        db,
        `${APPOINTMENT_SELECT} WHERE a.doctor_id = ? AND a.patient_user_id = ?
           ORDER BY a.start_utc DESC LIMIT 50`,
        doctorId,
        appointment.patient_user_id,
      );

      const dependent = appointment.dependent_id
        ? one<{ relationship: string; gender: string; dob: string }>(
            db,
            `SELECT relationship, gender, dob FROM dependents WHERE id = ?`,
            appointment.dependent_id,
          )
        : undefined;
      const user = one<{ gender: string | null; dob: string | null; phone: string | null }>(
        db,
        `SELECT gender, dob, phone FROM users WHERE id = ?`,
        appointment.patient_user_id,
      );

      return {
        patient_user_id: appointment.patient_user_id,
        dependent_id: appointment.dependent_id,
        display_name: appointment.for_name,
        relationship: dependent?.relationship ?? null,
        age: ageFrom(dependent?.dob ?? user?.dob ?? null, now()),
        gender: ((dependent?.gender ?? user?.gender) as Gender | null) ?? null,
        phone_masked: maskPhone(user?.phone ?? null),
        note: appointment.patient_note,
        visits_with_doctor: visits.map((visit) => ({
          appointment_id: visit.id,
          code: visit.code,
          start_utc: visit.start_utc,
          status: visit.status,
          consult_type: visit.consult_type,
          note: visit.patient_note,
        })),
        no_show_count_with_doctor: visits.filter((visit) => visit.status === 'no_show').length,
        completed_count_with_doctor: visits.filter((visit) => visit.status === 'completed').length,
      };
    },

    /* ------------------------------------------------------- verification */

    verification(doctorId: string): VerificationSubmission {
      const row = doctorRow(doctorId);
      if (!row) throw apiErrors.notFound('Doctor', doctorId);
      const submission = one<{
        status: string;
        registration_number: string;
        council: string;
        country: string;
        specialization_slugs: string;
        submitted_at: string | null;
        reviewed_at: string | null;
        rejection_reason: string | null;
      }>(db, `SELECT * FROM verification_submissions WHERE doctor_id = ?`, doctorId);

      const documents = all<{ id: string; kind: string; filename: string; uploaded_at: string }>(
        db,
        `SELECT id, kind, filename, uploaded_at FROM verification_documents WHERE doctor_id = ? ORDER BY uploaded_at`,
        doctorId,
      );

      const accounts = this.listCalendarAccounts(doctorId);
      const hasSchedule = all<{ count: number }>(
        db,
        `SELECT COUNT(*) AS count FROM availability_rules WHERE doctor_id = ?`,
        doctorId,
      )[0]?.count ?? 0;
      const hasFees = all<{ count: number }>(
        db,
        `SELECT COUNT(*) AS count FROM consult_fees WHERE doctor_id = ? AND enabled = 1`,
        doctorId,
      )[0]?.count ?? 0;

      return {
        status: (submission?.status ?? row.verification_status) as VerificationSubmission['status'],
        registration_number: submission?.registration_number ?? row.registration_number,
        council: submission?.council ?? row.council,
        country: submission?.country ?? 'India',
        specialization_slugs: json<string[]>(submission?.specialization_slugs ?? null, []),
        documents: documents.map((document) => ({
          id: document.id,
          kind: document.kind as 'license' | 'government_id' | 'degree',
          filename: document.filename,
          uploaded_at: document.uploaded_at,
        })),
        submitted_at: submission?.submitted_at ?? null,
        reviewed_at: submission?.reviewed_at ?? null,
        rejection_reason: submission?.rejection_reason ?? row.rejection_reason,
        checklist: [
          { key: 'profile', label: 'Professional profile', done: row.bio.length > 0 },
          { key: 'photo', label: 'Profile photo', done: true },
          { key: 'fees', label: 'Consultation types & fees', done: hasFees > 0 },
          { key: 'schedule', label: 'Weekly schedule', done: hasSchedule > 0 },
          { key: 'calendar', label: 'At least one calendar connected', done: accounts.length > 0 },
          { key: 'verification', label: 'Licence verified', done: row.verification_status === 'approved' },
        ],
      };
    },

    submitVerification(
      doctorId: string,
      input: {
        registration_number: string;
        council: string;
        country: string;
        specialization_slugs: string[];
        documents: Array<{ kind: 'license' | 'government_id' | 'degree'; filename: string }>;
      },
    ): VerificationSubmission {
      const nowMs = now();
      if (!input.registration_number.trim()) {
        throw apiErrors.invalid({ registration_number: 'A registration number is required.' });
      }
      if (!input.documents.some((document) => document.kind === 'license')) {
        throw apiErrors.invalid({ documents: 'Upload your medical licence.' });
      }

      // Duplicate registration numbers are a fraud signal (PRD EC-24 / ADM-002).
      const duplicate = one<{ id: string }>(
        db,
        `SELECT id FROM doctors WHERE registration_number = ? AND id <> ?`,
        input.registration_number.trim(),
        doctorId,
      );
      if (duplicate) {
        throw apiErrors.invalid(
          { registration_number: 'This registration number is already on another account.' },
          'Registration number already in use.',
        );
      }

      run(
        db,
        `UPDATE doctors SET registration_number = ?, council = ?, country = ?, verification_status = 'under_review' WHERE id = ?`,
        input.registration_number.trim(),
        input.council,
        input.country,
        doctorId,
      );
      run(db, `DELETE FROM verification_documents WHERE doctor_id = ?`, doctorId);
      for (const document of input.documents) {
        run(
          db,
          `INSERT INTO verification_documents (id, doctor_id, kind, filename, uploaded_at) VALUES (?, ?, ?, ?, ?)`,
          newId('doc'),
          doctorId,
          document.kind,
          document.filename,
          iso(nowMs),
        );
      }
      run(
        db,
        `INSERT INTO verification_submissions (doctor_id, status, registration_number, council, country, specialization_slugs, submitted_at, reviewed_at, rejection_reason)
         VALUES (?, 'under_review', ?, ?, ?, ?, ?, NULL, NULL)
         ON CONFLICT(doctor_id) DO UPDATE SET
           status = 'under_review',
           registration_number = excluded.registration_number,
           council = excluded.council,
           country = excluded.country,
           specialization_slugs = excluded.specialization_slugs,
           submitted_at = excluded.submitted_at,
           reviewed_at = NULL,
           rejection_reason = NULL`,
        doctorId,
        input.registration_number.trim(),
        input.council,
        input.country,
        JSON.stringify(input.specialization_slugs),
        iso(nowMs),
      );

      return this.verification(doctorId);
    },

    /** Admin-side verification decision (kept here so the cascade is one place). */
    decideVerification(
      doctorId: string,
      decision: 'approve' | 'reject',
      reason?: string,
    ): { status: string } {
      const nowMs = now();
      const status = decision === 'approve' ? 'approved' : 'rejected';
      run(
        db,
        `UPDATE doctors SET verification_status = ?, verified_at = ?, rejection_reason = ? WHERE id = ?`,
        status,
        decision === 'approve' ? iso(nowMs) : null,
        decision === 'reject' ? (reason ?? 'Documents could not be verified.') : null,
        doctorId,
      );
      run(
        db,
        `UPDATE verification_submissions SET status = ?, reviewed_at = ?, rejection_reason = ? WHERE doctor_id = ?`,
        status,
        iso(nowMs),
        decision === 'reject' ? (reason ?? 'Documents could not be verified.') : null,
        doctorId,
      );
      return { status };
    },

    allDoctorRows(): DoctorRow[] {
      return all<DoctorRow>(db, `${DOCTOR_SELECT}`).map(hydrateDoctorRow);
    },
  };
}

/* -------------------------------------------------------------- helpers */

function sortDoctors(items: DoctorSummary[], sort: DoctorQuery['sort']): DoctorSummary[] {
  const copy = [...items];
  switch (sort) {
    case 'rating':
      return copy.sort((a, b) => b.rating - a.rating || b.review_count - a.review_count);
    case 'fee_asc':
      return copy.sort((a, b) => a.fee_minor - b.fee_minor);
    case 'fee_desc':
      return copy.sort((a, b) => b.fee_minor - a.fee_minor);
    case 'experience':
      return copy.sort((a, b) => b.experience_years - a.experience_years);
    case 'next_available':
      return copy.sort((a, b) => {
        if (a.next_slot_utc === null && b.next_slot_utc === null) return 0;
        if (a.next_slot_utc === null) return 1;
        if (b.next_slot_utc === null) return -1;
        return a.next_slot_utc.localeCompare(b.next_slot_utc);
      });
    case 'relevance':
    default:
      return copy.sort((a, b) => b.rating * Math.log10(b.review_count + 10) - a.rating * Math.log10(a.review_count + 10));
  }
}

function resolveAvailabilityDate(value: string, timeZone: string, nowMs: number): string {
  if (value === 'today') return dateInZone(nowMs, timeZone);
  if (value === 'tomorrow') return addDaysToDate(dateInZone(nowMs, timeZone), 1);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw apiErrors.invalid({ available: 'Use `today`, `tomorrow` or a YYYY-MM-DD date.' });
  }
  return value;
}

function encodeCursor(offset: number): string {
  return Buffer.from(`o:${offset}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const value = Number(decoded.replace(/^o:/, ''));
    return Number.isFinite(value) && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
}

function ageFrom(dob: string | null, nowMs: number): number | null {
  if (!dob) return null;
  const [year, month, day] = dob.split('-').map(Number);
  if (!year || !month || !day) return null;
  const now = new Date(nowMs);
  let age = now.getUTCFullYear() - year;
  const monthDelta = now.getUTCMonth() + 1 - month;
  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < day)) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  if (phone.length <= 5) return '•••••';
  return `${phone.slice(0, phone.length - 7)}••••${phone.slice(-3)}`;
}
