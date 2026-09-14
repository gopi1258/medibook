# @medibook/api

Local backend for MediBook: Fastify + `node:sqlite`, implementing the frozen
service contract in `@medibook/core` (`packages/core/src/http.ts`). No build
step — Node 22 runs the TypeScript directly via type stripping.

```bash
node src/server.ts          # starts on PORT (default 4000), db data/medibook.sqlite
node src/seed.ts --reset     # wipe + load the fixture dataset (idempotent)
node src/seed.ts             # refresh the fixture dataset (idempotent)
npm test                     # node --test test/*.test.ts
npx tsc --noEmit             # typecheck
```

`MEDIBOOK_DB_PATH` overrides the database path.

## Layout

| Path | Purpose |
|---|---|
| `src/server.ts` | `buildServer()` factory, error envelope, trace ids, auth + idempotency helpers, entrypoint |
| `src/routes/*.ts` | One module per domain, mounted under `/v1` by `routes/index.ts` |
| `src/services/*.ts` (frozen) | Domain services: auth, patients, doctors, appointments, notifications |
| `src/db/*` (frozen) | Schema, row mappers, `node:sqlite` handle |
| `src/domain/*` (frozen) | Ids/tokens, business rules re-exports, availability composer |
| `src/seed.ts` | Deterministic fixture dataset derived from the slot engine |
| `test/*.test.ts` | Slot engine, rules, API integration, idempotency, concurrency |

## Contract notes

- **Errors** use the TRD §7.1 envelope `{ error: { code, message, details?, trace_id } }`
  with the status from `errorStatus`. Zod failures → `400 VAL_INVALID` with
  `details.field_errors`; unknown errors → `500 SYS_INTERNAL`.
- **Idempotency**: slot/money writes require `Idempotency-Key` (≥ 8 chars).
  Replays return the stored response verbatim; concurrent same-key requests get
  `409 APT_STATE_CONFLICT` with `details.code = IDEMPOTENT_REPLAY_IN_PROGRESS`.
- **Slot races** always answer `APT_SLOT_TAKEN` with the nearest three
  alternatives; routes re-enrich when the service attaches none (PRD EC-04).
- **`GET /doctors/{id}`** answers `404` for unverified doctors (R10).

## Known deviations from a production build

- Payment authorisation, calendar OAuth/sync and the video room token are
  simulated; no external service is contacted and no provider tokens are stored.
- Admin routes are gated by a simple `X-Admin-Role` header (admin auth is out of
  scope for the mobile deliverable); every write is audit-logged.
- The server disables SQLite FK enforcement on its connection because the frozen
  appointment service records hold-lifecycle rows in `appointment_events` keyed
  by the hold id, which the `appointments` foreign key cannot satisfy. The
  double-booking arbiter — the partial unique index `ux_appointments_doctor_slot`
  — is unaffected.
- The concurrency test raises `defaultPlatformConfig.max_active_per_doctor_per_day`
  so the per-day cap (R14) does not mask the slot arbitration it is asserting.
