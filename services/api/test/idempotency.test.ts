/**
 * Idempotency-key behaviour — TRD §7.1, §10.2 layer 4.
 *
 * Guarantee under test: a key claimed synchronously before any `await` means two
 * concurrent requests carrying the same key cannot both proceed. The first
 * completes; the second observes the in-flight claim and answers
 * `409 APT_STATE_CONFLICT` with `details.code = IDEMPOTENT_REPLAY_IN_PROGRESS`.
 * A later replay of the *completed* key returns the stored response verbatim.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { addDaysToDate, dateInZone } from '@medibook/core';

import { buildServer } from '../src/server.ts';
import { openDb, type Db } from '../src/db/database.ts';
import { seedDatabase } from '../src/seed.ts';

const TZ = 'Asia/Kolkata';
let NOW = Date.parse('2026-09-14T06:00:00Z');

let app: ReturnType<typeof buildServer>;
let db: Db;

async function call(input: {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  url: string;
  token?: string;
  body?: unknown;
  idempotencyKey?: string;
}) {
  const headers: Record<string, string> = {};
  if (input.token) headers['authorization'] = `Bearer ${input.token}`;
  if (input.idempotencyKey) headers['idempotency-key'] = input.idempotencyKey;
  return app.inject({ method: input.method, url: input.url, headers, payload: input.body as object | undefined });
}

const bodyOf = (res: { body: string }): any => (res.body ? JSON.parse(res.body) : undefined);

async function login(destination: string, register = false): Promise<any> {
  const requested = await call({
    method: 'POST',
    url: '/v1/auth/otp/request',
    body: { channel: 'phone', destination, purpose: register ? 'register' : 'login', role: 'patient' },
  });
  assert.equal(requested.statusCode, 200, requested.body);
  const code = bodyOf(requested).dev_code;
  const verified = await call({
    method: 'POST',
    url: '/v1/auth/otp/verify',
    body: { channel: 'phone', destination, code, role: 'patient', ...(register ? { register: true } : {}) },
  });
  assert.equal(verified.statusCode, 201, verified.body);
  return bodyOf(verified);
}

const usedDates = new Set<string>();

async function nextSlot(token: string): Promise<string> {
  const from = addDaysToDate(dateInZone(NOW, TZ), 6);
  const to = addDaysToDate(from, 10);
  const res = await call({
    method: 'GET',
    url: `/v1/doctors/doc_arjun/availability?from=${from}&to=${to}&type=in_person`,
    token,
  });
  assert.equal(res.statusCode, 200, res.body);
  for (const day of bodyOf(res).days as Array<{ date: string; slots: any[] }>) {
    if (usedDates.has(day.date)) continue;
    const slot = day.slots.find((candidate) => candidate.status === 'available');
    if (slot) {
      usedDates.add(day.date);
      return slot.start_utc;
    }
  }
  throw new Error('no free slot');
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

test('sequential replay of a completed key returns the identical body and one row', async () => {
  const session = await login('+919812345678');
  const token = session.access_token;
  const slot = await nextSlot(token);

  const first = await call({
    method: 'POST',
    url: '/v1/appointments',
    token,
    idempotencyKey: 'idem-seq-key-0001',
    body: { doctor_id: 'doc_arjun', consult_type: 'in_person', start_utc: slot },
  });
  assert.equal(first.statusCode, 201, first.body);

  const second = await call({
    method: 'POST',
    url: '/v1/appointments',
    token,
    idempotencyKey: 'idem-seq-key-0001',
    body: { doctor_id: 'doc_arjun', consult_type: 'in_person', start_utc: slot },
  });
  assert.equal(second.statusCode, 201, second.body);

  assert.equal(bodyOf(second).appointment.id, bodyOf(first).appointment.id);
  assert.equal(bodyOf(second).appointment.code, bodyOf(first).appointment.code);

  const count = db
    .prepare(`SELECT COUNT(*) AS count FROM appointments WHERE doctor_id = 'doc_arjun' AND start_utc = ?`)
    .get(slot) as { count: number };
  assert.equal(Number(count.count), 1);
});

test('concurrent same-key requests: one row, one 201, one in-flight conflict', async () => {
  const session = await login('+919812345678');
  // Re-login is rate-limited (30 s resend cooldown) under a frozen clock, so the
  // session from the previous test is reused via a fresh OTP only where possible.
  const token = session.access_token;
  const slot = await nextSlot(token);
  const key = 'idem-race-key-0001';

  const [a, b] = await Promise.all([
    call({ method: 'POST', url: '/v1/appointments', token, idempotencyKey: key, body: { doctor_id: 'doc_arjun', consult_type: 'in_person', start_utc: slot } }),
    call({ method: 'POST', url: '/v1/appointments', token, idempotencyKey: key, body: { doctor_id: 'doc_arjun', consult_type: 'in_person', start_utc: slot } }),
  ]);

  const statuses = [a.statusCode, b.statusCode].sort();
  assert.deepEqual(statuses, [201, 409], `expected exactly one winner: ${a.body} | ${b.body}`);

  const conflict = a.statusCode === 409 ? a : b;
  const conflictBody = bodyOf(conflict);
  assert.equal(conflictBody.error.code, 'APT_STATE_CONFLICT');
  assert.equal(conflictBody.error.details.code, 'IDEMPOTENT_REPLAY_IN_PROGRESS');

  const count = db
    .prepare(`SELECT COUNT(*) AS count FROM appointments WHERE doctor_id = 'doc_arjun' AND start_utc = ?`)
    .get(slot) as { count: number };
  assert.equal(Number(count.count), 1);
});

test('different keys on the same slot → APT_SLOT_TAKEN with alternatives', async () => {
  const winner = await login('+919812345678');
  const slot = await nextSlot(winner.access_token);

  const first = await call({
    method: 'POST',
    url: '/v1/appointments',
    token: winner.access_token,
    idempotencyKey: 'idem-slot-a-0001',
    body: { doctor_id: 'doc_arjun', consult_type: 'in_person', start_utc: slot },
  });
  assert.equal(first.statusCode, 201, first.body);

  // A *different* patient on the same slot — same patient would trip R14 first.
  const rival = await login('+919899000003', true);
  const loser = await call({
    method: 'POST',
    url: '/v1/appointments',
    token: rival.access_token,
    idempotencyKey: 'idem-slot-b-0001',
    body: { doctor_id: 'doc_arjun', consult_type: 'in_person', start_utc: slot },
  });
  assert.equal(loser.statusCode, 409, loser.body);
  const error = bodyOf(loser).error;
  assert.equal(error.code, 'APT_SLOT_TAKEN');
  assert.ok(Array.isArray(error.details.alternatives) && error.details.alternatives.length >= 1);
});

test('keys are scoped per user — another user’s key is rejected', async () => {
  const other = await login('+919899000001', true);
  const foreignSlot = await nextSlot(other.access_token);

  const res = await call({
    method: 'POST',
    url: '/v1/appointments',
    token: other.access_token,
    idempotencyKey: 'idem-seq-key-0001', // completed by usr_priya
    body: { doctor_id: 'doc_arjun', consult_type: 'in_person', start_utc: foreignSlot },
  });
  assert.equal(res.statusCode, 403, res.body);
  assert.equal(bodyOf(res).error.code, 'AUTHZ_FORBIDDEN');
});

test('the sweep purges expired keys, after which the key may be reused', async () => {
  const session = await login('+919899000002', true);
  const token = session.access_token;
  const slot = await nextSlot(token);

  const first = await call({
    method: 'POST',
    url: '/v1/appointments',
    token,
    idempotencyKey: 'idem-expiring-0001',
    body: { doctor_id: 'doc_arjun', consult_type: 'in_person', start_utc: slot },
  });
  assert.equal(first.statusCode, 201, first.body);

  // Advance the clock beyond the 24 h idempotency retention window and sweep.
  NOW += 25 * 3_600_000;
  const swept = app.services.auth.sweep();
  assert.ok(swept.idempotency >= 1, 'the expired key was purged');

  const refreshed = await login('+919899000002');
  const laterSlot = await nextSlot(refreshed.access_token);
  const reused = await call({
    method: 'POST',
    url: '/v1/appointments',
    token: refreshed.access_token,
    idempotencyKey: 'idem-expiring-0001',
    body: { doctor_id: 'doc_arjun', consult_type: 'in_person', start_utc: laterSlot },
  });
  assert.equal(reused.statusCode, 201, reused.body);
  assert.notEqual(bodyOf(reused).appointment.id, bodyOf(first).appointment.id);
  assert.equal(bodyOf(reused).appointment.start_utc, laterSlot);
});
