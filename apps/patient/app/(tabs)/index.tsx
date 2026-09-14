/**
 * Home (PRD §7.1) — greeting, next-appointment card with join/reschedule/cancel
 * shortcuts, quick actions, specialty chips and top-rated doctors.
 *
 * Every block has a real loading, empty and error state; the screen never renders
 * a blank shell.
 */
import * as React from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import {
  AppointmentCard,
  Button,
  Card,
  Chip,
  ChipRow,
  DoctorCard,
  Icon,
  ListRow,
  Screen,
  ScreenHeader,
  SectionHeading,
  Text,
  color,
  spacing,
} from '@medibook/brand';
import { toAppointmentCardModel, toDoctorCardModel } from '@medibook/core';

import { patientApi } from '../../src/lib/api';
import { queryKeys } from '../../src/lib/query';
import { useCurrentUser, useViewerTimeZone } from '../../src/lib/session';
import { describeError } from '../../src/lib/format';
import { useNow } from '../../src/lib/useNow';
import { ErrorState, ListSkeleton } from '../../src/components/states';

export default function HomeScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useCurrentUser();
  const viewerTz = useViewerTimeZone();
  const now = useNow(30_000);

  const specialties = useQuery({
    queryKey: queryKeys.specializations,
    queryFn: () => patientApi.listSpecializations(),
    staleTime: 5 * 60_000,
  });

  const upcoming = useQuery({
    queryKey: queryKeys.appointments({ scope: 'upcoming' }, viewerTz),
    queryFn: () => patientApi.listAppointments({ scope: 'upcoming', limit: 5 }),
  });

  const topDoctors = useQuery({
    queryKey: queryKeys.doctors({ sort: 'rating', limit: 4 }, viewerTz),
    queryFn: () => patientApi.listDoctors({ sort: 'rating', limit: 4 }),
  });

  const refresh = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['appointments'] });
    void queryClient.invalidateQueries({ queryKey: ['doctors'] });
  }, [queryClient]);

  const nextAppointment = upcoming.data?.items[0] ?? null;
  const firstName = (user?.display_name ?? 'there').split(' ')[0] ?? 'there';
  const hour = new Date(now).getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <Screen
      scroll
      edges={['top']}
      contentContainerStyle={{ gap: spacing.xl, paddingBottom: spacing.huge }}
      refreshing={upcoming.isRefetching && !upcoming.isLoading}
      onRefresh={refresh}
    >
      <ScreenHeader
        title={`${greeting}, ${firstName}`}
        subtitle="Here is what is coming up"
        action={{ icon: 'bell', onPress: () => router.push('/(tabs)/alerts'), accessibilityLabel: 'Alerts' }}
      />

      <View style={{ gap: spacing.md }}>
        <SectionHeading title="Next appointment" />
        {upcoming.isLoading ? (
          <ListSkeleton count={1} />
        ) : upcoming.isError ? (
          <ErrorState error={upcoming.error} onRetry={() => void upcoming.refetch()} compact />
        ) : nextAppointment ? (
          <AppointmentCard
            appointment={toAppointmentCardModel(nextAppointment, { viewerTz, nowMs: now })}
            onPress={() => router.push(`/appointment/${nextAppointment.id}`)}
            onJoin={() => router.push(`/appointment/${nextAppointment.id}`)}
            onReschedule={() => router.push(`/appointment/${nextAppointment.id}/reschedule`)}
            onCancel={() => router.push(`/appointment/${nextAppointment.id}/cancel`)}
            onDirections={() => router.push(`/appointment/${nextAppointment.id}`)}
          />
        ) : (
          <Card variant="peach" style={{ gap: spacing.sm }}>
            <Text variant="h3">No visits booked yet</Text>
            <Text variant="small">
              Book your first appointment and it will show up here with a join or directions button at the right time.
            </Text>
            <ListRow
              title="Find a doctor"
              subtitle="Search by specialty, fee or availability today"
              icon="search"
              onPress={() => router.push('/(tabs)/discover')}
            />
          </Card>
        )}
      </View>

      <View style={{ gap: spacing.md }}>
        <SectionHeading title="Quick actions" />
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <QuickAction
            icon="stethoscope"
            title="Book by specialty"
            onPress={() => router.push('/(tabs)/discover')}
          />
          <QuickAction
            icon="refresh"
            title="Rebook last doctor"
            onPress={() => router.push('/(tabs)/appointments')}
          />
          <QuickAction icon="users" title="For family" onPress={() => router.push('/family')} />
        </View>
      </View>

      <View style={{ gap: spacing.md }}>
        <SectionHeading
          title="Specialties"
          action={
            <Button
              label="See all"
              variant="ghost"
              size="sm"
              block={false}
              onPress={() => router.push('/(tabs)/discover')}
            />
          }
        />
        {specialties.isLoading ? (
          <ListSkeleton count={0} chips />
        ) : specialties.isError ? (
          <ErrorState error={specialties.error} onRetry={() => void specialties.refetch()} compact />
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
            <ChipRow>
              {(specialties.data ?? [])
                .filter((specialization) => specialization.is_active)
                .slice(0, 10)
                .map((specialization) => (
                  <Chip
                    key={specialization.id}
                    label={specialization.name}
                    icon="stethoscope"
                    onPress={() =>
                      router.push({
                        pathname: '/(tabs)/discover',
                        params: { specialization: specialization.slug },
                      })
                    }
                  />
                ))}
            </ChipRow>
          </ScrollView>
        )}
      </View>

      <View style={{ gap: spacing.md }}>
        <SectionHeading title="Top rated near you" />
        {topDoctors.isLoading ? (
          <ListSkeleton count={2} />
        ) : topDoctors.isError ? (
          <ErrorState error={topDoctors.error} onRetry={() => void topDoctors.refetch()} compact />
        ) : (topDoctors.data?.items.length ?? 0) === 0 ? (
          <Text variant="small">No verified doctors match yet. Try another specialty.</Text>
        ) : (
          <View style={{ gap: spacing.md }}>
            {topDoctors.data?.items.slice(0, 3).map((doctor) => (
              <DoctorCard
                key={doctor.id}
                doctor={toDoctorCardModel(doctor, { viewerTz, nowMs: now })}
                compact
                onPress={() => router.push(`/doctor/${doctor.id}`)}
                onToggleFavorite={() => void toggleSaved(doctor.id, doctor.is_favorite === true, queryClient)}
              />
            ))}
          </View>
        )}
      </View>

      <Card variant="flat" style={{ backgroundColor: color.surfaceAlt, gap: spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Icon name="sparkle" size={20} color={color.primaryStrong} />
          <Text variant="bodyStrong">Health tip</Text>
        </View>
        <Text variant="small">
          Carry your previous prescriptions and a list of current medicines to in-clinic visits. It saves the doctor time
          and you money.
        </Text>
      </Card>

      {upcoming.isError && !nextAppointment ? (
        <Text variant="caption">{describeError(upcoming.error).message}</Text>
      ) : null}
    </Screen>
  );
}

function QuickAction({ icon, title, onPress }: { icon: 'stethoscope' | 'refresh' | 'users'; title: string; onPress: () => void }) {
  return (
    <Card variant="flat" onPress={onPress} accessibilityLabel={title} style={{ flex: 1, gap: spacing.sm, alignItems: 'flex-start' }}>
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: color.primaryTint,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} size={20} color={color.primary} />
      </View>
      <Text variant="smallMedium">{title}</Text>
    </Card>
  );
}

async function toggleSaved(
  doctorId: string,
  currentlySaved: boolean,
  queryClient: ReturnType<typeof useQueryClient>,
): Promise<void> {
  await patientApi.setSavedDoctor(doctorId, !currentlySaved);
  await queryClient.invalidateQueries({ queryKey: ['doctors'] });
  await queryClient.invalidateQueries({ queryKey: queryKeys.savedDoctors });
}
