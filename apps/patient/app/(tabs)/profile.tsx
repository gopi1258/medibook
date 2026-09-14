/**
 * Profile (PRD §7.1 / PAT-003…PAT-007) — details, family members, saved doctors,
 * notification preferences, language, help, legal, logout and the account
 * deletion request.
 *
 * Destructive actions are behind a confirmation sheet and state their
 * consequences plainly (PAT-007: deletion is blocked while paid appointments are
 * upcoming — the API returns the blockers and we list them).
 */
import * as React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import {
  Avatar,
  Badge,
  Button,
  Card,
  Icon,
  ListRow,
  PolicyNote,
  Screen,
  ScreenHeader,
  SectionHeading,
  Sheet,
  Text,
  TextArea,
  color,
  spacing,
} from '@medibook/brand';

import { patientApi } from '../../src/lib/api';
import { describeError, genderLabel } from '../../src/lib/format';
import { useDependents, usePatientProfile, useSavedDoctors } from '../../src/lib/hooks';
import { signOut, useCurrentUser } from '../../src/lib/session';
import { InlineNotice } from '../../src/components/states';

export default function ProfileScreen() {
  const router = useRouter();
  const user = useCurrentUser();
  const profile = usePatientProfile();
  const dependents = useDependents();
  const savedDoctors = useSavedDoctors();

  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleteReason, setDeleteReason] = React.useState('');
  const [deleteBlockers, setDeleteBlockers] = React.useState<string[]>([]);
  const [deleteDone, setDeleteDone] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<unknown>(null);

  const details = profile.data;
  const upcoming = dependents.data?.reduce((sum, dependent) => sum + (dependent.upcoming_appointments ?? 0), 0) ?? 0;

  const requestDeletion = async () => {
    setBusy(true);
    setFailure(null);
    try {
      const result = await patientApi.requestAccountDeletion(deleteReason.trim() || undefined);
      setDeleteBlockers(result.resolve_first);
      setDeleteDone(result.requested_at);
    } catch (caught) {
      setFailure(caught);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll edges={['top']} contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.huge }}>
      <ScreenHeader
        title="Profile"
        subtitle="Your account, family and preferences"
        action={{ icon: 'edit', onPress: () => router.push('/settings/edit-profile'), accessibilityLabel: 'Edit details' }}
      />

      <Card style={{ gap: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Avatar name={details?.display_name ?? user?.display_name ?? 'You'} size="lg" />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="h3">{details?.display_name ?? user?.display_name ?? '—'}</Text>
            <Text variant="small">{details?.phone ?? user?.phone ?? 'No phone on file'}</Text>
            <Text variant="caption">{details?.email ?? user?.email ?? 'No email on file'}</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
          <Badge label={genderLabel(details?.gender ?? user?.gender)} tone="neutral" icon="user" />
          <Badge label={details?.dob ? `DOB ${details.dob}` : 'DOB missing'} tone={details?.dob ? 'neutral' : 'warning'} icon="calendar" />
          <Badge label={details?.default_timezone ?? 'Asia/Kolkata'} tone="info" icon="globe" />
        </View>
        {!details?.dob ? (
          <PolicyNote
            tone="warning"
            title="Date of birth required"
            body="Some consultations are age-restricted. Add your date of birth before your next booking."
          />
        ) : null}
      </Card>

      <View style={{ gap: spacing.sm }}>
        <SectionHeading title="Family" action={<Button label="Manage" size="sm" variant="ghost" block={false} onPress={() => router.push('/family')} />} />
        <Card variant="flat" style={{ gap: spacing.md }}>
          {(dependents.data ?? []).length === 0 ? (
            <Text variant="small">
              No family members yet. Add a child or a parent and you can book, reschedule and review on their behalf.
            </Text>
          ) : (
            (dependents.data ?? []).map((dependent) => (
              <ListRow
                key={dependent.id}
                title={dependent.name}
                subtitle={`${dependent.relationship} · DOB ${dependent.dob}`}
                icon="user"
                badge={dependent.upcoming_appointments}
                onPress={() => router.push(`/family/${dependent.id}`)}
              />
            ))
          )}
          <Button label="Add a family member" icon="user-plus" variant="secondary" onPress={() => router.push('/family/new')} />
          {upcoming > 0 ? (
            <Text variant="caption">{upcoming} upcoming visit{upcoming === 1 ? '' : 's'} booked for family members.</Text>
          ) : null}
        </Card>
      </View>

      <View style={{ gap: spacing.sm }}>
        <SectionHeading title="Saved doctors" />
        <Card variant="flat" style={{ gap: spacing.md }}>
          {(savedDoctors.data ?? []).length === 0 ? (
            <Text variant="small">Tap the heart on a doctor card to keep them here for one-tap rebooking.</Text>
          ) : (
            (savedDoctors.data ?? []).slice(0, 3).map((doctor) => (
              <ListRow
                key={doctor.id}
                title={doctor.name}
                subtitle={`${doctor.specialties[0] ?? 'Doctor'} · ${doctor.area}`}
                icon="heart-filled"
                onPress={() => router.push(`/doctor/${doctor.id}`)}
              />
            ))
          )}
          <ListRow
            title="All saved doctors"
            subtitle={`${(savedDoctors.data ?? []).length} saved`}
            icon="heart"
            onPress={() => router.push('/settings/saved-doctors')}
          />
        </Card>
      </View>

      <View style={{ gap: spacing.sm }}>
        <SectionHeading title="Preferences" />
        <Card variant="flat">
          <ListRow
            title="Notification preferences"
            subtitle="Push, email and SMS per category, quiet hours"
            icon="bell"
            onPress={() => router.push('/settings/notifications')}
          />
          <ListRow
            title="Language"
            value="English"
            subtitle="More languages arrive in the next release"
            icon="globe"
            disabled
          />
          <ListRow
            title="My details"
            subtitle="Name, date of birth, gender, emergency contact"
            icon="edit"
            onPress={() => router.push('/settings/edit-profile')}
          />
        </Card>
      </View>

      <View style={{ gap: spacing.sm }}>
        <SectionHeading title="Support" />
        <Card variant="flat">
          <ListRow title="Help & support" subtitle="How booking, refunds and video consults work" icon="help" onPress={() => router.push('/settings/help')} />
          <ListRow title="Privacy & terms" subtitle="What we store and why" icon="shield-check" onPress={() => router.push('/settings/legal')} />
        </Card>
      </View>

      <View style={{ gap: spacing.sm }}>
        <Button label="Log out" variant="secondary" icon="logout" onPress={() => void signOut()} />
        <Button label="Request account deletion" variant="ghost" icon="trash" onPress={() => setDeleteOpen(true)} />
        <Text variant="caption" align="center">
          MediBook · version {process.env['EXPO_PUBLIC_APP_VERSION'] ?? '1.0.0'}
        </Text>
      </View>

      <Sheet
        visible={deleteOpen}
        onClose={() => {
          setDeleteOpen(false);
          setDeleteBlockers([]);
          setDeleteDone(null);
          setFailure(null);
        }}
        title="Request account deletion"
        subtitle="We anonymise your personal data and keep only what the law requires"
        footer={
          deleteDone ? (
            <Button
              label="Close"
              onPress={() => {
                setDeleteOpen(false);
                setDeleteDone(null);
              }}
            />
          ) : (
            <View style={{ gap: spacing.sm }}>
              <Button label="Submit request" variant="destructive" loading={busy} onPress={() => void requestDeletion()} />
              <Button label="Cancel" variant="ghost" onPress={() => setDeleteOpen(false)} />
            </View>
          )
        }
      >
        {deleteDone ? (
          <View style={{ gap: spacing.md }}>
            <PolicyNote
              tone="success"
              title="Deletion requested"
              body={`Submitted on ${deleteDone.slice(0, 10)}. Our support team processes deletion requests within 30 days.`}
            />
            {deleteBlockers.length > 0 ? (
              <Card variant="flat" style={{ backgroundColor: color.dangerTint, gap: spacing.sm }}>
                <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                  <Icon name="alert-triangle" size={18} color={color.danger} />
                  <Text variant="bodyStrong" color={color.danger}>
                    Resolve these first
                  </Text>
                </View>
                {deleteBlockers.map((blocker) => (
                  <Text key={blocker} variant="small">
                    • {blocker}
                  </Text>
                ))}
              </Card>
            ) : null}
          </View>
        ) : (
          <View style={{ gap: spacing.lg }}>
            <PolicyNote
              tone="warning"
              title="What deletion means"
              body="Your profile, family members and saved doctors are erased. Appointment records are kept without your name because tax and medical-records law requires it."
            />
            <TextArea
              label="Reason (optional)"
              value={deleteReason}
              onChangeText={setDeleteReason}
              placeholder="Tell us what went wrong — it helps us fix it."
            />
            {failure ? <InlineNotice message={describeError(failure).message} /> : null}
          </View>
        )}
      </Sheet>
    </Screen>
  );
}
