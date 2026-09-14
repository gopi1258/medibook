/**
 * Patients (PRD §7.2 / DOC-015) — the list of patients this doctor has actually
 * seen, each linking to the scoped context for their appointments.
 *
 * Scoping is enforced by the API: only visits with *this* doctor are visible, and
 * there is no cross-doctor history. The screen says so, because a doctor should
 * know the boundary rather than assume it.
 */
import * as React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  ListRow,
  PolicyNote,
  Screen,
  ScreenHeader,
  SectionHeading,
  Text,
  color,
  spacing,
} from '@medibook/brand';

import { useDoctorAppointments, useSeenPatients } from '../../src/lib/hooks';
import { useClinicTimeZone } from '../../src/lib/session';
import { useNow } from '../../src/lib/useNow';
import { ageLabel, appointmentTimeLabel, genderLabel, relativeTimeLabel } from '../../src/lib/format';
import { ErrorState, ListSkeleton } from '../../src/components/states';

export default function PatientsScreen() {
  const router = useRouter();
  const clinicTz = useClinicTimeZone();
  const now = useNow(60_000);

  const seen = useSeenPatients();
  const recent = useDoctorAppointments({ scope: 'past', limit: 20 });

  const patients = seen.data ?? [];

  return (
    <Screen
      scroll
      edges={['top']}
      contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.huge }}
      refreshing={seen.isRefetching && !seen.isLoading}
      onRefresh={() => void seen.refetch()}
    >
      <ScreenHeader title="Patients" subtitle={`${patients.length} seen with you`} />

      <PolicyNote
        tone="info"
        title="Scope of what you can see"
        body="Only patients you have actually seen, and only their history with you — no visits with other clinicians, ever. Phone numbers stay masked unless the patient shares them."
      />

      {seen.isLoading ? (
        <ListSkeleton count={4} />
      ) : seen.isError ? (
        <ErrorState error={seen.error} onRetry={() => void seen.refetch()} />
      ) : patients.length === 0 ? (
        <EmptyState
          icon="users"
          title="No patients yet"
          description="Patients appear here once you have completed a consultation with them. Open a past appointment to record the outcome."
          actionLabel="Open appointments"
          onAction={() => router.push({ pathname: '/(tabs)/appointments', params: { scope: 'past' } })}
        />
      ) : (
        <View style={{ gap: spacing.md }}>
          {patients.map((patient) => (
            <Card key={`${patient.patient_user_id}:${patient.dependent_id ?? 'self'}`} style={{ gap: spacing.md }}>
              <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
                <Avatar name={patient.display_name} size="md" tone={patient.dependent_id ? 'mint' : 'peach'} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="h3">{patient.display_name}</Text>
                  <Text variant="small">
                    {ageLabel(patient.age)} · {genderLabel(patient.gender)}
                    {patient.dependent_id ? ' · family member' : ''}
                  </Text>
                  <Text variant="caption">
                    Last seen {relativeTimeLabel(Date.parse(patient.last_seen_utc), clinicTz, now)}
                  </Text>
                </View>
              </View>

              <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
                <Badge label={`${patient.visits_with_doctor} visit${patient.visits_with_doctor === 1 ? '' : 's'}`} tone="neutral" icon="calendar-check" />
                {patient.no_show_count_with_doctor > 0 ? (
                  <Badge label={`${patient.no_show_count_with_doctor} no-show`} tone="danger" icon="alert-circle" />
                ) : (
                  <Badge label="No no-shows" tone="verified" icon="check-circle" />
                )}
              </View>
            </Card>
          ))}
        </View>
      )}

      <View style={{ gap: spacing.md }}>
        <SectionHeading title="Recently closed visits" />
        {recent.isLoading ? (
          <ListSkeleton count={2} />
        ) : (recent.data?.items ?? []).length === 0 ? (
          <Text variant="small">Nothing closed out yet.</Text>
        ) : (
          <Card variant="flat">
            {(recent.data?.items ?? []).slice(0, 6).map((appointment) => (
              <ListRow
                key={appointment.id}
                title={appointment.for_name}
                subtitle={`${appointmentTimeLabel(appointment, clinicTz, now)} · ${appointment.status.replace(/_/g, ' ')}`}
                icon="user"
                onPress={() => router.push(`/appointment/${appointment.id}`)}
              />
            ))}
          </Card>
        )}
      </View>

      <Card variant="flat" style={{ backgroundColor: color.surfaceAlt, gap: spacing.xs }}>
        <Text variant="bodyStrong">Patient context, not a record</Text>
        <Text variant="small">
          Each appointment opens the patient’s name, age, gender, your booking note and their visit history with you. There
          is no diagnosis, prescription or attachment storage anywhere in MediBook.
        </Text>
        <Button
          label="Open today’s timeline"
          variant="ghost"
          size="sm"
          block={false}
          onPress={() => router.replace('/(tabs)')}
        />
      </Card>
    </Screen>
  );
}
