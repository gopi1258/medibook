/**
 * State carried between the three sign-in steps (phone → OTP → profile setup).
 *
 * The attempt counter and lockout live here rather than on the server because the
 * offline mock has no rate limiter; the real API enforces the same limits and its
 * `AUTH_LOCKED` / `attempts_remaining` details are folded back into this store so
 * the UI behaves identically either way (PRD PAT-001).
 */
import { defaultPlatformConfig, type OtpChannel } from '@medibook/core';

import { createStore, useStoreState } from './store';

export type AuthFlowSnapshot = {
  channel: OtpChannel;
  destination: string;
  /** `register` sends the user through profile setup; `login` goes straight home. */
  purpose: 'login' | 'register';
  /** Code echoed by the dev server, surfaced as a hint while offline/dev. */
  devCode: string | null;
  /** Epoch ms before which "Resend" stays disabled. */
  resendAvailableAt: number;
  attempts: number;
  /** Epoch ms while the code entry is locked (3 wrong attempts). */
  lockedUntil: number | null;
  expiresAt: number | null;
};

const initial: AuthFlowSnapshot = {
  channel: 'phone',
  destination: '',
  purpose: 'login',
  devCode: null,
  resendAvailableAt: 0,
  attempts: 0,
  lockedUntil: null,
  expiresAt: null,
};

export const authFlowStore = createStore<AuthFlowSnapshot>(initial);

export function useAuthFlow(): AuthFlowSnapshot {
  return useStoreState(authFlowStore);
}

export function beginAuthFlow(input: { channel: OtpChannel; destination: string; purpose: 'login' | 'register' }): void {
  authFlowStore.replace({
    ...initial,
    channel: input.channel,
    destination: input.destination,
    purpose: input.purpose,
    resendAvailableAt: Date.now() + defaultPlatformConfig.otp_resend_cooldown_seconds * 1000,
  });
}

export function noteOtpSent(input: { devCode: string | null; resendAfterSeconds: number; expiresInSeconds: number }): void {
  authFlowStore.set({
    devCode: input.devCode,
    resendAvailableAt: Date.now() + input.resendAfterSeconds * 1000,
    attempts: 0,
    lockedUntil: null,
    expiresAt: Date.now() + input.expiresInSeconds * 1000,
  });
}

export function noteOtpFailure(attemptsRemaining?: number): void {
  const current = authFlowStore.get();
  const attempts = attemptsRemaining !== undefined ? defaultPlatformConfig.otp_max_attempts - attemptsRemaining : current.attempts + 1;
  const exhausted = attempts >= defaultPlatformConfig.otp_max_attempts;
  authFlowStore.set({
    attempts,
    lockedUntil: exhausted ? Date.now() + defaultPlatformConfig.otp_lockout_seconds * 1000 : null,
  });
}

export function noteOtpLocked(retryAfterSeconds?: number): void {
  authFlowStore.set({
    attempts: defaultPlatformConfig.otp_max_attempts,
    lockedUntil: Date.now() + (retryAfterSeconds ?? defaultPlatformConfig.otp_lockout_seconds) * 1000,
  });
}

export function resetAuthFlow(): void {
  authFlowStore.replace({ ...initial });
}

export const otpAttemptsRemaining = (snapshot: AuthFlowSnapshot): number =>
  Math.max(0, defaultPlatformConfig.otp_max_attempts - snapshot.attempts);
