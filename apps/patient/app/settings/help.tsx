/**
 * Help & support (PRD §7.1) — plain-language answers for the flows that generate
 * support contacts, plus the escalation path.
 *
 * The policy copy is generated from the same rule constants the booking engine
 * uses, so it cannot drift from what the server will actually do.
 */
import * as React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import { defaultPlatformConfig, formatMoney } from '@medibook/core';
import { Card, PolicyNote, Screen, ScreenHeader, SectionHeading, Text, brand, color, spacing } from '@medibook/brand';

import { formatDuration } from '../../src/lib/format';

const FAQ: ReadonlyArray<{ question: string; answer: string }> = [
  {
    question: 'What exactly happens when I book?',
    answer:
      'You pick a slot, and the platform holds it for you for five minutes so nobody else can take it while you pay. Your appointment is created once, inside a single locked transaction, so the same slot can never be sold twice — even if two people tap at the same instant.',
  },
  {
    question: 'Why did a slot disappear while I was looking at it?',
    answer:
      'Availability comes from the doctor’s real schedule and, where connected, their own calendar. When a slot is taken or an external meeting appears, it stops being offered. We show you how fresh the data is on every availability screen.',
  },
  {
    question: 'Can I book for my child or my parents?',
    answer:
      'Yes. Add them once under Profile → Family members, then choose who the visit is for in the booking sheet. You stay responsible for payment and for the visit happening.',
  },
  {
    question: 'What if a time is shown in a different timezone?',
    answer:
      'Every time is stored in UTC and rendered in your own timezone, with the label spelled out. For cross-region video consults we also show the doctor’s clinic time, so nobody turns up at the wrong hour across a daylight-saving change.',
  },
  {
    question: 'How do I join a video consultation?',
    answer:
      'The join button opens five minutes before the start and stays usable for fifteen minutes after it. You can rejoin during that window if your connection drops.',
  },
];

export default function HelpScreen() {
  const router = useRouter();

  return (
    <Screen scroll edges={['top']} contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.huge }}>
      <ScreenHeader title="Help & support" subtitle="How MediBook behaves" onBack={() => router.back()} />

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
        <SectionHeading title="The rules we apply" />
        <Card variant="flat" style={{ gap: spacing.sm }}>
          <Text variant="small">
            • Booking window: between {formatDuration(defaultPlatformConfig.min_notice_minutes)} notice and{' '}
            {defaultPlatformConfig.booking_window_days} days ahead.
          </Text>
          <Text variant="small">
            • Reschedules: up to {defaultPlatformConfig.max_reschedules} per appointment, at least{' '}
            {formatDuration(defaultPlatformConfig.reschedule_min_hours * 60)} before the start. Free for a same-type move.
          </Text>
          <Text variant="small">
            • Cancellations: 100% refund {defaultPlatformConfig.cancel_free_hours} h or more before the start,{' '}
            {defaultPlatformConfig.cancel_partial_percent}% between {defaultPlatformConfig.cancel_partial_hours} and{' '}
            {defaultPlatformConfig.cancel_free_hours} hours, nothing inside{' '}
            {defaultPlatformConfig.cancel_partial_hours} hours.
          </Text>
          <Text variant="small">
            • Doctors who cancel always trigger a full refund, with no fee and no argument.
          </Text>
          <Text variant="small">
            • No-shows: the doctor can mark one after {defaultPlatformConfig.no_show_grace_minutes_video} minutes for video
            and {defaultPlatformConfig.no_show_grace_minutes_clinic} minutes in clinic. You can dispute it and support will
            review the appointment trail.
          </Text>
          <Text variant="small">
            • Reviews: one per completed visit, editable for {defaultPlatformConfig.review_edit_hours} hours.
          </Text>
          <Text variant="small">
            • Slot holds: {defaultPlatformConfig.hold_minutes} minutes, one active hold per patient at a time.
          </Text>
        </Card>
      </View>

      <View style={{ gap: spacing.md }}>
        <SectionHeading title="Talk to a human" />
        <Card variant="flat" style={{ gap: spacing.sm }}>
          <Text variant="bodyStrong">{brand.supportEmail}</Text>
          <Text variant="small">{brand.supportPhone} · 8am–10pm, every day</Text>
          <Text variant="caption">
            Have your appointment code ready — it is shown on every appointment and looks like MB-8H2K4.
          </Text>
        </Card>
      </View>

      <PolicyNote
        tone="info"
        title="Medical emergencies"
        body="MediBook is for booking appointments, not for emergencies. If someone is seriously unwell, call your local emergency number or go to the nearest emergency department."
      />

      <Card variant="flat" style={{ backgroundColor: color.surfaceAlt, gap: spacing.xs }}>
        <Text variant="bodyStrong">Report a problem with this build</Text>
        <Text variant="small">
          This is a local build running against a bundled dataset. Nothing you do here leaves your device unless you point
          it at a MediBook API.
        </Text>
      </Card>

      <Text variant="caption" onPress={() => router.push('/settings/legal')}>
        Read the privacy notice and terms →
      </Text>
    </Screen>
  );
}
