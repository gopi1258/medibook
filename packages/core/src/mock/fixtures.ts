/**
 * Deterministic mock fixtures for the offline dataset bundled into both apps.
 *
 * Everything is derived from a compact table plus `now`, so:
 *  - there are always bookable slots in the near future;
 *  - slot expansion for the mock runs through the *same* pure engine as the
 *    backend (`expandSlots`), so the offline experience matches the real one;
 *  - avatars are initials only — no remote assets.
 */
import { DAY_MS, MINUTE_MS, toIso } from '../time.ts';
import type {
  AvailabilityRule,
  ConsultationConfig,
  DoctorPolicy,
  DoctorProfile,
  Gender,
  Specialization,
  VerificationSubmission,
} from '../types.ts';

export const PATIENT_USER_ID = 'usr_priya';
/** The signed-in doctor is Dr. Arjun Mehta; his user id matches his doctor id. */
export const DOCTOR_USER_ID = 'doc_arjun';

export const specializations: Specialization[] = [
  { id: 'sp_derma', name: 'Dermatologist', slug: 'dermatology', icon: 'sparkle', is_active: true, doctor_count: 1 },
  { id: 'sp_genmed', name: 'General Physician', slug: 'general-medicine', icon: 'stethoscope', is_active: true, doctor_count: 1 },
  { id: 'sp_ortho', name: 'Orthopaedic Surgeon', slug: 'orthopaedics', icon: 'bone', is_active: true, doctor_count: 1 },
  { id: 'sp_paed', name: 'Paediatrician', slug: 'paediatrics', icon: 'baby', is_active: true, doctor_count: 1 },
  { id: 'sp_cardio', name: 'Cardiologist', slug: 'cardiology', icon: 'activity', is_active: true, doctor_count: 1 },
  { id: 'sp_psych', name: 'Psychiatrist', slug: 'psychiatry', icon: 'brain', is_active: true, doctor_count: 1 },
  { id: 'sp_dental', name: 'Dentist', slug: 'dentistry', icon: 'tooth', is_active: true, doctor_count: 1 },
  { id: 'sp_neuro', name: 'Neurologist', slug: 'neurology', icon: 'brain', is_active: true, doctor_count: 1 },
  { id: 'sp_gynae', name: 'Gynaecologist', slug: 'gynaecology', icon: 'droplet', is_active: true, doctor_count: 0 },
  { id: 'sp_ent', name: 'ENT Specialist', slug: 'ent', icon: 'stethoscope', is_active: true, doctor_count: 0 },
];

export type SeedDoctor = {
  id: string;
  /** Specialty slugs; first is primary. */
  specializationSlugs: string[];
  name: string;
  gender: Gender;
  experienceYears: number;
  rating: number;
  reviewCount: number;
  languages: string[];
  bio: string;
  qualifications: Array<{ degree: string; institution: string; year: number }>;
  clinicName: string;
  clinicAddress: string;
  area: string;
  clinicTimezone: string;
  currency: string;
  registrationNumber: string;
  council: string;
  consultFees: ConsultationConfig;
  /** Weekly template variant — keeps the 8 doctors visibly different. */
  schedule: ScheduleVariant;
  calendarProvider: 'google' | 'microsoft' | null;
  calendarEmail: string | null;
  calendarStatus: 'connected' | 'syncing' | 'error' | 'revoked' | 'expired';
  policy: Partial<DoctorPolicy>;
};

export type ScheduleVariant = 0 | 1 | 2 | 3;

/** Weekly templates in clinic-local wall time (R9 / TRD §10.3). */
export const scheduleVariants: Record<
  ScheduleVariant,
  Array<{
    weekday: number;
    start: string;
    end: string;
    slotMinutes: number;
    bufferMinutes: number;
    consultTypes: ReadonlyArray<'in_person' | 'video'>;
  }>
> = {
  0: [
    // Dr. Mehta keeps a short Sunday clinic so the doctor app always has a
    // populated "Today" timeline, whatever day the demo is run.
    ...weekdays([0, 1, 2, 3, 4, 5, 6]).flatMap((weekday) => [
      { weekday, start: '10:00', end: '13:00', slotMinutes: 20, bufferMinutes: 5, consultTypes: ['in_person'] as const },
      { weekday, start: '17:00', end: '20:00', slotMinutes: 20, bufferMinutes: 5, consultTypes: ['in_person'] as const },
    ]),
    ...weekdays([1, 2, 3, 4, 5]).map((weekday) => ({
      weekday,
      start: '19:00',
      end: '21:30',
      slotMinutes: 15,
      bufferMinutes: 5,
      consultTypes: ['video'] as const,
    })),
  ],
  1: [
    ...weekdays([1, 2, 3, 4, 5]).flatMap((weekday) => [
      { weekday, start: '09:00', end: '12:30', slotMinutes: 30, bufferMinutes: 10, consultTypes: ['in_person'] as const },
      { weekday, start: '16:00', end: '19:00', slotMinutes: 30, bufferMinutes: 10, consultTypes: ['in_person'] as const },
    ]),
    ...weekdays([2, 4, 6]).map((weekday) => ({
      weekday,
      start: '08:00',
      end: '10:00',
      slotMinutes: 20,
      bufferMinutes: 5,
      consultTypes: ['video'] as const,
    })),
  ],
  2: [
    ...weekdays([1, 2, 3, 4, 5]).flatMap((weekday) => [
      { weekday, start: '08:00', end: '11:00', slotMinutes: 15, bufferMinutes: 5, consultTypes: ['video'] as const },
      { weekday, start: '18:00', end: '21:00', slotMinutes: 15, bufferMinutes: 5, consultTypes: ['video'] as const },
    ]),
  ],
  3: [
    ...weekdays([1, 3, 5]).map((weekday) => ({
      weekday,
      start: '11:00',
      end: '15:00',
      slotMinutes: 20,
      bufferMinutes: 5,
      consultTypes: ['in_person', 'video'] as const,
    })),
  ],
};

function weekdays(days: number[]): number[] {
  return days;
}

export const seedDoctors: SeedDoctor[] = [
  {
    id: 'doc_arjun',
    specializationSlugs: ['dermatology'],
    name: 'Dr. Arjun Mehta',
    gender: 'male',
    experienceYears: 12,
    rating: 4.8,
    reviewCount: 126,
    languages: ['English', 'Hindi', 'Marathi'],
    bio: 'Dermatologist focused on acne, pigmentation and hair loss. I keep consultations practical: a clear diagnosis, a written plan, and a follow-up only if it is actually needed.',
    qualifications: [
      { degree: 'MBBS', institution: 'Grant Medical College, Mumbai', year: 2010 },
      { degree: 'MD Dermatology', institution: 'AIIMS, New Delhi', year: 2014 },
    ],
    clinicName: 'Skin & You Clinic',
    clinicAddress: '302 Linking Road, Bandra West, Mumbai 400050',
    area: 'Bandra West, Mumbai',
    clinicTimezone: 'Asia/Kolkata',
    currency: 'INR',
    registrationNumber: 'MH-2014-44821',
    council: 'Maharashtra Medical Council',
    consultFees: {
      fees: [
        { consult_type: 'in_person', enabled: true, duration_minutes: 20, fee_minor: 60000, currency: 'INR' },
        { consult_type: 'video', enabled: true, duration_minutes: 15, fee_minor: 50000, currency: 'INR' },
      ],
    },
    schedule: 0,
    calendarProvider: 'google',
    calendarEmail: 'dr.arjun.mehta@gmail.com',
    calendarStatus: 'connected',
    policy: { approval_mode: 'auto', buffer_minutes: 5 },
  },
  {
    id: 'doc_kavya',
    specializationSlugs: ['general-medicine'],
    name: 'Dr. Kavya Iyer',
    gender: 'female',
    experienceYears: 9,
    rating: 4.7,
    reviewCount: 98,
    languages: ['English', 'Tamil', 'Hindi'],
    bio: 'General physician running a largely teleconsultation practice. I treat fever, infections, diabetes follow-ups and lifestyle conditions, and I am happy to coordinate with your local lab.',
    qualifications: [
      { degree: 'MBBS', institution: 'Christian Medical College, Vellore', year: 2013 },
      { degree: 'MD General Medicine', institution: 'St. John\u2019s Medical College, Bengaluru', year: 2017 },
    ],
    clinicName: 'Iyer Telehealth',
    clinicAddress: '12 5th Block, Koramangala, Bengaluru 560095',
    area: 'Koramangala, Bengaluru',
    clinicTimezone: 'Asia/Kolkata',
    currency: 'INR',
    registrationNumber: 'KA-2017-20334',
    council: 'Karnataka Medical Council',
    consultFees: {
      fees: [
        { consult_type: 'in_person', enabled: true, duration_minutes: 30, fee_minor: 45000, currency: 'INR' },
        { consult_type: 'video', enabled: true, duration_minutes: 20, fee_minor: 40000, currency: 'INR' },
      ],
    },
    schedule: 1,
    calendarProvider: 'microsoft',
    calendarEmail: 'kavya.iyer@clinic365.onmicrosoft.com',
    calendarStatus: 'connected',
    policy: { approval_mode: 'auto' },
  },
  {
    id: 'doc_rohan',
    specializationSlugs: ['orthopaedics'],
    name: 'Dr. Rohan Deshpande',
    gender: 'male',
    experienceYears: 15,
    rating: 4.6,
    reviewCount: 74,
    languages: ['English', 'Hindi', 'Gujarati'],
    bio: 'Orthopaedic surgeon specialising in sports injuries, knee and shoulder pain, and post-operative rehabilitation planning. First consultations include a hands-on examination.',
    qualifications: [
      { degree: 'MBBS', institution: 'Seth G.S. Medical College, Mumbai', year: 2007 },
      { degree: 'MS Orthopaedics', institution: 'PGIMER, Chandigarh', year: 2012 },
    ],
    clinicName: 'Deshpande Orthopaedics',
    clinicAddress: 'Level 4, Veera Desai Road, Andheri West, Mumbai 400053',
    area: 'Andheri West, Mumbai',
    clinicTimezone: 'Asia/Kolkata',
    currency: 'INR',
    registrationNumber: 'MH-2012-77190',
    council: 'Maharashtra Medical Council',
    consultFees: {
      fees: [
        { consult_type: 'in_person', enabled: true, duration_minutes: 30, fee_minor: 90000, currency: 'INR' },
        { consult_type: 'video', enabled: false, duration_minutes: 20, fee_minor: 0, currency: 'INR' },
      ],
    },
    schedule: 1,
    calendarProvider: null,
    calendarEmail: null,
    calendarStatus: 'connected',
    policy: { approval_mode: 'auto', no_show_grace_minutes_clinic: 15 },
  },
  {
    id: 'doc_ananya',
    specializationSlugs: ['paediatrics'],
    name: 'Dr. Ananya Ghosh',
    gender: 'female',
    experienceYears: 8,
    rating: 4.9,
    reviewCount: 143,
    languages: ['English', 'Bengali', 'Hindi'],
    bio: 'Paediatrician. Vaccinations, growth and nutrition, recurring colds and allergies. I explain everything twice — once to the parent, once to the child.',
    qualifications: [
      { degree: 'MBBS', institution: 'Medical College Kolkata', year: 2014 },
      { degree: 'MD Paediatrics', institution: 'IPGMER, Kolkata', year: 2018 },
    ],
    clinicName: 'Little Steps Child Care',
    clinicAddress: '27 Sector 1, Salt Lake, Kolkata 700064',
    area: 'Salt Lake, Kolkata',
    clinicTimezone: 'Asia/Kolkata',
    currency: 'INR',
    registrationNumber: 'WB-2018-31176',
    council: 'West Bengal Medical Council',
    consultFees: {
      fees: [
        { consult_type: 'in_person', enabled: true, duration_minutes: 20, fee_minor: 70000, currency: 'INR' },
        { consult_type: 'video', enabled: true, duration_minutes: 15, fee_minor: 55000, currency: 'INR' },
      ],
    },
    schedule: 3,
    calendarProvider: 'google',
    calendarEmail: 'dr.ananya.ghosh@gmail.com',
    calendarStatus: 'connected',
    policy: { approval_mode: 'auto' },
  },
  {
    id: 'doc_nikhil',
    specializationSlugs: ['cardiology'],
    name: 'Dr. Nikhil Reddy',
    gender: 'male',
    experienceYears: 18,
    rating: 4.7,
    reviewCount: 61,
    languages: ['English', 'Telugu', 'Hindi'],
    bio: 'Interventional cardiologist. Consultations cover chest pain evaluation, blood-pressure control, cholesterol management and post-angioplasty reviews.',
    qualifications: [
      { degree: 'MBBS', institution: 'Osmania Medical College, Hyderabad', year: 2004 },
      { degree: 'DM Cardiology', institution: 'Nizam\u2019s Institute of Medical Sciences', year: 2011 },
    ],
    clinicName: 'Reddy Heart Centre',
    clinicAddress: 'Road No. 12, Banjara Hills, Hyderabad 500034',
    area: 'Banjara Hills, Hyderabad',
    clinicTimezone: 'Asia/Kolkata',
    currency: 'INR',
    registrationNumber: 'TS-2011-11842',
    council: 'Telangana State Medical Council',
    consultFees: {
      fees: [
        { consult_type: 'in_person', enabled: true, duration_minutes: 30, fee_minor: 120000, currency: 'INR' },
        { consult_type: 'video', enabled: true, duration_minutes: 20, fee_minor: 95000, currency: 'INR' },
      ],
    },
    schedule: 1,
    calendarProvider: 'microsoft',
    calendarEmail: 'n.reddy@apollo-hyd.onmicrosoft.com',
    calendarStatus: 'error',
    policy: { approval_mode: 'manual', approval_auto_decline_minutes: 15 },
  },
  {
    id: 'doc_fatima',
    specializationSlugs: ['psychiatry'],
    name: 'Dr. Fatima Sheikh',
    gender: 'female',
    experienceYears: 11,
    rating: 4.9,
    reviewCount: 88,
    languages: ['English', 'Hindi', 'Urdu'],
    bio: 'Psychiatrist working with anxiety, depression, sleep problems and burnout. Sessions are unhurried and confidentiality is absolute.',
    qualifications: [
      { degree: 'MBBS', institution: 'Bangalore Medical College', year: 2011 },
      { degree: 'MD Psychiatry', institution: 'NIMHANS, Bengaluru', year: 2016 },
    ],
    clinicName: 'Sheikh Mind Care',
    clinicAddress: '8th Floor, Jubilee Hills Road No. 36, Hyderabad 500033',
    area: 'Jubilee Hills, Hyderabad',
    clinicTimezone: 'Asia/Kolkata',
    currency: 'INR',
    registrationNumber: 'TS-2016-55021',
    council: 'Telangana State Medical Council',
    consultFees: {
      fees: [
        { consult_type: 'video', enabled: true, duration_minutes: 30, fee_minor: 90000, currency: 'INR' },
        { consult_type: 'in_person', enabled: true, duration_minutes: 30, fee_minor: 110000, currency: 'INR' },
      ],
    },
    schedule: 2,
    calendarProvider: 'google',
    calendarEmail: 'dr.fatima.sheikh@gmail.com',
    calendarStatus: 'connected',
    policy: { approval_mode: 'auto', no_show_grace_minutes_video: 12 },
  },
  {
    id: 'doc_sameer',
    specializationSlugs: ['dentistry'],
    name: 'Dr. Sameer Kulkarni',
    gender: 'male',
    experienceYears: 7,
    rating: 4.5,
    reviewCount: 52,
    languages: ['English', 'Marathi', 'Hindi'],
    bio: 'Dentist. Painless fillings, root canals, scaling and paediatric dentistry. Free consults for follow-ups within two weeks of a procedure.',
    qualifications: [
      { degree: 'BDS', institution: 'Government Dental College, Pune', year: 2015 },
      { degree: 'MDS Conservative Dentistry', institution: 'Nair Hospital Dental College', year: 2019 },
    ],
    clinicName: 'Kulkarni Dental Studio',
    clinicAddress: 'Shivaji Housing Society, Kothrud, Pune 411038',
    area: 'Kothrud, Pune',
    clinicTimezone: 'Asia/Kolkata',
    currency: 'INR',
    registrationNumber: 'MH-2019-90455',
    council: 'Maharashtra Medical Council',
    consultFees: {
      fees: [
        { consult_type: 'in_person', enabled: true, duration_minutes: 20, fee_minor: 50000, currency: 'INR' },
        { consult_type: 'video', enabled: false, duration_minutes: 15, fee_minor: 0, currency: 'INR' },
      ],
    },
    schedule: 3,
    calendarProvider: null,
    calendarEmail: null,
    calendarStatus: 'connected',
    policy: { approval_mode: 'auto' },
  },
  {
    id: 'doc_marcus',
    specializationSlugs: ['neurology'],
    name: 'Dr. Marcus Feldman',
    gender: 'male',
    experienceYears: 14,
    rating: 4.6,
    reviewCount: 39,
    languages: ['English', 'Spanish'],
    bio: 'Neurologist in New York seeing international patients by video. Headaches, migraine, neuropathy and memory concerns. Cross-timezone scheduling welcome.',
    qualifications: [
      { degree: 'MD', institution: 'Columbia University, New York', year: 2008 },
      { degree: 'Neurology Residency', institution: 'NYU Langone Health', year: 2013 },
    ],
    clinicName: 'Feldman Neurology',
    clinicAddress: '245 5th Avenue, Suite 1200, New York, NY 10016',
    area: 'Manhattan, New York',
    clinicTimezone: 'America/New_York',
    currency: 'USD',
    registrationNumber: 'NY-2013-88291',
    council: 'New York State Board for Medicine',
    consultFees: {
      fees: [
        { consult_type: 'video', enabled: true, duration_minutes: 30, fee_minor: 18000, currency: 'USD' },
        { consult_type: 'in_person', enabled: false, duration_minutes: 30, fee_minor: 0, currency: 'USD' },
      ],
    },
    schedule: 2,
    calendarProvider: 'google',
    calendarEmail: 'marcus.feldman@feldman-neurology.com',
    calendarStatus: 'connected',
    policy: { approval_mode: 'auto', reschedule_min_hours: 12 },
  },
];

/** Build the weekly `AvailabilityRule` rows for a doctor. */
export function buildRules(doctor: SeedDoctor, createdAtMs: number): AvailabilityRule[] {
  const template = scheduleVariants[doctor.schedule];
  return template.map((entry, index) => ({
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

export function buildDoctorProfile(doctor: SeedDoctor, createdAtMs: number): DoctorProfile {
  return {
    user_id: doctor.id,
    display_name: doctor.name,
    phone: null,
    email: doctor.calendarEmail,
    gender: doctor.gender,
    bio: doctor.bio,
    experience_years: doctor.experienceYears,
    languages: doctor.languages,
    qualifications: doctor.qualifications.map((qualification, index) => ({
      id: `qual_${doctor.id}_${index}`,
      ...qualification,
    })),
    specialization_slugs: doctor.specializationSlugs,
    clinic_name: doctor.clinicName,
    clinic_address: doctor.clinicAddress,
    clinic_timezone: doctor.clinicTimezone,
    clinic_geo: null,
    consultation_config: doctor.consultFees,
    policy: {
      min_notice_minutes: 120,
      booking_window_days: 60,
      reschedule_min_hours: 4,
      max_reschedules: 2,
      approval_mode: 'auto',
      approval_auto_decline_minutes: 15,
      no_show_grace_minutes_video: 10,
      no_show_grace_minutes_clinic: 15,
      buffer_minutes: 5,
      ...doctor.policy,
    },
    verification_status: 'approved',
    verified_at: new Date(createdAtMs - 120 * DAY_MS).toISOString(),
    deactivation_requested_at: null,
  };
}

export function buildVerification(doctor: SeedDoctor, createdAtMs: number): VerificationSubmission {
  return {
    status: 'approved',
    registration_number: doctor.registrationNumber,
    council: doctor.council,
    country: doctor.clinicTimezone.startsWith('America') ? 'United States' : 'India',
    specialization_slugs: doctor.specializationSlugs,
    documents: [
      {
        id: `docfile_${doctor.id}_licence`,
        kind: 'license',
        filename: 'medical-licence.pdf',
        uploaded_at: new Date(createdAtMs - 121 * DAY_MS).toISOString(),
      },
      {
        id: `docfile_${doctor.id}_id`,
        kind: 'government_id',
        filename: 'government-id.jpg',
        uploaded_at: new Date(createdAtMs - 121 * DAY_MS).toISOString(),
      },
    ],
    submitted_at: new Date(createdAtMs - 121 * DAY_MS).toISOString(),
    reviewed_at: new Date(createdAtMs - 120 * DAY_MS).toISOString(),
    rejection_reason: null,
    checklist: [
      { key: 'profile', label: 'Professional profile', done: true },
      { key: 'photo', label: 'Profile photo', done: true },
      { key: 'fees', label: 'Consultation types & fees', done: true },
      { key: 'schedule', label: 'Weekly schedule', done: true },
      { key: 'calendar', label: 'At least one calendar connected', done: doctor.calendarProvider !== null },
      { key: 'verification', label: 'Licence verified', done: true },
    ],
  };
}

/** Deterministic external busy time so mock availability has "taken" slots. */
export function externalBusyFor(doctor: SeedDoctor, dayStartUtcMs: number): Array<{ startUtc: string; endUtc: string }> {
  const seed = doctor.id.length + doctor.experienceYears;
  const offsetMinutes = 30 + ((seed * 17) % 150);
  const start = dayStartUtcMs + offsetMinutes * MINUTE_MS;
  const duration = (15 + (seed % 4) * 5) * MINUTE_MS;
  return [{ startUtc: toIso(start), endUtc: toIso(start + duration) }];
}
