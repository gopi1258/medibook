/**
 * Database seeder — deterministic, idempotent, reuses the `@medibook/core`
 * fixtures so the offline mock and the live server agree.
 *
 *   node src/seed.ts            # insert/refresh the fixture dataset
 *   node src/seed.ts --reset    # wipe every table first
 *
 * `MEDIBOOK_DB_PATH` overrides the database path (honoured by `openDb`).
 * Appointment times are derived from the *real* slot engine (`expandSlots`), so
 * seeded visits always sit on genuine template slots and satisfy min-notice.
 */
import { pathToFileURL } from 'node:url';

import {
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  addDaysToDate,
  dateInZone,
  defaultPlatformConfig,
  expandSlots,
  fromIso,
  openSlots,
  scheduleVariants,
  seedDoctors,
  specializations,
  toIso,
  wallTimeToUtc,
  type ConsultType,
  type AvailabilityRule,
  type SeedDoctor,
  type Slot,
} from '@medibook/core';
import { openDb, run, type Db } from './db/database.ts';
import { DEFAULT_PREFERENCES } from './services/auth.ts';

const NOW_DEFAULT = Date.now();

/**
 * The fixture's own weekly-template builder. Re-implemented here against the
 * exported `scheduleVariants` because the package index does not re-export
 * `buildRules` — the output is byte-identical to `packages/core`'s helper.
 */
function buildRules(doctor: SeedDoctor, createdAtMs: number): AvailabilityRule[] {
  return scheduleVariants[doctor.schedule].map((entry, index) => ({
    id: `rule_${doctor.id}_${index}`,
    doctor_id: doctor.id,
    weekday: entry.weekday,
    start_local_time: entry.start,
    end_local_time: entry.end,
    slot_minutes: entry.slotMinutes,
    buffer_minutes: entry.bufferMinutes,
    consult_types: [...entry.consultTypes],
    effective_from: toIso(createdAtMs - 30 * DAY_MS).slice(0, 10),
  }));
}

/* ------------------------------------------------------------------ helpers */

function iso(ms: number): string {
  return toIso(ms);
}

/** Materialise the engine's open slots for a doctor, type and window. */
function engineSlots(
  doctor: SeedDoctor,
  consultType: ConsultType,
  baseNowMs: number,
  fromDate: string,
  toDate: string,
): Slot[] {
  const rules = buildRules(doctor, baseNowMs)
    .filter((rule) => rule.consult_types.includes(consultType))
    .map((rule) => ({
      weekday: rule.weekday,
      startLocalTime: rule.start_local_time,
      endLocalTime: rule.end_local_time,
      slotMinutes: rule.slot_minutes,
      bufferMinutes: rule.buffer_minutes,
      consultTypes: rule.consult_types,
      effectiveFrom: rule.effective_from,
    }));
  const fee = doctor.consultFees.fees.find((entry) => entry.consult_type === consultType);
  const policy = { ...defaultPlatformConfig, ...doctor.policy };
  const result = expandSlots({
    timeZone: doctor.clinicTimezone,
    rules,
    fromDate,
    toDate,
    consultType,
    durationMinutes: fee?.duration_minutes ?? 20,
    feeMinor: fee?.fee_minor ?? 0,
    currency: fee?.currency ?? doctor.currency,
    nowMs: baseNowMs,
    minNoticeMinutes: policy.min_notice_minutes,
    bookingWindowDays: policy.booking_window_days,
    bufferMinutes: policy.buffer_minutes,
  });
  return openSlots(result);
}

/** Pick one slot per distinct local day, skipping already-allocated instants. */
function makeAllocator() {
  const used = new Set<string>();
  return function take(
    doctor: SeedDoctor,
    consultType: ConsultType,
    count: number,
    baseNowMs: number,
    fromDate: string,
    toDate: string,
  ): string[] {
    const slots = engineSlots(doctor, consultType, baseNowMs, fromDate, toDate).filter(
      (slot) => !used.has(`${doctor.id}:${slot.start_utc}`),
    );
    const byDate = new Map<string, string[]>();
    for (const slot of slots) {
      const date = dateInZone(fromIso(slot.start_utc), doctor.clinicTimezone);
      const bucket = byDate.get(date) ?? [];
      bucket.push(slot.start_utc);
      byDate.set(date, bucket);
    }
    const picked: string[] = [];
    for (const starts of byDate.values()) {
      if (picked.length >= count) break;
      const start = starts[0]!;
      picked.push(start);
      used.add(`${doctor.id}:${start}`);
    }
    return picked;
  };
}

function upsertUsers(db: Db, rows: Array<Record<string, unknown>>): void {
  for (const row of rows) {
    // `INSERT OR REPLACE` would delete+reinsert and cascade into doctors, which
    // non-cascading children (appointments, holds) reject. Upsert instead.
    run(
      db,
      `INSERT INTO users (id, role, phone, email, display_name, gender, dob, default_timezone, locale, status, onboarding_state, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'en', ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         role = excluded.role, phone = excluded.phone, email = excluded.email,
         display_name = excluded.display_name, gender = excluded.gender, dob = excluded.dob,
         default_timezone = excluded.default_timezone, locale = excluded.locale,
         status = excluded.status, onboarding_state = excluded.onboarding_state,
         created_at = excluded.created_at`,
      row['id'] as string,
      row['role'] as string,
      (row['phone'] as string | null) ?? null,
      (row['email'] as string | null) ?? null,
      row['display_name'] as string,
      (row['gender'] as string | null) ?? null,
      (row['dob'] as string | null) ?? null,
      (row['default_timezone'] as string) ?? 'Asia/Kolkata',
      (row['status'] as string) ?? 'active',
      (row['onboarding_state'] as string) ?? 'complete',
      (row['created_at'] as string) ?? iso(NOW_DEFAULT),
    );
  }
}

function seedPreferences(db: Db, userId: string): void {
  for (const entry of DEFAULT_PREFERENCES) {
    run(
      db,
      `INSERT OR REPLACE INTO notification_preferences (user_id, category, push, email, sms, critical)
       VALUES (?, ?, ?, ?, ?, ?)`,
      userId,
      entry.category,
      entry.push ? 1 : 0,
      entry.email ? 1 : 0,
      entry.sms ? 1 : 0,
      entry.critical ? 1 : 0,
    );
  }
}

export type SeedSummary = Record<string, number>;

const TABLES = [
  'refunds',
  'payments',
  'reviews',
  'appointment_events',
  'holds',
  'appointments',
  'calendar_events',
  'calendar_accounts',
  'availability_exceptions',
  'availability_rules',
  'doctor_policies',
  'consult_fees',
  'qualifications',
  'doctor_specializations',
  'verification_documents',
  'verification_submissions',
  'notifications',
  'saved_doctors',
  'quiet_hours',
  'notification_preferences',
  'patient_profiles',
  'dependents',
  'refresh_tokens',
  'otp_challenges',
  'idempotency_keys',
  'audit_log',
  'platform_config',
  'doctors',
  'specializations',
  'users',
] as const;

export function resetDatabase(db: Db): void {
  for (const table of TABLES) run(db, `DELETE FROM ${table}`);
}

/* --------------------------------------------------------------------- seed */

export function seedDatabase(db: Db, nowMs: number = NOW_DEFAULT, options: { reset?: boolean } = {}): SeedSummary {
  if (options.reset) resetDatabase(db);

  const take = makeAllocator();
  const doctorsById = new Map(seedDoctors.map((doctor) => [doctor.id, doctor]));

  /* --------------------------------------------------------- specializations */
  for (const specialization of specializations) {
    run(
      db,
      `INSERT INTO specializations (id, name, slug, icon, is_active) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, slug = excluded.slug, icon = excluded.icon, is_active = excluded.is_active`,
      specialization.id,
      specialization.name,
      specialization.slug,
      specialization.icon,
      specialization.is_active ? 1 : 0,
    );
  }
  const specializationIdBySlug = new Map(specializations.map((entry) => [entry.slug, entry.id]));

  /* ----------------------------------------------------------------- doctors */
  const doctorUsers: Array<Record<string, unknown>> = [];
  const verifiedAt = iso(nowMs - 120 * DAY_MS);
  const createdAt = iso(nowMs - 180 * DAY_MS);

  for (const doctor of seedDoctors) {
    doctorUsers.push({
      id: doctor.id,
      role: 'doctor',
      phone: null,
      email: doctor.calendarEmail,
      display_name: doctor.name,
      gender: doctor.gender,
      dob: null,
      default_timezone: doctor.clinicTimezone,
      status: 'active',
      onboarding_state: 'live',
      created_at: createdAt,
    });
  }
  upsertUsers(db, doctorUsers);

  for (const doctor of seedDoctors) {
    run(
      db,
      `INSERT INTO doctors (
         id, display_name, bio, gender, experience_years, languages, registration_number, council, country,
         clinic_name, clinic_address, area, clinic_timezone, currency, verification_status, verified_at,
         rejection_reason, deactivation_requested_at, rating_seed, review_count_seed, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, NULL, NULL, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         display_name = excluded.display_name, bio = excluded.bio, gender = excluded.gender,
         experience_years = excluded.experience_years, languages = excluded.languages,
         registration_number = excluded.registration_number, council = excluded.council, country = excluded.country,
         clinic_name = excluded.clinic_name, clinic_address = excluded.clinic_address, area = excluded.area,
         clinic_timezone = excluded.clinic_timezone, currency = excluded.currency,
         verification_status = excluded.verification_status, verified_at = excluded.verified_at,
         rating_seed = excluded.rating_seed, review_count_seed = excluded.review_count_seed,
         created_at = excluded.created_at`,
      doctor.id,
      doctor.name,
      doctor.bio,
      doctor.gender,
      doctor.experienceYears,
      JSON.stringify(doctor.languages),
      doctor.registrationNumber,
      doctor.council,
      doctor.clinicTimezone.startsWith('America') ? 'United States' : 'India',
      doctor.clinicName,
      doctor.clinicAddress,
      doctor.area,
      doctor.clinicTimezone,
      doctor.currency,
      verifiedAt,
      doctor.rating,
      doctor.reviewCount,
      createdAt,
    );

    const primarySlugs = doctor.specializationSlugs;
    primarySlugs.forEach((slug, index) => {
      const specializationId = specializationIdBySlug.get(slug);
      if (!specializationId) return;
      run(
        db,
        `INSERT OR REPLACE INTO doctor_specializations (doctor_id, specialization_id, is_primary) VALUES (?, ?, ?)`,
        doctor.id,
        specializationId,
        index === 0 ? 1 : 0,
      );
    });

    doctor.qualifications.forEach((qualification, index) => {
      run(
        db,
        `INSERT OR REPLACE INTO qualifications (id, doctor_id, degree, institution, year) VALUES (?, ?, ?, ?, ?)`,
        `qual_${doctor.id}_${index}`,
        doctor.id,
        qualification.degree,
        qualification.institution,
        qualification.year,
      );
    });

    for (const fee of doctor.consultFees.fees) {
      run(
        db,
        `INSERT OR REPLACE INTO consult_fees (id, doctor_id, consult_type, enabled, duration_minutes, fee_minor, currency)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        `fee_${doctor.id}_${fee.consult_type}`,
        doctor.id,
        fee.consult_type,
        fee.enabled ? 1 : 0,
        fee.duration_minutes,
        fee.fee_minor,
        fee.currency,
      );
    }

    run(
      db,
      `INSERT OR REPLACE INTO doctor_policies (
         doctor_id, min_notice_minutes, booking_window_days, reschedule_min_hours, max_reschedules,
         approval_mode, approval_auto_decline_minutes, no_show_grace_minutes_video, no_show_grace_minutes_clinic, buffer_minutes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      doctor.id,
      doctor.policy.min_notice_minutes ?? null,
      doctor.policy.booking_window_days ?? null,
      doctor.policy.reschedule_min_hours ?? null,
      doctor.policy.max_reschedules ?? null,
      doctor.policy.approval_mode ?? 'auto',
      doctor.policy.approval_auto_decline_minutes ?? null,
      doctor.policy.no_show_grace_minutes_video ?? null,
      doctor.policy.no_show_grace_minutes_clinic ?? null,
      doctor.policy.buffer_minutes ?? null,
    );

    for (const rule of buildRules(doctor, nowMs)) {
      run(
        db,
        `INSERT OR REPLACE INTO availability_rules (id, doctor_id, weekday, start_local_time, end_local_time, slot_minutes, buffer_minutes, consult_types, effective_from)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        rule.id,
        rule.doctor_id,
        rule.weekday,
        rule.start_local_time,
        rule.end_local_time,
        rule.slot_minutes,
        rule.buffer_minutes,
        JSON.stringify(rule.consult_types),
        rule.effective_from,
      );
    }

    run(
      db,
      `INSERT OR REPLACE INTO verification_submissions (doctor_id, status, registration_number, council, country, specialization_slugs, submitted_at, reviewed_at, rejection_reason)
       VALUES (?, 'approved', ?, ?, ?, ?, ?, ?, NULL)`,
      doctor.id,
      doctor.registrationNumber,
      doctor.council,
      doctor.clinicTimezone.startsWith('America') ? 'United States' : 'India',
      JSON.stringify(doctor.specializationSlugs),
      iso(nowMs - 121 * DAY_MS),
      verifiedAt,
    );
    for (const [index, kind] of (['license', 'government_id'] as const).entries()) {
      run(
        db,
        `INSERT OR REPLACE INTO verification_documents (id, doctor_id, kind, filename, uploaded_at) VALUES (?, ?, ?, ?, ?)`,
        `docfile_${doctor.id}_${kind}`,
        doctor.id,
        kind,
        index === 0 ? 'medical-licence.pdf' : 'government-id.jpg',
        iso(nowMs - 121 * DAY_MS),
      );
    }

    if (doctor.calendarProvider) {
      run(
        db,
        `INSERT OR REPLACE INTO calendar_accounts (
           id, doctor_id, provider, account_email, status, token_placeholder, last_synced_at,
           busy_events_90d, conflicts_open, connected_at)
         VALUES (?, ?, ?, ?, ?, 'simulated-oauth-no-token-stored', ?, ?, ?, ?)`,
        `cal_${doctor.id}`,
        doctor.id,
        doctor.calendarProvider,
        doctor.calendarEmail ?? `${doctor.id}@example.com`,
        doctor.calendarStatus,
        iso(nowMs - 2 * MINUTE_MS),
        doctor.calendarStatus === 'connected' ? 142 : 0,
        doctor.id === 'doc_nikhil' ? 1 : 0,
        iso(nowMs - 30 * DAY_MS),
      );
    }
  }

  /* ----------------------------------------------------------------- patient */
  const patientId = 'usr_priya';
  const extraPatients = [
    {
      id: 'usr_seed_rahul',
      display_name: 'Rahul Verma',
      phone: '+919800000011',
      email: 'rahul.verma@example.com',
      gender: 'male',
      dob: '1988-07-21',
    },
    {
      id: 'usr_seed_meera',
      display_name: 'Meera Nair',
      phone: '+919800000022',
      email: 'meera.nair@example.com',
      gender: 'female',
      dob: '1995-11-02',
    },
  ];

  upsertUsers(db, [
    {
      id: patientId,
      role: 'patient',
      phone: '+919812345678',
      email: 'priya.sharma@example.com',
      display_name: 'Priya Sharma',
      gender: 'female',
      dob: '1991-03-12',
      default_timezone: 'Asia/Kolkata',
      status: 'active',
      onboarding_state: 'complete',
      created_at: iso(nowMs - 90 * DAY_MS),
    },
    ...extraPatients.map((patient) => ({
      id: patient.id,
      role: 'patient',
      phone: patient.phone,
      email: patient.email,
      display_name: patient.display_name,
      gender: patient.gender,
      dob: patient.dob,
      default_timezone: 'Asia/Kolkata',
      status: 'active',
      onboarding_state: 'complete',
      created_at: iso(nowMs - 60 * DAY_MS),
    })),
  ]);

  for (const userId of [patientId, ...extraPatients.map((patient) => patient.id)]) {
    run(db, `INSERT OR REPLACE INTO patient_profiles (user_id, emergency_contact, photo_key) VALUES (?, NULL, NULL)`, userId);
    run(db, `INSERT OR REPLACE INTO quiet_hours (user_id, enabled, start, end) VALUES (?, 1, '22:00', '07:00')`, userId);
    seedPreferences(db, userId);
  }

  const dependents = [
    {
      id: 'dep_aarav',
      guardian_user_id: patientId,
      name: 'Aarav Sharma',
      relationship: 'son',
      dob: '2018-06-04',
      gender: 'male',
      notes: 'Penicillin allergy',
    },
    {
      id: 'dep_sunita',
      guardian_user_id: patientId,
      name: 'Sunita Sharma',
      relationship: 'parent',
      dob: '1959-01-19',
      gender: 'female',
      notes: 'Type 2 diabetes',
    },
  ];
  for (const dependent of dependents) {
    run(
      db,
      `INSERT INTO dependents (id, guardian_user_id, name, relationship, dob, gender, notes, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT(id) DO UPDATE SET
         guardian_user_id = excluded.guardian_user_id, name = excluded.name,
         relationship = excluded.relationship, dob = excluded.dob,
         gender = excluded.gender, notes = excluded.notes, is_active = 1`,
      dependent.id,
      dependent.guardian_user_id,
      dependent.name,
      dependent.relationship,
      dependent.dob,
      dependent.gender,
      dependent.notes,
    );
  }

  run(
    db,
    `INSERT OR REPLACE INTO saved_doctors (patient_user_id, doctor_id, created_at) VALUES (?, 'doc_arjun', ?)`,
    patientId,
    iso(nowMs - 5 * DAY_MS),
  );

  /* ----------------------------------------------------------- appointments */
  // Seeded visits are rebuilt each run; user-created rows are left alone. The
  // delete cascades to the seeded payments/refunds/reviews/events.
  run(db, `DELETE FROM appointments WHERE id LIKE 'apt_seed_%'`);

  let appointmentSeq = 0;
  let paymentSeq = 0;

  function insertAppointment(input: {
    patientId: string;
    patientName: string;
    dependentId?: string | null;
    dependentName?: string | null;
    doctorId: string;
    consultType: ConsultType;
    startUtc: string;
    status: string;
    createdMs: number;
    cancelledBy?: string;
    cancelReason?: string;
    payment: boolean;
    paymentStatus?: string;
    code?: string;
  }): string {
    const doctor = doctorsById.get(input.doctorId)!;
    const fee = doctor.consultFees.fees.find((entry) => entry.consult_type === input.consultType)!;
    const id = `apt_seed_${++appointmentSeq}`;
    const startMs = fromIso(input.startUtc);
    const endUtc = iso(startMs + fee.duration_minutes * MINUTE_MS);
    const name = input.dependentName ?? input.patientName;
    run(
      db,
      `INSERT OR REPLACE INTO appointments (
         id, code, patient_user_id, patient_name, dependent_id, dependent_name, for_name, doctor_id, consult_type,
         start_utc, end_utc, doctor_timezone, status, cancelled_by, cancel_reason, reschedule_of_id, reschedule_count,
         fee_minor, currency, clinic_name, clinic_address, join_url, patient_note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.code ?? `MB-SE${String(appointmentSeq).padStart(2, '0')}`,
      input.patientId,
      input.patientName,
      input.dependentId ?? null,
      input.dependentName ?? null,
      name,
      input.doctorId,
      input.consultType,
      input.startUtc,
      endUtc,
      doctor.clinicTimezone,
      input.status,
      input.cancelledBy ?? null,
      input.cancelReason ?? null,
      fee.fee_minor,
      fee.currency,
      input.consultType === 'in_person' ? doctor.clinicName : null,
      input.consultType === 'in_person' ? doctor.clinicAddress : null,
      input.consultType === 'video' ? `medibook://consult/${id}` : null,
      null,
      iso(input.createdMs),
      iso(input.createdMs),
    );

    if (input.payment && fee.fee_minor > 0) {
      run(
        db,
        `INSERT OR REPLACE INTO payments (id, appointment_id, method, amount_minor, currency, status, provider_ref, receipt_url, created_at)
         VALUES (?, ?, 'card', ?, ?, ?, ?, ?, ?)`,
        `pay_seed_${++paymentSeq}`,
        id,
        fee.fee_minor,
        fee.currency,
        input.paymentStatus ?? 'captured',
        `sim_${id}`,
        `medibook://receipt/${id}`,
        iso(input.createdMs),
      );
    }
    return id;
  }

  const arjun = doctorsById.get('doc_arjun')!;
  const kavya = doctorsById.get('doc_kavya')!;
  const ananya = doctorsById.get('doc_ananya')!;
  const nikhil = doctorsById.get('doc_nikhil')!;
  const rohan = doctorsById.get('doc_rohan')!;

  const priyaFuture = (doctor: SeedDoctor, type: ConsultType): string =>
    take(doctor, type, 1, nowMs, addDaysToDate(dateInZone(nowMs, doctor.clinicTimezone), 2), addDaysToDate(dateInZone(nowMs, doctor.clinicTimezone), 18))[0]!;

  const recentPast = (doctor: SeedDoctor, type: ConsultType): string =>
    take(doctor, type, 1, nowMs - 30 * HOUR_MS, addDaysToDate(dateInZone(nowMs - 30 * HOUR_MS, doctor.clinicTimezone), -1), dateInZone(nowMs - 30 * HOUR_MS, doctor.clinicTimezone))[0]!;

  const distantPast = (doctor: SeedDoctor, type: ConsultType): string => {
    const base = nowMs - 45 * DAY_MS;
    return take(doctor, type, 1, base, dateInZone(base, doctor.clinicTimezone), addDaysToDate(dateInZone(base, doctor.clinicTimezone), 10))[0]!;
  };

  const todaySlots = (doctor: SeedDoctor, type: ConsultType, count: number): string[] => {
    const today = dateInZone(nowMs, doctor.clinicTimezone);
    const base = wallTimeToUtc(today, '00:00', doctor.clinicTimezone);
    return take(doctor, type, count, base, today, today);
  };

  // Future, confirmed — including a video visit and one for a dependent.
  insertAppointment({
    patientId,
    patientName: 'Priya Sharma',
    doctorId: arjun.id,
    consultType: 'video',
    startUtc: priyaFuture(arjun, 'video'),
    status: 'confirmed',
    createdMs: nowMs - 2 * DAY_MS,
    payment: true,
  });
  insertAppointment({
    patientId,
    patientName: 'Priya Sharma',
    doctorId: arjun.id,
    consultType: 'in_person',
    startUtc: priyaFuture(arjun, 'in_person'),
    status: 'confirmed',
    createdMs: nowMs - 3 * DAY_MS,
    payment: true,
  });
  insertAppointment({
    patientId,
    patientName: 'Priya Sharma',
    doctorId: kavya.id,
    consultType: 'video',
    startUtc: priyaFuture(kavya, 'video'),
    status: 'confirmed',
    createdMs: nowMs - 4 * DAY_MS,
    payment: true,
  });
  insertAppointment({
    patientId,
    patientName: 'Priya Sharma',
    dependentId: 'dep_aarav',
    dependentName: 'Aarav Sharma',
    doctorId: ananya.id,
    consultType: 'in_person',
    startUtc: priyaFuture(ananya, 'in_person'),
    status: 'confirmed',
    createdMs: nowMs - 1 * DAY_MS,
    payment: true,
  });

  // Manual approval → pending_approval (doc_nikhil).
  insertAppointment({
    patientId,
    patientName: 'Priya Sharma',
    doctorId: nikhil.id,
    consultType: 'in_person',
    startUtc: priyaFuture(nikhil, 'in_person'),
    status: 'pending_approval',
    createdMs: nowMs - 30 * MINUTE_MS,
    payment: true,
  });
  insertAppointment({
    patientId: 'usr_seed_rahul',
    patientName: 'Rahul Verma',
    doctorId: nikhil.id,
    consultType: 'in_person',
    startUtc: priyaFuture(nikhil, 'in_person'),
    status: 'pending_approval',
    createdMs: nowMs - 25 * MINUTE_MS,
    payment: true,
  });

  // Past, completed — one reviewed, the others awaiting a review.
  const reviewed = insertAppointment({
    patientId,
    patientName: 'Priya Sharma',
    doctorId: arjun.id,
    consultType: 'in_person',
    startUtc: distantPast(arjun, 'in_person'),
    status: 'completed',
    createdMs: nowMs - 50 * DAY_MS,
    payment: true,
  });
  insertAppointment({
    patientId,
    patientName: 'Priya Sharma',
    doctorId: kavya.id,
    consultType: 'video',
    startUtc: distantPast(kavya, 'video'),
    status: 'completed',
    createdMs: nowMs - 48 * DAY_MS,
    payment: true,
  });
  insertAppointment({
    patientId,
    patientName: 'Priya Sharma',
    dependentId: 'dep_aarav',
    dependentName: 'Aarav Sharma',
    doctorId: ananya.id,
    consultType: 'in_person',
    startUtc: distantPast(ananya, 'in_person'),
    status: 'completed',
    createdMs: nowMs - 46 * DAY_MS,
    payment: true,
  });

  run(
    db,
    `INSERT OR REPLACE INTO reviews (id, appointment_id, doctor_id, patient_user_id, patient_display_name, rating, comment, status, created_at)
     VALUES ('rev_seed_1', ?, ?, ?, 'Priya Sharma', 5, 'Clear diagnosis and a written plan. Highly recommend.', 'published', ?)`,
    reviewed,
    arjun.id,
    patientId,
    iso(nowMs - 49 * DAY_MS),
  );

  // Cancelled with a full refund.
  const cancelled = insertAppointment({
    patientId,
    patientName: 'Priya Sharma',
    doctorId: rohan.id,
    consultType: 'in_person',
    startUtc: priyaFuture(rohan, 'in_person'),
    status: 'cancelled',
    createdMs: nowMs - 6 * DAY_MS,
    cancelledBy: 'patient',
    cancelReason: 'Travel plans changed',
    payment: true,
    paymentStatus: 'refunded',
  });
  run(
    db,
    `INSERT OR REPLACE INTO refunds (id, payment_id, amount_minor, currency, reason, tier_percent, status, created_at)
     SELECT 'ref_seed_1', id, amount_minor, currency, 'Cancelled >24h before the visit', 100, 'processing', ? FROM payments WHERE appointment_id = ?`,
    iso(nowMs - 6 * DAY_MS),
    cancelled,
  );

  // Doctor app: 2–3 today/upcoming visits for Dr. Arjun Mehta.
  for (const [patient, count] of [
    [extraPatients[0]!, 1],
    [extraPatients[1]!, 1],
  ] as const) {
    const [start] = todaySlots(arjun, 'in_person', count);
    if (start) {
      insertAppointment({
        patientId: patient.id,
        patientName: patient.display_name,
        doctorId: arjun.id,
        consultType: 'in_person',
        startUtc: start,
        status: 'confirmed',
        createdMs: nowMs - 2 * DAY_MS,
        payment: true,
      });
    }
  }
  // One upcoming (tomorrow) so `scope=upcoming` is populated for the doctor.
  const tomorrowStart = take(
    arjun,
    'in_person',
    1,
    nowMs,
    addDaysToDate(dateInZone(nowMs, arjun.clinicTimezone), 1),
    addDaysToDate(dateInZone(nowMs, arjun.clinicTimezone), 3),
  )[0];
  if (tomorrowStart) {
    insertAppointment({
      patientId: extraPatients[0]!.id,
      patientName: extraPatients[0]!.display_name,
      doctorId: arjun.id,
      consultType: 'in_person',
      startUtc: tomorrowStart,
      status: 'confirmed',
      createdMs: nowMs - 1 * DAY_MS,
      payment: true,
    });
  }

  // A confirmed visit whose grace period has already elapsed — the no-show target.
  const noShowStart = recentPast(arjun, 'in_person');
  if (noShowStart && fromIso(noShowStart) < nowMs) {
    insertAppointment({
      patientId: extraPatients[1]!.id,
      patientName: extraPatients[1]!.display_name,
      doctorId: arjun.id,
      consultType: 'in_person',
      startUtc: noShowStart,
      status: 'confirmed',
      createdMs: nowMs - 2 * DAY_MS,
      payment: true,
    });
  }

  return countTables(db);
}

export function countTables(db: Db): SeedSummary {
  const summary: SeedSummary = {};
  for (const table of TABLES) {
    const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
    summary[table] = Number(row.count);
  }
  return summary;
}

/* ---------------------------------------------------------------------- main */

export async function seed(db: Db, options: { reset?: boolean } = {}): Promise<SeedSummary> {
  return seedDatabase(db, Date.now(), options);
}

async function main(): Promise<void> {
  const reset = process.argv.includes('--reset');
  const path = process.env['MEDIBOOK_DB_PATH'] ?? undefined;
  const db = openDb({ path, verbose: true });
  const summary = seedDatabase(db, Date.now(), { reset });
  const total = Object.values(summary).reduce((sum, value) => sum + value, 0);
  console.log('[seed] rows per table:');
  for (const [table, count] of Object.entries(summary)) {
    console.log(`  ${table.padEnd(26)} ${count}`);
  }
  console.log(`[seed] done${reset ? ' (reset)' : ''} — ${total} rows across ${Object.keys(summary).length} tables`);
  db.close();
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  await main().catch((error) => {
    console.error('[seed] failed:', error);
    process.exitCode = 1;
  });
}
