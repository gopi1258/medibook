/**
 * Admin routes — TRD §7.2 `/admin/*`. Admin auth is out of scope for the mobile
 * deliverable, so these are gated behind a simple `X-Admin-Role` header (default
 * deny). Every write is recorded in `audit_log`.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ApiError, cancellationPolicy, defaultPlatformConfig } from '@medibook/core';

import { all, one, run } from '../db/database.ts';
import { APPOINTMENT_SELECT, mapAppointment, mapSpecialization, type AppointmentRow } from '../db/mappers.ts';
import { newId } from '../domain/ids.ts';
import { parseBody, parseQuery } from './helpers.ts';
import type { AppServices } from '../server.ts';

const decisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  reason: z.string().optional(),
});

const cancelSchema = z.object({ reason: z.string().min(1) });

const reasonSchema = z.object({ reason: z.string().optional() });

const paginationSchema = z.object({
  limit: z.coerce.number().int().positive().optional(),
  status: z.string().optional(),
});

function requireAdmin(request: { headers: Record<string, unknown> }): string {
  const header = request.headers['x-admin-role'];
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ApiError('AUTHZ_FORBIDDEN', 'Admin access required.');
  }
  return value.trim();
}

function audit(
  services: AppServices,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string | null,
  after: Record<string, unknown>,
): void {
  run(
    services.db,
    `INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, after_json, created_at)
     VALUES (?, 'admin', ?, ?, ?, ?, ?, ?)`,
    newId('aud'),
    actorId,
    action,
    entityType,
    entityId,
    JSON.stringify(after),
    new Date(services.now()).toISOString().replace(/\.\d{3}Z$/, 'Z'),
  );
}

export async function registerAdminRoutes(app: FastifyInstance, services: AppServices): Promise<void> {
  /* ---------------------------------------------------------- verification */

  app.get('/admin/verification-queue', async (request, reply) => {
    requireAdmin(request);
    const rows = all<{
      id: string;
      display_name: string;
      verification_status: string;
      registration_number: string;
      submitted_at: string | null;
      email: string | null;
      phone: string | null;
      created_at: string;
    }>(
      services.db,
      `SELECT d.id, d.display_name, d.verification_status, d.registration_number,
              v.submitted_at, u.email, u.phone, d.created_at
         FROM doctors d
         JOIN users u ON u.id = d.id
         LEFT JOIN verification_submissions v ON v.doctor_id = d.id
        WHERE d.verification_status IN ('pending','under_review','rejected')
        ORDER BY COALESCE(v.submitted_at, d.created_at)`,
    );
    return reply.status(200).send(
      rows.map((row) => ({
        doctor_id: row.id,
        display_name: row.display_name,
        status: row.verification_status,
        registration_number: row.registration_number,
        submitted_at: row.submitted_at,
        email: row.email,
        phone: row.phone,
        created_at: row.created_at,
      })),
    );
  });

  app.post('/admin/doctors/:id/verify', async (request, reply) => {
    const actor = requireAdmin(request);
    const { id } = request.params as { id: string };
    const { decision, reason } = parseBody(decisionSchema, request.body);
    const result = services.doctors.decideVerification(id, decision, reason);
    audit(services, actor, `doctor.verification.${decision}`, 'doctor', id, { reason: reason ?? null });
    return reply.status(200).send({ doctor_id: id, status: result.status });
  });

  app.post('/admin/doctors/:id/suspend', async (request, reply) => {
    const actor = requireAdmin(request);
    const { id } = request.params as { id: string };
    parseBody(reasonSchema, request.body ?? {});
    run(services.db, `UPDATE doctors SET verification_status = 'suspended' WHERE id = ?`, id);
    run(services.db, `UPDATE users SET status = 'suspended' WHERE id = ?`, id);
    run(
      services.db,
      `UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`,
      new Date(services.now()).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      id,
    );
    audit(services, actor, 'doctor.suspend', 'doctor', id, {});
    return reply.status(200).send({ doctor_id: id, status: 'suspended' });
  });

  app.post('/admin/doctors/:id/reinstate', async (request, reply) => {
    const actor = requireAdmin(request);
    const { id } = request.params as { id: string };
    run(
      services.db,
      `UPDATE doctors SET verification_status = 'approved', verified_at = ? WHERE id = ? AND verification_status = 'suspended'`,
      new Date(services.now()).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      id,
    );
    run(services.db, `UPDATE users SET status = 'active' WHERE id = ?`, id);
    audit(services, actor, 'doctor.reinstate', 'doctor', id, {});
    return reply.status(200).send({ doctor_id: id, status: 'approved' });
  });

  /* --------------------------------------------------------------- patients */

  app.get('/admin/patients', async (request, reply) => {
    requireAdmin(request);
    const query = parseQuery(paginationSchema, request.query);
    const limit = Math.min(query.limit ?? 50, 200);
    const rows = all<{
      id: string;
      display_name: string;
      phone: string | null;
      email: string | null;
      status: string;
      onboarding_state: string;
      created_at: string;
    }>(
      services.db,
      `SELECT id, display_name, phone, email, status, onboarding_state, created_at
         FROM users WHERE role = 'patient' ORDER BY created_at DESC LIMIT ?`,
      limit,
    );
    return reply.status(200).send(rows);
  });

  app.post('/admin/patients/:id/deactivate', async (request, reply) => {
    const actor = requireAdmin(request);
    const { id } = request.params as { id: string };
    const reason = parseBody(reasonSchema, request.body ?? {}).reason ?? null;
    run(services.db, `UPDATE users SET status = 'suspended' WHERE id = ? AND role = 'patient'`, id);
    run(
      services.db,
      `UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`,
      new Date(services.now()).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      id,
    );
    audit(services, actor, 'patient.deactivate', 'user', id, { reason });
    return reply.status(200).send({ user_id: id, status: 'suspended' });
  });

  /* ----------------------------------------------------------- appointments */

  app.get('/admin/appointments', async (request, reply) => {
    requireAdmin(request);
    const query = parseQuery(paginationSchema, request.query);
    const limit = Math.min(query.limit ?? 50, 200);
    const rows = query.status
      ? all<AppointmentRow>(services.db, `${APPOINTMENT_SELECT} WHERE a.status = ? ORDER BY a.start_utc DESC LIMIT ?`, query.status, limit)
      : all<AppointmentRow>(services.db, `${APPOINTMENT_SELECT} ORDER BY a.start_utc DESC LIMIT ?`, limit);
    return reply.status(200).send({ items: rows.map((row) => mapAppointment(services.db, row)), meta: { next_cursor: null, total: rows.length } });
  });

  app.post('/admin/appointments/:id/cancel', async (request, reply) => {
    const actor = requireAdmin(request);
    const { id } = request.params as { id: string };
    const { reason } = parseBody(cancelSchema, request.body);
    const row = one<AppointmentRow>(services.db, `${APPOINTMENT_SELECT} WHERE a.id = ?`, id);
    if (!row) throw new ApiError('NOT_FOUND', 'Appointment not found.', { details: { id } });

    const nowMs = services.now();
    const nowIso = new Date(nowMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const policy = cancellationPolicy({
      startUtc: row.start_utc,
      nowMs,
      feeMinor: row.fee_minor,
      currency: row.currency,
      actor: 'admin',
    });

    if (row.status !== 'cancelled') {
      run(
        services.db,
        `UPDATE appointments SET status = 'cancelled', cancelled_by = 'admin', cancel_reason = ?, updated_at = ? WHERE id = ?`,
        reason,
        nowIso,
        id,
      );
      const payment = one<{ id: string }>(
        services.db,
        `SELECT id FROM payments WHERE appointment_id = ? ORDER BY created_at DESC LIMIT 1`,
        id,
      );
      if (payment && policy.refund_minor > 0) {
        run(services.db, `UPDATE payments SET status = 'refunded' WHERE id = ?`, payment.id);
        run(
          services.db,
          `INSERT INTO refunds (id, payment_id, amount_minor, currency, reason, tier_percent, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'processing', ?)`,
          newId('ref'),
          payment.id,
          policy.refund_minor,
          policy.currency,
          `admin: ${reason}`,
          policy.refund_percent,
          nowIso,
        );
      }
      run(
        services.db,
        `INSERT INTO appointment_events (id, appointment_id, from_status, to_status, actor_type, actor_id, reason, metadata, created_at)
         VALUES (?, ?, ?, 'cancelled', 'admin', ?, ?, ?, ?)`,
        newId('evt'),
        id,
        row.status,
        actor,
        reason,
        JSON.stringify({ rule: policy.rule }),
        nowIso,
      );
    }

    audit(services, actor, 'appointment.cancel', 'appointment', id, { reason });
    const updated = one<AppointmentRow>(services.db, `${APPOINTMENT_SELECT} WHERE a.id = ?`, id)!;
    const appointment = mapAppointment(services.db, updated);
    return reply.status(200).send({ appointment, refund: appointment.refund, policy });
  });

  /* ---------------------------------------------------------------- refunds */

  app.get('/admin/refunds', async (request, reply) => {
    requireAdmin(request);
    const rows = all<{
      id: string;
      payment_id: string;
      appointment_id: string;
      amount_minor: number;
      currency: string;
      reason: string;
      tier_percent: number;
      status: string;
      created_at: string;
    }>(
      services.db,
      `SELECT r.id, r.payment_id, p.appointment_id, r.amount_minor, r.currency, r.reason, r.tier_percent, r.status, r.created_at
         FROM refunds r JOIN payments p ON p.id = r.payment_id
        ORDER BY r.created_at DESC LIMIT 200`,
    );
    return reply.status(200).send(rows);
  });

  app.post('/admin/refunds/:id/execute', async (request, reply) => {
    const actor = requireAdmin(request);
    const { id } = request.params as { id: string };
    const refund = one<{ id: string; payment_id: string }>(services.db, `SELECT id, payment_id FROM refunds WHERE id = ?`, id);
    if (!refund) throw new ApiError('NOT_FOUND', 'Refund not found.', { details: { id } });
    run(services.db, `UPDATE refunds SET status = 'completed' WHERE id = ?`, id);
    run(services.db, `UPDATE payments SET status = 'refunded' WHERE id = ?`, refund.payment_id);
    audit(services, actor, 'refund.execute', 'refund', id, {});
    return reply.status(200).send({ id, status: 'completed' });
  });

  /* --------------------------------------------------------- catalogue/config */

  app.get('/admin/specializations', async (request, reply) => {
    requireAdmin(request);
    const rows = all<{ id: string; name: string; slug: string; icon: string; is_active: number; doctor_count?: number }>(
      services.db,
      `SELECT id, name, slug, icon, is_active,
              (SELECT COUNT(*) FROM doctor_specializations ds WHERE ds.specialization_id = s.id) AS doctor_count
         FROM specializations s ORDER BY name`,
    );
    return reply.status(200).send(rows.map(mapSpecialization));
  });

  app.get('/admin/reports/summary', async (request, reply) => {
    requireAdmin(request);
    const appointments = one<{ total: number; confirmed: number; cancelled: number; completed: number }>(
      services.db,
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed,
              SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
              SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed
         FROM appointments`,
    );
    const doctors = one<{ count: number }>(services.db, `SELECT COUNT(*) AS count FROM doctors WHERE verification_status = 'approved'`);
    const patients = one<{ count: number }>(services.db, `SELECT COUNT(*) AS count FROM users WHERE role = 'patient'`);
    const revenue = one<{ minor: number }>(
      services.db,
      `SELECT COALESCE(SUM(amount_minor), 0) AS minor FROM payments WHERE status IN ('captured','refunded')`,
    );
    const refunded = one<{ minor: number }>(
      services.db,
      `SELECT COALESCE(SUM(amount_minor), 0) AS minor FROM refunds WHERE status IN ('processing','completed')`,
    );
    return reply.status(200).send({
      appointments: appointments ?? { total: 0, confirmed: 0, cancelled: 0, completed: 0 },
      doctors_approved: doctors?.count ?? 0,
      patients: patients?.count ?? 0,
      gross_revenue_minor: revenue?.minor ?? 0,
      refunded_minor: refunded?.minor ?? 0,
      currency: 'INR',
    });
  });

  app.get('/admin/audit-logs', async (request, reply) => {
    requireAdmin(request);
    const query = parseQuery(paginationSchema, request.query);
    const limit = Math.min(query.limit ?? 100, 500);
    const rows = all<{
      id: string;
      actor_type: string;
      actor_id: string | null;
      action: string;
      entity_type: string;
      entity_id: string | null;
      before_json: string | null;
      after_json: string | null;
      created_at: string;
    }>(services.db, `SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?`, limit);
    return reply.status(200).send(rows);
  });

  app.get('/admin/config', async (request, reply) => {
    requireAdmin(request);
    return reply.status(200).send(readConfig(services));
  });

  app.put('/admin/config', async (request, reply) => {
    const actor = requireAdmin(request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    for (const [key, value] of Object.entries(body)) {
      if (key.startsWith('device:') || key.startsWith('webhook:')) continue;
      run(services.db, `INSERT OR REPLACE INTO platform_config (key, value) VALUES (?, ?)`, key, JSON.stringify(value));
    }
    audit(services, actor, 'config.update', 'platform_config', null, body);
    return reply.status(200).send(readConfig(services));
  });
}

function readConfig(services: AppServices): Record<string, unknown> {
  const rows = all<{ key: string; value: string }>(
    services.db,
    `SELECT key, value FROM platform_config WHERE key NOT LIKE 'device:%' AND key NOT LIKE 'webhook:%'`,
  );
  const overrides: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      overrides[row.key] = JSON.parse(row.value) as unknown;
    } catch {
      overrides[row.key] = row.value;
    }
  }
  return { ...defaultPlatformConfig, ...overrides };
}
