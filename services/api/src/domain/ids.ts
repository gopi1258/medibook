/**
 * Identifier and token helpers.
 *
 * Object ids are opaque and non-enumerable (TRD §12: "object-id UUIDs (no
 * enumerable ids)"). Human-facing appointment codes are short, unambiguous and
 * checked for collisions by the `code` unique index.
 */
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1

/** `apt_9f2c…` — prefixed opaque id. */
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString('hex')}`;
}

/** `MB-8H2K4` — five characters from a 32-symbol alphabet (~33M combinations). */
export function newAppointmentCode(): string {
  let out = '';
  for (let index = 0; index < 5; index += 1) {
    out += ALPHABET[randomInt(0, ALPHABET.length)];
  }
  return `MB-${out}`;
}

/** Six-digit OTP, uniformly distributed (never `Math.random`). */
export function newOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/* ------------------------------------------------------------------ tokens */

export type AccessTokenClaims = {
  /** Subject — the user id. */
  sub: string;
  role: 'patient' | 'doctor' | 'admin';
  verification_state: string | null;
  /** Token id, so a session can be revoked. */
  jti: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string;
};

const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;
const ISSUER = 'medibook-api';
const AUDIENCE = 'medibook-mobile';

function secret(): string {
  return process.env['MEDIBOOK_JWT_SECRET'] ?? 'medibook-local-development-secret';
}

function base64url(input: Buffer | string): string {
  const buffer = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(input: string): string {
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function sign(payload: string): string {
  return base64url(createHmac('sha256', secret()).update(payload).digest());
}

/**
 * Mint a compact JWT (HS256). Structural compatibility with the production
 * token model in TRD §8.2 — claims, `aud`, `iss` and a 15-minute lifetime.
 */
export function signAccessToken(input: {
  userId: string;
  role: AccessTokenClaims['role'];
  verificationState?: string | null;
  nowMs?: number;
}): { token: string; expiresIn: number; claims: AccessTokenClaims } {
  const iat = Math.floor((input.nowMs ?? Date.now()) / 1000);
  const claims: AccessTokenClaims = {
    sub: input.userId,
    role: input.role,
    verification_state: input.verificationState ?? null,
    jti: randomBytes(8).toString('hex'),
    iat,
    exp: iat + ACCESS_TTL_SECONDS,
    iss: ISSUER,
    aud: AUDIENCE,
  };
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(claims));
  return { token: `${header}.${body}.${sign(`${header}.${body}`)}`, expiresIn: ACCESS_TTL_SECONDS, claims };
}

export type VerifyResult =
  | { ok: true; claims: AccessTokenClaims }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'wrong_issuer_or_audience' };

/** Verify signature, lifetime, issuer and audience (30 s clock leeway). */
export function verifyAccessToken(token: string, nowMs?: number): VerifyResult {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [header, body, signature] = parts as [string, string, string];

  const expected = sign(`${header}.${body}`);
  const given = Buffer.from(signature);
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    return { ok: false, reason: 'bad_signature' };
  }

  let claims: AccessTokenClaims;
  try {
    claims = JSON.parse(fromBase64url(body)) as AccessTokenClaims;
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (claims.iss !== ISSUER || claims.aud !== AUDIENCE) {
    return { ok: false, reason: 'wrong_issuer_or_audience' };
  }

  const nowSeconds = Math.floor((nowMs ?? Date.now()) / 1000);
  if (typeof claims.exp !== 'number' || claims.exp + 30 < nowSeconds) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, claims };
}

/* ---------------------------------------------------------------- refresh */

export type RefreshTokenMaterial = {
  /** Opaque token handed to the device. */
  token: string;
  /** SHA-256 of the token — the only form stored (TRD §8.2: hashed at rest). */
  hash: string;
  familyId: string;
  expiresAt: string;
};

/** Rotating refresh token, bound to a token family for reuse detection. */
export function newRefreshToken(existingFamilyId?: string, nowMs?: number): RefreshTokenMaterial {
  const token = base64url(randomBytes(32));
  const expiresAt = new Date((nowMs ?? Date.now()) + REFRESH_TTL_SECONDS * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z');
  return {
    token,
    hash: hashToken(token),
    familyId: existingFamilyId ?? randomBytes(8).toString('hex'),
    expiresAt,
  };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export const TOKEN_TTL = {
  accessSeconds: ACCESS_TTL_SECONDS,
  refreshSeconds: REFRESH_TTL_SECONDS,
} as const;
