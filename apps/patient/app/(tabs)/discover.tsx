/**
 * Discover (PRD §7.1 / PAT-008) — search, specialty chips, a filters sheet and the
 * doctor result list.
 *
 * The whole search state lives in the route params so back-navigation from a doctor
 * profile restores the exact result set (PAT-008: "deep-link search state survives
 * back-nav"). Every filter maps 1:1 onto a `DoctorQuery` field the API understands.
 */
import * as React from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import {
  Badge,
  Button,
  Card,
  Chip,
  ChipRow,
  DoctorCard,
  EmptyState,
  Icon,
  Screen,
  ScreenHeader,
  SegmentedControl,
  Sheet,
  Text,
  TextField,
  color,
  spacing,
} from '@medibook/brand';
import { formatMoney, toDoctorCardModel, type ConsultType, type DoctorQuery, type Gender } from '@medibook/core';

import { useDoctors, useSetSavedDoctor, useSpecializations } from '../../src/lib/hooks';
import { useViewerTimeZone } from '../../src/lib/session';
import { useNow } from '../../src/lib/useNow';
import { ErrorState, ListSkeleton } from '../../src/components/states';

/** Sentinel used by the "Any" chip; kept out of `DoctorQuery` itself. */
const ANY = 'any';

const LANGUAGE_OPTIONS = ['English', 'Hindi', 'Marathi', 'Tamil', 'Telugu', 'Bengali', 'Urdu', 'Gujarati', 'Spanish'];

const FEE_BANDS: ReadonlyArray<{ key: string; label: string; min?: number; max?: number }> = [
  { key: ANY, label: 'Any fee' },
  { key: 'low', label: 'Under ₹500', max: 50_000 },
  { key: 'mid', label: '₹500 – ₹1,000', min: 50_000, max: 100_000 },
  { key: 'high', label: 'Above ₹1,000', min: 100_000 },
];

const AVAILABILITY: ReadonlyArray<{ key: string; label: string }> = [
  { key: ANY, label: 'Any day' },
  { key: 'today', label: 'Today' },
  { key: 'tomorrow', label: 'Tomorrow' },
];

const SORTS: ReadonlyArray<{ key: NonNullable<DoctorQuery['sort']>; label: string }> = [
  { key: 'relevance', label: 'Best match' },
  { key: 'next_available', label: 'Soonest' },
  { key: 'rating', label: 'Top rated' },
  { key: 'fee_asc', label: 'Fee ↑' },
  { key: 'fee_desc', label: 'Fee ↓' },
  { key: 'experience', label: 'Experience' },
];

type Filters = {
  available: string;
  consultType: ConsultType | typeof ANY;
  feeBand: string;
  language: string;
  gender: Gender | typeof ANY;
};

const EMPTY_FILTERS: Filters = {
  available: ANY,
  consultType: ANY,
  feeBand: ANY,
  language: ANY,
  gender: ANY,
};

function countActive(filters: Filters): number {
  return [
    filters.available !== ANY,
    filters.consultType !== ANY,
    filters.feeBand !== ANY,
    filters.language !== ANY,
    filters.gender !== ANY,
  ].filter(Boolean).length;
}

export default function DiscoverScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ specialization?: string; q?: string }>();
  const viewerTz = useViewerTimeZone();
  const now = useNow(60_000);

  const [search, setSearch] = React.useState(params.q ?? '');
  const [specialization, setSpecialization] = React.useState<string | null>(params.specialization ?? null);
  const [sort, setSort] = React.useState<NonNullable<DoctorQuery['sort']>>('relevance');
  const [filters, setFilters] = React.useState<Filters>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = React.useState(false);

  const specialties = useSpecializations();
  const setSaved = useSetSavedDoctor();

  const query = React.useMemo<DoctorQuery>(() => {
    const band = FEE_BANDS.find((entry) => entry.key === filters.feeBand);
    return {
      q: search.trim().length > 0 ? search.trim() : undefined,
      specialization: specialization ?? undefined,
      consult_type: filters.consultType === ANY ? undefined : filters.consultType,
      available: filters.available === ANY ? undefined : filters.available,
      fee_min_minor: band?.min,
      fee_max_minor: band?.max,
      language: filters.language === ANY ? undefined : filters.language,
      gender: filters.gender === ANY ? undefined : filters.gender,
      sort,
      limit: 30,
    };
  }, [search, specialization, filters, sort]);

  const doctors = useDoctors(query);
  const active = countActive(filters);

  const results = doctors.data?.items ?? [];

  return (
    <Screen edges={['top']} contentContainerStyle={{ gap: spacing.lg }}>
      <ScreenHeader
        title="Discover"
        subtitle="Verified doctors, real availability"
        action={{ icon: 'sliders', onPress: () => setFiltersOpen(true), accessibilityLabel: 'Filters' }}
      />

      <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <TextField
            leadingIcon="search"
            placeholder="Search doctor, specialty or area"
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
            autoCorrect={false}
            accessibilityLabel="Search doctors"
          />
        </View>
        <Button
          label={active > 0 ? `Filters · ${active}` : 'Filters'}
          variant={active > 0 ? 'primary' : 'secondary'}
          size="sm"
          block={false}
          icon="filter"
          onPress={() => setFiltersOpen(true)}
        />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
        <ChipRow>
          <Chip
            label="All specialties"
            selected={specialization === null}
            onPress={() => setSpecialization(null)}
          />
          {(specialties.data ?? [])
            .filter((entry) => entry.is_active)
            .map((entry) => (
              <Chip
                key={entry.id}
                label={entry.name}
                selected={specialization === entry.slug}
                onPress={() => setSpecialization(specialization === entry.slug ? null : entry.slug)}
              />
            ))}
        </ChipRow>
      </ScrollView>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
        <ChipRow>
          {SORTS.map((option) => (
            <Chip
              key={option.key}
              label={option.label}
              selected={sort === option.key}
              onPress={() => setSort(option.key)}
            />
          ))}
        </ChipRow>
      </ScrollView>

      {doctors.isLoading ? (
        <ListSkeleton count={3} />
      ) : doctors.isError ? (
        <ErrorState error={doctors.error} onRetry={() => void doctors.refetch()} />
      ) : results.length === 0 ? (
        <EmptyState
          icon="search"
          title="No doctors match"
          description="Try removing a filter, widening the fee range or searching a different specialty."
          actionLabel={active > 0 ? 'Clear filters' : undefined}
          onAction={active > 0 ? () => setFilters(EMPTY_FILTERS) : undefined}
          secondaryActionLabel={search.length > 0 ? 'Clear search' : undefined}
          onSecondaryAction={search.length > 0 ? () => setSearch('') : undefined}
        />
      ) : (
        <View style={{ gap: spacing.md }}>
          <Text variant="small">
            {results.length} doctor{results.length === 1 ? '' : 's'}
            {specialization ? ` · ${specialties.data?.find((entry) => entry.slug === specialization)?.name ?? specialization}` : ''}
          </Text>
          {results.map((doctor) => (
            <DoctorCard
              key={doctor.id}
              doctor={toDoctorCardModel(doctor, { viewerTz, nowMs: now })}
              onPress={() => router.push(`/doctor/${doctor.id}`)}
              onToggleFavorite={() => setSaved.mutate({ doctorId: doctor.id, saved: doctor.is_favorite !== true })}
            />
          ))}
        </View>
      )}

      <Sheet
        visible={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filters"
        subtitle="Availability, consultation type, fee, language and gender"
        footer={
          <View style={{ gap: spacing.sm }}>
            <Button label="Show results" onPress={() => setFiltersOpen(false)} />
            <Button label="Reset all" variant="ghost" onPress={() => setFilters(EMPTY_FILTERS)} />
          </View>
        }
      >
        <Text variant="label">Availability</Text>
        <ChipRow>
          {AVAILABILITY.map((option) => (
            <Chip
              key={option.key}
              label={option.label}
              selected={filters.available === option.key}
              onPress={() => setFilters((current) => ({ ...current, available: option.key }))}
            />
          ))}
        </ChipRow>

        <Text variant="label">Consultation type</Text>
        <SegmentedControl
          accessibilityLabel="Consultation type"
          options={[
            { value: ANY, label: 'Any' },
            { value: 'in_person', label: 'In-clinic' },
            { value: 'video', label: 'Video' },
          ]}
          value={filters.consultType}
          onChange={(value) => setFilters((current) => ({ ...current, consultType: value }))}
        />

        <Text variant="label">Fee</Text>
        <ChipRow>
          {FEE_BANDS.map((band) => (
            <Chip
              key={band.key}
              label={band.label}
              selected={filters.feeBand === band.key}
              onPress={() => setFilters((current) => ({ ...current, feeBand: band.key }))}
            />
          ))}
        </ChipRow>
        <Text variant="caption">
          Fees shown are for the first available consultation type. {formatMoney(50_000, 'INR')} is ₹500.
        </Text>

        <Text variant="label">Language</Text>
        <ChipRow>
          <Chip
            label="Any"
            selected={filters.language === ANY}
            onPress={() => setFilters((current) => ({ ...current, language: ANY }))}
          />
          {LANGUAGE_OPTIONS.map((language) => (
            <Chip
              key={language}
              label={language}
              selected={filters.language === language}
              onPress={() => setFilters((current) => ({ ...current, language }))}
            />
          ))}
        </ChipRow>

        <Text variant="label">Doctor gender</Text>
        <ChipRow>
          {(['any', 'female', 'male'] as const).map((option) => (
            <Chip
              key={option}
              label={option === 'any' ? 'Any' : option === 'female' ? 'Female' : 'Male'}
              selected={filters.gender === option}
              onPress={() => setFilters((current) => ({ ...current, gender: option }))}
            />
          ))}
        </ChipRow>

        <Card variant="flat" style={{ backgroundColor: color.surfaceAlt, gap: spacing.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Icon name="shield-check" size={18} color={color.primaryStrong} />
            <Text variant="bodyStrong">Verified only</Text>
            <Badge label="Always on" tone="verified" icon="check-circle" />
          </View>
          <Text variant="small">
            Unverified doctors are never listed, so a filter for it would be meaningless. Suspended doctors disappear
            from results automatically.
          </Text>
        </Card>
      </Sheet>
    </Screen>
  );
}
