/**
 * Profile (PRD §7.2 / DOC-003, DOC-016) — professional profile, fees, clinic
 * address, verification status, notification preferences, help, legal, logout and
 * the deactivation request.
 *
 * Deactivation is deliberately not "delete": the doctor is asked to resolve
 * future appointments first and is told plainly what happens to existing
 * bookings, because stranding patients is the failure mode the PRD calls out.
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
  VerifiedBadge,
  color,
  spacing,
} from '@medibook/brand';

import { doctorApi } from '../../src/lib/api';
import { describeError, formatMoney } from '../../src/lib/format';
import { useCalendarAccounts, useDoctorProfile, useSpecializations, useStats, useVerification } from '../../src/lib/hooks';
import { isLive, signOut, useCurrentUser } from '../../src/lib/session';
import { InlineNotice } from '../../src/components/states';

export default function DoctorProfileScreen() {
  const router = useRouter();
  const user = useCurrentUser();
  const profile = useDoctorProfile();
  const verification = useVerification();
  const specializations = useSpecializations();
  const accounts = useCalendarAccounts();
  const stats = useStats();

  const [deactivateOpen, setDeactivateOpen] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [result, setResult] = React.useState<{ requested_at: string; future_appointments: number } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<unknown>(null);

  const data = profile.data;
  const live = isLive(user);
  const specialtyNames = (data?.specialization_slugs ?? [])
    .map((slug) => specializations.data?.find((entry) => entry.slug === slug)?.name ?? slug)
    .join(' · ');

  const requestDeactivation = async () => {
    setBusy(true);
    setFailure(null);
    try {
      const response = await doctorApi.requestDeactivation(reason.trim().length > 0 ? reason.trim() : 'No reason given');
      setResult(response);
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
        subtitle="Your public listing and account"
        action={{ icon: 'edit', onPress: () => router.push('/profile/edit'), accessibilityLabel: 'Edit profile' }}
      />

      <Card style={{ gap: spacing.md }}>
        <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
          <Avatar name={data?.display_name ?? user?.display_name ?? 'Doctor'} size="lg" tone="blossom" />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="h3">{data?.display_name ?? user?.display_name ?? 'Doctor'}</Text>
            <Text variant="small">{specialtyNames || 'No specialisation selected'}</Text>
            <Text variant="caption">
              {data?.experience_years ?? 0} yrs experience · {data?.languages.join(', ') ?? 'No languages set'}
            </Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
          <VerifiedBadge status={data?.verification_status ?? user?.verification_status ?? 'pending'} />
          {live ? <Badge label="Discoverable" tone="accent" icon="eye" /> : <Badge label="Setup mode" tone="warning" icon="lock" />}
          <Badge
            label={accounts.data?.length ? `${accounts.data.length} calendar${accounts.data.length === 1 ? '' : 's'}` : 'No calendar'}
            tone={accounts.data?.length ? 'verified' : 'warning'}
            icon="link"
          />
        </View>

        {data?.deactivation_requested_at ? (
          <PolicyNote
            tone="warning"
            title="Deactivation requested"
            body={`Submitted on ${data.deactivation_requested_at.slice(0, 10)}. Support will work through your future appointments with you before anything is switched off.`}
          />
        ) : null}
      </Card>

      <View style={{ gap: spacing.sm }}>
        <SectionHeading title="Listing" />
        <Card variant="flat">
          <ListRow
            title="Professional profile"
            subtitle="Photo, bio, qualifications, specialisations, experience, languages"
            icon="user"
            onPress={() => router.push('/profile/edit')}
          />
          <ListRow
            title="Consultation types & fees"
            subtitle="In-clinic and video, with durations"
            value={data ? formatMoney(data.consultation_config.fees[0]?.fee_minor ?? 0, data.consultation_config.fees[0]?.currency ?? 'INR') : undefined}
            icon="credit-card"
            onPress={() => router.push('/profile/fees')}
          />
          <ListRow
            title="Clinic address"
            subtitle={data?.clinic_address ?? 'Not set'}
            icon="map-pin"
            onPress={() => router.push('/profile/edit')}
          />
          <ListRow
            title="Verification & documents"
            subtitle={
              verification.data
                ? `${verification.data.status.replace(/_/g, ' ')} · ${verification.data.documents.length} document${verification.data.documents.length === 1 ? '' : 's'}`
                : undefined
            }
            icon="shield-check"
            onPress={() => router.push('/profile/verification')}
          />
        </Card>
      </View>

      <View style={{ gap: spacing.sm }}>
        <SectionHeading title="Practice" />
        <Card variant="flat">
          <ListRow
            title="Weekly template & hours"
            subtitle="Days, windows, slot length, buffers"
            icon="clock"
            onPress={() => router.push('/schedule/rules')}
          />
          <ListRow
            title="Leaves & blocks"
            subtitle="One-off unavailability, never silently applied to bookings"
            icon="calendar-plus"
            onPress={() => router.push('/schedule/exceptions')}
          />
          <ListRow
            title="Calendar connections"
            subtitle="Google and Outlook, busy/free only"
            icon="link"
            onPress={() => router.push('/schedule/calendar')}
          />
          <ListRow
            title="Booking policy"
            subtitle="Min notice, window, approval mode, no-show grace"
            icon="settings"
            onPress={() => router.push('/schedule/policy')}
          />
        </Card>
      </View>

      <View style={{ gap: spacing.sm }}>
        <SectionHeading title="Today’s numbers" />
        <Card variant="flat" style={{ gap: spacing.sm }}>
          <Text variant="small">
            {stats.data?.today_total ?? 0} appointments today · {stats.data?.today_completed ?? 0} completed ·{' '}
            {stats.data?.pending_approvals ?? 0} awaiting approval
          </Text>
          <Text variant="caption">
            {stats.data?.conflicts_open ?? 0} open calendar conflicts · last sync{' '}
            {stats.data?.last_synced_at ? stats.data.last_synced_at.slice(0, 16).replace('T', ' ') : 'never'}
          </Text>
        </Card>
      </View>

      <View style={{ gap: spacing.sm }}>
        <SectionHeading title="Account" />
        <Card variant="flat">
          <ListRow
            title="Notification preferences"
            subtitle="Per-category push, email and SMS"
            icon="bell"
            onPress={() => router.push('/settings/notifications')}
          />
          <ListRow title="Help & support" subtitle="How scheduling and conflicts work" icon="help" onPress={() => router.push('/settings/help')} />
          <ListRow title="Privacy & terms" subtitle="What we store about you and your patients" icon="shield-check" onPress={() => router.push('/settings/legal')} />
        </Card>
      </View>

      <View style={{ gap: spacing.sm }}>
        <Button label="Log out" variant="secondary" icon="logout" onPress={() => void signOut()} />
        <Button
          label="Request deactivation"
          variant="ghost"
          icon="alert-circle"
          onPress={() => setDeactivateOpen(true)}
          disabled={Boolean(data?.deactivation_requested_at)}
        />
        <Text variant="caption" align="center">
          {user?.email ?? user?.phone ?? 'No contact on record'} · MediBook for Doctors 1.0.0
        </Text>
      </View>

      <Sheet
        visible={deactivateOpen}
        onClose={() => {
          setDeactivateOpen(false);
          setResult(null);
          setFailure(null);
        }}
        title="Request deactivation"
        subtitle="We resolve your future appointments with you first"
        footer={
          result ? (
            <Button label="Close" onPress={() => setDeactivateOpen(false)} />
          ) : (
            <View style={{ gap: spacing.sm }}>
              <Button label="Submit request" variant="destructive" loading={busy} onPress={() => void requestDeactivation()} />
              <Button label="Cancel" variant="ghost" onPress={() => setDeactivateOpen(false)} />
            </View>
          )
        }
      >
        {result ? (
          <View style={{ gap: spacing.lg }}>
            <PolicyNote
              tone="success"
              title="Request received"
              body={`Submitted on ${result.requested_at.slice(0, 10)}. Support will contact you to work through the next steps.`}
            />
            {result.future_appointments > 0 ? (
              <Card variant="flat" style={{ backgroundColor: color.dangerTint, gap: spacing.sm }}>
                <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                  <Icon name="alert-triangle" size={18} color={color.danger} />
                  <Text variant="bodyStrong" color={color.danger}>
                    {result.future_appointments} future appointment
                    {result.future_appointments === 1 ? '' : 's'}
                  </Text>
                </View>
                <Text variant="small">
                  Each one must be rescheduled or cancelled — cancelling triggers a full refund and an apology message to
                  the patient. Nothing is cancelled on your behalf.
                </Text>
                <Button
                  label="Open upcoming appointments"
                  variant="ghost"
                  size="sm"
                  block={false}
                  onPress={() => {
                    setDeactivateOpen(false);
                    router.push('/(tabs)/appointments');
                  }}
                />
              </Card>
            ) : (
              <Text variant="small">You have no future appointments, so nothing needs resolving first.</Text>
            )}
          </View>
        ) : (
          <View style={{ gap: spacing.lg }}>
            <PolicyNote
              tone="warning"
              title="What deactivation does"
              body="Your listing is hidden, new bookings are blocked, and future appointments need resolving. Existing appointments and their records are retained as healthcare and financial rules require — this is not a data erasure."
            />
            <TextArea
              label="Reason (optional)"
              value={reason}
              onChangeText={setReason}
              placeholder="Retiring, moving practice, changing platforms…"
            />
            {failure ? <InlineNotice message={describeError(failure).message} /> : null}
          </View>
        )}
      </Sheet>
    </Screen>
  );
}
