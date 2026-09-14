/**
 * Shared route helpers: bearer extraction, idempotency-key handling, zod parsing
 * and the PRD EC-04 alternatives enrichment.
 *
 * Kept out of `server.ts` so route modules do not import the server (which would
 * create an import cycle); `server.ts` re-exports these for convenience.
 */
import { ApiError, addDaysToDate, dateInZone, nearestAlternatives } from '@medibook/core';
import type { ConsultType } from '@medibook/core';
import type { FastifyRequest } from 'fastify';
import { ZodError, type ZodType } from 'zod';

import type { AppServices } from '../server.ts';
import type { Session } from '../services/auth.ts';

/** `Authorization: Bearer <jwt>` → the raw token, if present. */
export function bearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers['authorization'];
  if (typeof header !== 'string') return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || undefined;
}

/** Resolve the bearer token to a session, throwing TRD §7 auth errors. */
export function requireSession(request: FastifyRequest, services: AppServices): Session {
  return services.auth.authenticate(bearerToken(request));
}

/**
 * Resolve a session when a bearer is present, but treat anon/malformed tokens as
 * anonymous — used by endpoints that are public but enrich for signed-in users.
 */
export function optionalSession(request: FastifyRequest, services: AppServices): Session | undefined {
  const token = bearerToken(request);
  if (!token) return undefined;
  try {
    return services.auth.authenticate(token);
  } catch {
    return undefined;
  }
}

/** Read an `Idempotency-Key` header (TRD §7.1). */
export function idempotencyKey(request: FastifyRequest): string | undefined {
  const value = request.headers['idempotency-key'];
  const key = Array.isArray(value) ? value[0] : value;
  return typeof key === 'string' && key.length > 0 ? key : undefined;
}

/** Require an `Idempotency-Key` header, answering `400 VAL_INVALID` when absent. */
export function requireIdempotencyKey(request: FastifyRequest): string {
  const key = idempotencyKey(request);
  if (!key || key.length < 8) {
    throw new ApiError('VAL_INVALID', 'An Idempotency-Key header is required for this request.', {
      details: { header: 'Idempotency-Key' },
    });
  }
  return key;
}

/** Parse a body against a zod schema, surfacing a `ZodError` for the handler. */
export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body ?? {});
  if (!result.success) throw result.error;
  return result.data;
}

/** Parse query params (always strings) against a zod schema. */
export function parseQuery<T>(schema: ZodType<T>, query: unknown): T {
  const result = schema.safeParse(query ?? {});
  if (!result.success) throw result.error;
  return result.data;
}

/** Flatten a zod error into `details.field_errors`. */
export function zodFieldErrors(error: ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.length > 0 ? issue.path.map(String).join('.') : '_';
    if (!(path in fieldErrors)) fieldErrors[path] = issue.message;
  }
  return fieldErrors;
}

export function isZodError(error: unknown): error is ZodError {
  return (
    error instanceof ZodError ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { name?: string }).name === 'ZodError' &&
      Array.isArray((error as { issues?: unknown }).issues))
  );
}

/**
 * PRD EC-04: a losing racer must always receive the nearest alternatives. The
 * service attaches them where it can; when the error carries none (e.g. a bare
 * write-time re-check), recompute them from the slot engine here.
 */
export function enrichSlotRace(
  error: unknown,
  services: AppServices,
  context: { doctorId: string; consultType: ConsultType; startUtc: string },
): unknown {
  if (!(error instanceof ApiError)) return error;
  if (error.code !== 'APT_SLOT_TAKEN' && error.code !== 'CAL_SLOT_CONFLICT') return error;

  const existing = error.details['alternatives'];
  if (Array.isArray(existing) && existing.length > 0) return error;

  let alternatives: string[] = [];
  try {
    const doctor = services.doctors.allDoctorRows().find((row) => row.id === context.doctorId);
    const timezone = doctor?.clinic_timezone ?? 'UTC';
    const from = dateInZone(services.now(), timezone);
    const to = addDaysToDate(from, 20);
    const own = services.appointments.ownAvailability(context.doctorId, {
      from,
      to,
      type: context.consultType,
    });
    alternatives = nearestAlternatives(own.result, context.startUtc, 3);
  } catch {
    alternatives = [];
  }

  return new ApiError(error.code, error.message, {
    status: error.status,
    details: {
      ...error.details,
      alternatives,
      doctor_id: context.doctorId,
      start_utc: context.startUtc,
    },
  });
}
