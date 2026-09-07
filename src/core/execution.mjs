/**
 * Bounded execution and recovery verification.
 *
 * REQ-050: state-changing execution requires a valid ExecutionAuthorization. This module holds the
 * ONLY code path that mutates supply-chain state (shipments, lots, orders), and it refuses to do so
 * without a live authorization whose embedded payload hash still matches the decision.
 *
 * REQ-055: carrier execution is SIMULATED. Nothing here contacts a carrier. Every change is written
 * to our own database and labelled. The UI says so.
 */

import { randomUUID } from 'node:crypto';
import { computeDecisionPayloadHash } from './snapshot.mjs';

export const AUTHORIZATION_TTL_MS = 15 * 60 * 1000;

export class AuthorizationError extends Error {
  constructor(message, kind) {
    super(message);
    this.name = 'AuthorizationError';
    this.kind = kind; // NOT_APPROVED | HASH_MISMATCH | EXPIRED | CONSUMED | NOT_FOUND | NO_AUTHORIZATION
  }
}

/**
 * Mints a single-use authorization. Only callable for a decision in APPROVED state — the state
 * machine, not this function, is what proves approval happened.
 *
 * The authorization embeds the decision payload hash (REQ-051). If any input changes afterwards,
 * the hash no longer matches and the authorization is void — this is what makes REQ-038 enforceable
 * at execution time rather than merely at approval time.
 */
export function mintAuthorization(db, ledger, {
  decisionId, selectedScenarioId, snapshotHash, actions, policyVersion,
  approvals = [], now = new Date().toISOString(), ttlMs = AUTHORIZATION_TTL_MS,
}) {
  const decision = db.prepare('SELECT * FROM decision WHERE id = ?').get(decisionId);
  if (!decision) throw new AuthorizationError(`Decision ${decisionId} not found`, 'NOT_FOUND');

  if (decision.state !== 'APPROVED') {
    throw new AuthorizationError(
      `Cannot mint an authorization for a decision in state ${decision.state}; APPROVED is required.`,
      'NOT_APPROVED',
    );
  }

  const payloadHash = computeDecisionPayloadHash({
    decisionId, selectedScenarioId, snapshotHash, actions, policyVersion,
  });

  const id = `AUTH-${randomUUID().slice(0, 8)}`;
  const expiresAt = new Date(Date.parse(now) + ttlMs).toISOString();

  db.prepare(
    `INSERT INTO execution_authorization
       (id, decision_id, minted_at, expires_at, decision_payload_hash, approvals_json)
     VALUES (?,?,?,?,?,?)`,
  ).run(id, decisionId, now, expiresAt, payloadHash, JSON.stringify(approvals));

  ledger.append({
    eventType: 'AUTHORIZATION_MINTED', actor: 'system:policy', decisionId,
    payload: { authorizationId: id, payloadHash, expiresAt, approvalCount: approvals.length },
  });

  return db.prepare('SELECT * FROM execution_authorization WHERE id = ?').get(id);
}

/**
 * Validates an authorization against the CURRENT decision payload. Separated from execution so the
 * UI can show whether an authorization is still good without consuming it.
 */
export function validateAuthorization(db, authorizationId, {
  decisionId, selectedScenarioId, snapshotHash, actions, policyVersion,
  now = new Date().toISOString(),
}) {
  const auth = db.prepare('SELECT * FROM execution_authorization WHERE id = ?').get(authorizationId);
  if (!auth) throw new AuthorizationError(`Authorization ${authorizationId} not found`, 'NOT_FOUND');

  if (auth.consumed_at) {
    throw new AuthorizationError(
      `Authorization ${authorizationId} was already consumed at ${auth.consumed_at}; it is single-use.`,
      'CONSUMED',
    );
  }

  if (Date.parse(now) > Date.parse(auth.expires_at)) {
    throw new AuthorizationError(
      `Authorization ${authorizationId} expired at ${auth.expires_at}.`, 'EXPIRED',
    );
  }

  const currentHash = computeDecisionPayloadHash({
    decisionId, selectedScenarioId, snapshotHash, actions, policyVersion,
  });

  if (currentHash !== auth.decision_payload_hash) {
    throw new AuthorizationError(
      'Decision inputs changed after approval: the authorization payload hash no longer matches. ' +
      'The approval is stale and must be obtained again.',
      'HASH_MISMATCH',
    );
  }

  return auth;
}

/**
 * The action vocabulary. Execution is BOUNDED: an action type absent from this table cannot be
 * executed, regardless of what any agent, policy or caller asks for.
 *
 * Each handler returns a before/after record so the audit trail shows what actually changed.
 */
/**
 * D9-1: a handler that receives a missing or wrong-typed field must say so, loudly, naming the
 * field. The original REROUTE_SHIPMENT quietly computed `new Date(NaN)` from an absent `etaHours`
 * and failed later with "Invalid time value", which points at the symptom rather than the cause.
 */
function requireFields(actionType, fields) {
  const bad = Object.entries(fields).filter(([, v]) =>
    v === undefined || v === null || (typeof v === 'number' && !Number.isFinite(v)));

  if (bad.length > 0) {
    throw new Error(
      `Action ${actionType} is missing or has invalid field(s): ${bad.map(([k]) => k).join(', ')}. ` +
      'The action list must be produced by the scenario engine, not re-derived.',
    );
  }
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === 'object') {
      throw new Error(`Action ${actionType} field "${k}" received an object where a scalar was expected.`);
    }
  }
}

export const ACTION_HANDLERS = Object.freeze({
  /** Re-route a held shipment onto a different lane. */
  REROUTE_SHIPMENT(db, { shipmentId, toLaneId, units, now, etaHours = null }) {
    requireFields('REROUTE_SHIPMENT', { shipmentId, toLaneId, units });

    const before = db.prepare('SELECT * FROM shipment WHERE id = ?').get(shipmentId);
    if (!before) throw new Error(`Unknown shipment ${shipmentId}`);

    // The lane's own transit time is authoritative. `etaHours` may be supplied by the scenario
    // (whole-route figure); a per-leg lane lookup is preferred when the lane is a single hop.
    const lane = db.prepare('SELECT * FROM lane WHERE id = ?').get(toLaneId);
    const hours = lane?.transit_hours ?? etaHours;
    if (hours == null) {
      throw new Error(`Cannot compute ETA for ${shipmentId}: lane ${toLaneId} is unknown and no etaHours was supplied.`);
    }

    const eta = new Date(Date.parse(now) + hours * 3600_000).toISOString();
    // REQ-052: row-level optimistic concurrency. A stale-version write is rejected rather than
    // overwriting a change made by another actor since we read the row.
    const res = db.prepare(
      `UPDATE shipment SET lane_id = ?, status = 'REROUTED', eta = ?, version = version + 1
       WHERE id = ? AND version = ?`,
    ).run(toLaneId, eta, shipmentId, before.version);

    if (res.changes !== 1) {
      throw new Error(
        `Stale write rejected for shipment ${shipmentId}: expected version ${before.version}.`,
      );
    }

    const after = db.prepare('SELECT * FROM shipment WHERE id = ?').get(shipmentId);
    return { entity: 'shipment', id: shipmentId, before, after };
  },

  /** Move stock between facilities. Deducts at source, adds a new lot at destination. */
  INVENTORY_TRANSFER(db, { fromFacilityId, toFacilityId, productId, units, now }) {
    requireFields('INVENTORY_TRANSFER', { fromFacilityId, toFacilityId, productId, units });
    const quantityUnits = units;

    const lots = db
      .prepare(
        `SELECT * FROM inventory_lot
          WHERE facility_id = ? AND product_id = ? AND status = 'AVAILABLE'
          ORDER BY expiry_date ASC`,
      )
      .all(fromFacilityId, productId);

    let remaining = quantityUnits;
    const moved = [];

    for (const lot of lots) {
      if (remaining <= 0) break;
      const take = Math.min(lot.quantity_units, remaining);
      db.prepare('UPDATE inventory_lot SET quantity_units = quantity_units - ? WHERE id = ?')
        .run(take, lot.id);

      const newLotId = `${lot.id}-T${String(moved.length + 1).padStart(2, '0')}`;
      db.prepare(
        `INSERT INTO inventory_lot
           (id, product_id, facility_id, quantity_units, expiry_date, status, data_source, data_classification)
         VALUES (?,?,?,?,?,'AVAILABLE','SIMULATED','SYNTHETIC')`,
      ).run(newLotId, productId, toFacilityId, take, lot.expiry_date);

      moved.push({ fromLot: lot.id, toLot: newLotId, units: take, expiry: lot.expiry_date });
      remaining -= take;
    }

    if (remaining > 0) {
      throw new Error(
        `Insufficient stock at ${fromFacilityId}: short by ${remaining} units of ${productId}`,
      );
    }

    return {
      entity: 'inventory_lot',
      id: `${fromFacilityId}->${toFacilityId}`,
      before: { facility: fromFacilityId, requested: quantityUnits },
      after: { movedLots: moved },
    };
  },

  /** Mark a held shipment as released against a reopened or alternative lane. */
  RELEASE_SHIPMENT(db, { shipmentId }) {
    requireFields('RELEASE_SHIPMENT', { shipmentId });
    const before = db.prepare('SELECT * FROM shipment WHERE id = ?').get(shipmentId);
    if (!before) throw new Error(`Unknown shipment ${shipmentId}`);
    const res = db.prepare(
      "UPDATE shipment SET status = 'IN_TRANSIT', version = version + 1 WHERE id = ? AND version = ?",
    ).run(shipmentId, before.version);
    if (res.changes !== 1) {
      throw new Error(`Stale write rejected for shipment ${shipmentId}.`);
    }
    const after = db.prepare('SELECT * FROM shipment WHERE id = ?').get(shipmentId);
    return { entity: 'shipment', id: shipmentId, before, after };
  },
});

/**
 * Executes a decision's actions inside a single transaction.
 *
 * REQ-052 idempotency: the authorization is single-use and consumed inside the same transaction as
 * the writes. A replay finds `consumed_at` set and is rejected. Because the consume and the writes
 * share one transaction, a mid-execution failure rolls back BOTH — the authorization is not burned
 * by a failed attempt.
 */
export function executeDecision(db, ledger, {
  decisionId, authorizationId, actions, selectedScenarioId, snapshotHash, policyVersion,
  now = new Date().toISOString(),
}) {
  validateAuthorization(db, authorizationId, {
    decisionId, selectedScenarioId, snapshotHash, actions, policyVersion, now,
  });

  for (const a of actions) {
    if (!ACTION_HANDLERS[a.type]) {
      throw new AuthorizationError(
        `Action type ${a.type} is not in the bounded execution vocabulary.`, 'NO_AUTHORIZATION',
      );
    }
  }

  const resultId = `EXE-${randomUUID().slice(0, 8)}`;
  let changes = [];
  let outcome = 'SUCCESS';
  let notes = null;

  const tx = db.transaction(() => {
    // Consume first: if anything below throws, the whole transaction rolls back together.
    const consumed = db
      .prepare('UPDATE execution_authorization SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL')
      .run(now, authorizationId);

    if (consumed.changes !== 1) {
      throw new AuthorizationError(
        `Authorization ${authorizationId} was consumed concurrently.`, 'CONSUMED',
      );
    }

    changes = actions.map((a) => ACTION_HANDLERS[a.type](db, { ...a, now }));

    db.prepare(
      `INSERT INTO execution_result
         (id, decision_id, authorization_id, executed_at, changes_json, outcome, notes)
       VALUES (?,?,?,?,?,?,?)`,
    ).run(
      resultId, decisionId, authorizationId, now,
      JSON.stringify({ simulated: true, carrierContacted: false, changes }),
      outcome, notes,
    );
  });

  try {
    tx();
  } catch (err) {
    // REQ-054: a failure is recorded, never suppressed.
    outcome = 'FAILED';
    notes = err.message;
    db.prepare(
      `INSERT INTO execution_result
         (id, decision_id, authorization_id, executed_at, changes_json, outcome, notes)
       VALUES (?,?,?,?,?,?,?)`,
    ).run(resultId, decisionId, authorizationId, now,
      JSON.stringify({ simulated: true, carrierContacted: false, changes: [] }), outcome, notes);

    ledger.append({
      eventType: 'EXECUTION_FAILED', actor: 'system:executor', decisionId,
      payload: { authorizationId, error: err.message, kind: err.kind ?? 'HANDLER_ERROR' },
    });
    throw err;
  }

  ledger.append({
    eventType: 'EXECUTION_COMPLETED', actor: 'system:executor', decisionId,
    payload: {
      authorizationId, resultId, outcome,
      simulated: true,
      actions: actions.map((a) => a.type),
      changedEntities: changes.map((c) => `${c.entity}:${c.id}`),
    },
  });

  return db.prepare('SELECT * FROM execution_result WHERE id = ?').get(resultId);
}

/**
 * REQ-053 / REQ-054 — recompute impact after execution and record whether the objective was met.
 *
 * The objective is stated BEFORE execution and compared against a freshly recomputed impact. It is
 * deliberately possible for this to return objective_met = 0: a verification step that cannot fail
 * verifies nothing.
 */
export function verifyRecovery(db, ledger, {
  decisionId, before, after, objective, now = new Date().toISOString(),
}) {
  const criticalBefore = before.daysOfCover.filter((c) => c.status === 'CRITICAL').length;
  const criticalAfter = after.daysOfCover.filter((c) => c.status === 'CRITICAL').length;
  const atRiskBefore = before.ordersAtRisk.length;
  const atRiskAfter = after.ordersAtRisk.length;

  const checks = [
    {
      name: 'ordersAtRiskReduced',
      target: objective.maxOrdersAtRisk,
      actual: atRiskAfter,
      met: atRiskAfter <= objective.maxOrdersAtRisk,
    },
    {
      name: 'noCriticalSites',
      target: objective.maxCriticalSites,
      actual: criticalAfter,
      met: criticalAfter <= objective.maxCriticalSites,
    },
  ];

  const objectiveMet = checks.every((c) => c.met);

  const id = `REC-${randomUUID().slice(0, 8)}`;
  db.prepare(
    `INSERT INTO recovery_verification
       (id, decision_id, verified_at, objective_met, before_json, after_json, notes)
     VALUES (?,?,?,?,?,?,?)`,
  ).run(
    id, decisionId, now, objectiveMet ? 1 : 0,
    JSON.stringify({ ordersAtRisk: atRiskBefore, criticalSites: criticalBefore }),
    JSON.stringify({ ordersAtRisk: atRiskAfter, criticalSites: criticalAfter }),
    JSON.stringify(checks),
  );

  ledger.append({
    eventType: objectiveMet ? 'RECOVERY_VERIFIED' : 'RECOVERY_OBJECTIVE_MISSED',
    actor: 'system:verifier', decisionId,
    payload: {
      verificationId: id, objectiveMet, checks,
      ordersAtRisk: { before: atRiskBefore, after: atRiskAfter },
      criticalSites: { before: criticalBefore, after: criticalAfter },
    },
  });

  return db.prepare('SELECT * FROM recovery_verification WHERE id = ?').get(id);
}
