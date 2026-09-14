import * as React from 'react';
import { Tabs } from 'expo-router';

import { THEME_SCREEN_OPTIONS } from '../../src/lib/navigation';
import { BrandTabBar } from '../../src/components/BrandTabBar';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false, ...THEME_SCREEN_OPTIONS }}
      tabBar={(props) => <BrandTabBar {...props} />}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="discover" />
      <Tabs.Screen name="appointments" />
      <Tabs.Screen name="alerts" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
