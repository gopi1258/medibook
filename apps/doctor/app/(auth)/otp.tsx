/**
 * Doctor sign-in step 2 — 6-digit OTP, resend cooldown and the 3-attempt cap.
 * Identical behaviour to the patient app because it is the same server contract.
 */
import * as React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import { ApiError, defaultPlatformConfig } from '@medibook/core';
import { Button, PolicyNote, Screen, ScreenHeader, Text, TextField, spacing } from '@medibook/brand';

import { doctorApi, IS_REMOTE } from '../../src/lib/api';
import {
  noteOtpFailure,
  noteOtpLocked,
  noteOtpSent,
  otpAttemptsRemaining,
  resetAuthFlow,
  useAuthFlow,
} from '../../src/lib/authFlow';
import { describeError } from '../../src/lib/format';
import { signInWithOtp } from '../../src/lib/session';
import { useNow } from '../../src/lib/useNow';
import { InlineNotice } from '../../src/components/states';

export default function DoctorOtpScreen() {
  const router = useRouter();
  const flow = useAuthFlow();
  const now = useNow(1000);

  const [code, setCode] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [resending, setResending] = React.useState(false);
  const [failure, setFailure] = React.useState<unknown>(null);

  const locked = flow.lockedUntil !== null && flow.lockedUntil > now;
  const lockSeconds = locked ? Math.ceil(((flow.lockedUntil ?? 0) - now) / 1000) : 0;
  const resendIn = Math.max(0, Math.ceil((flow.resendAvailableAt - now) / 1000));
  const attemptsLeft = otpAttemptsRemaining(flow);

  const verify = React.useCallback(
    async (candidate: string) => {
      if (submitting) return;
      setSubmitting(true);
      setFailure(null);
      try {
        await signInWithOtp({
          channel: flow.channel,
          destination: flow.destination,
          code: candidate,
          register: flow.purpose === 'register',
        });
        resetAuthFlow();
        router.replace('/(auth)/verification');
      } catch (caught) {
        setFailure(caught);
        if (caught instanceof ApiError && caught.code === 'AUTH_LOCKED') {
          const retry = caught.details['retry_after_seconds'];
          noteOtpLocked(typeof retry === 'number' ? retry : undefined);
        } else {
          const remaining = caught instanceof ApiError ? caught.details['attempts_remaining'] : undefined;
          noteOtpFailure(typeof remaining === 'number' ? remaining : undefined);
        }
        setCode('');
      } finally {
        setSubmitting(false);
      }
    },
    [flow.channel, flow.destination, flow.purpose, router, submitting],
  );

  const resend = async () => {
    if (resendIn > 0 || resending) return;
    setResending(true);
    setFailure(null);
    try {
      const result = await doctorApi.requestOtp({
        channel: flow.channel,
        destination: flow.destination,
        purpose: flow.purpose,
        role: 'doctor',
      });
      const record = (result ?? {}) as Record<string, unknown>;
      noteOtpSent({
        devCode: typeof record['dev_code'] === 'string' ? (record['dev_code'] as string) : null,
        resendAfterSeconds: defaultPlatformConfig.otp_resend_cooldown_seconds,
        expiresInSeconds: defaultPlatformConfig.otp_ttl_minutes * 60,
      });
      setCode('');
    } catch (caught) {
      setFailure(caught);
    } finally {
      setResending(false);
    }
  };

  const described = failure ? describeError(failure) : null;

  return (
    <Screen edges={['top']} contentContainerStyle={{ gap: spacing.lg }}>
      <ScreenHeader
        title="Enter your code"
        subtitle={`We sent a 6-digit code to ${flow.destination || 'your device'}`}
        onBack={() => router.back()}
      />

      <TextField
        label="6-digit code"
        otp
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        maxLength={6}
        value={code}
        onChangeText={(next) => {
          const digits = next.replace(/\D/g, '').slice(0, 6);
          setCode(digits);
          if (failure) setFailure(null);
          if (digits.length === 6) void verify(digits);
        }}
        editable={!locked && !submitting}
        error={described?.message}
        helper={
          locked
            ? `Too many attempts. Try again in ${lockSeconds}s.`
            : attemptsLeft < defaultPlatformConfig.otp_max_attempts
              ? `${attemptsLeft} attempt${attemptsLeft === 1 ? '' : 's'} left before a short lockout.`
              : 'Codes are valid for 10 minutes.'
        }
        autoFocus
        accessibilityLabel="One time passcode"
      />

      {flow.devCode ? (
        <PolicyNote
          tone="info"
          title={`Development code: ${flow.devCode}`}
          body="The API echoed this code because it is running in development mode. It is never returned in production."
        />
      ) : IS_REMOTE ? null : (
        <PolicyNote
          tone="info"
          title="Offline demo mode"
          body="Any 6 digits will sign you in as Dr. Arjun Mehta against the bundled dataset."
        />
      )}

      {described && !locked ? <InlineNotice message={described.message} /> : null}

      <Button
        label={submitting ? 'Verifying…' : 'Verify and continue'}
        onPress={() => void verify(code)}
        loading={submitting}
        disabled={code.length !== 6 || locked || submitting}
      />

      <Button
        label={resendIn > 0 ? `Resend code in ${resendIn}s` : resending ? 'Sending…' : 'Resend code'}
        variant="secondary"
        disabled={resendIn > 0 || resending}
        onPress={() => void resend()}
      />

      {locked ? (
        <View style={{ gap: spacing.sm }}>
          <PolicyNote
            tone="warning"
            title="Locked for a minute"
            body="This protects your account from code guessing. You can switch to email and we will send the code there instead."
          />
          <Button
            label="Use email instead"
            variant="ghost"
            size="sm"
            onPress={() => {
              resetAuthFlow();
              router.replace({ pathname: '/(auth)/phone', params: { purpose: flow.purpose } });
            }}
          />
        </View>
      ) : null}

      <Text variant="caption" align="center">
        Next: your professional details and licence documents.
      </Text>
    </Screen>
  );
}
