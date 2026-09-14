/**
 * The MediBook service contract.
 *
 * Two implementations satisfy these interfaces:
 *   1. `createHttpApi()`      — talks to `services/api` (set `EXPO_PUBLIC_API_URL`).
 *   2. `createMockApi()`      — the offline dataset bundled into each app.
 *
 * Screens depend only on `PatientApi` / `DoctorApi`, never on which one is
 * wired, so behaviour never forks on transport.
 */
import type { ApiError } from './errors.ts';
import type {
  Appointment,
  AppointmentListQuery,
  AuthSession,
  AuthUser,
  AvailabilityException,
  AvailabilityQuery,
  AvailabilityResponse,
  AvailabilityRule,
  CancelRequest,
  CancelResult,
  CalendarAccount,
  CalendarProvider,
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
  AppNotification,
  OtpRequest,
  OtpVerifyRequest,
  Page,
  PatientContext,
  PatientProfile,
  Payment,
  PaymentMethod,
  PostVisitReviewRequest,
  Review,
  SeenPatient,
  Specialization,
  VerificationSubmission,
  ConsultType,
} from './types.ts';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/** Low-level transport hook so both clients share ergonomics like retries. */
export type Transport = {
  request<TResponse>(options: {
    method: HttpMethod;
    path: string;
    query?: Record<string, string | number | boolean | undefined>;
    body?: unknown;
    /** Attached to slot/money-affecting writes (TRD §7.1). */
    idempotencyKey?: string;
    signal?: AbortSignal;
  }): Promise<TResponse>;
};

/** Token + identity plumbing shared by both roles. */
export type AuthApi = {
  /** `204` — generic success regardless of account existence (enumeration defence). */
  requestOtp(input: OtpRequest): Promise<void>;
  verifyOtp(input: OtpVerifyRequest): Promise<AuthSession>;
  refresh(refreshToken: string): Promise<AuthSession>;
  logout(): Promise<void>;
  me(): Promise<AuthUser>;
};

export type DiscoveryApi = {
  listSpecializations(): Promise<Specialization[]>;
  listDoctors(query?: DoctorQuery): Promise<Page<DoctorSummary>>;
  getDoctor(doctorId: string): Promise<DoctorDetail>;
  getAvailability(doctorId: string, query?: AvailabilityQuery): Promise<AvailabilityResponse>;
};

export type PatientBookingApi = {
  createHold(input: CreateHoldRequest): Promise<Hold>;
  releaseHold(holdId: string): Promise<void>;
  /** `idempotencyKey` is required by the server; the client generates one per draft. */
  createAppointment(input: CreateAppointmentRequest, idempotencyKey: string): Promise<Appointment>;
  /** Simulated payment authorisation within the hold window. */
  payForAppointment(appointmentId: string, method: PaymentMethod): Promise<Payment>;
  reschedulePreview(appointmentId: string): Promise<{
    allowed: boolean;
    reason_code?: string;
    reason?: string;
    remaining_reschedules: number;
    summary: string;
  }>;
  rescheduleAppointment(appointmentId: string, startUtc: string, idempotencyKey: string): Promise<Appointment>;
  cancelPreview(appointmentId: string): Promise<{
    refund_percent: 0 | 50 | 100;
    refund_minor: number;
    currency: string;
    summary: string;
    rule: string;
  }>;
  cancelAppointment(appointmentId: string, input: CancelRequest, idempotencyKey: string): Promise<CancelResult>;
  submitReview(appointmentId: string, input: PostVisitReviewRequest): Promise<Review>;
};

export type NotificationApi = {
  listNotifications(query?: { limit?: number; unread_only?: boolean }): Promise<Page<AppNotification>>;
  markNotificationRead(notificationId: string): Promise<void>;
  markAllNotificationsRead(): Promise<void>;
  getNotificationPreferences(): Promise<NotificationPreference>;
  updateNotificationPreferences(patch: Partial<NotificationPreference>): Promise<NotificationPreference>;
};

export type PatientProfileApi = {
  getProfile(): Promise<PatientProfile>;
  updateProfile(patch: Partial<PatientProfile>): Promise<PatientProfile>;
  listDependents(): Promise<Dependent[]>;
  createDependent(input: Omit<Dependent, 'id' | 'guardian_user_id' | 'is_active' | 'upcoming_appointments'>): Promise<Dependent>;
  updateDependent(dependentId: string, patch: Partial<Dependent>): Promise<Dependent>;
  deleteDependent(dependentId: string): Promise<void>;
  listSavedDoctors(): Promise<DoctorSummary[]>;
  setSavedDoctor(doctorId: string, saved: boolean): Promise<{ doctor_id: string; saved: boolean }>;
  requestAccountDeletion(reason?: string): Promise<{ requested_at: string; resolve_first: string[] }>;
};

/** Everything a patient screen may call. */
export type PatientApi = AuthApi &
  DiscoveryApi &
  PatientBookingApi &
  NotificationApi &
  PatientProfileApi & {
    listAppointments(query?: AppointmentListQuery): Promise<Page<Appointment>>;
    getAppointment(appointmentId: string): Promise<Appointment>;
    /** Advances `confirmed` → `in_progress` (video). Simulated locally. */
    startConsult(appointmentId: string): Promise<Appointment>;
    getHealth(): Promise<HealthResponse>;
  };

export type DoctorScheduleApi = {
  getProfile(): Promise<DoctorProfile>;
  updateProfile(patch: Partial<DoctorProfile>): Promise<DoctorProfile>;
  getVerification(): Promise<VerificationSubmission>;
  submitVerification(input: {
    registration_number: string;
    council: string;
    country: string;
    specialization_slugs: string[];
    documents: Array<{ kind: 'license' | 'government_id' | 'degree'; filename: string }>;
  }): Promise<VerificationSubmission>;
  getConsultationConfig(): Promise<ConsultationConfig>;
  updateConsultationConfig(config: ConsultationConfig): Promise<ConsultationConfig>;
  listRules(): Promise<AvailabilityRule[]>;
  upsertRule(rule: Omit<AvailabilityRule, 'id' | 'doctor_id'> & { id?: string }): Promise<AvailabilityRule>;
  deleteRule(ruleId: string): Promise<void>;
  listExceptions(): Promise<AvailabilityException[]>;
  createException(input: {
    start_utc: string;
    end_utc: string;
    kind: 'leave' | 'block';
    reason: string;
  }): Promise<AvailabilityException>;
  deleteException(exceptionId: string): Promise<void>;
  getPolicy(): Promise<DoctorPolicy>;
  updatePolicy(patch: Partial<DoctorPolicy>): Promise<DoctorPolicy>;
  listCalendarAccounts(): Promise<CalendarAccount[]>;
  /** Simulated OAuth: returns an authorization URL and completes after `completeCalendarConnect`. */
  connectCalendar(provider: CalendarProvider): Promise<{ authorization_url: string; state: string }>;
  completeCalendarConnect(provider: CalendarProvider, email: string): Promise<CalendarAccount>;
  syncCalendar(accountId: string): Promise<{ queued: boolean; job_id: string; busy_events_imported?: number; conflicts: number }>;
  disconnectCalendar(accountId: string): Promise<void>;
  requestDeactivation(reason: string): Promise<{ requested_at: string; future_appointments: number }>;
};

export type DoctorAppointmentsApi = {
  listAppointments(query?: AppointmentListQuery): Promise<Page<Appointment>>;
  getAppointment(appointmentId: string): Promise<Appointment>;
  acceptAppointment(appointmentId: string): Promise<Appointment>;
  declineAppointment(appointmentId: string, reason: string): Promise<Appointment>;
  rescheduleAppointment(appointmentId: string, startUtc: string): Promise<Appointment>;
  cancelAppointment(appointmentId: string, reason: string): Promise<Appointment>;
  completeAppointment(appointmentId: string): Promise<Appointment>;
  markNoShow(appointmentId: string): Promise<Appointment>;
  getPatientContext(appointmentId: string): Promise<PatientContext>;
  listSeenPatients(): Promise<SeenPatient[]>;
  getStats(): Promise<DoctorStats>;
  /** Own availability, used by the doctor's reschedule picker. */
  getOwnAvailability(query?: AvailabilityQuery & { doctor_id?: string }): Promise<AvailabilityResponse>;
};

/** Everything a doctor screen may call. */
export type DoctorApi = AuthApi &
  NotificationApi &
  DoctorScheduleApi &
  DoctorAppointmentsApi & {
    updateProfileFields(patch: Partial<DoctorProfile>): Promise<DoctorProfile>;
    getHealth(): Promise<HealthResponse>;
  };

/** Small helper types the clients use internally. */
export type RequestOptions = { signal?: AbortSignal };

export type { ConsultType };
