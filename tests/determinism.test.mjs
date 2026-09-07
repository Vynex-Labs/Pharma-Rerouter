/**
 * P10 — determinism, reproducibility and schema drift.
 *
 * ADR-0005 is binding: identical inputs must produce byte-identical outputs. Nothing else in this
 * project means anything if that is false — a ranking that varies between runs cannot be audited,
 * and a snapshot hash that varies cannot bind an approval to what was approved.
 *
 * Also closes the migration/drift item owed since defect D8-2.
 *
 * Traces: ADR-0005, REQ-081, NFR-002 (reproducibility), D8-2.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

import { openDatabase, assertSchemaCurrent } from '../src/db/index.mjs';
import { seedDatabase, SEED_EPOCH } from '../src/db/seed.mjs';
import { captureSnapshot } from '../src/core/snapshot.mjs';
import { assessImpact } from '../src/core/impact.mjs';
import { generateScenarios } from '../src/core/scenarios.mjs';
import { rankScenarios } from '../src/core/scoring.mjs';
import { evaluatePolicy } from '../src/core/policy.mjs';
import { canonicalise as canonical } from '../src/core/canonical.mjs';
import { runPipeline } from '../src/core/pipeline.mjs';
import { AuditLedger } from '../src/core/audit.mjs';
import { MockProvider } from '../src/agents/provider.mjs';

const EXPECTED_SNAPSHOT_HASH =
  '0dfe4d975c82cd743cb2905839e920bbd63d25e1206ee7ff54a077433a65a0b8';

function fresh() {
  const db = openDatabase(':memory:');
  seedDatabase(db);
  return db;
}

// ------------------------------------------------------------------ seed reproducibility

test('the seed is reproducible: two independent builds hash identically', () => {
  const a = captureSnapshot(fresh(), { disruptionId: 'DSR-0001' });
  const b = captureSnapshot(fresh(), { disruptionId: 'DSR-0001' });
  assert.equal(a.snapshotHash, b.snapshotHash, 'two seeded databases must be byte-identical');
});

test('the documented snapshot hash is the one the code actually produces', () => {
  // This is the value cited in README, docs/approvals.md and the P4 approval record.
  // If this test fails, either the fixture changed or the documentation is now lying.
  const { snapshotHash } = captureSnapshot(fresh(), { disruptionId: 'DSR-0001' });
  assert.equal(snapshotHash, EXPECTED_SNAPSHOT_HASH,
    'the published snapshot hash must match the code, or every approval citing it is unverifiable');
});

test('canonical serialisation is stable under key insertion order', () => {
  const a = { zebra: 1, alpha: { y: 2, x: [3, 1, 2] }, mid: null };
  const b = { mid: null, alpha: { x: [3, 1, 2], y: 2 }, zebra: 1 };
  assert.equal(canonical(a), canonical(b),
    'a hash that depends on key order would break every chain verification on re-serialisation');
});

// ------------------------------------------------------------------ engine determinism

test('impact, scenarios, ranking and policy are all deterministic across runs', () => {
  const run = () => {
    const db = fresh();
    const snapshot = captureSnapshot(db, { disruptionId: 'DSR-0001' }).payload;
    const disruption = db.prepare("SELECT * FROM disruption_event WHERE id='DSR-0001'").get();
    const impact = assessImpact(snapshot, disruption, { asOf: SEED_EPOCH });
    const gen = generateScenarios(impact, { asOf: SEED_EPOCH });
    const ranked = rankScenarios(gen.scenarios);
    const policy = evaluatePolicy({ scenario: ranked.ranked[0], impact });
    return canonical({ impact, gen, ranked, policy });
  };

  const first = run();
  for (let i = 0; i < 5; i += 1) {
    assert.equal(run(), first, `run ${i + 2} diverged from run 1`);
  }
});

test('ranking is a total order — no ties are broken by object iteration order', () => {
  const db = fresh();
  const snapshot = captureSnapshot(db, { disruptionId: 'DSR-0001' }).payload;
  const disruption = db.prepare("SELECT * FROM disruption_event WHERE id='DSR-0001'").get();
  const impact = assessImpact(snapshot, disruption, { asOf: SEED_EPOCH });
  const { ranked } = rankScenarios(generateScenarios(impact, { asOf: SEED_EPOCH }).scenarios);

  const ranks = ranked.map((r) => r.rank);
  assert.deepEqual(ranks, [...ranks].sort((x, y) => x - y), 'ranks must be ordered');
  assert.equal(new Set(ranks).size, ranks.length, 'ranks must be unique');
});

test('the full pipeline is deterministic end to end', async () => {
  const run = async () => {
    const db = fresh();
    const r = await runPipeline({
      db, ledger: new AuditLedger(db), provider: new MockProvider(),
      disruptionId: 'DSR-0001', asOf: SEED_EPOCH, systemVersion: '0.6.0',
    });
    // decisionId is a UUID by design; everything that feeds a decision must be stable.
    return canonical({
      state: r.state, trace: r.trace.map((t) => t.step), policy: r.policy,
      ranked: r.ranked, actions: r.actions, snapshotHash: r.snapshot.hash,
    });
  };
  assert.equal(await run(), await run(), 'two identical pipeline runs must agree exactly');
});

test('no engine module reads the clock or Math.random directly', () => {
  // Time and randomness must be injected (asOf / seeded PRNG) or determinism is unprovable.
  const files = [
    'impact.mjs', 'scenarios.mjs', 'scoring.mjs', 'policy.mjs',
    'inventory.mjs', 'network.mjs', 'constraints.mjs',
  ];
  for (const f of files) {
    const src = execFileSync('cat', [`src/core/${f}`], { encoding: 'utf8' })
      .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.doesNotMatch(src, /Math\.random\s*\(/, `${f} must not use Math.random`);

    // A clock read is only acceptable as an INJECTABLE DEFAULT (`now = new Date()...`), never
    // inline in a calculation — otherwise the same inputs yield different outputs on Tuesday.
    const clockReads = src.match(/(?:Date\.now\s*\(|new Date\s*\(\s*\))/g) ?? [];
    const injectedDefaults = src.match(/\bnow\s*=\s*new Date\s*\(\s*\)\.toISOString\(\)/g) ?? [];
    assert.equal(clockReads.length, injectedDefaults.length,
      `${f} reads the clock outside an injectable \`now\` default`);
  }
});

// ------------------------------------------------------------------ schema drift (D8-2)

test('D8-2: opening a database missing a current column fails loudly at open time', () => {
  const db = openDatabase(':memory:');
  // Simulate a database written before `identity_role` gained its role column.
  db.exec('DROP TABLE IF EXISTS identity_role');
  db.exec('CREATE TABLE identity_role (identity_id TEXT NOT NULL) STRICT');

  const schema = execFileSync('cat', ['src/db/schema.sql'], { encoding: 'utf8' });
  assert.throws(
    () => assertSchemaCurrent(db, schema, '/tmp/stale.db'),
    /schema is out of date.*identity_role\.role/s,
    'a stale on-disk database must be rejected at open, not deep inside an INSERT',
  );
});

test('the drift guard names the offending columns and states the fix', () => {
  const db = openDatabase(':memory:');
  db.exec('DROP TABLE IF EXISTS approval_invalidation');
  db.exec('CREATE TABLE approval_invalidation (id TEXT PRIMARY KEY) STRICT');
  const schema = execFileSync('cat', ['src/db/schema.sql'], { encoding: 'utf8' });

  try {
    assertSchemaCurrent(db, schema, '/tmp/stale.db');
    assert.fail('expected drift to be detected');
  } catch (err) {
    assert.match(err.message, /approval_invalidation\./, 'must name the table and column');
    assert.match(err.message, /npm run seed/, 'must tell the operator how to fix it');
  }
});

test('a current database passes the drift guard cleanly', () => {
  const db = fresh();
  const schema = execFileSync('cat', ['src/db/schema.sql'], { encoding: 'utf8' });
  assert.doesNotThrow(() => assertSchemaCurrent(db, schema, ':memory:'));
});

// ------------------------------------------------------------------ money & units (ADR-0005)

test('ADR-0005: no monetary or quantity value is ever a non-integer', () => {
  const db = fresh();
  const snapshot = captureSnapshot(db, { disruptionId: 'DSR-0001' }).payload;
  const disruption = db.prepare("SELECT * FROM disruption_event WHERE id='DSR-0001'").get();
  const impact = assessImpact(snapshot, disruption, { asOf: SEED_EPOCH });
  const { ranked } = rankScenarios(generateScenarios(impact, { asOf: SEED_EPOCH }).scenarios);

  for (const s of ranked) {
    assert.ok(Number.isInteger(s.costDeltaMinor),
      `${s.id} cost must be integer minor units, got ${s.costDeltaMinor}`);
    assert.ok(Number.isInteger(s.ordersProtected), `${s.id} ordersProtected must be an integer`);
    for (const a of s.actions) {
      if ('units' in a) assert.ok(Number.isInteger(a.units), 'action units must be integer');
    }
  }
});

test('every persisted money column holds an INTEGER', () => {
  const db = fresh();
  const cols = db.prepare(`
    SELECT m.name AS tbl, p.name AS col, p.type AS typ
    FROM sqlite_master m, pragma_table_info(m.name) p
    WHERE m.type='table' AND m.name NOT LIKE 'sqlite_%'
      AND (p.name LIKE '%_minor' OR p.name LIKE '%cost%' OR p.name LIKE '%units%')
  `).all();

  assert.ok(cols.length > 0, 'the query must actually find money/quantity columns');
  for (const c of cols) {
    assert.equal(c.typ, 'INTEGER',
      `${c.tbl}.${c.col} is ${c.typ}; floating-point money is banned by ADR-0005`);
  }
});

// ------------------------------------------------------------------ D10-1 lane availability

test('D10-1: a reroute onto a CLOSED lane is INFEASIBLE, never merely expensive', () => {
  const db = fresh();
  db.exec("UPDATE lane SET status='CLOSED'");

  const snapshot = captureSnapshot(db, { disruptionId: 'DSR-0001' }).payload;
  const disruption = db.prepare("SELECT * FROM disruption_event WHERE id='DSR-0001'").get();
  const impact = assessImpact(snapshot, disruption, { asOf: SEED_EPOCH });
  const { scenarios } = generateScenarios(impact, { asOf: SEED_EPOCH });

  const air = scenarios.find((s) => s.strategyType === 'AIR_REROUTE');
  assert.ok(air, 'the air reroute scenario is still generated');
  assert.notEqual(air.feasibility, 'FEASIBLE',
    'recommending a reroute onto a shut lane is the defect this test guards');
  assert.ok(air.constraintCodes.includes('LANE_UNAVAILABLE'), 'the reason must be machine-readable');
  assert.match(air.infeasibilityReason, /unavailable lane/i);

  // And it must not be rankable above a feasible option.
  const { ranked } = rankScenarios(scenarios);
  assert.ok(!ranked.some((s) => s.strategyType === 'AIR_REROUTE'),
    'an infeasible option must never appear in the ranked list');
});

test('D10-1: closing lanes does not change the undisrupted baseline', () => {
  // The fix must be surgical: with lanes open, nothing about the flagship changes.
  const db = fresh();
  const snapshot = captureSnapshot(db, { disruptionId: 'DSR-0001' });
  assert.equal(snapshot.snapshotHash, EXPECTED_SNAPSHOT_HASH);

  const disruption = db.prepare("SELECT * FROM disruption_event WHERE id='DSR-0001'").get();
  const impact = assessImpact(snapshot.payload, disruption, { asOf: SEED_EPOCH });
  const { ranked } = rankScenarios(generateScenarios(impact, { asOf: SEED_EPOCH }).scenarios);
  assert.equal(ranked[0].strategyType, 'AIR_REROUTE', 'the flagship ranking is unchanged');
});
