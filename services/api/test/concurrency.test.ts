/**
 * Concurrency — the release-blocking gate from TRD §10.2 / §13 / §15.
 *
 * Boots a *real* HTTP server (not `inject`) and races bookings at it, so the
 * partial unique index and the write-time re-check are exercised end to end:
 *
 *   1. 200 parallel bookings on one slot → exactly 1×201, 199×409, no double
 *      booking, no phantom money, no 5xx;
 *   2. two patients racing a hold on one slot → exactly 1 winner;
 *   3. 25 parallel bookings sharing one hold → exactly 1 appointment.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

import { addDaysToDate, dateInZone, defaultPlatformConfig } from '@medibook/core';

import { buildServer } from '../src/server.ts';
import { openDb, type Db } from '../src/db/database.ts';
import { seedDatabase } from '../src/seed.ts';

// R14 (one active booking per patient, per doctor, per local day) is evaluated
// *before* the slot check in the frozen booking service. Once the first booking
// commits, every later request from the same patient would fail with
// APT_ALREADY_BOOKED_WITH_DOCTOR instead of reaching the slot arbitration the
// race is about. The daily cap is a platform-configurable knob (ADM-011), so we
// raise it for this file to isolate the double-booking guarantee under test.
defaultPlatformConfig.max_active_per_doctor_per_day = 1000;

const TZ = 'Asia/Kolkata';
const DOCTOR_ID = 'doc_arjun';

let app: ReturnType<typeof buildServer>;
let db: Db;
let baseUrl: string;

type Outcome = { status: number; body: any };

async function api(
  method: string,
  path: string,
  options: { token?: string; body?: unknown; key?: string } = {},
): Promise<Outcome> {
  const headers: Record<string, string> = {};
  if (options.token) headers['authorization'] = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.key) headers['idempotency-key'] = options.key;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await res.text();
  return { status: res.status, body: text.length > 0 ? JSON.parse(text) : undefined };
}

/** Fire a batch of requests simultaneously and collect every outcome. */
async function fireAll(
  count: number,
  build: (index: number) => Promise<Response>,
): Promise<Outcome[]> {
  const requests = Array.from({ length: count }, (_, index) => build(index));
  const settled = await Promise.allSettled(requests);
  return Promise.all(
    settled.map(async (entry) => {
      if (entry.status === 'rejected') return { status: 0, body: null };
      const res = entry.value;
      const text = await res.text();
      return { status: res.status, body: text.length > 0 ? JSON.parse(text) : undefined };
    }),
  );
}

async function login(destination: string, register = false): Promise<any> {
  const requested = await api('POST', '/v1/auth/otp/request', {
    body: { channel: 'phone', destination, purpose: register ? 'register' : 'login', role: 'patient' },
  });
  assert.equal(requested.status, 200, JSON.stringify(requested.body));
  const code = requested.body.dev_code;
  const verified = await api('POST', '/v1/auth/otp/verify', {
    body: { channel: 'phone', destination, code, role: 'patient', ...(register ? { register: true } : {}) },
  });
  assert.equal(verified.status, 201, JSON.stringify(verified.body));
  return verified.body;
}

/** Distinct open slots from distinct clinic-local days. */
async function openSlots(token: string, fromOffset: number, toOffset: number, count: number) {
  const from = addDaysToDate(dateInZone(Date.now(), TZ), fromOffset);
  const to = addDaysToDate(from, toOffset);
  const res = await api('GET', `/v1/doctors/${DOCTOR_ID}/availability?from=${from}&to=${to}&type=in_person`, {
    token,
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const picked: Array<{ date: string; start: string }> = [];
  for (const day of res.body.days as Array<{ date: string; slots: any[] }>) {
    const slot = day.slots.find((candidate) => candidate.status === 'available');
    if (slot) picked.push({ date: day.date, start: slot.start_utc });
    if (picked.length >= count) break;
  }
  assert.ok(picked.length >= count, `expected ${count} open days, found ${picked.length}`);
  return picked;
}

function activeCount(doctorId: string, startUtc: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count FROM appointments
        WHERE doctor_id = ? AND start_utc = ?
          AND status IN ('held','pending_approval','confirmed','in_progress')`,
    )
    .get(doctorId, startUtc) as { count: number };
  return Number(row.count);
}

function totalCount(doctorId: string, startUtc: string): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS count FROM appointments WHERE doctor_id = ? AND start_utc = ?`)
    .get(doctorId, startUtc) as { count: number };
  return Number(row.count);
}

before(async () => {
  db = openDb({ path: ':memory:' });
  seedDatabase(db, Date.now(), { reset: true });
  app = buildServer({ db, devOtpEcho: true, logger: false });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await app.close();
  db.close();
});

test('200 parallel bookings on one slot resolve to exactly one winner', async () => {
  const patient = await login('+919812345678');
  const token = patient.access_token;
  const [slot] = await openSlots(token, 8, 14, 1);

  const N = 200;
  const responses = await fireAll(N, (index) =>
    fetch(`${baseUrl}/v1/appointments`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'idempotency-key': `race-200-key-${String(index).padStart(4, '0')}`,
      },
      body: JSON.stringify({ doctor_id: DOCTOR_ID, consult_type: 'in_person', start_utc: slot.start }),
    }),
  );

  const ok = responses.filter((entry) => entry.status === 201);
  const conflicts = responses.filter((entry) => entry.status === 409);
  const slotTaken = conflicts.filter((entry) => entry.body?.error?.code === 'APT_SLOT_TAKEN');
  const withoutAlternatives = slotTaken.filter(
    (entry) => !Array.isArray(entry.body?.error?.details?.alternatives) || entry.body.error.details.alternatives.length === 0,
  );
  const serverErrors = responses.filter((entry) => entry.status >= 500);

  console.log(
    `[concurrency] 200 parallel bookings → ${ok.length} succeeded, ${conflicts.length} conflicted (${slotTaken.length} APT_SLOT_TAKEN, ${withoutAlternatives.length} missing alternatives)`,
  );

  assert.equal(ok.length, 1, `exactly one 201 (got ${ok.length})`);
  assert.equal(conflicts.length, 199, `exactly 199 conflicts (got ${conflicts.length})`);
  assert.equal(slotTaken.length, 199, `exactly 199 APT_SLOT_TAKEN (got ${slotTaken.length})`);
  assert.equal(
    withoutAlternatives.length,
    0,
    `${withoutAlternatives.length} of ${slotTaken.length} conflicts lacked non-empty alternatives`,
  );
  assert.equal(serverErrors.length, 0, `no 5xx responses (got ${serverErrors.length})`);

  assert.equal(activeCount(DOCTOR_ID, slot.start), 1, 'exactly one active appointment for the slot');
  assert.equal(totalCount(DOCTOR_ID, slot.start), 1, 'exactly one appointment row for the slot');

  const winnerId = ok[0]!.body.appointment.id as string;
  const payments = db
    .prepare(`SELECT COUNT(*) AS count FROM payments WHERE appointment_id = ?`)
    .get(winnerId) as { count: number };
  assert.equal(Number(payments.count), 1, 'exactly one payment row for the winner (no phantom money)');
});

test('two patients racing a hold on one slot yield exactly one active hold', async () => {
  const patientA = await login('+919899100001', true);
  const patientB = await login('+919899100002', true);
  const [slot] = await openSlots(patientA.access_token, 15, 20, 1);

  const responses = await fireAll(2, (index) =>
    fetch(`${baseUrl}/v1/appointments/holds`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${index === 0 ? patientA.access_token : patientB.access_token}`,
      },
      body: JSON.stringify({ doctor_id: DOCTOR_ID, consult_type: 'in_person', start_utc: slot.start }),
    }),
  );

  const successes = responses.filter((entry) => entry.status === 201 || entry.status === 200);
  const conflicts = responses.filter((entry) => entry.status === 409);
  console.log(
    `[concurrency] parallel hold race → ${successes.length} succeeded, ${conflicts.length} conflicted`,
  );
  assert.equal(successes.length, 1, `exactly one hold winner: ${JSON.stringify(responses.map((r) => r.status))}`);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0]!.body.error.code, 'APT_SLOT_TAKEN');

  const holds = db
    .prepare(`SELECT COUNT(*) AS count FROM holds WHERE doctor_id = ? AND start_utc = ? AND status = 'active'`)
    .get(DOCTOR_ID, slot.start) as { count: number };
  assert.equal(Number(holds.count), 1, 'exactly one active hold row');
});

test('25 parallel bookings sharing one hold yield exactly one appointment', async () => {
  const patient = await login('+919899100003', true);
  const token = patient.access_token;
  const [slot] = await openSlots(token, 21, 27, 1);

  const hold = await api('POST', '/v1/appointments/holds', {
    token,
    body: { doctor_id: DOCTOR_ID, consult_type: 'in_person', start_utc: slot.start },
  });
  assert.equal(hold.status, 201, JSON.stringify(hold.body));
  const holdId = hold.body.id as string;

  const K = 25;
  const responses = await fireAll(K, (index) =>
    fetch(`${baseUrl}/v1/appointments`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'idempotency-key': `race-hold-key-${String(index).padStart(4, '0')}`,
      },
      body: JSON.stringify({
        hold_id: holdId,
        doctor_id: DOCTOR_ID,
        consult_type: 'in_person',
        start_utc: slot.start,
      }),
    }),
  );

  const successes = responses.filter((entry) => entry.status === 201);
  const losers = responses.filter((entry) => entry.status !== 201);
  const codes = new Set(losers.map((entry) => entry.body?.error?.code));
  const serverErrors = responses.filter((entry) => entry.status >= 500);

  console.log(
    `[concurrency] 25 parallel bookings on one hold → ${successes.length} succeeded, ${losers.length} rejected (${[...codes].join(', ') || 'none'})`,
  );

  assert.equal(successes.length, 1, `exactly one 201 (got ${successes.length})`);
  assert.equal(serverErrors.length, 0, `no 5xx (got ${serverErrors.length})`);
  for (const entry of losers) {
    assert.ok(
      ['APT_STATE_CONFLICT', 'APT_SLOT_TAKEN'].includes(entry.body?.error?.code),
      `loser answered ${entry.status} ${JSON.stringify(entry.body)}`,
    );
  }

  assert.equal(totalCount(DOCTOR_ID, slot.start), 1, 'exactly one appointment row for the slot');

  const converted = db
    .prepare(`SELECT status FROM holds WHERE id = ?`)
    .get(holdId) as { status: string };
  assert.equal(converted.status, 'converted', 'the hold was converted exactly once');
});
