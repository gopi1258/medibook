/**
 * Auth module — phone/email OTP, JWT minting, rotating refresh tokens.
 *
 * Implements TRD §8.1/§8.2 behaviours that matter for correctness:
 *  - enumeration-safe OTP responses (identical answer whether or not the account
 *    exists);
 *  - code TTL, attempt cap and a 60-second lockout;
 *  - refresh tokens stored hashed and rotated on every use, with **reuse
 *    detection**: replaying a rotated token revokes the whole token family.
 */
import { ApiError } from '@medibook/core';
import type { AuthSession, AuthUser, Gender, OtpChannel, Role, VerificationStatus } from '@medibook/core';

import { all, one, run, type Db } from '../db/database.ts';
import { mapAuthUser, mapPreferences, type UserRow } from '../db/mappers.ts';
import { defaultPlatformConfig } from '@medibook/core';
import {
  TOKEN_TTL,
  hashToken,
  newId,
  newOtpCode,
  newRefreshToken,
  signAccessToken,
  verifyAccessToken,
} from '../domain/ids.ts';

export type Session = {
  userId: string;
  role: Role;
  verificationStatus: VerificationStatus | null;
};

export type OtpRequestResult = {
  /** Present only when dev echo is enabled; never in production. */
  devCode?: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
};

export type AuthService = ReturnType<typeof createAuthService>;

const ROLE_ONBOARDING: Record<Role, AuthUser['onboarding_state']> = {
  patient: 'needs_profile',
  doctor: 'needs_verification',
  admin: 'complete',
};

export function createAuthService(options: { db: Db; now: () => number; devOtpEcho: boolean }) {
  const { db, now } = options;

  function iso(ms: number): string {
    return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  function normalizeDestination(channel: OtpChannel, raw: string): string {
    const value = raw.trim();
    if (channel === 'email') {
      const lower = value.toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lower)) {
        throw new ApiError('VAL_INVALID', 'Enter a valid email address.', { details: { destination: lower } });
      }
      return lower;
    }
    const compact = value.replace(/[\s()-]/g, '');
    if (!/^\+[1-9]\d{7,14}$/.test(compact)) {
      throw new ApiError('VAL_INVALID', 'Enter a phone number in international format, e.g. +919812345678.', {
        details: { destination: compact },
      });
    }
    return compact;
  }

  function findUserByDestination(channel: OtpChannel, destination: string): UserRow | undefined {
    return channel === 'phone'
      ? one<UserRow>(db, `SELECT * FROM users WHERE phone = ?`, destination)
      : one<UserRow>(db, `SELECT * FROM users WHERE email = ?`, destination);
  }

  function verificationStatusFor(user: UserRow): VerificationStatus | null {
    if (user.role !== 'doctor') return null;
    const row = one<{ verification_status: string }>(
      db,
      `SELECT verification_status FROM doctors WHERE id = ?`,
      user.id,
    );
    return (row?.verification_status as VerificationStatus | undefined) ?? null;
  }

  function issueSession(user: UserRow): AuthSession {
    const verificationStatus = verificationStatusFor(user);
    const access = signAccessToken({
      userId: user.id,
      role: user.role,
      verificationState: verificationStatus,
      nowMs: now(),
    });

    // A fresh device session starts a new token family.
    const refresh = newRefreshToken(undefined, now());
    run(
      db,
      `INSERT INTO refresh_tokens (token_hash, user_id, family_id, expires_at, revoked_at, created_at)
       VALUES (?, ?, ?, ?, NULL, ?)`,
      refresh.hash,
      user.id,
      refresh.familyId,
      refresh.expiresAt,
      iso(now()),
    );

    return {
      access_token: access.token,
      expires_in: access.expiresIn,
      refresh_token: refresh.token,
      user: mapAuthUser(user, verificationStatus),
    };
  }

  function ensureProfileRows(user: UserRow): void {
    if (user.role === 'patient') {
      run(db, `INSERT OR IGNORE INTO patient_profiles (user_id) VALUES (?)`, user.id);
      run(db, `INSERT OR IGNORE INTO quiet_hours (user_id) VALUES (?)`, user.id);
    }
    for (const entry of DEFAULT_PREFERENCES) {
      run(
        db,
        `INSERT OR IGNORE INTO notification_preferences (user_id, category, push, email, sms, critical)
         VALUES (?, ?, ?, ?, ?, ?)`,
        user.id,
        entry.category,
        entry.push ? 1 : 0,
        entry.email ? 1 : 0,
        entry.sms ? 1 : 0,
        entry.critical ? 1 : 0,
      );
    }
  }

  function userRowFor(userId: string): UserRow {
    const user = one<UserRow>(db, `SELECT * FROM users WHERE id = ?`, userId);
    if (!user) throw new ApiError('NOT_FOUND', 'Account not found.');
    return user;
  }

  function requireDoctorRole(session: Session): void {
    if (session.role !== 'doctor') throw new ApiError('AUTHZ_FORBIDDEN', 'Doctor access required.');
  }

  function requireApprovedDoctorRole(session: Session): void {
    requireDoctorRole(session);
    if (session.verificationStatus !== 'approved') {
      throw new ApiError('DOC_NOT_VERIFIED', 'Your account is not verified yet.', {
        details: { verification_status: session.verificationStatus },
      });
    }
  }

  function requirePatientRole(session: Session): void {
    if (session.role !== 'patient') throw new ApiError('AUTHZ_FORBIDDEN', 'Patient access required.');
  }

  return {
    normalizeDestination,

    /** `POST /auth/otp/request` — always succeeds for a well-formed destination. */
    requestOtp(input: { channel: OtpChannel; destination: string; purpose: 'login' | 'register'; role?: Role }): OtpRequestResult {
      const destination = normalizeDestination(input.channel, input.destination);
      const nowMs = now();
      const existing = one<{
        destination: string;
        attempts: number;
        expires_at: string;
        locked_until: string | null;
        last_sent_at: string | null;
        send_count: number;
      }>(db, `SELECT * FROM otp_challenges WHERE destination = ?`, destination);

      if (existing?.locked_until && Date.parse(existing.locked_until) > nowMs) {
        throw new ApiError('AUTH_LOCKED', 'Too many attempts. Try again in a minute.', {
          details: { retry_after_seconds: Math.ceil((Date.parse(existing.locked_until) - nowMs) / 1000) },
        });
      }

      if (existing?.last_sent_at) {
        const since = (nowMs - Date.parse(existing.last_sent_at)) / 1000;
        if (since < defaultPlatformConfig.otp_resend_cooldown_seconds) {
          throw new ApiError('RATE_LIMITED', 'Please wait before requesting another code.', {
            details: { retry_after_seconds: Math.ceil(defaultPlatformConfig.otp_resend_cooldown_seconds - since) },
          });
        }
      }

      // Per-destination rate limit: 5 sends per rolling hour.
      const withinRateWindow =
        existing?.last_sent_at !== null &&
        existing?.last_sent_at !== undefined &&
        nowMs - Date.parse(existing.last_sent_at) < 3_600_000;
      const recentSends = withinRateWindow ? existing?.send_count ?? 0 : 0;
      if (recentSends >= 5) {
        throw new ApiError('RATE_LIMITED', 'Too many codes requested for this number. Try again later.', {
          details: { retry_after_seconds: 900 },
        });
      }

      const code = newOtpCode();
      const expiresAt = iso(nowMs + defaultPlatformConfig.otp_ttl_minutes * 60_000);

      run(
        db,
        `INSERT INTO otp_challenges (destination, channel, code, purpose, role, attempts, expires_at, locked_until, last_sent_at, send_count)
         VALUES (?, ?, ?, ?, ?, 0, ?, NULL, ?, ?)
         ON CONFLICT(destination) DO UPDATE SET
           code = excluded.code,
           purpose = excluded.purpose,
           role = excluded.role,
           attempts = 0,
           expires_at = excluded.expires_at,
           locked_until = NULL,
           last_sent_at = excluded.last_sent_at,
           send_count = excluded.send_count`,
        destination,
        input.channel,
        code,
        input.purpose,
        input.role ?? null,
        expiresAt,
        iso(nowMs),
        recentSends + 1,
      );

      // No SMS/email provider is configured locally; the code is logged and, in
      // development, echoed back so the flow is testable end to end.
      console.log(`[otp] ${input.channel}:${destination} code=${code} (valid ${defaultPlatformConfig.otp_ttl_minutes} min)`);

      return {
        ...(options.devOtpEcho ? { devCode: code } : {}),
        expiresInSeconds: defaultPlatformConfig.otp_ttl_minutes * 60,
        resendAfterSeconds: defaultPlatformConfig.otp_resend_cooldown_seconds,
      };
    },

    /** `POST /auth/otp/verify` */
    verifyOtp(input: {
      channel: OtpChannel;
      destination: string;
      code: string;
      role: Role;
      register?: boolean;
      profileDraft?: { display_name?: string; gender?: Gender; dob?: string };
    }): AuthSession {
      const destination = normalizeDestination(input.channel, input.destination);
      const nowMs = now();

      const challenge = one<{
        code: string;
        attempts: number;
        expires_at: string;
        locked_until: string | null;
      }>(db, `SELECT * FROM otp_challenges WHERE destination = ?`, destination);

      if (!challenge) {
        throw new ApiError('AUTH_OTP_INVALID', 'That code is not right. Check the digits and try again.');
      }
      if (challenge.locked_until && Date.parse(challenge.locked_until) > nowMs) {
        throw new ApiError('AUTH_LOCKED', 'Too many attempts. Try again in a minute.', {
          details: { retry_after_seconds: Math.ceil((Date.parse(challenge.locked_until) - nowMs) / 1000) },
        });
      }
      if (Date.parse(challenge.expires_at) < nowMs) {
        throw new ApiError('AUTH_OTP_EXPIRED', 'That code has expired. Send a new one.');
      }
      if (challenge.code !== input.code.trim()) {
        const attempts = challenge.attempts + 1;
        const lockedUntil =
          attempts >= defaultPlatformConfig.otp_max_attempts
            ? iso(nowMs + defaultPlatformConfig.otp_lockout_seconds * 1000)
            : null;
        run(
          db,
          `UPDATE otp_challenges SET attempts = ?, locked_until = ? WHERE destination = ?`,
          attempts,
          lockedUntil,
          destination,
        );
        throw new ApiError('AUTH_OTP_INVALID', 'That code is not right. Check the digits and try again.', {
          details: { attempts_remaining: Math.max(0, defaultPlatformConfig.otp_max_attempts - attempts) },
        });
      }

      run(db, `DELETE FROM otp_challenges WHERE destination = ?`, destination);

      const existing = findUserByDestination(input.channel, destination);
      if (existing) {
        if (existing.role !== input.role) {
          throw new ApiError('AUTHZ_FORBIDDEN', `This ${input.channel} is already registered as a ${existing.role}.`, {
            details: { existing_role: existing.role },
          });
        }
        ensureProfileRows(existing);
        return issueSession(existing);
      }

      if (!input.register) {
        throw new ApiError('NOT_FOUND', 'No account found for that number. Please register first.', {
          details: { register_required: true },
        });
      }

      const userId = newId('usr');
      const displayName =
        input.profileDraft?.display_name?.trim() || (input.role === 'doctor' ? 'New doctor' : 'New patient');
      run(
        db,
        `INSERT INTO users (id, role, phone, email, display_name, gender, dob, default_timezone, locale, status, onboarding_state, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'en', 'active', ?, ?)`,
        userId,
        input.role,
        input.channel === 'phone' ? destination : null,
        input.channel === 'email' ? destination : null,
        displayName,
        input.profileDraft?.gender ?? null,
        input.profileDraft?.dob ?? null,
        'Asia/Kolkata',
        ROLE_ONBOARDING[input.role],
        iso(nowMs),
      );

      if (input.role === 'patient') {
        run(db, `INSERT INTO patient_profiles (user_id) VALUES (?)`, userId);
      } else if (input.role === 'doctor') {
        // A doctor row exists from the moment of registration so verification can
        // be submitted before anything is discoverable (PRD DOC-002).
        run(
          db,
          `INSERT INTO doctors (id, display_name, registration_number, verification_status, created_at)
           VALUES (?, ?, ?, 'pending', ?)`,
          userId,
          displayName,
          `PENDING-${userId}`,
          iso(nowMs),
        );
        run(db, `INSERT INTO doctor_policies (doctor_id) VALUES (?)`, userId);
      }

      const created = one<UserRow>(db, `SELECT * FROM users WHERE id = ?`, userId);
      if (!created) throw new ApiError('SYS_INTERNAL', 'Could not create the account.');
      ensureProfileRows(created);
      return issueSession(created);
    },

    /**
     * `POST /auth/refresh` — rotate, and detect reuse of an already-rotated token.
     */
    refresh(refreshToken: string): AuthSession {
      const nowMs = now();
      const hash = hashToken(refreshToken);
      const stored = one<{
        token_hash: string;
        user_id: string;
        family_id: string;
        expires_at: string;
        revoked_at: string | null;
      }>(db, `SELECT * FROM refresh_tokens WHERE token_hash = ?`, hash);

      if (!stored) throw new ApiError('AUTH_INVALID_REFRESH', 'Please sign in again.');

      if (stored.revoked_at !== null) {
        // Reuse of a rotated token is a theft signal: burn the whole family.
        run(
          db,
          `UPDATE refresh_tokens SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL`,
          iso(nowMs),
          stored.family_id,
        );
        console.warn(`[auth] refresh-token reuse detected for user ${stored.user_id}; family revoked`);
        throw new ApiError('AUTH_INVALID_REFRESH', 'Your session was ended for security reasons. Please sign in again.');
      }

      if (Date.parse(stored.expires_at) < nowMs) {
        throw new ApiError('AUTH_INVALID_REFRESH', 'Your session expired. Please sign in again.');
      }

      const user = one<UserRow>(db, `SELECT * FROM users WHERE id = ?`, stored.user_id);
      if (!user) throw new ApiError('AUTH_INVALID_REFRESH', 'Please sign in again.');
      if (user.status !== 'active') {
        throw new ApiError('AUTHZ_FORBIDDEN', 'This account is not active.');
      }

      run(db, `UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ?`, iso(nowMs), hash);

      const verificationStatus = verificationStatusFor(user);
      const access = signAccessToken({
        userId: user.id,
        role: user.role,
        verificationState: verificationStatus,
        nowMs,
      });
      const rotated = newRefreshToken(stored.family_id, nowMs);
      run(
        db,
        `INSERT INTO refresh_tokens (token_hash, user_id, family_id, expires_at, revoked_at, created_at)
         VALUES (?, ?, ?, ?, NULL, ?)`,
        rotated.hash,
        user.id,
        rotated.familyId,
        rotated.expiresAt,
        iso(nowMs),
      );

      return {
        access_token: access.token,
        expires_in: access.expiresIn,
        refresh_token: rotated.token,
        user: mapAuthUser(user, verificationStatus),
      };
    },

    logout(accessToken: string | null, userId: string): void {
      if (accessToken) {
        const result = verifyAccessToken(accessToken, now());
        if (result.ok) {
          run(
            db,
            `UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`,
            iso(now()),
            userId,
          );
          return;
        }
      }
      run(db, `UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`, iso(now()), userId);
    },

    /** Resolve a bearer token into a session, or throw the TRD §7 auth errors. */
    authenticate(accessToken: string | undefined): Session {
      if (!accessToken) throw new ApiError('AUTH_REQUIRED', 'Please sign in to continue.');
      const result = verifyAccessToken(accessToken, now());
      if (!result.ok) {
        throw result.reason === 'expired'
          ? new ApiError('AUTH_TOKEN_EXPIRED', 'Your session expired.')
          : new ApiError('AUTH_REQUIRED', 'Please sign in again.');
      }
      const user = one<UserRow>(db, `SELECT * FROM users WHERE id = ?`, result.claims.sub);
      if (!user) throw new ApiError('AUTH_REQUIRED', 'Please sign in again.');
      if (user.status !== 'active') throw new ApiError('AUTHZ_FORBIDDEN', 'This account is not active.');
      return {
        userId: user.id,
        role: user.role,
        verificationStatus: verificationStatusFor(user),
      };
    },

    me(userId: string): AuthUser {
      const user = userRowFor(userId);
      return mapAuthUser(user, verificationStatusFor(user));
    },

    userRow: userRowFor,

    preferences(userId: string) {
      return mapPreferences(db, userId, userRowFor(userId));
    },

    /** Doctor-only guard (TRD §8.3). */
    requireDoctor: requireDoctorRole,

    /** Doctor routes that affect public availability require `approved`. */
    requireApprovedDoctor: requireApprovedDoctorRole,

    requirePatient: requirePatientRole,

    activeSessions(userId: string): number {
      const row = one<{ count: number }>(
        db,
        `SELECT COUNT(*) AS count FROM refresh_tokens WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?`,
        userId,
        iso(now()),
      );
      return row?.count ?? 0;
    },

    /** Purge expired/revoked refresh tokens and stale idempotency keys. */
    sweep(): { tokens: number; idempotency: number; holds: number } {
      const tokens = run(
        db,
        `DELETE FROM refresh_tokens WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)`,
        iso(now()),
        iso(now() - 24 * 3_600_000),
      ).changes;
      const idempotency = run(
        db,
        `DELETE FROM idempotency_keys WHERE created_at < ?`,
        iso(now() - 24 * 3_600_000),
      ).changes;
      const holds = run(
        db,
        `UPDATE holds SET status = 'expired' WHERE status = 'active' AND expires_at < ?`,
        iso(now()),
      ).changes;
      return { tokens, idempotency, holds };
    },
  };
}

/** Default per-category channel matrix (PRD §12). */
export const DEFAULT_PREFERENCES: ReadonlyArray<{
  category: string;
  push: boolean;
  email: boolean;
  sms: boolean;
  critical: boolean;
}> = [
  { category: 'booking', push: true, email: true, sms: false, critical: false },
  { category: 'approval', push: true, email: true, sms: false, critical: false },
  { category: 'reminder', push: true, email: true, sms: true, critical: false },
  { category: 'join_window', push: true, email: false, sms: false, critical: true },
  { category: 'reschedule', push: true, email: true, sms: true, critical: true },
  { category: 'cancellation', push: true, email: true, sms: true, critical: true },
  { category: 'payment', push: true, email: true, sms: false, critical: false },
  { category: 'calendar', push: true, email: false, sms: false, critical: false },
  { category: 'verification', push: true, email: true, sms: false, critical: false },
  { category: 'security', push: true, email: true, sms: false, critical: true },
  { category: 'review', push: true, email: false, sms: false, critical: false },
];

export { TOKEN_TTL };
export type { UserRow };
