/**
 * The single transport seam (doctor side).
 *
 * `EXPO_PUBLIC_API_URL` set → `createHttpApi()` against `services/api`;
 * otherwise → `createMockApi()` over the bundled dataset. Screens import
 * `doctorApi` and never learn which one they got.
 */
import {
  createHttpApi,
  createMockApi,
  type DoctorApi,
  type AuthSession,
  type PatientApi,
  type TokenBundle,
} from '@medibook/core';

import { API_URL } from './env';

let tokens: TokenBundle = { accessToken: null, refreshToken: null };

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

export const doctorApi: DoctorApi = httpClient ? httpClient.doctor : mockClient!.doctor;

/**
 * The patient API over the *same* store.
 *
 * The doctor app never books on a patient's behalf, but a shared client is what
 * makes the offline mock one consistent world: availability the doctor opens
 * shows up as bookable patient slots in the same session.
 */
export const patientApi: PatientApi = httpClient ? httpClient.patient : mockClient!.patient;

export const IS_REMOTE = httpClient !== null;

export function registerAuthBridge(next: AuthBridge): void {
  bridge = next;
}

export function primeTokens(next: TokenBundle): void {
  tokens = next;
}

export function clearTokens(): void {
  tokens = { accessToken: null, refreshToken: null };
}
