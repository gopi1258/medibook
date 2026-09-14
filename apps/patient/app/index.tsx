/**
 * Route entry. The root layout's session gate redirects to either the onboarding
 * carousel or the tabs; this screen is only visible for the frame it takes that
 * decision to resolve.
 */
import * as React from 'react';
import { View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { Logo, Text, gradient, spacing } from '@medibook/brand';

export default function Index() {
  return (
    <LinearGradient
      colors={[gradient.brand[0], gradient.brand[1]]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg }}
    >
      <Logo size={76} withWordmark={false} />
      <Text variant="display" color="#FFFFFF">
        MediBook
      </Text>
      <Text variant="body" color="#FFF1F6">
        Real appointments. Every time.
      </Text>
    </LinearGradient>
  );
}
