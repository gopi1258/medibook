/**
 * The floating bottom tab bar (BRAND_SPEC "Floating/recessed bottom tab bar with
 * 5 tabs, active tab emphasised"), wired to Expo Router's tab navigator.
 *
 * Tab set and order are fixed by PRD §7.1: Home · Discover · Appointments ·
 * Alerts · Profile.
 */
import * as React from 'react';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useQuery } from '@tanstack/react-query';

import { TabBar, type IconName, type TabBarItem, color } from '@medibook/brand';

import { patientApi } from '../lib/api';
import { queryKeys } from '../lib/query';

type TabMeta = { name: string; label: string; icon: IconName };

/** PRD §7.1 — exactly these five, in this order. */
export const PATIENT_TABS: readonly TabMeta[] = [
  { name: 'index', label: 'Home', icon: 'home' },
  { name: 'discover', label: 'Discover', icon: 'search' },
  { name: 'appointments', label: 'Visits', icon: 'calendar' },
  { name: 'alerts', label: 'Alerts', icon: 'bell' },
  { name: 'profile', label: 'Profile', icon: 'user' },
];

export function BrandTabBar({ state, navigation }: BottomTabBarProps) {
  const notifications = useQuery({
    queryKey: queryKeys.notifications(false),
    queryFn: () => patientApi.listNotifications({ limit: 50 }),
    staleTime: 20_000,
  });

  const unread = notifications.data?.items.filter((item) => item.read_at === null).length ?? 0;

  const items: TabBarItem[] = PATIENT_TABS.map((meta) => ({
    key: meta.name,
    label: meta.label,
    icon: meta.icon,
    badge: meta.name === 'alerts' ? unread : undefined,
    accessibilityHint: meta.name === 'alerts' && unread > 0 ? `${unread} unread alerts` : undefined,
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
        const event = navigation.emit({
          type: 'tabPress',
          target: route.key,
          canPreventDefault: true,
        });
        if (event.defaultPrevented) return;
        if (route.key !== activeRoute?.key) navigation.navigate(route.name);
      }}
      accessibilityLabel="Main navigation"
      style={{ borderWidth: 1, borderColor: color.border }}
    />
  );
}
