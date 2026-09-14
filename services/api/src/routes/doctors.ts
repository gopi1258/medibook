/**
 * Doctor routes — public discovery (TRD §7.3.3) and doctor self-management
 * (TRD §7.2, §8.3). Unverified doctors are never discoverable; a direct
 * `GET /doctors/{id}` for one answers `404`.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  addDaysToDate,
  dateInZone,
  isoDuration,
  toIso,
  type DoctorProfile,
  type DoctorQuery,
} from '@medibook/core';

import { one, run } from '../db/database.ts';
import { newId } from '../domain/ids.ts';
import { loadCalendarSync, toAvailabilityResponse } from '../domain/slotEngine.ts';
import { optionalSession, parseBody, parseQuery, requireSession } from './helpers.ts';
import type { AppServices } from '../server.ts';
import type { Session } from '../services/auth.ts';

const genderSchema = z.enum(['female', 'male', 'other', 'undisclosed']);
const consultTypeSchema = z.enum(['in_person', 'video']);

const doctorQuerySchema = z.object({
  q: z.string().optional(),
  specialization: z.string().optional(),
  consult_type: consultTypeSchema.optional(),
  available: z.string().optional(),
  fee_min_minor: z.coerce.number().int().optional(),
  fee_max_minor: z.coerce.number().int().optional(),
  language: z.string().optional(),
  gender: genderSchema.optional(),
  sort: z
    .enum(['relevance', 'rating', 'fee_asc', 'fee_desc', 'experience', 'next_available'])
    .optional(),
  limit: z.coerce.number().int().positive().optional(),
  cursor: z.string().optional(),
});

const availabilityQuerySchema = z.object({
  tz: z.string().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.').optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.').optional(),
  type: consultTypeSchema.optional(),
});

const policySchema = z.object({
  min_notice_minutes: z.number().int().optional(),
  booking_window_days: z.number().int().optional(),
  reschedule_min_hours: z.number().int().optional(),
  max_reschedules: z.number().int().optional(),
  approval_mode: z.enum(['auto', 'manual']).optional(),
  approval_auto_decline_minutes: z.number().int().optional(),
  no_show_grace_minutes_video: z.number().int().optional(),
  no_show_grace_minutes_clinic: z.number().int().optional(),
  buffer_minutes: z.number().int().optional(),
});

const consultationConfigSchema = z.object({
  fees: z.array(
    z.object({
      consult_type: consultTypeSchema,
      enabled: z.boolean(),
      duration_minutes: z.number().int(),
      fee_minor: z.number().int(),
      currency: z.string(),
    }),
  ),
});

const profilePatchSchema = z.object({
  display_name: z.string().min(1).optional(),
  bio: z.string().optional(),
  gender: genderSchema.optional(),
  experience_years: z.number().int().optional(),
  languages: z.array(z.string()).optional(),
  qualifications: z
    .array(z.object({ degree: z.string(), institution: z.string(), year: z.number().int() }))
    .optional(),
  specialization_slugs: z.array(z.string()).optional(),
  clinic_name: z.string().optional(),
  clinic_address: z.string().optional(),
  clinic_timezone: z.string().optional(),
  consultation_config: consultationConfigSchema.optional(),
  policy: policySchema.optional(),
  deactivation_requested_at: z.string().nullable().optional(),
});

const verificationSchema = z.object({
  registration_number: z.string().min(1),
  council: z.string().min(1),
  country: z.string().min(1),
  specialization_slugs: z.array(z.string()),
  documents: z.array(
    z.object({ kind: z.enum(['license', 'government_id', 'degree']), filename: z.string().min(1) }),
  ),
});

const ruleSchema = z.object({
  id: z.string().optional(),
  weekday: z.number().int().min(0).max(6),
  start_local_time: z.string().regex(/^\d{2}:\d{2}$/),
  end_local_time: z.string().regex(/^\d{2}:\d{2}$/),
  slot_minutes: z.number().int().positive(),
  buffer_minutes: z.number().int().min(0).max(30),
  consult_types: z.array(consultTypeSchema).min(1),
  effective_from: z.string(),
});

const exceptionSchema = z.object({
  start_utc: z.string().min(1),
  end_utc: z.string().min(1),
  kind: z.enum(['leave', 'block']),
  reason: z.string(),
});

const deactivationSchema = z.object({ reason: z.string().min(1) });

function requireDoctor(session: Session, services: AppServices): void {
  services.auth.requireDoctor(session);
}

function requireApprovedDoctor(session: Session, services: AppServices): void {
  services.auth.requireApprovedDoctor(session);
}

export async function registerDoctorRoutes(app: FastifyInstance, services: AppServices): Promise<void> {
  /* ------------------------------------------------------- public discovery */

  app.get('/specializations', async (_request, reply) => {
    return reply.status(200).send(services.doctors.listSpecializations());
  });

  app.get('/doctors', async (request, reply) => {
    const query = parseQuery(doctorQuerySchema, request.query) as DoctorQuery;
    const session = optionalSession(request, services);
    const viewerTimezone = session ? services.patients.timeZone(session.userId) : 'UTC';
    return reply.status(200).send(services.doctors.listDoctors(query, viewerTimezone));
  });

  app.get('/doctors/:doctorId', async (request, reply) => {
    const { doctorId } = request.params as { doctorId: string };
    const session = optionalSession(request, services);
    const viewerTimezone = session ? services.patients.timeZone(session.userId) : 'UTC';
    return reply.status(200).send(services.doctors.getDoctor(doctorId, viewerTimezone));
  });

  app.get('/doctors/:doctorId/availability', async (request, reply) => {
    const { doctorId } = request.params as { doctorId: string };
    const query = parseQuery(availabilityQuerySchema, request.query);
    const session = optionalSession(request, services);
    return reply.status(200).send(
      services.doctors.getAvailability(doctorId, query, {
        requesterId: session?.userId,
        mineUserId: session?.role === 'patient' ? session.userId : undefined,
      }),
    );
  });

  /* ------------------------------------------------------ doctor self block */

  app.get('/doctor/me/profile', async (request, reply) => {
    const session = requireSession(request, services);
    requireDoctor(session, services);
    return reply.status(200).send(services.doctors.profile(session.userId));
  });

  app.patch('/doctor/me/profile', async (request, reply) => {
    const session = requireSession(request, services);
    requireApprovedDoctor(session, services);
    const patch = parseBody(profilePatchSchema, request.body);
    return reply
      .status(200)
      .send(services.doctors.updateProfile(session.userId, patch as unknown as Partial<DoctorProfile>));
  });

  app.get('/doctor/me/verification', async (request, reply) => {
    const session = requireSession(request, services);
    requireDoctor(session, services);
    return reply.status(200).send(services.doctors.verification(session.userId));
  });

  app.put('/doctor/me/verification', async (request, reply) => {
    const session = requireSession(request, services);
    requireDoctor(session, services);
    const input = parseBody(verificationSchema, request.body);
    return reply.status(200).send(services.doctors.submitVerification(session.userId, input));
  });

  app.get('/doctor/me/consultation-config', async (request, reply) => {
    const session = requireSession(request, services);
    requireDoctor(session, services);
    return reply.status(200).send(services.doctors.profile(session.userId).consultation_config);
  });

  app.put('/doctor/me/consultation-config', async (request, reply) => {
    const session = requireSession(request, services);
    requireDoctor(session, services);
    const config = parseBody(consultationConfigSchema, request.body);
    return reply.status(200).send(services.doctors.updateConsultationConfig(session.userId, config));
  });

  app.get('/doctor/me/availability/rules', async (request, reply) => {
    const session = requireSession(request, services);
    requireDoctor(session, services);
    return reply.status(200).send(services.doctors.listRules(session.userId));
  });

  app.post('/doctor/me/availability/rules', async (request, reply) => {
    const session = requireSession(request, services);
    requireDoctor(session, services);
    const rule = parseBody(ruleSchema, request.body);
    return reply.status(201).send(services.doctors.upsertRule(session.userId, rule));
  });

  app.delete('/doctor/me/availability/rules/:ruleId', async (request, reply) => {
    const session = requireSession(request, services);
    requireDoctor(session, services);
    const { ruleId } = request.params as { ruleId: string };
    services.doctors.deleteRule(session.userId, ruleId);
    return reply.status(204).send();
  });

  app.get('/doctor/me/availability/exceptions', async (request, reply) => {
    const session = requireSession(request, services);
    requireDoctor(session, services);
    return reply.status(200).send(services.doctors.listExceptions(session.userId));
  });

  app.post('/doctor/me/availability/exceptions', async (request, reply) => {
    const session = requireSession(request, services);
    requireDoctor(session, services);
    const input = parseBody(exceptionSchema, request.body);
    return reply.status(201).send(services.doctors.createException(session.userId, input));
  });

  app.delete('/doctor/me/availability/exceptions/:exceptionId', async (request, reply) => {
    const session = requireSession(request, services);
    requireDoctor(session, services);
    const { exceptionId } = request.params as { exceptionId: string };
    services.doctors.deleteException(session.userId, exceptionId);
    return reply.status(204).send();
  });

  app.get('/doctor/me/policy', async (request, reply) => {
    const session = requireSession(request, services);
    requireDoctor(session, services);
    return reply.status(200).send(services.doctors.profile(session.userId).policy);
  });

  app.put('/doctor/me/policy', async (request, reply) => {
    const session = requireSession(request, services);
    requireDoctor(session, services);
    const patch = parseBody(policySchema, request.body);
    return reply.status(200).send(services.doctors.updatePolicy(session.userId, patch));
  });

  app.get('/doctor/me/availability', async (request, reply) => {
    const session = requireSession(request, services);
    requireDoctor(session, services);
    const query = parseQuery(availabilityQuerySchema, request.query);
    const nowMs = services.now();
    const own = services.appointments.ownAvailability(session.userId, {
      from: query.from,
      to: query.to,
      type: query.type,
    });
    return reply.status(200).send(
      toAvailabilityResponse({
        doctor: own.doctor,
        consultType: own.consultType,
        result: own.result,
        requestedTimezone: query.tz ?? 'UTC',
        nowMs,
        calendarSync: loadCalendarSync(services.db, session.userId, nowMs, isoDuration),
      }),
    );
  });

  app.get('/doctor/me/patients', async (request, reply) => {
    const session = requireSession(request, services);
    requireDoctor(session, services);
    return reply.status(200).send(services.doctors.listSeenPatients(session.userId));
  });

  app.get('/doctor/me/stats', async (request, reply) => {
    const session = requireSession(request, services);
    requireDoctor(session, services);
    return reply.status(200).send(services.doctors.stats(session.userId));
  });

  /** DOC-020 — deactivation is requested, never immediate (audited). */
  app.post('/doctor/me/deactivation-request', async (request, reply) => {
    const session = requireSession(request, services);
    requireDoctor(session, services);
    const { reason } = parseBody(deactivationSchema, request.body);
    const nowIso = toIso(services.now());
    const future = one<{ count: number }>(
      services.db,
      `SELECT COUNT(*) AS count FROM appointments
        WHERE doctor_id = ? AND status IN ('held','pending_approval','confirmed','in_progress') AND start_utc > ?`,
      session.userId,
      nowIso,
    );
    run(services.db, `UPDATE doctors SET deactivation_requested_at = ? WHERE id = ?`, nowIso, session.userId);
    run(
      services.db,
      `INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, after_json, created_at)
       VALUES (?, 'doctor', ?, 'doctor.deactivation_requested', 'doctor', ?, ?, ?)`,
      newId('aud'),
      session.userId,
      session.userId,
      JSON.stringify({ reason, future_appointments: future?.count ?? 0 }),
      nowIso,
    );
    return reply.status(200).send({ requested_at: nowIso, future_appointments: future?.count ?? 0 });
  });
}

/** Re-exported for the seed/tests that need a default date window. */
export function defaultAvailabilityWindow(nowMs: number, timeZone: string, days = 14): { from: string; to: string } {
  const from = dateInZone(nowMs, timeZone);
  return { from, to: addDaysToDate(from, days) };
}
