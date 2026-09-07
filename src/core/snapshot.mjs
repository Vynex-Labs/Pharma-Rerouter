/**
 * Input snapshots — closes P2 condition DA-2.
 *
 * Authority: docs/data-model.md §4. Requirements: REQ-028, REQ-038, REQ-051, REQ-014.
 *
 * Before any analysis runs, freeze every input it read into an immutable, canonically hashed row.
 * One mechanism, three jobs:
 *   - scenarios are reproducible (their inputs are recoverable)
 *   - stale approvals are detectable (the decision hash incorporates the snapshot hash)
 *   - determinism is testable (replay the snapshot, assert identical output)
 */

import { randomUUID } from 'node:crypto';
import { canonicalise, hashCanonical } from './canonical.mjs';

/**
 * Read the full analysable state of the network and freeze it.
 * Every query is explicitly ORDER BY'd: unordered SQL results would make the hash
 * non-deterministic, which would silently defeat the whole mechanism.
 */
export function captureSnapshot(db, { disruptionId = null } = {}) {
  const q = (sql, ...p) => db.prepare(sql).all(...p);

  const payload = {
    disruptionId,
    facilities: q('SELECT * FROM facility ORDER BY id'),
    lanes: q('SELECT * FROM lane ORDER BY id'),
    products: q('SELECT * FROM product ORDER BY id'),
    lots: q('SELECT * FROM inventory_lot ORDER BY id'),
    demand: q('SELECT * FROM demand_rate ORDER BY product_id, facility_id'),
    orders: q('SELECT * FROM order_line ORDER BY id'),
    shipments: q('SELECT * FROM shipment ORDER BY id'),
    supplierProducts: q('SELECT * FROM supplier_product ORDER BY supplier_id, product_id'),
    disruptions: q(`SELECT * FROM disruption_event ORDER BY id`),
  };

  const snapshotHash = hashCanonical(payload);
  const id = randomUUID();

  db.prepare(
    `INSERT INTO input_snapshot (id, created_at, snapshot_hash, payload_json)
     VALUES (?, ?, ?, ?)`,
  ).run(id, new Date().toISOString(), snapshotHash, canonicalise(payload));

  return { id, snapshotHash, payload };
}

export function loadSnapshot(db, id) {
  const row = db.prepare('SELECT * FROM input_snapshot WHERE id = ?').get(id);
  if (!row) throw new Error(`Snapshot not found: ${id}`);
  return { id: row.id, snapshotHash: row.snapshot_hash, payload: JSON.parse(row.payload_json) };
}

/**
 * REQ-051 / REQ-038 — the hash an ExecutionAuthorization binds itself to.
 * Deliberately includes the snapshot hash: if the underlying network state moved after approval,
 * this value changes, the authorization is void, and the decision returns to PENDING_APPROVAL.
 */
export function computeDecisionPayloadHash({
  decisionId,
  selectedScenarioId,
  snapshotHash,
  actions,
  policyVersion,
}) {
  return hashCanonical({
    decisionId,
    selectedScenarioId,
    snapshotHash,
    actions,
    policyVersion,
  });
}
