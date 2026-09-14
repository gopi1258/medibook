/**
 * J1 steps 4–5 — profile setup, then the skippable "add a family member" prompt.
 *
 * DOB is required before the first booking (PAT-003) so it is asked here rather
 * than at checkout. The family-member prompt is skippable and re-openable from
 * Profile → Family members.
 */
import * as React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import type { Dependent, Gender } from '@medibook/core';
import {
  Button,
  Card,
  Chip,
  ChipRow,
  PolicyNote,
  Screen,
  ScreenHeader,
  SegmentedControl,
  Sheet,
  Text,
  TextField,
  color,
  spacing,
  type SegmentedOption,
} from '@medibook/brand';

import { patientApi } from '../../src/lib/api';
import { describeError, genderLabel } from '../../src/lib/format';
import { markOnboardingComplete, updateSessionUser, useCurrentUser } from '../../src/lib/session';
import { InlineNotice } from '../../src/components/states';

const GENDERS: readonly SegmentedOption<Gender>[] = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'other', label: 'Other' },
];

const RELATIONSHIPS: ReadonlyArray<Dependent['relationship']> = ['son', 'daughter', 'spouse', 'parent', 'sibling', 'other'];

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export default function ProfileSetupScreen() {
  const router = useRouter();
  const user = useCurrentUser();

  const [name, setName] = React.useState(user?.display_name ?? '');
  const [gender, setGender] = React.useState<Gender>(user?.gender ?? 'female');
  const [dob, setDob] = React.useState(user?.dob ?? '');
  const [saving, setSaving] = React.useState(false);
  const [failure, setFailure] = React.useState<unknown>(null);
  const [step, setStep] = React.useState<'details' | 'family'>('details');

  const [familyOpen, setFamilyOpen] = React.useState(false);
  const [familyName, setFamilyName] = React.useState('');
  const [familyRelationship, setFamilyRelationship] = React.useState<Dependent['relationship']>('son');
  const [familyDob, setFamilyDob] = React.useState('');
  const [familyGender, setFamilyGender] = React.useState<Gender>('male');
  const [familyError, setFamilyError] = React.useState<string | null>(null);
  const [addedFamily, setAddedFamily] = React.useState<string[]>([]);

  const nameError = name.trim().length < 2 ? 'Tell us what to call you.' : null;
  const dobError = !DATE_PATTERN.test(dob) ? 'Use YYYY-MM-DD, e.g. 1992-04-18.' : null;
  const canSave = !nameError && !dobError;

  const saveDetails = async () => {
    if (!canSave) return;
    setSaving(true);
    setFailure(null);
    try {
      const updated = await patientApi.updateProfile({
        display_name: name.trim(),
        gender,
        dob,
      });
      updateSessionUser({
        display_name: updated.display_name,
        gender: updated.gender,
        dob: updated.dob,
      });
      setStep('family');
    } catch (caught) {
      setFailure(caught);
    } finally {
      setSaving(false);
    }
  };

  const finish = () => {
    markOnboardingComplete();
    router.replace('/(tabs)');
  };

  const addFamilyMember = async () => {
    if (familyName.trim().length < 2 || !DATE_PATTERN.test(familyDob)) {
      setFamilyError('A name and a date of birth (YYYY-MM-DD) are required.');
      return;
    }
    setFamilyError(null);
    setSaving(true);
    try {
      const dependent = await patientApi.createDependent({
        name: familyName.trim(),
        relationship: familyRelationship,
        dob: familyDob,
        gender: familyGender,
        notes: null,
      });
      setAddedFamily((current) => [...current, `${dependent.name} · ${dependent.relationship}`]);
      setFamilyOpen(false);
      setFamilyName('');
      setFamilyDob('');
    } catch (caught) {
      setFamilyError(describeError(caught).message);
    } finally {
      setSaving(false);
    }
  };

  if (step === 'family') {
    return (
      <Screen scroll edges={['top']} contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.xxl }}>
        <ScreenHeader title="Add a family member?" onBack={() => setStep('details')} />

        <Text variant="body" color={color.textSecondary}>
          Booking for your child or a parent takes one tap once they are on your account. You can add up to 10, and you
          can always add them later from Profile.
        </Text>

        {addedFamily.length > 0 ? (
          <Card variant="mint" style={{ gap: spacing.sm }}>
            <Text variant="bodyStrong">On your account</Text>
            {addedFamily.map((entry) => (
              <Text key={entry} variant="small">
                {entry}
              </Text>
            ))}
          </Card>
        ) : null}

        <Button label="Add a family member" icon="user-plus" variant="secondary" onPress={() => setFamilyOpen(true)} />

        <Card variant="flat" style={{ backgroundColor: color.surfaceAlt, gap: spacing.xs }}>
          <Text variant="bodyStrong">Notification permission</Text>
          <Text variant="small">
            You will get reminders 24 hours and 2 hours before each visit. If you decline notifications, we still show
            them in the Alerts tab and by SMS for cancellations.
          </Text>
        </Card>

        <View style={{ gap: spacing.sm, marginTop: 'auto' }}>
          <Button label={addedFamily.length > 0 ? 'Continue' : 'Not now, take me home'} onPress={finish} />
          <Button label="Skip for now" variant="ghost" size="sm" onPress={finish} />
        </View>

        <Sheet visible={familyOpen} onClose={() => setFamilyOpen(false)} title="Family member" subtitle="Who are you booking for?">
          <TextField
            label="Full name"
            value={familyName}
            onChangeText={setFamilyName}
            placeholder="Aarav Sharma"
            autoCapitalize="words"
          />
          <Text variant="label">Relationship</Text>
          <ChipRow>
            {RELATIONSHIPS.map((relationship) => (
              <Chip
                key={relationship}
                label={relationship.charAt(0).toUpperCase() + relationship.slice(1)}
                selected={familyRelationship === relationship}
                onPress={() => setFamilyRelationship(relationship)}
              />
            ))}
          </ChipRow>
          <TextField
            label="Date of birth"
            value={familyDob}
            onChangeText={setFamilyDob}
            placeholder="2019-06-02"
            keyboardType="numbers-and-punctuation"
            error={familyError ?? undefined}
            helper="YYYY-MM-DD — used for age-appropriate care and consent checks."
          />
          <SegmentedControl options={GENDERS} value={familyGender} onChange={setFamilyGender} accessibilityLabel="Gender" />
          <Button label="Add to my account" onPress={() => void addFamilyMember()} loading={saving} />
          <Button label="Cancel" variant="ghost" onPress={() => setFamilyOpen(false)} />
        </Sheet>
      </Screen>
    );
  }

  return (
    <Screen scroll edges={['top']} contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.xxl }}>
      <ScreenHeader title="Set up your profile" subtitle="Doctors need this to see you safely" />

      <Text variant="body" color={color.textSecondary}>
        This is what your doctor sees before a consultation. You can change any of it later.
      </Text>

      <TextField
        label="Your name"
        value={name}
        onChangeText={setName}
        placeholder="Priya Sharma"
        autoCapitalize="words"
        error={nameError ?? undefined}
        helper="As you would like to be addressed in the clinic."
      />

      <TextField
        label="Date of birth"
        value={dob}
        onChangeText={setDob}
        placeholder="1992-04-18"
        keyboardType="numbers-and-punctuation"
        error={dobError ?? undefined}
        helper="Required before your first booking — some consultations are age-restricted."
      />

      <View style={{ gap: spacing.sm }}>
        <Text variant="label">Gender</Text>
        <SegmentedControl options={GENDERS} value={gender} onChange={setGender} accessibilityLabel="Gender" />
        <Text variant="caption">Shown to your doctor as {genderLabel(gender).toLowerCase()}.</Text>
      </View>

      {failure ? <InlineNotice message={describeError(failure).message} /> : null}

      <PolicyNote
        tone="info"
        title="No medical records stored"
        body="MediBook does not keep notes, prescriptions or test results. Your doctor keeps those in their own system."
      />

      <Button label="Continue" iconRight="arrow-right" onPress={() => void saveDetails()} loading={saving} disabled={!canSave} />
    </Screen>
  );
}
