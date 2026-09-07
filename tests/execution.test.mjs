/**
 * P10 — bounded execution: the mutation paths.
 *
 * Coverage at the start of P10 showed `execution.mjs` at 78.6% with the INVENTORY_TRANSFER handler,
 * RELEASE_SHIPMENT and the entire rollback path uncovered. That is the code that changes the world;
 * it is the least acceptable place in the system to be guessing.
 *
 * Traces: REQ-050…055, REQ-052 (optimistic concurrency), REQ-054 (failures recorded, not suppressed).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { openDatabase } from '../src/db/index.mjs';
import { seedDatabase, SEED_EPOCH } from '../src/db/seed.mjs';
import { AuditLedger } from '../src/core/audit.mjs';
import {
  ACTION_HANDLERS, executeDecision, mintAuthorization, validateAuthorization,
  AuthorizationError, AUTHORIZATION_TTL_MS,
} from '../src/core/execution.mjs';
import { DecisionMachine } from '../src/core/statemachine.mjs';

const NOW = SEED_EPOCH;

function ctx() {
  const db = openDatabase(':memory:');
  seedDatabase(db);
  return { db, ledger: new AuditLedger(db) };
}

/** Creates an APPROVED decision and mints a real authorization for `actions`. */
function authorized(db, ledger, actions) {
  const machine = new DecisionMachine(db, ledger);
  const decisionId = 'DEC-EXEC-T1';
  db.prepare(
    `INSERT INTO decision (id, disruption_id, state, version, created_at, updated_at, system_version)
     VALUES (?, 'DSR-0001', 'PENDING_APPROVAL', 1, ?, ?, '0.6.0')`,
  ).run(decisionId, NOW, NOW);

  machine.transition(decisionId, 'APPROVED', { expectedVersion: 1, actor: 'test', reason: 'setup' });

  const inputs = {
    decisionId, selectedScenarioId: 'SCN-T1',
    snapshotHash: 'a'.repeat(64), actions, policyVersion: '1.0.0',
  };
  const auth = mintAuthorization(db, ledger, { ...inputs, now: NOW });
  return { decisionId, inputs, auth, machine };
}

// ------------------------------------------------------------------ INVENTORY_TRANSFER

test('INVENTORY_TRANSFER moves stock and conserves total units', () => {
  const { db } = ctx();
  const total = () => db
    .prepare("SELECT COALESCE(SUM(quantity_units),0) n FROM inventory_lot WHERE product_id='PRD-VAX-01' AND status='AVAILABLE'")
    .get().n;

  const from = db.prepare(
    "SELECT facility_id FROM inventory_lot WHERE product_id='PRD-VAX-01' AND status='AVAILABLE' GROUP BY facility_id ORDER BY SUM(quantity_units) DESC LIMIT 1",
  ).get().facility_id;

  const before = total();
  const srcBefore = db.prepare(
    "SELECT COALESCE(SUM(quantity_units),0) n FROM inventory_lot WHERE facility_id=? AND product_id='PRD-VAX-01' AND status='AVAILABLE'",
  ).get(from).n;

  const r = ACTION_HANDLERS.INVENTORY_TRANSFER(db, {
    fromFacilityId: from, toFacilityId: 'HOSP-C1', productId: 'PRD-VAX-01', units: 500, now: NOW,
  });

  // Conservation: a transfer moves stock, it does not create or destroy it.
  assert.equal(total(), before, 'total units must be unchanged by a transfer');
  assert.equal(
    db.prepare("SELECT COALESCE(SUM(quantity_units),0) n FROM inventory_lot WHERE facility_id=? AND product_id='PRD-VAX-01' AND status='AVAILABLE'").get(from).n,
    srcBefore - 500,
    'source is debited by exactly the requested amount',
  );
  assert.equal(r.after.movedLots.reduce((s, m) => s + m.units, 0), 500);
});

test('INVENTORY_TRANSFER consumes the earliest-expiring lots first (FEFO)', () => {
  const { db } = ctx();
  const from = db.prepare(
    "SELECT facility_id FROM inventory_lot WHERE product_id='PRD-VAX-01' AND status='AVAILABLE' GROUP BY facility_id HAVING COUNT(*)>1 ORDER BY SUM(quantity_units) DESC LIMIT 1",
  ).get()?.facility_id;

  if (!from) return; // fixture has no multi-lot facility for this product

  const lots = db.prepare(
    "SELECT id, expiry_date, quantity_units FROM inventory_lot WHERE facility_id=? AND product_id='PRD-VAX-01' AND status='AVAILABLE' ORDER BY expiry_date ASC",
  ).all(from);

  const r = ACTION_HANDLERS.INVENTORY_TRANSFER(db, {
    fromFacilityId: from, toFacilityId: 'HOSP-C1', productId: 'PRD-VAX-01',
    units: lots[0].quantity_units, now: NOW,
  });

  assert.equal(r.after.movedLots[0].fromLot, lots[0].id,
    'the shortest-dated lot must be shipped first, or the warehouse writes off stock it could have used');
});

test('REQ-054: an over-drawn transfer throws rather than silently moving less', () => {
  const { db } = ctx();
  const from = 'WH-CENTRAL';
  const available = db.prepare(
    "SELECT COALESCE(SUM(quantity_units),0) n FROM inventory_lot WHERE facility_id=? AND product_id='PRD-VAX-01' AND status='AVAILABLE'",
  ).get(from).n;

  assert.throws(
    () => ACTION_HANDLERS.INVENTORY_TRANSFER(db, {
      fromFacilityId: from, toFacilityId: 'HOSP-C1', productId: 'PRD-VAX-01',
      units: available + 1_000, now: NOW,
    }),
    /Insufficient stock/,
    'a partial move reported as success would corrupt every downstream figure',
  );
});

test('every action handler rejects a call missing a required field', () => {
  const { db } = ctx();
  assert.throws(() => ACTION_HANDLERS.INVENTORY_TRANSFER(db, { toFacilityId: 'X', units: 1, now: NOW }));
  assert.throws(() => ACTION_HANDLERS.RELEASE_SHIPMENT(db, { now: NOW }));
  assert.throws(() => ACTION_HANDLERS.REROUTE_SHIPMENT(db, { now: NOW }));
});

// ------------------------------------------------------------------ RELEASE_SHIPMENT

test('RELEASE_SHIPMENT sets IN_TRANSIT and bumps the version (REQ-052)', () => {
  const { db } = ctx();
  const s = db.prepare("SELECT id, version FROM shipment LIMIT 1").get();

  const r = ACTION_HANDLERS.RELEASE_SHIPMENT(db, { shipmentId: s.id, now: NOW });
  assert.equal(r.after.status, 'IN_TRANSIT');
  assert.equal(r.after.version, s.version + 1, 'a write must advance the version');
});

test('RELEASE_SHIPMENT on an unknown shipment throws', () => {
  const { db } = ctx();
  assert.throws(() => ACTION_HANDLERS.RELEASE_SHIPMENT(db, { shipmentId: 'SHP-NOPE', now: NOW }),
    /Unknown shipment/);
});

// ------------------------------------------------------------------ rollback (REQ-054)

test('REQ-054: a mid-batch handler failure rolls back ALL writes and leaves the authorization unconsumed', () => {
  const { db, ledger } = ctx();
  const shipment = db.prepare('SELECT id, status, version FROM shipment LIMIT 1').get();

  // First action is valid; second is guaranteed to fail. Both are inside one transaction.
  const actions = [
    { type: 'RELEASE_SHIPMENT', shipmentId: shipment.id },
    {
      type: 'INVENTORY_TRANSFER', fromFacilityId: 'WH-CENTRAL', toFacilityId: 'HOSP-C1',
      productId: 'PRD-VAX-01', units: 99_999_999,
    },
  ];
  const { decisionId, auth } = authorized(db, ledger, actions);

  assert.throws(() => executeDecision(db, ledger, {
    decisionId, authorizationId: auth.id, actions,
    selectedScenarioId: 'SCN-T1', snapshotHash: 'a'.repeat(64), policyVersion: '1.0.0', now: NOW,
  }), /Insufficient stock/);

  // The valid first write must NOT have survived.
  const after = db.prepare('SELECT status, version FROM shipment WHERE id=?').get(shipment.id);
  assert.equal(after.version, shipment.version, 'a rolled-back batch must leave no partial write');
  assert.equal(after.status, shipment.status);

  // The authorization must still be spendable — it did not buy anything.
  const row = db.prepare('SELECT consumed_at FROM execution_authorization WHERE id=?').get(auth.id);
  assert.equal(row.consumed_at, null,
    'consuming an authorization for a batch that rolled back would burn the approval for nothing');
});

test('REQ-054: a failed execution is RECORDED, never suppressed', () => {
  const { db, ledger } = ctx();
  const actions = [{
    type: 'INVENTORY_TRANSFER', fromFacilityId: 'WH-CENTRAL', toFacilityId: 'HOSP-C1',
    productId: 'PRD-VAX-01', units: 99_999_999,
  }];
  const { decisionId, auth } = authorized(db, ledger, actions);

  assert.throws(() => executeDecision(db, ledger, {
    decisionId, authorizationId: auth.id, actions,
    selectedScenarioId: 'SCN-T1', snapshotHash: 'a'.repeat(64), policyVersion: '1.0.0', now: NOW,
  }));

  const res = db.prepare("SELECT * FROM execution_result WHERE decision_id=?").get(decisionId);
  assert.ok(res, 'a failure must leave an execution_result row');
  assert.equal(res.outcome, 'FAILED');
  assert.match(res.notes, /Insufficient stock/, 'the recorded note must say what actually went wrong');

  const events = ledger.export().events ?? ledger.export();
  assert.ok(events.some((e) => e.event_type === 'EXECUTION_FAILED'),
    'the audit trail must contain the failure');
  assert.equal(ledger.verify().valid, true, 'the chain stays valid across a failure');
});

test('an action type outside the bounded vocabulary is refused before anything runs', () => {
  const { db, ledger } = ctx();
  const actions = [{ type: 'DELETE_EVERYTHING', shipmentId: 'SHP-0001' }];
  const { decisionId, auth } = authorized(db, ledger, actions);

  assert.throws(() => executeDecision(db, ledger, {
    decisionId, authorizationId: auth.id, actions,
    selectedScenarioId: 'SCN-T1', snapshotHash: 'a'.repeat(64), policyVersion: '1.0.0', now: NOW,
  }), (e) => e instanceof AuthorizationError && /bounded execution vocabulary/.test(e.message));
});

// ------------------------------------------------------------------ authorization lifecycle

test('an expired authorization cannot be spent', () => {
  const { db, ledger } = ctx();
  const actions = [{ type: 'RELEASE_SHIPMENT', shipmentId: db.prepare('SELECT id FROM shipment LIMIT 1').get().id }];
  const { decisionId, auth } = authorized(db, ledger, actions);
  const late = new Date(Date.parse(NOW) + AUTHORIZATION_TTL_MS + 1_000).toISOString();

  assert.throws(() => executeDecision(db, ledger, {
    decisionId, authorizationId: auth.id, actions,
    selectedScenarioId: 'SCN-T1', snapshotHash: 'a'.repeat(64), policyVersion: '1.0.0', now: late,
  }), (e) => e.kind === 'EXPIRED');
});

test('an authorization is single-use', () => {
  const { db, ledger } = ctx();
  const id = db.prepare('SELECT id FROM shipment LIMIT 1').get().id;
  const actions = [{ type: 'RELEASE_SHIPMENT', shipmentId: id }];
  const { decisionId, auth } = authorized(db, ledger, actions);

  const args = {
    decisionId, authorizationId: auth.id, actions,
    selectedScenarioId: 'SCN-T1', snapshotHash: 'a'.repeat(64), policyVersion: '1.0.0', now: NOW,
  };
  executeDecision(db, ledger, args);
  assert.throws(() => executeDecision(db, ledger, args), (e) => e.kind === 'CONSUMED');
});

test('changing the actions after minting invalidates the authorization (hash binding)', () => {
  const { db, ledger } = ctx();
  const id = db.prepare('SELECT id FROM shipment LIMIT 1').get().id;
  const actions = [{ type: 'RELEASE_SHIPMENT', shipmentId: id }];
  const { decisionId, auth } = authorized(db, ledger, actions);

  const tampered = [{ type: 'RELEASE_SHIPMENT', shipmentId: id, sneaky: true }];
  assert.throws(() => executeDecision(db, ledger, {
    decisionId, authorizationId: auth.id, actions: tampered,
    selectedScenarioId: 'SCN-T1', snapshotHash: 'a'.repeat(64), policyVersion: '1.0.0', now: NOW,
  }), (e) => e.kind === 'HASH_MISMATCH',
  'executing actions other than the ones approved must be impossible');
});

test('validateAuthorization rejects an unknown id', () => {
  const { db } = ctx();
  assert.throws(
    () => validateAuthorization(db, 'AUTH-NOPE', {
      decisionId: 'D', selectedScenarioId: 'S', snapshotHash: 'a'.repeat(64),
      actions: [], policyVersion: '1.0.0', now: NOW,
    }),
    (e) => e instanceof AuthorizationError,
  );
});
