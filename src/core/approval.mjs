/**
 * Approval capture and integrity (P12).
 *
 * This module is the reason the project exists. Everything upstream produces a recommendation;
 * this is where a human takes responsibility for it, and where the system refuses to let that
 * responsibility be faked, bypassed, shared or back-dated.
 *
 * Integrity rules enforced here:
 *   REQ-034  full evidence contract — a boolean is never sufficient
 *   REQ-035  the approver must actually hold the required role
 *   REQ-036  one identity may not satisfy two required roles
 *   REQ-037  approval outside PENDING_APPROVAL is rejected (no post-hoc approval)
 *   REQ-038  approvals are invalidated when decision inputs change
 *   REQ-039  a REJECTED or BLOCKED decision is not executable by anyone
 *   REQ-040  approval records are append-only; corrections supersede
 */

import { randomUUID } from 'node:crypto';
import { computeDecisionPayloadHash } from './snapshot.mjs';

export class ApprovalError extends Error {
  constructor(message, kind, detail = null) {
    super(message);
    this.name = 'ApprovalError';
    this.kind = kind;
    this.detail = detail;
  }
}

/** Roles held by an identity. Empty for an unknown identity — never throws, never guesses. */
export function rolesOf(db, identityId) {
  return db.prepare(
    `SELECT r.role FROM identity_role r
       JOIN identity i ON i.id = r.identity_id
      WHERE r.identity_id = ? AND i.active = 1
      ORDER BY r.role`,
  ).all(identityId).map((r) => r.role);
}

/**
 * The evidence contract (Master Prompt §10.3 / REQ-034).
 *
 * Every field is mandatory. An approval that cannot answer "approving what, on what basis, under
 * which rules, against which data, having seen which alternatives" is not evidence — it is a
 * timestamp attached to a name.
 */
export const REQUIRED_EVIDENCE_FIELDS = Object.freeze([
  'requestedAction', 'reason', 'riskClassification', 'policyEvaluationId', 'requiredRole',
  'approverIdentity', 'snapshotId', 'alternatives', 'policyVersion', 'systemVersion',
  'decisionPayloadHash',
]);

function assertEvidenceComplete(evidence) {
  const missing = REQUIRED_EVIDENCE_FIELDS.filter((f) => {
    const v = evidence[f];
    return v === undefined || v === null || v === '' ||
      (Array.isArray(v) && f !== 'alternatives' && v.length === 0);
  });

  if (missing.length > 0) {
    throw new ApprovalError(
      `Approval evidence is incomplete. Missing: ${missing.join(', ')}. ` +
      'A boolean approval flag is never sufficient (REQ-034).',
      'INCOMPLETE_EVIDENCE', { missing },
    );
  }
  if (!Array.isArray(evidence.alternatives)) {
    throw new ApprovalError(
      'Approval evidence must record the alternatives that were on the table, even if empty.',
      'INCOMPLETE_EVIDENCE', { field: 'alternatives' },
    );
  }
}

/**
 * Records one approval or rejection against one required role.
 *
 * A multi-role decision needs several calls — one per role, each by a different identity. The
 * decision does not advance until every required role is satisfied.
 */
export function submitApproval(db, ledger, {
  decisionId, approverIdentity, requiredRole, decisionValue,
  requestedAction, reason, riskClassification, policyEvaluationId, snapshotId,
  selectedScenarioId = null, alternatives = [], policyVersion, systemVersion = '0.6.0',
  agentRecommendation = null, agentConfidence = null, agentUncertainty = null,
  decisionPayloadHash, comments = null, now = new Date().toISOString(),
}) {
  const decision = db.prepare('SELECT * FROM decision WHERE id = ?').get(decisionId);
  if (!decision) throw new ApprovalError(`Decision ${decisionId} not found`, 'NOT_FOUND');

  // ---- REQ-037: approval only in PENDING_APPROVAL. No post-execution rubber-stamping.
  if (decision.state !== 'PENDING_APPROVAL') {
    throw new ApprovalError(
      `Cannot approve a decision in state ${decision.state}; approval is only valid in ` +
      'PENDING_APPROVAL. A decision cannot be approved after it has been executed, rejected or sealed.',
      'WRONG_STATE', { state: decision.state },
    );
  }

  // ---- REQ-034: structural completeness first. A malformed submission is rejected as malformed,
  // rather than producing a misleading "role not held" for a role that was never supplied.
  const evidence = {
    requestedAction, reason, riskClassification, policyEvaluationId, requiredRole,
    approverIdentity, snapshotId, alternatives, policyVersion, systemVersion, decisionPayloadHash,
  };
  assertEvidenceComplete(evidence);

  // ---- REQ-035: the approver must hold the role they are signing for.
  const held = rolesOf(db, approverIdentity);
  if (!held.includes(requiredRole)) {
    throw new ApprovalError(
      `Identity ${approverIdentity} does not hold role ${requiredRole} ` +
      `(holds: ${held.join(', ') || 'none'}).`,
      'ROLE_NOT_HELD', { approverIdentity, requiredRole, held },
    );
  }

  // ---- REQ-036: separation of duties. One human cannot be two approvers.
  const already = db.prepare(
    `SELECT * FROM approval
      WHERE decision_id = ? AND approver_identity = ? AND supersedes_id IS NULL`,
  ).all(decisionId, approverIdentity);

  const activeOther = already.filter((a) => a.required_role !== requiredRole && !isSuperseded(db, a.id));
  if (activeOther.length > 0) {
    throw new ApprovalError(
      `Identity ${approverIdentity} has already approved this decision as ` +
      `${activeOther[0].required_role} and may not also satisfy ${requiredRole}. ` +
      'Two required roles must be satisfied by two different people.',
      'SELF_APPROVAL', { existingRole: activeOther[0].required_role },
    );
  }

  const id = `APV-${randomUUID().slice(0, 8)}`;
  db.prepare(
    `INSERT INTO approval
       (id, decision_id, request_id, requested_action, reason, risk_classification,
        policy_evaluation_id, required_role, approver_identity, approver_roles_json,
        decided_at, decision_value, comments, snapshot_id, selected_scenario_id,
        alternatives_json, policy_version, system_version, agent_recommendation,
        agent_confidence, agent_uncertainty, decision_payload_hash, supersedes_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id, decisionId, `REQ-${decisionId}`, requestedAction, reason, riskClassification,
    policyEvaluationId, requiredRole, approverIdentity, JSON.stringify(held),
    now, decisionValue, comments, snapshotId, selectedScenarioId,
    JSON.stringify(alternatives), policyVersion, systemVersion, agentRecommendation,
    agentConfidence, agentUncertainty, decisionPayloadHash, null,
  );

  ledger.append({
    eventType: decisionValue === 'APPROVED' ? 'APPROVAL_GRANTED' : 'APPROVAL_REJECTED',
    actor: approverIdentity, decisionId,
    payload: {
      approvalId: id, requiredRole, decisionValue,
      approverRoles: held, policyVersion, decisionPayloadHash,
      alternativesConsidered: alternatives.length,
    },
  });

  return db.prepare('SELECT * FROM approval WHERE id = ?').get(id);
}

function isSuperseded(db, approvalId) {
  return !!db.prepare('SELECT 1 FROM approval WHERE supersedes_id = ?').get(approvalId);
}

/** Active (non-superseded, non-invalidated) approvals for a decision. */
export function activeApprovals(db, decisionId) {
  return db.prepare(
    `SELECT a.* FROM approval a
      WHERE a.decision_id = ?
        AND NOT EXISTS (SELECT 1 FROM approval s WHERE s.supersedes_id = a.id)
        AND NOT EXISTS (SELECT 1 FROM approval_invalidation v WHERE v.approval_id = a.id)
      ORDER BY a.decided_at`,
  ).all(decisionId);
}

/**
 * Is the approval requirement satisfied?
 *
 * Returns a structured verdict rather than a boolean, because "not yet" and "rejected" are
 * different outcomes that must drive different state transitions.
 */
export function approvalStatus(db, decisionId, requiredRoles) {
  const active = activeApprovals(db, decisionId);
  const rejected = active.filter((a) => a.decision_value === 'REJECTED');

  if (rejected.length > 0) {
    return {
      satisfied: false, rejected: true,
      rejectedBy: rejected.map((a) => ({ identity: a.approver_identity, role: a.required_role })),
      missingRoles: [], approvals: active,
    };
  }

  const granted = active.filter((a) => a.decision_value === 'APPROVED');
  const have = new Set(granted.map((a) => a.required_role));
  const missingRoles = requiredRoles.filter((r) => !have.has(r));

  return {
    satisfied: missingRoles.length === 0 && requiredRoles.length > 0,
    rejected: false, rejectedBy: [], missingRoles, approvals: granted,
  };
}

/**
 * REQ-038 — invalidate approvals when the decision inputs change.
 *
 * We compare the current payload hash against the hash each approval was given under. This is the
 * mechanism that stops an approver's signature silently carrying over to a different plan than the
 * one they read. The approval row is preserved and an invalidation record is written, so the trail
 * shows a signature existed and why it stopped counting.
 */
export function invalidateStaleApprovals(db, ledger, {
  decisionId, selectedScenarioId, snapshotHash, actions, policyVersion,
  now = new Date().toISOString(),
}) {
  const currentHash = computeDecisionPayloadHash({
    decisionId, selectedScenarioId, snapshotHash, actions, policyVersion,
  });

  const stale = activeApprovals(db, decisionId)
    .filter((a) => a.decision_payload_hash !== currentHash);

  for (const a of stale) {
    db.prepare(
      `INSERT INTO approval_invalidation
         (id, approval_id, decision_id, invalidated_at, reason, old_hash, new_hash)
       VALUES (?,?,?,?,?,?,?)`,
    ).run(
      `INV-${randomUUID().slice(0, 8)}`, a.id, decisionId, now,
      'Decision inputs changed after approval was given.',
      a.decision_payload_hash, currentHash,
    );

    ledger.append({
      eventType: 'APPROVAL_INVALIDATED', actor: 'system:policy', decisionId,
      payload: {
        approvalId: a.id, approver: a.approver_identity, role: a.required_role,
        oldHash: a.decision_payload_hash, newHash: currentHash,
      },
    });
  }

  return { invalidated: stale.length, currentHash };
}

/**
 * REQ-040 — corrections supersede, never edit.
 *
 * The append-only triggers make UPDATE impossible at the database level; this is the supported way
 * to change one's mind, and it leaves both records visible.
 */
export function supersedeApproval(db, ledger, { approvalId, newDecisionValue, reason, approverIdentity, now = new Date().toISOString() }) {
  const original = db.prepare('SELECT * FROM approval WHERE id = ?').get(approvalId);
  if (!original) throw new ApprovalError(`Approval ${approvalId} not found`, 'NOT_FOUND');

  if (original.approver_identity !== approverIdentity) {
    throw new ApprovalError(
      `Only ${original.approver_identity} may supersede their own approval.`,
      'NOT_OWNER',
    );
  }

  const id = `APV-${randomUUID().slice(0, 8)}`;
  db.prepare(
    `INSERT INTO approval
       (id, decision_id, request_id, requested_action, reason, risk_classification,
        policy_evaluation_id, required_role, approver_identity, approver_roles_json,
        decided_at, decision_value, comments, snapshot_id, selected_scenario_id,
        alternatives_json, policy_version, system_version, agent_recommendation,
        agent_confidence, agent_uncertainty, decision_payload_hash, supersedes_id)
     SELECT ?, decision_id, request_id, requested_action, ?, risk_classification,
        policy_evaluation_id, required_role, approver_identity, approver_roles_json,
        ?, ?, comments, snapshot_id, selected_scenario_id,
        alternatives_json, policy_version, system_version, agent_recommendation,
        agent_confidence, agent_uncertainty, decision_payload_hash, ?
       FROM approval WHERE id = ?`,
  ).run(id, reason, now, newDecisionValue, approvalId, approvalId);

  ledger.append({
    eventType: 'APPROVAL_SUPERSEDED', actor: approverIdentity, decisionId: original.decision_id,
    payload: { supersedes: approvalId, newApprovalId: id, newValue: newDecisionValue, reason },
  });

  return db.prepare('SELECT * FROM approval WHERE id = ?').get(id);
}
