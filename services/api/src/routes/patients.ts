/**
 * Patient routes — profile, dependents, favourites, deletion request and the
 * notification-preference alias (PRD §9.1; the core client probes both
 * `/patients/me/preferences` and `/notifications/preferences`).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { NotificationPreference } from '@medibook/core';

import { parseBody, requireSession } from './helpers.ts';
import { updatePreferences } from '../services/notifications.ts';
import { mapDoctorSummary } from '../db/mappers.ts';
import type { AppServices } from '../server.ts';

const genderSchema = z.enum(['female', 'male', 'other', 'undisclosed']);

const profilePatchSchema = z.object({
  display_name: z.string().min(1).optional(),
  gender: genderSchema.optional(),
  dob: z.string().optional(),
  email: z.string().optional(),
  default_timezone: z.string().optional(),
  emergency_contact: z.string().nullable().optional(),
});

const dependentInputSchema = z.object({
  name: z.string().min(1),
  relationship: z.enum(['son', 'daughter', 'spouse', 'parent', 'sibling', 'other']),
  dob: z.string().min(1),
  gender: genderSchema,
  notes: z.string().nullable().optional(),
});

const dependentPatchSchema = dependentInputSchema.partial();

const savedDoctorSchema = z.object({ saved: z.boolean() });

const deletionRequestSchema = z.object({ reason: z.string().optional() });

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

export async function registerPatientRoutes(app: FastifyInstance, services: AppServices): Promise<void> {
  app.get('/patients/me', async (request, reply) => {
    const session = requireSession(request, services);
    services.auth.requirePatient(session);
    return reply.status(200).send(services.patients.profile(session.userId));
  });

  app.patch('/patients/me', async (request, reply) => {
    const session = requireSession(request, services);
    services.auth.requirePatient(session);
    const patch = parseBody(profilePatchSchema, request.body);
    return reply.status(200).send(services.patients.updateProfile(session.userId, patch));
  });

  app.get('/patients/me/dependents', async (request, reply) => {
    const session = requireSession(request, services);
    services.auth.requirePatient(session);
    return reply.status(200).send(services.patients.listDependents(session.userId));
  });

  app.post('/patients/me/dependents', async (request, reply) => {
    const session = requireSession(request, services);
    services.auth.requirePatient(session);
    const input = parseBody(dependentInputSchema, request.body);
    return reply
      .status(201)
      .send(services.patients.createDependent(session.userId, { ...input, notes: input.notes ?? null }));
  });

  app.patch('/patients/me/dependents/:dependentId', async (request, reply) => {
    const session = requireSession(request, services);
    services.auth.requirePatient(session);
    const { dependentId } = request.params as { dependentId: string };
    const patch = parseBody(dependentPatchSchema, request.body);
    return reply.status(200).send(services.patients.updateDependent(session.userId, dependentId, patch));
  });

  app.delete('/patients/me/dependents/:dependentId', async (request, reply) => {
    const session = requireSession(request, services);
    services.auth.requirePatient(session);
    const { dependentId } = request.params as { dependentId: string };
    services.patients.deleteDependent(session.userId, dependentId);
    return reply.status(204).send();
  });

  app.get('/patients/me/saved-doctors', async (request, reply) => {
    const session = requireSession(request, services);
    services.auth.requirePatient(session);
    const summaries = services.doctors
      .allDoctorRows()
      .filter((row) => row.verification_status === 'approved')
      .map(mapDoctorSummary);
    return reply.status(200).send(services.patients.listSavedDoctors(session.userId, summaries));
  });

  app.post('/patients/me/saved-doctors/:doctorId', async (request, reply) => {
    const session = requireSession(request, services);
    services.auth.requirePatient(session);
    const { doctorId } = request.params as { doctorId: string };
    const { saved } = parseBody(savedDoctorSchema, request.body);
    return reply.status(200).send(services.patients.setSavedDoctor(session.userId, doctorId, saved));
  });

  app.post('/patients/me/deletion-request', async (request, reply) => {
    const session = requireSession(request, services);
    services.auth.requirePatient(session);
    const { reason } = parseBody(deletionRequestSchema, request.body ?? {});
    return reply.status(200).send(services.patients.requestAccountDeletion(session.userId, reason));
  });

  /** Aliases of the notification preferences so either client path works. */
  app.get('/patients/me/preferences', async (request, reply) => {
    const session = requireSession(request, services);
    return reply.status(200).send(services.auth.preferences(session.userId));
  });

  app.put('/patients/me/preferences', async (request, reply) => {
    const session = requireSession(request, services);
    const patch = parseBody(preferencesPatchSchema, request.body);
    updatePreferences(services.db, session.userId, patch as unknown as Partial<NotificationPreference>);
    return reply.status(200).send(services.auth.preferences(session.userId));
  });
}
