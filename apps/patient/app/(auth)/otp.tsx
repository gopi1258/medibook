/**
 * J1 step 3 — 6-digit OTP.
 *
 * Behaviour pinned to PRD PAT-001 / TRD §7.3.2:
 *   - 6 digits, auto-submitting when the sixth arrives;
 *   - resend cooldown (30 s by default) with a live countdown;
 *   - 3 wrong attempts → 60 s lockout, after which the email path is offered;
 *   - the server's `AUTH_LOCKED` / `attempts_remaining` details win over the
 *     local counter, so the offline mock and the real API behave identically.
 */
import * as React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import {
  ApiError,
  defaultPlatformConfig,
} from '@medibook/core';
import { Button, PolicyNote, Screen, ScreenHeader, Text, TextField, color, spacing } from '@medibook/brand';

import { patientApi, IS_REMOTE } from '../../src/lib/api';
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

export default function OtpScreen() {
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
      setFailure(null);
      setSubmitting(true);
      try {
        await signInWithOtp({
          channel: flow.channel,
          destination: flow.destination,
          code: candidate,
          register: flow.purpose === 'register',
        });
        resetAuthFlow();
        if (flow.purpose === 'register') {
          router.replace('/(auth)/profile-setup');
        } else {
          router.replace('/(tabs)');
        }
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

  const onChange = (next: string) => {
    const digits = next.replace(/\D/g, '').slice(0, 6);
    setCode(digits);
    if (failure) setFailure(null);
    if (digits.length === 6) void verify(digits);
  };

  const resend = async () => {
    if (resendIn > 0 || resending) return;
    setResending(true);
    setFailure(null);
    try {
      const result = await patientApi.requestOtp({
        channel: flow.channel,
        destination: flow.destination,
        purpose: flow.purpose,
        role: 'patient',
      });
      const record = (result ?? {}) as Record<string, unknown>;
      const devCode = typeof record['dev_code'] === 'string' ? (record['dev_code'] as string) : null;
      noteOtpSent({
        devCode,
        resendAfterSeconds: defaultPlatformConfig.otp_resend_cooldown_seconds,
        expiresInSeconds: defaultPlatformConfig.otp_ttl_minutes * 60,
      });
      setCode('');
    } catch (caught) {
      setFailure(caught);
      if (caught instanceof ApiError && caught.code === 'RATE_LIMITED') {
        const retry = caught.details['retry_after_seconds'];
        if (typeof retry === 'number') {
          noteOtpSent({ devCode: flow.devCode, resendAfterSeconds: retry, expiresInSeconds: 600 });
        }
      }
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
        autoComplete="sms-otp"
        maxLength={6}
        value={code}
        onChangeText={onChange}
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
          body="Any 6 digits will sign you in against the bundled dataset — 123456 is the documented demo code."
        />
      )}

      {described && !locked ? <InlineNotice message={described.message} tone="danger" /> : null}

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
            body="This protects your account from code-guessing. You can switch to email and we will send the code there instead."
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
        Wrong number? Go back and change it — the code is tied to the number you entered.
      </Text>
    </Screen>
  );
}
