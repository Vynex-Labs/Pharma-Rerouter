/**
 * P4 verification — schema, seed, snapshots.
 * Traces: REQ-028 (DA-2), REQ-100, REQ-101, REQ-102, REQ-103, REQ-104, REQ-105, NFR-004.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/index.mjs';
import { seedDatabase } from '../src/db/seed.mjs';
import { captureSnapshot, loadSnapshot, computeDecisionPayloadHash } from '../src/core/snapshot.mjs';

function seeded() {
  const db = openDatabase(':memory:');
  seedDatabase(db);
  return db;
}

test('REQ-101 / NFR-004: seeding twice from the same seed is byte-identical', () => {
  const a = seeded();
  const b = seeded();
  const s1 = captureSnapshot(a);
  const s2 = captureSnapshot(b);
  assert.equal(s1.snapshotHash, s2.snapshotHash, 'seeded network must be reproducible');
});

test('REQ-102: the flagship network is complete', () => {
  const db = seeded();
  const count = (t) => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
  assert.equal(count('facility'), 14);
  assert.ok(count('lane') >= 15);
  assert.equal(count('product'), 2);
  assert.ok(count('inventory_lot') >= 8);
  assert.ok(count('order_line') >= 7);
  assert.ok(count('shipment') >= 4);
  assert.equal(count('disruption_event'), 1);

  // every tier of the pharma chain is present
  const tiers = db.prepare('SELECT DISTINCT type FROM facility ORDER BY type').all().map((r) => r.type);
  assert.deepEqual(tiers, ['DC', 'HOSPITAL', 'MANUFACTURER', 'SUPPLIER', 'WAREHOUSE']);
});

test('flagship scenario is genuinely non-trivial: no option wins on every axis', () => {
  const db = seeded();
  const air = db.prepare("SELECT * FROM lane WHERE id='LN-AIR-EXPRESS'").get();
  const sea = db.prepare("SELECT * FROM lane WHERE id='LN-SEA-PRIMARY'").get();
  const altPort = db.prepare("SELECT * FROM lane WHERE id='LN-SEA-ALTPORT'").get();
  const inland = db.prepare("SELECT * FROM lane WHERE id='LN-ROAD-SOUTH-CENTRAL'").get();
  const vax = db.prepare("SELECT * FROM product WHERE id='PRD-VAX-01'").get();

  assert.ok(air.transit_hours < sea.transit_hours, 'air must be faster');
  assert.ok(air.cost_per_unit_minor > sea.cost_per_unit_minor * 5, 'air must be much dearer');
  assert.ok(air.capacity_units < sea.capacity_units, 'air must be capacity-limited');

  // DE-1 setup: the alternate-port route must BREACH the cold-chain budget so REQ-022 has teeth.
  const altExcursion = altPort.excursion_hours + inland.excursion_hours;
  assert.ok(
    altExcursion > vax.max_excursion_hours,
    `alt-port excursion ${altExcursion}h must exceed budget ${vax.max_excursion_hours}h`,
  );
  // ...while air must stay within it, otherwise every option is infeasible and the demo is dead.
  assert.ok(air.excursion_hours < vax.max_excursion_hours);
});

test('REQ-103: lots carry expiry and some expire inside the planning horizon', () => {
  const db = seeded();
  const lots = db.prepare('SELECT * FROM inventory_lot').all();
  assert.ok(lots.every((l) => typeof l.expiry_date === 'string' && l.expiry_date.length === 10));

  const soon = db
    .prepare("SELECT COUNT(*) c FROM inventory_lot WHERE expiry_date < '2026-09-21'")
    .get().c;
  assert.ok(soon >= 1, 'shelf-life netting must actually change an answer, or REQ-012 is untested');
});

test('REQ-104 / DE-2: the alternate supplier is unqualified for EU', () => {
  const db = seeded();
  const alt = db
    .prepare("SELECT * FROM supplier_product WHERE supplier_id='SUP-ALT' AND product_id='PRD-VAX-01'")
    .get();
  assert.ok(!alt.qualified_markets.split(',').includes('EU'), 'must enable a BLOCKED outcome');

  const primary = db
    .prepare("SELECT * FROM supplier_product WHERE supplier_id='SUP-PRIMARY' AND product_id='PRD-VAX-01'")
    .get();
  assert.ok(primary.qualified_markets.split(',').includes('EU'));
});

test('REQ-105: no personal or patient data exists in the schema', () => {
  const db = seeded();
  const cols = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .flatMap((t) => db.prepare(`PRAGMA table_info(${t.name})`).all().map((c) => `${t.name}.${c.name}`));

  const forbidden = /patient|ssn|dob|birth|email|phone|address_line|national_id/i;
  const hits = cols.filter((c) => forbidden.test(c));
  assert.deepEqual(hits, [], `personal-data-shaped columns found: ${hits.join(', ')}`);
});

test('REQ-100: every domain table carries a data classification', () => {
  const db = seeded();
  for (const t of ['facility', 'lane', 'product', 'inventory_lot', 'order_line', 'shipment']) {
    const row = db.prepare(`SELECT data_classification FROM ${t} LIMIT 1`).get();
    assert.ok(
      ['REAL', 'SIMULATED', 'SYNTHETIC', 'ASSUMED'].includes(row.data_classification),
      `${t} has an invalid classification`,
    );
  }
  const supplier = db.prepare('SELECT data_classification FROM supplier_product LIMIT 1').get();
  assert.equal(supplier.data_classification, 'ASSUMED', 'qualification rules are ASSUMED, not fact');
});

test('REQ-072: seeded stock is labelled SIMULATED, never live SAP', () => {
  const db = seeded();
  const sources = db.prepare('SELECT DISTINCT data_source FROM inventory_lot').all().map((r) => r.data_source);
  assert.deepEqual(sources, ['SIMULATED']);
});

test('DA-2 / REQ-028: snapshots are stable, reloadable and change when reality changes', () => {
  const db = seeded();
  const first = captureSnapshot(db, { disruptionId: 'DSR-0001' });
  const again = captureSnapshot(db, { disruptionId: 'DSR-0001' });
  assert.equal(first.snapshotHash, again.snapshotHash, 'identical state must hash identically');

  const reloaded = loadSnapshot(db, first.id);
  assert.equal(reloaded.snapshotHash, first.snapshotHash);
  assert.ok(reloaded.payload.facilities.length > 0);

  db.prepare("UPDATE inventory_lot SET quantity_units = quantity_units - 1 WHERE id='LOT-C-001'").run();
  const after = captureSnapshot(db, { disruptionId: 'DSR-0001' });
  assert.notEqual(after.snapshotHash, first.snapshotHash, 'state change must move the hash');
});

test('REQ-051: the decision payload hash goes stale when the snapshot moves', () => {
  const db = seeded();
  const snap = captureSnapshot(db);
  const args = {
    decisionId: 'DEC-1',
    selectedScenarioId: 'SCN-1',
    snapshotHash: snap.snapshotHash,
    actions: [{ type: 'REROUTE', laneId: 'LN-AIR-EXPRESS' }],
    policyVersion: '1.0.0',
  };
  const h1 = computeDecisionPayloadHash(args);
  assert.equal(h1, computeDecisionPayloadHash({ ...args }), 'must be stable');

  db.prepare("UPDATE shipment SET status='HELD', version=version+1 WHERE id='SHP-1001'").run();
  const moved = captureSnapshot(db);
  const h2 = computeDecisionPayloadHash({ ...args, snapshotHash: moved.snapshotHash });
  assert.notEqual(h1, h2, 'a stale approval must be detectable via hash mismatch');
});

test('REQ-040: append-only protection is declared for every integrity-critical table', () => {
  // A BEFORE UPDATE trigger cannot fire on an empty table, so asserting "throws" against an
  // unseeded `approval` table would be a test that passes for the wrong reason. Assert the
  // guarantee is actually declared in the schema instead; enforcement itself is proven
  // against populated data in tests/audit.test.mjs.
  const db = seeded();
  const triggers = db
    .prepare("SELECT name FROM sqlite_master WHERE type='trigger'")
    .all()
    .map((r) => r.name);

  for (const expected of [
    'audit_event_no_update',
    'audit_event_no_delete',
    'approval_no_update',
    'approval_no_delete',
    'guardrail_no_delete',
  ]) {
    assert.ok(triggers.includes(expected), `missing append-only trigger: ${expected}`);
  }
});
