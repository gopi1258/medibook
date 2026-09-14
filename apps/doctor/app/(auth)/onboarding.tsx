/**
 * J9 step 1 — doctor onboarding.
 *
 * Three slides aimed at the doctor's actual complaints (double-bookings,
 * no-shows, desk-bound tools), then sign-in/sign-up. Registration selects the
 * doctor role on the OTP exchange, which is what makes the account a clinician
 * account rather than a patient one.
 */
import * as React from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';

import { BrandHero, Button, Card, Icon, Logo, Screen, Text, color, spacing, type IconName } from '@medibook/brand';

import { resetAuthFlow } from '../../src/lib/authFlow';

const SLIDES: ReadonlyArray<{ icon: IconName; title: string; body: string }> = [
  {
    icon: 'shield-check',
    title: 'One calendar, no double-bookings',
    body: 'Connect Google or Outlook and your busy time is subtracted from the slots patients can see. Conflicts are flagged, never silently cancelled.',
  },
  {
    icon: 'clock',
    title: 'Your schedule, your rules',
    body: 'Weekly templates, buffers, leaves and blocks. Change a window and future availability updates immediately — existing bookings are never touched without asking.',
  },
  {
    icon: 'users',
    title: 'Patients who show up',
    body: 'Reminder stacks, no-show grace periods and clear patient context before each consultation. Fewer empty slots, fewer surprises.',
  },
];

export default function DoctorOnboardingScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [index, setIndex] = React.useState(0);

  const goToPhone = (purpose: 'login' | 'register') => {
    resetAuthFlow();
    router.push({ pathname: '/(auth)/phone', params: { purpose } });
  };

  return (
    <Screen edges={['top', 'bottom']} contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.xxl }}>
      <Logo size={36} withWordmark />

      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(event) => {
          const page = Math.round(event.nativeEvent.contentOffset.x / Math.max(width, 1));
          setIndex(Math.min(SLIDES.length - 1, Math.max(0, page)));
        }}
        style={{ flexGrow: 0 }}
      >
        {SLIDES.map((slide) => (
          <View key={slide.title} style={{ width, gap: spacing.lg, paddingRight: spacing.xl }}>
            <BrandHero height={180} style={{ justifyContent: 'flex-end' }}>
              <Icon name={slide.icon} size={44} color="#FFFFFF" />
            </BrandHero>
            <Text variant="h1">{slide.title}</Text>
            <Text variant="body" color={color.textSecondary}>
              {slide.body}
            </Text>
          </View>
        ))}
      </ScrollView>

      <View style={{ flexDirection: 'row', gap: spacing.sm, justifyContent: 'center' }}>
        {SLIDES.map((slide, dotIndex) => (
          <View
            key={slide.title}
            style={{
              width: dotIndex === index ? 22 : 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: dotIndex === index ? color.primary : color.border,
            }}
          />
        ))}
      </View>

      <Card variant="flat" style={{ backgroundColor: color.surfaceAlt, gap: spacing.xs }}>
        <Text variant="bodyStrong">Verification comes first</Text>
        <Text variant="small">
          You can set up your whole profile and schedule straight away, but patients only see you once your registration
          and licence documents have been reviewed. Typically within 24 hours.
        </Text>
      </Card>

      <View style={{ gap: spacing.sm, marginTop: 'auto' }}>
        <Button label="Set up my practice" iconRight="arrow-right" onPress={() => goToPhone('register')} />
        <Button label="I already have an account" variant="ghost" onPress={() => goToPhone('login')} />
      </View>
    </Screen>
  );
}
