/**
 * Alerts (PRD §7.1 / NOT-001) — the in-app notification inbox with an unread
 * badge, tap-through deep links and a link to channel preferences.
 */
import * as React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  ListRow,
  Screen,
  ScreenHeader,
  SectionHeading,
  SegmentedControl,
  Text,
  color,
  spacing,
  type IconName,
} from '@medibook/brand';
import type { AppNotification, NotificationCategory } from '@medibook/core';

import { patientApi } from '../../src/lib/api';
import { useNotifications } from '../../src/lib/hooks';
import { queryKeys } from '../../src/lib/query';
import { ErrorState, ListSkeleton } from '../../src/components/states';

const CATEGORY_ICONS: Record<NotificationCategory, IconName> = {
  booking: 'calendar-check',
  approval: 'check-circle',
  reminder: 'clock',
  join_window: 'video',
  reschedule: 'refresh',
  cancellation: 'close',
  payment: 'credit-card',
  calendar: 'link',
  verification: 'shield-check',
  security: 'lock',
  review: 'star',
};

export default function AlertsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ filter?: string }>();

  const [unreadOnly, setUnreadOnly] = React.useState(params.filter === 'unread');
  const notifications = useNotifications(unreadOnly);

  const items = notifications.data?.items ?? [];
  const unread = items.filter((item) => item.read_at === null).length;

  const invalidate = React.useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['notifications'] });
  }, [queryClient]);

  const openNotification = async (notification: AppNotification) => {
    if (notification.read_at === null) {
      try {
        await patientApi.markNotificationRead(notification.id);
        await invalidate();
      } catch {
        /* the deep link matters more than the read receipt */
      }
    }
    if (notification.appointment_id) {
      router.push(`/appointment/${notification.appointment_id}`);
      return;
    }
    if (notification.deeplink) router.push(notification.deeplink);
  };

  return (
    <Screen
      edges={['top']}
      contentContainerStyle={{ gap: spacing.lg }}
      refreshing={notifications.isRefetching && !notifications.isLoading}
      onRefresh={() => void notifications.refetch()}
    >
      <ScreenHeader
        title="Alerts"
        subtitle={unread > 0 ? `${unread} unread` : 'You are all caught up'}
        action={{ icon: 'settings', onPress: () => router.push('/settings/notifications'), accessibilityLabel: 'Notification settings' }}
      />

      <SegmentedControl
        accessibilityLabel="Alert filter"
        options={[
          { value: 'all', label: 'All' },
          { value: 'unread', label: 'Unread', badge: unread || undefined },
        ]}
        value={unreadOnly ? 'unread' : 'all'}
        onChange={(next) => setUnreadOnly(next === 'unread')}
      />

      {unread > 0 ? (
        <Button
          label="Mark all as read"
          variant="secondary"
          size="sm"
          icon="check"
          onPress={async () => {
            await patientApi.markAllNotificationsRead();
            await invalidate();
          }}
        />
      ) : null}

      {notifications.isLoading ? (
        <ListSkeleton count={4} />
      ) : notifications.isError ? (
        <ErrorState error={notifications.error} onRetry={() => void notifications.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="bell"
          title={unreadOnly ? 'No unread alerts' : 'Nothing here yet'}
          description="Booking confirmations, reminders, reschedules and cancellations all land here — and they keep working offline."
          actionLabel={unreadOnly ? 'Show all alerts' : undefined}
          onAction={unreadOnly ? () => setUnreadOnly(false) : undefined}
        />
      ) : (
        <View style={{ gap: spacing.md }}>
          {items.map((notification) => (
            <Card
              key={notification.id}
              variant={notification.read_at === null ? 'default' : 'flat'}
              onPress={() => void openNotification(notification)}
              accessibilityLabel={`${notification.title}. ${notification.body}`}
              style={{ gap: spacing.sm }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    backgroundColor: notification.read_at === null ? color.primaryTint : color.border,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon
                    name={CATEGORY_ICONS[notification.category] ?? 'info'}
                    size={18}
                    color={notification.read_at === null ? color.primary : color.textMuted}
                  />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant={notification.read_at === null ? 'bodyStrong' : 'bodyMedium'}>
                    {notification.title}
                  </Text>
                  <Text variant="caption">{notification.sent_at.replace('T', ' ').slice(0, 16)}</Text>
                </View>
                {notification.read_at === null ? <Badge label="New" tone="accent" /> : null}
              </View>
              <Text variant="small">{notification.body}</Text>
            </Card>
          ))}
        </View>
      )}

      <View style={{ gap: spacing.sm }}>
        <SectionHeading title="Channels" />
        <Card variant="flat" style={{ gap: spacing.md }}>
          <ListRow
            title="Notification preferences"
            subtitle="Push, email and SMS per category"
            icon="settings"
            onPress={() => router.push('/settings/notifications')}
          />
          <Text variant="caption">
            Cancellations and video join reminders always reach you, even during quiet hours — safety-critical messages
            cannot be muted.
          </Text>
        </Card>
      </View>
    </Screen>
  );
}
