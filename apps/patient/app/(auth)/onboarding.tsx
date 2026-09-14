/**
 * J1 step 1 — onboarding carousel.
 *
 * Three value-first slides (find verified doctors / real availability / family
 * booking), a pager, and "Get started". Also the landing point for "I already
 * have an account", because the phone screen decides login vs register.
 */
import * as React from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';

import { BrandHero, Button, Card, Icon, Logo, Screen, Text, color, spacing, type IconName } from '@medibook/brand';

import { resetAuthFlow } from '../../src/lib/authFlow';

type Slide = { icon: IconName; title: string; body: string };

const SLIDES: Slide[] = [
  {
    icon: 'shield-check',
    title: 'Only verified doctors',
    body: 'Every clinician is licence-checked before they appear here — the verified badge is never decorative.',
  },
  {
    icon: 'calendar-check',
    title: 'Availability that is real',
    body: 'Slots come from the doctor’s own schedule and calendar. If a time is shown, it can be booked.',
  },
  {
    icon: 'users',
    title: 'Book for the whole family',
    body: 'Add your children or parents once, then book, reschedule and review on their behalf.',
  },
];

export default function OnboardingScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [index, setIndex] = React.useState(0);

  const goToPhone = (purpose: 'login' | 'register') => {
    resetAuthFlow();
    router.push({ pathname: '/(auth)/phone', params: { purpose } });
  };

  return (
    <Screen edges={['top', 'bottom']} contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.xxl }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Logo size={36} />
      </View>

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
            <BrandHero height={188} style={{ justifyContent: 'flex-end' }}>
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

      <Card variant="flat" style={{ backgroundColor: color.surfaceAlt, gap: spacing.sm }}>
        <Text variant="bodyStrong">Book in under two minutes</Text>
        <Text variant="small">Phone or email sign-in. No card details needed to browse.</Text>
      </Card>

      <View style={{ gap: spacing.sm, marginTop: 'auto' }}>
        <Button label="Get started" iconRight="arrow-right" onPress={() => goToPhone('register')} />
        <Button label="I already have an account" variant="ghost" onPress={() => goToPhone('login')} />
      </View>

      <Button
        label="Skip the tour"
        variant="ghost"
        size="sm"
        accessibilityHint="Jumps straight to sign-in"
        onPress={() => goToPhone('login')}
      />
    </Screen>
  );
}
