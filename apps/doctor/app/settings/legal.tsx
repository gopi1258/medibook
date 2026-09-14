/**
 * Privacy notice & terms (doctor side).
 *
 * Written to match what the build actually does, and to be explicit about the
 * clinician's own obligations: MediBook handles scheduling and identity, not
 * clinical records.
 */
import * as React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import { Card, PolicyNote, Screen, ScreenHeader, SectionHeading, Text, brand, color, spacing } from '@medibook/brand';

const PRIVACY: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: 'What we hold about you',
    body: 'Your contact details, professional profile, specialisations, qualifications, languages, clinic address and timezone, verification documents and their review outcome, fees and durations, availability rules and exceptions, booking policy, and connected-calendar metadata.',
  },
  {
    title: 'What we hold about patients',
    body: 'Their name, contact details, date of birth and gender, the notes they leave when booking, and the appointments they have with you. You can see the subset relevant to your own visits only.',
  },
  {
    title: 'What we never store',
    body: 'Diagnoses, prescriptions, consultation notes, test results, imaging or attachments. MediBook is not an electronic medical record and does not attempt to be one.',
  },
  {
    title: 'Calendars',
    body: 'Read-only busy/free access. Event titles, attendees, descriptions and locations are discarded at ingestion and never stored. Patients cannot see that a calendar is connected, and we never write to it.',
  },
  {
    title: 'Verification documents',
    body: 'Visible only to the verification team. Patients see your qualifications and a verified badge, never the document images. Changing licensed fields returns you to review.',
  },
  {
    title: 'Notifications',
    body: 'Rendered from parameterised templates. We keep patient names out of push bodies where possible so lock screens do not leak who you are about to see.',
  },
  {
    title: 'Retention and offboarding',
    body: 'Appointment and financial records are retained as healthcare and tax rules require. Deactivation hides your listing and blocks new bookings; it does not erase completed-visit history, because the patients on the other side of those records have their own retention rights.',
  },
];

const TERMS: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: 'Your responsibilities',
    body: 'Keep your availability accurate, honour confirmed appointments, and respond to approval requests within the configured window if you switch manual approval on. Patients plan their day around what you publish.',
  },
  {
    title: 'Verification',
    body: 'Your listing depends on valid registration. If a licence lapses or is revoked, your listing is suspended under the same cascade as an admin suspension, and existing appointments are flagged for resolution rather than dropped.',
  },
  {
    title: 'Cancellations',
    body: 'Clinic-side cancellations trigger a full patient refund and an apology with rebooking assistance. A persistently high cancellation rate is a marketplace signal and affects discovery ranking.',
  },
  {
    title: 'No double-booking',
    body: 'The platform prevents two patients being booked into one slot. If you also keep bookings in another system, connect that calendar so its busy time is respected — otherwise MediBook cannot know about it.',
  },
  {
    title: 'Data protection',
    body: 'You are an independent controller of the clinical relationship. MediBook is a processor for the scheduling data described above. Do not use the booking note field for clinical information — patients can see what they wrote, and it is not an encrypted record.',
  },
  {
    title: 'Fees',
    body: 'Fee and duration changes apply to future bookings only. Patients who already booked keep the price they paid, and their receipt is unchanged.',
  },
];

export default function DoctorLegalScreen() {
  const router = useRouter();

  return (
    <Screen scroll edges={['top']} contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.huge }}>
      <ScreenHeader title="Privacy & terms" subtitle="For clinicians using MediBook" onBack={() => router.back()} />

      <PolicyNote
        tone="info"
        title="Version"
        body="Draft v1.0, dated 2026-09-14. Market-specific compliance — data residency, medical-records retention, consent rules for minors — is still with legal, and this notice will name the applicable jurisdiction once that closes."
      />

      <View style={{ gap: spacing.md }}>
        <SectionHeading title="Privacy notice" />
        {PRIVACY.map((entry) => (
          <Card key={entry.title} variant="flat" style={{ gap: spacing.xs }}>
            <Text variant="bodyStrong">{entry.title}</Text>
            <Text variant="small">{entry.body}</Text>
          </Card>
        ))}
      </View>

      <View style={{ gap: spacing.md }}>
        <SectionHeading title="Terms of use" />
        {TERMS.map((entry) => (
          <Card key={entry.title} variant="flat" style={{ gap: spacing.xs }}>
            <Text variant="bodyStrong">{entry.title}</Text>
            <Text variant="small">{entry.body}</Text>
          </Card>
        ))}
      </View>

      <Card variant="flat" style={{ backgroundColor: color.surfaceAlt, gap: spacing.xs }}>
        <Text variant="bodyStrong">Contact</Text>
        <Text variant="small">
          {brand.supportEmail} · {brand.supportPhone}
        </Text>
        <Text variant="small">
          For a data-subject request from a patient, direct them to Profile → Request account deletion, or email us with the
          appointment code.
        </Text>
        <Text variant="caption" onPress={() => router.push('/settings/help')}>
          Back to help →
        </Text>
      </Card>
    </Screen>
  );
}
