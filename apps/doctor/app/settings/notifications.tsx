/**
 * Notification preferences (doctor side) — the same per-category matrix as the
 * patient app, seeded with the doctor-relevant categories.
 *
 * Critical categories (cancellations, new bookings, calendar sync failures) cannot
 * be muted; the switch is disabled with the reason shown.
 */
import * as React from 'react';
import { Switch, View } from 'react-native';
import { useRouter } from 'expo-router';

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

import { useNotificationPreferences, useUpdateNotificationPreferences } from '../../src/lib/hooks';
import { describeError } from '../../src/lib/format';
import { ErrorState, InlineNotice, ListSkeleton } from '../../src/components/states';

const LABELS: Partial<Record<NotificationCategory, string>> = {
  booking: 'New bookings',
  approval: 'Approval requests',
  reminder: 'Daily schedule digest',
  join_window: 'Patient ready to join',
  reschedule: 'Reschedules',
  cancellation: 'Cancellations',
  payment: 'Payments & refunds',
  calendar: 'Calendar conflicts & sync failures',
  verification: 'Verification decisions',
  security: 'Account security',
  review: 'New reviews',
};

export default function DoctorNotificationSettingsScreen() {
  const router = useRouter();
  const preferences = useNotificationPreferences();
  const update = useUpdateNotificationPreferences();

  const [draft, setDraft] = React.useState<NotificationPreference | null>(null);
  const [failure, setFailure] = React.useState<unknown>(null);
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    if (draft === null && preferences.data) setDraft(preferences.data);
  }, [draft, preferences.data]);

  const persist = async (next: NotificationPreference) => {
    setDraft(next);
    setSaved(false);
    setFailure(null);
    try {
      await update.mutateAsync({ entries: next.entries, quiet_hours: next.quiet_hours });
      setSaved(true);
    } catch (caught) {
      setFailure(caught);
      if (preferences.data) setDraft(preferences.data);
    }
  };

  const toggle = (category: NotificationCategory, channel: 'push' | 'email' | 'sms') => {
    if (!draft) return;
    void persist({
      ...draft,
      entries: draft.entries.map((entry) =>
        entry.category === category ? { ...entry, [channel]: !entry[channel] } : entry,
      ),
    });
  };

  return (
    <Screen scroll edges={['top']} contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.huge }}>
      <ScreenHeader title="Notifications" subtitle="What reaches you, and how" onBack={() => router.back()} />

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
            title="Critical alerts always arrive"
            body="New bookings, cancellations, reschedule notices and calendar sync failures ignore quiet hours. Losing one of those costs money or patient trust, so they cannot be muted."
          />

          <View style={{ gap: spacing.md }}>
            <SectionHeading title="Categories" />
            {draft.entries.map((entry) => (
              <Card key={entry.category} variant="flat" style={{ gap: spacing.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
                  <Text variant="bodyStrong" style={{ flex: 1 }}>
                    {LABELS[entry.category] ?? entry.category}
                  </Text>
                  {entry.critical ? <Badge label="Always on" tone="warning" icon="lock" /> : null}
                </View>
                <Row label="Push" value={entry.push || entry.critical} disabled={entry.critical} onChange={() => toggle(entry.category, 'push')} />
                <Row label="Email" value={entry.email || entry.critical} disabled={entry.critical} onChange={() => toggle(entry.category, 'email')} />
                <Row label="SMS" value={entry.sms || entry.critical} disabled={entry.critical} onChange={() => toggle(entry.category, 'sms')} />
              </Card>
            ))}
          </View>

          <View style={{ gap: spacing.md }}>
            <SectionHeading title="Quiet hours" />
            <Card variant="flat" style={{ gap: spacing.md }}>
              <Row
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
                      placeholder="21:00"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <TextField
                      label="To"
                      value={draft.quiet_hours.end}
                      onChangeText={(next) => setDraft({ ...draft, quiet_hours: { ...draft.quiet_hours, end: next } })}
                      onBlur={() => void persist(draft)}
                      placeholder="07:00"
                    />
                  </View>
                </View>
              ) : null}
              <Text variant="caption">
                Non-critical pushes are held until the window ends. Emails and SMS are never delayed.
              </Text>
            </Card>
          </View>

          <Card variant="flat" style={{ backgroundColor: color.surfaceAlt, gap: spacing.xs }}>
            <Text variant="bodyStrong">What the patient receives</Text>
            <Text variant="small">
              Confirmations, reminders at T−24h and T−2h, join prompts, reschedule and cancellation notices, plus receipts
              and refund updates. Cancellations always reach them by SMS as well as push.
            </Text>
          </Card>

          <Button label="Refresh from server" variant="ghost" onPress={() => void preferences.refetch()} />
        </>
      )}
    </Screen>
  );
}

function Row({
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
