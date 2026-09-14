/**
 * @medibook/core — shared domain layer.
 *
 * Owns the vocabulary (types), the time/timezone primitives (TRD §4.1/§10.3),
 * the business rules (PRD §13), the deterministic slot engine (TRD §10.1), the
 * service contract, and the two implementations of it:
 *
 *  - `createHttpApi` — talks to `services/api`;
 *  - `createMockApi` — the bundled offline dataset.
 *
 * Screens depend only on the interfaces, never on which one is wired.
 */

/* contract */
export * from './api.ts';
export * from './types.ts';
export * from './errors.ts';

/* domain logic */
export * from './rules.ts';
export * from './time.ts';
export * from './slotEngine.ts';
export * from './view.ts';

/* implementations */
export { createHttpApi, cryptoRandomIdempotencyKey, type HttpApiOptions, type TokenBundle } from './http.ts';
export {
  createMockApi,
  createMockStore,
  seedAppointments,
  type CreateMockApiOptions,
  type MockApi,
  type MockStore,
} from './mock/index.ts';
export {
  DOCTOR_USER_ID,
  PATIENT_USER_ID,
  seedDoctors,
  specializations,
  scheduleVariants,
  type SeedDoctor,
  type ScheduleVariant,
} from './mock/fixtures.ts';
