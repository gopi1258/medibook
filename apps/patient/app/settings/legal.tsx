/**
 * Privacy notice & terms (PRD §7.1 "Legal").
 *
 * Written to match what this build actually does — including what it does *not*
 * do (no medical records, no calendar event contents, no card data). Compliance
 * obligations per market are still open questions in the PRD (Q6–Q9), and the
 * notice says so instead of pretending otherwise.
 */
import * as React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import { Card, PolicyNote, Screen, ScreenHeader, SectionHeading, Text, brand, color, spacing } from '@medibook/brand';

const PRIVACY: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: 'What we collect',
    body: 'Your name, phone number or email, date of birth, gender, timezone, the family members you add, your notification choices, and the appointments you book. Nothing more.',
  },
  {
    title: 'What we never collect',
    body: 'Medical records, prescriptions, test results, diagnoses, card numbers, calendar event titles or attendees. MediBook schedules appointments; your clinical records stay with your doctor.',
  },
  {
    title: 'Why we collect it',
    body: 'To show the right slots in your timezone, to let you book for your family, to keep both sides informed, and to satisfy the record-keeping that healthcare and tax rules require.',
  },
  {
    title: 'Calendars',
    body: 'When a doctor connects a calendar we read busy and free time only, using a read-only scope. Event names, attendees and notes are discarded at ingestion and are never shown to patients.',
  },
  {
    title: 'Who can see what',
    body: 'A doctor sees only the patients booked with them, and only those patients’ history with that doctor. Your phone number is masked. Support staff see masked identifiers unless a documented reason unlocks them, and that access is logged.',
  },
  {
    title: 'How long we keep it',
    body: 'Appointment records are retained as long as healthcare and financial record-keeping rules require. Everything else is deleted when you delete your account.',
  },
  {
    title: 'Your controls',
    body: 'You can edit your details, remove family members, change notification channels, log out of every session, and request deletion of your account from Profile. Deletion anonymises your personal data and keeps only the transactional skeleton the law requires.',
  },
];

const TERMS: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: 'What MediBook is',
    body: 'A booking service that connects patients with independently practising clinicians. The clinical relationship is between you and your doctor; MediBook does not practise medicine or provide medical advice.',
  },
  {
    title: 'Verification',
    body: 'Every doctor on the platform has had their registration and identity documents reviewed before appearing in search. A verified badge reflects that review at a point in time — it is not an endorsement of outcomes.',
  },
  {
    title: 'Booking integrity',
    body: 'A confirmed appointment means the slot is yours. The platform holds slots during checkout and enforces a uniqueness constraint at the database level, which is why the same slot cannot be sold to two people.',
  },
  {
    title: 'Fees and refunds',
    body: 'The fee for a consultation is shown before you pay, together with the cancellation policy that applies to it. Refunds follow that policy automatically; doctors who cancel always trigger a full refund.',
  },
  {
    title: 'Emergencies',
    body: 'Do not use MediBook for emergencies. Contact your local emergency number or go to the nearest emergency department.',
  },
  {
    title: 'Availability of the service',
    body: 'Booking works offline against a local dataset in this build. In production, booking requires a network connection by design: we would rather ask you to wait a moment than accept a slot we cannot verify.',
  },
];

export default function LegalScreen() {
  const router = useRouter();

  return (
    <Screen scroll edges={['top']} contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.huge }}>
      <ScreenHeader title="Privacy & terms" subtitle="Plain language, no surprises" onBack={() => router.back()} />

      <PolicyNote
        tone="info"
        title="Version"
        body="Draft v1.0, dated 2026-09-14. Market-specific compliance (data residency, retention periods, consent for minors) is still being confirmed with legal, and this notice will carry the applicable jurisdiction once that closes."
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
          For a data-subject request, use Profile → Request account deletion, or email us and quote your registered number.
        </Text>
      </Card>

      <Text variant="caption" onPress={() => router.push('/settings/help')}>
        Back to help →
      </Text>
    </Screen>
  );
}
