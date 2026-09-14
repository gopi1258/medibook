/**
 * Calendar routes — doctor self-service (TRD §7.2, §9). OAuth is simulated: the
 * authorization URL is well-formed but points at a non-existent consent screen,
 * and no provider tokens are ever issued or stored.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ApiError } from '@medibook/core';

import { parseBody, requireSession } from './helpers.ts';
import type { AppServices } from '../server.ts';

const providerSchema = z.enum(['google', 'microsoft']);
const connectSchema = z.object({ provider: providerSchema });
const callbackSchema = z.object({ email: z.string().min(3) });
const syncSchema = z.object({ account_id: z.string().min(1) });

export async function registerCalendarRoutes(app: FastifyInstance, services: AppServices): Promise<void> {
  app.get('/calendar/status', async (request, reply) => {
    const session = requireSession(request, services);
    services.auth.requireDoctor(session);
    return reply.status(200).send(services.doctors.listCalendarAccounts(session.userId));
  });

  app.post('/calendar/connect', async (request, reply) => {
    const session = requireSession(request, services);
    services.auth.requireApprovedDoctor(session);
    const { provider } = parseBody(connectSchema, request.body);
    return reply.status(200).send(services.doctors.connectCalendar(session.userId, provider));
  });

  app.post('/calendar/callback/:provider', async (request, reply) => {
    const session = requireSession(request, services);
    services.auth.requireApprovedDoctor(session);
    const parsed = providerSchema.safeParse((request.params as { provider: string }).provider);
    if (!parsed.success) throw new ApiError('VAL_INVALID', 'Unknown calendar provider.');
    const { email } = parseBody(callbackSchema, request.body);
    return reply.status(200).send(services.doctors.completeCalendarConnect(session.userId, parsed.data, email));
  });

  app.post('/calendar/sync', async (request, reply) => {
    const session = requireSession(request, services);
    services.auth.requireApprovedDoctor(session);
    const { account_id } = parseBody(syncSchema, request.body);
    return reply.status(200).send(services.doctors.syncCalendar(session.userId, account_id));
  });

  app.delete('/calendar/accounts/:accountId', async (request, reply) => {
    const session = requireSession(request, services);
    services.auth.requireApprovedDoctor(session);
    const { accountId } = request.params as { accountId: string };
    services.doctors.disconnectCalendar(session.userId, accountId);
    return reply.status(204).send();
  });
}
