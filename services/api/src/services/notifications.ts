/**
 * Notification module.
 *
 * Production pushes to BullMQ queues with per-channel adapters (TRD §11). Locally
 * there is no provider, so deliveries are *recorded*: an in-app row is written
 * and the would-be push/email/SMS fan-out is logged. Preference handling, quiet
 * hours and the critical-override rule are all real, because they are policy, not
 * transport.
 */
import type { NotificationCategory, NotificationChannel, NotificationPreference } from '@medibook/core';

import { all, one, run, type Db } from '../db/database.ts';
import { mapNotificationRow } from '../db/mappers.ts';
import { newId } from '../domain/ids.ts';

/** Categories that bypass quiet hours and cannot be muted (PRD §12 delivery rules). */
export const CRITICAL_CATEGORIES: readonly NotificationCategory[] = ['cancellation', 'join_window', 'security'];

export type NotifyInput = {
  userId: string;
  category: NotificationCategory;
  title: string;
  body: string;
  deeplink?: string | null;
  appointmentId?: string | null;
  /** Channels the production fan-out would attempt. */
  channels?: readonly NotificationChannel[];
};

export type DeliveryLog = {
  notificationId: string;
  userId: string;
  category: NotificationCategory;
  /** Channels actually recorded after preference evaluation. */
  attempted: NotificationChannel[];
  suppressed: NotificationChannel[];
  quietHoursApplied: boolean;
};

/**
 * Apply the preference matrix: per-category channel toggles, quiet hours for
 * non-critical classes, and the critical override.
 */
export function evaluateDelivery(input: {
  db: Db;
  userId: string;
  category: NotificationCategory;
  channels: readonly NotificationChannel[];
  nowMs: number;
  timeZone: string;
}): { attempted: NotificationChannel[]; suppressed: NotificationChannel[]; quietHoursApplied: boolean } {
  const { db, userId, category, channels, nowMs, timeZone } = input;

  const preference = one<{ push: number; email: number; sms: number; critical: number }>(
    db,
    `SELECT push, email, sms, critical FROM notification_preferences WHERE user_id = ? AND category = ?`,
    userId,
    category,
  );

  const isCritical = CRITICAL_CATEGORIES.includes(category) || preference?.critical === 1;
  const quiet = one<{ enabled: number; start: string; end: string }>(
    db,
    `SELECT enabled, start, end FROM quiet_hours WHERE user_id = ?`,
    userId,
  );

  const localTime = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(nowMs));

  let quietHoursApplied = false;
  if (quiet && quiet.enabled === 1 && !isCritical) {
    const inWindow =
      quiet.start <= quiet.end
        ? localTime >= quiet.start && localTime < quiet.end
        : localTime >= quiet.start || localTime < quiet.end;
    quietHoursApplied = inWindow;
  }

  const attempted: NotificationChannel[] = [];
  const suppressed: NotificationChannel[] = [];

  for (const channel of channels) {
    if (channel === 'in_app') {
      attempted.push(channel);
      continue;
    }
    const allowedByPreference = !preference
      ? channel !== 'sms'
      : channel === 'push'
        ? preference.push === 1
        : channel === 'email'
          ? preference.email === 1
          : preference.sms === 1;

    if (!allowedByPreference) {
      suppressed.push(channel);
      continue;
    }
    if (quietHoursApplied && channel !== 'sms') {
      suppressed.push(channel);
      continue;
    }
    attempted.push(channel);
  }

  return { attempted, suppressed, quietHoursApplied };
}

/** Record a notification and log the delivery fan-out. */
export function notify(db: Db, input: NotifyInput, nowMs: number, timeZone = 'Asia/Kolkata'): DeliveryLog {
  const channels: NotificationChannel[] = input.channels
    ? [...input.channels]
    : ['in_app', 'push'];

  const evaluation = evaluateDelivery({
    db,
    userId: input.userId,
    category: input.category,
    channels,
    nowMs,
    timeZone,
  });

  const id = newId('ntf');
  const nowIso = iso(nowMs);
  run(
    db,
    `INSERT INTO notifications (id, user_id, category, channel, title, body, deeplink, appointment_id, read_at, sent_at, created_at)
     VALUES (?, ?, ?, 'in_app', ?, ?, ?, ?, NULL, ?, ?)`,
    id,
    input.userId,
    input.category,
    input.title,
    input.body,
    input.deeplink ?? null,
    input.appointmentId ?? null,
    nowIso,
    nowIso,
  );

  if (evaluation.attempted.length > 1 || evaluation.suppressed.length > 0) {
    console.log(
      `[notify] ${input.category} → ${input.userId} · send=${evaluation.attempted.join(',')} · suppressed=${
        evaluation.suppressed.join(',') || 'none'
      }${evaluation.quietHoursApplied ? ' (quiet hours)' : ''}`,
    );
  }

  return {
    notificationId: id,
    userId: input.userId,
    category: input.category,
    attempted: evaluation.attempted,
    suppressed: evaluation.suppressed,
    quietHoursApplied: evaluation.quietHoursApplied,
  };
}

export function listNotifications(
  db: Db,
  userId: string,
  options: { limit?: number; unreadOnly?: boolean } = {},
): { items: ReturnType<typeof mapNotificationRow>[]; unread: number } {
  const limit = Math.min(options.limit ?? 50, 200);
  const rows = options.unreadOnly
    ? all<Parameters<typeof mapNotificationRow>[0]>(
        db,
        `SELECT * FROM notifications WHERE user_id = ? AND read_at IS NULL ORDER BY created_at DESC LIMIT ?`,
        userId,
        limit,
      )
    : all<Parameters<typeof mapNotificationRow>[0]>(
        db,
        `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
        userId,
        limit,
      );

  const unread = one<{ count: number }>(
    db,
    `SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL`,
    userId,
  );

  return { items: rows.map(mapNotificationRow), unread: unread?.count ?? 0 };
}

export function markRead(db: Db, userId: string, notificationId: string, nowMs: number): boolean {
  const result = run(
    db,
    `UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL`,
    iso(nowMs),
    notificationId,
    userId,
  );
  return result.changes > 0;
}

export function markAllRead(db: Db, userId: string, nowMs: number): number {
  return run(db, `UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL`, iso(nowMs), userId)
    .changes;
}

export function updatePreferences(
  db: Db,
  userId: string,
  patch: Partial<NotificationPreference>,
): void {
  if (patch.entries) {
    for (const entry of patch.entries) {
      run(
        db,
        `INSERT INTO notification_preferences (user_id, category, push, email, sms, critical)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, category) DO UPDATE SET push = excluded.push, email = excluded.email, sms = excluded.sms`,
        userId,
        entry.category,
        entry.push ? 1 : 0,
        entry.email ? 1 : 0,
        entry.sms ? 1 : 0,
        entry.critical ? 1 : 0,
      );
    }
  }
  if (patch.quiet_hours) {
    run(
      db,
      `INSERT INTO quiet_hours (user_id, enabled, start, end) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET enabled = excluded.enabled, start = excluded.start, end = excluded.end`,
      userId,
      patch.quiet_hours.enabled ? 1 : 0,
      patch.quiet_hours.start,
      patch.quiet_hours.end,
    );
  }
}

function iso(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}
