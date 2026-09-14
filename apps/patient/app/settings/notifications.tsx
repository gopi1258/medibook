/**
 * Notification preferences (PAT-005 / NOT-005) — per-category push/email/SMS
 * toggles plus quiet hours.
 *
 * Critical categories (cancellations, video join windows, security) cannot be
 * muted: the switch is rendered disabled with the reason, which is the honest
 * version of "you can turn these off" (PRD §12 delivery rules).
 */
import * as React from 'react';
import { Switch, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import type { NotificationCategory, NotificationPreference } from '@medibook/core';
import {
  Badge,
  Button,
  Card,
  PolicyNote,
  Screen,
  ScreenHeader,
  SectionHeading,
  Text,
  TextField,
  color,
  spacing,
} from '@medibook/brand';

import { patientApi } from '../../src/lib/api';
import { describeError } from '../../src/lib/format';
import { useNotificationPreferences } from '../../src/lib/hooks';
import { queryKeys } from '../../src/lib/query';
import { ErrorState, InlineNotice, ListSkeleton } from '../../src/components/states';

const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  booking: 'Booking confirmations',
  approval: 'Approval outcomes',
  reminder: 'Appointment reminders',
  join_window: 'Video join window',
  reschedule: 'Reschedules',
  cancellation: 'Cancellations',
  payment: 'Payments & refunds',
  calendar: 'Calendar sync problems',
  verification: 'Doctor verification',
  security: 'Account security',
  review: 'Review reminders',
};

export default function NotificationSettingsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const preferences = useNotificationPreferences();

  const [draft, setDraft] = React.useState<NotificationPreference | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [failure, setFailure] = React.useState<unknown>(null);
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    if (draft === null && preferences.data) setDraft(preferences.data);
  }, [draft, preferences.data]);

  const persist = async (next: NotificationPreference) => {
    setDraft(next);
    setSaving(true);
    setFailure(null);
    setSaved(false);
    try {
      await patientApi.updateNotificationPreferences({
        entries: next.entries,
        quiet_hours: next.quiet_hours,
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.notificationPreferences });
      setSaved(true);
    } catch (caught) {
      setFailure(caught);
    } finally {
      setSaving(false);
    }
  };

  const toggleChannel = (
    current: NotificationPreference,
    category: NotificationCategory,
    channel: 'push' | 'email' | 'sms',
  ): NotificationPreference => {
    return {
      ...current,
      entries: current.entries.map((entry) =>
        entry.category === category ? { ...entry, [channel]: !entry[channel] } : entry,
      ),
    };
  };

  return (
    <Screen scroll edges={['top']} contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.huge }}>
      <ScreenHeader title="Notifications" subtitle="Choose how we reach you" onBack={() => router.back()} />

      {preferences.isLoading || draft === null ? (
        <ListSkeleton count={4} />
      ) : preferences.isError ? (
        <ErrorState error={preferences.error} onRetry={() => void preferences.refetch()} />
      ) : (
        <>
          {saved ? <InlineNotice tone="success" message="Preferences saved." /> : null}
          {failure ? <InlineNotice message={describeError(failure).message} /> : null}

          <PolicyNote
            tone="info"
            title="Critical messages always arrive"
            body="Cancellations, refund outcomes, video join windows and security alerts ignore quiet hours and cannot be switched off. Everything else respects your choices."
          />

          <View style={{ gap: spacing.md }}>
            <SectionHeading title="Categories" />
            {draft.entries.map((entry) => (
              <Card key={entry.category} variant="flat" style={{ gap: spacing.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
                  <Text variant="bodyStrong" style={{ flex: 1 }}>
                    {CATEGORY_LABELS[entry.category]}
                  </Text>
                  {entry.critical ? <Badge label="Always on" tone="warning" icon="lock" /> : null}
                </View>

                <ChannelRow
                  label="Push"
                  value={entry.push || entry.critical}
                  disabled={entry.critical}
                  onChange={() => void persist(toggleChannel(draft, entry.category, 'push'))}
                />
                <ChannelRow
                  label="Email"
                  value={entry.email || entry.critical}
                  disabled={entry.critical}
                  onChange={() => void persist(toggleChannel(draft, entry.category, 'email'))}
                />
                <ChannelRow
                  label="SMS"
                  value={entry.sms || entry.critical}
                  disabled={entry.critical}
                  onChange={() => void persist(toggleChannel(draft, entry.category, 'sms'))}
                />
              </Card>
            ))}
          </View>

          <View style={{ gap: spacing.md }}>
            <SectionHeading title="Quiet hours" />
            <Card variant="flat" style={{ gap: spacing.md }}>
              <ChannelRow
                label={draft.quiet_hours.enabled ? 'Quiet hours are on' : 'Quiet hours are off'}
                value={draft.quiet_hours.enabled}
                onChange={() =>
                  void persist({ ...draft, quiet_hours: { ...draft.quiet_hours, enabled: !draft.quiet_hours.enabled } })
                }
              />
              {draft.quiet_hours.enabled ? (
                <View style={{ flexDirection: 'row', gap: spacing.md }}>
                  <View style={{ flex: 1 }}>
                    <TextField
                      label="From"
                      value={draft.quiet_hours.start}
                      onChangeText={(next) => setDraft({ ...draft, quiet_hours: { ...draft.quiet_hours, start: next } })}
                      onBlur={() => void persist(draft)}
                      placeholder="22:00"
                      disabled={saving}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <TextField
                      label="To"
                      value={draft.quiet_hours.end}
                      onChangeText={(next) => setDraft({ ...draft, quiet_hours: { ...draft.quiet_hours, end: next } })}
                      onBlur={() => void persist(draft)}
                      placeholder="07:00"
                      disabled={saving}
                    />
                  </View>
                </View>
              ) : null}
              <Text variant="caption">
                Times are in {draft.quiet_hours.enabled ? 'your local timezone' : 'your timezone'} (
                {draft.quiet_hours.start}–{draft.quiet_hours.end}). Pushes are held until the window ends; emails and SMS
                are never delayed.
              </Text>
            </Card>
          </View>

          <Card variant="flat" style={{ backgroundColor: color.surfaceAlt, gap: spacing.xs }}>
            <Text variant="bodyStrong">Reaching us when it matters</Text>
            <Text variant="small">
              If notifications are off or unavailable, everything still lands in the Alerts tab inside the app. SMS is used
              for OTPs, T-2h reminders and cancellations of paid bookings.
            </Text>
          </Card>

          <Button label="Refresh from server" variant="ghost" onPress={() => void preferences.refetch()} loading={saving} />
        </>
      )}
    </Screen>
  );
}

function ChannelRow({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }}>
      <Text variant={disabled ? 'small' : 'bodyMedium'} style={{ flex: 1 }}>
        {label}
      </Text>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: color.border, true: color.primary }}
        thumbColor={color.white}
        accessibilityLabel={label}
      />
    </View>
  );
}
