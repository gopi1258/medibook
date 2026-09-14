/**
 * Shared query hooks.
 *
 * Screens use these instead of calling `useQuery` directly so query keys (and
 * therefore cache invalidation) are defined in exactly one place.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AppointmentListQuery,
  AvailabilityQuery,
  CancelRequest,
  CreateAppointmentRequest,
  DoctorQuery,
  PatientProfile,
  PaymentMethod,
  PostVisitReviewRequest,
} from '@medibook/core';

import { patientApi } from './api';
import { queryKeys } from './query';
import { useViewerTimeZone } from './session';

export function useSpecializations() {
  return useQuery({
    queryKey: queryKeys.specializations,
    queryFn: () => patientApi.listSpecializations(),
    staleTime: 5 * 60_000,
  });
}

export function useDoctors(query: DoctorQuery = {}) {
  const tz = useViewerTimeZone();
  return useQuery({
    queryKey: queryKeys.doctors(query, tz),
    queryFn: () => patientApi.listDoctors(query),
  });
}

export function useDoctor(doctorId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.doctor(doctorId ?? 'unknown'),
    queryFn: () => patientApi.getDoctor(doctorId as string),
    enabled: Boolean(doctorId),
  });
}

export function useAvailability(doctorId: string | undefined, query: AvailabilityQuery = {}) {
  const tz = useViewerTimeZone();
  return useQuery({
    queryKey: queryKeys.availability(doctorId ?? 'unknown', query, tz),
    queryFn: () => patientApi.getAvailability(doctorId as string, { ...query, tz }),
    enabled: Boolean(doctorId),
    staleTime: 30_000,
  });
}

export function useAppointments(query: AppointmentListQuery = {}) {
  const tz = useViewerTimeZone();
  return useQuery({
    queryKey: queryKeys.appointments(query, tz),
    queryFn: () => patientApi.listAppointments(query),
  });
}

export function useAppointment(appointmentId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.appointment(appointmentId ?? 'unknown'),
    queryFn: () => patientApi.getAppointment(appointmentId as string),
    enabled: Boolean(appointmentId),
  });
}

export function usePatientProfile() {
  return useQuery({
    queryKey: queryKeys.profile,
    queryFn: () => patientApi.getProfile(),
    staleTime: 5 * 60_000,
  });
}

export function useDependents() {
  return useQuery({
    queryKey: queryKeys.dependents,
    queryFn: () => patientApi.listDependents(),
  });
}

export function useSavedDoctors() {
  const tz = useViewerTimeZone();
  return useQuery({
    queryKey: [...queryKeys.savedDoctors, tz],
    queryFn: () => patientApi.listSavedDoctors(),
  });
}

export function useNotifications(unreadOnly = false) {
  return useQuery({
    queryKey: queryKeys.notifications(unreadOnly),
    queryFn: () => patientApi.listNotifications({ limit: 50, unread_only: unreadOnly || undefined }),
  });
}

export function useNotificationPreferences() {
  return useQuery({
    queryKey: queryKeys.notificationPreferences,
    queryFn: () => patientApi.getNotificationPreferences(),
  });
}

/* ------------------------------------------------------------- mutations */

function useRefreshAll() {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['appointments'] }),
      queryClient.invalidateQueries({ queryKey: ['appointment'] }),
      queryClient.invalidateQueries({ queryKey: ['notifications'] }),
    ]);
  };
}

export function useCreateAppointment() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: (input: { body: CreateAppointmentRequest; idempotencyKey: string }) =>
      patientApi.createAppointment(input.body, input.idempotencyKey),
    onSuccess: () => void refresh(),
  });
}

export function useRescheduleAppointment() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: (input: { appointmentId: string; startUtc: string; idempotencyKey: string }) =>
      patientApi.rescheduleAppointment(input.appointmentId, input.startUtc, input.idempotencyKey),
    onSuccess: () => void refresh(),
  });
}

export function useCancelAppointment() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: (input: { appointmentId: string; body: CancelRequest; idempotencyKey: string }) =>
      patientApi.cancelAppointment(input.appointmentId, input.body, input.idempotencyKey),
    onSuccess: () => void refresh(),
  });
}

export function useSubmitReview() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: (input: { appointmentId: string; body: PostVisitReviewRequest }) =>
      patientApi.submitReview(input.appointmentId, input.body),
    onSuccess: () => void refresh(),
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<PatientProfile>) => patientApi.updateProfile(patch),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.profile }),
  });
}

export function usePayForAppointment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { appointmentId: string; method: PaymentMethod }) =>
      patientApi.payForAppointment(input.appointmentId, input.method),
    onSuccess: (_payment, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.appointment(variables.appointmentId) });
      void queryClient.invalidateQueries({ queryKey: ['appointments'] });
    },
  });
}

export function useSetSavedDoctor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { doctorId: string; saved: boolean }) =>
      patientApi.setSavedDoctor(input.doctorId, input.saved),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['doctors'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.savedDoctors });
    },
  });
}
