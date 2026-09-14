/**
 * Slot engine — the deterministic expansion described in TRD §10.1.
 *
 * ```
 * slots(doctor, type, range) =
 *     expand(availabilityRules, type)        // clinic-local wall time → UTC
 *   − availabilityExceptions                  // leaves & blocks
 *   − active appointments (held→in_progress)  // DB
 *   − external busy calendar events           // union of all accounts
 *   − buffer adjustments                      // per doctor config (R5)
 *   − policy filter (min notice, max horizon) // R1
 * ```
 *
 * The function is *pure*: no clock, no I/O, no DB — the caller supplies `nowMs`.
 * It is the single implementation used by the backend, the unit tests and the
 * offline mock API, so a DST bug cannot exist in one place and not the other.
 */
import { defaultPlatformConfig } from './rules.ts';
import {
  MINUTE_MS,
  dateInZone,
  enumerateDates,
  fromIso,
  minutesOfDay,
  offsetMinutesAt,
  resolveWallTime,
  timeInZone,
  timeOfMinutes,
  toIso,
} from './time.ts';
import type { AvailabilityDay, ConsultType, Slot, SlotStatus } from './types.ts';

export type SlotEngineRule = {
  /** 0=Sunday … 6=Saturday, in the clinic's timezone. */
  weekday: number;
  /** `HH:mm` clinic wall-clock, inclusive. */
  startLocalTime: string;
  /** `HH:mm` clinic wall-clock, exclusive. */
  endLocalTime: string;
  slotMinutes: number;
  /** Gap after each appointment (R5). Falls back to `input.bufferMinutes`. */
  bufferMinutes?: number;
  consultTypes: readonly ConsultType[];
  /** Rule is ignored for clinic-local dates before this one. */
  effectiveFrom?: string;
};

export type SlotEngineException = {
  startUtc: string;
  endUtc: string;
  kind?: 'leave' | 'block';
};

export type SlotBusyInterval = {
  startUtc: string;
  endUtc: string;
  /**
   * `appointment` — a platform booking in any active status.
   * `calendar`    — imported external busy time.
   * `hold`        — a live checkout hold by another patient.
   */
  source: 'appointment' | 'calendar' | 'hold';
};

export type SlotEngineInput = {
  /** Clinic IANA timezone — the canonical zone for availability maths (R9). */
  timeZone: string;
  rules: readonly SlotEngineRule[];
  exceptions?: readonly SlotEngineException[];
  busy?: readonly SlotBusyInterval[];
  /** Clinic-local inclusive start date, `YYYY-MM-DD`. */
  fromDate: string;
  /** Clinic-local inclusive end date, `YYYY-MM-DD`. */
  toDate: string;
  consultType: ConsultType;
  /** Appointment duration for this consult type (R4). */
  durationMinutes: number;
  feeMinor: number;
  currency: string;
  /** Server time — the only source of truth for windows (EC-21). */
  nowMs: number;
  minNoticeMinutes?: number;
  bookingWindowDays?: number;
  /** Doctor-level buffer default, used when a rule omits its own (R5). */
  bufferMinutes?: number;
  /** Start instants of the requesting patient's own appointments. */
  mineStartUtcs?: readonly string[];
  /** Keep clinic-local days that end up with zero slots (default `false`). */
  includeEmptyDays?: boolean;
};

export type SlotEngineDiagnostics = {
  /** Human-readable DST canonicalisations that occurred during expansion. */
  dstAdjustments: string[];
  /** Candidate slots dropped because of an existing busy interval. */
  blockedByBusy: number;
  /** Candidate slots dropped by the min-notice / booking-window filter (R1). */
  hiddenByPolicy: number;
  /** Number of rule windows that contributed at least one slot. */
  activeWindows: number;
};

export type SlotEngineResult = {
  days: AvailabilityDay[];
  diagnostics: SlotEngineDiagnostics;
};

/** Half-open overlap test on UTC instants. */
export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function weekdayOfDate(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay();
}

function clampBuffer(value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback;
  return Math.max(0, Math.min(30, resolved));
}

/** `2026-09-20T10:00:00+05:30` — ISO-8601 with the clinic's offset. */
function localIso(utcMs: number, timeZone: string): string {
  const offset = offsetMinutesAt(utcMs, timeZone);
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  const suffix = offset === 0 ? 'Z' : `${sign}${hh}:${mm}`;
  const seconds = new Date(utcMs).getUTCSeconds();
  return `${dateInZone(utcMs, timeZone)}T${timeInZone(utcMs, timeZone)}:${String(seconds).padStart(2, '0')}${suffix}`;
}

type Candidate = { atMs: number; localTime: string; buffer: number };

/**
 * Expand one doctor's availability into concrete slots.
 *
 * Boundary conventions (documented because tests depend on them):
 *  - `[start, end)` half-open everywhere;
 *  - the last slot of a window must *end* by `endLocalTime`;
 *  - a slot exactly at `now + minNoticeMinutes` is bookable (inclusive, EC-23);
 *  - a slot exactly at `now + bookingWindowDays` is bookable;
 *  - a slot whose start has already passed is never returned;
 *  - slots inside an exception are dropped silently (they are not offers *or*
 *    facts — a blocked slot simply does not exist).
 */
export function expandSlots(input: SlotEngineInput): SlotEngineResult {
  const minNoticeMinutes = input.minNoticeMinutes ?? defaultPlatformConfig.min_notice_minutes;
  const bookingWindowDays = input.bookingWindowDays ?? defaultPlatformConfig.booking_window_days;
  const doctorBuffer = clampBuffer(input.bufferMinutes, defaultPlatformConfig.buffer_minutes);
  const durationMinutes = input.durationMinutes;
  const durationMs = durationMinutes * MINUTE_MS;

  const nowMs = input.nowMs;
  const earliestStartMs = nowMs + minNoticeMinutes * MINUTE_MS;
  const latestStartMs = nowMs + bookingWindowDays * 24 * 60 * MINUTE_MS;

  const exceptionIntervals = (input.exceptions ?? []).map((exception) => ({
    start: fromIso(exception.startUtc),
    end: fromIso(exception.endUtc),
  }));

  // Busy intervals padded by the buffer: a booking protects its own time plus
  // the configured turn-around on both sides (R5).
  const busyIntervals = (input.busy ?? []).map((interval) => ({
    start: fromIso(interval.startUtc) - doctorBuffer * MINUTE_MS,
    end: fromIso(interval.endUtc) + doctorBuffer * MINUTE_MS,
    source: interval.source,
  }));

  const mineStarts = new Set((input.mineStartUtcs ?? []).map((iso) => fromIso(iso)));

  const diagnostics: SlotEngineDiagnostics = {
    dstAdjustments: [],
    blockedByBusy: 0,
    hiddenByPolicy: 0,
    activeWindows: 0,
  };

  const dates = enumerateDates(input.fromDate, input.toDate);
  const dayMap = new Map<string, Slot[]>();

  for (const date of dates) {
    const weekday = weekdayOfDate(date);
    const dayRules = input.rules.filter(
      (rule) =>
        rule.weekday === weekday &&
        rule.consultTypes.includes(input.consultType) &&
        (rule.effectiveFrom === undefined || rule.effectiveFrom <= date),
    );
    if (dayRules.length === 0) continue;

    /** Dedupe by start instant when windows overlap. */
    const candidates = new Map<number, Candidate>();

    for (const rule of dayRules) {
      const buffer = clampBuffer(rule.bufferMinutes, doctorBuffer);
      const stride = rule.slotMinutes + buffer;
      if (stride <= 0) continue;

      const windowStart = minutesOfDay(rule.startLocalTime);
      const windowEnd = minutesOfDay(rule.endLocalTime);
      if (windowEnd <= windowStart) continue;

      let contributed = false;
      for (let cursor = windowStart; cursor + durationMinutes <= windowEnd; cursor += stride) {
        const wall = timeOfMinutes(cursor);
        const resolution = resolveWallTime(date, wall, input.timeZone);
        if (resolution.kind !== 'exact' && resolution.note) {
          diagnostics.dstAdjustments.push(`${date} ${wall} ${input.timeZone} — ${resolution.note}`);
        }
        const existing = candidates.get(resolution.utcMs);
        if (existing) {
          existing.buffer = Math.max(existing.buffer, buffer);
        } else {
          candidates.set(resolution.utcMs, { atMs: resolution.utcMs, localTime: wall, buffer });
        }
        contributed = true;
      }
      if (contributed) diagnostics.activeWindows += 1;
    }

    const slots: Slot[] = [];
    const orderedStarts = [...candidates.keys()].sort((a, b) => a - b);

    for (const startMs of orderedStarts) {
      const endMs = startMs + durationMs;

      // Never offer a slot that has already started.
      if (startMs < nowMs) continue;

      // R1 — booking window (min notice + horizon).
      if (startMs < earliestStartMs || startMs > latestStartMs) {
        diagnostics.hiddenByPolicy += 1;
        continue;
      }

      // Leaves & blocks remove the slot from existence.
      const blockedByException = exceptionIntervals.some((interval) =>
        overlaps(startMs, endMs, interval.start, interval.end),
      );
      if (blockedByException) continue;

      const busy = busyIntervals.find((interval) => overlaps(startMs, endMs, interval.start, interval.end));
      if (busy) {
        diagnostics.blockedByBusy += 1;
        slots.push({
          start_utc: toIso(startMs),
          end_utc: toIso(endMs),
          local_start: localIso(startMs, input.timeZone),
          status: 'taken',
          fee_minor: input.feeMinor,
          currency: input.currency,
          blocked_by: busy.source === 'calendar' ? 'calendar' : 'appointment',
        });
        continue;
      }

      const status: SlotStatus = mineStarts.has(startMs) ? 'mine' : 'available';
      slots.push({
        start_utc: toIso(startMs),
        end_utc: toIso(endMs),
        local_start: localIso(startMs, input.timeZone),
        status,
        fee_minor: input.feeMinor,
        currency: input.currency,
      });
    }

    if (slots.length > 0 || input.includeEmptyDays === true) {
      dayMap.set(date, slots);
    }
  }

  const days: AvailabilityDay[] = dates
    .map((date) => ({ date, slots: dayMap.get(date) ?? [] }))
    .filter((day) => day.slots.length > 0 || input.includeEmptyDays === true);

  return { days, diagnostics };
}

/** First open slot in the window, or `null`. */
export function nextAvailableSlot(results: SlotEngineResult): Slot | null {
  for (const day of results.days) {
    const slot = day.slots.find((candidate) => candidate.status === 'available');
    if (slot) return slot;
  }
  return null;
}

/** Every open slot in the window, ascending. */
export function openSlots(results: SlotEngineResult): Slot[] {
  return results.days.flatMap((day) => day.slots.filter((slot) => slot.status === 'available'));
}

/**
 * Up to `count` open slots nearest to `takenStartUtc` — the EC-04 promise of
 * "that slot was just taken, here are the nearest alternatives".
 */
export function nearestAlternatives(
  results: SlotEngineResult,
  takenStartUtc: string,
  count = 3,
): string[] {
  const target = fromIso(takenStartUtc);
  const candidates: Array<{ startUtc: string; distance: number; startMs: number }> = [];
  for (const day of results.days) {
    for (const slot of day.slots) {
      if (slot.status !== 'available') continue;
      const startMs = fromIso(slot.start_utc);
      if (startMs === target) continue;
      candidates.push({ startUtc: slot.start_utc, distance: Math.abs(startMs - target), startMs });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance || a.startMs - b.startMs);
  return candidates.slice(0, count).map((candidate) => candidate.startUtc);
}
