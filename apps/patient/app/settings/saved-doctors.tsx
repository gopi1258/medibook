/**
 * Saved doctors (PAT-006) — the favourites surfaced on Home and Discover.
 *
 * A doctor who has been suspended or deactivated disappears from the API's
 * verified-only listings, so the empty state explains the disappearance rather
 * than silently dropping their card.
 */
import * as React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import { toDoctorCardModel } from '@medibook/core';
import { DoctorCard, EmptyState, Screen, ScreenHeader, Text, spacing } from '@medibook/brand';

import { useSavedDoctors, useSetSavedDoctor } from '../../src/lib/hooks';
import { useViewerTimeZone } from '../../src/lib/session';
import { useNow } from '../../src/lib/useNow';
import { ErrorState, ListSkeleton } from '../../src/components/states';

export default function SavedDoctorsScreen() {
  const router = useRouter();
  const viewerTz = useViewerTimeZone();
  const now = useNow(60_000);
  const saved = useSavedDoctors();
  const setSaved = useSetSavedDoctor();

  return (
    <Screen
      scroll
      edges={['top']}
      contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.huge }}
      refreshing={saved.isRefetching && !saved.isLoading}
      onRefresh={() => void saved.refetch()}
    >
      <ScreenHeader title="Saved doctors" subtitle="One-tap rebooking" onBack={() => router.back()} />

      {saved.isLoading ? (
        <ListSkeleton count={3} />
      ) : saved.isError ? (
        <ErrorState error={saved.error} onRetry={() => void saved.refetch()} />
      ) : (saved.data ?? []).length === 0 ? (
        <EmptyState
          icon="heart"
          title="No saved doctors yet"
          description="Tap the heart on any doctor card to keep them here. Saved doctors also appear first on Home."
          actionLabel="Find a doctor"
          onAction={() => router.replace('/(tabs)/discover')}
        />
      ) : (
        <View style={{ gap: spacing.md }}>
          {(saved.data ?? []).map((doctor) => (
            <DoctorCard
              key={doctor.id}
              doctor={toDoctorCardModel(doctor, { viewerTz, nowMs: now })}
              onPress={() => router.push(`/doctor/${doctor.id}`)}
              onToggleFavorite={() => setSaved.mutate({ doctorId: doctor.id, saved: false })}
            />
          ))}
        </View>
      )}

      <Text variant="caption">
        Doctors who are suspended or deactivated are removed from listings and from this list, because MediBook never
        shows unverifiable supply.
      </Text>
    </Screen>
  );
}
