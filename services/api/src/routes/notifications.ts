/**
 * Notification routes — TRD §7.2. Deliveries are recorded rather than sent
 * (there is no provider locally); preference handling is real.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { NotificationPreference } from '@medibook/core';

import { run } from '../db/database.ts';
import { listNotifications, markAllRead, markRead, updatePreferences } from '../services/notifications.ts';
import { parseBody, parseQuery, requireSession } from './helpers.ts';
import type { AppServices } from '../server.ts';

const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().optional(),
  unread_only: z.string().optional(),
});

const preferenceEntrySchema = z.object({
  category: z.string(),
  push: z.boolean(),
  email: z.boolean(),
  sms: z.boolean(),
  critical: z.boolean().optional(),
});
const preferencesPatchSchema = z.object({
  entries: z.array(preferenceEntrySchema).optional(),
  quiet_hours: z.object({ enabled: z.boolean(), start: z.string(), end: z.string() }).optional(),
});

const deviceSchema = z.object({
  token: z.string().min(1),
  platform: z.enum(['ios', 'android', 'web']).optional(),
});

export async function registerNotificationRoutes(app: FastifyInstance, services: AppServices): Promise<void> {
  app.get('/notifications', async (request, reply) => {
    const session = requireSession(request, services);
    const query = parseQuery(listQuerySchema, request.query);
    const result = listNotifications(services.db, session.userId, {
      limit: query.limit,
      unreadOnly: query.unread_only === undefined ? undefined : query.unread_only === 'true',
    });
    return reply.status(200).send({
      items: result.items,
      meta: { next_cursor: null, total: result.unread },
    });
  });

  app.post('/notifications/:id/read', async (request, reply) => {
    const session = requireSession(request, services);
    const { id } = request.params as { id: string };
    markRead(services.db, session.userId, id, services.now());
    return reply.status(204).send();
  });

  app.post('/notifications/read-all', async (request, reply) => {
    const session = requireSession(request, services);
    markAllRead(services.db, session.userId, services.now());
    return reply.status(204).send();
  });

  app.get('/notifications/preferences', async (request, reply) => {
    const session = requireSession(request, services);
    return reply.status(200).send(services.auth.preferences(session.userId));
  });

  app.put('/notifications/preferences', async (request, reply) => {
    const session = requireSession(request, services);
    const patch = parseBody(preferencesPatchSchema, request.body);
    updatePreferences(services.db, session.userId, patch as unknown as Partial<NotificationPreference>);
    return reply.status(200).send(services.auth.preferences(session.userId));
  });

  /** Store-or-ignore a push token. No provider is contacted locally. */
  app.post('/devices', async (request, reply) => {
    const session = requireSession(request, services);
    const { token, platform } = parseBody(deviceSchema, request.body);
    run(
      services.db,
      `INSERT OR REPLACE INTO platform_config (key, value) VALUES (?, ?)`,
      `device:${session.userId}:${token}`,
      JSON.stringify({ platform: platform ?? 'unknown', registered_at: new Date(services.now()).toISOString() }),
    );
    return reply.status(200).send({ ok: true });
  });
}
