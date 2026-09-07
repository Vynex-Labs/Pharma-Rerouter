/**
 * P9 verification — end-to-end integration.
 *
 * Traces: REQ-050, REQ-052, REQ-053, REQ-054, REQ-055, and the full state machine.
 * These tests exercise the real pipeline against the real database. Nothing is stubbed except the
 * language-model provider, which is the deterministic mock by design.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { openDatabase } from '../src/db/index.mjs';
import { seedDatabase, SEED_EPOCH } from '../src/db/seed.mjs';
import { AuditLedger } from '../src/core/audit.mjs';
import { MockProvider } from '../src/agents/provider.mjs';
import { runPipeline, evaluatePolicyInterim, actionsFor } from '../src/core/pipeline.mjs';
import {
  DecisionMachine, StateTransitionError, canTransition, TRANSITIONS, STATES,
} from '../src/core/statemachine.mjs';
import {
  mintAuthorization, executeDecision, validateAuthorization, AuthorizationError, ACTION_HANDLERS,
} from '../src/core/execution.mjs';

const APPROVAL = { approverIdentity: 'user:sofia', approvals: ['user:sofia', 'user:daniel'] };

function fresh() {
  const db = openDatabase(':memory:');
  seedDatabase(db);
  return { db, ledger: new AuditLedger(db), provider: new MockProvider() };
}
const run = (ctx, extra = {}) =>
  runPipeline({ ...ctx, asOf: SEED_EPOCH, ...extra });

// ------------------------------------------------------------------ state machine

test('the transition graph is an allow-list: every target is a known state', () => {
  for (const [from, targets] of Object.entries(TRANSITIONS)) {
    assert.ok(STATES.includes(from), `${from} is not a declared state`);
    for (const to of targets) assert.ok(STATES.includes(to), `${from} -> ${to} targets an unknown state`);
  }
});

test('REQ-039: REJECTED and BLOCKED cannot reach EXECUTING by any route', () => {
  for (const dead of ['REJECTED', 'BLOCKED']) {
    assert.ok(!canTransition(dead, 'EXECUTING'));
    assert.ok(!canTransition(dead, 'APPROVED'));
    assert.deepEqual(TRANSITIONS[dead], ['SEALED'], `${dead} must only be sealable`);
  }
});

test('an illegal transition is refused with a typed error', () => {
  const { db, ledger } = fresh();
  const m = new DecisionMachine(db, ledger);
  const d = m.create({ disruptionId: 'DSR-0001' });

  assert.throws(
    () => m.transition(d.id, 'EXECUTING'),
    (e) => e instanceof StateTransitionError && e.kind === 'ILLEGAL_TRANSITION',
    'DETECTED -> EXECUTING must be impossible',
  );
  assert.equal(m.get(d.id).state, 'DETECTED', 'a refused transition must not mutate state');
});

test('F-8/REQ-052: concurrent transitions are rejected by optimistic locking', () => {
  const { db, ledger } = fresh();
  const m = new DecisionMachine(db, ledger);
  const d = m.create({ disruptionId: 'DSR-0001' });

  m.transition(d.id, 'IMPACT_ASSESSED', { expectedVersion: 1 });

  // A second actor still holding version 1 tries to advance the same decision.
  assert.throws(
    () => m.transition(d.id, 'SCENARIOS_GENERATED', { expectedVersion: 1 }),
    (e) => e.kind === 'VERSION_CONFLICT',
  );
});

test('AR-7: no module under src/agents/ imports the state machine or executor', () => {
  for (const f of readdirSync(new URL('../src/agents/', import.meta.url))) {
    const src = readFileSync(new URL(`../src/agents/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /statemachine\.mjs|execution\.mjs/,
      `${f} must not be able to transition state or execute`);
  }
});

// ------------------------------------------------------------------ full flow

test('the pipeline halts at PENDING_APPROVAL when no approval is supplied', async () => {
  const ctx = fresh();
  const r = await run(ctx);

  assert.equal(r.state, 'PENDING_APPROVAL');
  assert.equal(r.executed, null, 'nothing may execute without approval');
  assert.equal(r.recovery, null);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) c FROM execution_result').get().c, 0);
});

test('the flagship scenario runs detection through SEALED', async () => {
  const ctx = fresh();
  const r = await run(ctx, { approval: APPROVAL });

  assert.equal(r.state, 'SEALED');
  assert.deepEqual(r.trace.map((t) => t.step), [
    'DETECTED', 'IMPACT_ASSESSED', 'SCENARIOS_GENERATED', 'RANKED', 'POLICY_EVALUATED',
    'PENDING_APPROVAL', 'APPROVED', 'EXECUTING', 'RECOVERY_VERIFIED', 'SEALED',
  ]);
  assert.equal(r.selected.strategyType, 'AIR_REROUTE');
  assert.equal(r.executed.outcome, 'SUCCESS');
});

test('the audit chain stays verifiable across the whole run', async () => {
  const ctx = fresh();
  await run(ctx, { approval: APPROVAL });

  const v = ctx.ledger.verify();
  assert.equal(v.valid, true);

  const types = ctx.db.prepare('SELECT event_type FROM audit_event ORDER BY seq').all()
    .map((r) => r.event_type);
  for (const required of [
    'DECISION_CREATED', 'STATE_TRANSITION', 'AUTHORIZATION_MINTED', 'EXECUTION_COMPLETED',
  ]) {
    assert.ok(types.includes(required), `audit trail is missing ${required}`);
  }
});

test('DA-2/REQ-024: every scenario is persisted, including the excluded one, with its reason', async () => {
  const ctx = fresh();
  const r = await run(ctx, { approval: APPROVAL });

  const rows = ctx.db.prepare('SELECT * FROM scenario ORDER BY id').all();
  assert.equal(rows.length, r.ranked.length + r.excluded.length);

  const blocked = rows.find((s) => s.feasibility === 'BLOCKED');
  assert.ok(blocked, 'the blocked supplier option must be stored, not dropped');
  assert.ok(blocked.infeasibility_reason, 'a non-feasible option must keep its reason');

  for (const s of rows) {
    assert.ok(s.snapshot_id, 'DA-2: each scenario records the snapshot it was computed from');
  }
});

// ------------------------------------------------------------------ authorization

test('REQ-050: execution without an authorization is impossible', async () => {
  const ctx = fresh();
  const r = await run(ctx);   // stops at PENDING_APPROVAL

  assert.throws(
    () => mintAuthorization(ctx.db, ctx.ledger, { ...r.payloadInputs }),
    (e) => e instanceof AuthorizationError && e.kind === 'NOT_APPROVED',
    'an authorization may only be minted for an APPROVED decision',
  );
});

test('REQ-051: an authorization is void if the decision inputs change afterwards', async () => {
  const ctx = fresh();
  const r = await run(ctx);

  r.machine.transition(r.decisionId, 'APPROVED', {
    expectedVersion: r.machine.get(r.decisionId).version,
  });
  const auth = mintAuthorization(ctx.db, ctx.ledger, { ...r.payloadInputs });

  // Nothing changed yet: the authorization validates.
  assert.ok(validateAuthorization(ctx.db, auth.id, { ...r.payloadInputs }));

  // Now an input changes — a different scenario is selected.
  assert.throws(
    () => validateAuthorization(ctx.db, auth.id, {
      ...r.payloadInputs, selectedScenarioId: 'SCN-999-TAMPERED',
    }),
    (e) => e.kind === 'HASH_MISMATCH',
    'a stale approval must not authorise execution',
  );
});

test('REQ-052: an authorization is single-use, so a replay cannot double-execute', async () => {
  const ctx = fresh();
  const r = await run(ctx, { approval: APPROVAL });

  assert.throws(
    () => executeDecision(ctx.db, ctx.ledger, {
      decisionId: r.decisionId, authorizationId: r.authorization.id, ...r.payloadInputs,
    }),
    (e) => e.kind === 'CONSUMED',
  );
  assert.equal(
    ctx.db.prepare('SELECT COUNT(*) c FROM execution_result WHERE outcome = ?').get('SUCCESS').c,
    1, 'the replay must not produce a second successful execution',
  );
});

test('an expired authorization is refused', async () => {
  const ctx = fresh();
  const r = await run(ctx);
  r.machine.transition(r.decisionId, 'APPROVED', {
    expectedVersion: r.machine.get(r.decisionId).version,
  });

  const auth = mintAuthorization(ctx.db, ctx.ledger, { ...r.payloadInputs, ttlMs: 1000 });
  const later = new Date(Date.parse(auth.minted_at) + 60_000).toISOString();

  assert.throws(
    () => validateAuthorization(ctx.db, auth.id, { ...r.payloadInputs, now: later }),
    (e) => e.kind === 'EXPIRED',
  );
});

test('execution is bounded: an action outside the vocabulary cannot run', async () => {
  const ctx = fresh();
  const r = await run(ctx);
  r.machine.transition(r.decisionId, 'APPROVED', {
    expectedVersion: r.machine.get(r.decisionId).version,
  });

  const rogue = [{ type: 'WIRE_FUNDS', amount: 999 }];
  const inputs = { ...r.payloadInputs, actions: rogue };
  const auth = mintAuthorization(ctx.db, ctx.ledger, inputs);

  assert.throws(
    () => executeDecision(ctx.db, ctx.ledger, {
      decisionId: r.decisionId, authorizationId: auth.id, ...inputs,
    }),
    /not in the bounded execution vocabulary/,
  );
  assert.ok(!Object.keys(ACTION_HANDLERS).includes('WIRE_FUNDS'));
});

// ------------------------------------------------------------------ execution effects

test('REQ-055: execution is simulated and the record says so', async () => {
  const ctx = fresh();
  const r = await run(ctx, { approval: APPROVAL });

  const changes = JSON.parse(r.executed.changes_json);
  assert.equal(changes.simulated, true);
  assert.equal(changes.carrierContacted, false);
});

test('execution actually mutates supply-chain state, with before/after recorded', async () => {
  const ctx = fresh();
  const before = ctx.db.prepare("SELECT * FROM shipment WHERE id = 'SHP-1001'").get();
  // Persisted status is IN_TRANSIT on the now-closed sea lane. "HELD" is a DERIVED state the impact
  // engine computes in memory from the lane closure; it is deliberately not written back, so the
  // stored world stays a record of fact rather than of inference.
  assert.equal(before.status, 'IN_TRANSIT');
  assert.equal(before.lane_id, 'LN-SEA-PRIMARY');

  const r = await run(ctx, { approval: APPROVAL });

  const after = ctx.db.prepare("SELECT * FROM shipment WHERE id = 'SHP-1001'").get();
  assert.equal(after.status, 'REROUTED');
  assert.equal(after.lane_id, 'LN-AIR-EXPRESS', 'the shipment must move to the air lane');
  assert.equal(after.version, before.version + 1, 'the row version must advance');
  assert.notEqual(after.eta, before.eta, 'a faster lane must change the ETA');

  const recorded = JSON.parse(r.executed.changes_json).changes;
  const rec = recorded.find((c) => c.id === 'SHP-1001');
  assert.ok(rec, 'the change record must name the shipment');
  assert.equal(rec.before.lane_id, 'LN-SEA-PRIMARY');
  assert.equal(rec.after.lane_id, 'LN-AIR-EXPRESS');
});

test('D9-1: a malformed action names the missing field instead of failing obscurely', () => {
  const { db } = fresh();
  assert.throws(
    () => ACTION_HANDLERS.REROUTE_SHIPMENT(db, {
      shipmentId: 'SHP-1001', toLaneId: 'LN-AIR-EXPRESS', units: null, now: SEED_EPOCH,
    }),
    /missing or has invalid field\(s\): units/,
  );
  assert.throws(
    () => ACTION_HANDLERS.REROUTE_SHIPMENT(db, {
      shipmentId: { id: 'SHP-1001' }, toLaneId: 'LN-AIR-EXPRESS', units: 10, now: SEED_EPOCH,
    }),
    /received an object where a scalar was expected/,
  );
});

test('actions come from the engine and are never re-derived', async () => {
  const ctx = fresh();
  const r = await run(ctx);
  assert.deepEqual(r.actions, r.selected.actions, 'the executed actions must be the scored actions');
  assert.deepEqual(actionsFor(null), []);
});

// ------------------------------------------------------------------ recovery verification

test('REQ-053: recovery is measured against the selected scenario\'s own prediction', async () => {
  const ctx = fresh();
  const r = await run(ctx, { approval: APPROVAL });

  const checks = JSON.parse(r.recovery.notes);
  const orders = checks.find((c) => c.name === 'ordersAtRiskReduced');

  assert.equal(orders.target, r.selected.detail.residualOrdersAtRisk,
    'the target must be what the engine predicted, not an arbitrary ideal');
  assert.equal(orders.actual, r.afterImpact.ordersAtRisk.length);
  assert.equal(r.recovery.objective_met, 1);
});

test('D9-2: the post-execution measurement actually responds to the execution', async () => {
  const ctx = fresh();
  const r = await run(ctx, { approval: APPROVAL });

  assert.ok(
    r.afterImpact.ordersAtRisk.length < r.impact.ordersAtRisk.length,
    'rerouting held shipments must reduce measured orders at risk; if this is equal, ' +
    'recovery verification is not measuring the effect of the action',
  );
});

test('REQ-054: a missed objective is recorded, not suppressed', async () => {
  const { db, ledger } = fresh();
  const { verifyRecovery } = await import('../src/core/execution.mjs');
  const m = new DecisionMachine(db, ledger);
  const d = m.create({ disruptionId: 'DSR-0001' });

  const rec = verifyRecovery(db, ledger, {
    decisionId: d.id,
    before: { daysOfCover: [], ordersAtRisk: [1, 2, 3] },
    after: { daysOfCover: [{ status: 'CRITICAL' }], ordersAtRisk: [1, 2, 3] },
    objective: { maxOrdersAtRisk: 0, maxCriticalSites: 0 },
  });

  assert.equal(rec.objective_met, 0);
  const events = db.prepare('SELECT event_type FROM audit_event').all().map((r) => r.event_type);
  assert.ok(events.includes('RECOVERY_OBJECTIVE_MISSED'), 'the miss must reach the audit trail');
});

// ------------------------------------------------------------------ policy seam (interim)

test('the interim policy never returns AUTONOMOUS for the flagship, and blocks a blocked option', () => {
  const impact = { daysOfCover: [{ status: 'CRITICAL' }] };
  const blocked = { feasibility: 'BLOCKED', infeasibilityReason: 'Supplier not qualified for EU.' };

  assert.equal(evaluatePolicyInterim(blocked, impact).autonomyClass, 'BLOCKED');
  assert.equal(evaluatePolicyInterim(null, impact).autonomyClass, 'BLOCKED');

  const ok = { feasibility: 'FEASIBLE', costDeltaMinor: 23_200_000 };
  const verdict = evaluatePolicyInterim(ok, impact);
  assert.equal(verdict.autonomyClass, 'APPROVAL_REQUIRED');
  assert.ok(verdict.requiredRoles.length >= 2, 'a critical, high-value action needs dual approval');
});

test('policy evaluation is persisted with its version (REQ-041)', async () => {
  const ctx = fresh();
  const r = await run(ctx);
  const row = ctx.db.prepare('SELECT * FROM policy_evaluation WHERE decision_id = ?').get(r.decisionId);

  assert.ok(row, 'the evaluation must be stored');
  assert.equal(row.autonomy_class, 'APPROVAL_REQUIRED');
  assert.match(row.policy_version, /interim-p9/);
  assert.ok(JSON.parse(row.required_roles_json).length >= 1);
});
