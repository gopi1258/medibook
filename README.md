# MediBook

A two-sided healthcare appointment platform: a **patient app**, a **doctor app**, and the
**booking API** they both talk to. Everything is TypeScript, everything runs locally with
Node 22+ — no Docker, no Postgres, no Redis, no cloud account, no network at runtime.

The product promise the build is engineered around (PRD §1.6) is:

> Anyone can find the right doctor and book a real appointment in under two minutes — and it
> always holds.

That promise is enforced, not asserted: a doctor's slot can be sold to exactly one patient
even when 200 requests hit it simultaneously (see [Verification](#verification)).

- Product requirements: [`docs/PRD.md`](docs/PRD.md)
- Technical requirements: [`docs/TRD.md`](docs/TRD.md)
- Brand tokens & rules: [`docs/BRAND_SPEC.md`](docs/BRAND_SPEC.md)

---

## Architecture

```
medibook/
├── packages/
│   ├── core/            @medibook/core  — domain layer (shared by both apps AND the API)
│   │   ├── types.ts         the wire vocabulary (TRD §6.2 / §7)
│   │   ├── errors.ts        the error taxonomy + `ApiError` (TRD §7.1)
│   │   ├── rules.ts         PRD §13 business rules as pure functions
│   │   ├── time.ts          UTC + IANA timezone/DST primitives (TRD §10.3)
│   │   ├── slotEngine.ts    deterministic slot expansion (TRD §10.1)
│   │   ├── view.ts          domain → view-model mappers
│   │   ├── api.ts           THE SERVICE CONTRACT (`PatientApi`, `DoctorApi`)
│   │   ├── http.ts          `createHttpApi()` — talks to services/api
│   │   └── mock/            `createMockApi()` — the bundled offline dataset
│   └── brand/           @medibook/brand — the design system
│       ├── tokens.ts / theme.ts / fonts.ts
│       └── components/   24 primitives & domain components (Button, SlotGrid,
│                         AppointmentCard, DoctorCard, CountdownPill, …)
├── services/
│   └── api/             @medibook/api — Fastify + node:sqlite modular monolith
│       ├── src/db/          schema (incl. the double-booking partial unique index)
│       ├── src/domain/      ids, rules, slot composer
│       ├── src/services/    auth, patients, doctors, appointments, notifications
│       ├── src/routes/      one module per domain, covering every contract endpoint
│       ├── src/server.ts    Fastify app factory + startable entry
│       ├── src/seed.ts      idempotent fixture dataset (`--reset` supported)
│       └── test/            63 tests incl. the 200-way booking race
└── apps/
    ├── patient/         @medibook/patient — Expo Router app (PRD §7.1, J1–J8)
    └── doctor/          @medibook/doctor  — Expo Router app (PRD §7.2, J9–J13)
```

### The one seam that matters

Screens depend on **`PatientApi` / `DoctorApi`** and never branch on transport:

| Condition | Implementation | Consequence |
|---|---|---|
| `EXPO_PUBLIC_API_URL` **unset** | `createMockApi()` | fully offline; bundled dataset; same code paths |
| `EXPO_PUBLIC_API_URL` **set** | `createHttpApi()` | real HTTP against `services/api` |

Both implementations return the same types and throw the same `ApiError` class, so "the app
works offline" and "the app works against the server" are the same codebase, not two.

The domain layer is shared three ways — the slot engine, the PRD §13 policy functions and the
timezone utilities are literally the same modules in the mobile apps, the offline mock and the
server. A DST or refund-tier bug cannot exist in one place and not the others.

### Booking integrity (why double-booking is impossible)

Five independent layers, any one of which alone would catch a race (TRD §10.2):

1. a live **hold** — a held slot is excluded from everyone else's availability for 5 minutes;
2. the `ux_appointments_doctor_slot` **partial unique index** on
   `(doctor_id, start_utc) WHERE status IN ('held','pending_approval','confirmed','in_progress')`
   — the database is the final arbiter;
3. `BEGIN IMMEDIATE` + a write-time re-check inside the booking transaction;
4. **idempotency keys** on every slot/money-affecting write, so a client retry after a timeout
   replays instead of duplicating;
5. a booking-time **external-busy re-check**, protecting against a stale availability read.

The loser of a race receives `409 APT_SLOT_TAKEN` **with the nearest open alternatives**
(PRD EC-04), which the apps render in place so the user can book something else immediately.

---

## Install

Requires **Node 22+** (uses `node:sqlite` and native TypeScript type-stripping — no build step).

```bash
cd medibook
npm install
```

npm workspaces installs `packages/*`, `apps/*` and `services/*` together.

---

## Run the API

```bash
npm run api:seed            # create data/medibook.sqlite and seed it (idempotent)
npm run api                 # start on http://localhost:4000 (watch mode)
```

- Base path: **`/v1`**. Health check: `curl http://localhost:4000/v1/health`.
- The database file lives at `services/api/data/medibook.sqlite` and can be relocated with
  `MEDIBOOK_DB_PATH=/tmp/x.sqlite`.
- `npm run api:seed -- --reset` (or `npm --workspace @medibook/api run seed:reset`) wipes and
  re-seeds from scratch.
- Set `MEDIBOOK_DEV_OTP=1` to have `POST /v1/auth/otp/request` echo the code back as
  `dev_code`. Without it the code is only written to the server log — the apps read the echo
  defensively when it is present.

Seeded content (all offline, initials avatars, no remote assets):

- 10 specialisations; **8 verified doctors** across dermatology, general medicine,
  orthopaedics, paediatrics, cardiology, psychiatry, dentistry and neurology, including one
  New York practice (`America/New_York`) so cross-timezone rendering is visible;
- one patient (`Priya Sharma`) with two dependents (a son and a parent);
- existing appointments: upcoming confirmed (in-clinic, video, for a dependent, and one
  waiting on manual approval) plus past completed visits, one cancellation with a refund, and
  a populated day for the signed-in doctor so the Today timeline and stats are non-empty.

---

## Run an app

```bash
npm run patient             # Expo dev server for the patient app
npm run doctor              # Expo dev server for the doctor app
```

Then press `i` / `a` in the Expo CLI, or scan the QR code. Both apps run in **Expo Go** on
SDK 57 and work with **no network at all** — fonts are bundled from `@expo-google-fonts/*` and
every image is either an initials avatar or vector.

The signed-in identities in offline mode are the seeded ones:

- patient app → **Priya Sharma** (`usr_priya`)
- doctor app → **Dr. Arjun Mehta** (`doc_arjun`)

Any 6-digit OTP signs you in (the documented demo code is `123456`).

### Point an app at the API

Copy the example env file and set the URL:

```bash
cp apps/patient/.env.example apps/patient/.env
# then edit it to:
EXPO_PUBLIC_API_URL=http://localhost:4000/v1
```

`EXPO_PUBLIC_*` is inlined by Metro at bundle time, so **restart the dev server** after
changing it. Use your machine's LAN IP (e.g. `http://192.168.1.20:4000/v1`) when running on a
physical device — `localhost` from a phone means the phone.

To run the whole stack together: start the API, seed it, point both apps at it, then request
an OTP and read the code from the API log (or set `MEDIBOOK_DEV_OTP=1`).

---

## Verification

Run these from the repository root. Expected results are stated so a failure is obvious.

```bash
# 1. Every workspace typechecks (strict, no build step)
npm run typecheck

# 2. The API test suite — 63 tests, including the booking-race harness
npm run api:test

# 3. Each app resolves its Expo config
npx expo config --type public --project-dir apps/patient   # (run inside each app dir)

# 4. Strongest offline check: Metro bundles each app for real
cd apps/patient && npx expo export --platform ios --output-dir /tmp/patient-export
cd ../doctor  && npx expo export --platform ios --output-dir /tmp/doctor-export
```

`npm run api:test` includes the headline integrity gate: **200 parallel bookings on one slot
through the real HTTP server must produce exactly 1 success and 199 `APT_SLOT_TAKEN`
conflicts, each carrying alternatives, with exactly one row in the database.** The test prints
its own summary line so the result can be quoted directly.

There are also focused suites for the slot engine (including table-driven DST cases for
`America/New_York` both directions, `Asia/Kolkata` and `Australia/Sydney`), the PRD §13 policy
rules at their exact boundaries, idempotency replay, and a parallel hold-then-book race.

### What the tests do *not* cover

- No React Native component or E2E tests: the apps are verified by typecheck plus a production
  Metro bundle, not by a device farm.
- Calendar OAuth, live payments and WebRTC are simulated — there are no provider credentials
  and no network calls in this build.

---

## Simulated vs. real

Being explicit about this is part of the deliverable.

**Real, load-bearing:**

- the concurrency-safe booking path (partial unique index, `BEGIN IMMEDIATE`, idempotency);
- the slot engine, including buffer/min-notice/horizon/exception/busy-time subtraction;
- DST-safe wall-clock expansion through a single shared tz implementation;
- the full PRD §13 rules engine (refund tiers, reschedule limits, no-show grace, holds);
- OTP auth with attempt caps, lockout, rotating refresh tokens and reuse detection;
- the error taxonomy end to end — the API and the offline mock throw identical `ApiError`s;
- every screen's loading, empty, error-with-retry and disabled/loading button states.

**Simulated in this build:**

- **Payments** — no gateway. No card data is collected or stored; the appointment is created
  before capture, so the TRD §10.6 ordering invariant still holds.
- **Calendar OAuth/sync** — no provider credentials. `POST /calendar/connect` returns a real
  authorization URL shape, the consent screen is local, and busy time is generated
  deterministically. Sync status, conflicts, re-sync and disconnect all behave.
- **Video consults** — no WebRTC vendor. The join window, room-token mint, status transition
  and in-call controls are implemented; the call itself is a placeholder surface.
- **Add-to-calendar** — no native calendar module is bundled, so the handoff reports success
  locally and says so on screen.
- **OTP delivery** — no SMS/email provider. The code is logged (and echoed when
  `MEDIBOOK_DEV_OTP=1`).
- **Doctor verification decisions** — the admin surface exists in the API and is header-gated;
  approvals are not automatic.

**Not built:** the admin web console (PRD §7.3), push notifications, i18n rollout beyond
English strings, and anything on the explicit non-goals list (medical records, insurance,
payouts, chat).

---

## Conventions

- **Strict TypeScript** everywhere; no `any` in domain logic.
- Screens render exclusively through `@medibook/brand` — no raw colours, spacing or font
  sizes. The primary action colour is the brand pink `#EC4899`, never charcoal.
- All times are stored and compared as UTC instants; every rendered time carries an explicit
  timezone label (PRD R9 / X4).
- Server-supplied policy wins: previews shown before confirm come from the API, and the pure
  rules module is shared so an offline preview cannot disagree with the server.
