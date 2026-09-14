/**
 * Route entry — the gate in the root layout decides between the onboarding
 * wizard and the tabs; this screen covers the frame it takes to do that.
 */
import * as React from 'react';
import { View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { Logo, Text, gradient, spacing } from '@medibook/brand';

export default function Index() {
  return (
    <LinearGradient
      colors={[gradient.brand[1], gradient.brand[0]]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg }}
    >
      <Logo size={72} withWordmark={false} />
      <Text variant="h1" color="#FFFFFF">
        MediBook for Doctors
      </Text>
      <Text variant="small" color="#FFF1F6">
        Your schedule, and nothing else taking your time.
      </Text>
      <View style={{ height: spacing.xs }} />
    </LinearGradient>
  );
}
