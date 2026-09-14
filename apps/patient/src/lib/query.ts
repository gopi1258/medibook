/**
 * TanStack Query wiring (TRD §4.3).
 *
 * Query keys encode the inputs that change a response — including the viewer's
 * timezone, because availability renders per-viewer (PRD R9). Availability is
 * short-lived (30 s) so a stale cache can never be mistaken for truth; every
 * booking sheet refetches on focus.
 */
import { QueryClient } from '@tanstack/react-query';
import type { AppointmentListQuery, AvailabilityQuery, DoctorQuery } from '@medibook/core';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: 1,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}

export const queryKeys = {
  health: ['health'] as const,
  specializations: ['specializations'] as const,
  doctors: (query: DoctorQuery, tz: string) => ['doctors', query, tz] as const,
  doctor: (doctorId: string) => ['doctor', doctorId] as const,
  availability: (doctorId: string, query: AvailabilityQuery, tz: string) =>
    ['availability', doctorId, query, tz] as const,
  appointments: (query: AppointmentListQuery, tz: string) => ['appointments', query, tz] as const,
  appointment: (appointmentId: string) => ['appointment', appointmentId] as const,
  profile: ['patient', 'profile'] as const,
  dependents: ['patient', 'dependents'] as const,
  savedDoctors: ['patient', 'saved-doctors'] as const,
  notifications: (unreadOnly: boolean) => ['notifications', { unreadOnly }] as const,
  notificationPreferences: ['notifications', 'preferences'] as const,
} as const;
