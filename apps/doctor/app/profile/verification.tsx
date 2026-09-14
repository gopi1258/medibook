/**
 * Verification status & documents (DOC-002).
 *
 * The wizard in the auth group is where documents are first submitted; this screen
 * is the permanent home for the status, the structured rejection reason and the
 * resubmission path. It also shows the go-live checklist so "why can't patients
 * see me yet?" always has an actionable answer.
 */
import * as React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import {
  Badge,
  Button,
  Card,
  Icon,
  PolicyNote,
  Screen,
  ScreenHeader,
  SectionHeading,
  Text,
  color,
  spacing,
} from '@medibook/brand';

import { useDoctorProfile, useSpecializations, useVerification } from '../../src/lib/hooks';
import { describeError } from '../../src/lib/format';
import { useCurrentUser } from '../../src/lib/session';
import { ErrorState, ListSkeleton } from '../../src/components/states';

export default function VerificationStatusScreen() {
  const router = useRouter();
  const user = useCurrentUser();
  const verification = useVerification();
  const profile = useDoctorProfile();
  const specializations = useSpecializations();

  const data = verification.data;
  const approved = data?.status === 'approved';
  const specialtyNames = (profile.data?.specialization_slugs ?? [])
    .map((slug) => specializations.data?.find((entry) => entry.slug === slug)?.name ?? slug)
    .join(' · ');

  return (
    <Screen scroll edges={['top']} contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.huge }}>
      <ScreenHeader title="Verification" subtitle="Documents, status and go-live checklist" onBack={() => router.back()} />

      {verification.isLoading ? (
        <ListSkeleton count={3} />
      ) : verification.isError ? (
        <ErrorState error={verification.error} onRetry={() => void verification.refetch()} />
      ) : !data ? (
        <Text variant="small">{describeError(verification.error).message}</Text>
      ) : (
        <>
          <Card
            variant="flat"
            style={{
              gap: spacing.sm,
              backgroundColor:
                data.status === 'approved'
                  ? color.mint
                  : data.status === 'rejected' || data.status === 'suspended'
                    ? color.dangerTint
                    : color.infoTint,
            }}
          >
            <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center', flexWrap: 'wrap' }}>
              <Icon
                name={approved ? 'shield-check' : data.status === 'under_review' ? 'clock' : 'alert-circle'}
                size={20}
                color={approved ? color.success : color.dark}
              />
              <Text variant="bodyStrong">{data.status.replace(/_/g, ' ')}</Text>
              <Badge
                label={approved ? 'Discoverable' : 'Setup mode'}
                tone={approved ? 'verified' : 'warning'}
                icon={approved ? 'eye' : 'lock'}
              />
            </View>
            <Text variant="small">
              {approved
                ? 'Patients can find and book you. Editing licensed fields (registration number, council, specialisations) pauses discoverability until the change is re-reviewed.'
                : data.status === 'rejected'
                  ? 'Fix the issues below and resubmit. Nothing else about your account is affected.'
                  : 'A decision is typically made within 24 hours. You can keep editing your profile, fees and schedule while you wait.'}
            </Text>
            {data.submitted_at ? (
              <Text variant="caption">
                Submitted {data.submitted_at.slice(0, 10)}
                {data.reviewed_at ? ` · reviewed ${data.reviewed_at.slice(0, 10)}` : ' · awaiting review'}
              </Text>
            ) : null}
          </Card>

          {data.rejection_reason ? (
            <Card variant="flat" style={{ gap: spacing.sm, backgroundColor: color.dangerTint }}>
              <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                <Icon name="alert-triangle" size={18} color={color.danger} />
                <Text variant="bodyStrong" color={color.danger}>
                  Reason for rejection
                </Text>
              </View>
              <Text variant="small">{data.rejection_reason}</Text>
              <Text variant="caption">
                Common fixes: a clearer scan of the licence, the registration number exactly as printed, or a council name
                that matches the certificate.
              </Text>
            </Card>
          ) : null}

          <View style={{ gap: spacing.md }}>
            <SectionHeading title="Submitted details" />
            <Card variant="flat" style={{ gap: spacing.sm }}>
              <Row label="Registration number" value={data.registration_number} />
              <Row label="Council / board" value={data.council} />
              <Row label="Country" value={data.country} />
              <Row label="Specialisations" value={specialtyNames || '—'} />
              <Row label="Signed-in identity" value={user?.email ?? user?.phone ?? '—'} />
            </Card>
          </View>

          <View style={{ gap: spacing.md }}>
            <SectionHeading title="Documents" />
            <Card variant="flat" style={{ gap: spacing.md }}>
              {data.documents.length === 0 ? (
                <Text variant="small">No documents on file yet — use the verification wizard to submit them.</Text>
              ) : (
                data.documents.map((document) => (
                  <View key={document.id} style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
                    <Icon name="check-circle" size={18} color={color.success} />
                    <View style={{ flex: 1 }}>
                      <Text variant="smallMedium">
                        {document.kind === 'license'
                          ? 'Medical licence'
                          : document.kind === 'government_id'
                            ? 'Government ID'
                            : 'Degree certificate'}
                      </Text>
                      <Text variant="caption">
                        {document.filename} · uploaded {document.uploaded_at.slice(0, 10)}
                      </Text>
                    </View>
                  </View>
                ))
              )}
              <Button
                label="Resubmit or update documents"
                variant="secondary"
                icon="upload"
                onPress={() => router.push('/(auth)/verification')}
              />
            </Card>
          </View>

          <View style={{ gap: spacing.md }}>
            <SectionHeading title="Ready to go live" />
            <Card variant="flat" style={{ gap: spacing.sm }}>
              {data.checklist.map((item) => (
                <View key={item.key} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <Icon
                    name={item.done ? 'check-circle' : 'alert-circle'}
                    size={16}
                    color={item.done ? color.success : color.textMuted}
                  />
                  <Text variant="small" style={{ flex: 1 }}>
                    {item.label}
                  </Text>
                  <Badge label={item.done ? 'Done' : 'To do'} tone={item.done ? 'verified' : 'warning'} />
                </View>
              ))}
            </Card>
          </View>

          <PolicyNote
            tone="info"
            title="Why verification exists"
            body="Unverified supply is a safety and legal risk, so MediBook never lists a clinician before their registration and identity documents have been reviewed. Duplicate registration numbers across accounts are flagged for review."
          />

          <Card variant="flat" style={{ backgroundColor: color.surfaceAlt, gap: spacing.xs }}>
            <Text variant="bodyStrong">Document handling in this build</Text>
            <Text variant="small">
              Document capture is simulated: only filenames are stored, and no camera, file picker or upload endpoint is
              bundled. Production uploads to a private bucket with EXIF stripping, type sniffing and virus scanning.
            </Text>
            <Text variant="small">
              Changing your registration number, council or specialisations after approval returns you to review, and your
              listing is paused until it clears.
            </Text>
          </Card>

          <Button label="Back to profile" variant="ghost" onPress={() => router.back()} />
        </>
      )}
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}>
      <Text variant="small" style={{ minWidth: 130 }}>
        {label}
      </Text>
      <Text variant="bodyMedium" style={{ flex: 1 }}>
        {value}
      </Text>
    </View>
  );
}
