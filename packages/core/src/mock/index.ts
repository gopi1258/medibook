/**
 * Offline mock API.
 *
 * Satisfies exactly the same `PatientApi` / `DoctorApi` interfaces as the HTTP
 * client, so screens never branch on where their data came from. The apps use
 * this when `EXPO_PUBLIC_API_URL` is unset.
 *
 * Integrity is deliberately *not* faked: booking goes through the same pure slot
 * engine (`expandSlots`) and the same rules module as the backend, and a taken
 * slot raises the same `APT_SLOT_TAKEN` error with the same alternatives payload.
 * What it does not have is durability — state lives in memory and resets on
 * reload.
 */
import { ApiError, apiErrors } from '../errors.ts';
import { defaultPlatformConfig, cancellationPolicy, reschedulePolicy } from '../rules.ts';
import {
  expandSlots,
  nearestAlternatives,
  openSlots,
  type SlotBusyInterval,
  type SlotEngineRule,
} from '../slotEngine.ts';
import {
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  addDaysToDate,
  clockLabel,
  dateInZone,
  fromIso,
  isoDuration,
  toIso,
  wallTimeToUtc,
} from '../time.ts';
import type {
  AppNotification,
  Appointment,
  AppointmentListQuery,
  AuthSession,
  AuthUser,
  AvailabilityDay,
  AvailabilityException,
  AvailabilityQuery,
  AvailabilityResponse,
  AvailabilityRule,
  CalendarAccount,
  CalendarProvider,
  CancelRequest,
  CancelResult,
  ConsultationConfig,
  CreateAppointmentRequest,
  CreateHoldRequest,
  Dependent,
  DoctorDetail,
  DoctorPolicy,
  DoctorProfile,
  DoctorQuery,
  DoctorStats,
  DoctorSummary,
  HealthResponse,
  Hold,
  NotificationPreference,
  OtpRequest,
  OtpVerifyRequest,
  Page,
  PatientContext,
  PatientProfile,
  Payment,
  PaymentMethod,
  PostVisitReviewRequest,
  Review,
  ReviewSummary,
  SeenPatient,
  Slot,
  Specialization,
  VerificationSubmission,
} from '../types.ts';
import type { DoctorApi, PatientApi } from '../api.ts';

import {
  DOCTOR_USER_ID,
  PATIENT_USER_ID,
  buildDoctorProfile,
  buildRules,
  buildVerification,
  externalBusyFor,
  seedDoctors,
  specializations,
  type SeedDoctor,
} from './fixtures.ts';

/* ------------------------------------------------------------------- state */

type ReviewPool = { comments: string[]; distribution: [number, number, number, number, number] };

const reviewPools: ReviewPool[] = [
  {
    comments: [
      'Explained the treatment clearly and did not push unnecessary tests. Follow-up was quick over chat.',
      'Wait time was short and the consultation did not feel rushed. Prescription was written out in detail.',
      'Good diagnosis — the rash cleared up in four days with the plan I was given.',
      'Very patient with my questions about side effects. Would book again.',
      'Helpful video consult, connection was stable and the doctor shared a written summary afterwards.',
      'Professional and thorough. Slightly pricey but worth it for the clarity I got.',
    ],
    distribution: [92, 24, 7, 2, 1],
  },
  {
    comments: [
      'Took the time to look at my reports and adjusted my dosage. Follow-up scheduled before I left.',
      'Kind and reassuring, especially with my son who was nervous. Vaccination was painless.',
      'Straightforward advice, no upselling. I appreciated the honesty about what was not needed.',
      'Billing was transparent and the clinic was clean and organised.',
      'Connectivity dropped once mid-call but the doctor rejoined immediately.',
    ],
    distribution: [110, 26, 5, 2, 0],
  },
];

const cancellationReasons = [
  'Work conflict',
  'Feeling better',
  'Found another time',
  'Travel plans changed',
  'Doctor asked me to reschedule',
  'Emergency at home',
];

export type MockStore = ReturnType<typeof createMockStore>;

/**
 * Build the whole in-memory dataset. `now` is injectable so tests can pin the
 * clock; the apps use the real one.
 */
export function createMockStore(options: { now?: () => number } = {}) {
  const now = options.now ?? (() => Date.now());
  const createdAtMs = now() - 200 * DAY_MS;

  const doctors = new Map<string, SeedDoctor>();
  const profiles = new Map<string, DoctorProfile>();
  const rules = new Map<string, AvailabilityRule[]>();
  const exceptions = new Map<string, AvailabilityException[]>();
  const calendarAccounts = new Map<string, CalendarAccount[]>();

  for (const doctor of seedDoctors) {
    doctors.set(doctor.id, doctor);
    profiles.set(doctor.id, buildDoctorProfile(doctor, createdAtMs));
    rules.set(doctor.id, buildRules(doctor, createdAtMs));
    exceptions.set(doctor.id, []);
    const accounts: CalendarAccount[] = [];
    if (doctor.calendarProvider) {
      accounts.push({
        id: `cal_${doctor.id}`,
        doctor_id: doctor.id,
        provider: doctor.calendarProvider,
        account_email: doctor.calendarEmail ?? 'calendar@example.com',
        status: doctor.calendarStatus,
        last_synced_at: new Date(now() - 2 * MINUTE_MS).toISOString(),
        busy_events_90d: 40 + doctor.experienceYears * 3,
        conflicts_open: doctor.id === 'doc_nikhil' || doctor.id === 'doc_arjun' ? 1 : 0,
        connected_at: new Date(createdAtMs - 60 * DAY_MS).toISOString(),
      });
    }
    calendarAccounts.set(doctor.id, accounts);
  }

  // A leave two weeks out for every other doctor, so the doctor app's exception
  // editor and the "resolution list" have something real to show.
  seedDoctors.forEach((doctor, index) => {
    if (index % 2 !== 0) return;
    const date = addDaysToDate(dateInZone(now(), doctor.clinicTimezone), 14);
    const startUtc = wallTimeToUtc(date, '10:00', doctor.clinicTimezone);
    exceptions.get(doctor.id)?.push({
      id: `exc_${doctor.id}_leave`,
      doctor_id: doctor.id,
      start_utc: toIso(startUtc),
      end_utc: toIso(startUtc + 3 * HOUR_MS),
      kind: 'leave',
      reason: 'Annual leave',
      created_at: new Date(createdAtMs).toISOString(),
      affected_appointments: [],
    });
  });

  const reviews = new Map<string, Review[]>();
  seedDoctors.forEach((doctor, index) => {
    const pool = reviewPools[index % reviewPools.length]!;
    const count = Math.min(6, pool.comments.length);
    const list: Review[] = Array.from({ length: count }).map((_, reviewIndex) => ({
      id: `rev_${doctor.id}_${reviewIndex}`,
      appointment_id: `apt_past_${doctor.id}_${reviewIndex}`,
      doctor_id: doctor.id,
      patient_display_name: ['Priya S.', 'Rohit K.', 'Meera J.', 'Daniel A.', 'Sunita M.', 'Aarav S.'][reviewIndex % 6]!,
      rating: (reviewIndex % 5 === 4 ? 4 : 5) as 1 | 2 | 3 | 4 | 5,
      comment: pool.comments[reviewIndex] ?? null,
      created_at: new Date(now() - (reviewIndex + 3) * 9 * DAY_MS).toISOString(),
      verified_visit: true,
      status: 'published',
    }));
    reviews.set(doctor.id, list);
  });

  const appointments: Appointment[] = [];
  const holds: Hold[] = [];
  const notifications: AppNotification[] = [];
  const savedDoctorIds = new Set<string>([`doc_arjun`, `doc_ananya`]);
  const seenDoctorIds = new Set<string>(['doc_arjun', 'doc_sameer']);

  const patient: PatientProfile = {
    user_id: PATIENT_USER_ID,
    display_name: 'Priya Sharma',
    phone: '+919812345678',
    email: 'priya.sharma@example.com',
    gender: 'female',
    dob: '1992-04-18',
    default_timezone: 'Asia/Kolkata',
    emergency_contact: '+919898765432',
    created_at: new Date(createdAtMs).toISOString(),
  };

  const dependents: Dependent[] = [
    {
      id: 'dep_aarav',
      guardian_user_id: PATIENT_USER_ID,
      name: 'Aarav Sharma',
      relationship: 'son',
      dob: '2019-06-02',
      gender: 'male',
      notes: 'Peanut allergy — carries an inhaler.',
      is_active: true,
    },
    {
      id: 'dep_sunita',
      guardian_user_id: PATIENT_USER_ID,
      name: 'Sunita Sharma',
      relationship: 'parent',
      dob: '1958-01-27',
      gender: 'female',
      notes: 'Type 2 diabetes, on metformin.',
      is_active: true,
    },
  ];

  let preferences: NotificationPreference = {
    user_id: PATIENT_USER_ID,
    phone: patient.phone,
    email: patient.email,
    entries: (
      [
        ['booking', true, true, false, false],
        ['approval', true, true, false, false],
        ['reminder', true, true, true, false],
        ['join_window', true, false, false, false],
        ['reschedule', true, true, true, true],
        ['cancellation', true, true, true, true],
        ['payment', true, true, false, false],
        ['calendar', true, false, false, false],
        ['verification', true, true, false, false],
        ['security', true, true, false, true],
        ['review', true, false, false, false],
      ] as const
    ).map(([category, push, email, sms, critical]) => ({
      category,
      push,
      email,
      sms,
      critical,
    })),
    quiet_hours: { enabled: true, start: '22:00', end: '07:00' },
  };

  return {
    now,
    createdAtMs,
    doctors,
    profiles,
    rules,
    exceptions,
    calendarAccounts,
    reviews,
    appointments,
    holds,
    notifications,
    savedDoctorIds,
    seenDoctorIds,
    patient,
    dependents,
    preferences,
    setPreferences(next: NotificationPreference) {
      preferences = next;
    },
    getPreferences() {
      return preferences;
    },
  };
}

/* ------------------------------------------------------------- slot helpers */

/** Default availability window: today → +21 clinic days. */
function clinicDateRange(
  store: MockStore,
  doctor: SeedDoctor,
  fromDate?: string,
  toDate?: string,
): { from: string; to: string } {
  const today = dateInZone(store.now(), doctor.clinicTimezone);
  return {
    from: fromDate ?? today,
    to: toDate ?? addDaysToDate(today, 21),
  };
}

function engineInputFor(
  store: MockStore,
  doctor: SeedDoctor,
  consultType: 'in_person' | 'video',
  range: { from: string; to: string },
  options: { excludeAppointmentId?: string; mineUserIds?: string[] } = {},
) {
  const profile = store.profiles.get(doctor.id)!;
  const ruleRows = (store.rules.get(doctor.id) ?? []).filter((rule) => rule.consult_types.includes(consultType));
  const engineRules: SlotEngineRule[] = ruleRows.map((rule) => ({
    weekday: rule.weekday,
    startLocalTime: rule.start_local_time,
    endLocalTime: rule.end_local_time,
    slotMinutes: rule.slot_minutes,
    bufferMinutes: rule.buffer_minutes,
    consultTypes: rule.consult_types,
    effectiveFrom: rule.effective_from,
  }));

  const nowMs = store.now();
  const activeAppointments = store.appointments.filter(
    (appointment) =>
      appointment.doctor_id === doctor.id &&
      appointment.id !== options.excludeAppointmentId &&
      ['held', 'pending_approval', 'confirmed', 'in_progress'].includes(appointment.status),
  );

  const busy: SlotBusyInterval[] = activeAppointments.map((appointment) => ({
    startUtc: appointment.start_utc,
    endUtc: appointment.end_utc,
    source: 'appointment',
  }));

  // Simulated external calendar busy time, one event per clinic day that has
  // rules — deterministic per doctor so screenshots are stable.
  const accounts = store.calendarAccounts.get(doctor.id) ?? [];
  if (accounts.some((account) => account.status === 'connected')) {
    for (let offset = 0; offset <= 21; offset += 1) {
      const date = addDaysToDate(range.from, offset);
      const dayStart = wallTimeToUtc(date, '00:00', doctor.clinicTimezone);
      for (const interval of externalBusyFor(doctor, dayStart)) {
        busy.push({ ...interval, source: 'calendar' });
      }
    }
  }

  for (const hold of store.holds) {
    if (hold.status !== 'active' || hold.doctor_id !== doctor.id) continue;
    // A patient's own hold is theirs to convert — it must not hide the slot from them.
    if (hold.patient_user_id === PATIENT_USER_ID) continue;
    if (fromIso(hold.expires_at) <= nowMs) continue;
    busy.push({ startUtc: hold.start_utc, endUtc: hold.end_utc, source: 'hold' });
  }

  const fee = profile.consultation_config.fees.find((entry) => entry.consult_type === consultType);
  const mineStartUtcs =
    options.mineUserIds && options.mineUserIds.length > 0
      ? store.appointments
          .filter((appointment) => options.mineUserIds!.includes(appointment.patient_user_id))
          .map((appointment) => appointment.start_utc)
      : [];

  return {
    timeZone: doctor.clinicTimezone,
    rules: engineRules,
    exceptions: (store.exceptions.get(doctor.id) ?? []).map((exception) => ({
      startUtc: exception.start_utc,
      endUtc: exception.end_utc,
      kind: exception.kind,
    })),
    busy,
    fromDate: range.from,
    toDate: range.to,
    consultType,
    durationMinutes: fee?.duration_minutes ?? defaultPlatformConfig.default_duration_minutes[consultType],
    feeMinor: fee?.fee_minor ?? 0,
    currency: profile.consultation_config.fees[0]?.currency ?? 'INR',
    nowMs,
    minNoticeMinutes: profile.policy.min_notice_minutes,
    bookingWindowDays: profile.policy.booking_window_days,
    bufferMinutes: profile.policy.buffer_minutes,
    mineStartUtcs,
  };
}

function expandFor(
  store: MockStore,
  doctor: SeedDoctor,
  consultType: 'in_person' | 'video',
  range: { from: string; to: string },
  options: { excludeAppointmentId?: string; mineUserIds?: string[] } = {},
) {
  return expandSlots(engineInputFor(store, doctor, consultType, range, options));
}

/** First open slot for a doctor/type across the next `days` days. */
function firstOpenSlot(
  store: MockStore,
  doctorId: string,
  consultType: 'in_person' | 'video',
  options: { minDaysAhead?: number; requireWeekday?: number[]; excludeStartUtc?: string } = {},
): Slot | null {
  const doctor = store.doctors.get(doctorId);
  if (!doctor) return null;
  const range = clinicDateRange(store, doctor);
  const result = expandFor(store, doctor, consultType, range);
  const minMs = store.now() + (options.minDaysAhead ?? 0) * DAY_MS;
  for (const day of result.days) {
    if (options.requireWeekday && !options.requireWeekday.includes(weekdayOf(day.date))) continue;
    for (const slot of day.slots) {
      if (slot.status !== 'available') continue;
      if (fromIso(slot.start_utc) < minMs) continue;
      if (options.excludeStartUtc && slot.start_utc === options.excludeStartUtc) continue;
      return slot;
    }
  }
  return null;
}

function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay();
}

/** Slots in the past are seeded directly; no availability maths required. */
function pastSlot(store: MockStore, doctor: SeedDoctor, daysAgo: number, localTime: string, durationMinutes: number) {
  const today = dateInZone(store.now(), doctor.clinicTimezone);
  const date = addDaysToDate(today, -daysAgo);
  const startMs = wallTimeToUtc(date, localTime, doctor.clinicTimezone);
  return { startUtc: toIso(startMs), endUtc: toIso(startMs + durationMinutes * MINUTE_MS) };
}

/** `MB-8H2K4` — FNV-1a over the seed so codes are stable but look random. */
function codeFor(seed: number): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let hash = 2166136261 ^ Math.imul(seed + 1, 16777619);
  let out = '';
  for (let index = 0; index < 5; index += 1) {
    hash ^= hash << 13;
    hash ^= hash >>> 17;
    hash ^= hash << 5;
    hash = hash >>> 0;
    out += alphabet[hash % alphabet.length]!;
  }
  return `MB-${out}`;
}

/* --------------------------------------------------------------- seeding */

/**
 * Seed appointments *after* the store exists so they land on real slots. Called
 * lazily on first API access (a store built for tests can also call it directly).
 */
export function seedAppointments(store: MockStore): void {
  if (store.appointments.length > 0) return;
  const nowMs = store.now();

  const push = (
    partial: Omit<
      Appointment,
      'id' | 'code' | 'created_at' | 'updated_at' | 'payment' | 'refund' | 'review_id' | 'reschedule_of_id' | 'reschedule_count'
    > & { id: string; payment?: Payment | null },
  ) => {
    const doctor = store.doctors.get(partial.doctor_id)!;
    const profile = store.profiles.get(partial.doctor_id)!;
    const fee = profile.consultation_config.fees.find((entry) => entry.consult_type === partial.consult_type);
    const appointment: Appointment = {
      ...partial,
      code: codeFor(store.appointments.length + 7),
      payment: partial.payment ?? null,
      refund: null,
      review_id: null,
      reschedule_of_id: null,
      reschedule_count: 0,
      created_at: new Date(nowMs - 6 * DAY_MS).toISOString(),
      updated_at: new Date(nowMs - 6 * DAY_MS).toISOString(),
    };
    if (appointment.fee_minor === 0) appointment.fee_minor = fee?.fee_minor ?? 0;
    if (!appointment.currency) appointment.currency = doctor.currency;
    store.appointments.push(appointment);
    return appointment;
  };

  const patientName = store.patient.display_name;

  // Upcoming (confirmed) — arjun, in-clinic
  const arjunSlot = firstOpenSlot(store, 'doc_arjun', 'in_person', { minDaysAhead: 1 });
  if (arjunSlot) {
    const doctor = store.doctors.get('doc_arjun')!;
    const profile = store.profiles.get('doc_arjun')!;
    push({
      id: 'apt_up_arjun',
      patient_user_id: PATIENT_USER_ID,
      patient_name: patientName,
      dependent_id: null,
      dependent_name: null,
      for_name: patientName,
      doctor_id: doctor.id,
      doctor_name: doctor.name,
      doctor_specialty: primarySpecialty(doctor),
      doctor_timezone: doctor.clinicTimezone,
      consult_type: 'in_person',
      start_utc: arjunSlot.start_utc,
      end_utc: arjunSlot.end_utc,
      status: 'confirmed',
      cancelled_by: null,
      cancel_reason: null,
      fee_minor: arjunSlot.fee_minor,
      currency: arjunSlot.currency,
      clinic_name: profile.clinic_name,
      clinic_address: profile.clinic_address,
      join_url: null,
      patient_note: 'Recurring rash on the left forearm — third episode this year.',
      payment: makePayment('apt_up_arjun', 'captured', arjunSlot.fee_minor, arjunSlot.currency, 'card', nowMs),
    });
  }

  // Upcoming (confirmed) — ananya, video, for the son
  const ananyaSlot = firstOpenSlot(store, 'doc_ananya', 'video', { minDaysAhead: 2 });
  if (ananyaSlot) {
    const doctor = store.doctors.get('doc_ananya')!;
    const profile = store.profiles.get('doc_ananya')!;
    const dependent = store.dependents[0]!;
    push({
      id: 'apt_up_ananya',
      patient_user_id: PATIENT_USER_ID,
      patient_name: patientName,
      dependent_id: dependent.id,
      dependent_name: dependent.name,
      for_name: dependent.name,
      doctor_id: doctor.id,
      doctor_name: doctor.name,
      doctor_specialty: primarySpecialty(doctor),
      doctor_timezone: doctor.clinicTimezone,
      consult_type: 'video',
      start_utc: ananyaSlot.start_utc,
      end_utc: ananyaSlot.end_utc,
      status: 'confirmed',
      cancelled_by: null,
      cancel_reason: null,
      fee_minor: ananyaSlot.fee_minor,
      currency: ananyaSlot.currency,
      clinic_name: null,
      clinic_address: null,
      join_url: 'medibook://consult/apt_up_ananya',
      patient_note: 'Persistent night cough for two weeks.',
      payment: makePayment('apt_up_ananya', 'captured', ananyaSlot.fee_minor, ananyaSlot.currency, 'upi', nowMs),
    });
  }

  // Manual-approval doctor — exercises the "Pending approval" queue (R13)
  const nikhilSlot = firstOpenSlot(store, 'doc_nikhil', 'video', { minDaysAhead: 1 });
  if (nikhilSlot) {
    const doctor = store.doctors.get('doc_nikhil')!;
    const profile = store.profiles.get('doc_nikhil')!;
    push({
      id: 'apt_pending_nikhil',
      patient_user_id: PATIENT_USER_ID,
      patient_name: patientName,
      dependent_id: store.dependents[1]!.id,
      dependent_name: store.dependents[1]!.name,
      for_name: store.dependents[1]!.name,
      doctor_id: doctor.id,
      doctor_name: doctor.name,
      doctor_specialty: primarySpecialty(doctor),
      doctor_timezone: doctor.clinicTimezone,
      consult_type: 'video',
      start_utc: nikhilSlot.start_utc,
      end_utc: nikhilSlot.end_utc,
      status: 'pending_approval',
      cancelled_by: null,
      cancel_reason: null,
      fee_minor: nikhilSlot.fee_minor,
      currency: nikhilSlot.currency,
      clinic_name: null,
      clinic_address: null,
      join_url: 'medibook://consult/apt_pending_nikhil',
      patient_note: 'Reviewing blood pressure readings from the last month.',
      payment: makePayment('apt_pending_nikhil', 'authorized', nikhilSlot.fee_minor, nikhilSlot.currency, 'card', nowMs),
    });
  }

  // Past visits — completed / cancelled / no-show, for the Past tab + reviews
  const arjun = store.doctors.get('doc_arjun')!;
  const sameer = store.doctors.get('doc_sameer')!;
  const kavya = store.doctors.get('doc_kavya')!;
  const rohan = store.doctors.get('doc_rohan')!;
  const marcus = store.doctors.get('doc_marcus')!;

  const pastDefinitions: Array<{
    id: string;
    doctor: SeedDoctor;
    consultType: 'in_person' | 'video';
    daysAgo: number;
    localTime: string;
    status: Appointment['status'];
    dependentIndex?: number;
    review?: { rating: 1 | 2 | 3 | 4 | 5; comment: string };
    cancelReason?: string;
    paymentStatus: 'captured' | 'refunded';
  }> = [
    {
      id: 'apt_past_arjun_0',
      doctor: arjun,
      consultType: 'in_person',
      daysAgo: 12,
      localTime: '10:20',
      status: 'completed',
      review: {
        rating: 5,
        comment:
          'Explained the treatment clearly and did not push unnecessary tests. Follow-up was quick over chat.',
      },
      paymentStatus: 'captured',
    },
    {
      id: 'apt_past_sameer_0',
      doctor: sameer,
      consultType: 'in_person',
      daysAgo: 26,
      localTime: '11:20',
      status: 'completed',
      paymentStatus: 'captured',
    },
    {
      id: 'apt_past_kavya_0',
      doctor: kavya,
      consultType: 'video',
      daysAgo: 9,
      localTime: '09:00',
      status: 'cancelled',
      cancelReason: 'Work conflict',
      paymentStatus: 'refunded',
    },
    {
      id: 'apt_past_rohan_0',
      doctor: rohan,
      consultType: 'in_person',
      daysAgo: 44,
      localTime: '16:30',
      status: 'no_show',
      paymentStatus: 'captured',
    },
    {
      id: 'apt_past_ananya_0',
      doctor: store.doctors.get('doc_ananya')!,
      consultType: 'video',
      daysAgo: 33,
      localTime: '11:20',
      status: 'completed',
      dependentIndex: 0,
      review: { rating: 5, comment: 'Very patient with my son who was nervous. Vaccination was painless.' },
      paymentStatus: 'captured',
    },
    {
      id: 'apt_past_fatima_0',
      doctor: store.doctors.get('doc_fatima')!,
      consultType: 'video',
      daysAgo: 51,
      localTime: '08:15',
      status: 'completed',
      review: { rating: 4, comment: 'Unhurried session and practical coping strategies.' },
      paymentStatus: 'captured',
    },
    {
      id: 'apt_past_marcus_0',
      doctor: marcus,
      consultType: 'video',
      daysAgo: 17,
      localTime: '18:00',
      status: 'completed',
      paymentStatus: 'captured',
    },
  ];

  for (const definition of pastDefinitions) {
    const profile = store.profiles.get(definition.doctor.id)!;
    const feeEntry = profile.consultation_config.fees.find(
      (entry) => entry.consult_type === definition.consultType,
    );
    const slot = pastSlot(
      store,
      definition.doctor,
      definition.daysAgo,
      definition.localTime,
      feeEntry?.duration_minutes ?? 20,
    );
    const dependent = definition.dependentIndex !== undefined ? store.dependents[definition.dependentIndex] : undefined;
    const appointment = push({
      id: definition.id,
      patient_user_id: PATIENT_USER_ID,
      patient_name: patientName,
      dependent_id: dependent?.id ?? null,
      dependent_name: dependent?.name ?? null,
      for_name: dependent?.name ?? patientName,
      doctor_id: definition.doctor.id,
      doctor_name: definition.doctor.name,
      doctor_specialty: primarySpecialty(definition.doctor),
      doctor_timezone: definition.doctor.clinicTimezone,
      consult_type: definition.consultType,
      start_utc: slot.startUtc,
      end_utc: slot.endUtc,
      status: definition.status,
      cancelled_by: definition.status === 'cancelled' ? 'patient' : null,
      cancel_reason: definition.cancelReason ?? null,
      fee_minor: feeEntry?.fee_minor ?? 0,
      currency: feeEntry?.currency ?? 'INR',
      clinic_name: definition.consultType === 'in_person' ? profile.clinic_name : null,
      clinic_address: definition.consultType === 'in_person' ? profile.clinic_address : null,
      join_url: definition.consultType === 'video' ? `medibook://consult/${definition.id}` : null,
      patient_note: null,
      payment: makePayment(
        definition.id,
        definition.paymentStatus,
        feeEntry?.fee_minor ?? 0,
        feeEntry?.currency ?? 'INR',
        'card',
        nowMs,
      ),
    });

    if (definition.review) {
      const review: Review = {
        id: `rev_${definition.id}`,
        appointment_id: definition.id,
        doctor_id: definition.doctor.id,
        patient_display_name: patientName,
        rating: definition.review.rating,
        comment: definition.review.comment,
        created_at: new Date(fromIso(slot.endUtc) + 2 * HOUR_MS).toISOString(),
        verified_visit: true,
        status: 'published',
      };
      appointment.review_id = review.id;
      const existing = store.reviews.get(definition.doctor.id) ?? [];
      store.reviews.set(definition.doctor.id, [review, ...existing]);
    }

    if (definition.status === 'cancelled') {
      appointment.refund = {
        id: `ref_${definition.id}`,
        payment_id: `pay_${definition.id}`,
        amount_minor: appointment.payment?.amount_minor ?? 0,
        currency: appointment.currency,
        reason: definition.cancelReason ?? 'Cancelled by patient',
        tier_percent: 100,
        status: 'completed',
        created_at: new Date(fromIso(slot.startUtc) - 26 * HOUR_MS).toISOString(),
      };
    }
  }

  seedDoctorRoster(store);
  seedNotifications(store);
}

function primarySpecialty(doctor: SeedDoctor): string {
  const slug = doctor.specializationSlugs[0];
  return specializations.find((specialization) => specialization.slug === slug)?.name ?? 'Specialist';
}

function makePayment(
  appointmentId: string,
  status: Payment['status'],
  amountMinor: number,
  currency: string,
  method: PaymentMethod,
  createdMs: number,
): Payment {
  return {
    id: `pay_${appointmentId}`,
    appointment_id: appointmentId,
    method,
    amount_minor: amountMinor,
    currency,
    status,
    provider_ref: `mock_${appointmentId}`,
    receipt_url: `https://receipts.medibook.example/${appointmentId}.pdf`,
    created_at: new Date(createdMs).toISOString(),
  };
}

function seedNotifications(store: MockStore): void {
  const nowMs = store.now();
  const upcoming = store.appointments.filter((appointment) => appointment.patient_user_id === PATIENT_USER_ID);
  const list: AppNotification[] = [
    {
      id: 'ntf_1',
      user_id: PATIENT_USER_ID,
      category: 'booking',
      channel: 'push',
      title: 'Appointment confirmed',
      body: 'Your appointment is confirmed. Tap for details.',
      deeplink: '/appointments',
      appointment_id: upcoming[0]?.id ?? null,
      read_at: null,
      sent_at: new Date(nowMs - 2 * HOUR_MS).toISOString(),
      created_at: new Date(nowMs - 2 * HOUR_MS).toISOString(),
    },
    {
      id: 'ntf_2',
      user_id: PATIENT_USER_ID,
      category: 'reminder',
      channel: 'push',
      title: 'Reminder: appointment tomorrow',
      body: 'Bring your previous prescriptions and reports.',
      deeplink: '/appointments',
      appointment_id: upcoming[1]?.id ?? null,
      read_at: null,
      sent_at: new Date(nowMs - 20 * HOUR_MS).toISOString(),
      created_at: new Date(nowMs - 20 * HOUR_MS).toISOString(),
    },
    {
      id: 'ntf_3',
      user_id: PATIENT_USER_ID,
      category: 'payment',
      channel: 'email',
      title: 'Receipt for your consultation',
      body: 'Your receipt is attached. No action needed.',
      deeplink: '/appointments',
      appointment_id: upcoming[0]?.id ?? null,
      read_at: new Date(nowMs - 30 * HOUR_MS).toISOString(),
      sent_at: new Date(nowMs - 32 * HOUR_MS).toISOString(),
      created_at: new Date(nowMs - 32 * HOUR_MS).toISOString(),
    },
    {
      id: 'ntf_4',
      user_id: PATIENT_USER_ID,
      category: 'review',
      channel: 'push',
      title: 'How was your visit?',
      body: 'Rate your completed consultation to help other patients.',
      deeplink: '/appointments',
      appointment_id: 'apt_past_sameer_0',
      read_at: null,
      sent_at: new Date(nowMs - 3 * DAY_MS).toISOString(),
      created_at: new Date(nowMs - 3 * DAY_MS).toISOString(),
    },
    {
      id: 'ntf_5',
      user_id: PATIENT_USER_ID,
      category: 'cancellation',
      channel: 'sms',
      title: 'Appointment cancelled',
      body: 'Your refund is being processed. Rebook in one tap.',
      deeplink: '/appointments',
      appointment_id: 'apt_past_kavya_0',
      read_at: new Date(nowMs - 8 * DAY_MS).toISOString(),
      sent_at: new Date(nowMs - 9 * DAY_MS).toISOString(),
      created_at: new Date(nowMs - 9 * DAY_MS).toISOString(),
    },
  ];
  store.notifications.push(...list);

  // Doctor-side inbox
  const todayAppointments = store.appointments.filter((appointment) => appointment.doctor_id === DOCTOR_USER_ID);
  store.notifications.push({
    id: 'ntf_doc_1',
    user_id: DOCTOR_USER_ID,
    category: 'booking',
    channel: 'push',
    title: 'New booking',
    body: `${todayAppointments[0]?.for_name ?? 'A patient'} booked a consultation.`,
    deeplink: '/appointments',
    appointment_id: todayAppointments[0]?.id ?? null,
    read_at: null,
    sent_at: new Date(nowMs - 40 * MINUTE_MS).toISOString(),
    created_at: new Date(nowMs - 40 * MINUTE_MS).toISOString(),
  });
  store.notifications.push({
    id: 'ntf_doc_2',
    user_id: DOCTOR_USER_ID,
    category: 'calendar',
    channel: 'push',
    title: 'Calendar conflict detected',
    body: 'An external event overlaps one of your confirmed appointments.',
    deeplink: '/today',
    appointment_id: null,
    read_at: null,
    sent_at: new Date(nowMs - 3 * HOUR_MS).toISOString(),
    created_at: new Date(nowMs - 3 * HOUR_MS).toISOString(),
  });
}

/**
 * Seed the signed-in doctor's roster.
 *
 * Appointments are placed on *real* engine output for the current clock, so the
 * doctor app always shows a believable day: today's earlier visits as completed /
 * no-show / cancelled, today's still-bookable slots as confirmed / awaiting
 * approval, and a deeper history behind them. Nothing is invented that the slot
 * engine would not allow.
 */
function seedDoctorRoster(store: MockStore): void {
  const doctor = store.doctors.get(DOCTOR_USER_ID);
  const profile = store.profiles.get(DOCTOR_USER_ID);
  if (!doctor || !profile) return;

  const nowMs = store.now();
  const today = dateInZone(nowMs, doctor.clinicTimezone);
  const tomorrow = addDaysToDate(today, 1);

  const feeFor = (consultType: 'in_person' | 'video') =>
    profile.consultation_config.fees.find((item) => item.consult_type === consultType);

  /** All of today's grid, ignoring the min-notice filter, so past visits exist. */
  const todayGrid = expandSlots({
    ...engineInputFor(store, doctor, 'in_person', { from: today, to: today }),
    nowMs: wallTimeToUtc(today, '00:00', doctor.clinicTimezone),
    minNoticeMinutes: 0,
    mineStartUtcs: [],
  });
  const videoGrid = expandSlots({
    ...engineInputFor(store, doctor, 'video', { from: today, to: today }),
    nowMs: wallTimeToUtc(today, '00:00', doctor.clinicTimezone),
    minNoticeMinutes: 0,
    mineStartUtcs: [],
  });

  const todaySlots = todayGrid.days[0]?.slots ?? [];
  const videoSlots = videoGrid.days[0]?.slots ?? [];
  const pastSlots = todaySlots.filter((slot) => fromIso(slot.start_utc) + 20 * MINUTE_MS < nowMs);
  const openToday = openSlots(expandFor(store, doctor, 'in_person', { from: today, to: today }));
  const openVideoToday = openSlots(expandFor(store, doctor, 'video', { from: today, to: today }));

  const push = (input: {
    id: string;
    patientUserId: string;
    name: string;
    slot: Slot;
    consultType: 'in_person' | 'video';
    status: Appointment['status'];
    note: string | null;
    codeSeed: number;
  }) => {
    const fee = feeFor(input.consultType);
    store.appointments.push({
      id: input.id,
      code: codeFor(input.codeSeed),
      patient_user_id: input.patientUserId,
      patient_name: input.name,
      dependent_id: null,
      dependent_name: null,
      for_name: input.name,
      doctor_id: doctor.id,
      doctor_name: doctor.name,
      doctor_specialty: primarySpecialty(doctor),
      doctor_timezone: doctor.clinicTimezone,
      consult_type: input.consultType,
      start_utc: input.slot.start_utc,
      end_utc: input.slot.end_utc,
      status: input.status,
      cancelled_by: input.status === 'cancelled' ? 'patient' : null,
      cancel_reason: input.status === 'cancelled' ? 'Travel plans changed' : null,
      reschedule_of_id: null,
      reschedule_count: 0,
      fee_minor: fee?.fee_minor ?? 0,
      currency: fee?.currency ?? doctor.currency,
      clinic_name: input.consultType === 'in_person' ? profile.clinic_name : null,
      clinic_address: input.consultType === 'in_person' ? profile.clinic_address : null,
      join_url: input.consultType === 'video' ? `medibook://consult/${input.id}` : null,
      patient_note: input.note,
      payment: makePayment(
        input.id,
        'captured',
        fee?.fee_minor ?? 0,
        fee?.currency ?? doctor.currency,
        'card',
        nowMs,
      ),
      refund: null,
      review_id: null,
      created_at: new Date(nowMs - 4 * DAY_MS).toISOString(),
      updated_at: new Date(nowMs).toISOString(),
    });
  };

  // --- today, already finished ---------------------------------------------
  const finished: Array<{ id: string; name: string; status: Appointment['status']; note: string | null }> = [
    { id: 'usr_rohit', name: 'Rohit Kumar', status: 'completed', note: 'Acne follow-up after 6 weeks of treatment.' },
    { id: 'usr_daniel', name: 'Daniel Albuquerque', status: 'completed', note: null },
    { id: 'usr_meera', name: 'Meera Joshi', status: 'no_show', note: 'Patchy hair loss on the crown since March.' },
  ];
  finished.forEach((entry, index) => {
    const slot = pastSlots[index];
    if (!slot) return;
    push({
      id: `apt_roster_${entry.id}`,
      patientUserId: entry.id,
      name: entry.name,
      slot,
      consultType: 'in_person',
      status: entry.status,
      note: entry.note,
      codeSeed: 500 + index,
    });
  });

  // --- today, still ahead (respects the doctor's 2h min notice) -------------
  const ahead: Array<{ id: string; name: string; status: Appointment['status']; note: string | null }> = [
    { id: 'usr_imran', name: 'Imran Qureshi', status: 'confirmed', note: 'Mole check — asymmetric border noticed.' },
    { id: 'usr_sneha', name: 'Sneha Pillai', status: 'pending_approval', note: 'Second opinion on a biopsy report.' },
  ];
  ahead.forEach((entry, index) => {
    const slot = openToday[index];
    if (!slot) return;
    push({
      id: `apt_roster_${entry.id}`,
      patientUserId: entry.id,
      name: entry.name,
      slot,
      consultType: 'in_person',
      status: entry.status,
      note: entry.note,
      codeSeed: 520 + index,
    });
  });

  // --- a live video consult, only when the clock is actually inside one -----
  const live = videoSlots.find(
    (slot) => nowMs >= fromIso(slot.start_utc) && nowMs <= fromIso(slot.end_utc) + 5 * MINUTE_MS,
  );
  if (live) {
    push({
      id: 'apt_roster_usr_nandini',
      patientUserId: 'usr_nandini',
      name: 'Nandini Rao',
      slot: live,
      consultType: 'video',
      status: 'in_progress',
      note: 'Eczema flare-up on both hands.',
      codeSeed: 540,
    });
  } else {
    const slot = openVideoToday[0];
    if (slot) {
      push({
        id: 'apt_roster_usr_nandini',
        patientUserId: 'usr_nandini',
        name: 'Nandini Rao',
        slot,
        consultType: 'video',
        status: 'confirmed',
        note: 'Eczema flare-up on both hands.',
        codeSeed: 540,
      });
    }
  }

  // --- tomorrow ------------------------------------------------------------
  const tomorrowSlots = openSlots(expandFor(store, doctor, 'in_person', { from: tomorrow, to: tomorrow }));
  const tomorrowVideo = openSlots(expandFor(store, doctor, 'video', { from: tomorrow, to: tomorrow }));
  if (tomorrowSlots[0]) {
    push({
      id: 'apt_roster_usr_sunita_m',
      patientUserId: 'usr_sunita_m',
      name: 'Sunita Mathew',
      slot: tomorrowSlots[0],
      consultType: 'in_person',
      status: 'confirmed',
      note: null,
      codeSeed: 560,
    });
  }
  if (tomorrowVideo[0]) {
    push({
      id: 'apt_roster_usr_arif',
      patientUserId: 'usr_arif',
      name: 'Arif Khan',
      slot: tomorrowVideo[0],
      consultType: 'video',
      status: 'confirmed',
      note: 'Psoriasis review, on methotrexate.',
      codeSeed: 561,
    });
  }

  // Manual-approval mode (R13) needs a standing request to act on, whatever
  // time of day the demo is run.
  if (tomorrowSlots[1]) {
    push({
      id: 'apt_roster_usr_jaya',
      patientUserId: 'usr_jaya',
      name: 'Jaya Nair',
      slot: tomorrowSlots[1],
      consultType: 'in_person',
      status: 'pending_approval',
      note: 'Requesting a full-body skin check.',
      codeSeed: 562,
    });
  }

  // --- history ------------------------------------------------------------
  const history: Array<{
    id: string;
    name: string;
    daysAgo: number;
    status: Appointment['status'];
    consultType: 'in_person' | 'video';
  }> = [
    { id: 'usr_rohit', name: 'Rohit Kumar', daysAgo: 21, status: 'completed', consultType: 'in_person' },
    { id: 'usr_meera', name: 'Meera Joshi', daysAgo: 35, status: 'completed', consultType: 'in_person' },
    { id: 'usr_daniel', name: 'Daniel Albuquerque', daysAgo: 14, status: 'no_show', consultType: 'in_person' },
    { id: 'usr_imran', name: 'Imran Qureshi', daysAgo: 8, status: 'cancelled', consultType: 'video' },
    { id: 'usr_nandini', name: 'Nandini Rao', daysAgo: 48, status: 'completed', consultType: 'video' },
  ];

  for (const entry of history) {
    const slot = pastSlot(
      store,
      doctor,
      entry.daysAgo,
      entry.consultType === 'video' ? '19:00' : '10:20',
      20,
    );
    const fee = feeFor(entry.consultType);
    store.appointments.push({
      id: `apt_roster_past_${entry.id}`,
      code: codeFor(700 + entry.daysAgo),
      patient_user_id: entry.id,
      patient_name: entry.name,
      dependent_id: null,
      dependent_name: null,
      for_name: entry.name,
      doctor_id: doctor.id,
      doctor_name: doctor.name,
      doctor_specialty: primarySpecialty(doctor),
      doctor_timezone: doctor.clinicTimezone,
      consult_type: entry.consultType,
      start_utc: slot.startUtc,
      end_utc: slot.endUtc,
      status: entry.status,
      cancelled_by: entry.status === 'cancelled' ? 'patient' : null,
      cancel_reason: entry.status === 'cancelled' ? 'Travel plans changed' : null,
      reschedule_of_id: null,
      reschedule_count: 0,
      fee_minor: fee?.fee_minor ?? 0,
      currency: fee?.currency ?? doctor.currency,
      clinic_name: null,
      clinic_address: null,
      join_url: null,
      patient_note: null,
      payment: makePayment(
        `apt_roster_past_${entry.id}`,
        'captured',
        fee?.fee_minor ?? 0,
        fee?.currency ?? doctor.currency,
        'card',
        nowMs,
      ),
      refund: null,
      review_id: null,
      created_at: new Date(nowMs - (entry.daysAgo + 5) * DAY_MS).toISOString(),
      updated_at: new Date(nowMs - entry.daysAgo * DAY_MS).toISOString(),
    });
  }
}

/* ------------------------------------------------------------ projections */

function summarizeDoctor(store: MockStore, doctor: SeedDoctor, viewerTz: string, nowMs: number): DoctorSummary {
  const profile = store.profiles.get(doctor.id)!;
  const fees = profile.consultation_config.fees.filter((entry) => entry.enabled);
  const cheapest = fees.reduce<number | null>(
    (min, entry) => (min === null || entry.fee_minor < min ? entry.fee_minor : min),
    null,
  );
  const enabledTypes = fees.map((entry) => entry.consult_type);

  const reviews = store.reviews.get(doctor.id) ?? [];
  const localReviews = reviews.filter((review) => review.appointment_id.startsWith('apt_up') === false);
  const reviewCount = Math.max(doctor.reviewCount, localReviews.length);
  const rating =
    localReviews.length >= 3
      ? localReviews.reduce((sum, review) => sum + review.rating, 0) / localReviews.length
      : doctor.rating;

  const nextSlot = enabledTypes.length
    ? firstOpenSlotForSummary(store, doctor.id, enabledTypes[0]!)
    : null;

  void viewerTz;
  return {
    id: doctor.id,
    name: doctor.name,
    specialties: doctor.specializationSlugs.map(
      (slug) => specializations.find((specialization) => specialization.slug === slug)?.name ?? slug,
    ),
    primary_specialization_slug: doctor.specializationSlugs[0] ?? 'general-medicine',
    experience_years: doctor.experienceYears,
    rating: Math.round(rating * 10) / 10,
    review_count: reviewCount,
    fee_minor: cheapest ?? 0,
    currency: profile.consultation_config.fees[0]?.currency ?? 'INR',
    area: doctor.area,
    languages: doctor.languages,
    gender: doctor.gender,
    verified: true,
    verification_status: 'approved',
    consultation_types: enabledTypes,
    next_slot_utc: nextSlot?.start_utc ?? null,
    is_favorite: store.savedDoctorIds.has(doctor.id),
  };
}

function firstOpenSlotForSummary(store: MockStore, doctorId: string, consultType: 'in_person' | 'video'): Slot | null {
  const cached = summarySlotCache.get(`${doctorId}:${consultType}:${Math.floor(store.now() / (10 * MINUTE_MS))}`);
  if (cached !== undefined) return cached;
  const slot = firstOpenSlot(store, doctorId, consultType);
  summarySlotCache.set(`${doctorId}:${consultType}:${Math.floor(store.now() / (10 * MINUTE_MS))}`, slot);
  return slot;
}

/** Memo for list responses — Doctort lists call `firstOpenSlot` 8 times…± // per request. */
const summarySlotCache = new Map<string, Slot | null>();

function detailFor(store: MockStore, doctor: SeedDoctor, nowMs: number): DoctorDetail {
  const summary = summarizeDoctor(store, doctor, doctor.clinicTimezone, nowMs);
  const profile = store.profiles.get(doctor.id)!;
  const reviews = (store.reviews.get(doctor.id) ?? []).filter((review) => review.status === 'published');
  const reviewSummary = buildReviewSummary(store, doctor, reviews);

  return {
    ...summary,
    bio: profile.bio,
    qualifications: profile.qualifications,
    registration_number_masked: maskRegistration(doctor.registrationNumber),
    council: doctor.council,
    clinic_name: profile.clinic_name,
    clinic_address: profile.clinic_address,
    clinic_geo: profile.clinic_geo ?? null,
    clinic_timezone: profile.clinic_timezone,
    consultation_types: profile.consultation_config.fees.filter((fee) => fee.enabled).map((fee) => fee.consult_type),
    consult_fees: profile.consultation_config.fees,
    review_summary: reviewSummary,
    reviews,
    policy: { ...profile.policy, buffer_minutes: profile.policy.buffer_minutes },
    calendar_connected: (store.calendarAccounts.get(doctor.id) ?? []).some(
      (account) => account.status === 'connected' || account.status === 'syncing',
    ),
    is_favorite: store.savedDoctorIds.has(doctor.id),
  };
}

function maskRegistration(value: string): string {
  if (value.length <= 6) return value;
  return `${value.slice(0, value.length - 4)}••••`;
}

function buildReviewSummary(store: MockStore, doctor: SeedDoctor, reviews: Review[]): ReviewSummary {
  const pool = reviewPools[doctor.experienceYears % reviewPools.length]!;
  const seeded = pool.distribution;
  const seededTotal = seeded.reduce((sum, value) => sum + value, 0);
  const distribution = [...seeded] as [number, number, number, number, number];
  for (const review of reviews) {
    const index = 5 - review.rating;
    distribution[index] = (distribution[index] ?? 0) + 1;
  }
  const extra = reviews.length;
  const total = seededTotal + extra;
  const seededAverage = seeded.reduce((sum, count, index) => sum + count * (5 - index), 0) / seededTotal;
  const extraAverage = reviews.length > 0 ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length : 0;
  const average = (seededAverage * seededTotal + extraAverage * extra) / total;
  void store;
  return { average: Math.round(average * 10) / 10, total, distribution };
}

function toAvailabilityResponse(
  store: MockStore,
  doctor: SeedDoctor,
  consultType: 'in_person' | 'video',
  query: AvailabilityQuery,
  options: { mineUserIds?: string[]; excludeAppointmentId?: string } = {},
): AvailabilityResponse {
  const nowMs = store.now();
  const requestedTz = query.tz ?? store.patient.default_timezone;
  const today = dateInZone(nowMs, doctor.clinicTimezone);
  const from = query.from ?? today;
  const to = query.to ?? addDaysToDate(from, 13);

  const result = expandFor(store, doctor, consultType, { from, to }, options);
  const accounts = store.calendarAccounts.get(doctor.id) ?? [];
  const primary = accounts[0];
  const connected = accounts.some((account) => account.status === 'connected' || account.status === 'syncing');
  const lastSyncedAt = primary?.last_synced_at ?? null;

  const days: AvailabilityDay[] = result.days.map((day) => ({
    date: day.date,
    slots: day.slots,
  }));

  return {
    doctor_id: doctor.id,
    consult_type: consultType,
    doctor_timezone: doctor.clinicTimezone,
    generated_at: new Date(nowMs).toISOString(),
    requested_timezone: requestedTz,
    calendar_sync: {
      connected,
      last_synced_at: lastSyncedAt,
      staleness: lastSyncedAt ? isoDuration(lastSyncedAt, nowMs) : null,
    },
    days,
  };
}

/* --------------------------------------------------------------- factories */

export type CreateMockApiOptions = {
  /** Inject a clock; defaults to `Date.now`. */
  now?: () => number;
  /** Shared store so the patient and doctor APIs see the same world. */
  store?: MockStore;
};

export type MockApi = {
  patient: PatientApi;
  doctor: DoctorApi;
  store: MockStore;
  reset(): void;
};

/**
 * Build a patient API + doctor API over one shared in-memory store.
 * Both satisfy the same interfaces as the HTTP client.
 */
export function createMockApi(options: CreateMockApiOptions = {}): MockApi {
  let store = options.store ?? createMockStore({ now: options.now });
  seedAppointments(store);

  const patientSession = (): AuthSession => ({
    access_token: 'mock-access-patient',
    expires_in: 900,
    refresh_token: 'mock-refresh-patient',
    user: authUserForPatient(store),
  });

  const doctorSession = (): AuthSession => ({
    access_token: 'mock-access-doctor',
    expires_in: 900,
    refresh_token: 'mock-refresh-doctor',
    user: authUserForDoctor(store),
  });

  /* ------------------------------------------------------------ patient */

  const patient: PatientApi = {
    async requestOtp(input: OtpRequest) {
      if (!input.destination || input.destination.length < 6) {
        throw apiErrors.invalid({ destination: 'Enter a valid phone number or email.' });
      }
    },

    async verifyOtp(input: OtpVerifyRequest) {
      if (input.code !== '123456' && input.code.length !== 6) {
        throw new ApiError('AUTH_OTP_INVALID', 'Enter the 6-digit code we sent you.');
      }
      return patientSession();
    },

    async refresh() {
      return patientSession();
    },

    async logout() {
      /* no server session to revoke in the mock */
    },

    async me() {
      return authUserForPatient(store);
    },

    async listSpecializations() {
      return specializations;
    },

    async listDoctors(query: DoctorQuery = {}) {
      const nowMs = store.now();
      const viewerTz = store.patient.default_timezone;
      let items = seedDoctors.map((doctor) => summarizeDoctor(store, doctor, viewerTz, nowMs));

      if (query.q) {
        const needle = query.q.trim().toLowerCase();
        items = items.filter(
          (doctor) =>
            doctor.name.toLowerCase().includes(needle) ||
            doctor.specialties.some((specialty) => specialty.toLowerCase().includes(needle)) ||
            doctor.area.toLowerCase().includes(needle),
        );
      }
      if (query.specialization) {
        items = items.filter((doctor) => doctor.primary_specialization_slug === query.specialization);
      }
      if (query.consult_type) {
        items = items.filter((doctor) => doctor.consultation_types.includes(query.consult_type!));
      }
      if (query.gender) {
        items = items.filter((doctor) => doctor.gender === query.gender);
      }
      if (query.language) {
        items = items.filter((doctor) => doctor.languages.includes(query.language!));
      }
      if (query.fee_min_minor !== undefined) {
        items = items.filter((doctor) => doctor.fee_minor >= query.fee_min_minor!);
      }
      if (query.fee_max_minor !== undefined) {
        items = items.filter((doctor) => doctor.fee_minor <= query.fee_max_minor!);
      }
      if (query.available) {
        const doctorIds = items
          .filter((doctor) => hasAvailabilityOn(store, doctor, query.available!, query.consult_type))
          .map((doctor) => doctor.id);
        items = items.filter((doctor) => doctorIds.includes(doctor.id));
      }

      switch (query.sort) {
        case 'rating':
          items = [...items].sort((a, b) => b.rating - a.rating || b.review_count - a.review_count);
          break;
        case 'fee_asc':
          items = [...items].sort((a, b) => a.fee_minor - b.fee_minor);
          break;
        case 'fee_desc':
          items = [...items].sort((a, b) => b.fee_minor - a.fee_minor);
          break;
        case 'experience':
          items = [...items].sort((a, b) => b.experience_years - a.experience_years);
          break;
        case 'next_available':
        default:
          items = [...items].sort((a, b) => {
            if (a.next_slot_utc === null && b.next_slot_utc === null) return 0;
            if (a.next_slot_utc === null) return 1;
            if (b.next_slot_utc === null) return -1;
            return a.next_slot_utc.localeCompare(b.next_slot_utc);
          });
          break;
      }

      const limit = query.limit ?? 20;
      return page(items.slice(0, limit));
    },

    async getDoctor(doctorId: string) {
      const doctor = store.doctors.get(doctorId);
      if (!doctor) throw apiErrors.notFound('Doctor', doctorId);
      return detailFor(store, doctor, store.now());
    },

    async getAvailability(doctorId: string, query: AvailabilityQuery = {}) {
      const doctor = store.doctors.get(doctorId);
      if (!doctor) throw apiErrors.notFound('Doctor', doctorId);
      const consultType = query.type ?? 'in_person';
      const profile = store.profiles.get(doctorId)!;
      if (!profile.consultation_config.fees.some((fee) => fee.consult_type === consultType && fee.enabled)) {
        throw apiErrors.invalid({ type: `This doctor does not offer ${consultType} consultations.` });
      }
      return toAvailabilityResponse(store, doctor, consultType, query, {
        mineUserIds: [PATIENT_USER_ID],
      });
    },

    async createHold(input: CreateHoldRequest) {
      const nowMs = store.now();
      const doctor = store.doctors.get(input.doctor_id);
      if (!doctor) throw apiErrors.notFound('Doctor', input.doctor_id);

      for (const hold of store.holds) {
        if (hold.status === 'active' && fromIso(hold.expires_at) <= nowMs) hold.status = 'expired';
      }
      const existing = store.holds.find(
        (hold) => hold.status === 'active' && hold.patient_user_id === PATIENT_USER_ID,
      );
      if (existing) throw apiErrors.holdActive(existing.id);

      const profile = store.profiles.get(doctor.id)!;
      const fee = profile.consultation_config.fees.find((entry) => entry.consult_type === input.consult_type);
      const range = clinicDateRange(store, doctor);
      const result = expandFor(store, doctor, input.consult_type, range, { mineUserIds: [PATIENT_USER_ID] });
      const match = result.days
        .flatMap((day) => day.slots)
        .find((slot) => slot.start_utc === input.start_utc && slot.status === 'available');

      if (!match) {
        const alternatives = nearestAlternatives(result, input.start_utc, 3);
        throw apiErrors.slotTaken(alternatives, doctor.id, input.start_utc);
      }

      const hold: Hold = {
        id: `hold_${store.holds.length + 1}_${Date.now().toString(36)}`,
        patient_user_id: PATIENT_USER_ID,
        doctor_id: doctor.id,
        consult_type: input.consult_type,
        start_utc: match.start_utc,
        end_utc: match.end_utc,
        expires_at: toIso(nowMs + defaultPlatformConfig.hold_minutes * MINUTE_MS),
        status: 'active',
      };
      store.holds.push(hold);
      return hold;
    },

    async releaseHold(holdId: string) {
      const hold = store.holds.find((candidate) => candidate.id === holdId);
      if (hold) hold.status = 'released';
    },

    async createAppointment(input: CreateAppointmentRequest, idempotencyKey: string) {
      void idempotencyKey;
      const nowMs = store.now();
      const doctor = store.doctors.get(input.doctor_id);
      if (!doctor) throw apiErrors.notFound('Doctor', input.doctor_id);
      const profile = store.profiles.get(doctor.id)!;

      const existing = store.appointments.find(
        (appointment) => appointment.status === 'held' && appointment.patient_user_id === PATIENT_USER_ID,
      );
      void existing;

      const hold = input.hold_id ? store.holds.find((candidate) => candidate.id === input.hold_id) : undefined;
      if (input.hold_id && !hold) throw apiErrors.notFound('Hold', input.hold_id);
      if (hold && hold.status !== 'active') throw apiErrors.holdExpired();
      if (hold && fromIso(hold.expires_at) <= nowMs) {
        hold.status = 'expired';
        throw apiErrors.holdExpired();
      }

      const startUtc = hold?.start_utc ?? input.start_utc;
      const range = clinicDateRange(store, doctor);
      const result = expandFor(store, doctor, input.consult_type, range, { mineUserIds: [PATIENT_USER_ID] });
      const match = result.days.flatMap((day) => day.slots).find((slot) => slot.start_utc === startUtc);

      // The single integrity gate the mock honours: one active appointment per
      // doctor per slot start, exactly like the DB partial unique index.
      const clash = store.appointments.find(
        (appointment) =>
          appointment.doctor_id === doctor.id &&
          appointment.start_utc === startUtc &&
          ['held', 'pending_approval', 'confirmed', 'in_progress'].includes(appointment.status),
      );
      if (clash || (match && match.status === 'taken')) {
        throw apiErrors.slotTaken(nearestAlternatives(result, startUtc, 3), doctor.id, startUtc);
      }
      if (!match) {
        throw apiErrors.slotTaken(nearestAlternatives(result, startUtc, 3), doctor.id, startUtc);
      }

      const fee = profile.consultation_config.fees.find((entry) => entry.consult_type === input.consult_type);
      const dependent = input.dependent_id
        ? store.dependents.find((candidate) => candidate.id === input.dependent_id)
        : undefined;
      if (input.dependent_id && !dependent) throw apiErrors.notFound('Family member', input.dependent_id);

      if (hold) hold.status = 'converted';

      const status: Appointment['status'] =
        profile.policy.approval_mode === 'manual' ? 'pending_approval' : 'confirmed';

      const appointment: Appointment = {
        id: `apt_${store.appointments.length + 1}_${Date.now().toString(36)}`,
        code: codeFor(store.appointments.length + 101),
        patient_user_id: PATIENT_USER_ID,
        patient_name: store.patient.display_name,
        dependent_id: dependent?.id ?? null,
        dependent_name: dependent?.name ?? null,
        for_name: dependent?.name ?? store.patient.display_name,
        doctor_id: doctor.id,
        doctor_name: doctor.name,
        doctor_specialty: primarySpecialty(doctor),
        doctor_timezone: doctor.clinicTimezone,
        consult_type: input.consult_type,
        start_utc: match.start_utc,
        end_utc: match.end_utc,
        status,
        cancelled_by: null,
        cancel_reason: null,
        reschedule_of_id: null,
        reschedule_count: 0,
        fee_minor: fee?.fee_minor ?? 0,
        currency: fee?.currency ?? doctor.currency,
        clinic_name: input.consult_type === 'in_person' ? profile.clinic_name : null,
        clinic_address: input.consult_type === 'in_person' ? profile.clinic_address : null,
        join_url: input.consult_type === 'video' ? `medibook://consult/${codeFor(store.appointments.length + 101)}` : null,
        patient_note: input.note ?? null,
        payment:
          (fee?.fee_minor ?? 0) > 0
            ? makePayment('pending', 'captured', fee?.fee_minor ?? 0, fee?.currency ?? 'INR', input.payment?.method ?? 'card', nowMs)
            : null,
        refund: null,
        review_id: null,
        created_at: new Date(nowMs).toISOString(),
        updated_at: new Date(nowMs).toISOString(),
      };
      if (appointment.payment) appointment.payment.appointment_id = appointment.id;
      store.appointments.push(appointment);
      notify(store, {
        user_id: PATIENT_USER_ID,
        category: status === 'pending_approval' ? 'approval' : 'booking',
        channel: 'push',
        title: status === 'pending_approval' ? 'Booking requested' : 'Appointment confirmed',
        body: `${doctor.name} · ${clockLabel(fromIso(match.start_utc), doctor.clinicTimezone)}`,
        deeplink: '/appointments',
        appointment_id: appointment.id,
      });
      notify(store, {
        user_id: doctor.id,
        category: 'booking',
        channel: 'push',
        title: status === 'pending_approval' ? 'Approval request' : 'New booking',
        body: `${appointment.for_name} · ${clockLabel(fromIso(match.start_utc), doctor.clinicTimezone)}`,
        deeplink: '/appointments',
        appointment_id: appointment.id,
      });
      if (!store.seenDoctorIds.has(doctor.id)) store.seenDoctorIds.add(doctor.id);
      return appointment;
    },

    async payForAppointment(appointmentId: string, method: PaymentMethod) {
      const appointment = requirePatientAppointment(store, appointmentId);
      const payment = makePayment(
        appointment.id,
        'captured',
        appointment.fee_minor,
        appointment.currency,
        method,
        store.now(),
      );
      appointment.payment = payment;
      appointment.updated_at = new Date(store.now()).toISOString();
      return payment;
    },

    async reschedulePreview(appointmentId: string) {
      const appointment = requirePatientAppointment(store, appointmentId);
      const profile = store.profiles.get(appointment.doctor_id)!;
      const policy = reschedulePolicy({
        startUtc: appointment.start_utc,
        nowMs: store.now(),
        policy: { ...profile.policy },
        rescheduleCount: appointment.reschedule_count,
      });
      return {
        allowed: policy.allowed,
        reason_code: policy.reason_code,
        reason: policy.reason,
        remaining_reschedules: policy.remaining_reschedules,
        summary: policy.summary,
      };
    },

    async rescheduleAppointment(appointmentId: string, startUtc: string) {
      const appointment = requirePatientAppointment(store, appointmentId);
      const doctor = store.doctors.get(appointment.doctor_id)!;
      const profile = store.profiles.get(doctor.id)!;

      const policy = reschedulePolicy({
        startUtc: appointment.start_utc,
        nowMs: store.now(),
        policy: { ...profile.policy },
        rescheduleCount: appointment.reschedule_count,
      });
      if (!policy.allowed) {
        throw new ApiError(policy.reason_code ?? 'APT_STATE_CONFLICT', policy.reason ?? 'Reschedule not allowed.');
      }

      const range = clinicDateRange(store, doctor);
      const result = expandFor(store, doctor, appointment.consult_type, range, {
        excludeAppointmentId: appointment.id,
        mineUserIds: [PATIENT_USER_ID],
      });
      const match = result.days.flatMap((day) => day.slots).find((slot) => slot.start_utc === startUtc);
      const clash = store.appointments.find(
        (candidate) =>
          candidate.id !== appointment.id &&
          candidate.doctor_id === doctor.id &&
          candidate.start_utc === startUtc &&
          ['held', 'pending_approval', 'confirmed', 'in_progress'].includes(candidate.status),
      );
      if (clash || !match || match.status === 'taken') {
        throw apiErrors.slotTaken(nearestAlternatives(result, startUtc, 3), doctor.id, startUtc);
      }

      appointment.start_utc = match.start_utc;
      appointment.end_utc = match.end_utc;
      appointment.reschedule_count += 1;
      appointment.updated_at = new Date(store.now()).toISOString();
      notify(store, {
        user_id: appointment.patient_user_id,
        category: 'reschedule',
        channel: 'push',
        title: 'Appointment moved',
        body: `New time: ${clockLabel(fromIso(match.start_utc), doctor.clinicTimezone)}`,
        deeplink: `/appointments/${appointment.id}`,
        appointment_id: appointment.id,
      });
      notify(store, {
        user_id: doctor.id,
        category: 'reschedule',
        channel: 'push',
        title: 'Appointment rescheduled',
        body: `${appointment.for_name} moved to ${clockLabel(fromIso(match.start_utc), doctor.clinicTimezone)}`,
        deeplink: `/appointments/${appointment.id}`,
        appointment_id: appointment.id,
      });
      return appointment;
    },

    async cancelPreview(appointmentId: string) {
      const appointment = requirePatientAppointment(store, appointmentId);
      const policy = cancellationPolicy({
        startUtc: appointment.start_utc,
        nowMs: store.now(),
        feeMinor: appointment.fee_minor,
        currency: appointment.currency,
        actor: 'patient',
      });
      return {
        refund_percent: policy.refund_percent,
        refund_minor: policy.refund_minor,
        currency: policy.currency,
        summary: policy.summary,
        rule: policy.rule,
      };
    },

    async cancelAppointment(appointmentId: string, input: CancelRequest) {
      const appointment = requirePatientAppointment(store, appointmentId);
      if (appointment.status === 'cancelled') {
        // Idempotent: replay the same result rather than erroring.
        return {
          appointment,
          refund: appointment.refund,
          policy: cancellationPolicy({
            startUtc: appointment.start_utc,
            nowMs: store.now(),
            feeMinor: appointment.fee_minor,
            currency: appointment.currency,
            actor: 'patient',
          }),
        } satisfies CancelResult;
      }
      if (!['confirmed', 'pending_approval'].includes(appointment.status)) {
        throw apiErrors.stateConflict(appointment.status, 'cancelled');
      }

      const policy = cancellationPolicy({
        startUtc: appointment.start_utc,
        nowMs: store.now(),
        feeMinor: appointment.fee_minor,
        currency: appointment.currency,
        actor: 'patient',
      });

      appointment.status = 'cancelled';
      appointment.cancelled_by = 'patient';
      appointment.cancel_reason = input.reason + (input.note ? ` — ${input.note}` : '');
      appointment.updated_at = new Date(store.now()).toISOString();
      if (appointment.payment) appointment.payment.status = policy.refund_percent > 0 ? 'refunded' : 'captured';

      const refund =
        policy.refund_minor > 0
          ? {
              id: `ref_${appointment.id}`,
              payment_id: appointment.payment?.id ?? `pay_${appointment.id}`,
              amount_minor: policy.refund_minor,
              currency: policy.currency,
              reason: policy.summary,
              tier_percent: policy.refund_percent,
              status: 'processing' as const,
              created_at: new Date(store.now()).toISOString(),
            }
          : null;
      appointment.refund = refund;

      notify(store, {
        user_id: appointment.patient_user_id,
        category: 'cancellation',
        channel: 'push',
        title: 'Appointment cancelled',
        body: policy.summary,
        deeplink: `/appointments/${appointment.id}`,
        appointment_id: appointment.id,
      });
      notify(store, {
        user_id: appointment.doctor_id,
        category: 'cancellation',
        channel: 'push',
        title: 'Patient cancelled',
        body: `${appointment.for_name} · ${clockLabel(fromIso(appointment.start_utc), appointment.doctor_timezone)}`,
        deeplink: `/appointments/${appointment.id}`,
        appointment_id: appointment.id,
      });

      return { appointment, refund, policy } satisfies CancelResult;
    },

    async submitReview(appointmentId: string, input: PostVisitReviewRequest) {
      const appointment = requirePatientAppointment(store, appointmentId);
      if (appointment.status !== 'completed') {
        throw new ApiError('APT_REVIEW_NOT_ALLOWED', 'You can review after the visit is completed.');
      }
      if (appointment.review_id) {
        throw new ApiError('APT_REVIEW_EXISTS', 'You have already reviewed this visit.');
      }
      const review: Review = {
        id: `rev_${appointment.id}`,
        appointment_id: appointment.id,
        doctor_id: appointment.doctor_id,
        patient_display_name: appointment.patient_name,
        rating: input.rating,
        comment: input.comment ?? null,
        created_at: new Date(store.now()).toISOString(),
        verified_visit: true,
        status: 'published',
      };
      appointment.review_id = review.id;
      const existing = store.reviews.get(appointment.doctor_id) ?? [];
      store.reviews.set(appointment.doctor_id, [review, ...existing]);
      return review;
    },

    async listAppointments(query: AppointmentListQuery = {}) {
      const nowMs = store.now();
      let items = store.appointments.filter((appointment) => appointment.patient_user_id === PATIENT_USER_ID);

      if (query.member && query.member !== 'self') {
        items = items.filter((appointment) => appointment.dependent_id === query.member);
      } else if (query.member === 'self') {
        items = items.filter((appointment) => appointment.dependent_id === null);
      }
      if (query.doctor_id) items = items.filter((appointment) => appointment.doctor_id === query.doctor_id);
      if (query.status) items = items.filter((appointment) => appointment.status === query.status);

      const scope = query.scope ?? 'upcoming';
      if (scope === 'upcoming') {
        items = items.filter((appointment) => isUpcomingStatus(appointment, nowMs));
        items = [...items].sort((a, b) => a.start_utc.localeCompare(b.start_utc));
      } else if (scope === 'past') {
        items = items.filter((appointment) => !isUpcomingStatus(appointment, nowMs));
        items = [...items].sort((a, b) => b.start_utc.localeCompare(a.start_utc));
      } else {
        items = [...items].sort((a, b) => b.start_utc.localeCompare(a.start_utc));
      }

      const limit = query.limit ?? 30;
      return page(items.slice(0, limit));
    },

    async getAppointment(appointmentId: string) {
      return requirePatientAppointment(store, appointmentId);
    },

    async startConsult(appointmentId: string) {
      const appointment = requirePatientAppointment(store, appointmentId);
      if (appointment.consult_type !== 'video') {
        throw apiErrors.invalid({ consult_type: 'Only video consultations can be joined.' });
      }
      if (appointment.status === 'confirmed') appointment.status = 'in_progress';
      appointment.updated_at = new Date(store.now()).toISOString();
      return appointment;
    },

    async listNotifications(query: { limit?: number; unread_only?: boolean } = {}) {
      let items = store.notifications
        .filter((notification) => notification.user_id === PATIENT_USER_ID)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      if (query.unread_only) items = items.filter((notification) => notification.read_at === null);
      return page(items.slice(0, query.limit ?? 50));
    },

    async markNotificationRead(notificationId: string) {
      const notification = store.notifications.find((candidate) => candidate.id === notificationId);
      if (!notification) throw apiErrors.notFound('Notification', notificationId);
      notification.read_at = new Date(store.now()).toISOString();
    },

    async markAllNotificationsRead() {
      for (const notification of store.notifications) {
        if (notification.user_id === PATIENT_USER_ID && notification.read_at === null) {
          notification.read_at = new Date(store.now()).toISOString();
        }
      }
    },

    async getNotificationPreferences() {
      return store.getPreferences();
    },

    async updateNotificationPreferences(patch: Partial<NotificationPreference>) {
      store.setPreferences({ ...store.getPreferences(), ...patch });
      return store.getPreferences();
    },

    async getProfile() {
      return store.patient;
    },

    async updateProfile(patch: Partial<PatientProfile>) {
      Object.assign(store.patient, patch);
      return store.patient;
    },

    async listDependents() {
      const nowMs = store.now();
      return store.dependents.map((dependent) => ({
        ...dependent,
        upcoming_appointments: store.appointments.filter(
          (appointment) =>
            appointment.dependent_id === dependent.id &&
            ['held', 'pending_approval', 'confirmed', 'in_progress'].includes(appointment.status) &&
            fromIso(appointment.start_utc) > nowMs,
        ).length,
      }));
    },

    async createDependent(input) {
      if (store.dependents.length >= defaultPlatformConfig.max_dependents) {
        throw apiErrors.invalid({ dependents: `You can add up to ${defaultPlatformConfig.max_dependents} family members.` });
      }
      const dependent: Dependent = {
        ...input,
        id: `dep_${store.dependents.length + 1}_${Date.now().toString(36)}`,
        guardian_user_id: PATIENT_USER_ID,
        is_active: true,
        upcoming_appointments: 0,
      };
      store.dependents.push(dependent);
      return dependent;
    },

    async updateDependent(dependentId: string, patch: Partial<Dependent>) {
      const dependent = store.dependents.find((candidate) => candidate.id === dependentId);
      if (!dependent) throw apiErrors.notFound('Family member', dependentId);
      Object.assign(dependent, patch);
      return dependent;
    },

    async deleteDependent(dependentId: string) {
      const index = store.dependents.findIndex((candidate) => candidate.id === dependentId);
      if (index === -1) throw apiErrors.notFound('Family member', dependentId);
      const nowMs = store.now();
      const upcoming = store.appointments.filter(
        (appointment) =>
          appointment.dependent_id === dependentId &&
          ['held', 'pending_approval', 'confirmed', 'in_progress'].includes(appointment.status) &&
          fromIso(appointment.start_utc) > nowMs,
      );
      if (upcoming.length > 0) {
        throw new ApiError(
          'APT_DEPENDENT_HAS_APPOINTMENTS',
          'This family member has upcoming appointments. Move or cancel them first.',
          { details: { appointment_ids: upcoming.map((appointment) => appointment.id) } },
        );
      }
      store.dependents.splice(index, 1);
    },

    async listSavedDoctors() {
      const nowMs = store.now();
      return seedDoctors
        .filter((doctor) => store.savedDoctorIds.has(doctor.id))
        .map((doctor) => summarizeDoctor(store, doctor, store.patient.default_timezone, nowMs));
    },

    async setSavedDoctor(doctorId: string, saved: boolean) {
      if (!store.doctors.has(doctorId)) throw apiErrors.notFound('Doctor', doctorId);
      if (saved) store.savedDoctorIds.add(doctorId);
      else store.savedDoctorIds.delete(doctorId);
      return { doctor_id: doctorId, saved };
    },

    async requestAccountDeletion(reason?: string) {
      void reason;
      const nowMs = store.now();
      const blocking = store.appointments.filter(
        (appointment) =>
          appointment.patient_user_id === PATIENT_USER_ID &&
          ['held', 'pending_approval', 'confirmed'].includes(appointment.status) &&
          fromIso(appointment.start_utc) > nowMs,
      );
      return {
        requested_at: new Date(nowMs).toISOString(),
        resolve_first: blocking.map((appointment) => appointment.code),
      };
    },

    async getHealth(): Promise<HealthResponse> {
      return {
        status: 'ok',
        version: 'mock',
        time: new Date(store.now()).toISOString(),
        database: 'in-memory',
      };
    },
  };

  /* ------------------------------------------------------------- doctor */

  const requireOwnProfile = (): DoctorProfile => {
    const profile = store.profiles.get(DOCTOR_USER_ID);
    if (!profile) throw apiErrors.notFound('Doctor profile', DOCTOR_USER_ID);
    return profile;
  };

  const doctorAppointments = (): Appointment[] =>
    store.appointments.filter((appointment) => appointment.doctor_id === DOCTOR_USER_ID);

  const doctor: DoctorApi = {
    async requestOtp() {
      /* mock: always succeeds */
    },
    async verifyOtp() {
      return doctorSession();
    },
    async refresh() {
      return doctorSession();
    },
    async logout() {
      /* nothing to revoke */
    },
    async me() {
      return authUserForDoctor(store);
    },

    async getProfile() {
      return requireOwnProfile();
    },
    async updateProfile(patch: Partial<DoctorProfile>) {
      const profile = requireOwnProfile();
      Object.assign(profile, patch);
      return profile;
    },
    async updateProfileFields(patch: Partial<DoctorProfile>) {
      const profile = requireOwnProfile();
      Object.assign(profile, patch);
      return profile;
    },

    async getVerification() {
      const seed = store.doctors.get(DOCTOR_USER_ID)!;
      return buildVerification(seed, store.createdAtMs);
    },

    async submitVerification(input) {
      const seed = store.doctors.get(DOCTOR_USER_ID)!;
      const submission = buildVerification(seed, store.createdAtMs);
      return {
        ...submission,
        status: 'under_review',
        registration_number: input.registration_number,
        council: input.council,
        country: input.country,
        specialization_slugs: input.specialization_slugs,
        documents: input.documents.map((document, index) => ({
          id: `docfile_new_${index}`,
          kind: document.kind,
          filename: document.filename,
          uploaded_at: new Date(store.now()).toISOString(),
        })),
        submitted_at: new Date(store.now()).toISOString(),
        reviewed_at: null,
        rejection_reason: null,
      } satisfies VerificationSubmission;
    },

    async getConsultationConfig() {
      return requireOwnProfile().consultation_config;
    },
    async updateConsultationConfig(config: ConsultationConfig) {
      const profile = requireOwnProfile();
      profile.consultation_config = config;
      return config;
    },

    async listRules() {
      return store.rules.get(DOCTOR_USER_ID) ?? [];
    },
    async upsertRule(rule) {
      const list = store.rules.get(DOCTOR_USER_ID) ?? [];
      const next: AvailabilityRule = {
        id: rule.id ?? `rule_new_${list.length + 1}_${Date.now().toString(36)}`,
        doctor_id: DOCTOR_USER_ID,
        weekday: rule.weekday,
        start_local_time: rule.start_local_time,
        end_local_time: rule.end_local_time,
        slot_minutes: rule.slot_minutes,
        buffer_minutes: rule.buffer_minutes,
        consult_types: rule.consult_types,
        effective_from: rule.effective_from,
      };
      const index = list.findIndex((candidate) => candidate.id === next.id);
      if (index >= 0) list[index] = next;
      else list.push(next);
      store.rules.set(DOCTOR_USER_ID, list);
      return next;
    },
    async deleteRule(ruleId: string) {
      const list = store.rules.get(DOCTOR_USER_ID) ?? [];
      store.rules.set(
        DOCTOR_USER_ID,
        list.filter((rule) => rule.id !== ruleId),
      );
    },

    async listExceptions() {
      const list = store.exceptions.get(DOCTOR_USER_ID) ?? [];
      return list.map((exception) => ({
        ...exception,
        affected_appointments: doctorAppointments()
          .filter(
            (appointment) =>
              fromIso(appointment.start_utc) < fromIso(exception.end_utc) &&
              fromIso(exception.start_utc) < fromIso(appointment.end_utc) &&
              ['held', 'pending_approval', 'confirmed', 'in_progress'].includes(appointment.status),
          )
          .map((appointment) => ({
            id: appointment.id,
            code: appointment.code,
            patient_name: appointment.patient_name,
            for_name: appointment.for_name,
            start_utc: appointment.start_utc,
            status: appointment.status,
          })),
      }));
    },

    async createException(input) {
      const list = store.exceptions.get(DOCTOR_USER_ID) ?? [];
      const exception: AvailabilityException = {
        id: `exc_new_${list.length + 1}_${Date.now().toString(36)}`,
        doctor_id: DOCTOR_USER_ID,
        start_utc: input.start_utc,
        end_utc: input.end_utc,
        kind: input.kind,
        reason: input.reason,
        created_at: new Date(store.now()).toISOString(),
        affected_appointments: [],
      };
      list.push(exception);
      store.exceptions.set(DOCTOR_USER_ID, list);
      return exception;
    },

    async deleteException(exceptionId: string) {
      const list = store.exceptions.get(DOCTOR_USER_ID) ?? [];
      store.exceptions.set(
        DOCTOR_USER_ID,
        list.filter((exception) => exception.id !== exceptionId),
      );
    },

    async getPolicy() {
      return requireOwnProfile().policy;
    },
    async updatePolicy(patch: Partial<DoctorPolicy>) {
      const profile = requireOwnProfile();
      profile.policy = { ...profile.policy, ...patch };
      return profile.policy;
    },

    async listCalendarAccounts() {
      return store.calendarAccounts.get(DOCTOR_USER_ID) ?? [];
    },
    async connectCalendar(provider: CalendarProvider) {
      const state = `mock-state-${provider}-${Date.now().toString(36)}`;
      return {
        authorization_url: `https://accounts.${provider === 'google' ? 'google' : 'microsoft'}.example/oauth2/authorize?state=${state}&scope=calendar.readonly`,
        state,
      };
    },
    async completeCalendarConnect(provider: CalendarProvider, email: string) {
      const list = store.calendarAccounts.get(DOCTOR_USER_ID) ?? [];
      const account: CalendarAccount = {
        id: `cal_new_${provider}_${list.length + 1}`,
        doctor_id: DOCTOR_USER_ID,
        provider,
        account_email: email,
        status: 'syncing',
        last_synced_at: new Date(store.now()).toISOString(),
        busy_events_90d: 0,
        conflicts_open: 0,
        connected_at: new Date(store.now()).toISOString(),
      };
      list.push(account);
      store.calendarAccounts.set(DOCTOR_USER_ID, list);
      return account;
    },
    async syncCalendar(accountId: string) {
      const list = store.calendarAccounts.get(DOCTOR_USER_ID) ?? [];
      const account = list.find((candidate) => candidate.id === accountId);
      if (account) {
        account.last_synced_at = new Date(store.now()).toISOString();
        account.status = 'connected';
        account.busy_events_90d += 3;
      }
      return {
        queued: true,
        job_id: `job_${Date.now().toString(36)}`,
        busy_events_imported: 3,
        conflicts: account?.conflicts_open ?? 0,
      };
    },
    async disconnectCalendar(accountId: string) {
      const list = store.calendarAccounts.get(DOCTOR_USER_ID) ?? [];
      store.calendarAccounts.set(
        DOCTOR_USER_ID,
        list.filter((account) => account.id !== accountId),
      );
    },

    async requestDeactivation(reason: string) {
      void reason;
      const profile = requireOwnProfile();
      profile.deactivation_requested_at = new Date(store.now()).toISOString();
      return {
        requested_at: profile.deactivation_requested_at,
        future_appointments: doctorAppointments().filter(
          (appointment) =>
            ['held', 'pending_approval', 'confirmed'].includes(appointment.status) &&
            fromIso(appointment.start_utc) > store.now(),
        ).length,
      };
    },

    async listAppointments(query: AppointmentListQuery = {}) {
      const nowMs = store.now();
      let items = doctorAppointments();

      if (query.status) items = items.filter((appointment) => appointment.status === query.status);
      if (query.doctor_id) items = items.filter((appointment) => appointment.doctor_id === query.doctor_id);

      switch (query.scope ?? 'upcoming') {
        case 'today': {
          const todayDate = dateInZone(nowMs, requireOwnProfile().clinic_timezone);
          items = items.filter((appointment) => dateInZone(fromIso(appointment.start_utc), appointment.doctor_timezone) === todayDate);
          items = [...items].sort((a, b) => a.start_utc.localeCompare(b.start_utc));
          break;
        }
        case 'pending':
          items = items.filter((appointment) => appointment.status === 'pending_approval');
          items = [...items].sort((a, b) => a.start_utc.localeCompare(b.start_utc));
          break;
        case 'past':
          items = items.filter((appointment) => !isUpcomingStatus(appointment, nowMs));
          items = [...items].sort((a, b) => b.start_utc.localeCompare(a.start_utc));
          break;
        case 'all':
          items = [...items].sort((a, b) => b.start_utc.localeCompare(a.start_utc));
          break;
        case 'upcoming':
        default:
          items = items
            .filter((appointment) => isUpcomingStatus(appointment, nowMs))
            .sort((a, b) => a.start_utc.localeCompare(b.start_utc));
          break;
      }

      return page(items.slice(0, query.limit ?? 50));
    },

    async getAppointment(appointmentId: string) {
      const appointment = store.appointments.find(
        (candidate) => candidate.id === appointmentId && candidate.doctor_id === DOCTOR_USER_ID,
      );
      if (!appointment) throw apiErrors.notFound('Appointment', appointmentId);
      return appointment;
    },

    async acceptAppointment(appointmentId: string) {
      const appointment = await doctor.getAppointment(appointmentId);
      if (appointment.status !== 'pending_approval') {
        throw apiErrors.stateConflict(appointment.status, 'confirmed');
      }
      appointment.status = 'confirmed';
      appointment.updated_at = new Date(store.now()).toISOString();
      notify(store, {
        user_id: appointment.patient_user_id,
        category: 'approval',
        channel: 'push',
        title: 'Booking confirmed',
        body: `${appointment.doctor_name} accepted your request.`,
        deeplink: `/appointments/${appointment.id}`,
        appointment_id: appointment.id,
      });
      return appointment;
    },

    async declineAppointment(appointmentId: string, reason: string) {
      const appointment = await doctor.getAppointment(appointmentId);
      if (appointment.status !== 'pending_approval') {
        throw apiErrors.stateConflict(appointment.status, 'cancelled');
      }
      appointment.status = 'cancelled';
      appointment.cancelled_by = 'doctor';
      appointment.cancel_reason = reason;
      appointment.updated_at = new Date(store.now()).toISOString();
      if (appointment.payment) appointment.payment.status = 'refunded';
      appointment.refund = {
        id: `ref_${appointment.id}`,
        payment_id: appointment.payment?.id ?? `pay_${appointment.id}`,
        amount_minor: appointment.fee_minor,
        currency: appointment.currency,
        reason: 'Doctor declined the request',
        tier_percent: 100,
        status: 'processing',
        created_at: new Date(store.now()).toISOString(),
      };
      notify(store, {
        user_id: appointment.patient_user_id,
        category: 'cancellation',
        channel: 'push',
        title: 'Request declined',
        body: 'Your payment is being refunded in full. Here are alternative doctors.',
        deeplink: '/discover',
        appointment_id: appointment.id,
      });
      return appointment;
    },

    async rescheduleAppointment(appointmentId: string, startUtc: string) {
      const appointment = await doctor.getAppointment(appointmentId);
      const doctor1 = store.doctors.get(appointment.doctor_id)!;
      const range = clinicDateRange(store, doctor1);
      const result = expandFor(store, doctor1, appointment.consult_type, range, {
        excludeAppointmentId: appointment.id,
      });
      const match = result.days.flatMap((day) => day.slots).find((slot) => slot.start_utc === startUtc);
      const clash = store.appointments.find(
        (candidate) =>
          candidate.id !== appointment.id &&
          candidate.doctor_id === appointment.doctor_id &&
          candidate.start_utc === startUtc &&
          ['held', 'pending_approval', 'confirmed', 'in_progress'].includes(candidate.status),
      );
      if (clash || !match || match.status === 'taken') {
        throw apiErrors.slotTaken(nearestAlternatives(result, startUtc, 3), appointment.doctor_id, startUtc);
      }
      appointment.start_utc = match.start_utc;
      appointment.end_utc = match.end_utc;
      appointment.reschedule_count += 1;
      appointment.updated_at = new Date(store.now()).toISOString();
      notify(store, {
        user_id: appointment.patient_user_id,
        category: 'reschedule',
        channel: 'push',
        title: 'Your appointment moved',
        body: `The clinic moved your appointment to ${clockLabel(fromIso(match.start_utc), doctor1.clinicTimezone)}. Reply within an hour to revert.`,
        deeplink: `/appointments/${appointment.id}`,
        appointment_id: appointment.id,
      });
      return appointment;
    },

    async cancelAppointment(appointmentId: string, reason: string) {
      const appointment = await doctor.getAppointment(appointmentId);
      if (appointment.status === 'cancelled') return appointment;
      if (!['confirmed', 'pending_approval', 'in_progress'].includes(appointment.status)) {
        throw apiErrors.stateConflict(appointment.status, 'cancelled');
      }
      appointment.status = 'cancelled';
      appointment.cancelled_by = 'doctor';
      appointment.cancel_reason = reason;
      appointment.updated_at = new Date(store.now()).toISOString();
      if (appointment.payment) appointment.payment.status = 'refunded';
      appointment.refund = {
        id: `ref_${appointment.id}`,
        payment_id: appointment.payment?.id ?? `pay_${appointment.id}`,
        amount_minor: appointment.fee_minor,
        currency: appointment.currency,
        reason: 'Cancelled by the doctor — full refund (R8)',
        tier_percent: 100,
        status: 'processing',
        created_at: new Date(store.now()).toISOString(),
      };
      notify(store, {
        user_id: appointment.patient_user_id,
        category: 'cancellation',
        channel: 'push',
        title: 'Appointment cancelled by the clinic',
        body: 'You are refunded in full. Rebook in one tap.',
        deeplink: '/discover',
        appointment_id: appointment.id,
      });
      return appointment;
    },

    async completeAppointment(appointmentId: string) {
      const appointment = await doctor.getAppointment(appointmentId);
      if (!['confirmed', 'in_progress'].includes(appointment.status)) {
        throw apiErrors.stateConflict(appointment.status, 'completed');
      }
      appointment.status = 'completed';
      appointment.updated_at = new Date(store.now()).toISOString();
      notify(store, {
        user_id: appointment.patient_user_id,
        category: 'review',
        channel: 'push',
        title: 'How was your visit?',
        body: 'Rate your consultation to help other patients.',
        deeplink: `/appointments/${appointment.id}`,
        appointment_id: appointment.id,
      });
      return appointment;
    },

    async markNoShow(appointmentId: string) {
      const appointment = await doctor.getAppointment(appointmentId);
      if (appointment.status !== 'confirmed') {
        throw apiErrors.stateConflict(appointment.status, 'no_show');
      }
      appointment.status = 'no_show';
      appointment.updated_at = new Date(store.now()).toISOString();
      return appointment;
    },

    async getPatientContext(appointmentId: string) {
      const appointment = await doctor.getAppointment(appointmentId);
      const visits = doctorAppointments()
        .filter((candidate) => candidate.patient_user_id === appointment.patient_user_id)
        .sort((a, b) => b.start_utc.localeCompare(a.start_utc));
      const dependent = store.dependents.find((candidate) => candidate.id === appointment.dependent_id);
      return {
        patient_user_id: appointment.patient_user_id,
        dependent_id: appointment.dependent_id,
        display_name: appointment.for_name,
        relationship: dependent?.relationship ?? null,
        age: null,
        gender: dependent?.gender ?? store.patient.gender,
        phone_masked: store.patient.phone ? `${store.patient.phone.slice(0, 3)}••••${store.patient.phone.slice(-2)}` : null,
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
      } satisfies PatientContext;
    },

    async listSeenPatients() {
      const byPatient = new Map<string, SeenPatient>();
      for (const appointment of doctorAppointments()) {
        if (!['completed', 'no_show', 'in_progress'].includes(appointment.status)) continue;
        const key = `${appointment.patient_user_id}:${appointment.dependent_id ?? 'self'}`;
        const existing = byPatient.get(key);
        const dependent = store.dependents.find((candidate) => candidate.id === appointment.dependent_id);
        if (!existing) {
          byPatient.set(key, {
            patient_user_id: appointment.patient_user_id,
            dependent_id: appointment.dependent_id,
            display_name: appointment.for_name,
            age: null,
            gender: dependent?.gender ?? store.patient.gender,
            last_seen_utc: appointment.start_utc,
            visits_with_doctor: 1,
            no_show_count_with_doctor: appointment.status === 'no_show' ? 1 : 0,
          });
        } else {
          existing.visits_with_doctor += 1;
          if (appointment.status === 'no_show') existing.no_show_count_with_doctor += 1;
          if (appointment.start_utc > existing.last_seen_utc) existing.last_seen_utc = appointment.start_utc;
        }
      }
      return [...byPatient.values()].sort((a, b) => b.last_seen_utc.localeCompare(a.last_seen_utc));
    },

    async getStats() {
      const nowMs = store.now();
      const profile = requireOwnProfile();
      const todayDate = dateInZone(nowMs, profile.clinic_timezone);
      const today = doctorAppointments().filter(
        (appointment) => dateInZone(fromIso(appointment.start_utc), appointment.doctor_timezone) === todayDate,
      );
      const accounts = store.calendarAccounts.get(DOCTOR_USER_ID) ?? [];
      const openResult = expandFor(
        store,
        store.doctors.get(DOCTOR_USER_ID)!,
        'in_person',
        clinicDateRange(store, store.doctors.get(DOCTOR_USER_ID)!),
      );
      const nextOpen = openSlots(openResult).find((slot) => fromIso(slot.start_utc) > nowMs) ?? null;
      const conflictsOpen = accounts.reduce((sum, account) => sum + account.conflicts_open, 0);
      // The conflict the calendar sync flagged, surfaced so the Today screen can
      // name the affected appointment instead of a vague count (PRD CAL-004).
      const conflictIds =
        conflictsOpen > 0
          ? today
              .filter((appointment) => ['confirmed', 'in_progress', 'pending_approval'].includes(appointment.status))
              .slice(0, 1)
              .map((appointment) => appointment.id)
          : [];
      return {
        today_total: today.length,
        today_completed: today.filter((appointment) => appointment.status === 'completed').length,
        today_cancellations: today.filter((appointment) => appointment.status === 'cancelled').length,
        pending_approvals: doctorAppointments().filter((appointment) => appointment.status === 'pending_approval').length,
        next_free_slot_utc: nextOpen?.start_utc ?? null,
        conflicts_open: conflictsOpen,
        conflict_appointment_ids: conflictIds,
        calendar_status: accounts.length === 0 ? 'not_connected' : accounts[0]!.status,
        last_synced_at: accounts[0]?.last_synced_at ?? null,
      } satisfies DoctorStats;
    },

    async getOwnAvailability(query: AvailabilityQuery = {}) {
      const self = store.doctors.get(DOCTOR_USER_ID)!;
      const consultType = query.type ?? 'in_person';
      return toAvailabilityResponse(store, self, consultType, query, {
        excludeAppointmentId: undefined,
      });
    },

    async listNotifications(query: { limit?: number; unread_only?: boolean } = {}) {
      let items = store.notifications
        .filter((notification) => notification.user_id === DOCTOR_USER_ID)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      if (query.unread_only) items = items.filter((notification) => notification.read_at === null);
      return page(items.slice(0, query.limit ?? 50));
    },

    async markNotificationRead(notificationId: string) {
      const notification = store.notifications.find((candidate) => candidate.id === notificationId);
      if (!notification) throw apiErrors.notFound('Notification', notificationId);
      notification.read_at = new Date(store.now()).toISOString();
    },

    async markAllNotificationsRead() {
      for (const notification of store.notifications) {
        if (notification.user_id === DOCTOR_USER_ID && notification.read_at === null) {
          notification.read_at = new Date(store.now()).toISOString();
        }
      }
    },

    async getNotificationPreferences() {
      return store.getPreferences();
    },

    async updateNotificationPreferences(patch: Partial<NotificationPreference>) {
      store.setPreferences({ ...store.getPreferences(), ...patch });
      return store.getPreferences();
    },

    async getHealth(): Promise<HealthResponse> {
      return {
        status: 'ok',
        version: 'mock',
        time: new Date(store.now()).toISOString(),
        database: 'in-memory',
      };
    },
  };

  return {
    patient,
    doctor,
    store,
    reset() {
      store = createMockStore({ now: options.now });
      summarySlotCache.clear();
      seedAppointments(store);
    },
  };
}

/* ------------------------------------------------------------------ utils */

function page<T>(items: T[]): Page<T> {
  return { items, meta: { next_cursor: null, total: items.length } };
}

function requirePatientAppointment(store: MockStore, appointmentId: string): Appointment {
  const appointment = store.appointments.find(
    (candidate) => candidate.id === appointmentId && candidate.patient_user_id === PATIENT_USER_ID,
  );
  if (!appointment) throw apiErrors.notFound('Appointment', appointmentId);
  return appointment;
}

function isUpcomingStatus(appointment: Appointment, nowMs: number): boolean {
  return (
    ['held', 'pending_approval', 'confirmed', 'in_progress'].includes(appointment.status) &&
    fromIso(appointment.start_utc) > nowMs - 15 * MINUTE_MS
  );
}

function notify(store: MockStore, input: Omit<AppNotification, 'id' | 'read_at' | 'sent_at' | 'created_at'>): void {
  const nowMs = store.now();
  store.notifications.unshift({
    ...input,
    id: `ntf_${store.notifications.length + 1}_${nowMs.toString(36)}`,
    read_at: null,
    sent_at: new Date(nowMs).toISOString(),
    created_at: new Date(nowMs).toISOString(),
  });
}

function authUserForPatient(store: MockStore): AuthUser {
  return {
    id: store.patient.user_id,
    role: 'patient',
    phone: store.patient.phone,
    email: store.patient.email,
    display_name: store.patient.display_name,
    gender: store.patient.gender,
    dob: store.patient.dob,
    default_timezone: store.patient.default_timezone,
    verification_status: null,
    onboarding_state: 'complete',
    created_at: store.patient.created_at,
  };
}

function authUserForDoctor(store: MockStore): AuthUser {
  const profile = store.profiles.get(DOCTOR_USER_ID)!;
  return {
    id: profile.user_id,
    role: 'doctor',
    phone: '+919833445566',
    email: profile.email,
    display_name: profile.display_name,
    gender: profile.gender,
    dob: null,
    default_timezone: profile.clinic_timezone,
    verification_status: profile.verification_status,
    onboarding_state: 'live',
    created_at: new Date(store.createdAtMs).toISOString(),
  };
}

function hasAvailabilityOn(
  store: MockStore,
  doctor: DoctorSummary,
  available: string,
  consultType?: 'in_person' | 'video',
): boolean {
  const seed = store.doctors.get(doctor.id);
  if (!seed) return false;
  const types = consultType ? [consultType] : doctor.consultation_types;
  const nowMs = store.now();
  const targetDate =
    available === 'today'
      ? dateInZone(nowMs, seed.clinicTimezone)
      : available === 'tomorrow'
        ? addDaysToDate(dateInZone(nowMs, seed.clinicTimezone), 1)
        : available;

  for (const type of types) {
    const result = expandFor(store, seed, type, { from: targetDate, to: targetDate });
    if (openSlots(result).length > 0) return true;
  }
  return false;
}
