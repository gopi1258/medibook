/**
 * Professional profile editor (DOC-003) — display name, bio, qualifications,
 * specialisations, experience, languages and the clinic address.
 *
 * Licensed fields (registration number, council, specialisations) are flagged:
 * changing them re-triggers verification and pauses discoverability, which the
 * screen states before the doctor saves rather than after.
 */
import * as React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import type { Gender, Qualification } from '@medibook/core';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Chip,
  ChipRow,
  PolicyNote,
  Screen,
  ScreenHeader,
  SectionHeading,
  SegmentedControl,
  Text,
  TextArea,
  TextField,
  color,
  spacing,
} from '@medibook/brand';

import { useDoctorProfile, useSpecializations, useUpdateProfile } from '../../src/lib/hooks';
import { describeError } from '../../src/lib/format';
import { updateSessionUser } from '../../src/lib/session';
import { ErrorState, InlineNotice, ListSkeleton } from '../../src/components/states';

const LANGUAGE_OPTIONS = [
  'English',
  'Hindi',
  'Marathi',
  'Tamil',
  'Telugu',
  'Bengali',
  'Gujarati',
  'Kannada',
  'Malayalam',
  'Urdu',
  'Spanish',
  'French',
];

export default function EditProfileScreen() {
  const router = useRouter();
  const profile = useDoctorProfile();
  const specializations = useSpecializations();
  const update = useUpdateProfile();

  const [draft, setDraft] = React.useState<{
    display_name: string;
    bio: string;
    experience_years: number;
    languages: string[];
    specialization_slugs: string[];
    clinic_name: string;
    clinic_address: string;
    clinic_timezone: string;
    gender: Gender;
  } | null>(null);
  const [qualifications, setQualifications] = React.useState<Qualification[]>([]);
  const [newQualification, setNewQualification] = React.useState({ degree: '', institution: '', year: '' });
  const [failure, setFailure] = React.useState<unknown>(null);

  React.useEffect(() => {
    if (draft !== null || !profile.data) return;
    setDraft({
      display_name: profile.data.display_name,
      bio: profile.data.bio,
      experience_years: profile.data.experience_years,
      languages: [...profile.data.languages],
      specialization_slugs: [...profile.data.specialization_slugs],
      clinic_name: profile.data.clinic_name,
      clinic_address: profile.data.clinic_address,
      clinic_timezone: profile.data.clinic_timezone,
      gender: profile.data.gender,
    });
    setQualifications(profile.data.qualifications);
  }, [draft, profile.data]);

  const save = async () => {
    if (!draft) return;
    setFailure(null);
    try {
      await update.mutateAsync({
        ...draft,
        qualifications,
      });
      updateSessionUser({ display_name: draft.display_name, default_timezone: draft.clinic_timezone });
      router.back();
    } catch (caught) {
      setFailure(caught);
    }
  };

  const licensedChange =
    profile.data !== undefined &&
    draft !== null &&
    JSON.stringify([...draft.specialization_slugs].sort()) !==
      JSON.stringify([...profile.data.specialization_slugs].sort());

  return (
    <Screen scroll edges={['top']} contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.huge }}>
      <ScreenHeader title="Professional profile" subtitle="What patients read before booking" onBack={() => router.back()} />

      {profile.isLoading || draft === null ? (
        <ListSkeleton count={4} />
      ) : profile.isError ? (
        <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />
      ) : (
        <>
          <Card style={{ gap: spacing.md }}>
            <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
              <Avatar name={draft.display_name} size="lg" tone="blossom" />
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong">{draft.display_name}</Text>
                <Text variant="caption">
                  Photos are initials avatars in this build — no remote images anywhere in the app.
                </Text>
              </View>
            </View>
            <TextField
              label="Display name"
              value={draft.display_name}
              onChangeText={(next) => setDraft({ ...draft, display_name: next })}
              helper="Shown exactly as written, including the honorific."
            />
            <Text variant="label">Gender (used by patient filters)</Text>
            <SegmentedControl
              accessibilityLabel="Gender"
              options={[
                { value: 'female', label: 'Female' },
                { value: 'male', label: 'Male' },
                { value: 'other', label: 'Other' },
              ]}
              value={draft.gender === 'undisclosed' ? 'other' : draft.gender}
              onChange={(next) => setDraft({ ...draft, gender: next })}
            />
          </Card>

          <View style={{ gap: spacing.md }}>
            <SectionHeading title="About" />
            <TextArea
              label="Bio"
              value={draft.bio}
              onChangeText={(next) => setDraft({ ...draft, bio: next })}
              placeholder="What you treat, how you work, what a patient should expect."
              maxLength={700}
            />
            <TextField
              label="Years of experience"
              value={String(draft.experience_years)}
              onChangeText={(next) => setDraft({ ...draft, experience_years: Number(next.replace(/\D/g, '')) || 0 })}
              keyboardType="number-pad"
            />
          </View>

          <View style={{ gap: spacing.md }}>
            <SectionHeading title="Qualifications" />
            {qualifications.map((qualification) => (
              <Card key={qualification.id} variant="flat" style={{ gap: spacing.sm }}>
                <Text variant="bodyStrong">{qualification.degree}</Text>
                <Text variant="small">
                  {qualification.institution} · {qualification.year}
                </Text>
                <Button
                  label="Remove"
                  size="sm"
                  variant="ghost"
                  block={false}
                  onPress={() => setQualifications((current) => current.filter((entry) => entry.id !== qualification.id))}
                />
              </Card>
            ))}
            <Card variant="flat" style={{ gap: spacing.md }}>
              <Text variant="label">Add a qualification</Text>
              <TextField
                label="Degree"
                value={newQualification.degree}
                onChangeText={(next) => setNewQualification({ ...newQualification, degree: next })}
                placeholder="MD Dermatology"
              />
              <TextField
                label="Institution"
                value={newQualification.institution}
                onChangeText={(next) => setNewQualification({ ...newQualification, institution: next })}
                placeholder="AIIMS, New Delhi"
              />
              <TextField
                label="Year"
                value={newQualification.year}
                onChangeText={(next) => setNewQualification({ ...newQualification, year: next.replace(/\D/g, '') })}
                keyboardType="number-pad"
                placeholder="2014"
              />
              <Button
                label="Add qualification"
                variant="secondary"
                icon="plus"
                disabled={
                  newQualification.degree.trim().length < 2 ||
                  newQualification.institution.trim().length < 2 ||
                  newQualification.year.length !== 4
                }
                onPress={() => {
                  setQualifications((current) => [
                    ...current,
                    {
                      id: `qual_local_${Date.now().toString(36)}`,
                      degree: newQualification.degree.trim(),
                      institution: newQualification.institution.trim(),
                      year: Number(newQualification.year),
                    },
                  ]);
                  setNewQualification({ degree: '', institution: '', year: '' });
                }}
              />
            </Card>
          </View>

          <View style={{ gap: spacing.md }}>
            <SectionHeading title="Specialisations" />
            <Text variant="caption">Pick a primary first, then up to three additional. The first selection leads your listing.</Text>
            {specializations.isLoading ? (
              <ListSkeleton count={0} chips />
            ) : (
              <ChipRow>
                {(specializations.data ?? [])
                  .filter((entry) => entry.is_active)
                  .map((entry) => (
                    <Chip
                      key={entry.slug}
                      label={draft.specialization_slugs[0] === entry.slug ? `${entry.name} · primary` : entry.name}
                      selected={draft.specialization_slugs.includes(entry.slug)}
                      onPress={() =>
                        setDraft({
                          ...draft,
                          specialization_slugs: draft.specialization_slugs.includes(entry.slug)
                            ? draft.specialization_slugs.filter((slug) => slug !== entry.slug)
                            : draft.specialization_slugs.length >= 4
                              ? draft.specialization_slugs
                              : [...draft.specialization_slugs, entry.slug],
                        })
                      }
                    />
                  ))}
              </ChipRow>
            )}
            {licensedChange ? (
              <PolicyNote
                tone="warning"
                title="This change re-triggers verification"
                body="Specialisations are licensed fields. Saving pauses your discoverability until the change is re-approved; existing appointments are unaffected."
              />
            ) : null}
          </View>

          <View style={{ gap: spacing.md }}>
            <SectionHeading title="Languages" />
            <ChipRow>
              {LANGUAGE_OPTIONS.map((language) => (
                <Chip
                  key={language}
                  label={language}
                  selected={draft.languages.includes(language)}
                  onPress={() =>
                    setDraft({
                      ...draft,
                      languages: draft.languages.includes(language)
                        ? draft.languages.filter((entry) => entry !== language)
                        : [...draft.languages, language],
                    })
                  }
                />
              ))}
            </ChipRow>
            {draft.languages.length === 0 ? (
              <Text variant="caption">Patients filter by language, so at least one keeps you findable.</Text>
            ) : null}
          </View>

          <View style={{ gap: spacing.md }}>
            <SectionHeading title="Clinic" />
            <TextField
              label="Clinic name"
              value={draft.clinic_name}
              onChangeText={(next) => setDraft({ ...draft, clinic_name: next })}
              placeholder="Skin & You Clinic"
            />
            <TextArea
              label="Clinic address"
              value={draft.clinic_address}
              onChangeText={(next) => setDraft({ ...draft, clinic_address: next })}
              placeholder="302 Linking Road, Bandra West, Mumbai 400050"
              maxLength={300}
            />
            <TextField
              label="Clinic timezone (IANA)"
              value={draft.clinic_timezone}
              onChangeText={(next) => setDraft({ ...draft, clinic_timezone: next })}
              placeholder="Asia/Kolkata"
              helper="Canonical for all availability maths. Weekly hours are wall-clock in this zone, so they survive daylight-saving changes."
            />
          </View>

          {failure ? <InlineNotice message={describeError(failure).message} /> : null}

          <Card variant="flat" style={{ backgroundColor: color.surfaceAlt, gap: spacing.sm }}>
            <Text variant="bodyStrong">Profile completeness</Text>
            <Text variant="small">
              Going live needs a name, bio, at least one qualification, one specialisation, one language, a clinic address
              and at least one consultation type with a fee.
            </Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
              <Badge label={draft.bio.length > 60 ? 'Bio done' : 'Bio short'} tone={draft.bio.length > 60 ? 'verified' : 'warning'} icon="edit" />
              <Badge label={`${qualifications.length} qualification${qualifications.length === 1 ? '' : 's'}`} tone={qualifications.length > 0 ? 'verified' : 'warning'} icon="check-circle" />
              <Badge label={`${draft.languages.length} language${draft.languages.length === 1 ? '' : 's'}`} tone={draft.languages.length > 0 ? 'verified' : 'warning'} icon="globe" />
            </View>
          </Card>

          <Button
            label={update.isPending ? 'Saving…' : 'Save profile'}
            loading={update.isPending}
            onPress={() => void save()}
            icon="check"
          />
        </>
      )}
    </Screen>
  );
}
