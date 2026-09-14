/**
 * J9/J10 — the verification wizard.
 *
 * Two steps in one screen: professional identity (registration number, council,
 * country, specialisations) and document capture (licence, government ID,
 * optional degree certificates). The document "upload" is a filename capture —
 * this build has no camera or file picker wired, and it says so rather than
 * pretending (the API stores metadata only, exactly like the mock fixtures).
 *
 * The status card covers every state the API can report: `pending`,
 * `under_review`, `approved`, `rejected` (with structured reason + resubmission)
 * and `suspended`.
 */
import * as React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import type { VerificationStatus } from '@medibook/core';
import {
  Badge,
  Button,
  Card,
  Chip,
  ChipRow,
  Icon,
  PolicyNote,
  Screen,
  ScreenHeader,
  SectionHeading,
  Text,
  TextField,
  color,
  spacing,
} from '@medibook/brand';

import { useSpecializations, useSubmitVerification, useVerification } from '../../src/lib/hooks';
import { describeError } from '../../src/lib/format';
import { markGoLive, useCurrentUser } from '../../src/lib/session';
import { ErrorState, InlineNotice, ListSkeleton } from '../../src/components/states';

type DocumentKind = 'license' | 'government_id' | 'degree';

const STATUS_COPY: Record<VerificationStatus, { title: string; body: string; tone: 'info' | 'warning' | 'success' | 'danger' }> = {
  pending: {
    title: 'Not submitted yet',
    body: 'Submit your registration details and documents. Patients cannot see you until this is approved.',
    tone: 'info',
  },
  under_review: {
    title: 'Under review',
    body: 'Typically a decision within 24 hours. You can keep building your profile and schedule while you wait — you just cannot go live.',
    tone: 'warning',
  },
  approved: {
    title: 'Verified',
    body: 'Your registration and licence have been checked. Licensed-field edits re-trigger a review, which pauses discoverability until re-approved.',
    tone: 'success',
  },
  rejected: {
    title: 'Not approved',
    body: 'Fix the issues below and resubmit. Nothing else about your account changes.',
    tone: 'danger',
  },
  suspended: {
    title: 'Suspended',
    body: 'Your listing is hidden and new bookings are blocked. Contact support before making changes.',
    tone: 'danger',
  },
};

export default function VerificationWizardScreen() {
  const router = useRouter();
  const user = useCurrentUser();
  const verification = useVerification();
  const specializations = useSpecializations();
  const submitVerification = useSubmitVerification();

  const [registrationNumber, setRegistrationNumber] = React.useState('');
  const [council, setCouncil] = React.useState('');
  const [country, setCountry] = React.useState('India');
  const [selectedSpecializations, setSelectedSpecializations] = React.useState<string[]>([]);
  const [documents, setDocuments] = React.useState<Array<{ kind: DocumentKind; filename: string }>>([]);
  const [hydrated, setHydrated] = React.useState(false);
  const [failure, setFailure] = React.useState<unknown>(null);

  React.useEffect(() => {
    if (hydrated || !verification.data) return;
    setRegistrationNumber(verification.data.registration_number);
    setCouncil(verification.data.council);
    setCountry(verification.data.country);
    setSelectedSpecializations(verification.data.specialization_slugs);
    setDocuments(
      verification.data.documents.map((document) => ({ kind: document.kind, filename: document.filename })),
    );
    setHydrated(true);
  }, [hydrated, verification.data]);

  const status = verification.data?.status ?? 'pending';
  const statusCopy = STATUS_COPY[status];
  const approved = status === 'approved';

  const toggleSpecialization = (slug: string) => {
    setSelectedSpecializations((current) => {
      if (current.includes(slug)) return current.filter((entry) => entry !== slug);
      // One primary plus up to three additional (DOC-003).
      if (current.length >= 4) return current;
      return [...current, slug];
    });
  };

  const attach = (kind: DocumentKind) => {
    setDocuments((current) => [
      ...current.filter((document) => document.kind !== kind),
      { kind, filename: `${kind === 'license' ? 'medical-licence' : kind === 'government_id' ? 'government-id' : 'degree-certificate'}.pdf` },
    ]);
  };

  const hasLicense = documents.some((document) => document.kind === 'license');
  const valid =
    registrationNumber.trim().length >= 5 &&
    council.trim().length >= 3 &&
    country.trim().length >= 2 &&
    selectedSpecializations.length >= 1 &&
    hasLicense;

  const submit = async () => {
    if (!valid) return;
    setFailure(null);
    try {
      await submitVerification.mutateAsync({
        registration_number: registrationNumber.trim(),
        council: council.trim(),
        country: country.trim(),
        specialization_slugs: selectedSpecializations,
        documents,
      });
    } catch (caught) {
      setFailure(caught);
    }
  };

  return (
    <Screen scroll edges={['top']} contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.huge }}>
      <ScreenHeader
        title="Verification"
        subtitle={`Signed in as ${user?.display_name ?? 'doctor'}`}
        action={{ icon: 'help', onPress: () => router.push('/settings/help'), accessibilityLabel: 'Help' }}
      />

      {verification.isLoading ? (
        <ListSkeleton count={3} />
      ) : verification.isError ? (
        <ErrorState error={verification.error} onRetry={() => void verification.refetch()} />
      ) : (
        <>
          <Card
            variant="flat"
            style={{
              gap: spacing.sm,
              backgroundColor:
                statusCopy.tone === 'success'
                  ? color.mint
                  : statusCopy.tone === 'danger'
                    ? color.dangerTint
                    : statusCopy.tone === 'warning'
                      ? color.starTint
                      : color.infoTint,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Icon
                name={approved ? 'shield-check' : status === 'rejected' || status === 'suspended' ? 'alert-circle' : 'clock'}
                size={20}
                color={approved ? color.success : color.dark}
              />
              <Text variant="bodyStrong">{statusCopy.title}</Text>
              <Badge label={status.replace(/_/g, ' ')} tone={approved ? 'verified' : 'neutral'} />
            </View>
            <Text variant="small">{statusCopy.body}</Text>
            {verification.data?.submitted_at ? (
              <Text variant="caption">
                Submitted {verification.data.submitted_at.slice(0, 10)}
                {verification.data.reviewed_at ? ` · reviewed ${verification.data.reviewed_at.slice(0, 10)}` : ''}
              </Text>
            ) : null}
            {verification.data?.rejection_reason ? (
              <Text variant="small" color={color.danger}>
                Reason: {verification.data.rejection_reason}
              </Text>
            ) : null}
          </Card>

          {verification.data && verification.data.checklist.length > 0 ? (
            <View style={{ gap: spacing.sm }}>
              <SectionHeading title="Ready to go live" />
              <Card variant="flat" style={{ gap: spacing.sm }}>
                {verification.data.checklist.map((item) => (
                  <View key={item.key} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <Icon
                      name={item.done ? 'check-circle' : 'alert-circle'}
                      size={16}
                      color={item.done ? color.success : color.textMuted}
                    />
                    <Text variant="small" style={{ flex: 1 }}>
                      {item.label}
                    </Text>
                    <Text variant="caption">{item.done ? 'Done' : 'To do'}</Text>
                  </View>
                ))}
              </Card>
            </View>
          ) : null}

          {approved ? (
            <>
              <PolicyNote
                tone="success"
                title="You are live"
                body="Patients can find you and book your open slots. Changes to licensed fields (registration number, council, specialisations) pause discoverability until they are re-reviewed."
              />
              <Button
                label="Go to my schedule"
                onPress={() => {
                  // Clears `pendingOnboarding` so the root gate lets the tabs through.
                  markGoLive();
                  router.replace('/(tabs)');
                }}
              />
            </>
          ) : (
            <>
              <View style={{ gap: spacing.md }}>
                <SectionHeading title="Professional identity" />
                <TextField
                  label="Registration number"
                  value={registrationNumber}
                  onChangeText={setRegistrationNumber}
                  placeholder="MH-2014-44821"
                  helper="Exactly as printed on your council certificate. Duplicates are flagged for review."
                />
                <TextField
                  label="Council or board"
                  value={council}
                  onChangeText={setCouncil}
                  placeholder="Maharashtra Medical Council"
                />
                <TextField label="Country of registration" value={country} onChangeText={setCountry} placeholder="India" />
              </View>

              <View style={{ gap: spacing.sm }}>
                <SectionHeading title="Specialisations" />
                <Text variant="caption">
                  Pick one primary and up to three additional. The first one you choose leads your listing.
                </Text>
                {specializations.isLoading ? (
                  <ListSkeleton count={0} chips />
                ) : (
                  <ChipRow>
                    {(specializations.data ?? [])
                      .filter((entry) => entry.is_active)
                      .map((entry, index) => (
                        <Chip
                          key={entry.slug}
                          label={
                            selectedSpecializations[0] === entry.slug
                              ? `${entry.name} · primary`
                              : entry.name
                          }
                          selected={selectedSpecializations.includes(entry.slug)}
                          onPress={() => toggleSpecialization(entry.slug)}
                        />
                      ))}
                    <Chip
                      label={selectedSpecializations.length >= 4 ? 'Maximum selected' : `${selectedSpecializations.length}/4 selected`}
                      readOnly
                    />
                  </ChipRow>
                )}
              </View>

              <View style={{ gap: spacing.md }}>
                <SectionHeading title="Documents" />
                <Text variant="caption">
                  Document capture is simulated in this build: no camera or file picker is bundled, and only the filename
                  is stored. The real deployment uploads to a private bucket with EXIF stripping and virus scanning.
                </Text>
                <DocumentRow
                  title="Medical licence"
                  subtitle="Required — the certificate showing your registration number"
                  attached={documents.some((document) => document.kind === 'license')}
                  onAttach={() => attach('license')}
                />
                <DocumentRow
                  title="Government ID"
                  subtitle="Required for identity matching against the register"
                  attached={documents.some((document) => document.kind === 'government_id')}
                  onAttach={() => attach('government_id')}
                />
                <DocumentRow
                  title="Degree certificates"
                  subtitle="Optional, but they appear on your profile as qualifications"
                  attached={documents.some((document) => document.kind === 'degree')}
                  onAttach={() => attach('degree')}
                />
              </View>

              {failure ? <InlineNotice message={describeError(failure).message} /> : null}

              <PolicyNote
                tone="info"
                title="What we do with your documents"
                body="They are visible only to the verification team, stored privately, and never shared with patients. Patients see your qualifications and a verified badge — never the document images."
              />

              <Button
                label={submitVerification.isPending ? 'Submitting…' : status === 'rejected' ? 'Resubmit for review' : 'Submit for review'}
                loading={submitVerification.isPending}
                disabled={!valid}
                icon="upload"
                onPress={() => void submit()}
              />
              {!valid ? (
                <Text variant="caption">
                  Add a registration number, council, country, at least one specialisation and your licence to submit.
                </Text>
              ) : null}

              <Button
                label="Skip for now"
                variant="ghost"
                onPress={() => {
                  markGoLive();
                  router.replace('/(tabs)');
                }}
              />
              <Text variant="caption">
                Skipping keeps you in setup mode: you can build your profile and schedule, but patients will not find you
                until verification is approved.
              </Text>
            </>
          )}

          <Card variant="flat" style={{ backgroundColor: color.surfaceAlt, gap: spacing.xs }}>
            <Text variant="bodyStrong">Signed in on this device</Text>
            <Text variant="small">
              {user?.email ?? user?.phone ?? 'No contact on record'} · {user?.default_timezone ?? 'Asia/Kolkata'}
            </Text>
          </Card>
        </>
      )}
    </Screen>
  );
}

function DocumentRow({
  title,
  subtitle,
  attached,
  onAttach,
}: {
  title: string;
  subtitle: string;
  attached: boolean;
  onAttach: () => void;
}) {
  return (
    <Card variant="flat" style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: attached ? color.mint : color.border,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name={attached ? 'check-circle' : 'upload'} size={20} color={attached ? color.success : color.textMuted} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong">{title}</Text>
          <Text variant="small">{subtitle}</Text>
        </View>
      </View>
      <Button
        label={attached ? 'Replace file' : 'Attach file'}
        variant={attached ? 'secondary' : 'primary'}
        size="sm"
        icon={attached ? 'refresh' : 'camera'}
        onPress={onAttach}
      />
    </Card>
  );
}
