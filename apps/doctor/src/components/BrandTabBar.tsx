/**
 * Floating bottom tab bar for the doctor app.
 * Tab set and order are fixed by PRD §7.2: Today · Appointments · Schedule ·
 * Patients · Profile.
 */
import * as React from 'react';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useQuery } from '@tanstack/react-query';

import { TabBar, type IconName, type TabBarItem, color } from '@medibook/brand';

import { doctorApi } from '../lib/api';

type TabMeta = { name: string; label: string; icon: IconName };

export const DOCTOR_TABS: readonly TabMeta[] = [
  { name: 'index', label: 'Today', icon: 'sun' },
  { name: 'appointments', label: 'Visits', icon: 'calendar' },
  { name: 'schedule', label: 'Schedule', icon: 'clock' },
  { name: 'patients', label: 'Patients', icon: 'users' },
  { name: 'profile', label: 'Profile', icon: 'user' },
];

export function BrandTabBar({ state, navigation }: BottomTabBarProps) {
  const notifications = useQuery({
    queryKey: ['notifications', { unreadOnly: false }],
    queryFn: () => doctorApi.listNotifications({ limit: 50 }),
    staleTime: 20_000,
  });

  const pending = useQuery({
    queryKey: ['appointments', { scope: 'pending' }],
    queryFn: () => doctorApi.listAppointments({ scope: 'pending', limit: 50 }),
    staleTime: 30_000,
  });

  const unread = notifications.data?.items.filter((item) => item.read_at === null).length ?? 0;
  const pendingCount = pending.data?.items.length ?? 0;

  const items: TabBarItem[] = DOCTOR_TABS.map((meta) => ({
    key: meta.name,
    label: meta.label,
    icon: meta.icon,
    badge: meta.name === 'appointments' ? pendingCount : undefined,
    accessibilityHint:
      meta.name === 'appointments' && pendingCount > 0 ? `${pendingCount} awaiting approval` : undefined,
  }));

  const activeRoute = state.routes[state.index];
  const activeKey = activeRoute?.name ?? 'index';

  return (
    <TabBar
      items={items}
      activeKey={activeKey}
      onSelect={(key) => {
        const route = state.routes.find((candidate) => candidate.name === key);
        if (!route) return;
        const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
        if (event.defaultPrevented) return;
        if (route.key !== activeRoute?.key) navigation.navigate(route.name);
      }}
      accessibilityLabel="Main navigation"
      style={{ borderWidth: 1, borderColor: color.border }}
    />
  );
}
