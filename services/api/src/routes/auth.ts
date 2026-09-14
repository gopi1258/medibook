/**
 * Auth routes — TRD §7.2 / §7.3.1–7.3.2, §8.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { bearerToken, parseBody, requireSession } from './helpers.ts';
import type { AppServices } from '../server.ts';

const otpRequestSchema = z.object({
  channel: z.enum(['phone', 'email']),
  destination: z.string().min(3),
  purpose: z.enum(['login', 'register']),
  role: z.enum(['patient', 'doctor', 'admin']).optional(),
});

const otpVerifySchema = z.object({
  channel: z.enum(['phone', 'email']),
  destination: z.string().min(3),
  code: z.string().min(1),
  role: z.enum(['patient', 'doctor', 'admin']),
  register: z.boolean().optional(),
  profile_draft: z
    .object({
      display_name: z.string().optional(),
      gender: z.enum(['female', 'male', 'other', 'undisclosed']).optional(),
      dob: z.string().optional(),
    })
    .optional(),
});

const refreshSchema = z.object({ refresh_token: z.string().min(1) });

export async function registerAuthRoutes(app: FastifyInstance, services: AppServices): Promise<void> {
  /** Anon. The core client treats this as `void`; the apps read the dev code defensively. */
  app.post('/auth/otp/request', async (request, reply) => {
    const input = parseBody(otpRequestSchema, request.body);
    const result = services.auth.requestOtp(input);
    return reply.status(200).send({
      expires_in_seconds: result.expiresInSeconds,
      resend_after_seconds: result.resendAfterSeconds,
      ...(result.devCode ? { dev_code: result.devCode } : {}),
    });
  });

  app.post('/auth/otp/verify', async (request, reply) => {
    const body = parseBody(otpVerifySchema, request.body);
    const session = services.auth.verifyOtp({
      channel: body.channel,
      destination: body.destination,
      code: body.code,
      role: body.role,
      register: body.register,
      profileDraft: body.profile_draft
        ? { display_name: body.profile_draft.display_name, gender: body.profile_draft.gender, dob: body.profile_draft.dob }
        : undefined,
    });
    return reply.status(201).send(session);
  });

  app.post('/auth/refresh', async (request, reply) => {
    const body = parseBody(refreshSchema, request.body);
    return reply.status(200).send(services.auth.refresh(body.refresh_token));
  });

  app.post('/auth/logout', async (request, reply) => {
    const session = requireSession(request, services);
    services.auth.logout(bearerToken(request) ?? null, session.userId);
    return reply.status(204).send();
  });

  app.get('/auth/me', async (request, reply) => {
    const session = requireSession(request, services);
    return reply.status(200).send(services.auth.me(session.userId));
  });
}
