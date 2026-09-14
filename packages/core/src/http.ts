/**
 * HTTP implementation of the MediBook service contract.
 *
 * Used when `EXPO_PUBLIC_API_URL` is set. It mirrors the behaviours the TRD
 * requires of a client (TRD §4.4):
 *   - bearer access token injection;
 *   - single-flight silent refresh on `401`, then one retry;
 *   - idempotency keys on slot/money-affecting writes;
 *   - GET-only automatic retry with backoff (POSTs are never blind-retried);
 *   - typed `ApiError` mapping for every failure.
 */
import { ApiError, isAuthError } from './errors.ts';
import type { DoctorApi, HttpMethod, PatientApi } from './api.ts';
import type {
  Appointment,
  AppointmentListQuery,
  AuthSession,
  AuthUser,
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
} from './types.ts';

export type TokenBundle = { accessToken: string | null; refreshToken: string | null };

export type HttpApiOptions = {
  /** e.g. `http://localhost:4000/v1` */
  baseUrl: string;
  /** Read the current tokens (memory + SecureStore in the apps). */
  getTokens?: () => TokenBundle;
  /** Persist rotated tokens. */
  onTokens?: (tokens: AuthSession) => void | Promise<void>;
  /** Called when refresh fails — the apps wipe session state. */
  onSignOut?: () => void | Promise<void>;
  /** Injectable for tests / non-global fetch runtimes. */
  fetchImpl?: typeof fetch;
  /** Milliseconds before a request is considered timed out. */
  timeoutMs?: number;
};

type RequestOptions = {
  method: HttpMethod;
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  idempotencyKey?: string;
  auth?: boolean;
  retry?: boolean;
  signal?: AbortSignal;
  /** Unwrap a `{ appointment: … }` envelope (single-appointment endpoints). */
  unwrapAppointment?: boolean;
};

function buildQuery(query: RequestOptions['query']): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === '') continue;
    params.append(key, String(value));
  }
  const serialised = params.toString();
  return serialised ? `?${serialised}` : '';
}

/**
 * Build the HTTP-backed patient + doctor APIs.
 */
export function createHttpApi(options: HttpApiOptions): { patient: PatientApi; doctor: DoctorApi } {
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  let tokens: TokenBundle = { accessToken: null, refreshToken: null };
  let refreshInFlight: Promise<AuthSession> | null = null;

  const readTokens = (): TokenBundle => (options.getTokens ? options.getTokens() : tokens);

  const writeTokens = async (session: AuthSession): Promise<void> => {
    tokens = { accessToken: session.access_token, refreshToken: session.refresh_token };
    await options.onTokens?.(session);
  };

  async function rawRequest<T>(request: RequestOptions, bearer: string | null): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    request.signal?.addEventListener('abort', onAbort);

    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (request.body !== undefined) headers['Content-Type'] = 'application/json';
      if (bearer) headers['Authorization'] = `Bearer ${bearer}`;
      if (request.idempotencyKey) headers['Idempotency-Key'] = request.idempotencyKey;

      const response = await doFetch(`${options.baseUrl}${request.path}${buildQuery(request.query)}`, {
        method: request.method,
        headers,
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: controller.signal,
      });

      if (response.status === 204) return undefined as T;

      const text = await response.text();
      const parsed: unknown = text.length > 0 ? JSON.parse(text) : undefined;

      if (!response.ok) throw ApiError.fromBody(parsed, response.status);

      // Single-appointment endpoints answer with `{ "appointment": {…} }`.
      if (request.unwrapAppointment && parsed && typeof parsed === 'object' && 'appointment' in parsed) {
        return (parsed as { appointment: T }).appointment;
      }
      return parsed as T;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new ApiError('SYS_INTERNAL', 'The request timed out. Check your connection and retry.');
      }
      throw new ApiError('SYS_INTERNAL', 'Could not reach MediBook. Check your connection.');
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', onAbort);
    }
  }

  /** Single-flight refresh: concurrent 401s share one refresh call. */
  async function refreshTokens(): Promise<AuthSession> {
    if (refreshInFlight) return refreshInFlight;
    const current = readTokens();
    if (!current.refreshToken) throw new ApiError('AUTH_INVALID_REFRESH', 'Please sign in again.');

    refreshInFlight = rawRequest<AuthSession>(
      { method: 'POST', path: '/auth/refresh', body: { refresh_token: current.refreshToken }, auth: false },
      null,
    )
      .then(async (session) => {
        await writeTokens(session);
        return session;
      })
      .finally(() => {
        refreshInFlight = null;
      });

    return refreshInFlight;
  }

  async function request<T>(request: RequestOptions): Promise<T> {
    const needsAuth = request.auth !== false;
    const current = readTokens();

    try {
      return await rawRequest<T>(request, needsAuth ? current.accessToken : null);
    } catch (error) {
      if (isAuthError(error) && needsAuth) {
        try {
          const session = await refreshTokens();
          return await rawRequest<T>(request, session.access_token);
        } catch {
          await options.onSignOut?.();
          throw new ApiError('AUTH_REQUIRED', 'Your session expired. Please sign in again.');
        }
      }

      // Idempotent reads get one retry with backoff; writes never blind-retry.
      const canRetry = request.method === 'GET' && request.retry !== false;
      if (canRetry && error instanceof ApiError && error.status >= 500) {
        await delay(400);
        return rawRequest<T>(request, needsAuth ? readTokens().accessToken : null);
      }
      throw error;
    }
  }

  const get = <T>(path: string, query?: RequestOptions['query'], signal?: AbortSignal) =>
    request<T>({ method: 'GET', path, query, signal });
  const post = <T>(path: string, body?: unknown, extra: Partial<RequestOptions> = {}) =>
    request<T>({ method: 'POST', path, body, ...extra });
  const patch = <T>(path: string, body?: unknown, extra: Partial<RequestOptions> = {}) =>
    request<T>({ method: 'PATCH', path, body, ...extra });
  const put = <T>(path: string, body?: unknown) => request<T>({ method: 'PUT', path, body });
  const del = <T>(path: string, extra: Partial<RequestOptions> = {}) =>
    request<T>({ method: 'DELETE', path, ...extra });

  const auth: Pick<PatientApi, 'requestOtp' | 'verifyOtp' | 'refresh' | 'logout' | 'me'> = {
    requestOtp: (input: OtpRequest) => post<void>('/auth/otp/request', input, { auth: false }),
    verifyOtp: async (input: OtpVerifyRequest) => {
      const session = await post<AuthSession>('/auth/otp/verify', input, { auth: false });
      await writeTokens(session);
      return session;
    },
    refresh: async (refreshToken: string) => {
      const session = await rawRequest<AuthSession>(
        { method: 'POST', path: '/auth/refresh', body: { refresh_token: refreshToken } },
        null,
      );
      await writeTokens(session);
      return session;
    },
    logout: async () => {
      try {
        await post<void>('/auth/logout');
      } finally {
        tokens = { accessToken: null, refreshToken: null };
      }
    },
    me: () => get<AuthUser>('/auth/me'),
  };

  const discovery: Pick<
    PatientApi,
    'listSpecializations' | 'listDoctors' | 'getDoctor' | 'getAvailability'
  > = {
    listSpecializations: () => get<Specialization[]>('/specializations', undefined),
    listDoctors: (query: DoctorQuery = {}) =>
      get<Page<DoctorSummary>>('/doctors', {
        q: query.q,
        specialization: query.specialization,
        consult_type: query.consult_type,
        available: query.available,
        fee_min_minor: query.fee_min_minor,
        fee_max_minor: query.fee_max_minor,
        language: query.language,
        gender: query.gender,
        sort: query.sort,
        limit: query.limit,
        cursor: query.cursor,
      }),
    getDoctor: (doctorId: string) => get<DoctorDetail>(`/doctors/${doctorId}`),
    getAvailability: (doctorId: string, query: AvailabilityQuery = {}) =>
      get<AvailabilityResponse>(`/doctors/${doctorId}/availability`, {
        tz: query.tz,
        from: query.from,
        to: query.to,
        type: query.type,
      }),
  };

  const notifications: Pick<
    PatientApi,
    | 'listNotifications'
    | 'markNotificationRead'
    | 'markAllNotificationsRead'
    | 'getNotificationPreferences'
    | 'updateNotificationPreferences'
  > = {
    listNotifications: (query = {}) =>
      get<Page<AppNotification>>('/notifications', { limit: query.limit, unread_only: query.unread_only }),
    markNotificationRead: (notificationId: string) => post<void>(`/notifications/${notificationId}/read`),
    markAllNotificationsRead: () => post<void>('/notifications/read-all'),
    getNotificationPreferences: () => get<NotificationPreference>('/notifications/preferences'),
    updateNotificationPreferences: (patchBody: Partial<NotificationPreference>) =>
      put<NotificationPreference>('/notifications/preferences', patchBody),
  };

  const patientProfile: Pick<
    PatientApi,
    | 'getProfile'
    | 'updateProfile'
    | 'listDependents'
    | 'createDependent'
    | 'updateDependent'
    | 'deleteDependent'
    | 'listSavedDoctors'
    | 'setSavedDoctor'
    | 'requestAccountDeletion'
  > = {
    getProfile: () => get<PatientProfile>('/patients/me'),
    updateProfile: (patchBody: Partial<PatientProfile>) => patch<PatientProfile>('/patients/me', patchBody),
    listDependents: () => get<Dependent[]>('/patients/me/dependents'),
    createDependent: (input) =>
      post<Dependent>('/patients/me/dependents', input, {
        idempotencyKey: cryptoRandomIdempotencyKey(),
      }),
    updateDependent: (dependentId: string, patchBody: Partial<Dependent>) =>
      patch<Dependent>(`/patients/me/dependents/${dependentId}`, patchBody),
    deleteDependent: (dependentId: string) => del<void>(`/patients/me/dependents/${dependentId}`),
    listSavedDoctors: () => get<DoctorSummary[]>('/patients/me/saved-doctors'),
    setSavedDoctor: (doctorId: string, saved: boolean) =>
      post<{ doctor_id: string; saved: boolean }>(
        `/patients/me/saved-doctors/${doctorId}`,
        { saved },
        { idempotencyKey: cryptoRandomIdempotencyKey() },
      ),
    requestAccountDeletion: (reason?: string) =>
      post<{ requested_at: string; resolve_first: string[] }>(
        '/patients/me/deletion-request',
        { reason },
        { idempotencyKey: cryptoRandomIdempotencyKey() },
      ),
  };

  const booking: Pick<
    PatientApi,
    | 'createHold'
    | 'releaseHold'
    | 'createAppointment'
    | 'payForAppointment'
    | 'reschedulePreview'
    | 'rescheduleAppointment'
    | 'cancelPreview'
    | 'cancelAppointment'
    | 'submitReview'
    | 'listAppointments'
    | 'getAppointment'
    | 'startConsult'
    | 'getHealth'
  > = {
    createHold: (input: CreateHoldRequest) =>
      post<Hold>('/appointments/holds', input, { idempotencyKey: cryptoRandomIdempotencyKey() }),
    releaseHold: (holdId: string) => del<void>(`/appointments/holds/${holdId}`),
    createAppointment: (input: CreateAppointmentRequest, idempotencyKey: string) =>
      post<Appointment>('/appointments', input, { idempotencyKey, unwrapAppointment: true }),
    payForAppointment: (appointmentId: string, method: PaymentMethod) =>
      post<Payment>(
        `/payments/intent/${appointmentId}`,
        { method },
        { idempotencyKey: cryptoRandomIdempotencyKey() },
      ),
    reschedulePreview: (appointmentId: string) =>
      get<{
        allowed: boolean;
        reason_code?: string;
        reason?: string;
        remaining_reschedules: number;
        summary: string;
      }>(`/appointments/${appointmentId}/reschedule-policy`),
    rescheduleAppointment: (appointmentId: string, startUtc: string, idempotencyKey: string) =>
      patch<Appointment>(
        `/appointments/${appointmentId}`,
        { start_utc: startUtc },
        { idempotencyKey, unwrapAppointment: true },
      ),
    cancelPreview: (appointmentId: string) =>
      get<{
        refund_percent: 0 | 50 | 100;
        refund_minor: number;
        currency: string;
        summary: string;
        rule: string;
      }>(`/appointments/${appointmentId}/cancellation-policy`),
    // Returns the full CancelResult ({ appointment, refund, policy }) — not unwrapped.
    cancelAppointment: (appointmentId: string, input: CancelRequest, idempotencyKey: string) =>
      del<CancelResult>(`/appointments/${appointmentId}`, { body: input, idempotencyKey }),
    submitReview: (appointmentId: string, input: PostVisitReviewRequest) =>
      post<Review>(`/appointments/${appointmentId}/review`, input, {
        idempotencyKey: cryptoRandomIdempotencyKey(),
      }),
    listAppointments: (query: AppointmentListQuery = {}) =>
      get<Page<Appointment>>('/appointments', {
        scope: query.scope,
        member: query.member,
        doctor_id: query.doctor_id,
        status: query.status,
        limit: query.limit,
        cursor: query.cursor,
      }),
    getAppointment: (appointmentId: string) => get<Appointment>(`/appointments/${appointmentId}`),
    startConsult: async (appointmentId: string) => {
      await post<{ room_token: string }>(`/appointments/${appointmentId}/join-token`, undefined, {
        idempotencyKey: cryptoRandomIdempotencyKey(),
      });
      return get<Appointment>(`/appointments/${appointmentId}`);
    },
    getHealth: () => get<HealthResponse>('/health', undefined),
  };

  const patient = { ...auth, ...discovery, ...notifications, ...patientProfile, ...booking } as PatientApi;

  const doctor: DoctorApi = {
    ...auth,
    ...notifications,

    getProfile: () => get<DoctorProfile>('/doctor/me/profile'),
    updateProfile: (patchBody: Partial<DoctorProfile>) => patch<DoctorProfile>('/doctor/me/profile', patchBody),
    updateProfileFields: (patchBody: Partial<DoctorProfile>) =>
      patch<DoctorProfile>('/doctor/me/profile', patchBody),
    getVerification: () => get<VerificationSubmission>('/doctor/me/verification'),
    submitVerification: (input) => put<VerificationSubmission>('/doctor/me/verification', input),

    getConsultationConfig: () => get<ConsultationConfig>('/doctor/me/consultation-config'),
    updateConsultationConfig: (config: ConsultationConfig) =>
      put<ConsultationConfig>('/doctor/me/consultation-config', config),

    listRules: () => get<AvailabilityRule[]>('/doctor/me/availability/rules'),
    upsertRule: (rule) => post<AvailabilityRule>('/doctor/me/availability/rules', rule),
    deleteRule: (ruleId: string) => del<void>(`/doctor/me/availability/rules/${ruleId}`),
    listExceptions: () => get<AvailabilityException[]>('/doctor/me/availability/exceptions'),
    createException: (input) => post<AvailabilityException>('/doctor/me/availability/exceptions', input),
    deleteException: (exceptionId: string) => del<void>(`/doctor/me/availability/exceptions/${exceptionId}`),

    getPolicy: () => get<DoctorPolicy>('/doctor/me/policy'),
    updatePolicy: (patchBody: Partial<DoctorPolicy>) => put<DoctorPolicy>('/doctor/me/policy', patchBody),

    listCalendarAccounts: () => get<CalendarAccount[]>('/calendar/status'),
    connectCalendar: (provider: CalendarProvider) =>
      post<{ authorization_url: string; state: string }>('/calendar/connect', { provider }),
    completeCalendarConnect: (provider: CalendarProvider, email: string) =>
      post<CalendarAccount>(`/calendar/callback/${provider}`, { email }),
    syncCalendar: (accountId: string) =>
      post<{ queued: boolean; job_id: string; busy_events_imported?: number; conflicts: number }>('/calendar/sync', {
        account_id: accountId,
      }),
    disconnectCalendar: (accountId: string) => del<void>(`/calendar/accounts/${accountId}`),
    requestDeactivation: (reason: string) =>
      post<{ requested_at: string; future_appointments: number }>(
        '/doctor/me/deactivation-request',
        { reason },
        { idempotencyKey: cryptoRandomIdempotencyKey() },
      ),

    listAppointments: (query: AppointmentListQuery = {}) =>
      get<Page<Appointment>>('/appointments', {
        scope: query.scope,
        status: query.status,
        limit: query.limit,
        cursor: query.cursor,
      }),
    getAppointment: (appointmentId: string) => get<Appointment>(`/appointments/${appointmentId}`),
    acceptAppointment: (appointmentId: string) =>
      post<Appointment>(`/appointments/${appointmentId}/accept`, undefined, {
        idempotencyKey: cryptoRandomIdempotencyKey(),
        unwrapAppointment: true,
      }),
    declineAppointment: (appointmentId: string, reason: string) =>
      post<Appointment>(`/appointments/${appointmentId}/decline`, { reason }, {
        idempotencyKey: cryptoRandomIdempotencyKey(),
        unwrapAppointment: true,
      }),
    rescheduleAppointment: (appointmentId: string, startUtc: string) =>
      patch<Appointment>(
        `/appointments/${appointmentId}`,
        { start_utc: startUtc },
        { idempotencyKey: cryptoRandomIdempotencyKey(), unwrapAppointment: true },
      ),
    cancelAppointment: (appointmentId: string, reason: string) =>
      del<Appointment>(`/appointments/${appointmentId}`, {
        body: { reason },
        idempotencyKey: cryptoRandomIdempotencyKey(),
        unwrapAppointment: true,
      }),
    completeAppointment: (appointmentId: string) =>
      post<Appointment>(`/appointments/${appointmentId}/complete`, undefined, {
        idempotencyKey: cryptoRandomIdempotencyKey(),
        unwrapAppointment: true,
      }),
    markNoShow: (appointmentId: string) =>
      post<Appointment>(`/appointments/${appointmentId}/no-show`, undefined, {
        idempotencyKey: cryptoRandomIdempotencyKey(),
        unwrapAppointment: true,
      }),
    getPatientContext: (appointmentId: string) =>
      get<PatientContext>(`/appointments/${appointmentId}/patient-context`),
    listSeenPatients: () => get<SeenPatient[]>('/doctor/me/patients'),
    getStats: () => get<DoctorStats>('/doctor/me/stats'),
    getOwnAvailability: (query: AvailabilityQuery = {}) =>
      get<AvailabilityResponse>('/doctor/me/availability', {
        tz: query.tz,
        from: query.from,
        to: query.to,
        type: query.type,
      }),
    getHealth: () => get<HealthResponse>('/health', undefined),
  };

  return { patient, doctor };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * RFC-4122 v4 idempotency key. Uses `crypto.randomUUID` when available (Hermes
 * with `expo-crypto` polyfill, Node 19+) and falls back to `Math.random`.
 */
export function cryptoRandomIdempotencyKey(): string {
  const globalCrypto = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (globalCrypto && typeof globalCrypto.randomUUID === 'function') return globalCrypto.randomUUID();
  const template = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx';
  return template.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}
