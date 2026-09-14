/**
 * Schedule (PRD §7.2 / DOC-005…DOC-009) — the hub for everything that decides
 * what patients can book: weekly template, exceptions, calendar connections and
 * the booking policy.
 *
 * It also shows a live preview of the next few open slots so a doctor can see the
 * consequence of an edit immediately (the availability engine is shared with the
 * patient app, so the preview is the truth, not an approximation).
 */
import * as React from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';

import { formatDuration } from '@medibook/core';
import {
  Badge,
  Button,
  Card,
  DayStrip,
  Icon,
  ListRow,
  PolicyNote,
  Screen,
  ScreenHeader,
  SectionHeading,
  SkeletonSlotGrid,
  Text,
  color,
  spacing,
} from '@medibook/brand';
import { toDayViewModels } from '@medibook/core';

import {
  useCalendarAccounts,
  useExceptions,
  useOwnAvailability,
  usePolicy,
  useRules,
  useStats,
} from '../../src/lib/hooks';
import { useClinicTimeZone } from '../../src/lib/session';
import { useNow } from '../../src/lib/useNow';
import { clockLabel, consultTypeLabel, describeError } from '../../src/lib/format';
import { ErrorState, ListSkeleton } from '../../src/components/states';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function ScheduleScreen() {
  const router = useRouter();
  const clinicTz = useClinicTimeZone();
  const now = useNow(60_000);

  const rules = useRules();
  const exceptions = useExceptions();
  const policy = usePolicy();
  const accounts = useCalendarAccounts();
  const stats = useStats();
  const availability = useOwnAvailability({ type: 'in_person' });

  const [previewDate, setPreviewDate] = React.useState<string | null>(null);
  const dayModels = React.useMemo(
    () => (availability.data ? toDayViewModels(availability.data, { nowMs: now }) : []),
    [availability.data, now],
  );
  const activeDay = availability.data?.days.find((day) => day.date === previewDate);

  const grouped = React.useMemo(() => {
    const byWeekday = new Map<number, typeof rules.data>();
    for (const rule of rules.data ?? []) {
      const list = byWeekday.get(rule.weekday) ?? [];
      list.push(rule);
      byWeekday.set(rule.weekday, list);
    }
    return byWeekday;
  }, [rules.data]);

  const conflictsOpen = accounts.data?.reduce((sum, account) => sum + account.conflicts_open, 0) ?? 0;
  const affectedBookings = (exceptions.data ?? []).reduce(
    (sum, exception) => sum + exception.affected_appointments.length,
    0,
  );

  return (
    <Screen
      scroll
      edges={['top']}
      contentContainerStyle={{ gap: spacing.xl, paddingBottom: spacing.huge }}
      refreshing={availability.isRefetching && !availability.isLoading}
      onRefresh={() => {
        void rules.refetch();
        void exceptions.refetch();
        void accounts.refetch();
        void availability.refetch();
      }}
    >
      <ScreenHeader title="Schedule" subtitle={`${clinicTz.replace(/_/g, ' ')} is your canonical timezone`} />

      <View style={{ gap: spacing.md }}>
        <SectionHeading
          title="Weekly template"
          action={
            <Button
              label="Edit"
              size="sm"
              variant="ghost"
              block={false}
              onPress={() => router.push('/schedule/rules')}
            />
          }
        />
        {rules.isLoading ? (
          <ListSkeleton count={2} />
        ) : rules.isError ? (
          <ErrorState error={rules.error} onRetry={() => void rules.refetch()} compact />
        ) : (rules.data ?? []).length === 0 ? (
          <Card variant="peach" style={{ gap: spacing.sm }}>
            <Text variant="bodyStrong">No working hours yet</Text>
            <Text variant="small">
              Without a weekly template you publish no slots, so patients cannot book you at all.
            </Text>
            <Button label="Add working hours" onPress={() => router.push('/schedule/rules')} />
          </Card>
        ) : (
          <Card variant="flat" style={{ gap: spacing.md }}>
            {WEEKDAYS.map((label, weekday) => {
              const dayRules = grouped.get(weekday) ?? [];
              return (
                <View key={label} style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}>
                  <Text variant="smallMedium" style={{ width: 92 }}>
                    {label}
                  </Text>
                  <View style={{ flex: 1, gap: spacing.xs }}>
                    {dayRules.length === 0 ? (
                      <Text variant="caption">Closed</Text>
                    ) : (
                      dayRules.map((rule) => (
                        <Text key={rule.id} variant="small">
                          {rule.start_local_time}–{rule.end_local_time} · {rule.slot_minutes} min slots ·{' '}
                          {rule.buffer_minutes} min buffer ·{' '}
                          {rule.consult_types.map((type) => consultTypeLabel(type)).join(' + ')}
                        </Text>
                      ))
                    )}
                  </View>
                </View>
              );
            })}
          </Card>
        )}
      </View>

      <View style={{ gap: spacing.md }}>
        <SectionHeading title="Availability preview" />
        {availability.isLoading ? (
          <SkeletonSlotGrid count={6} />
        ) : availability.isError ? (
          <ErrorState error={availability.error} onRetry={() => void availability.refetch()} compact />
        ) : dayModels.length === 0 ? (
          <Text variant="small">No slots generated in the next three weeks — check your template and exceptions.</Text>
        ) : (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
              <DayStrip
                days={dayModels}
                selectedDate={previewDate}
                onSelect={setPreviewDate}
                tzLabel="Clinic timezone"
              />
            </ScrollView>
            <Card variant="flat" style={{ gap: spacing.sm }}>
              {activeDay === undefined ? (
                <Text variant="small">Pick a day above to see the slots patients are being offered.</Text>
              ) : (
                <>
                  <Text variant="bodyStrong">{activeDay.date}</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                    {activeDay.slots.slice(0, 24).map((slot) => (
                      <Badge
                        key={slot.start_utc}
                        label={clockLabel(Date.parse(slot.start_utc), clinicTz)}
                        tone={slot.status === 'available' ? 'verified' : slot.status === 'taken' ? 'danger' : 'neutral'}
                      />
                    ))}
                  </View>
                  <Text variant="caption">
                    {activeDay.slots.filter((slot) => slot.status === 'available').length} open ·{' '}
                    {activeDay.slots.filter((slot) => slot.status === 'taken').length} taken.
                    {activeDay.slots.some((slot) => slot.blocked_by === 'calendar')
                      ? ' Some slots are hidden because of external calendar busy time.'
                      : ''}
                  </Text>
                </>
              )}
            </Card>
          </>
        )}
      </View>

      <View style={{ gap: spacing.md }}>
        <SectionHeading title="Exceptions" />
        {exceptions.isLoading ? (
          <ListSkeleton count={1} />
        ) : exceptions.isError ? (
          <ErrorState error={exceptions.error} onRetry={() => void exceptions.refetch()} compact />
        ) : (
          <Card variant="flat" style={{ gap: spacing.md }}>
            {(exceptions.data ?? []).length === 0 ? (
              <Text variant="small">
                No leaves or blocks. Add one and the affected slots stop being offered immediately.
              </Text>
            ) : (
              (exceptions.data ?? []).slice(0, 4).map((exception) => (
                <View key={exception.id} style={{ gap: spacing.xs }}>
                  <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                    <Badge label={exception.kind} tone={exception.kind === 'leave' ? 'accent' : 'warning'} icon="calendar" />
                    <Text variant="smallMedium">
                      {exception.start_utc.slice(0, 10)} → {exception.end_utc.slice(0, 10)}
                    </Text>
                  </View>
                  {exception.reason ? <Text variant="caption">{exception.reason}</Text> : null}
                  {exception.affected_appointments.length > 0 ? (
                    <Text variant="caption" color={color.danger}>
                      {exception.affected_appointments.length} booked appointment
                      {exception.affected_appointments.length === 1 ? '' : 's'} now overlap this. They are never cancelled
                      silently — resolve each one.
                    </Text>
                  ) : null}
                </View>
              ))
            )}
            {affectedBookings > 0 ? (
              <PolicyNote
                tone="danger"
                title={`${affectedBookings} booking${affectedBookings === 1 ? '' : 's'} need resolving`}
                body="Existing appointments are never touched by a schedule change. Reschedule or cancel each one; the patient is notified either way and a doctor cancellation always refunds in full."
              />
            ) : null}
            <Button label="Manage leaves & blocks" variant="secondary" icon="calendar-plus" onPress={() => router.push('/schedule/exceptions')} />
          </Card>
        )}
      </View>

      <View style={{ gap: spacing.md }}>
        <SectionHeading title="Calendar connections" />
        {accounts.isLoading ? (
          <ListSkeleton count={1} />
        ) : accounts.isError ? (
          <ErrorState error={accounts.error} onRetry={() => void accounts.refetch()} compact />
        ) : (
          <Card variant="flat" style={{ gap: spacing.md }}>
            {(accounts.data ?? []).length === 0 ? (
              <Text variant="small">
                No calendar connected. Connect Google or Outlook and your busy time is subtracted from the slots patients
                see — event titles are never read or stored.
              </Text>
            ) : (
              (accounts.data ?? []).map((account) => (
                <View key={account.id} style={{ gap: spacing.xs }}>
                  <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Icon name="link" size={16} color={account.status === 'connected' ? color.success : color.danger} />
                    <Text variant="bodyMedium" style={{ flex: 1 }}>
                      {account.provider === 'google' ? 'Google Calendar' : 'Outlook'} · {account.account_email}
                    </Text>
                    <Badge
                      label={account.status}
                      tone={account.status === 'connected' ? 'verified' : account.status === 'syncing' ? 'info' : 'danger'}
                    />
                  </View>
                  <Text variant="caption">
                    {account.busy_events_90d} busy events in 90 days · last synced{' '}
                    {account.last_synced_at ? account.last_synced_at.slice(0, 16).replace('T', ' ') : 'never'}
                    {account.conflicts_open > 0 ? ` · ${account.conflicts_open} open conflict${account.conflicts_open === 1 ? '' : 's'}` : ''}
                  </Text>
                </View>
              ))
            )}
            {conflictsOpen > 0 ? (
              <PolicyNote
                tone="warning"
                title={`${conflictsOpen} conflict${conflictsOpen === 1 ? '' : 's'} open`}
                body="An external event overlaps a booked appointment. Resolve it explicitly — keeping the appointment is a valid choice."
              />
            ) : null}
            <Button label="Manage calendar connections" variant="secondary" icon="link" onPress={() => router.push('/schedule/calendar')} />
          </Card>
        )}
      </View>

      <View style={{ gap: spacing.md }}>
        <SectionHeading title="Booking policy" />
        {policy.isLoading ? (
          <ListSkeleton count={1} />
        ) : policy.isError ? (
          <ErrorState error={policy.error} onRetry={() => void policy.refetch()} compact />
        ) : policy.data ? (
          <Card variant="flat">
            <ListRow
              title="Minimum notice"
              value={formatDuration(policy.data.min_notice_minutes)}
              subtitle="How soon before a slot a patient may still book it"
              icon="clock"
            />
            <ListRow
              title="Booking window"
              value={`${policy.data.booking_window_days} days`}
              subtitle="How far ahead patients can see and book"
              icon="calendar"
            />
            <ListRow
              title="Approval mode"
              value={policy.data.approval_mode === 'manual' ? 'Manual' : 'Auto-confirm'}
              subtitle={
                policy.data.approval_mode === 'manual'
                  ? `Requests auto-decline after ${policy.data.approval_auto_decline_minutes} min`
                  : 'Bookings are confirmed the moment the patient pays'
              }
              icon="check"
            />
            <ListRow
              title="No-show grace"
              value={`${policy.data.no_show_grace_minutes_video} min video · ${policy.data.no_show_grace_minutes_clinic} min clinic`}
              subtitle="After this you may mark the patient absent"
              icon="alert-circle"
            />
            <ListRow
              title="Buffer between patients"
              value={`${policy.data.buffer_minutes} min`}
              subtitle="Applied on both sides of a booked appointment"
              icon="clock"
            />
            <ListRow
              title="Reschedule limits"
              value={`${policy.data.max_reschedules}× · ≥ ${policy.data.reschedule_min_hours} h`}
              subtitle="Applied to patient-initiated moves"
              icon="refresh"
            />
            <ListRow
              title="Next free slot"
              value={stats.data?.next_free_slot_utc ? clockLabel(Date.parse(stats.data.next_free_slot_utc), clinicTz) : 'None in window'}
              subtitle="Recomputed from your template, exceptions and calendar"
              icon="clock"
            />
            <Button label="Edit booking policy" variant="secondary" icon="settings" onPress={() => router.push('/schedule/policy')} />
          </Card>
        ) : (
          <Text variant="small">{describeError(policy.error).message}</Text>
        )}
      </View>
    </Screen>
  );
}
