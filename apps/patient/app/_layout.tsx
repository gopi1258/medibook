/**
 * Root layout — fonts, safe area, query client, session hydration, splash.
 *
 * Auth gating lives here (imperative redirects, TRD §4.2) so every screen below
 * can assume a signed-in patient; the only screens that run while signed out are
 * the `(auth)` group.
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
  /* the splash screen was already hidden */
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
    const onProfileSetup = parts[1] === 'profile-setup';

    if (status === 'signed_out') {
      if (!inAuthGroup) router.replace('/(auth)/onboarding');
      return;
    }
    if (pendingOnboarding) {
      if (!onProfileSetup) router.replace('/(auth)/profile-setup');
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
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: color.bg },
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
          <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
          <Stack.Screen name="doctor/[doctorId]" />
          <Stack.Screen name="slots/[doctorId]" options={{ presentation: 'modal' }} />
          <Stack.Screen
            name="booking/[doctorId]"
            options={{ presentation: 'transparentModal', animation: 'fade' }}
          />
          <Stack.Screen
            name="payment/[appointmentId]"
            options={{ presentation: 'transparentModal', animation: 'fade' }}
          />
          <Stack.Screen name="confirmation/[appointmentId]" options={{ presentation: 'modal' }} />
          <Stack.Screen name="appointment/[appointmentId]/index" />
          <Stack.Screen name="appointment/[appointmentId]/reschedule" options={{ presentation: 'modal' }} />
          <Stack.Screen
            name="appointment/[appointmentId]/cancel"
            options={{ presentation: 'transparentModal', animation: 'fade' }}
          />
          <Stack.Screen name="appointment/[appointmentId]/review" options={{ presentation: 'modal' }} />
          <Stack.Screen name="family/index" />
          <Stack.Screen name="family/[dependentId]" options={{ presentation: 'modal' }} />
          <Stack.Screen name="settings/edit-profile" />
          <Stack.Screen name="settings/notifications" />
          <Stack.Screen name="settings/saved-doctors" />
          <Stack.Screen name="settings/help" />
          <Stack.Screen name="settings/legal" />
        </Stack>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
