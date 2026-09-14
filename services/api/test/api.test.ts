/**
 * API integration tests through the real Fastify app (`app.inject`, no socket) —
 * TRD §7 contract end-to-end against an in-memory SQLite database.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { addDaysToDate, dateInZone } from '@medibook/core';

import { buildServer } from '../src/server.ts';
import { openDb, type Db } from '../src/db/database.ts';
import { seedDatabase } from '../src/seed.ts';

const NOW = Date.parse('2026-09-14T06:00:00Z'); // 11:30 IST
const TZ = 'Asia/Kolkata';

let app: ReturnType<typeof buildServer>;
let db: Db;

type Inject = {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  url: string;
  token?: string;
  body?: unknown;
  idempotencyKey?: string;
  headers?: Record<string, string>;
};

async function call(input: Inject) {
  const headers: Record<string, string> = { ...(input.headers ?? {}) };
  if (input.token) headers['authorization'] = `Bearer ${input.token}`;
  if (input.idempotencyKey) headers['idempotency-key'] = input.idempotencyKey;
  return app.inject({
    method: input.method,
    url: input.url,
    headers,
    payload: input.body === undefined ? undefined : (input.body as object),
  });
}

const bodyOf = (res: { body: string }): any => (res.body && res.body.length > 0 ? JSON.parse(res.body) : undefined);

async function login(
  channel: 'phone' | 'email',
  destination: string,
  role: 'patient' | 'doctor',
  register = false,
): Promise<any> {
  const requested = await call({
    method: 'POST',
    url: '/v1/auth/otp/request',
    body: { channel, destination, purpose: register ? 'register' : 'login', role },
  });
  assert.equal(requested.statusCode, 200, requested.body);
  const code = bodyOf(requested).dev_code as string;
  assert.ok(code, 'dev OTP code should be echoed in development');

  const verified = await call({
    method: 'POST',
    url: '/v1/auth/otp/verify',
    body: { channel, destination, code, role, ...(register ? { register: true } : {}) },
  });
  assert.equal(verified.statusCode, 201, verified.body);
  return bodyOf(verified);
}

async function availability(doctorId: string, type: 'in_person' | 'video', token?: string) {
  const from = addDaysToDate(dateInZone(NOW, TZ), 6);
  const to = addDaysToDate(from, 6);
  const res = await call({
    method: 'GET',
    url: `/v1/doctors/${doctorId}/availability?from=${from}&to=${to}&type=${type}`,
    token,
  });
  assert.equal(res.statusCode, 200, res.body);
  const parsed = bodyOf(res) as { days?: Array<{ date: string; slots: any[] }> };
  assert.ok(Array.isArray(parsed.days), `availability.days should be an array; got ${res.body.slice(0, 200)}`);
  return parsed.days!;
}

function pickSlot(
  days: Array<{ date: string; slots: any[] }>,
  options: { excludeDate?: string; excludeStart?: string } = {},
): { date: string; slot: any } {
  for (const day of days) {
    if (day.date === options.excludeDate) continue;
    const slot = day.slots.find(
      (candidate) => candidate.status === 'available' && candidate.start_utc !== options.excludeStart,
    );
    if (slot) return { date: day.date, slot };
  }
  throw new Error('no available slot found in window');
}

before(async () => {
  db = openDb({ path: ':memory:' });
  seedDatabase(db, NOW, { reset: true });
  app = buildServer({ db, now: () => NOW, devOtpEcho: true, logger: false });
  await app.ready();
});

after(async () => {
  await app.close();
  db.close();
});

test('MediBook API surface', async (t) => {
  const state: Record<string, any> = {};

  /* ------------------------------------------------------------- health */

  await t.test('GET /v1/health', async () => {
    const res = await call({ method: 'GET', url: '/v1/health' });
    assert.equal(res.statusCode, 200);
    const health = bodyOf(res);
    assert.equal(health.status, 'ok');
    assert.equal(health.database, 'sqlite');
    assert.equal(typeof health.version, 'string');
    assert.equal(typeof health.time, 'string');
  });

  /* --------------------------------------------------------------- auth */

  await t.test('OTP request → verify → session → /auth/me', async () => {
    const session = await login('phone', '+919812345678', 'patient');
    assert.equal(session.user.id, 'usr_priya');
    assert.equal(session.user.role, 'patient');
    assert.ok(session.access_token && session.refresh_token);
    state.session = session;
    state.patientToken = session.access_token;

    const me = await call({ method: 'GET', url: '/v1/auth/me', token: state.patientToken });
    assert.equal(me.statusCode, 200);
    assert.equal(bodyOf(me).id, 'usr_priya');
  });

  await t.test('register a new patient via OTP', async () => {
    const session = await login('phone', '+919899000001', 'patient', true);
    assert.equal(session.user.role, 'patient');
    state.otherPatientToken = session.access_token;
    state.otherPatientId = session.user.id;
  });

  await t.test('refresh rotates tokens and detects reuse', async () => {
    const rotatedRes = await call({
      method: 'POST',
      url: '/v1/auth/refresh',
      body: { refresh_token: state.session.refresh_token },
    });
    assert.equal(rotatedRes.statusCode, 200, rotatedRes.body);
    const rotated = bodyOf(rotatedRes);
    assert.notEqual(rotated.access_token, state.session.access_token);
    assert.equal(rotated.user.id, 'usr_priya');
    assert.notEqual(rotated.refresh_token, state.session.refresh_token);
    state.patientToken = rotated.access_token;

    // Replaying the already-rotated token is a theft signal → family revoked.
    const reuse = await call({
      method: 'POST',
      url: '/v1/auth/refresh',
      body: { refresh_token: state.session.refresh_token },
    });
    assert.equal(reuse.statusCode, 401, reuse.body);
    assert.equal(bodyOf(reuse).error.code, 'AUTH_INVALID_REFRESH');
  });

  /* ---------------------------------------------------------- discovery */

  await t.test('GET /specializations and /doctors', async () => {
    const specializations = await call({ method: 'GET', url: '/v1/specializations' });
    assert.equal(specializations.statusCode, 200);
    assert.ok(bodyOf(specializations).length >= 8);

    const doctors = await call({ method: 'GET', url: '/v1/doctors?limit=50', token: state.patientToken });
    assert.equal(doctors.statusCode, 200);
    const page = bodyOf(doctors);
    assert.ok(page.items.length >= 8);
    assert.ok(page.items.every((doctor: any) => doctor.verified === true));
    state.arjun = page.items.find((doctor: any) => doctor.id === 'doc_arjun');
    assert.ok(state.arjun);

    const detail = await call({ method: 'GET', url: '/v1/doctors/doc_arjun' });
    assert.equal(detail.statusCode, 200);
    assert.equal(bodyOf(detail).id, 'doc_arjun');
    assert.ok(bodyOf(detail).consult_fees.length >= 1);
  });

  await t.test('an unverified doctor is never exposed (404)', async () => {
    const session = await login('phone', '+919899000002', 'doctor', true);
    state.newDoctorId = session.user.id;
    state.newDoctorToken = session.access_token;

    const hidden = await call({ method: 'GET', url: `/v1/doctors/${state.newDoctorId}` });
    assert.equal(hidden.statusCode, 404);
    assert.equal(bodyOf(hidden).error.code, 'NOT_FOUND');
  });

  /* ------------------------------------------------------------- booking */

  await t.test('happy path: availability → hold → book → payment captured', async () => {
    const days = await availability('doc_arjun', 'in_person', state.patientToken);
    const { slot } = pickSlot(days);
    state.bookingSlot = slot;

    const hold = await call({
      method: 'POST',
      url: '/v1/appointments/holds',
      token: state.patientToken,
      body: { doctor_id: 'doc_arjun', consult_type: 'in_person', start_utc: slot.start_utc },
    });
    assert.equal(hold.statusCode, 201, hold.body);
    const holdBody = bodyOf(hold);
    assert.equal(holdBody.status, 'active');

    const booked = await call({
      method: 'POST',
      url: '/v1/appointments',
      token: state.patientToken,
      idempotencyKey: 'idem-booking-happy-0001',
      body: {
        hold_id: holdBody.id,
        doctor_id: 'doc_arjun',
        consult_type: 'in_person',
        start_utc: slot.start_utc,
        payment: { method: 'card' },
      },
    });
    assert.equal(booked.statusCode, 201, booked.body);
    const appointment = bodyOf(booked).appointment;
    assert.ok(appointment, 'response is wrapped in { appointment }');
    assert.match(appointment.code, /^MB-/);
    assert.equal(appointment.status, 'confirmed');
    assert.equal(appointment.start_utc, slot.start_utc);
    assert.equal(appointment.payment?.status, 'captured');
    state.booked = appointment;
  });

  await t.test('Idempotency-Key replay returns the same appointment and one row', async () => {
    const replay = await call({
      method: 'POST',
      url: '/v1/appointments',
      token: state.patientToken,
      idempotencyKey: 'idem-booking-happy-0001',
      body: {
        doctor_id: 'doc_arjun',
        consult_type: 'in_person',
        start_utc: state.bookingSlot.start_utc,
        payment: { method: 'card' },
      },
    });
    assert.equal(replay.statusCode, 201, replay.body);
    const appointment = bodyOf(replay).appointment;
    assert.equal(appointment.id, state.booked.id);
    assert.equal(appointment.code, state.booked.code);

    const rows = db
      .prepare(`SELECT COUNT(*) AS count FROM appointments WHERE doctor_id = 'doc_arjun' AND start_utc = ?`)
      .get(state.bookingSlot.start_utc) as { count: number };
    assert.equal(Number(rows.count), 1);
  });

  await t.test('missing Idempotency-Key is a 400', async () => {
    const res = await call({
      method: 'POST',
      url: '/v1/appointments',
      token: state.patientToken,
      body: { doctor_id: 'doc_arjun', consult_type: 'in_person', start_utc: state.bookingSlot.start_utc },
    });
    assert.equal(res.statusCode, 400, res.body);
    assert.equal(bodyOf(res).error.code, 'VAL_INVALID');
  });

  await t.test('list appointments by scope', async () => {
    const upcoming = await call({ method: 'GET', url: '/v1/appointments?scope=upcoming', token: state.patientToken });
    assert.equal(upcoming.statusCode, 200);
    assert.ok(bodyOf(upcoming).items.some((item: any) => item.id === state.booked.id));

    const past = await call({ method: 'GET', url: '/v1/appointments?scope=past', token: state.patientToken });
    assert.equal(past.statusCode, 200);
    assert.ok(bodyOf(past).items.some((item: any) => item.status === 'completed'));
  });

  await t.test('reschedule preview + PATCH move', async () => {
    const preview = await call({
      method: 'GET',
      url: `/v1/appointments/${state.booked.id}/reschedule-policy`,
      token: state.patientToken,
    });
    assert.equal(preview.statusCode, 200);
    assert.equal(bodyOf(preview).allowed, true);

    const days = await availability('doc_arjun', 'in_person', state.patientToken);
    const { slot } = pickSlot(days, { excludeDate: dateInZone(Date.parse(state.booked.start_utc), TZ) });

    const moved = await call({
      method: 'PATCH',
      url: `/v1/appointments/${state.booked.id}`,
      token: state.patientToken,
      idempotencyKey: 'idem-reschedule-0001',
      body: { start_utc: slot.start_utc },
    });
    assert.equal(moved.statusCode, 200, moved.body);
    assert.equal(bodyOf(moved).appointment.start_utc, slot.start_utc);
    assert.equal(bodyOf(moved).appointment.reschedule_count, 1);
    state.booked = bodyOf(moved).appointment;
  });

  await t.test('cancel returns the full CancelResult with a 100% refund tier', async () => {
    const days = await availability('doc_arjun', 'in_person', state.patientToken);
    const { slot } = pickSlot(days, { excludeDate: dateInZone(Date.parse(state.booked.start_utc), TZ) });

    const booked = await call({
      method: 'POST',
      url: '/v1/appointments',
      token: state.patientToken,
      idempotencyKey: 'idem-booking-cancel-0001',
      body: { doctor_id: 'doc_arjun', consult_type: 'in_person', start_utc: slot.start_utc, payment: { method: 'upi' } },
    });
    assert.equal(booked.statusCode, 201, booked.body);
    const appointment = bodyOf(booked).appointment;

    const cancelled = await call({
      method: 'DELETE',
      url: `/v1/appointments/${appointment.id}`,
      token: state.patientToken,
      idempotencyKey: 'idem-cancel-0001',
      body: { reason: 'Schedule clash' },
    });
    assert.equal(cancelled.statusCode, 200, cancelled.body);
    const result = bodyOf(cancelled);
    assert.ok(result.appointment && result.policy, 'CancelResult is not unwrapped');
    assert.equal(result.appointment.status, 'cancelled');
    assert.equal(result.policy.refund_percent, 100);
    assert.ok(result.refund && result.refund.amount_minor > 0);
  });

  /* ------------------------------------------------------------ reviews */

  await t.test('review only after completion', async () => {
    const days = await availability('doc_arjun', 'in_person', state.patientToken);
    const { slot } = pickSlot(days);
    const booked = await call({
      method: 'POST',
      url: '/v1/appointments',
      token: state.patientToken,
      idempotencyKey: 'idem-booking-review-0001',
      body: { doctor_id: 'doc_arjun', consult_type: 'in_person', start_utc: slot.start_utc, payment: { method: 'card' } },
    });
    assert.equal(booked.statusCode, 201, booked.body);
    const appointment = bodyOf(booked).appointment;
    state.reviewAppointment = appointment;

    const early = await call({
      method: 'POST',
      url: `/v1/appointments/${appointment.id}/review`,
      token: state.patientToken,
      body: { rating: 5 },
    });
    assert.equal(early.statusCode, 422, early.body);
    assert.equal(bodyOf(early).error.code, 'APT_REVIEW_NOT_ALLOWED');

    const doctorSession = await login('email', 'dr.arjun.mehta@gmail.com', 'doctor');
    state.doctorToken = doctorSession.access_token;
    state.doctorId = doctorSession.user.id;

    const completed = await call({
      method: 'POST',
      url: `/v1/appointments/${appointment.id}/complete`,
      token: state.doctorToken,
    });
    assert.equal(completed.statusCode, 200, completed.body);
    assert.equal(bodyOf(completed).appointment.status, 'completed');

    const reviewed = await call({
      method: 'POST',
      url: `/v1/appointments/${appointment.id}/review`,
      token: state.patientToken,
      body: { rating: 5, comment: 'Great visit' },
    });
    assert.equal(reviewed.statusCode, 201, reviewed.body);
    assert.equal(bodyOf(reviewed).rating, 5);

    const again = await call({
      method: 'POST',
      url: `/v1/appointments/${appointment.id}/review`,
      token: state.patientToken,
      body: { rating: 4 },
    });
    assert.equal(again.statusCode, 422, again.body);
    assert.equal(bodyOf(again).error.code, 'APT_REVIEW_EXISTS');
  });

  /* ------------------------------------------------------ notifications */

  await t.test('notifications list / read / preferences', async () => {
    const list = await call({ method: 'GET', url: '/v1/notifications', token: state.patientToken });
    assert.equal(list.statusCode, 200);
    const page = bodyOf(list);
    assert.ok(page.items.length >= 1, 'booking notifications exist');
    assert.equal(typeof page.meta.total, 'number');

    const first = page.items[0];
    const read = await call({ method: 'POST', url: `/v1/notifications/${first.id}/read`, token: state.patientToken });
    assert.equal(read.statusCode, 204);

    const unread = await call({
      method: 'GET',
      url: '/v1/notifications?unread_only=true',
      token: state.patientToken,
    });
    assert.equal(unread.statusCode, 200);
    assert.ok(bodyOf(unread).items.every((item: any) => item.read_at === null));

    const readAll = await call({ method: 'POST', url: '/v1/notifications/read-all', token: state.patientToken });
    assert.equal(readAll.statusCode, 204);

    const prefs = await call({ method: 'GET', url: '/v1/notifications/preferences', token: state.patientToken });
    assert.equal(prefs.statusCode, 200);
    assert.ok(bodyOf(prefs).entries.length >= 5);

    const patched = await call({
      method: 'PUT',
      url: '/v1/notifications/preferences',
      token: state.patientToken,
      body: { quiet_hours: { enabled: true, start: '21:00', end: '06:30' } },
    });
    assert.equal(patched.statusCode, 200);
    assert.equal(bodyOf(patched).quiet_hours.start, '21:00');

    // Alias path the patient client also probes.
    const alias = await call({ method: 'GET', url: '/v1/patients/me/preferences', token: state.patientToken });
    assert.equal(alias.statusCode, 200);
    assert.equal(bodyOf(alias).quiet_hours.start, '21:00');

    const device = await call({
      method: 'POST',
      url: '/v1/devices',
      token: state.patientToken,
      body: { token: 'push-token-1', platform: 'ios' },
    });
    assert.equal(device.statusCode, 200);
    assert.equal(bodyOf(device).ok, true);
  });

  /* --------------------------------------------------------- dependents */

  await t.test('dependents CRUD and dependent-with-upcoming guard', async () => {
    const created = await call({
      method: 'POST',
      url: '/v1/patients/me/dependents',
      token: state.patientToken,
      body: { name: 'Test Child', relationship: 'daughter', dob: '2020-01-01', gender: 'female' },
    });
    assert.equal(created.statusCode, 201, created.body);
    const dependent = bodyOf(created);

    const updated = await call({
      method: 'PATCH',
      url: `/v1/patients/me/dependents/${dependent.id}`,
      token: state.patientToken,
      body: { notes: 'Peanut allergy' },
    });
    assert.equal(updated.statusCode, 200);
    assert.equal(bodyOf(updated).notes, 'Peanut allergy');

    const removed = await call({
      method: 'DELETE',
      url: `/v1/patients/me/dependents/${dependent.id}`,
      token: state.patientToken,
    });
    assert.equal(removed.statusCode, 204);

    const guarded = await call({
      method: 'DELETE',
      url: '/v1/patients/me/dependents/dep_aarav',
      token: state.patientToken,
    });
    assert.equal(guarded.statusCode, 422, guarded.body);
    assert.equal(bodyOf(guarded).error.code, 'APT_DEPENDENT_HAS_APPOINTMENTS');
  });

  /* --------------------------------------------------------- doctor side */

  await t.test('doctor profile, rules, exceptions and policy', async () => {
    const profile = await call({ method: 'GET', url: '/v1/doctor/me/profile', token: state.doctorToken });
    assert.equal(profile.statusCode, 200);
    assert.equal(bodyOf(profile).user_id, 'doc_arjun');

    const patched = await call({
      method: 'PATCH',
      url: '/v1/doctor/me/profile',
      token: state.doctorToken,
      body: { bio: 'Updated bio for the integration test.' },
    });
    assert.equal(patched.statusCode, 200, patched.body);
    assert.match(bodyOf(patched).bio, /Updated bio/);

    const config = await call({ method: 'GET', url: '/v1/doctor/me/consultation-config', token: state.doctorToken });
    assert.equal(config.statusCode, 200);
    const updatedConfig = await call({
      method: 'PUT',
      url: '/v1/doctor/me/consultation-config',
      token: state.doctorToken,
      body: { fees: bodyOf(config).fees },
    });
    assert.equal(updatedConfig.statusCode, 200);

    const rule = await call({
      method: 'POST',
      url: '/v1/doctor/me/availability/rules',
      token: state.doctorToken,
      body: {
        weekday: 2,
        start_local_time: '14:00',
        end_local_time: '15:00',
        slot_minutes: 20,
        buffer_minutes: 5,
        consult_types: ['in_person'],
        effective_from: '2026-01-01',
      },
    });
    assert.equal(rule.statusCode, 201, rule.body);
    const ruleId = bodyOf(rule).id;
    const deleted = await call({
      method: 'DELETE',
      url: `/v1/doctor/me/availability/rules/${ruleId}`,
      token: state.doctorToken,
    });
    assert.equal(deleted.statusCode, 204);

    const exception = await call({
      method: 'POST',
      url: '/v1/doctor/me/availability/exceptions',
      token: state.doctorToken,
      body: {
        start_utc: new Date(NOW + 30 * 86_400_000).toISOString(),
        end_utc: new Date(NOW + 30 * 86_400_000 + 3_600_000).toISOString(),
        kind: 'leave',
        reason: 'Conference',
      },
    });
    assert.equal(exception.statusCode, 201, exception.body);
    const exceptionId = bodyOf(exception).id;
    const removedException = await call({
      method: 'DELETE',
      url: `/v1/doctor/me/availability/exceptions/${exceptionId}`,
      token: state.doctorToken,
    });
    assert.equal(removedException.statusCode, 204);

    const policy = await call({ method: 'GET', url: '/v1/doctor/me/policy', token: state.doctorToken });
    assert.equal(policy.statusCode, 200);
    const policyUpdate = await call({
      method: 'PUT',
      url: '/v1/doctor/me/policy',
      token: state.doctorToken,
      body: { buffer_minutes: 10 },
    });
    assert.equal(policyUpdate.statusCode, 200);
    assert.equal(bodyOf(policyUpdate).buffer_minutes, 10);

    const own = await call({ method: 'GET', url: '/v1/doctor/me/availability?type=in_person', token: state.doctorToken });
    assert.equal(own.statusCode, 200);
    assert.ok(Array.isArray(bodyOf(own).days));
  });

  await t.test('calendar connect → status → sync → disconnect', async () => {
    const connect = await call({
      method: 'POST',
      url: '/v1/calendar/connect',
      token: state.doctorToken,
      body: { provider: 'google' },
    });
    assert.equal(connect.statusCode, 200, connect.body);
    assert.match(bodyOf(connect).authorization_url, /^https:/);

    const callback = await call({
      method: 'POST',
      url: '/v1/calendar/callback/google',
      token: state.doctorToken,
      body: { email: 'dr.arjun.mehta@gmail.com' },
    });
    assert.equal(callback.statusCode, 200, callback.body);
    const account = bodyOf(callback);
    assert.equal(account.provider, 'google');

    const status = await call({ method: 'GET', url: '/v1/calendar/status', token: state.doctorToken });
    assert.equal(status.statusCode, 200);
    assert.ok(bodyOf(status).some((entry: any) => entry.id === account.id));

    const sync = await call({
      method: 'POST',
      url: '/v1/calendar/sync',
      token: state.doctorToken,
      body: { account_id: account.id },
    });
    assert.equal(sync.statusCode, 200, sync.body);
    assert.equal(bodyOf(sync).queued, true);
    assert.ok(bodyOf(sync).busy_events_imported >= 1);

    const disconnected = await call({
      method: 'DELETE',
      url: `/v1/calendar/accounts/${account.id}`,
      token: state.doctorToken,
    });
    assert.equal(disconnected.statusCode, 204);
  });

  await t.test('doctor stats, seen patients and patient context', async () => {
    const stats = await call({ method: 'GET', url: '/v1/doctor/me/stats', token: state.doctorToken });
    assert.equal(stats.statusCode, 200);
    assert.ok(bodyOf(stats).today_total >= 1);

    const patients = await call({ method: 'GET', url: '/v1/doctor/me/patients', token: state.doctorToken });
    assert.equal(patients.statusCode, 200);
    assert.ok(bodyOf(patients).length >= 1);

    const context = await call({
      method: 'GET',
      url: `/v1/appointments/${state.reviewAppointment.id}/patient-context`,
      token: state.doctorToken,
    });
    assert.equal(context.statusCode, 200, context.body);
    assert.equal(bodyOf(context).patient_user_id, 'usr_priya');
  });

  await t.test('accept / decline a manual-approval booking', async () => {
    const nikhil = await login('email', 'n.reddy@apollo-hyd.onmicrosoft.com', 'doctor');
    const token = nikhil.access_token;

    const pending = await call({ method: 'GET', url: '/v1/appointments?scope=pending', token });
    assert.equal(pending.statusCode, 200);
    const items = bodyOf(pending).items;
    assert.ok(items.length >= 2, 'two seeded pending approvals');

    const accepted = await call({ method: 'POST', url: `/v1/appointments/${items[0].id}/accept`, token });
    assert.equal(accepted.statusCode, 200, accepted.body);
    assert.equal(bodyOf(accepted).appointment.status, 'confirmed');

    const declined = await call({
      method: 'POST',
      url: `/v1/appointments/${items[1].id}/decline`,
      token,
      body: { reason: 'Not available that day' },
    });
    assert.equal(declined.statusCode, 200, declined.body);
    assert.equal(bodyOf(declined).appointment.status, 'cancelled');
    assert.equal(bodyOf(declined).appointment.refund?.tier_percent, 100);
  });

  await t.test('complete and no-show', async () => {
    const all = await call({ method: 'GET', url: '/v1/appointments?scope=all&limit=100', token: state.doctorToken });
    assert.equal(all.statusCode, 200);
    const items = bodyOf(all).items as any[];

    const confirmed = items.find((item) => item.status === 'confirmed');
    assert.ok(confirmed, 'a confirmed visit exists');
    const completed = await call({
      method: 'POST',
      url: `/v1/appointments/${confirmed.id}/complete`,
      token: state.doctorToken,
    });
    assert.equal(completed.statusCode, 200, completed.body);
    assert.equal(bodyOf(completed).appointment.status, 'completed');

    const noShowTarget = items.find((item) => item.status === 'confirmed');
    if (noShowTarget) {
      const noShow = await call({
        method: 'POST',
        url: `/v1/appointments/${noShowTarget.id}/no-show`,
        token: state.doctorToken,
      });
      // The target may sit in its grace period; both outcomes are honest.
      assert.ok([200, 409].includes(noShow.statusCode), noShow.body);
      if (noShow.statusCode === 200) assert.equal(bodyOf(noShow).appointment.status, 'no_show');
    }
  });

  await t.test('verification submission moves the doctor to under_review', async () => {
    const before = await call({ method: 'GET', url: '/v1/doctor/me/verification', token: state.newDoctorToken });
    assert.equal(before.statusCode, 200);

    const submitted = await call({
      method: 'PUT',
      url: '/v1/doctor/me/verification',
      token: state.newDoctorToken,
      body: {
        registration_number: 'MH-2026-99999',
        council: 'Maharashtra Medical Council',
        country: 'India',
        specialization_slugs: ['dermatology'],
        documents: [{ kind: 'license', filename: 'licence.pdf' }],
      },
    });
    assert.equal(submitted.statusCode, 200, submitted.body);
    assert.equal(bodyOf(submitted).status, 'under_review');
  });

  /* -------------------------------------------------------- authorisation */

  await t.test('auth failures: 401 without a bearer, 403 across roles', async () => {
    const anon = await call({ method: 'GET', url: '/v1/auth/me' });
    assert.equal(anon.statusCode, 401);
    assert.equal(bodyOf(anon).error.code, 'AUTH_REQUIRED');

    const wrongRole = await call({ method: 'GET', url: '/v1/doctor/me/profile', token: state.patientToken });
    assert.equal(wrongRole.statusCode, 403, wrongRole.body);
    assert.equal(bodyOf(wrongRole).error.code, 'AUTHZ_FORBIDDEN');
  });

  /* --------------------------------------------------------------- admin */

  await t.test('admin routes are header-gated and real', async () => {
    const denied = await call({ method: 'GET', url: '/v1/admin/verification-queue' });
    assert.equal(denied.statusCode, 403);
    assert.equal(bodyOf(denied).error.code, 'AUTHZ_FORBIDDEN');

    const adminHeaders = { 'x-admin-role': 'ops' };

    const queue = await call({ method: 'GET', url: '/v1/admin/verification-queue', headers: adminHeaders });
    assert.equal(queue.statusCode, 200);
    assert.ok(bodyOf(queue).some((entry: any) => entry.doctor_id === state.newDoctorId));

    const approved = await call({
      method: 'POST',
      url: `/v1/admin/doctors/${state.newDoctorId}/verify`,
      headers: adminHeaders,
      body: { decision: 'approve' },
    });
    assert.equal(approved.statusCode, 200);
    assert.equal(bodyOf(approved).status, 'approved');

    const nowVisible = await call({ method: 'GET', url: `/v1/doctors/${state.newDoctorId}` });
    assert.equal(nowVisible.statusCode, 200);

    const reports = await call({ method: 'GET', url: '/v1/admin/reports/summary', headers: adminHeaders });
    assert.equal(reports.statusCode, 200);
    assert.ok(bodyOf(reports).appointments.total >= 1);

    const audit = await call({ method: 'GET', url: '/v1/admin/audit-logs', headers: adminHeaders });
    assert.equal(audit.statusCode, 200);
    assert.ok(bodyOf(audit).length >= 1);

    const config = await call({ method: 'GET', url: '/v1/admin/config', headers: adminHeaders });
    assert.equal(config.statusCode, 200);
    const configured = await call({
      method: 'PUT',
      url: '/v1/admin/config',
      headers: adminHeaders,
      body: { hold_minutes: 6 },
    });
    assert.equal(configured.statusCode, 200);
    assert.equal(bodyOf(configured).hold_minutes, 6);

    const refunds = await call({ method: 'GET', url: '/v1/admin/refunds', headers: adminHeaders });
    assert.equal(refunds.statusCode, 200);

    const appointments = await call({ method: 'GET', url: '/v1/admin/appointments', headers: adminHeaders });
    assert.equal(appointments.statusCode, 200);
    assert.ok(bodyOf(appointments).items.length >= 1);
  });
});
