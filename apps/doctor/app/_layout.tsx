/**
 * Root layout (doctor app) — fonts, safe area, query client, session hydration,
 * splash and the auth/verification gate.
 *
 * A signed-in doctor who has not finished verification is held in the `(auth)`
 * group's onboarding wizard until the API reports `onboarding_state: live`
 * (PRD J9/J10: the app stays in setup mode). Discoverability is not the client's
 * decision — the API simply never lists an unapproved doctor (R10).
 */
import 'react-native-gesture-handler';
import * as React from 'react';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { Stack, useRouter, useSegments } from 'expo-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useBrandFonts, color } from '@medibook/brand';

import { createQueryClient } from '../src/lib/query';
import { hydrateSession, sessionStore, useSession } from '../src/lib/session';

void SplashScreen.preventAutoHideAsync().catch(() => {
  /* already hidden */
});

const queryClient = createQueryClient();

function useSessionGate(): void {
  const { status, pendingOnboarding } = useSession();
  const segments = useSegments();
  const router = useRouter();

  React.useEffect(() => {
    if (status === 'loading') return;
    // `useSegments()` includes group names, which is exactly what we need here.
    const parts: string[] = [...segments];
    const inAuthGroup = parts[0] === '(auth)';
    const onWizard = parts[1] === 'verification';

    if (status === 'signed_out') {
      if (!inAuthGroup) router.replace('/(auth)/onboarding');
      return;
    }
    if (pendingOnboarding) {
      if (!onWizard) router.replace('/(auth)/verification');
      return;
    }
    if (inAuthGroup) router.replace('/(tabs)');
  }, [status, pendingOnboarding, segments, router]);
}

export default function RootLayout() {
  const { loaded, error } = useBrandFonts();
  const [hydrated, setHydrated] = React.useState(() => sessionStore.get().status !== 'loading');

  React.useEffect(() => {
    let cancelled = false;
    void hydrateSession().finally(() => {
      if (!cancelled) setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const ready = (loaded || error !== null) && hydrated;

  React.useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  useSessionGate();

  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.bg } }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
          <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
          <Stack.Screen name="appointment/[appointmentId]/index" />
          <Stack.Screen name="appointment/[appointmentId]/reschedule" options={{ presentation: 'modal' }} />
          <Stack.Screen name="appointment/[appointmentId]/cancel" options={{ presentation: 'transparentModal', animation: 'fade' }} />
          <Stack.Screen name="appointment/[appointmentId]/patient" options={{ presentation: 'modal' }} />
          <Stack.Screen name="schedule/rules" />
          <Stack.Screen name="schedule/exceptions" />
          <Stack.Screen name="schedule/calendar" />
          <Stack.Screen name="schedule/policy" />
          <Stack.Screen name="profile/edit" />
          <Stack.Screen name="profile/fees" />
          <Stack.Screen name="profile/verification" />
          <Stack.Screen name="settings/notifications" />
          <Stack.Screen name="settings/help" />
          <Stack.Screen name="settings/legal" />
        </Stack>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
