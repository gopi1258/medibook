/**
 * SQLite schema.
 *
 * A faithful local reduction of the PostgreSQL model in TRD §6. The constraint
 * that matters most — the double-booking killer — is reproduced exactly:
 *
 * ```sql
 * CREATE UNIQUE INDEX ux_appointments_doctor_slot
 *   ON appointments (doctor_id, start_utc)
 *   WHERE status IN ('held','pending_approval','confirmed','in_progress');
 * ```
 *
 * All instants are stored as ISO-8601 UTC text (`YYYY-MM-DDTHH:MM:SSZ`) so string
 * ordering equals chronological ordering and no implicit timezone conversion can
 * creep in. `timestamptz` semantics, with the timezone made explicit.
 */
export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

-- ---------------------------------------------------------------- identity --
CREATE TABLE IF NOT EXISTS users (
  id                TEXT PRIMARY KEY,
  role              TEXT NOT NULL CHECK (role IN ('patient','doctor','admin')),
  phone             TEXT UNIQUE,
  email             TEXT UNIQUE,
  display_name      TEXT NOT NULL,
  gender            TEXT,
  dob               TEXT,
  default_timezone  TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  locale            TEXT NOT NULL DEFAULT 'en',
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
  onboarding_state  TEXT NOT NULL DEFAULT 'needs_profile',
  created_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  token_hash   TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id    TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  revoked_at   TEXT,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS otp_challenges (
  destination    TEXT PRIMARY KEY,
  channel        TEXT NOT NULL,
  code           TEXT NOT NULL,
  purpose        TEXT NOT NULL,
  role           TEXT,
  attempts       INTEGER NOT NULL DEFAULT 0,
  expires_at     TEXT NOT NULL,
  locked_until   TEXT,
  last_sent_at   TEXT,
  send_count     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS patient_profiles (
  user_id            TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  emergency_contact  TEXT,
  photo_key          TEXT
);

CREATE TABLE IF NOT EXISTS dependents (
  id                TEXT PRIMARY KEY,
  guardian_user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  relationship      TEXT NOT NULL,
  dob               TEXT NOT NULL,
  gender            TEXT NOT NULL,
  notes             TEXT,
  is_active         INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category   TEXT NOT NULL,
  push       INTEGER NOT NULL DEFAULT 1,
  email      INTEGER NOT NULL DEFAULT 1,
  sms        INTEGER NOT NULL DEFAULT 0,
  critical   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, category)
);

CREATE TABLE IF NOT EXISTS quiet_hours (
  user_id  TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled  INTEGER NOT NULL DEFAULT 1,
  start    TEXT NOT NULL DEFAULT '22:00',
  end      TEXT NOT NULL DEFAULT '07:00'
);

CREATE TABLE IF NOT EXISTS saved_doctors (
  patient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doctor_id       TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  PRIMARY KEY (patient_user_id, doctor_id)
);

-- ----------------------------------------------------------------- catalogue --
CREATE TABLE IF NOT EXISTS specializations (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  slug      TEXT NOT NULL UNIQUE,
  icon      TEXT NOT NULL DEFAULT 'stethoscope',
  is_active INTEGER NOT NULL DEFAULT 1
);

-- ------------------------------------------------------------------- doctors --
CREATE TABLE IF NOT EXISTS doctors (
  id                   TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name         TEXT NOT NULL,
  bio                  TEXT NOT NULL DEFAULT '',
  gender               TEXT NOT NULL DEFAULT 'undisclosed',
  experience_years     INTEGER NOT NULL DEFAULT 0,
  languages            TEXT NOT NULL DEFAULT '[]',
  registration_number  TEXT NOT NULL UNIQUE,
  council              TEXT NOT NULL DEFAULT '',
  country              TEXT NOT NULL DEFAULT 'India',
  clinic_name          TEXT NOT NULL DEFAULT '',
  clinic_address       TEXT NOT NULL DEFAULT '',
  area                 TEXT NOT NULL DEFAULT '',
  clinic_timezone      TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  currency             TEXT NOT NULL DEFAULT 'INR',
  verification_status  TEXT NOT NULL DEFAULT 'pending'
                       CHECK (verification_status IN ('pending','under_review','approved','rejected','suspended')),
  verified_at          TEXT,
  rejection_reason     TEXT,
  deactivation_requested_at TEXT,
  -- Seeded aggregates; real deployments derive these from the reviews table.
  rating_seed          REAL NOT NULL DEFAULT 0,
  review_count_seed    INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS doctor_specializations (
  doctor_id         TEXT NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  specialization_id TEXT NOT NULL REFERENCES specializations(id),
  is_primary        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (doctor_id, specialization_id)
);

CREATE TABLE IF NOT EXISTS qualifications (
  id          TEXT PRIMARY KEY,
  doctor_id   TEXT NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  degree      TEXT NOT NULL,
  institution TEXT NOT NULL,
  year        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS consult_fees (
  id               TEXT PRIMARY KEY,
  doctor_id        TEXT NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  consult_type     TEXT NOT NULL CHECK (consult_type IN ('in_person','video')),
  enabled          INTEGER NOT NULL DEFAULT 1,
  duration_minutes INTEGER NOT NULL,
  fee_minor        INTEGER NOT NULL,
  currency         TEXT NOT NULL,
  UNIQUE (doctor_id, consult_type)
);

CREATE TABLE IF NOT EXISTS doctor_policies (
  doctor_id                     TEXT PRIMARY KEY REFERENCES doctors(id) ON DELETE CASCADE,
  min_notice_minutes            INTEGER,
  booking_window_days           INTEGER,
  reschedule_min_hours          INTEGER,
  max_reschedules               INTEGER,
  approval_mode                 TEXT NOT NULL DEFAULT 'auto' CHECK (approval_mode IN ('auto','manual')),
  approval_auto_decline_minutes INTEGER,
  no_show_grace_minutes_video   INTEGER,
  no_show_grace_minutes_clinic  INTEGER,
  buffer_minutes                INTEGER
);

CREATE TABLE IF NOT EXISTS verification_documents (
  id           TEXT PRIMARY KEY,
  doctor_id    TEXT NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('license','government_id','degree')),
  filename     TEXT NOT NULL,
  uploaded_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS verification_submissions (
  doctor_id        TEXT PRIMARY KEY REFERENCES doctors(id) ON DELETE CASCADE,
  status           TEXT NOT NULL,
  registration_number TEXT NOT NULL,
  council          TEXT NOT NULL,
  country          TEXT NOT NULL,
  specialization_slugs TEXT NOT NULL DEFAULT '[]',
  submitted_at     TEXT,
  reviewed_at      TEXT,
  rejection_reason TEXT
);

-- ---------------------------------------------------------------- availability --
CREATE TABLE IF NOT EXISTS availability_rules (
  id               TEXT PRIMARY KEY,
  doctor_id        TEXT NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  weekday          INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_local_time TEXT NOT NULL,
  end_local_time   TEXT NOT NULL,
  slot_minutes     INTEGER NOT NULL,
  buffer_minutes   INTEGER NOT NULL DEFAULT 5,
  consult_types    TEXT NOT NULL DEFAULT '[]',
  effective_from   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS availability_exceptions (
  id         TEXT PRIMARY KEY,
  doctor_id  TEXT NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  start_utc  TEXT NOT NULL,
  end_utc    TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('leave','block')),
  reason     TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS calendar_accounts (
  id              TEXT PRIMARY KEY,
  doctor_id       TEXT NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL CHECK (provider IN ('google','microsoft','ics')),
  account_email   TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('connected','syncing','error','revoked','expired')),
  -- Production keeps KMS-envelope-encrypted tokens here (TRD §9.5). The local
  -- build stores only a placeholder: no provider tokens are ever issued.
  token_placeholder TEXT,
  last_synced_at  TEXT,
  busy_events_90d INTEGER NOT NULL DEFAULT 0,
  conflicts_open  INTEGER NOT NULL DEFAULT 0,
  connected_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS calendar_events (
  id                 TEXT PRIMARY KEY,
  calendar_account_id TEXT NOT NULL REFERENCES calendar_accounts(id) ON DELETE CASCADE,
  external_id        TEXT NOT NULL,
  start_utc          TEXT NOT NULL,
  end_utc            TEXT NOT NULL,
  is_busy            INTEGER NOT NULL DEFAULT 1,
  -- No titles, attendees or descriptions are stored (PRD CAL-008).
  UNIQUE (calendar_account_id, external_id)
);

-- ---------------------------------------------------------------- appointments --
CREATE TABLE IF NOT EXISTS holds (
  id               TEXT PRIMARY KEY,
  patient_user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doctor_id        TEXT NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  consult_type     TEXT NOT NULL CHECK (consult_type IN ('in_person','video')),
  start_utc        TEXT NOT NULL,
  end_utc          TEXT NOT NULL,
  expires_at       TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('active','released','expired','converted')),
  created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS appointments (
  id               TEXT PRIMARY KEY,
  code             TEXT NOT NULL UNIQUE,
  patient_user_id  TEXT NOT NULL REFERENCES users(id),
  patient_name     TEXT NOT NULL,
  dependent_id     TEXT REFERENCES dependents(id),
  dependent_name   TEXT,
  for_name         TEXT NOT NULL,
  doctor_id        TEXT NOT NULL REFERENCES doctors(id),
  consult_type     TEXT NOT NULL CHECK (consult_type IN ('in_person','video')),
  start_utc        TEXT NOT NULL,
  end_utc          TEXT NOT NULL,
  doctor_timezone  TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN (
                     'held','pending_approval','confirmed','in_progress',
                     'completed','cancelled','no_show','rescheduled')),
  cancelled_by     TEXT,
  cancel_reason    TEXT,
  reschedule_of_id TEXT REFERENCES appointments(id),
  reschedule_count INTEGER NOT NULL DEFAULT 0,
  fee_minor        INTEGER NOT NULL DEFAULT 0,
  currency         TEXT NOT NULL DEFAULT 'INR',
  clinic_name      TEXT,
  clinic_address   TEXT,
  join_url         TEXT,
  patient_note     TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS appointment_events (
  id             TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  from_status    TEXT,
  to_status      TEXT NOT NULL,
  actor_type     TEXT NOT NULL,
  actor_id       TEXT,
  reason         TEXT,
  metadata       TEXT,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id             TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  method         TEXT NOT NULL,
  amount_minor   INTEGER NOT NULL,
  currency       TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('initiated','authorized','captured','failed','refunded')),
  provider_ref   TEXT NOT NULL,
  receipt_url    TEXT,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS refunds (
  id            TEXT PRIMARY KEY,
  payment_id    TEXT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  amount_minor  INTEGER NOT NULL,
  currency      TEXT NOT NULL,
  reason        TEXT NOT NULL,
  tier_percent  INTEGER NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('initiated','processing','completed','failed')),
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reviews (
  id                  TEXT PRIMARY KEY,
  appointment_id      TEXT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  doctor_id           TEXT NOT NULL REFERENCES doctors(id),
  patient_user_id     TEXT NOT NULL REFERENCES users(id),
  patient_display_name TEXT NOT NULL,
  rating              INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment             TEXT,
  status              TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','hidden')),
  created_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category       TEXT NOT NULL,
  channel        TEXT NOT NULL,
  title          TEXT NOT NULL,
  body           TEXT NOT NULL,
  deeplink       TEXT,
  appointment_id TEXT,
  read_at        TEXT,
  sent_at        TEXT NOT NULL,
  created_at     TEXT NOT NULL
);

-- ---------------------------------------------------------------- idempotency --
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key               TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,
  endpoint          TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('in_progress','completed')),
  response_snapshot TEXT,
  created_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          TEXT PRIMARY KEY,
  actor_type  TEXT NOT NULL,
  actor_id    TEXT,
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT,
  before_json TEXT,
  after_json  TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- =====================================================================
-- Integrity constraints — the final arbiter for double-booking (TRD §6.3)
-- =====================================================================
CREATE UNIQUE INDEX IF NOT EXISTS ux_appointments_doctor_slot
  ON appointments (doctor_id, start_utc)
  WHERE status IN ('held','pending_approval','confirmed','in_progress');

CREATE UNIQUE INDEX IF NOT EXISTS ux_holds_active_patient
  ON holds (patient_user_id) WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS ux_holds_active_slot
  ON holds (doctor_id, start_utc) WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS ux_review_appointment
  ON reviews (appointment_id);

CREATE INDEX IF NOT EXISTS ix_appointments_patient_start
  ON appointments (patient_user_id, start_utc);
CREATE INDEX IF NOT EXISTS ix_appointments_doctor_start
  ON appointments (doctor_id, start_utc);
CREATE INDEX IF NOT EXISTS ix_appointments_status
  ON appointments (status);
CREATE INDEX IF NOT EXISTS ix_rules_doctor_weekday
  ON availability_rules (doctor_id, weekday);
CREATE INDEX IF NOT EXISTS ix_exceptions_doctor
  ON availability_exceptions (doctor_id, start_utc);
CREATE INDEX IF NOT EXISTS ix_calendar_events_account
  ON calendar_events (calendar_account_id, start_utc);
CREATE INDEX IF NOT EXISTS ix_notifications_user
  ON notifications (user_id, created_at);
`;

/** Names the tests and logs refer to; kept in one place. */
export const INTEGRITY_INDEXES = [
  'ux_appointments_doctor_slot',
  'ux_holds_active_patient',
  'ux_holds_active_slot',
  'ux_review_appointment',
] as const;

/** Statuses that occupy a doctor's slot (mirrors the partial index predicate). */
export const ACTIVE_STATUSES_SQL = "('held','pending_approval','confirmed','in_progress')";
