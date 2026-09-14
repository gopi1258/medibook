/**
 * Family members (PAT-004 / R16) — list, add, edit and remove dependents.
 *
 * Removing a member with upcoming appointments is refused by the API
 * (`APT_DEPENDENT_HAS_APPOINTMENTS`); the screen explains what to do next rather
 * than hiding the failure (EC-14).
 */
import * as React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

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
  Text,
  color,
  spacing,
} from '@medibook/brand';

import { patientApi } from '../../src/lib/api';
import { ageFromDob, ageLabel, describeError, genderLabel, relationshipLabel } from '../../src/lib/format';
import { useDependents } from '../../src/lib/hooks';
import { queryKeys } from '../../src/lib/query';
import { ErrorState, InlineNotice, ListSkeleton } from '../../src/components/states';

export default function FamilyScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const dependents = useDependents();
  const [failure, setFailure] = React.useState<unknown>(null);
  const [blocked, setBlocked] = React.useState<string | null>(null);

  const remove = async (dependentId: string, name: string) => {
    setFailure(null);
    try {
      await patientApi.deleteDependent(dependentId);
      await queryClient.invalidateQueries({ queryKey: queryKeys.dependents });
    } catch (caught) {
      setFailure(caught);
      const described = describeError(caught);
      if (described.code === 'APT_DEPENDENT_HAS_APPOINTMENTS') setBlocked(name);
    }
  };

  return (
    <Screen
      scroll
      edges={['top']}
      contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.huge }}
      refreshing={dependents.isRefetching && !dependents.isLoading}
      onRefresh={() => void dependents.refetch()}
    >
      <ScreenHeader
        title="Family members"
        subtitle="Book, reschedule and review on their behalf"
        onBack={() => router.back()}
      />

      {dependents.isLoading ? (
        <ListSkeleton count={2} />
      ) : dependents.isError ? (
        <ErrorState error={dependents.error} onRetry={() => void dependents.refetch()} />
      ) : (dependents.data ?? []).length === 0 ? (
        <EmptyState
          icon="users"
          title="No family members yet"
          description="Add a child or a parent once and they appear in every booking flow. You can add up to 10 people, and the account holder stays responsible for every booking made for them."
          actionLabel="Add a family member"
          onAction={() => router.push('/family/new')}
        />
      ) : (
        <View style={{ gap: spacing.md }}>
          {(dependents.data ?? []).map((dependent) => (
            <Card key={dependent.id} style={{ gap: spacing.md }}>
              <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
                <Avatar name={dependent.name} size="md" tone="mint" />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="h3">{dependent.name}</Text>
                  <Text variant="small">
                    {relationshipLabel(dependent.relationship)} · {ageLabel(ageFromDob(dependent.dob))} ·{' '}
                    {genderLabel(dependent.gender)}
                  </Text>
                  <Text variant="caption">Born {dependent.dob}</Text>
                </View>
              </View>

              {dependent.notes ? <Text variant="small">Note: {dependent.notes}</Text> : null}

              <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
                <Badge
                  label={
                    dependent.upcoming_appointments
                      ? `${dependent.upcoming_appointments} upcoming`
                      : 'No upcoming visits'
                  }
                  tone={dependent.upcoming_appointments ? 'accent' : 'neutral'}
                  icon="calendar"
                />
              </View>

              <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
                <Button
                  label="Book a visit"
                  size="sm"
                  block={false}
                  onPress={() => router.push({ pathname: '/(tabs)/discover', params: { for: dependent.id } })}
                />
                <Button
                  label="Edit"
                  size="sm"
                  variant="secondary"
                  block={false}
                  onPress={() => router.push(`/family/${dependent.id}`)}
                />
                <Button
                  label="Remove"
                  size="sm"
                  variant="ghost"
                  block={false}
                  onPress={() => void remove(dependent.id, dependent.name)}
                />
              </View>
            </Card>
          ))}
        </View>
      )}

      {failure ? (
        <InlineNotice
          message={describeError(failure).message}
          tone={blocked ? 'warning' : 'danger'}
          action={
            blocked
              ? {
                  label: 'See their appointments',
                  onPress: () => router.push({ pathname: '/(tabs)/appointments', params: { scope: 'upcoming' } }),
                }
              : undefined
          }
        />
      ) : null}

      {blocked ? (
        <PolicyNote
          tone="warning"
          title={`${blocked} still has upcoming visits`}
          body="Removing a family member while they have appointments would strand those bookings. Reschedule or cancel them first from the Appointments tab, then remove the profile."
        />
      ) : null}

      <Card variant="flat" style={{ backgroundColor: color.surfaceAlt, gap: spacing.sm }}>
        <Text variant="bodyStrong">Consent for minors</Text>
        <Text variant="small">
          You confirm you are the parent or legal guardian of any child on your account, and that you consent to their
          treatment. The clinic may ask for proof of guardianship on the day.
        </Text>
      </Card>

      <ListRow
        title="Add a family member"
        subtitle="Name, relationship, date of birth and an optional note for the doctor"
        icon="user-plus"
        onPress={() => router.push('/family/new')}
      />
    </Screen>
  );
}
