/**
 * J1 step 2 — phone (or email) entry.
 *
 * Enumeration-safe by design: the response is identical whether or not the
 * account exists, so the copy never confirms that a number is unknown
 * (TRD §7.3.1). Email is offered as the fallback path when SMS is unavailable.
 */
import * as React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

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
import type { OtpChannel } from '@medibook/core';
import { defaultPlatformConfig } from '@medibook/core';

import { patientApi, IS_REMOTE } from '../../src/lib/api';
import { beginAuthFlow, noteOtpSent, resetAuthFlow } from '../../src/lib/authFlow';
import { describeError } from '../../src/lib/format';
import { InlineNotice } from '../../src/components/states';

const CHANNELS: readonly SegmentedOption<OtpChannel>[] = [
  { value: 'phone', label: 'Phone' },
  { value: 'email', label: 'Email' },
];

const PHONE_PATTERN = /^\+?[0-9]{8,15}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function PhoneScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ purpose?: string }>();
  const purpose: 'login' | 'register' = params.purpose === 'register' ? 'register' : 'login';

  const [channel, setChannel] = React.useState<OtpChannel>('phone');
  const [value, setValue] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [failure, setFailure] = React.useState<unknown>(null);

  const normalised = React.useMemo(() => {
    const trimmed = value.trim();
    if (channel === 'phone') {
      return trimmed.startsWith('+') ? trimmed : `+91${trimmed.replace(/\D/g, '')}`;
    }
    return trimmed.toLowerCase();
  }, [channel, value]);

  const valid = channel === 'phone' ? PHONE_PATTERN.test(normalised) : EMAIL_PATTERN.test(normalised);

  const send = async () => {
    setFailure(null);
    if (!valid) {
      setError(
        channel === 'phone'
          ? 'Enter a valid mobile number, e.g. 98123 45678.'
          : 'Enter a valid email address.',
      );
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const result = await patientApi.requestOtp({
        channel,
        destination: normalised,
        purpose,
        role: 'patient',
      });
      beginAuthFlow({ channel, destination: normalised, purpose });
      noteOtpSent({
        devCode: readDevCode(result),
        resendAfterSeconds: defaultPlatformConfig.otp_resend_cooldown_seconds,
        expiresInSeconds: defaultPlatformConfig.otp_ttl_minutes * 60,
      });
      router.push('/(auth)/otp');
    } catch (caught) {
      const described = describeError(caught);
      setFailure(caught);
      setError(described.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen edges={['top']} contentContainerStyle={{ gap: spacing.lg }}>
      <ScreenHeader
        title={purpose === 'register' ? 'Create your account' : 'Welcome back'}
        subtitle="Sign-in takes one code — no password to remember"
        onBack={() => router.back()}
      />

      <SegmentedControl options={CHANNELS} value={channel} onChange={setChannel} accessibilityLabel="Sign-in method" />

      <TextField
        label={channel === 'phone' ? 'Mobile number' : 'Email address'}
        leadingIcon={channel === 'phone' ? 'phone' : 'mail'}
        keyboardType={channel === 'phone' ? 'phone-pad' : 'email-address'}
        autoComplete={channel === 'phone' ? 'tel' : 'email'}
        textContentType={channel === 'phone' ? 'telephoneNumber' : 'emailAddress'}
        placeholder={channel === 'phone' ? '98123 45678' : 'you@example.com'}
        value={value}
        onChangeText={(next) => {
          setValue(next);
          if (error) setError(null);
        }}
        error={error ?? undefined}
        helper={
          channel === 'phone'
            ? 'We send a 6-digit code by SMS. Standard rates may apply.'
            : 'We email a 6-digit code. Check your spam folder if it does not arrive.'
        }
        returnKeyType="done"
        onSubmitEditing={send}
        autoFocus
      />

      {failure ? <InlineNotice message={describeError(failure).message} /> : null}

      <Button
        label={submitting ? 'Sending code…' : 'Send code'}
        onPress={send}
        loading={submitting}
        disabled={!valid || submitting}
        iconRight="arrow-right"
      />

      {!IS_REMOTE ? (
        <PolicyNote
          tone="info"
          title="Offline demo mode"
          body="No API URL is configured, so MediBook is running against its bundled dataset. Request a code, then enter any 6 digits — 123456 works."
        />
      ) : null}

      <Card variant="flat" style={{ gap: spacing.xs, backgroundColor: color.surfaceAlt }}>
        <Text variant="bodyStrong">Your number stays private</Text>
        <Text variant="small">
          Doctors see your booking details, never your phone number. We only share contact details if you ask us to.
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

/** The dev echo is only present when the API runs with `MEDIBOOK_DEV_OTP=1`. */
function readDevCode(result: unknown): string | null {
  if (result && typeof result === 'object') {
    const record = result as Record<string, unknown>;
    const code = record['dev_code'] ?? record['devCode'];
    if (typeof code === 'string' && code.length === 6) return code;
  }
  return null;
}
