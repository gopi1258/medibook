/**
 * Business-rule unit tests — PRD §13 (R1, R2, R3, R5, R7, R12, R13, R14, R15).
 * Table-driven so the exact boundaries are visible.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  bookingWindowViolation,
  bufferMinutes,
  cancellationPolicy,
  defaultPlatformConfig,
  effectivePolicy,
  formatDuration,
  formatMoney,
  holdExpiry,
  maxActivePerDoctorPerDayViolation,
  noShowGraceMinutes,
  reschedulePolicy,
  reviewWindow,
  statusForNewBooking,
  toIso,
} from '@medibook/core';

const NOW = Date.parse('2026-09-14T12:00:00Z');
const policy = effectivePolicy({
  min_notice_minutes: 120,
  booking_window_days: 60,
  reschedule_min_hours: 4,
  max_reschedules: 2,
  no_show_grace_minutes_video: 10,
  no_show_grace_minutes_clinic: 15,
  buffer_minutes: 5,
});

const at = (offsetMs: number): string => toIso(NOW + offsetMs);

/* --------------------------------------------------------------------- R1 */

test('R1 booking window (inclusive at min-notice and horizon)', () => {
  const cases: Array<{ name: string; startUtc: string; code: string | null }> = [
    { name: 'in the past', startUtc: at(-MINUTE_MS), code: 'APT_SLOT_PAST' },
    { name: 'exactly min-notice', startUtc: at(120 * MINUTE_MS), code: null },
    { name: 'one minute inside min-notice', startUtc: at(119 * MINUTE_MS), code: 'APT_MIN_NOTICE' },
    { name: 'exactly the horizon', startUtc: at(60 * DAY_MS), code: null },
    { name: 'one minute past the horizon', startUtc: at(60 * DAY_MS + MINUTE_MS), code: 'APT_OUTSIDE_WINDOW' },
  ];
  for (const entry of cases) {
    const violation = bookingWindowViolation({ startUtc: entry.startUtc, nowMs: NOW, policy });
    assert.equal(violation?.code ?? null, entry.code, entry.name);
  }
});

/* --------------------------------------------------------------------- R2 */

test('R2 cancellation refund tiers', () => {
  const fee = 60_000;
  const cases: Array<{ name: string; offset: number; percent: 0 | 50 | 100; refund: number }> = [
    { name: 'exactly 24h', offset: 24 * HOUR_MS, percent: 100, refund: fee },
    { name: '24h − 1min', offset: 24 * HOUR_MS - MINUTE_MS, percent: 50, refund: fee / 2 },
    { name: 'exactly 2h', offset: 2 * HOUR_MS, percent: 50, refund: fee / 2 },
    { name: '2h − 1min', offset: 2 * HOUR_MS - MINUTE_MS, percent: 0, refund: 0 },
  ];
  for (const entry of cases) {
    const result = cancellationPolicy({
      startUtc: at(entry.offset),
      nowMs: NOW,
      feeMinor: fee,
      currency: 'INR',
      actor: 'patient',
    });
    assert.equal(result.refund_percent, entry.percent, entry.name);
    assert.equal(result.refund_minor, entry.refund, `${entry.name}: refund_minor`);
    assert.equal(result.rule, 'R2');
  }
});

test('R2 a free consultation refunds nothing but still reads 100%', () => {
  const result = cancellationPolicy({
    startUtc: at(48 * HOUR_MS),
    nowMs: NOW,
    feeMinor: 0,
    currency: 'INR',
    actor: 'patient',
  });
  assert.equal(result.refund_percent, 100);
  assert.equal(result.refund_minor, 0);
  assert.match(result.summary, /free/i);
});

test('R8 doctor/admin cancellations always refund 100% regardless of timing', () => {
  for (const actor of ['doctor', 'admin'] as const) {
    for (const offset of [1 * MINUTE_MS, 3 * HOUR_MS, 48 * HOUR_MS]) {
      const result = cancellationPolicy({
        startUtc: at(offset),
        nowMs: NOW,
        feeMinor: 60_000,
        currency: 'INR',
        actor,
      });
      assert.equal(result.refund_percent, 100);
      assert.equal(result.refund_minor, 60_000);
      assert.equal(result.rule, 'R8');
    }
  }
});

/* --------------------------------------------------------------------- R3 */

test('R3 reschedule limits and notice', () => {
  const limit = reschedulePolicy({ startUtc: at(48 * HOUR_MS), nowMs: NOW, policy, rescheduleCount: 2 });
  assert.equal(limit.allowed, false);
  assert.equal(limit.reason_code, 'APT_RESCHEDULE_LIMIT');
  assert.equal(limit.remaining_reschedules, 0);

  const exactly = reschedulePolicy({ startUtc: at(4 * HOUR_MS), nowMs: NOW, policy, rescheduleCount: 0 });
  assert.equal(exactly.allowed, true);
  assert.equal(exactly.remaining_reschedules, 2);

  const tooLate = reschedulePolicy({ startUtc: at(4 * HOUR_MS - MINUTE_MS), nowMs: NOW, policy, rescheduleCount: 0 });
  assert.equal(tooLate.allowed, false);
  assert.equal(tooLate.reason_code, 'APT_RESCHEDULE_TOO_LATE');
  assert.equal(tooLate.remaining_reschedules, 2);

  const onceMore = reschedulePolicy({ startUtc: at(48 * HOUR_MS), nowMs: NOW, policy, rescheduleCount: 1 });
  assert.equal(onceMore.allowed, true);
  assert.equal(onceMore.remaining_reschedules, 1);
});

/* --------------------------------------------------------------------- R5 */

test('R5 buffer clamps to 0…30 minutes', () => {
  assert.equal(bufferMinutes({ ...policy, buffer_minutes: -5 }), 0);
  assert.equal(bufferMinutes({ ...policy, buffer_minutes: 45 }), 30);
  assert.equal(bufferMinutes({ ...policy, buffer_minutes: 7 }), 7);
});

/* --------------------------------------------------------------------- R7 */

test('R7 no-show grace is per consult type', () => {
  assert.equal(noShowGraceMinutes('video', policy), 10);
  assert.equal(noShowGraceMinutes('in_person', policy), 15);
  assert.equal(noShowGraceMinutes('video', { ...policy, no_show_grace_minutes_video: 12 }), 12);
});

/* -------------------------------------------------------------------- R12 */

test('R12 hold expiry is now + hold_minutes', () => {
  assert.equal(holdExpiry(NOW), NOW + defaultPlatformConfig.hold_minutes * MINUTE_MS);
});

/* -------------------------------------------------------------------- R13 */

test('R13 status for a new booking follows the approval mode', () => {
  assert.equal(statusForNewBooking('auto'), 'confirmed');
  assert.equal(statusForNewBooking('manual'), 'pending_approval');
});

/* -------------------------------------------------------------------- R14 */

test('R14 one active booking per doctor per local day', () => {
  const sameDay = maxActivePerDoctorPerDayViolation({
    startUtc: at(48 * HOUR_MS),
    existingStartUtcList: [at(72 * HOUR_MS)],
    existingLocalDates: ['2026-09-16'],
    startLocalDate: '2026-09-16',
  });
  assert.equal(sameDay?.code, 'APT_ALREADY_BOOKED_WITH_DOCTOR');

  const otherDay = maxActivePerDoctorPerDayViolation({
    startUtc: at(48 * HOUR_MS),
    existingStartUtcList: [at(72 * HOUR_MS)],
    existingLocalDates: ['2026-09-16'],
    startLocalDate: '2026-09-17',
  });
  assert.equal(otherDay, null);

  const raisedLimit = maxActivePerDoctorPerDayViolation({
    startUtc: at(48 * HOUR_MS),
    existingStartUtcList: [at(72 * HOUR_MS)],
    existingLocalDates: ['2026-09-16'],
    startLocalDate: '2026-09-16',
    limit: 2,
  });
  assert.equal(raisedLimit, null);
});

/* -------------------------------------------------------------------- R15 */

test('R15 review create/edit windows', () => {
  const completed = toIso(NOW);
  const within = reviewWindow(completed, NOW + 23 * HOUR_MS);
  assert.equal(within.canCreate, true);
  assert.equal(within.canEdit, true);

  const afterEdit = reviewWindow(completed, NOW + 25 * HOUR_MS);
  assert.equal(afterEdit.canCreate, true);
  assert.equal(afterEdit.canEdit, false);

  const afterCreate = reviewWindow(completed, NOW + 32 * DAY_MS);
  assert.equal(afterCreate.canCreate, false);
  assert.equal(afterCreate.closesAtUtc, new Date(NOW + defaultPlatformConfig.review_edit_hours * HOUR_MS).toISOString());
});

/* ---------------------------------------------------------------- formatting */

test('formatMoney renders currency symbols and fallbacks', () => {
  assert.equal(formatMoney(60_000, 'INR'), '₹600');
  assert.equal(formatMoney(1_250, 'USD'), '$12.50');
  assert.equal(formatMoney(500, 'XYZ'), '5 XYZ');
});

test('formatDuration renders minutes, hours and days', () => {
  assert.equal(formatDuration(30), '30 minutes');
  assert.equal(formatDuration(60), '1 hour');
  assert.equal(formatDuration(120), '2 hours');
  assert.equal(formatDuration(60 * 24), '1 day');
  assert.equal(formatDuration(60 * 48), '2 days');
});
