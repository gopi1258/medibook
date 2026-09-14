/**
 * Session store — identity, tokens and on-device persistence.
 *
 * Tokens live in `expo-secure-store` (TRD §4.5) and are hydrated once on boot so
 * a returning user lands on Home instead of the carousel. Everything else is
 * derived from `AuthUser`, which the mock and the HTTP client both return.
 */
import * as SecureStore from 'expo-secure-store';
import { useCallback } from 'react';
import type { AuthSession, AuthUser, Gender, OtpChannel } from '@medibook/core';

import { clearTokens, patientApi, primeTokens, registerAuthBridge } from './api';
import { createStore, useStoreState } from './store';

const TOKENS_KEY = 'medibook.patient.tokens';
const USER_KEY = 'medibook.patient.user';

export type SessionSnapshot = {
  /** `loading` until SecureStore hydration finishes. */
  status: 'loading' | 'signed_out' | 'signed_in';
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  /** Onboarding step the app should resume at when signed in. */
  pendingOnboarding: boolean;
};

const initial: SessionSnapshot = {
  status: 'loading',
  user: null,
  accessToken: null,
  refreshToken: null,
  pendingOnboarding: false,
};

export const sessionStore = createStore<SessionSnapshot>(initial);

export function useSession(): SessionSnapshot {
  return useStoreState(sessionStore);
}

export function useCurrentUser(): AuthUser | null {
  return useStoreState(sessionStore).user;
}

/** The patient's own timezone — used everywhere a time is rendered (PRD R9). */
export function useViewerTimeZone(): string {
  return useStoreState(sessionStore).user?.default_timezone ?? 'Asia/Kolkata';
}

async function persist(user: AuthUser, accessToken: string, refreshToken: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(TOKENS_KEY, JSON.stringify({ accessToken, refreshToken }));
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
  } catch {
    /* SecureStore is unavailable on web — the session simply does not survive a reload. */
  }
}

async function clearPersisted(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(TOKENS_KEY);
    await SecureStore.deleteItemAsync(USER_KEY);
  } catch {
    /* ignore */
  }
}

registerAuthBridge({
  onTokens: (session: AuthSession) => {
    void persist(session.user, session.access_token, session.refresh_token);
  },
  onSignOut: () => {
    void clearPersisted();
    clearTokens();
    sessionStore.replace({ ...initial, status: 'signed_out' });
  },
});

/** Called once from the root layout. */
export async function hydrateSession(): Promise<void> {
  try {
    const [rawTokens, rawUser] = await Promise.all([
      SecureStore.getItemAsync(TOKENS_KEY),
      SecureStore.getItemAsync(USER_KEY),
    ]);
    if (!rawTokens || !rawUser) {
      sessionStore.replace({ ...initial, status: 'signed_out' });
      return;
    }
    const parsed = JSON.parse(rawTokens) as { accessToken?: string; refreshToken?: string };
    const user = JSON.parse(rawUser) as AuthUser;
    const accessToken = parsed.accessToken ?? null;
    primeTokens({ accessToken, refreshToken: parsed.refreshToken ?? null });

    if (accessToken) {
      // Re-validate against the server; a stale token must not fake a session.
      try {
        const fresh = await patientApi.me();
        sessionStore.replace({
          status: 'signed_in',
          user: fresh,
          accessToken,
          refreshToken: parsed.refreshToken ?? null,
          pendingOnboarding: fresh.onboarding_state !== 'complete',
        });
        return;
      } catch {
        /* fall through to the offline snapshot below */
      }
    }

    sessionStore.replace({
      status: 'signed_in',
      user,
      accessToken,
      refreshToken: parsed.refreshToken ?? null,
      pendingOnboarding: user.onboarding_state !== 'complete',
    });
  } catch {
    sessionStore.replace({ ...initial, status: 'signed_out' });
  }
}

/**
 * Adopt a fresh session.
 *
 * `forceOnboarding` exists because the offline mock always reports a *finished*
 * account (it ships one seeded user), while the real API reports the stored
 * onboarding state. A brand-new registration must go through profile setup /
 * verification in both implementations, so the register path forces the flag
 * instead of trusting `onboarding_state` alone.
 */
export function applySession(session: AuthSession, options: { forceOnboarding?: boolean } = {}): void {
  primeTokens({ accessToken: session.access_token, refreshToken: session.refresh_token });
  void persist(session.user, session.access_token, session.refresh_token);
  sessionStore.replace({
    status: 'signed_in',
    user: session.user,
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    pendingOnboarding: options.forceOnboarding === true || session.user.onboarding_state !== 'complete',
  });
}

export function updateSessionUser(patch: Partial<AuthUser>): void {
  const current = sessionStore.get();
  if (!current.user) return;
  const user = { ...current.user, ...patch };
  sessionStore.set({
    user,
    pendingOnboarding: user.onboarding_state !== 'complete',
  });
  void persist(user, current.accessToken ?? '', current.refreshToken ?? '');
}

export function markOnboardingComplete(): void {
  updateSessionUser({ onboarding_state: 'complete' });
}

export async function signInWithOtp(input: {
  channel: OtpChannel;
  destination: string;
  code: string;
  register: boolean;
  draft?: { display_name?: string; gender?: Gender; dob?: string };
}): Promise<AuthSession> {
  const session = await patientApi.verifyOtp({
    channel: input.channel,
    destination: input.destination,
    code: input.code,
    role: 'patient',
    register: input.register,
    profile_draft: input.draft,
  });
  applySession(session, { forceOnboarding: input.register });
  return session;
}

export async function signOut(): Promise<void> {
  try {
    await patientApi.logout();
  } catch {
    /* the local session is cleared regardless */
  }
  clearTokens();
  await clearPersisted();
  sessionStore.replace({ ...initial, status: 'signed_out' });
}

/** Convenience hook used by screens that only need the sign-out path. */
export function useSignOut(): () => void {
  return useCallback(() => {
    void signOut();
  }, []);
}
