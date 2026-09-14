/**
 * Slot-engine unit tests — TRD §10.1 / §10.3 / §15.
 *
 * The engine is pure, so every boundary is asserted directly, including a
 * table-driven DST suite that checks the *local wall time* of the produced UTC
 * instant (not hard-coded UTC strings) wherever wall-clock stability is the point.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DAY_MS,
  MINUTE_MS,
  expandSlots,
  fromIso,
  nearestAlternatives,
  offsetMinutesAt,
  openSlots,
  resolveWallTime,
  timeInZone,
  toIso,
  wallTimeToUtc,
  type Slot,
  type SlotEngineInput,
  type SlotEngineResult,
  type SlotEngineRule,
} from '@medibook/core';

const MONDAY = '2026-09-21'; // weekday 0=Sunday…6=Saturday → 1
const KOLKATA = 'Asia/Kolkata';

function rule(partial: Partial<SlotEngineRule> = {}): SlotEngineRule {
  return {
    weekday: 1,
    startLocalTime: '10:00',
    endLocalTime: '11:00',
    slotMinutes: 20,
    bufferMinutes: 0,
    consultTypes: ['in_person'],
    ...partial,
  };
}

function input(partial: Partial<SlotEngineInput> = {}): SlotEngineInput {
  return {
    timeZone: KOLKATA,
    rules: [rule()],
    fromDate: MONDAY,
    toDate: MONDAY,
    consultType: 'in_person',
    durationMinutes: 20,
    feeMinor: 50_000,
    currency: 'INR',
    nowMs: Date.parse('2026-09-14T00:00:00Z'),
    minNoticeMinutes: 0,
    bookingWindowDays: 60,
    bufferMinutes: 0,
    ...partial,
  };
}

const locals = (result: SlotEngineResult, timeZone = KOLKATA): string[] =>
  result.days.flatMap((day) => day.slots.map((slot) => timeInZone(fromIso(slot.start_utc), timeZone)));

/* ------------------------------------------------------------------ strides */

test('buffer extends the stride between candidate starts', () => {
  const result = expandSlots(input({ rules: [rule({ bufferMinutes: 5 })] }));
  // 10:00, 10:25 (10:50 + 20 would overrun 11:00).
  assert.deepEqual(locals(result), ['10:00', '10:25']);
});

test('a window is half-open and the last slot must end by endLocalTime', () => {
  const result = expandSlots(input({ rules: [rule({ bufferMinutes: 0 })] }));
  assert.deepEqual(locals(result), ['10:00', '10:20', '10:40']);
  const last = openSlots(result).at(-1)!;
  assert.equal(timeInZone(fromIso(last.end_utc), KOLKATA), '11:00');
});

test('slots that start in the past are never returned', () => {
  const start = wallTimeToUtc(MONDAY, '10:00', KOLKATA);
  const result = expandSlots(input({ nowMs: start + MINUTE_MS }));
  assert.equal(openSlots(result).some((slot) => fromIso(slot.start_utc) === start), false);
});

/* ------------------------------------------------------ min notice / horizon */

test('a slot exactly at now + minNotice is bookable (EC-23 inclusive)', () => {
  const startMs = wallTimeToUtc(MONDAY, '10:00', KOLKATA);
  const included = expandSlots(
    input({ nowMs: startMs - 120 * MINUTE_MS, minNoticeMinutes: 120, rules: [rule({ endLocalTime: '10:20' })] }),
  );
  assert.equal(openSlots(included).some((slot) => fromIso(slot.start_utc) === startMs), true);

  const excluded = expandSlots(
    input({ nowMs: startMs - 120 * MINUTE_MS + 1, minNoticeMinutes: 120, rules: [rule({ endLocalTime: '10:20' })] }),
  );
  assert.equal(openSlots(excluded).some((slot) => fromIso(slot.start_utc) === startMs), false);
});

test('a slot exactly at the horizon is bookable; one millisecond beyond is not', () => {
  const startMs = wallTimeToUtc(MONDAY, '10:00', KOLKATA);
  const horizonMs = 60 * DAY_MS;
  const included = expandSlots(
    input({ nowMs: startMs - horizonMs, bookingWindowDays: 60, rules: [rule({ endLocalTime: '10:20' })] }),
  );
  assert.equal(openSlots(included).some((slot) => fromIso(slot.start_utc) === startMs), true);

  const excluded = expandSlots(
    input({ nowMs: startMs - horizonMs - 1, bookingWindowDays: 60, rules: [rule({ endLocalTime: '10:20' })] }),
  );
  assert.equal(openSlots(excluded).some((slot) => fromIso(slot.start_utc) === startMs), false);
});

/* ------------------------------------------------------------- exceptions */

test('a slot inside an exception simply does not exist', () => {
  const startMs = wallTimeToUtc(MONDAY, '10:00', KOLKATA);
  const result = expandSlots(
    input({
      rules: [rule({ endLocalTime: '11:00' })],
      exceptions: [{ startUtc: toIso(startMs), endUtc: toIso(startMs + 20 * MINUTE_MS), kind: 'block' }],
    }),
  );
  const starts = result.days.flatMap((day) => day.slots.map((slot) => slot.start_utc));
  assert.equal(starts.includes(toIso(startMs)), false);
  assert.deepEqual(locals(result), ['10:20', '10:40']);
});

/* ------------------------------------------------------- busy / mine status */

test('busy intervals surface as `taken` with the right blocked_by', () => {
  const startMs = wallTimeToUtc(MONDAY, '10:00', KOLKATA);
  const appointmentBusy = expandSlots(
    input({
      busy: [{ startUtc: toIso(startMs), endUtc: toIso(startMs + 20 * MINUTE_MS), source: 'appointment' }],
    }),
  );
  const takenSlot = appointmentBusy.days
    .flatMap((day) => day.slots)
    .find((slot) => slot.start_utc === toIso(startMs))!;
  assert.equal(takenSlot.status, 'taken');
  assert.equal(takenSlot.blocked_by, 'appointment');

  const calendarBusy = expandSlots(
    input({
      busy: [{ startUtc: toIso(startMs), endUtc: toIso(startMs + 20 * MINUTE_MS), source: 'calendar' }],
    }),
  );
  const calendarSlot = calendarBusy.days
    .flatMap((day) => day.slots)
    .find((slot) => slot.start_utc === toIso(startMs))!;
  assert.equal(calendarSlot.status, 'taken');
  assert.equal(calendarSlot.blocked_by, 'calendar');
});

test('the requesting patient’s own bookings render as `mine`', () => {
  const startMs = wallTimeToUtc(MONDAY, '10:00', KOLKATA);
  const result = expandSlots(input({ mineStartUtcs: [toIso(startMs)] }));
  const mine = result.days.flatMap((day) => day.slots).find((slot) => slot.start_utc === toIso(startMs))!;
  assert.equal(mine.status, 'mine');
});

/* ----------------------------------------------------------------- dedupe */

test('overlapping windows on the same weekday dedupe by start instant', () => {
  const result = expandSlots(
    input({
      rules: [
        rule({ startLocalTime: '10:00', endLocalTime: '11:00', slotMinutes: 20, bufferMinutes: 0 }),
        rule({ startLocalTime: '10:00', endLocalTime: '10:40', slotMinutes: 20, bufferMinutes: 0 }),
      ],
    }),
  );
  const starts = openSlots(result).map((slot) => slot.start_utc);
  assert.equal(starts.length, new Set(starts).size);
  assert.deepEqual(locals(result), ['10:00', '10:20', '10:40']);
});

/* -------------------------------------------------------------------- DST */

test('resolveWallTime classifies exact / ambiguous / gap_shifted wall times', () => {
  const cases: Array<{ name: string; tz: string; date: string; time: string; kind: 'exact' | 'ambiguous' | 'gap_shifted'; local: string }> = [
    { name: 'NY spring-forward gap', tz: 'America/New_York', date: '2026-03-08', time: '02:30', kind: 'gap_shifted', local: '03:30' },
    { name: 'NY ordinary time', tz: 'America/New_York', date: '2026-03-08', time: '10:00', kind: 'exact', local: '10:00' },
    { name: 'NY fall-back overlap', tz: 'America/New_York', date: '2026-11-01', time: '01:30', kind: 'ambiguous', local: '01:30' },
    { name: 'Kolkata no DST', tz: 'Asia/Kolkata', date: '2026-09-21', time: '10:00', kind: 'exact', local: '10:00' },
    { name: 'Sydney spring-forward gap', tz: 'Australia/Sydney', date: '2026-10-04', time: '02:30', kind: 'gap_shifted', local: '03:30' },
    { name: 'Sydney fall-back overlap', tz: 'Australia/Sydney', date: '2026-04-05', time: '02:30', kind: 'ambiguous', local: '02:30' },
  ];

  for (const entry of cases) {
    const resolution = resolveWallTime(entry.date, entry.time, entry.tz);
    assert.equal(resolution.kind, entry.kind, `${entry.name}: kind`);
    assert.equal(timeInZone(resolution.utcMs, entry.tz), entry.local, `${entry.name}: local wall time`);
  }
});

test('fall-back resolves to the first (pre-transition) occurrence', () => {
  const resolution = resolveWallTime('2026-11-01', '01:30', 'America/New_York');
  assert.equal(resolution.kind, 'ambiguous');
  // First occurrence is still on daylight time (−04:00).
  assert.equal(offsetMinutesAt(resolution.utcMs, 'America/New_York'), -240);
  assert.equal(toIso(resolution.utcMs), '2026-11-01T05:30:00Z');
});

test('Asia/Kolkata offset stays +05:30 across the year', () => {
  assert.equal(offsetMinutesAt(Date.parse('2026-01-15T00:00:00Z'), KOLKATA), 330);
  assert.equal(offsetMinutesAt(Date.parse('2026-07-15T00:00:00Z'), KOLKATA), 330);
});

const DST_NOW = Date.parse('2020-01-01T00:00:00Z');
const DST_WINDOW = 4000;

test('expandSlots keeps 10:00 at 10:00 across a DST transition (wall-clock stability)', () => {
  const result = expandSlots({
    ...input({
      timeZone: 'America/New_York',
      fromDate: '2026-03-08',
      toDate: '2026-03-08',
      nowMs: DST_NOW,
      bookingWindowDays: DST_WINDOW,
      rules: [rule({ weekday: 0, startLocalTime: '10:00', endLocalTime: '11:00' })],
    }),
  });
  assert.deepEqual(locals(result, 'America/New_York'), ['10:00', '10:20', '10:40']);
});

test('expandSlots shifts a spring-forward gap slot forward', () => {
  const result = expandSlots(
    input({
      timeZone: 'America/New_York',
      fromDate: '2026-03-08',
      toDate: '2026-03-08',
      nowMs: DST_NOW,
      bookingWindowDays: DST_WINDOW,
      durationMinutes: 20,
      rules: [rule({ weekday: 0, startLocalTime: '02:30', endLocalTime: '02:50' })],
    }),
  );
  assert.deepEqual(locals(result, 'America/New_York'), ['03:30']);
});

test('expandSlots picks the first occurrence for a fall-back overlap', () => {
  const result = expandSlots(
    input({
      timeZone: 'America/New_York',
      fromDate: '2026-11-01',
      toDate: '2026-11-01',
      rules: [rule({ weekday: 0, startLocalTime: '01:30', endLocalTime: '02:30' })],
    }),
  );
  const first = result.days[0]!.slots[0]!;
  assert.equal(timeInZone(fromIso(first.start_utc), 'America/New_York'), '01:30');
  assert.equal(offsetMinutesAt(fromIso(first.start_utc), 'America/New_York'), -240);
});

test('southern-hemisphere DST (Australia/Sydney) shifts and overlaps correctly', () => {
  const spring = expandSlots(
    input({
      timeZone: 'Australia/Sydney',
      fromDate: '2026-10-04',
      toDate: '2026-10-04',
      nowMs: DST_NOW,
      bookingWindowDays: DST_WINDOW,
      rules: [rule({ weekday: 0, startLocalTime: '02:30', endLocalTime: '02:50' })],
    }),
  );
  assert.deepEqual(locals(spring, 'Australia/Sydney'), ['03:30']);

  const fall = expandSlots(
    input({
      timeZone: 'Australia/Sydney',
      fromDate: '2026-04-05',
      toDate: '2026-04-05',
      nowMs: DST_NOW,
      bookingWindowDays: DST_WINDOW,
      rules: [rule({ weekday: 0, startLocalTime: '02:30', endLocalTime: '02:50' })],
    }),
  );
  assert.deepEqual(locals(fall, 'Australia/Sydney'), ['02:30']);
});

/* ----------------------------------------------------- nearestAlternatives */

function slot(startUtc: string): Slot {
  return {
    start_utc: startUtc,
    end_utc: toIso(fromIso(startUtc) + 20 * MINUTE_MS),
    local_start: startUtc,
    status: 'available',
    fee_minor: 0,
    currency: 'INR',
  };
}

test('nearestAlternatives orders by distance then earlier start, excluding the target', () => {
  const result: SlotEngineResult = {
    days: [
      {
        date: MONDAY,
        slots: [slot('2026-09-21T04:30:00Z'), slot('2026-09-21T06:30:00Z'), slot('2026-09-21T03:30:00Z')],
      },
    ],
    diagnostics: { dstAdjustments: [], blockedByBusy: 0, hiddenByPolicy: 0, activeWindows: 1 },
  };

  assert.deepEqual(nearestAlternatives(result, '2026-09-21T05:00:00Z', 2), [
    '2026-09-21T04:30:00Z',
    '2026-09-21T03:30:00Z',
  ]);
  // The taken slot itself is never offered back.
  assert.deepEqual(nearestAlternatives(result, '2026-09-21T04:30:00Z', 3), [
    '2026-09-21T03:30:00Z',
    '2026-09-21T06:30:00Z',
  ]);
});

test('nearestAlternatives ignores non-available slots', () => {
  const result: SlotEngineResult = {
    days: [
      {
        date: MONDAY,
        slots: [
          { ...slot('2026-09-21T04:30:00Z'), status: 'taken' },
          { ...slot('2026-09-21T06:30:00Z'), status: 'mine' },
        ],
      },
    ],
    diagnostics: { dstAdjustments: [], blockedByBusy: 0, hiddenByPolicy: 0, activeWindows: 1 },
  };
  assert.deepEqual(nearestAlternatives(result, '2026-09-21T05:00:00Z', 3), []);
});
