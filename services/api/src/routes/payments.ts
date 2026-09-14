/**
 * Payment routes — TRD §7.2. Local build: the appointment row is created before
 * capture (TRD §10.6), so `POST /payments/intent/{id}` records the chosen method
 * against the payment already captured at booking time. No PANs ever touch the
 * server; the provider webhook is acknowledged idempotently.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ApiError } from '@medibook/core';

import { one, run } from '../db/database.ts';
import { parseBody, requireSession } from './helpers.ts';
import type { AppServices } from '../server.ts';

const intentSchema = z.object({
  method: z.enum(['card', 'upi', 'netbanking', 'wallet', 'free']),
});

export async function registerPaymentRoutes(app: FastifyInstance, services: AppServices): Promise<void> {
  app.post('/payments/intent/:appointmentId', async (request, reply) => {
    const session = requireSession(request, services);
    const { appointmentId } = request.params as { appointmentId: string };
    const { method } = parseBody(intentSchema, request.body);
    const payment = services.appointments.capturePayment(session, appointmentId, method);
    if (!payment) {
      throw new ApiError('NOT_FOUND', 'No payment is due for this appointment.', {
        details: { appointment_id: appointmentId },
      });
    }
    return reply.status(200).send({
      id: payment.id,
      appointment_id: payment.appointment_id,
      method: payment.method,
      amount_minor: payment.amount_minor,
      currency: payment.currency,
      status: payment.status,
      provider_ref: payment.provider_ref,
      receipt_url: payment.receipt_url,
      created_at: payment.created_at,
    });
  });

  app.get('/payments/:id/receipt', async (request, reply) => {
    const session = requireSession(request, services);
    const { id } = request.params as { id: string };
    const payment = one<{
      id: string;
      appointment_id: string;
      method: string;
      amount_minor: number;
      currency: string;
      status: string;
      provider_ref: string;
      receipt_url: string | null;
      created_at: string;
    }>(services.db, `SELECT * FROM payments WHERE id = ?`, id);
    if (!payment) throw new ApiError('NOT_FOUND', 'Payment not found.', { details: { id } });

    const appointment = one<{ id: string; code: string; patient_user_id: string; doctor_id: string }>(
      services.db,
      `SELECT id, code, patient_user_id, doctor_id FROM appointments WHERE id = ?`,
      payment.appointment_id,
    );
    const isParticipant =
      appointment &&
      (appointment.patient_user_id === session.userId || appointment.doctor_id === session.userId);
    if (!isParticipant) {
      throw new ApiError('AUTHZ_FORBIDDEN', 'You do not have access to this receipt.');
    }

    return reply.status(200).send({
      id: payment.id,
      appointment_id: payment.appointment_id,
      appointment_code: appointment?.code ?? null,
      method: payment.method,
      amount_minor: payment.amount_minor,
      currency: payment.currency,
      status: payment.status,
      provider_ref: payment.provider_ref,
      receipt_url: payment.receipt_url ?? `medibook://receipt/${payment.appointment_id}`,
      issued_at: payment.created_at,
    });
  });

  /** Anon, provider-signed in production. Deduped by event id, then acknowledged. */
  app.post('/payments/webhook/:provider', async (request, reply) => {
    const { provider } = request.params as { provider: string };
    const body = (request.body ?? {}) as { event_id?: string; id?: string; type?: string };
    const eventId = body.event_id ?? body.id;
    let duplicate = false;
    if (eventId) {
      const key = `webhook:${provider}:${eventId}`;
      const existing = one<{ key: string }>(services.db, `SELECT key FROM platform_config WHERE key = ?`, key);
      duplicate = Boolean(existing);
      if (!duplicate) {
        run(
          services.db,
          `INSERT OR REPLACE INTO platform_config (key, value) VALUES (?, ?)`,
          key,
          JSON.stringify({ type: body.type ?? 'unknown', received_at: new Date(services.now()).toISOString() }),
        );
      }
    }
    return reply.status(200).send({ received: true, provider, duplicate });
  });
}
