/**
 * Family member editor (PAT-004) — create when `dependentId` is `new`, edit
 * otherwise. Presented as a modal sheet so the booking flow never loses its place.
 */
import * as React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import type { Dependent, Gender } from '@medibook/core';
import {
  Button,
  Card,
  Chip,
  ChipRow,
  PolicyNote,
  SegmentedControl,
  Sheet,
  Text,
  TextArea,
  TextField,
  color,
  spacing,
} from '@medibook/brand';

import { patientApi } from '../../src/lib/api';
import { ageFromDob, ageLabel, describeError, relationshipLabel } from '../../src/lib/format';
import { useDependents } from '../../src/lib/hooks';
import { queryKeys } from '../../src/lib/query';
import { InlineNotice, ListSkeleton } from '../../src/components/states';

const RELATIONSHIPS: ReadonlyArray<Dependent['relationship']> = ['son', 'daughter', 'spouse', 'parent', 'sibling', 'other'];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export default function DependentEditorScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { dependentId } = useLocalSearchParams<{ dependentId?: string }>();
  const creating = dependentId === 'new' || dependentId === undefined;

  const dependents = useDependents();
  const existing = creating ? undefined : dependents.data?.find((entry) => entry.id === dependentId);

  const [name, setName] = React.useState('');
  const [relationship, setRelationship] = React.useState<Dependent['relationship']>('son');
  const [dob, setDob] = React.useState('');
  const [gender, setGender] = React.useState<Gender>('male');
  const [notes, setNotes] = React.useState('');
  const [hydrated, setHydrated] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [failure, setFailure] = React.useState<unknown>(null);

  React.useEffect(() => {
    if (creating || hydrated || !existing) return;
    setName(existing.name);
    setRelationship(existing.relationship);
    setDob(existing.dob);
    setGender(existing.gender);
    setNotes(existing.notes ?? '');
    setHydrated(true);
  }, [creating, existing, hydrated]);

  const nameError = name.trim().length < 2 ? 'Enter their full name.' : null;
  const dobError = !DATE_PATTERN.test(dob)
    ? 'Use YYYY-MM-DD.'
    : (ageFromDob(dob) ?? 0) > 120
      ? 'That date does not look right.'
      : null;
  const valid = !nameError && !dobError;

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    setFailure(null);
    try {
      if (creating) {
        await patientApi.createDependent({
          name: name.trim(),
          relationship,
          dob,
          gender,
          notes: notes.trim().length > 0 ? notes.trim() : null,
        });
      } else if (dependentId) {
        await patientApi.updateDependent(dependentId, {
          name: name.trim(),
          relationship,
          dob,
          gender,
          notes: notes.trim().length > 0 ? notes.trim() : null,
        });
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.dependents });
      router.back();
    } catch (caught) {
      setFailure(caught);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      visible
      onClose={() => router.back()}
      title={creating ? 'Add a family member' : 'Edit family member'}
      subtitle="Their details are shared with the doctor only for their own appointments"
      footer={
        <View style={{ gap: spacing.sm }}>
          <Button
            label={saving ? 'Saving…' : creating ? 'Add to my account' : 'Save changes'}
            loading={saving}
            disabled={!valid || saving}
            onPress={() => void save()}
          />
          <Button label="Cancel" variant="ghost" onPress={() => router.back()} />
        </View>
      }
    >
      {!creating && dependents.isLoading ? (
        <ListSkeleton count={2} />
      ) : (
        <View style={{ gap: spacing.lg }}>
          <TextField
            label="Full name"
            value={name}
            onChangeText={setName}
            placeholder="Aarav Sharma"
            autoCapitalize="words"
            error={nameError ?? undefined}
          />

          <Text variant="label">Relationship</Text>
          <ChipRow>
            {RELATIONSHIPS.map((option) => (
              <Chip
                key={option}
                label={relationshipLabel(option)}
                selected={relationship === option}
                onPress={() => setRelationship(option)}
              />
            ))}
          </ChipRow>

          <TextField
            label="Date of birth"
            value={dob}
            onChangeText={setDob}
            placeholder="2019-06-02"
            keyboardType="numbers-and-punctuation"
            error={dobError ?? undefined}
            helper="YYYY-MM-DD — drives age-appropriate care and consent checks."
          />

          <Text variant="label">Gender</Text>
          <SegmentedControl
            accessibilityLabel="Gender"
            options={[
              { value: 'female', label: 'Female' },
              { value: 'male', label: 'Male' },
              { value: 'other', label: 'Other' },
            ]}
            value={gender}
            onChange={setGender}
          />

          <TextArea
            label="Notes for the doctor (optional)"
            value={notes}
            onChangeText={setNotes}
            placeholder="Allergies, current medicines, anything the doctor should know."
            maxLength={300}
          />

          {!creating && existing ? (
            <Card variant="flat" style={{ gap: spacing.xs, backgroundColor: color.surfaceAlt }}>
              <Text variant="bodyStrong">Currently</Text>
              <Text variant="small">
                {ageLabel(ageFromDob(existing.dob))} · {relationshipLabel(existing.relationship)} ·{' '}
                {existing.upcoming_appointments ?? 0} upcoming visit
                {(existing.upcoming_appointments ?? 0) === 1 ? '' : 's'}
              </Text>
            </Card>
          ) : null}

          {failure ? <InlineNotice message={describeError(failure).message} /> : null}

          <PolicyNote
            tone="info"
            title="What the doctor sees"
            body="Their name, age, gender, your booking note and any visits they have had with that doctor. Never your other family members’ history."
          />
        </View>
      )}
    </Sheet>
  );
}
