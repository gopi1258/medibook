/**
 * Calendar connections (DOC-008/009, CAL-001…CAL-005) — Google and Outlook with
 * sync status, manual re-sync and disconnect.
 *
 * The OAuth handshake is simulated: `connectCalendar` returns an authorization
 * URL and the app "completes" the callback locally. That is the same shape the
 * real flow has (system browser → server callback → deep link back), so swapping
 * the simulation for a real `expo-web-browser` session is a one-line change.
 *
 * Privacy is stated on the screen rather than buried: only busy/free is read, and
 * titles/attendees are discarded at ingestion.
 */
import * as React from 'react';
import { Alert, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import type { CalendarAccount, CalendarProvider } from '@medibook/core';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  PolicyNote,
  Screen,
  ScreenHeader,
  SectionHeading,
  Sheet,
  Text,
  TextField,
  color,
  spacing,
} from '@medibook/brand';

import { doctorApi } from '../../src/lib/api';
import { useCalendarAccounts, useDisconnectCalendar, useSyncCalendar } from '../../src/lib/hooks';
import { describeError } from '../../src/lib/format';
import { ErrorState, InlineNotice, ListSkeleton } from '../../src/components/states';

const PROVIDERS: ReadonlyArray<{ provider: CalendarProvider; label: string; hint: string }> = [
  { provider: 'google', label: 'Google Calendar', hint: 'Personal Gmail and Google Workspace' },
  { provider: 'microsoft', label: 'Outlook', hint: 'Microsoft 365 and Outlook.com' },
];

export default function CalendarScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const accounts = useCalendarAccounts();
  const sync = useSyncCalendar();
  const disconnect = useDisconnectCalendar();

  const [connecting, setConnecting] = React.useState<CalendarProvider | null>(null);
  const [email, setEmail] = React.useState('');
  const [failure, setFailure] = React.useState<unknown>(null);
  const [syncResult, setSyncResult] = React.useState<string | null>(null);

  const beginConnect = async (provider: CalendarProvider) => {
    setFailure(null);
    setSyncResult(null);
    try {
      const { authorization_url } = await doctorApi.connectCalendar(provider);
      setConnecting(provider);
      setEmail(provider === 'google' ? 'doctor@gmail.com' : 'doctor@clinic365.onmicrosoft.com');
      // The real app opens `authorization_url` in the system browser here and
      // waits for the `medibook-doctor://calendar/connected` deep link.
      void authorization_url;
    } catch (caught) {
      setFailure(caught);
    }
  };

  const completeConnect = async () => {
    if (!connecting) return;
    setFailure(null);
    try {
      await doctorApi.completeCalendarConnect(connecting, email.trim());
      await queryClient.invalidateQueries({ queryKey: ['doctor', 'me', 'calendar'] });
      await queryClient.invalidateQueries({ queryKey: ['availability'] });
      setConnecting(null);
    } catch (caught) {
      setFailure(caught);
    }
  };

  const runSync = async (account: CalendarAccount) => {
    setFailure(null);
    setSyncResult(null);
    try {
      const result = await sync.mutateAsync(account.id);
      setSyncResult(
        `${result.busy_events_imported ?? 0} busy events imported · ${result.conflicts} conflict${result.conflicts === 1 ? '' : 's'} detected.`,
      );
    } catch (caught) {
      setFailure(caught);
    }
  };

  const doDisconnect = (account: CalendarAccount) => {
    Alert.alert(
      'Disconnect this calendar?',
      'Stored tokens and imported busy time are deleted. Your availability goes back to your template only, and existing appointments are untouched.',
      [
        { text: 'Keep connected', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: () => void disconnect.mutateAsync(account.id).catch((error: unknown) => setFailure(error)),
        },
      ],
    );
  };

  const items = accounts.data ?? [];
  const conflicts = items.reduce((sum, account) => sum + account.conflicts_open, 0);

  return (
    <Screen
      scroll
      edges={['top']}
      contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.huge }}
      refreshing={accounts.isRefetching && !accounts.isLoading}
      onRefresh={() => void accounts.refetch()}
    >
      <ScreenHeader
        title="Calendar connections"
        subtitle="Busy time only — never event details"
        onBack={() => router.back()}
      />

      <PolicyNote
        tone="info"
        title="Scope we request"
        body="Read-only access to busy and free time. We never read event names, attendees or notes, we never store them, and we never write to your calendar. Patients cannot see that a calendar exists."
      />

      {syncResult ? <InlineNotice tone="success" message={syncResult} /> : null}
      {failure ? <InlineNotice message={describeError(failure).message} /> : null}

      {conflicts > 0 ? (
        <Card variant="flat" style={{ backgroundColor: color.dangerTint, gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
            <Icon name="alert-triangle" size={20} color={color.danger} />
            <Text variant="bodyStrong" color={color.danger}>
              {conflicts} appointment conflict{conflicts === 1 ? '' : 's'}
            </Text>
          </View>
          <Text variant="small">
            An external event overlaps a booked appointment. Resolve each one: reschedule the patient or explicitly keep the
            appointment. MediBook never cancels a consultation on your behalf.
          </Text>
          <Button label="Review in Today" variant="secondary" size="sm" onPress={() => router.replace('/(tabs)')} />
        </Card>
      ) : null}

      {accounts.isLoading ? (
        <ListSkeleton count={2} />
      ) : accounts.isError ? (
        <ErrorState error={accounts.error} onRetry={() => void accounts.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="link"
          title="No calendar connected"
          description="Connect Google or Outlook and your busy time is subtracted from the slots patients can book. Without it, only your template defines availability."
        />
      ) : (
        <View style={{ gap: spacing.md }}>
          {items.map((account) => (
            <Card key={account.id} variant="flat" style={{ gap: spacing.md }}>
              <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center', flexWrap: 'wrap' }}>
                <Icon
                  name={account.provider === 'google' ? 'globe' : 'mail'}
                  size={18}
                  color={account.status === 'connected' ? color.success : color.danger}
                />
                <Text variant="bodyStrong" style={{ flex: 1 }}>
                  {account.provider === 'google' ? 'Google Calendar' : 'Outlook'}
                </Text>
                <Badge
                  label={account.status}
                  tone={account.status === 'connected' ? 'verified' : account.status === 'syncing' ? 'info' : 'danger'}
                />
              </View>
              <Text variant="small">{account.account_email}</Text>
              <Text variant="caption">
                {account.busy_events_90d} busy events imported · connected {account.connected_at.slice(0, 10)} · last synced{' '}
                {account.last_synced_at ? account.last_synced_at.slice(0, 16).replace('T', ' ') : 'never'}
              </Text>
              {account.conflicts_open > 0 ? (
                <Badge label={`${account.conflicts_open} open conflict`} tone="danger" icon="alert-triangle" />
              ) : null}
              <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
                <Button
                  label={sync.isPending ? 'Syncing…' : 'Re-sync now'}
                  size="sm"
                  block={false}
                  icon="refresh"
                  loading={sync.isPending}
                  onPress={() => void runSync(account)}
                />
                <Button
                  label="Disconnect"
                  size="sm"
                  variant="ghost"
                  block={false}
                  icon="unlink"
                  onPress={() => doDisconnect(account)}
                />
              </View>
            </Card>
          ))}
        </View>
      )}

      <View style={{ gap: spacing.md }}>
        <SectionHeading title="Add a calendar" />
        {PROVIDERS.map((entry) => (
          <Card key={entry.provider} variant="flat" style={{ gap: spacing.sm }}>
            <Text variant="bodyStrong">{entry.label}</Text>
            <Text variant="small">{entry.hint}</Text>
            <Button
              label={`Connect ${entry.label.split(' ')[0]}`}
              variant="secondary"
              size="sm"
              block={false}
              icon="link"
              onPress={() => void beginConnect(entry.provider)}
            />
          </Card>
        ))}
      </View>

      <PolicyNote
        tone="warning"
        title="Simulated OAuth in this build"
        body="No provider credentials are configured, so the consent screen and token exchange are simulated locally. The real flow returns a signed authorization URL, opens it in the system browser and completes on the server callback — never in a WebView."
      />

      <Card variant="flat" style={{ backgroundColor: color.surfaceAlt, gap: spacing.sm }}>
        <Text variant="bodyStrong">Failure handling</Text>
        <Text variant="small">
          If a provider is unreachable we keep the last known-good availability, label it stale, and re-check busy time at
          booking commit. You get an alert to reconnect; patients never book into confidently-wrong time.
        </Text>
        <Text variant="small">
          If you revoke access from the provider’s security page, we detect the failure on the next sync, mark the account
          disconnected, stop subtracting busy time, and prompt you to reconnect.
        </Text>
      </Card>

      <Sheet
        visible={connecting !== null}
        onClose={() => setConnecting(null)}
        title={`Connect ${connecting === 'google' ? 'Google Calendar' : 'Outlook'}`}
        subtitle="Simulated consent — no provider is contacted"
        footer={
          <View style={{ gap: spacing.sm }}>
            <Button label="Grant busy/free access" onPress={() => void completeConnect()} />
            <Button label="Deny" variant="ghost" onPress={() => setConnecting(null)} />
          </View>
        }
      >
        <View style={{ gap: spacing.lg }}>
          <Card variant="flat" style={{ gap: spacing.sm }}>
            <Text variant="label">Requested scope</Text>
            <Text variant="small">{connecting === 'google' ? 'calendar.events.readonly' : 'Calendars.Read'}</Text>
            <Text variant="caption">
              Read-only. Busy intervals for the next 90 days, refreshed by webhook with a polling fallback every 15 minutes.
            </Text>
          </Card>
          <TextField
            label="Account email (for the simulated handshake)"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <Text variant="caption">
            Partial consent or a corporate tenant that blocks OAuth results in a clear explanation plus a retry path — we
            never silently connect a reduced scope.
          </Text>
        </View>
      </Sheet>
    </Screen>
  );
}
