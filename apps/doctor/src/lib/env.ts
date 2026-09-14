/**
 * Compile-time configuration.
 *
 * `EXPO_PUBLIC_API_URL` is inlined by Metro at bundle time. When it is absent the
 * app runs entirely against the bundled offline mock dataset (no network at all).
 */

function readApiUrl(): string | null {
  try {
    const value = process.env['EXPO_PUBLIC_API_URL'];
    if (typeof value !== 'string') return null;
    const trimmed = value.trim().replace(/\/+$/, '');
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

/** `http://localhost:4000/v1` or `null` for the offline mock. */
export const API_URL = readApiUrl();

export const USING_MOCK_API = API_URL === null;
