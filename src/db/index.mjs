/**
 * Database bootstrap. ADR-0005: embedded SQLite, no service to start, cannot fail at demo time.
 * Kept behind this module so the driver can be swapped for Postgres without touching the spine.
 */

import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SCHEMA_PATH = join(HERE, 'schema.sql');
export const DEFAULT_DB_PATH = join(HERE, '..', '..', 'data', 'pharma.db');

export function openDatabase(path = DEFAULT_DB_PATH) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });

  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const schema = readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(schema);
  assertSchemaCurrent(db, schema, path);
  return db;
}

/**
 * D8-2: every CREATE TABLE is `IF NOT EXISTS`, so an on-disk database written before a schema
 * change is silently accepted and then fails deep inside an INSERT ("no column named X") — far
 * from the actual cause. We fail loudly at open time instead, with the fix in the message.
 *
 * This is a development-time drift guard, NOT a migration system. Real migrations arrive with P10.
 */
export function assertSchemaCurrent(db, schema, path) {
  const drift = [];
  const tableRe = /CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\) STRICT;/g;

  for (const [, table, body] of schema.matchAll(tableRe)) {
    const actual = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
    if (actual.size === 0) continue;
    for (const line of body.split('\n')) {
      const m = /^\s{2}(\w+)\s+(TEXT|INTEGER|REAL|BLOB|ANY)\b/.exec(line);
      if (m && !actual.has(m[1])) drift.push(`${table}.${m[1]}`);
    }
  }

  if (drift.length > 0) {
    throw new Error(
      `Database schema is out of date at ${path}. Missing: ${drift.join(', ')}. ` +
      `Delete the file and re-run \`npm run seed\` (the data is reproducible from SEED).`,
    );
  }
}

/** Drop all rows (not the schema) — used by the seeder and tests for a clean, reproducible state. */
export function resetData(db) {
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master
        WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
    )
    .all()
    .map((r) => r.name);

  db.pragma('foreign_keys = OFF');
  // Append-only triggers deliberately block DELETE on ledger tables; drop and recreate instead so
  // that the guarantee holds at runtime while still allowing a clean re-seed.
  const appendOnly = new Set(['audit_event', 'approval', 'guardrail_event']);
  const tx = db.transaction(() => {
    for (const t of tables) {
      if (appendOnly.has(t)) {
        db.exec(`DROP TABLE ${t}`);
      } else {
        db.exec(`DELETE FROM ${t}`);
      }
    }
    db.exec(`DELETE FROM sqlite_sequence WHERE name='audit_event'`);
  });
  tx();
  db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
  db.pragma('foreign_keys = ON');
}
