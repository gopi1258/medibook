/**
 * The single transport seam.
 *
 * Exactly one of `patientApi` / `doctorApi` is wired at runtime:
 *   - `EXPO_PUBLIC_API_URL` set   → `createHttpApi()` against `services/api`;
 *   - otherwise                   → `createMockApi()` over the bundled dataset.
 *
 * Screens import `patientApi` (or the `useApi()` hook) and never learn which one
 * they got. Both satisfy the frozen `PatientApi` / `DoctorApi` contract in
 * `@medibook/core`, including throwing the very same `ApiError` class.
 */
import { createHttpApi, createMockApi, type AuthSession, type DoctorApi, type PatientApi, type TokenBundle } from '@medibook/core';

import { API_URL } from './env';

let tokens: TokenBundle = { accessToken: null, refreshToken: null };

/** Set by the session store so rotated tokens are persisted and sign-out is honoured. */
type AuthBridge = {
  onTokens?: (session: AuthSession) => void;
  onSignOut?: () => void;
};

let bridge: AuthBridge = {};

const httpClient = API_URL
  ? createHttpApi({
      baseUrl: API_URL,
      getTokens: () => tokens,
      onTokens: (session) => {
        tokens = { accessToken: session.access_token, refreshToken: session.refresh_token };
        bridge.onTokens?.(session);
      },
      onSignOut: () => {
        tokens = { accessToken: null, refreshToken: null };
        bridge.onSignOut?.();
      },
    })
  : null;

const mockClient = httpClient ? null : createMockApi();

export const patientApi: PatientApi = httpClient ? httpClient.patient : mockClient!.patient;
export const doctorApi: DoctorApi = httpClient ? httpClient.doctor : mockClient!.doctor;

/** True when the app is talking to `services/api`. */
export const IS_REMOTE = httpClient !== null;

export function registerAuthBridge(next: AuthBridge): void {
  bridge = next;
}

/** Seed the in-memory token bundle after SecureStore hydration. */
export function primeTokens(next: TokenBundle): void {
  tokens = next;
}

export function clearTokens(): void {
  tokens = { accessToken: null, refreshToken: null };
}
