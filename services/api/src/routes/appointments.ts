/**
 * Appointment routes — the concurrency-critical surface (TRD §7.2, §10).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { AppointmentListQuery, CancelRequest } from '@medibook/core';

import {
  enrichSlotRace,
  parseBody,
  parseQuery,
  requireIdempotencyKey,
  requireSession,
} from './helpers.ts';
import type { AppServices } from '../server.ts';

const consultTypeSchema = z.enum(['in_person', 'video']);
const paymentMethodSchema = z.enum(['card', 'upi', 'netbanking', 'wallet', 'free']);

const holdSchema = z.object({
  doctor_id: z.string().min(1),
  consult_type: consultTypeSchema,
  start_utc: z.string().min(1),
});

const createAppointmentSchema = z.object({
  hold_id: z.string().nullable().optional(),
  doctor_id: z.string().min(1),
  consult_type: consultTypeSchema,
  start_utc: z.string().min(1),
  dependent_id: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  payment: z.object({ method: paymentMethodSchema }).nullable().optional(),
});

const rescheduleSchema = z.object({ start_utc: z.string().min(1) });

const cancelSchema = z.object({ reason: z.string().min(1), note: z.string().nullable().optional() });

const declineSchema = z.object({ reason: z.string().optional() });

const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().nullable().optional(),
});

const listQuerySchema = z.object({
  scope: z.enum(['upcoming', 'past', 'all', 'today', 'pending']).optional(),
  member: z.string().optional(),
  doctor_id: z.string().optional(),
  status: z
    .enum(['held', 'pending_approval', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show', 'rescheduled'])
    .optional(),
  limit: z.coerce.number().int().positive().optional(),
  cursor: z.string().optional(),
});

export async function registerAppointmentRoutes(app: FastifyInstance, services: AppServices): Promise<void> {
  /* ---------------------------------------------------------------- holds */

  app.post('/appointments/holds', async (request, reply) => {
    const session = requireSession(request, services);
    const input = parseBody(holdSchema, request.body);
    return reply.status(201).send(services.appointments.createHold(session, input));
  });

  app.delete('/appointments/holds/:holdId', async (request, reply) => {
    const session = requireSession(request, services);
    const { holdId } = request.params as { holdId: string };
    services.appointments.releaseHold(session, holdId);
    return reply.status(204).send();
  });

  /* -------------------------------------------------------------- booking */

  app.post('/appointments', async (request, reply) => {
    const session = requireSession(request, services);
    const input = parseBody(createAppointmentSchema, request.body);
    const key = requireIdempotencyKey(request);
    try {
      const appointment = await services.appointments.createAppointment(session, input, key);
      return reply.status(201).send({ appointment });
    } catch (error) {
      throw enrichSlotRace(error, services, {
        doctorId: input.doctor_id,
        consultType: input.consult_type,
        startUtc: input.start_utc,
      });
    }
  });

  app.get('/appointments', async (request, reply) => {
    const session = requireSession(request, services);
    const query = parseQuery(listQuerySchema, request.query) as AppointmentListQuery;
    return reply.status(200).send(services.appointments.list(session, query));
  });

  app.get('/appointments/:id', async (request, reply) => {
    const session = requireSession(request, services);
    const { id } = request.params as { id: string };
    return reply.status(200).send(services.appointments.get(session, id));
  });

  app.patch('/appointments/:id', async (request, reply) => {
    const session = requireSession(request, services);
    const { id } = request.params as { id: string };
    const { start_utc } = parseBody(rescheduleSchema, request.body);
    const key = requireIdempotencyKey(request);
    const existing = services.appointments.get(session, id);
    try {
      const appointment = services.appointments.reschedule(session, id, start_utc, key);
      return reply.status(200).send({ appointment });
    } catch (error) {
      throw enrichSlotRace(error, services, {
        doctorId: existing.doctor_id,
        consultType: existing.consult_type,
        startUtc: start_utc,
      });
    }
  });

  app.delete('/appointments/:id', async (request, reply) => {
    const session = requireSession(request, services);
    const { id } = request.params as { id: string };
    const input = parseBody(cancelSchema, request.body) as CancelRequest;
    const key = requireIdempotencyKey(request);
    // Returns the full CancelResult ({ appointment, refund, policy }) — the client
    // reads exactly this shape.
    return reply.status(200).send(services.appointments.cancel(session, id, input, key));
  });

  /* ------------------------------------------------------------- policies */

  app.get('/appointments/:id/reschedule-policy', async (request, reply) => {
    const session = requireSession(request, services);
    const { id } = request.params as { id: string };
    return reply.status(200).send(services.appointments.reschedulePolicyPreview(session, id));
  });

  app.get('/appointments/:id/cancellation-policy', async (request, reply) => {
    const session = requireSession(request, services);
    const { id } = request.params as { id: string };
    return reply.status(200).send(services.appointments.cancellationPolicyPreview(session, id));
  });

  /* -------------------------------------------------------- doctor actions */

  app.post('/appointments/:id/accept', async (request, reply) => {
    const session = requireSession(request, services);
    const { id } = request.params as { id: string };
    return reply.status(200).send({ appointment: services.appointments.accept(session, id) });
  });

  app.post('/appointments/:id/decline', async (request, reply) => {
    const session = requireSession(request, services);
    const { id } = request.params as { id: string };
    const { reason } = parseBody(declineSchema, request.body ?? {});
    return reply
      .status(200)
      .send({ appointment: services.appointments.decline(session, id, reason ?? 'Doctor declined the request') });
  });

  app.post('/appointments/:id/complete', async (request, reply) => {
    const session = requireSession(request, services);
    const { id } = request.params as { id: string };
    return reply.status(200).send({ appointment: services.appointments.complete(session, id) });
  });

  app.post('/appointments/:id/no-show', async (request, reply) => {
    const session = requireSession(request, services);
    const { id } = request.params as { id: string };
    return reply.status(200).send({ appointment: services.appointments.markNoShow(session, id) });
  });

  /** Participant action; window-gated, mints a simulated room token. */
  app.post('/appointments/:id/join-token', async (request, reply) => {
    const session = requireSession(request, services);
    const { id } = request.params as { id: string };
    const result = services.appointments.startConsult(session, id);
    return reply.status(200).send({ room_token: result.room_token, status: result.appointment.status, appointment: result.appointment });
  });

  /* ---------------------------------------------------------------- review */

  app.post('/appointments/:id/review', async (request, reply) => {
    const session = requireSession(request, services);
    const { id } = request.params as { id: string };
    const input = parseBody(reviewSchema, request.body) as { rating: 1 | 2 | 3 | 4 | 5; comment?: string | null };
    return reply.status(201).send(services.appointments.submitReview(session, id, input));
  });

  /* -------------------------------------------------------- doctor context */

  app.get('/appointments/:id/patient-context', async (request, reply) => {
    const session = requireSession(request, services);
    services.auth.requireDoctor(session);
    const { id } = request.params as { id: string };
    return reply.status(200).send(services.doctors.patientContext(session.userId, id));
  });
}
