#!/usr/bin/env node
/**
 * Seed the flagship synthetic network into data/pharma.db.
 * Usage: npm run seed [-- --seed 20260907]
 */

import { openDatabase, resetData, DEFAULT_DB_PATH } from '../src/db/index.mjs';
import { seedDatabase } from '../src/db/seed.mjs';
import { captureSnapshot } from '../src/core/snapshot.mjs';
import { AuditLedger } from '../src/core/audit.mjs';

const seedArg = process.argv.indexOf('--seed');
const seed = seedArg > -1 ? Number(process.argv[seedArg + 1]) : Number(process.env.SEED ?? 20260907);

const db = openDatabase(DEFAULT_DB_PATH);
resetData(db);

const stats = seedDatabase(db, { seed });
const snap = captureSnapshot(db, { disruptionId: 'DSR-0001' });

new AuditLedger(db).append({
  eventType: 'NETWORK_SEEDED',
  actor: 'system:seeder',
  payload: { seed, stats, snapshotId: snap.id, snapshotHash: snap.snapshotHash },
});

console.log('Seeded synthetic network (DATA CLASSIFICATION: SYNTHETIC)');
console.table(stats);
console.log(`database      : ${DEFAULT_DB_PATH}`);
console.log(`snapshot hash : ${snap.snapshotHash}`);
