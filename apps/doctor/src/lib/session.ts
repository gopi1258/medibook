/**
 * Session store (doctor side) — identity, tokens and SecureStore persistence.
 *
 * Doctors have a longer onboarding: registration → verification submission →
 * (admin decision) → go live. `pendingOnboarding` therefore means "finish the
 * verification wizard", and the gate sends the doctor there until the API reports
 * `onboarding_state` as `live`.
 */
import * as SecureStore from 'expo-secure-store';
import { useCallback } from 'react';
import type { AuthSession, AuthUser, Gender, OtpChannel } from '@medibook/core';

import { clearTokens, doctorApi, primeTokens, registerAuthBridge } from './api';
import { createStore, useStoreState } from './store';

const TOKENS_KEY = 'medibook.doctor.tokens';
const USER_KEY = 'medibook.doctor.user';

export type SessionSnapshot = {
  status: 'loading' | 'signed_out' | 'signed_in';
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  /** True while the verification wizard still needs finishing. */
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

/** Clinic timezone is canonical for the doctor's own screens (PRD R9). */
export function useClinicTimeZone(): string {
  return useStoreState(sessionStore).user?.default_timezone ?? 'Asia/Kolkata';
}

export function isLive(user: AuthUser | null): boolean {
  return user?.onboarding_state === 'live' && user.verification_status === 'approved';
}

async function persist(user: AuthUser, accessToken: string, refreshToken: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(TOKENS_KEY, JSON.stringify({ accessToken, refreshToken }));
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
  } catch {
    /* unavailable on web */
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
    const cached = JSON.parse(rawUser) as AuthUser;
    const accessToken = parsed.accessToken ?? null;
    primeTokens({ accessToken, refreshToken: parsed.refreshToken ?? null });

    if (accessToken) {
      try {
        const fresh = await doctorApi.me();
        sessionStore.replace({
          status: 'signed_in',
          user: fresh,
          accessToken,
          refreshToken: parsed.refreshToken ?? null,
          pendingOnboarding: fresh.onboarding_state !== 'live',
        });
        return;
      } catch {
        /* fall back to the cached identity below */
      }
    }

    sessionStore.replace({
      status: 'signed_in',
      user: cached,
      accessToken,
      refreshToken: parsed.refreshToken ?? null,
      pendingOnboarding: cached.onboarding_state !== 'live',
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
    pendingOnboarding: options.forceOnboarding === true || session.user.onboarding_state !== 'live',
  });
}

export function updateSessionUser(patch: Partial<AuthUser>): void {
  const current = sessionStore.get();
  if (!current.user) return;
  const user = { ...current.user, ...patch };
  sessionStore.set({ user, pendingOnboarding: user.onboarding_state !== 'live' });
  void persist(user, current.accessToken ?? '', current.refreshToken ?? '');
}

export function markGoLive(): void {
  updateSessionUser({ onboarding_state: 'live' });
}

export async function signInWithOtp(input: {
  channel: OtpChannel;
  destination: string;
  code: string;
  register: boolean;
  draft?: { display_name?: string; gender?: Gender; dob?: string };
}): Promise<AuthSession> {
  const session = await doctorApi.verifyOtp({
    channel: input.channel,
    destination: input.destination,
    code: input.code,
    role: 'doctor',
    register: input.register,
    profile_draft: input.draft,
  });
  applySession(session, { forceOnboarding: input.register });
  return session;
}

export async function signOut(): Promise<void> {
  try {
    await doctorApi.logout();
  } catch {
    /* the local session is cleared regardless */
  }
  clearTokens();
  await clearPersisted();
  sessionStore.replace({ ...initial, status: 'signed_out' });
}

export function useSignOut(): () => void {
  return useCallback(() => {
    void signOut();
  }, []);
}
