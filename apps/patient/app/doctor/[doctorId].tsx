/**
 * Doctor profile (PRD §7.1 / PAT-009, PAT-010, J2 step 3).
 *
 * Contents: identity + verified badge, qualifications, experience, languages,
 * bio, fees per consultation type, review distribution with recent comments, and
 * an availability preview that routes into the slot picker.
 *
 * Unverified or deactivated doctors 404 at the API, so this screen only ever
 * renders bookable supply (R10).
 */
import * as React from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import {
  Avatar,
  Badge,
  Button,
  Card,
  Chip,
  ChipRow,
  DayStrip,
  EmptyState,
  Icon,
  PolicyNote,
  RatingDistribution,
  Screen,
  ScreenHeader,
  SectionHeading,
  SkeletonCard,
  StarRating,
  Text,
  VerifiedBadge,
  color,
  spacing,
} from '@medibook/brand';
import { formatDuration, formatMoney, toDayViewModels } from '@medibook/core';
import type { ConsultType, Qualification } from '@medibook/core';

import { useAvailability, useDoctor, useSetSavedDoctor } from '../../src/lib/hooks';
import { useViewerTimeZone } from '../../src/lib/session';
import { consultTypeIcon, consultTypeLabel, joinLanguages } from '../../src/lib/format';
import { ErrorState } from '../../src/components/states';

export default function DoctorProfileScreen() {
  const router = useRouter();
  const { doctorId } = useLocalSearchParams<{ doctorId?: string }>();
  const viewerTz = useViewerTimeZone();
  const setSaved = useSetSavedDoctor();

  const doctor = useDoctor(doctorId);
  const [consultType, setConsultType] = React.useState<ConsultType | null>(null);
  const [bioOpen, setBioOpen] = React.useState(false);

  const fees = doctor.data?.consult_fees.filter((fee) => fee.enabled) ?? [];
  const resolvedType: ConsultType = consultType ?? fees[0]?.consult_type ?? 'in_person';

  const availability = useAvailability(doctorId, { type: resolvedType });
  const dayModels = React.useMemo(
    () => (availability.data ? toDayViewModels(availability.data) : []),
    [availability.data],
  );
  const previewDays = dayModels.slice(0, 5).filter((day) => day.slotCount > 0);

  if (doctor.isLoading) {
    return (
      <Screen edges={['top']} contentContainerStyle={{ gap: spacing.lg }}>
        <ScreenHeader title="Doctor" onBack={() => router.back()} />
        <SkeletonCard lines={4} />
        <SkeletonCard lines={3} />
        <SkeletonCard lines={2} />
      </Screen>
    );
  }

  if (doctor.isError || !doctor.data) {
    return (
      <Screen edges={['top']} contentContainerStyle={{ gap: spacing.lg }}>
        <ScreenHeader title="Doctor" onBack={() => router.back()} />
        <ErrorState
          error={doctor.error ?? new Error('This doctor is not available.')}
          onRetry={() => void doctor.refetch()}
        />
      </Screen>
    );
  }

  const detail = doctor.data;
  const favorite = detail.is_favorite === true;

  return (
    <Screen scroll edges={['top']} contentContainerStyle={{ gap: spacing.xl, paddingBottom: spacing.huge }}>
      <ScreenHeader
        title={detail.name}
        subtitle={detail.specialties.join(' · ')}
        onBack={() => router.back()}
        action={{
          icon: favorite ? 'heart-filled' : 'heart',
          onPress: () => setSaved.mutate({ doctorId: detail.id, saved: !favorite }),
          accessibilityLabel: favorite ? 'Remove from saved doctors' : 'Save doctor',
        }}
      />

      <Card style={{ gap: spacing.md }}>
        <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
          <Avatar name={detail.name} size="xl" />
          <View style={{ flex: 1, gap: spacing.sm }}>
            <Text variant="h3">{detail.name}</Text>
            <Text variant="small">{detail.specialties.join(' · ')}</Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center', flexWrap: 'wrap' }}>
              <StarRating value={detail.rating} count={detail.review_count} showValue size={16} />
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
              <VerifiedBadge status={detail.verification_status} />
              <Badge label={`${detail.experience_years} yrs experience`} tone="neutral" icon="briefcase" />
            </View>
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
          <Badge label={detail.area} tone="info" icon="map-pin" />
          <Badge label={detail.clinic_name} tone="neutral" icon="building" />
          <Badge label={detail.languages.join(', ')} tone="neutral" icon="globe" />
        </View>

        {detail.calendar_connected ? (
          <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
            <Icon name="link" size={16} color={color.success} />
            <Text variant="caption">
              This doctor’s external calendar is connected, so availability already excludes their busy time.
            </Text>
          </View>
        ) : null}
      </Card>

      <View style={{ gap: spacing.md }}>
        <SectionHeading title="About" />
        <Card variant="flat" style={{ gap: spacing.md }}>
          <Text variant="body" numberOfLines={bioOpen ? undefined : 4}>
            {detail.bio}
          </Text>
          {detail.bio.length > 180 ? (
            <Button label={bioOpen ? 'Show less' : 'Read more'} variant="ghost" size="sm" block={false} onPress={() => setBioOpen((value) => !value)} />
          ) : null}

          <View style={{ gap: spacing.sm }}>
            <Text variant="label">Qualifications</Text>
            {detail.qualifications.map((qualification: Qualification) => (
              <View key={qualification.id} style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                <Icon name="check-circle" size={16} color={color.success} />
                <Text variant="small" style={{ flex: 1 }}>
                  {qualification.degree} · {qualification.institution} ({qualification.year})
                </Text>
              </View>
            ))}
          </View>

          <View style={{ gap: spacing.xs }}>
            <Text variant="label">Registration</Text>
            <Text variant="small">
              {detail.registration_number_masked} · {detail.council}
            </Text>
            <Text variant="caption">
              Registration numbers are partly masked in the app; the full record is held by the council.
            </Text>
          </View>

          <View style={{ gap: spacing.xs }}>
            <Text variant="label">Languages</Text>
            <Text variant="small">{joinLanguages(detail.languages)}</Text>
          </View>

          {detail.clinic_geo ? (
            <View style={{ gap: spacing.xs }}>
              <Text variant="label">Clinic</Text>
              <Text variant="small">{detail.clinic_address}</Text>
              <Text variant="caption">
                {detail.clinic_geo.lat.toFixed(4)}, {detail.clinic_geo.lng.toFixed(4)}
              </Text>
            </View>
          ) : (
            <View style={{ gap: spacing.xs }}>
              <Text variant="label">Clinic</Text>
              <Text variant="small">{detail.clinic_address}</Text>
            </View>
          )}
        </Card>
      </View>

      <View style={{ gap: spacing.md }}>
        <SectionHeading title="Consultations" />
        <Card variant="flat" style={{ gap: spacing.md }}>
          {detail.consult_fees.map((fee) => {
            const enabled = fee.enabled;
            return (
              <View
                key={fee.consult_type}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.md,
                  opacity: enabled ? 1 : 0.5,
                }}
              >
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
                  <Icon name={consultTypeIcon(fee.consult_type)} size={20} color={color.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong">{consultTypeLabel(fee.consult_type)}</Text>
                  <Text variant="caption">
                    {enabled ? `${formatDuration(fee.duration_minutes)} · ${formatMoney(fee.fee_minor, fee.currency)}` : 'Not offered'}
                  </Text>
                </View>
                {enabled ? (
                  <Button
                    label="Book"
                    size="sm"
                    block={false}
                    onPress={() =>
                      router.push({
                        pathname: '/slots/[doctorId]',
                        params: { doctorId: detail.id, consultType: fee.consult_type },
                      })
                    }
                  />
                ) : null}
              </View>
            );
          })}
          <PolicyNote
            tone="info"
            title="Free cancellation up to 24 hours before"
            body="Cancelling at least 24 hours before the start refunds 100%. Between 2 and 24 hours you get 50% back. Inside 2 hours the visit is non-refundable. The exact amount is always shown before you confirm a cancellation."
          />
        </Card>
      </View>

      <View style={{ gap: spacing.md }}>
        <SectionHeading title="Availability" />
        <Card variant="flat" style={{ gap: spacing.md }}>
          {fees.length > 1 ? (
            <ChipRow>
              {fees.map((fee) => (
                <Chip
                  key={fee.consult_type}
                  label={consultTypeLabel(fee.consult_type)}
                  icon={consultTypeIcon(fee.consult_type)}
                  selected={resolvedType === fee.consult_type}
                  onPress={() => setConsultType(fee.consult_type)}
                />
              ))}
            </ChipRow>
          ) : null}

          {availability.isLoading ? (
            <SkeletonCard lines={2} />
          ) : availability.isError ? (
            <ErrorState error={availability.error} onRetry={() => void availability.refetch()} compact />
          ) : previewDays.length === 0 ? (
            <EmptyState
              icon="calendar"
              title="No open slots in the next two weeks"
              description="Try the other consultation type, or check back later — this doctor’s schedule changes often."
              compact
            />
          ) : (
            <>
              <Text variant="small">
                {previewDays.reduce((sum, day) => sum + day.slotCount, 0)} open slots across the next{' '}
                {previewDays.length} available day{previewDays.length === 1 ? '' : 's'}
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
                <DayStrip
                  days={previewDays}
                  selectedDate={null}
                  onSelect={() => undefined}
                  tzLabel="Times shown in your timezone"
                />
              </ScrollView>
            </>
          )}

          <Button
            label="See all slots"
            iconRight="arrow-right"
            onPress={() =>
              router.push({
                pathname: '/slots/[doctorId]',
                params: { doctorId: detail.id, consultType: resolvedType },
              })
            }
          />
        </Card>
      </View>

      <View style={{ gap: spacing.md }}>
        <SectionHeading title="Reviews" />
        <Card variant="flat" style={{ gap: spacing.lg }}>
          <RatingDistribution distribution={detail.review_summary.distribution} total={detail.review_summary.total} />
          {detail.reviews.length === 0 ? (
            <Text variant="small">No written reviews yet. Only patients who completed a visit can review.</Text>
          ) : (
            <View style={{ gap: spacing.md }}>
              {detail.reviews.map((review) => (
                <View key={review.id} style={{ gap: spacing.xs }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text variant="smallMedium">{review.patient_display_name}</Text>
                    <StarRating value={review.rating} size={14} />
                  </View>
                  {review.comment ? <Text variant="small">{review.comment}</Text> : null}
                  {review.verified_visit ? (
                    <View style={{ flexDirection: 'row', gap: spacing.xs, alignItems: 'center' }}>
                      <Icon name="check-circle" size={13} color={color.success} />
                      <Text variant="caption">Verified visit</Text>
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          )}
        </Card>
      </View>
    </Screen>
  );
}
