/**
 * Help & support (doctor side) — the scheduling, conflict and cancellation
 * behaviours that generate support contacts.
 *
 * The rule copy is generated from the same platform constants the slot engine uses,
 * so it cannot drift from what the server actually does.
 */
import * as React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import { defaultPlatformConfig } from '@medibook/core';
import { Card, PolicyNote, Screen, ScreenHeader, SectionHeading, Text, brand, color, spacing } from '@medibook/brand';

const FAQ: ReadonlyArray<{ question: string; answer: string }> = [
  {
    question: 'How are my slots generated?',
    answer:
      'From your weekly template, minus leaves and blocks, minus appointments that occupy a slot, minus external calendar busy time, minus the buffers you configured, then filtered by your minimum notice and booking window. Two people reading your availability always see the same thing.',
  },
  {
    question: 'What happens when two patients book the same slot?',
    answer:
      'Exactly one booking is created. The database enforces a uniqueness rule on doctor plus slot for active appointments, so the loser is told the slot was taken and shown the nearest alternatives. This is a guarantee, not a best-effort check.',
  },
  {
    question: 'Why did my calendar conflict not cancel the patient?',
    answer:
      'By design. An external event that overlaps a booked appointment raises a conflict and asks you to resolve it. MediBook never cancels a patient on the strength of a calendar signal alone — you either reschedule them or keep the appointment.',
  },
  {
    question: 'What does blocking time do to existing bookings?',
    answer:
      'Nothing. The block stops future patients from seeing those slots, and any booked appointment inside the range appears on a resolution list where you reschedule or cancel each one. Patients are notified either way.',
  },
  {
    question: 'Do patients see my calendar?',
    answer:
      'No. Patients cannot see that a calendar exists, which provider it is, or any derived busy data. We read busy/free intervals only and discard event titles, attendees and notes at ingestion.',
  },
  {
    question: 'How do refunds work when I cancel?',
    answer:
      'A clinic-side cancellation always refunds the patient in full, with no fee and no argument, and sends an apology with a rebooking link. Patient-initiated cancellations follow the tiered policy they agreed to before paying.',
  },
  {
    question: 'What happens if I do not answer an approval request?',
    answer:
      'In manual approval mode a request that is not answered inside the auto-decline window is declined and refunded automatically. The slot returns to your open pool — this is why manual mode is a staffing commitment rather than just a toggle.',
  },
];

export default function DoctorHelpScreen() {
  const router = useRouter();

  return (
    <Screen scroll edges={['top']} contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.huge }}>
      <ScreenHeader title="Help & support" subtitle="How scheduling and integrity work" onBack={() => router.back()} />

      <View style={{ gap: spacing.md }}>
        <SectionHeading title="Common questions" />
        {FAQ.map((entry) => (
          <Card key={entry.question} variant="flat" style={{ gap: spacing.sm }}>
            <Text variant="bodyStrong">{entry.question}</Text>
            <Text variant="small">{entry.answer}</Text>
          </Card>
        ))}
      </View>

      <View style={{ gap: spacing.md }}>
        <SectionHeading title="Platform defaults" />
        <Card variant="flat" style={{ gap: spacing.sm }}>
          <Text variant="small">
            • Slot hold during patient checkout: {defaultPlatformConfig.hold_minutes} minutes, one active hold per patient.
          </Text>
          <Text variant="small">
            • Default minimum notice {defaultPlatformConfig.min_notice_minutes} minutes and a{' '}
            {defaultPlatformConfig.booking_window_days}-day booking window, both overridable per doctor.
          </Text>
          <Text variant="small">
            • Default buffer {defaultPlatformConfig.buffer_minutes} minutes between appointments, clamped to 0–30.
          </Text>
          <Text variant="small">
            • Patient cancellation tiers: 100% at {defaultPlatformConfig.cancel_free_hours} h or more,{' '}
            {defaultPlatformConfig.cancel_partial_percent}% from {defaultPlatformConfig.cancel_partial_hours} h to{' '}
            {defaultPlatformConfig.cancel_free_hours} h, nothing inside {defaultPlatformConfig.cancel_partial_hours} h.
          </Text>
          <Text variant="small">
            • No-show grace defaults: {defaultPlatformConfig.no_show_grace_minutes_video} minutes video,{' '}
            {defaultPlatformConfig.no_show_grace_minutes_clinic} minutes in clinic.
          </Text>
          <Text variant="small">
            • Patient reschedules: up to {defaultPlatformConfig.max_reschedules} per appointment, at least{' '}
            {defaultPlatformConfig.reschedule_min_hours} hours before the start.
          </Text>
        </Card>
      </View>

      <View style={{ gap: spacing.md }}>
        <SectionHeading title="Talk to a human" />
        <Card variant="flat" style={{ gap: spacing.sm }}>
          <Text variant="bodyStrong">{brand.supportEmail}</Text>
          <Text variant="small">{brand.supportPhone} · clinic support line, 7am–11pm</Text>
          <Text variant="caption">
            Quote the appointment code (for example MB-8H2K4) — support can read the full state trail for it.
          </Text>
        </Card>
      </View>

      <PolicyNote
        tone="warning"
        title="Clinical emergencies"
        body="For a patient who is deteriorating, follow your local clinical escalation protocol first. MediBook is a scheduling tool and has no role in emergency care."
      />

      <Card variant="flat" style={{ backgroundColor: color.surfaceAlt, gap: spacing.xs }}>
        <Text variant="bodyStrong">This build</Text>
        <Text variant="small">
          Everything runs against a bundled dataset unless an API URL is configured. Calendar OAuth, payments and video
          tokens are simulated locally and no external provider is contacted.
        </Text>
        <Text variant="caption" onPress={() => router.push('/settings/legal')}>
          Read the privacy notice →
        </Text>
      </Card>
    </Screen>
  );
}
