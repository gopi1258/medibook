import * as React from 'react';
import { Stack } from 'expo-router';

import { color } from '@medibook/brand';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: color.bg },
      }}
    >
      <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
      <Stack.Screen name="phone" />
      <Stack.Screen name="otp" />
      <Stack.Screen name="profile-setup" options={{ gestureEnabled: false }} />
    </Stack>
  );
}
