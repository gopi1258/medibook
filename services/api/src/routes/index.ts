/**
 * Route registration — mounts every module under `/v1` and exposes the health
 * probe used by the apps and the load-test harness.
 */
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { toIso } from '@medibook/core';

import type { AppServices } from '../server.ts';
import { registerAuthRoutes } from './auth.ts';
import { registerPatientRoutes } from './patients.ts';
import { registerDoctorRoutes } from './doctors.ts';
import { registerAppointmentRoutes } from './appointments.ts';
import { registerPaymentRoutes } from './payments.ts';
import { registerCalendarRoutes } from './calendar.ts';
import { registerNotificationRoutes } from './notifications.ts';
import { registerAdminRoutes } from './admin.ts';

function apiVersion(): string {
  try {
    const raw = readFileSync(new URL('../../package.json', import.meta.url), 'utf8');
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? '1.0.0';
  } catch {
    return '1.0.0';
  }
}

export async function registerRoutes(app: FastifyInstance, services: AppServices): Promise<void> {
  const version = apiVersion();

  app.get('/v1/health', async (_request, reply) => {
    return reply.status(200).send({
      status: 'ok' as const,
      version,
      time: toIso(services.now()),
      database: 'sqlite',
    });
  });

  await app.register(async (instance) => registerAuthRoutes(instance, services), { prefix: '/v1' });
  await app.register(async (instance) => registerPatientRoutes(instance, services), { prefix: '/v1' });
  await app.register(async (instance) => registerDoctorRoutes(instance, services), { prefix: '/v1' });
  await app.register(async (instance) => registerCalendarRoutes(instance, services), { prefix: '/v1' });
  await app.register(async (instance) => registerAppointmentRoutes(instance, services), { prefix: '/v1' });
  await app.register(async (instance) => registerPaymentRoutes(instance, services), { prefix: '/v1' });
  await app.register(async (instance) => registerNotificationRoutes(instance, services), { prefix: '/v1' });
  await app.register(async (instance) => registerAdminRoutes(instance, services), { prefix: '/v1' });
}
