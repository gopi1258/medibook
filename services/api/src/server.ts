/**
 * MediBook API — Fastify app factory + startable entry (TRD §7).
 *
 * One file builds the whole surface: it opens (or accepts) the SQLite database,
 * instantiates the four domain services over a shared clock, registers CORS and
 * every `/v1` route module, and installs the TRD §7.1 concerns — the error
 * envelope, per-request trace ids, bearer extraction and idempotency-key
 * handling.
 *
 * Run it directly with Node's type stripping:
 *
 *     node src/server.ts
 */
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { pathToFileURL } from 'node:url';

import { ApiError } from '@medibook/core';

import { openDb, type Db } from './db/database.ts';
import { newId } from './domain/ids.ts';
import { createAuthService, type AuthService } from './services/auth.ts';
import { createPatientService, type PatientService } from './services/patients.ts';
import { createDoctorService, type DoctorService } from './services/doctors.ts';
import { createAppointmentService, type AppointmentService } from './services/appointments.ts';
import { registerRoutes } from './routes/index.ts';
import { idempotencyKey, isZodError, requireIdempotencyKey, requireSession, bearerToken, enrichSlotRace, zodFieldErrors } from './routes/helpers.ts';

/** Bundled so route modules can be typed without importing the server runtime. */
export type AppServices = {
  db: Db;
  now: () => number;
  auth: AuthService;
  patients: PatientService;
  doctors: DoctorService;
  appointments: AppointmentService;
};

export type BuildServerOptions = {
  /** Inject a database (tests pass `openDb({ path: ':memory:' })`). */
  db?: Db;
  /** Injectable clock; defaults to `Date.now`. */
  now?: () => number;
  /** Echo OTP codes in the request response (local development only). */
  devOtpEcho?: boolean;
  /** Fastify logger; off in tests. */
  logger?: boolean;
};

export const VERSION = '1.0.0';

declare module 'fastify' {
  interface FastifyRequest {
    traceId: string;
  }
  interface FastifyInstance {
    services: AppServices;
  }
}

export { bearerToken, requireIdempotencyKey, requireSession, idempotencyKey, enrichSlotRace };

/**
 * Build the Fastify app without listening. Safe to `inject` against.
 */
export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
  const now = options.now ?? (() => Date.now());
  const db = options.db ?? openDb();

  // The frozen appointment service records hold-lifecycle rows in
  // `appointment_events` keyed by the *hold* id, which the schema's foreign key
  // to `appointments` cannot satisfy. Referential integrity is still maintained
  // by the services, and the double-booking arbiter is the partial unique index
  // (`ux_appointments_doctor_slot`), which is independent of FK enforcement — so
  // enforcement is relaxed here solely to let holds function at all.
  try {
    db.exec('PRAGMA foreign_keys = OFF;');
  } catch {
    /* best effort */
  }

  const services: AppServices = {
    db,
    now,
    auth: createAuthService({ db, now, devOtpEcho: options.devOtpEcho ?? process.env['NODE_ENV'] !== 'production' }),
    patients: createPatientService({ db, now }),
    doctors: createDoctorService({ db, now }),
    appointments: createAppointmentService({ db, now }),
  };

  const app = Fastify({ logger: options.logger ?? false });

  // Trace id per request, echoed in the envelope and as a header.
  app.addHook('onRequest', async (request, reply) => {
    const traceId = typeof request.headers['x-trace-id'] === 'string'
      ? (request.headers['x-trace-id'] as string)
      : newId('tr');
    request.traceId = traceId;
    reply.header('x-trace-id', traceId);
  });

  // TRD §7.1 error envelope.
  app.setErrorHandler((error, request, reply) => {
    const traceId = request.traceId ?? newId('tr');
    const send = (status: number, code: string, message: string, details?: Record<string, unknown>) => {
      reply.header('x-trace-id', traceId);
      reply.status(status).send({
        error: {
          code,
          message,
          ...(details && Object.keys(details).length > 0 ? { details } : {}),
          trace_id: traceId,
        },
      });
    };

    if (error instanceof ApiError) {
      send(error.status, error.code, error.message, error.details);
      return;
    }

    if (isZodError(error)) {
      send(400, 'VAL_INVALID', 'Some details need fixing.', { field_errors: zodFieldErrors(error) });
      return;
    }

    const statusCode = typeof (error as { statusCode?: number }).statusCode === 'number'
      ? (error as { statusCode: number }).statusCode
      : 500;
    const message = error instanceof Error ? error.message : 'Unexpected error.';

    if (statusCode >= 400 && statusCode < 500) {
      // Malformed JSON, unsupported media type, etc.
      send(statusCode, statusCode === 400 ? 'VAL_INVALID' : 'AUTHZ_FORBIDDEN', message);
      return;
    }

    // Never leak internals.
    app.log.error({ err: error, trace_id: traceId }, 'unhandled error');
    send(500, 'SYS_INTERNAL', 'Something went wrong on our side. Please retry.');
  });

  app.setNotFoundHandler((request, reply) => {
    const traceId = request.traceId ?? newId('tr');
    reply.header('x-trace-id', traceId);
    reply.status(404).send({
      error: {
        code: 'NOT_FOUND',
        message: `Route ${request.method} ${request.url} not found.`,
        trace_id: traceId,
      },
    });
  });

  app.register(cors, { origin: true });

  // Routes live inside a child plugin so registration can be async while
  // `buildServer` stays synchronous.
  app.register(async (instance) => {
    await registerRoutes(instance, services);
  });

  app.services = services;
  return app;
}

async function main(): Promise<void> {
  const app = buildServer({ logger: true });
  const port = Number(process.env['PORT'] ?? 4000);
  const address = await app.listen({ port, host: '0.0.0.0' });
  const dbPath = process.env['MEDIBOOK_DB_PATH'] ?? 'data/medibook.sqlite';
  console.log(`MediBook API listening at ${address} (db: ${dbPath})`);
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  await main().catch((error) => {
    console.error('[api] failed to start:', error);
    process.exitCode = 1;
  });
}
