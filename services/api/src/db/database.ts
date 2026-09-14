/**
 * Database handle.
 *
 * Uses Node 22's built-in `node:sqlite` (no native build step, no Docker, no
 * Postgres). The parts of the production design that carry correctness — UTC
 * storage, a partial unique index, `BEGIN IMMEDIATE` write transactions and
 * write-time re-checks — are all present; what is missing is vertical scale, not
 * integrity.
 */
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { SCHEMA_SQL } from './schema.ts';

export type Db = DatabaseSync;

export type OpenDbOptions = {
  /** File path, or `:memory:` for tests. */
  path?: string;
  verbose?: boolean;
};

const DEFAULT_DB_PATH = resolve(process.cwd(), 'data/medibook.sqlite');

/** Open (and migrate) a database. */
export function openDb(options: OpenDbOptions = {}): Db {
  const path = options.path ?? process.env['MEDIBOOK_DB_PATH'] ?? DEFAULT_DB_PATH;

  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new DatabaseSync(path);

  // WAL gives readers concurrency alongside a writer; not applicable to memory DBs.
  if (path !== ':memory:') {
    try {
      db.exec('PRAGMA journal_mode = WAL;');
    } catch {
      /* WAL unavailable — the default journal still gives ACID semantics. */
    }
  }
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  migrate(db);

  if (options.verbose) {
    console.log(`[db] opened ${path}`);
  }
  return db;
}

/** Create every table and index. Idempotent. */
export function migrate(db: Db): void {
  db.exec(SCHEMA_SQL);
}

/* ------------------------------------------------------------- helpers */

export function prepare(db: Db, sql: string): StatementSync {
  return db.prepare(sql);
}

/**
 * Run `fn` inside `BEGIN IMMEDIATE`.
 *
 * `IMMEDIATE` acquires the write lock up front rather than upgrading mid-way, so
 * two concurrent writers cannot both pass a read-then-write check and only fail
 * at COMMIT. Combined with the partial unique index this is the arbitration the
 * booking path relies on.
 */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* already rolled back by SQLite */
    }
    throw error;
  }
}

/** True when the error came from a SQLite constraint violation (e.g. our partial unique index). */
export function isConstraintError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { errcode?: number }).errcode;
  if (code === 19 || code === 1555 || code === 2067) return true;
  return /UNIQUE constraint failed|constraint failed/i.test(error.message);
}

/** Which index was violated, for logging and precise error mapping. */
export function constraintTarget(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown';
  const match = /UNIQUE constraint failed: ([^\s]+)/i.exec(error.message);
  return match?.[1] ?? 'unknown';
}

/** Small typed query helpers — avoids sprinkling `as` casts through services. */
export function one<T>(db: Db, sql: string, ...params: SqlValue[]): T | undefined {
  return prepare(db, sql).get(...params) as T | undefined;
}

export function all<T>(db: Db, sql: string, ...params: SqlValue[]): T[] {
  return prepare(db, sql).all(...params) as T[];
}

export function run(db: Db, sql: string, ...params: SqlValue[]): { changes: number; lastInsertRowid: number } {
  const result = prepare(db, sql).run(...params);
  return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) };
}

export type SqlValue = string | number | bigint | null | Uint8Array;

/** `0`/`1` for SQLite booleans. */
export function bool(value: boolean): number {
  return value ? 1 : 0;
}

/** Parse a JSON text column with a typed fallback. */
export function json<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
