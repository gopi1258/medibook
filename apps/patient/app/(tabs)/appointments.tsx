/**
 * Appointments (PRD §7.1 / APT-005) — Upcoming/Past segmented list with a
 * family-member filter, plus the per-member history view (X2).
 *
 * Grouping is timezone-correct: "upcoming" is the doctor-side active status set
 * with a 15-minute grace, exactly as `@medibook/core`'s `toAppointmentCardModel`
 * expects, and every card carries an explicit tz label.
 */
import * as React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import {
  AppointmentCard,
  Card,
  Chip,
  ChipRow,
  EmptyState,
  Screen,
  ScreenHeader,
  SectionHeading,
  SegmentedControl,
  Text,
  color,
  spacing,
} from '@medibook/brand';
import { toAppointmentCardModel } from '@medibook/core';

import { useAppointments, useDependents } from '../../src/lib/hooks';
import { useCurrentUser, useViewerTimeZone } from '../../src/lib/session';
import { useNow } from '../../src/lib/useNow';
import { ErrorState, ListSkeleton } from '../../src/components/states';

type Scope = 'upcoming' | 'past';

export default function AppointmentsScreen() {
  const router = useRouter();
  const user = useCurrentUser();
  const viewerTz = useViewerTimeZone();
  const now = useNow(30_000);
  const params = useLocalSearchParams<{ scope?: string }>();

  const [scope, setScope] = React.useState<Scope>(params.scope === 'past' ? 'past' : 'upcoming');
  const [member, setMember] = React.useState<string>('all');

  const dependents = useDependents();
  const query = React.useMemo(
    () => ({ scope, member: member === 'all' ? undefined : member, limit: 50 }),
    [scope, member],
  );
  const appointments = useAppointments(query);

  const items = appointments.data?.items ?? [];
  const selfLabel = user?.display_name?.split(' ')[0] ?? 'Me';

  return (
    <Screen edges={['top']} contentContainerStyle={{ gap: spacing.lg }}>
      <ScreenHeader title="Appointments" subtitle="Everything for you and your family" />

      <SegmentedControl
        accessibilityLabel="Appointment list view"
        options={[
          { value: 'upcoming', label: 'Upcoming' },
          { value: 'past', label: 'Past' },
        ]}
        value={scope}
        onChange={(next) => setScope(next as Scope)}
      />

      <View style={{ gap: spacing.sm }}>
        <SectionHeading title="Family view" />
        <ChipRow>
          <Chip label="Everyone" selected={member === 'all'} onPress={() => setMember('all')} />
          <Chip label={`${selfLabel} (me)`} selected={member === 'self'} onPress={() => setMember('self')} />
          {(dependents.data ?? []).map((dependent) => (
            <Chip
              key={dependent.id}
              label={dependent.name.split(' ')[0] ?? dependent.name}
              meta={dependent.upcoming_appointments ? String(dependent.upcoming_appointments) : undefined}
              selected={member === dependent.id}
              onPress={() => setMember(dependent.id)}
            />
          ))}
          <Chip label="Manage" icon="user-plus" onPress={() => router.push('/family')} />
        </ChipRow>
      </View>

      {appointments.isLoading ? (
        <ListSkeleton count={3} />
      ) : appointments.isError ? (
        <ErrorState error={appointments.error} onRetry={() => void appointments.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="calendar"
          title={scope === 'upcoming' ? 'Nothing coming up' : 'No past visits yet'}
          description={
            scope === 'upcoming'
              ? 'When you book a visit it appears here with join, reschedule and cancel actions.'
              : 'Once a consultation is completed it moves here — and you can rate it.'
          }
          actionLabel="Find a doctor"
          onAction={() => router.push('/(tabs)/discover')}
          secondaryActionLabel={member !== 'all' ? 'Show everyone' : undefined}
          onSecondaryAction={member !== 'all' ? () => setMember('all') : undefined}
        />
      ) : (
        <View style={{ gap: spacing.md }}>
          {items.map((appointment) => (
            <AppointmentCard
              key={appointment.id}
              appointment={toAppointmentCardModel(appointment, { viewerTz, nowMs: now })}
              onPress={() => router.push(`/appointment/${appointment.id}`)}
              onJoin={() => router.push(`/appointment/${appointment.id}`)}
              onReschedule={() => router.push(`/appointment/${appointment.id}/reschedule`)}
              onCancel={() => router.push(`/appointment/${appointment.id}/cancel`)}
              onRate={() => router.push(`/appointment/${appointment.id}/review`)}
              onDirections={() => router.push(`/appointment/${appointment.id}`)}
            />
          ))}
        </View>
      )}

      {scope === 'past' && items.length > 0 ? (
        <Card variant="flat" style={{ backgroundColor: color.surfaceAlt, gap: spacing.xs }}>
          <Text variant="bodyStrong">Rebooking is one tap</Text>
          <Text variant="small">
            Open any past visit and use Rebook — we pre-fill the doctor and consultation type so you only pick a time.
          </Text>
        </Card>
      ) : null}
    </Screen>
  );
}
