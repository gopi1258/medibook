/**
 * Today (PRD §7.2 / J11) — verified status header, the day's timeline, the
 * calendar-conflict banner, quick stats and the next free slot.
 *
 * The timeline is generated from `listAppointments({ scope: "today" })` which the
 * API buckets in the **doctor's clinic timezone** (not the device's), so a doctor
 * travelling still sees the right day.
 */
import * as React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import { toAppointmentCardModel } from '@medibook/core';
import {
  AppointmentCard,
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  ListRow,
  PolicyNote,
  Screen,
  ScreenHeader,
  SectionHeading,
  VerifiedBadge,
  Text,
  color,
  spacing,
} from '@medibook/brand';

import { useClinicTimeZone, useCurrentUser, isLive } from '../../src/lib/session';
import { useDoctorAppointments, useStats } from '../../src/lib/hooks';
import { useNow } from '../../src/lib/useNow';
import { clockLabel, describeError, formatMoney } from '../../src/lib/format';
import { ErrorState, ListSkeleton } from '../../src/components/states';

export default function TodayScreen() {
  const router = useRouter();
  const user = useCurrentUser();
  const clinicTz = useClinicTimeZone();
  const now = useNow(30_000);

  const stats = useStats();
  const today = useDoctorAppointments({ scope: 'today', limit: 50 });

  const items = today.data?.items ?? [];
  const live = isLive(user);
  const conflictIds = stats.data?.conflict_appointment_ids ?? [];
  const bookedValueMinor = items.reduce((sum, item) => sum + item.fee_minor, 0);
  const bookedCurrency = items[0]?.currency ?? 'INR';

  return (
    <Screen
      scroll
      edges={['top']}
      contentContainerStyle={{ gap: spacing.xl, paddingBottom: spacing.huge }}
      refreshing={today.isRefetching && !today.isLoading}
      onRefresh={() => {
        void today.refetch();
        void stats.refetch();
      }}
    >
      <ScreenHeader
        title={`Today, ${user?.display_name ?? 'Doctor'}`}
        subtitle={`${clockLabel(now, clinicTz)} · ${clinicTz.replace(/_/g, ' ')}`}
        action={{ icon: 'bell', onPress: () => router.push('/(tabs)/profile'), accessibilityLabel: 'Notifications' }}
      />

      <Card style={{ gap: spacing.md }}>
        <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
          <Avatar name={user?.display_name ?? 'Doctor'} size="md" tone="blossom" />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="h3">{user?.display_name ?? 'Doctor'}</Text>
            <Text variant="caption">Clinic timezone {user?.default_timezone ?? 'Asia/Kolkata'}</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
          <VerifiedBadge status={user?.verification_status ?? 'pending'} />
          <Badge
            label={stats.data?.calendar_status === 'not_connected' ? 'No calendar connected' : `Calendar ${stats.data?.calendar_status ?? 'unknown'}`}
            tone={stats.data?.calendar_status === 'connected' ? 'verified' : 'warning'}
            icon="link"
          />
          {live ? <Badge label="Discoverable" tone="accent" icon="eye" /> : <Badge label="Setup mode" tone="warning" icon="lock" />}
        </View>
        {!live ? (
          <PolicyNote
            tone="warning"
            title="You are not live yet"
            body="Patients cannot see or book you until your verification is approved. Your profile and schedule still save normally."
          />
        ) : null}
      </Card>

      {stats.isLoading ? (
        <ListSkeleton count={1} />
      ) : stats.isError ? (
        <ErrorState error={stats.error} onRetry={() => void stats.refetch()} compact />
      ) : (
        <View style={{ gap: spacing.md }}>
          <SectionHeading title="Today at a glance" />
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <StatTile label="Appointments" value={String(stats.data?.today_total ?? 0)} icon="calendar" />
            <StatTile label="Completed" value={String(stats.data?.today_completed ?? 0)} icon="check-circle" />
            <StatTile
              label="Cancel/awaiting"
              value={String((stats.data?.today_cancellations ?? 0) + (stats.data?.pending_approvals ?? 0))}
              icon="alert-circle"
            />
          </View>
          <Card variant="flat" style={{ gap: spacing.sm }}>
            <ListRow
              title="Next free slot"
              value={stats.data?.next_free_slot_utc ? clockLabel(Date.parse(stats.data.next_free_slot_utc), clinicTz) : 'None today'}
              subtitle="From your weekly template minus everything booked"
              icon="clock"
              onPress={() => router.push('/(tabs)/schedule')}
            />
            <ListRow
              title="Pending approvals"
              value={String(stats.data?.pending_approvals ?? 0)}
              subtitle="Requests waiting for your decision"
              icon="check"
              badge={stats.data?.pending_approvals}
              onPress={() => router.push('/(tabs)/appointments')}
            />
          </Card>
        </View>
      )}

      {conflictIds.length > 0 ? (
        <Card variant="flat" style={{ backgroundColor: color.dangerTint, gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
            <Icon name="alert-triangle" size={20} color={color.danger} />
            <Text variant="bodyStrong" color={color.danger}>
              {conflictIds.length} calendar conflict{conflictIds.length === 1 ? '' : 's'} today
            </Text>
          </View>
          <Text variant="small">
            An external calendar event overlaps a booked appointment. MediBook never cancels a patient for you — reschedule
            or keep each one explicitly.
          </Text>
          <Button
            label="Review the conflict"
            variant="secondary"
            size="sm"
            onPress={() => router.push(`/appointment/${conflictIds[0]!}`)}
          />
        </Card>
      ) : null}

      <View style={{ gap: spacing.md }}>
        <SectionHeading title="Timeline" />
        {today.isLoading ? (
          <ListSkeleton count={3} />
        ) : today.isError ? (
          <ErrorState error={today.error} onRetry={() => void today.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            icon="sun"
            title="Nothing booked today"
            description="Your published slots are open. Open your schedule to add a window, or block the day off."
            actionLabel="Open schedule"
            onAction={() => router.push('/(tabs)/schedule')}
          />
        ) : (
          <View style={{ gap: spacing.md }}>
            {items.map((appointment) => (
              <AppointmentCard
                key={appointment.id}
                viewer="doctor"
                compact
                appointment={toAppointmentCardModel(appointment, {
                  viewerTz: clinicTz,
                  nowMs: now,
                  conflictNote: conflictIds.includes(appointment.id)
                    ? 'Overlaps an external calendar event'
                    : null,
                })}
                onPress={() => router.push(`/appointment/${appointment.id}`)}
                onJoin={() => router.push(`/appointment/${appointment.id}`)}
                onComplete={() => router.push(`/appointment/${appointment.id}`)}
                onReschedule={() => router.push(`/appointment/${appointment.id}/reschedule`)}
                onCancel={() => router.push(`/appointment/${appointment.id}/cancel`)}
              />
            ))}
          </View>
        )}
      </View>

      <Card variant="flat" style={{ backgroundColor: color.surfaceAlt, gap: spacing.xs }}>
        <Text variant="bodyStrong">Today’s numbers</Text>
        <Text variant="small">
          {items.filter((item) => item.status === 'confirmed').length} confirmed ·{' '}
          {items.filter((item) => item.status === 'pending_approval').length} awaiting you ·{' '}
          {items.filter((item) => item.consult_type === 'video').length} video ·{' '}
          {formatMoney(bookedValueMinor, bookedCurrency)} of consultations booked.
        </Text>
        {today.isError ? <Text variant="caption">{describeError(today.error).message}</Text> : null}
      </Card>
    </Screen>
  );
}

function StatTile({ label, value, icon }: { label: string; value: string; icon: 'calendar' | 'check-circle' | 'alert-circle' }) {
  return (
    <Card variant="flat" style={{ flex: 1, gap: spacing.xs }}>
      <Icon name={icon} size={18} color={color.primary} />
      <Text variant="h2">{value}</Text>
      <Text variant="caption">{label}</Text>
    </Card>
  );
}
