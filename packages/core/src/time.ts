/**
 * Time & timezone utilities — the single implementation of TRD §10.3 shared by
 * both mobile apps and the backend.
 *
 * Rules encoded here:
 *  - storage & comparison are always UTC instants (milliseconds);
 *  - weekly availability rules are wall-clock in the *clinic* timezone and are
 *    expanded per calendar date, so 10:00 stays 10:00 across a DST change;
 *  - DST gaps (spring forward) resolve to the shifted-forward instant, DST
 *    overlaps (fall back) resolve to the *first* occurrence — both flagged so
 *    callers can log/display them.
 *
 * Implemented with `Intl.DateTimeFormat` only: no `moment`/`luxon`, and it works
 * in Hermes as well as Node.
 */

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = partsFormatterCache.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  partsFormatterCache.set(timeZone, formatter);
  return formatter;
}

export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** `YYYY-MM-DD` in the target zone. */
  date: string;
  /** `HH:mm` in the target zone (24h). */
  time: string;
};

/** Break a UTC instant into wall-clock parts in `timeZone`. */
export function zonedParts(utcMs: number, timeZone: string): ZonedParts {
  const parts = partsFormatter(timeZone).formatToParts(new Date(utcMs));
  const read: Record<string, number> = {};
  for (const part of parts) {
    if (part.type === 'literal') continue;
    read[part.type] = Number(part.value);
  }
  const hour = read['hour'] === 24 ? 0 : (read['hour'] ?? 0);
  const year = read['year'] ?? 1970;
  const month = read['month'] ?? 1;
  const day = read['day'] ?? 1;
  const minute = read['minute'] ?? 0;
  const second = read['second'] ?? 0;
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    date: `${pad4(year)}-${pad2(month)}-${pad2(day)}`,
    time: `${pad2(hour)}:${pad2(minute)}`,
  };
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function pad4(value: number): string {
  return String(value).padStart(4, '0');
}

/** UTC offset in minutes for `timeZone` at the given instant (east positive). */
export function offsetMinutesAt(utcMs: number, timeZone: string): number {
  const p = zonedParts(utcMs, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - utcMs) / MINUTE_MS);
}

export type WallTimeResolution = {
  utcMs: number;
  /**
   * `exact`      — the wall time exists exactly once.
   * `ambiguous`  — DST fall-back: two instants share it; the first was chosen.
   * `gap_shifted`— DST spring-forward: the wall time does not exist; shifted
   *                forward by the size of the gap.
   */
  kind: 'exact' | 'ambiguous' | 'gap_shifted';
  /** Set for DST edge cases; suitable for logs and availability diagnostics. */
  note?: string;
};

/**
 * Convert a wall-clock date/time in `timeZone` into a UTC instant.
 *
 * This is *the* DST-safe primitive used by the slot engine: a clinic rule of
 * "Monday 10:00" is expanded by calling this with each concrete date, so the
 * instant moves with the offset while the local time stays 10:00.
 */
export function resolveWallTime(
  date: string,
  time: string,
  timeZone: string,
): WallTimeResolution {
  const [yearStr, monthStr, dayStr] = date.split('-');
  const [hourStr, minuteStr] = time.split(':');
  const naive = Date.UTC(
    Number(yearStr ?? 1970),
    Number(monthStr ?? 1) - 1,
    Number(dayStr ?? 1),
    Number(hourStr ?? 0),
    Number(minuteStr ?? 0),
    0,
    0,
  );

  const offsets = new Set<number>();
  for (const delta of [-2 * DAY_MS, -DAY_MS, 0, DAY_MS, 2 * DAY_MS]) {
    offsets.add(offsetMinutesAt(naive + delta, timeZone));
  }

  const candidates: number[] = [];
  for (const offset of offsets) {
    const candidate = naive - offset * MINUTE_MS;
    if (offsetMinutesAt(candidate, timeZone) === offset) candidates.push(candidate);
  }
  candidates.sort((a, b) => a - b);

  const first = candidates[0];
  if (candidates.length === 1 && first !== undefined) {
    return { utcMs: first, kind: 'exact' };
  }
  if (candidates.length > 1 && first !== undefined) {
    return {
      utcMs: first,
      kind: 'ambiguous',
      note: `Local time ${date} ${time} occurs ${candidates.length} times in ${timeZone}; took the first occurrence.`,
    };
  }

  // No valid candidate: the wall time falls inside a DST gap.
  // Using the pre-transition (smaller) offset shifts the result forward by the
  // size of the gap, which is the conventional canonicalisation.
  const minOffset = Math.min(...offsets);
  const shifted = naive - minOffset * MINUTE_MS;
  return {
    utcMs: shifted,
    kind: 'gap_shifted',
    note: `Local time ${date} ${time} does not exist in ${timeZone} (DST gap); shifted forward to ${zonedParts(shifted, timeZone).time}.`,
  };
}

/** Convenience wrapper when the caller does not care about DST diagnostics. */
export function wallTimeToUtc(date: string, time: string, timeZone: string): number {
  return resolveWallTime(date, time, timeZone).utcMs;
}

/** `YYYY-MM-DD` for an instant, in `timeZone`. */
export function dateInZone(utcMs: number, timeZone: string): string {
  return zonedParts(utcMs, timeZone).date;
}

/** `HH:mm` for an instant, in `timeZone`. */
export function timeInZone(utcMs: number, timeZone: string): string {
  return zonedParts(utcMs, timeZone).time;
}

/** Weekday 0=Sunday … 6=Saturday for an instant, in `timeZone`. */
export function weekdayInZone(utcMs: number, timeZone: string): number {
  const day = zonedParts(utcMs, timeZone).date;
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay();
}

/** Local wall-clock minutes since midnight (`HH:mm` → 0…1439). */
export function minutesOfDay(time: string): number {
  const [h, m] = time.split(':');
  return Number(h ?? 0) * 60 + Number(m ?? 0);
}

/** Inverse of {@link minutesOfDay}. */
export function timeOfMinutes(minutes: number): string {
  const normalised = ((minutes % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(normalised / 60))}:${pad2(normalised % 60)}`;
}

/**
 * Enumerate inclusive calendar dates (`YYYY-MM-DD`) between two dates.
 * Pure string arithmetic — no timezone involved, so no DST surprises.
 */
export function enumerateDates(fromDate: string, toDate: string): string[] {
  const dates: string[] = [];
  let cursor = fromDate;
  let guard = 0;
  while (cursor <= toDate && guard < 2000) {
    dates.push(cursor);
    cursor = addDaysToDate(cursor, 1);
    guard += 1;
  }
  return dates;
}

/** Add whole days to a `YYYY-MM-DD` date string. */
export function addDaysToDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days));
  return `${pad4(next.getUTCFullYear())}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`;
}

/** Difference in whole days between two `YYYY-MM-DD` dates (b − a). */
export function diffDays(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const aMs = Date.UTC(ay ?? 1970, (am ?? 1) - 1, ad ?? 1);
  const bMs = Date.UTC(by ?? 1970, (bm ?? 1) - 1, bd ?? 1);
  return Math.round((bMs - aMs) / DAY_MS);
}

/** ISO-8601 UTC string from an instant. */
export function toIso(utcMs: number): string {
  return new Date(utcMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Parse an ISO-8601 instant, tolerating a missing zone (`Z` assumed). */
export function fromIso(iso: string): number {
  const normalised = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
  return Date.parse(normalised);
}

/** Round an instant down to the nearest `stepMinutes` boundary (UTC-aligned). */
export function floorToMinutes(utcMs: number, stepMinutes: number): number {
  const step = stepMinutes * MINUTE_MS;
  return Math.floor(utcMs / step) * step;
}

/**
 * `Asia/Kolkata (GMT+5:30)` — the explicit tz label required everywhere a time
 * is rendered (PRD R9 / X4).
 */
export function tzLabel(timeZone: string, atUtcMs?: number): string {
  const at = atUtcMs ?? Date.now();
  const offset = offsetMinutesAt(at, timeZone);
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  const city = timeZone.split('/').pop() ?? timeZone;
  return `${city.replace(/_/g, ' ')} (GMT${sign}${hours}${minutes ? `:${pad2(minutes)}` : ''})`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** `Sun, 20 Sep` for an instant rendered in `timeZone`. */
export function dayLabel(utcMs: number, timeZone: string): string {
  const p = zonedParts(utcMs, timeZone);
  const weekday = WEEKDAYS[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()] ?? '';
  return `${weekday}, ${p.day} ${MONTHS[p.month - 1] ?? ''}`;
}

/** `20 Sep 2026` for an instant rendered in `timeZone`. */
export function longDateLabel(utcMs: number, timeZone: string): string {
  const p = zonedParts(utcMs, timeZone);
  return `${p.day} ${MONTHS[p.month - 1] ?? ''} ${p.year}`;
}

/** `6:30 PM` for an instant rendered in `timeZone`. */
export function clockLabel(utcMs: number, timeZone: string): string {
  const p = zonedParts(utcMs, timeZone);
  const hour12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  const suffix = p.hour < 12 ? 'AM' : 'PM';
  return `${hour12}:${pad2(p.minute)} ${suffix}`;
}

/** `Today · 6:30 PM` / `Tomorrow · 9:00 AM` / `Sun, 20 Sep · 6:30 PM`. */
export function relativeTimeLabel(utcMs: number, timeZone: string, nowMs?: number): string {
  const now = nowMs ?? Date.now();
  const today = dateInZone(now, timeZone);
  const target = dateInZone(utcMs, timeZone);
  const delta = diffDays(today, target);
  const clock = clockLabel(utcMs, timeZone);
  if (delta === 0) return `Today · ${clock}`;
  if (delta === 1) return `Tomorrow · ${clock}`;
  if (delta === -1) return `Yesterday · ${clock}`;
  return `${dayLabel(utcMs, timeZone)} · ${clock}`;
}

/** `weekdayLabel` / `dayLabel` / `monthLabel` parts used by `DayStrip`. */
export function dayParts(utcMs: number, timeZone: string): { weekdayLabel: string; dayLabel: string; monthLabel: string } {
  const p = zonedParts(utcMs, timeZone);
  return {
    weekdayLabel: WEEKDAYS[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()] ?? '',
    dayLabel: String(p.day),
    monthLabel: MONTHS[p.month - 1] ?? '',
  };
}

/**
 * Human staleness label for availability freshness (`Last synced 2 min ago`).
 * PRD X3 / CAL-002 — honesty about how fresh the data is.
 */
export function stalenessLabel(lastSyncedIso: string | null, nowMs?: number): string | null {
  if (!lastSyncedIso) return null;
  const now = nowMs ?? Date.now();
  const then = fromIso(lastSyncedIso);
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return 'Last synced just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `Last synced ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Last synced ${hours} h ago`;
  const days = Math.round(hours / 24);
  return `Last synced ${days} d ago`;
}

/** ISO-8601 duration like `PT2M` for the availability `staleness` field. */
export function isoDuration(fromIso8601: string, nowMs?: number): string {
  const now = nowMs ?? Date.now();
  const totalSeconds = Math.max(0, Math.round((now - fromIso(fromIso8601)) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  let out = 'PT';
  if (hours) out += `${hours}H`;
  if (minutes) out += `${minutes}M`;
  if (seconds || out === 'PT') out += `${seconds}S`;
  return out;
}

/**
 * Countdown breakdown for the 5-minute hold pill.
 */
export function countdown(expiresAtIso: string, nowMs?: number): { remainingMs: number; expired: boolean } {
  const remainingMs = fromIso(expiresAtIso) - (nowMs ?? Date.now());
  return { remainingMs, expired: remainingMs <= 0 };
}

/**
 * The IANA timezone of the device, falling back to UTC. Used to pick the tz the
 * patient sees times in (their own), independent of the doctor's clinic tz.
 */
export function deviceTimeZone(): string {
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return resolved && resolved.length > 0 ? resolved : 'UTC';
  } catch {
    return 'UTC';
  }
}

/** True when the two zones render this instant differently (needs dual labels). */
export function zonesDiffer(a: string, b: string, atUtcMs?: number): boolean {
  return offsetMinutesAt(atUtcMs ?? Date.now(), a) !== offsetMinutesAt(atUtcMs ?? Date.now(), b);
}
