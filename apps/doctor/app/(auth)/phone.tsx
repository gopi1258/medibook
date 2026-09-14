/**
 * Doctor sign-in step 1 — destination entry. Mirrors the patient app's phone
 * screen; the only difference is the `role: 'doctor'` sent with the OTP request,
 * which is what binds the account to the clinician side (TRD §8.1).
 */
import * as React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { defaultPlatformConfig, type OtpChannel } from '@medibook/core';
import {
  Button,
  Card,
  PolicyNote,
  Screen,
  ScreenHeader,
  SegmentedControl,
  Text,
  TextField,
  color,
  spacing,
  type SegmentedOption,
} from '@medibook/brand';

import { doctorApi, IS_REMOTE } from '../../src/lib/api';
import { beginAuthFlow, noteOtpSent, resetAuthFlow } from '../../src/lib/authFlow';
import { describeError } from '../../src/lib/format';
import { InlineNotice } from '../../src/components/states';

const CHANNELS: readonly SegmentedOption<OtpChannel>[] = [
  { value: 'phone', label: 'Phone' },
  { value: 'email', label: 'Email' },
];

const PHONE_PATTERN = /^\+?[0-9]{8,15}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function DoctorPhoneScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ purpose?: string }>();
  const purpose: 'login' | 'register' = params.purpose === 'register' ? 'register' : 'login';

  const [channel, setChannel] = React.useState<OtpChannel>('phone');
  const [value, setValue] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [failure, setFailure] = React.useState<unknown>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const normalised = React.useMemo(() => {
    const trimmed = value.trim();
    if (channel === 'phone') return trimmed.startsWith('+') ? trimmed : `+91${trimmed.replace(/\D/g, '')}`;
    return trimmed.toLowerCase();
  }, [channel, value]);

  const valid = channel === 'phone' ? PHONE_PATTERN.test(normalised) : EMAIL_PATTERN.test(normalised);

  const send = async () => {
    if (!valid) {
      setError(channel === 'phone' ? 'Enter a valid mobile number.' : 'Enter a valid email address.');
      return;
    }
    setError(null);
    setFailure(null);
    setSubmitting(true);
    try {
      const result = await doctorApi.requestOtp({ channel, destination: normalised, purpose, role: 'doctor' });
      const record = (result ?? {}) as Record<string, unknown>;
      const devCode = typeof record['dev_code'] === 'string' ? (record['dev_code'] as string) : null;
      beginAuthFlow({ channel, destination: normalised, purpose });
      noteOtpSent({
        devCode,
        resendAfterSeconds: defaultPlatformConfig.otp_resend_cooldown_seconds,
        expiresInSeconds: defaultPlatformConfig.otp_ttl_minutes * 60,
      });
      router.push('/(auth)/otp');
    } catch (caught) {
      setFailure(caught);
      setError(describeError(caught).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen edges={['top']} contentContainerStyle={{ gap: spacing.lg }}>
      <ScreenHeader
        title={purpose === 'register' ? 'Register your practice' : 'Welcome back'}
        subtitle="One code, no password to remember"
        onBack={() => router.back()}
      />

      <SegmentedControl options={CHANNELS} value={channel} onChange={setChannel} accessibilityLabel="Sign-in method" />

      <TextField
        label={channel === 'phone' ? 'Mobile number' : 'Work email'}
        leadingIcon={channel === 'phone' ? 'phone' : 'mail'}
        keyboardType={channel === 'phone' ? 'phone-pad' : 'email-address'}
        placeholder={channel === 'phone' ? '98334 45566' : 'doctor@clinic.com'}
        value={value}
        onChangeText={(next) => {
          setValue(next);
          if (error) setError(null);
        }}
        error={error ?? undefined}
        helper={
          channel === 'phone'
            ? 'We send a 6-digit code by SMS. Patients never see this number.'
            : 'We email a 6-digit code to this address — use the one on your registration if possible.'
        }
        returnKeyType="done"
        onSubmitEditing={() => void send()}
        autoFocus
      />

      {failure ? <InlineNotice message={describeError(failure).message} /> : null}

      <Button
        label={submitting ? 'Sending code…' : 'Send code'}
        onPress={() => void send()}
        loading={submitting}
        disabled={!valid || submitting}
        iconRight="arrow-right"
      />

      {!IS_REMOTE ? (
        <PolicyNote
          tone="info"
          title="Offline demo mode"
          body="No API URL is configured, so the app runs against its bundled dataset. Request a code and enter any 6 digits — 123456 works. You will be signed in as Dr. Arjun Mehta."
        />
      ) : null}

      <Card variant="flat" style={{ backgroundColor: color.surfaceAlt, gap: spacing.xs }}>
        <Text variant="bodyStrong">What patients see</Text>
        <Text variant="small">
          Your display name, specialisations, qualifications, experience, languages, fees and verified badge. Your phone
          number and email are never shown to patients.
        </Text>
      </Card>

      <Button
        label={purpose === 'register' ? 'I already have an account' : 'Create a new account'}
        variant="ghost"
        size="sm"
        onPress={() => {
          resetAuthFlow();
          setValue('');
          setError(null);
          setFailure(null);
          router.setParams({ purpose: purpose === 'register' ? 'login' : 'register' });
        }}
      />
    </Screen>
  );
}
