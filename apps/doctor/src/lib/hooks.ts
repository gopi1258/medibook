/**
 * Shared query hooks (doctor side).
 *
 * Every query key lives here so invalidation is one edit away from correctness —
 * e.g. opening a slot on the Schedule tab must refresh the availability the
 * reschedule picker reads.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AppointmentListQuery,
  AvailabilityQuery,
  AvailabilityRule,
  ConsultationConfig,
  DoctorPolicy,
  DoctorProfile,
  NotificationPreference,
} from '@medibook/core';

import { doctorApi, patientApi } from './api';
import { queryKeys } from './query';
import { useClinicTimeZone } from './session';

/**
 * The specialisation catalog is public data on `DiscoveryApi`. The doctor app
 * reads it from the same client seam so both apps agree on the taxonomy.
 */
export function useSpecializations() {
  return useQuery({
    queryKey: queryKeys.specializations,
    queryFn: () => patientApi.listSpecializations(),
    staleTime: 10 * 60_000,
  });
}

export function useDoctorProfile() {
  return useQuery({ queryKey: ['doctor', 'me', 'profile'], queryFn: () => doctorApi.getProfile() });
}

export function useVerification() {
  return useQuery({ queryKey: ['doctor', 'me', 'verification'], queryFn: () => doctorApi.getVerification() });
}

export function useConsultationConfig() {
  return useQuery({ queryKey: ['doctor', 'me', 'fees'], queryFn: () => doctorApi.getConsultationConfig() });
}

export function useRules() {
  return useQuery({ queryKey: ['doctor', 'me', 'rules'], queryFn: () => doctorApi.listRules() });
}

export function useExceptions() {
  return useQuery({ queryKey: ['doctor', 'me', 'exceptions'], queryFn: () => doctorApi.listExceptions() });
}

export function usePolicy() {
  return useQuery({ queryKey: ['doctor', 'me', 'policy'], queryFn: () => doctorApi.getPolicy() });
}

export function useCalendarAccounts() {
  return useQuery({ queryKey: ['doctor', 'me', 'calendar'], queryFn: () => doctorApi.listCalendarAccounts() });
}

export function useStats() {
  return useQuery({
    queryKey: ['doctor', 'me', 'stats'],
    queryFn: () => doctorApi.getStats(),
    refetchInterval: 60_000,
  });
}

export function useSeenPatients() {
  return useQuery({ queryKey: ['doctor', 'me', 'patients'], queryFn: () => doctorApi.listSeenPatients() });
}

export function useDoctorNotifications(unreadOnly = false) {
  return useQuery({
    queryKey: ['notifications', { unreadOnly }],
    queryFn: () => doctorApi.listNotifications({ limit: 50, unread_only: unreadOnly || undefined }),
  });
}

export function useNotificationPreferences() {
  return useQuery({
    queryKey: queryKeys.notificationPreferences,
    queryFn: () => doctorApi.getNotificationPreferences(),
  });
}

export function useDoctorAppointments(query: AppointmentListQuery = {}) {
  const tz = useClinicTimeZone();
  return useQuery({
    queryKey: queryKeys.appointments(query, tz),
    queryFn: () => doctorApi.listAppointments(query),
  });
}

export function useDoctorAppointment(appointmentId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.appointment(appointmentId ?? 'unknown'),
    queryFn: () => doctorApi.getAppointment(appointmentId as string),
    enabled: Boolean(appointmentId),
  });
}

export function usePatientContext(appointmentId: string | undefined) {
  return useQuery({
    queryKey: ['appointment', appointmentId ?? 'unknown', 'patient-context'],
    queryFn: () => doctorApi.getPatientContext(appointmentId as string),
    enabled: Boolean(appointmentId),
  });
}

export function useOwnAvailability(query: AvailabilityQuery = {}) {
  const tz = useClinicTimeZone();
  return useQuery({
    queryKey: ['availability', 'me', query, tz],
    queryFn: () => doctorApi.getOwnAvailability({ ...query, tz }),
    staleTime: 30_000,
  });
}

/* ------------------------------------------------------------- mutations */

function useRefreshAppointments() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['appointments'] }),
      queryClient.invalidateQueries({ queryKey: ['appointment'] }),
      queryClient.invalidateQueries({ queryKey: ['doctor', 'me', 'stats'] }),
      queryClient.invalidateQueries({ queryKey: ['notifications'] }),
      queryClient.invalidateQueries({ queryKey: ['doctor', 'me', 'patients'] }),
    ]);
}

export function useAppointmentAction(action: 'accept' | 'decline' | 'complete' | 'no-show' | 'cancel') {
  const refresh = useRefreshAppointments();
  return useMutation({
    mutationFn: async (input: { appointmentId: string; reason?: string }) => {
      switch (action) {
        case 'accept':
          return doctorApi.acceptAppointment(input.appointmentId);
        case 'decline':
          return doctorApi.declineAppointment(input.appointmentId, input.reason ?? 'Not available');
        case 'complete':
          return doctorApi.completeAppointment(input.appointmentId);
        case 'no-show':
          return doctorApi.markNoShow(input.appointmentId);
        case 'cancel':
          return doctorApi.cancelAppointment(input.appointmentId, input.reason ?? 'Clinic emergency');
      }
    },
    onSuccess: () => void refresh(),
  });
}

export function useRescheduleAppointment() {
  const refresh = useRefreshAppointments();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { appointmentId: string; startUtc: string }) =>
      doctorApi.rescheduleAppointment(input.appointmentId, input.startUtc),
    onSuccess: async () => {
      await refresh();
      await queryClient.invalidateQueries({ queryKey: ['availability'] });
    },
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<DoctorProfile>) => doctorApi.updateProfileFields(patch),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['doctor', 'me', 'profile'] }),
  });
}

export function useUpdateConsultationConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (config: ConsultationConfig) => doctorApi.updateConsultationConfig(config),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['doctor', 'me', 'fees'] });
      void queryClient.invalidateQueries({ queryKey: ['availability'] });
    },
  });
}

export function useUpdatePolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<DoctorPolicy>) => doctorApi.updatePolicy(patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['doctor', 'me', 'policy'] });
      void queryClient.invalidateQueries({ queryKey: ['availability'] });
    },
  });
}

export function useUpsertRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rule: Omit<AvailabilityRule, 'id' | 'doctor_id'> & { id?: string }) => doctorApi.upsertRule(rule),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['doctor', 'me', 'rules'] });
      void queryClient.invalidateQueries({ queryKey: ['availability'] });
    },
  });
}

export function useDeleteRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ruleId: string) => doctorApi.deleteRule(ruleId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['doctor', 'me', 'rules'] });
      void queryClient.invalidateQueries({ queryKey: ['availability'] });
    },
  });
}

export function useCreateException() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { start_utc: string; end_utc: string; kind: 'leave' | 'block'; reason: string }) =>
      doctorApi.createException(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['doctor', 'me', 'exceptions'] });
      void queryClient.invalidateQueries({ queryKey: ['availability'] });
    },
  });
}

export function useDeleteException() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (exceptionId: string) => doctorApi.deleteException(exceptionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['doctor', 'me', 'exceptions'] });
      void queryClient.invalidateQueries({ queryKey: ['availability'] });
    },
  });
}

export function useSyncCalendar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) => doctorApi.syncCalendar(accountId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['doctor', 'me', 'calendar'] });
      void queryClient.invalidateQueries({ queryKey: ['doctor', 'me', 'stats'] });
      void queryClient.invalidateQueries({ queryKey: ['availability'] });
    },
  });
}

export function useDisconnectCalendar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) => doctorApi.disconnectCalendar(accountId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['doctor', 'me', 'calendar'] });
      void queryClient.invalidateQueries({ queryKey: ['doctor', 'me', 'stats'] });
      void queryClient.invalidateQueries({ queryKey: ['availability'] });
    },
  });
}

export function useSubmitVerification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      registration_number: string;
      council: string;
      country: string;
      specialization_slugs: string[];
      documents: Array<{ kind: 'license' | 'government_id' | 'degree'; filename: string }>;
    }) => doctorApi.submitVerification(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['doctor', 'me', 'verification'] });
      void queryClient.invalidateQueries({ queryKey: ['doctor', 'me', 'profile'] });
    },
  });
}

export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<NotificationPreference>) => doctorApi.updateNotificationPreferences(patch),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.notificationPreferences }),
  });
}
