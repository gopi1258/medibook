/**
 * Edit my details (PAT-003) — name, date of birth, gender, phone/email and the
 * emergency contact.
 *
 * Phone and email are read-only after registration on purpose: changing them
 * requires an OTP re-verification to the *old* destination plus a notification to
 * it (PAT-003), which is a dedicated flow rather than an inline edit.
 */
import * as React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import type { Gender } from '@medibook/core';
import {
  Button,
  Card,
  PolicyNote,
  Screen,
  ScreenHeader,
  SegmentedControl,
  Text,
  TextField,
  color,
  spacing,
} from '@medibook/brand';

import { patientApi } from '../../src/lib/api';
import { describeError } from '../../src/lib/format';
import { usePatientProfile } from '../../src/lib/hooks';
import { queryKeys } from '../../src/lib/query';
import { updateSessionUser } from '../../src/lib/session';
import { InlineNotice, ListSkeleton } from '../../src/components/states';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export default function EditProfileScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const profile = usePatientProfile();

  const [name, setName] = React.useState('');
  const [dob, setDob] = React.useState('');
  const [gender, setGender] = React.useState<Gender>('female');
  const [emergencyContact, setEmergencyContact] = React.useState('');
  const [hydrated, setHydrated] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [failure, setFailure] = React.useState<unknown>(null);

  React.useEffect(() => {
    if (hydrated || !profile.data) return;
    setName(profile.data.display_name);
    setDob(profile.data.dob ?? '');
    setGender(profile.data.gender ?? 'female');
    setEmergencyContact(profile.data.emergency_contact ?? '');
    setHydrated(true);
  }, [hydrated, profile.data]);

  const nameError = name.trim().length < 2 ? 'Enter your full name.' : null;
  const dobError = dob.length > 0 && !DATE_PATTERN.test(dob) ? 'Use YYYY-MM-DD.' : null;
  const valid = !nameError && !dobError;

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    setFailure(null);
    setSaved(false);
    try {
      const updated = await patientApi.updateProfile({
        display_name: name.trim(),
        dob: dob.length > 0 ? dob : null,
        gender,
        emergency_contact: emergencyContact.trim().length > 0 ? emergencyContact.trim() : null,
      });
      updateSessionUser({ display_name: updated.display_name, dob: updated.dob, gender: updated.gender });
      await queryClient.invalidateQueries({ queryKey: queryKeys.profile });
      setSaved(true);
    } catch (caught) {
      setFailure(caught);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen scroll edges={['top']} contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.huge }}>
      <ScreenHeader title="My details" subtitle="What your doctor sees" onBack={() => router.back()} />

      {profile.isLoading ? (
        <ListSkeleton count={3} />
      ) : (
        <>
          <TextField
            label="Full name"
            value={name}
            onChangeText={(next) => {
              setName(next);
              setSaved(false);
            }}
            autoCapitalize="words"
            error={nameError ?? undefined}
          />

          <TextField
            label="Date of birth"
            value={dob}
            onChangeText={(next) => {
              setDob(next);
              setSaved(false);
            }}
            placeholder="1992-04-18"
            keyboardType="numbers-and-punctuation"
            error={dobError ?? undefined}
            helper="Required before your first booking."
          />

          <View style={{ gap: spacing.sm }}>
            <Text variant="label">Gender</Text>
            <SegmentedControl
              accessibilityLabel="Gender"
              options={[
                { value: 'female', label: 'Female' },
                { value: 'male', label: 'Male' },
                { value: 'other', label: 'Other' },
              ]}
              value={gender}
              onChange={(next) => {
                setGender(next);
                setSaved(false);
              }}
            />
          </View>

          <TextField
            label="Emergency contact"
            value={emergencyContact}
            onChangeText={setEmergencyContact}
            placeholder="+91 98987 65432"
            keyboardType="phone-pad"
            helper="Used only if something happens during an in-clinic visit."
          />

          <Card variant="flat" style={{ gap: spacing.md }}>
            <Text variant="label">Sign-in details</Text>
            <TextField label="Mobile number" value={profile.data?.phone ?? '—'} editable={false} disabled />
            <TextField label="Email address" value={profile.data?.email ?? '—'} editable={false} disabled />
            <Text variant="caption">
              Changing your number or email needs a verification code sent to the current one first, so it lives in the
              help flow rather than here.
            </Text>
          </Card>

          {failure ? <InlineNotice message={describeError(failure).message} /> : null}
          {saved ? <InlineNotice tone="success" message="Your details are saved." /> : null}

          <PolicyNote
            tone="info"
            title="Photo upload"
            body="Profile photos are stripped of metadata and stored privately. This build ships initials avatars only — there are no network images anywhere in the app."
          />

          <Button label={saving ? 'Saving…' : 'Save changes'} loading={saving} disabled={!valid || saving} onPress={() => void save()} />
        </>
      )}

      <Card variant="flat" style={{ backgroundColor: color.surfaceAlt, gap: spacing.xs }}>
        <Text variant="bodyStrong">Data minimisation</Text>
        <Text variant="small">
          MediBook stores your name, contact details, date of birth and gender, plus your appointment history. It does not
          store medical records, prescriptions or test results.
        </Text>
      </Card>
    </Screen>
  );
}
