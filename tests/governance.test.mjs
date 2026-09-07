/**
 * P12 verification — policy engine and approval integrity.
 *
 * These tests are adversarial by design. Each one attempts a specific bypass that a real operator
 * under pressure, or an attacker, would try. Traces REQ-030…041.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { openDatabase } from '../src/db/index.mjs';
import { seedDatabase, SEED_EPOCH } from '../src/db/seed.mjs';
import { AuditLedger } from '../src/core/audit.mjs';
import { MockProvider } from '../src/agents/provider.mjs';
import { runPipeline } from '../src/core/pipeline.mjs';
import { computeDecisionPayloadHash } from '../src/core/snapshot.mjs';
import {
  evaluatePolicy, POLICY_VERSION, THRESHOLDS, RULES, AUTONOMY_CLASSES,
} from '../src/core/policy.mjs';
import {
  submitApproval, approvalStatus, rolesOf, invalidateStaleApprovals, supersedeApproval,
  ApprovalError, REQUIRED_EVIDENCE_FIELDS,
} from '../src/core/approval.mjs';

const ctx = () => {
  const db = openDatabase(':memory:');
  seedDatabase(db);
  return { db, ledger: new AuditLedger(db), provider: new MockProvider() };
};
const pending = async (c) => runPipeline({ ...c, asOf: SEED_EPOCH });

const APPROVERS = [
  { identity: 'user:ravi', role: 'SUPPLY_CHAIN_MANAGER' },
  { identity: 'user:daniel', role: 'QUALITY_ASSURANCE' },
  { identity: 'user:sofia', role: 'FINANCE_APPROVER' },
];

/** Builds a complete, valid evidence payload for a pending decision. */
function evidenceFor(r, overrides = {}) {
  return {
    decisionId: r.decisionId,
    approverIdentity: 'user:ravi',
    requiredRole: 'SUPPLY_CHAIN_MANAGER',
    decisionValue: 'APPROVED',
    requestedAction: `${r.selected.strategyType}: ${r.actions.length} action(s)`,
    reason: r.policy.reason,
    riskClassification: `risk ${r.selected.riskScore}/100`,
    policyEvaluationId: r.policyEvalId,
    snapshotId: r.snapshot.id,
    selectedScenarioId: r.selected.id,
    alternatives: r.ranked.slice(1).map((s) => ({ id: s.id, strategy: s.strategyType })),
    policyVersion: POLICY_VERSION,
    systemVersion: '0.6.0',
    decisionPayloadHash: computeDecisionPayloadHash(r.payloadInputs),
    ...overrides,
  };
}

// ------------------------------------------------------------------ REQ-031: no agent in policy

test('REQ-031: the policy engine imports nothing from the agent layer', () => {
  const src = readFileSync(new URL('../src/core/policy.mjs', import.meta.url), 'utf8');
  const imports = src.match(/^import .*$/gm) ?? [];
  assert.equal(imports.length, 0, 'the policy engine has no dependencies at all');
  // Guard against a future edit wiring in a model, ignoring prose in comments.
  const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  assert.doesNotMatch(code, /agents\/|provider|llm|prompt/i,
    'policy must be deterministic code with no agent involvement');
});

test('NFR-008: no deterministic core module imports the agent layer, except the orchestrator', () => {
  for (const f of readdirSync(new URL('../src/core/', import.meta.url))) {
    if (f === 'pipeline.mjs') continue; // the orchestrator is allowed to call agents at seams
    const src = readFileSync(new URL(`../src/core/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /from '\.\.\/agents\//, `${f} must not depend on the agent layer`);
  }
});

// ------------------------------------------------------------------ REQ-030/032: classification

test('REQ-030: every verdict is one of the four declared autonomy classes', () => {
  const cases = [
    { scenario: null, impact: { daysOfCover: [] } },
    { scenario: { feasibility: 'BLOCKED' }, impact: { daysOfCover: [] } },
    { scenario: { feasibility: 'FEASIBLE', costDeltaMinor: 100, riskScore: 1 }, impact: { daysOfCover: [] } },
    { scenario: { feasibility: 'FEASIBLE', costDeltaMinor: 9_000_000, riskScore: 80 }, impact: { daysOfCover: [] } },
  ];
  for (const c of cases) {
    assert.ok(AUTONOMY_CLASSES.includes(evaluatePolicy(c).autonomyClass));
  }
});

test('REQ-030: a small, low-risk, reversible action is AUTONOMOUS', () => {
  const v = evaluatePolicy({
    scenario: { strategyType: 'AIR_REROUTE', feasibility: 'FEASIBLE', costDeltaMinor: 10_000, riskScore: 5, riskComponents: { excursion: 0 } },
    impact: { daysOfCover: [{ status: 'HEALTHY' }] },
    agentConfidence: 0.95,
  });
  assert.equal(v.autonomyClass, 'AUTONOMOUS');
  assert.deepEqual(v.requiredRoles, []);
});

test('REQ-032: required roles are derived from the specific factors that fired', () => {
  const coldChain = evaluatePolicy({
    scenario: { strategyType: 'AIR_REROUTE', feasibility: 'FEASIBLE', costDeltaMinor: 10_000, riskScore: 5, riskComponents: { excursion: 3 } },
    impact: { daysOfCover: [] },
  });
  assert.ok(coldChain.requiredRoles.includes('QUALITY_ASSURANCE'), 'cold chain pulls in QA');

  const supplier = evaluatePolicy({
    scenario: { strategyType: 'ALT_SUPPLIER', feasibility: 'FEASIBLE', costDeltaMinor: 10_000, riskScore: 5 },
    impact: { daysOfCover: [] },
  });
  assert.ok(supplier.requiredRoles.includes('PROCUREMENT_MANAGER'));
  assert.ok(supplier.requiredRoles.includes('COMPLIANCE_OFFICER'),
    'P-1 cannot switch a supplier alone');

  const expensive = evaluatePolicy({
    scenario: { strategyType: 'AIR_REROUTE', feasibility: 'FEASIBLE', costDeltaMinor: 9_000_000, riskScore: 5 },
    impact: { daysOfCover: [] },
  });
  assert.ok(expensive.requiredRoles.includes('FINANCE_APPROVER'));
});

test('low agent confidence alone forces a human into the loop', () => {
  const v = evaluatePolicy({
    scenario: { strategyType: 'AIR_REROUTE', feasibility: 'FEASIBLE', costDeltaMinor: 1_000, riskScore: 1, riskComponents: { excursion: 0 } },
    impact: { daysOfCover: [] },
    agentConfidence: 0.4,
  });
  assert.equal(v.autonomyClass, 'APPROVAL_REQUIRED');
  assert.ok(v.firedRules.some((r) => r.id === 'R-LOW-AGENT-CONFIDENCE'));
});

test('REQ-041: the verdict carries its policy version and every fired rule', () => {
  const v = evaluatePolicy({
    scenario: { strategyType: 'INVENTORY_REBALANCE', feasibility: 'FEASIBLE', costDeltaMinor: 3_900, riskScore: 15 },
    impact: { daysOfCover: [{ status: 'CRITICAL' }] },
  });
  assert.equal(v.policyVersion, POLICY_VERSION);
  assert.ok(v.firedRules.length > 0);
  for (const r of v.firedRules) {
    assert.ok(r.id && r.reason, 'every fired rule must explain itself to the approver');
  }
  assert.equal(v.thresholds.criticalCoverDays, THRESHOLDS.criticalCoverDays);
});

test('an INFEASIBLE or BLOCKED option is never merely "approval required"', () => {
  for (const feasibility of ['BLOCKED', 'INFEASIBLE']) {
    const v = evaluatePolicy({ scenario: { feasibility }, impact: { daysOfCover: [] } });
    assert.equal(v.autonomyClass, 'BLOCKED');
    assert.deepEqual(v.requiredRoles, [], 'a blocked action has no approver who could rescue it');
  }
});

test('every rule has a stable id and a human-readable reason', () => {
  const ids = RULES.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, 'rule ids must be unique');
  for (const r of RULES) {
    assert.match(r.id, /^R-[A-Z-]+$/);
    assert.ok(r.reason.length > 20, `${r.id} needs an explanation an approver can act on`);
  }
});

// ------------------------------------------------------------------ identity & roles

test('seeded identities match the P1 personas and their stated authority', () => {
  const { db } = ctx();
  assert.deepEqual(rolesOf(db, 'user:ravi'), ['SUPPLY_CHAIN_MANAGER']);
  assert.deepEqual(rolesOf(db, 'user:daniel'), ['COMPLIANCE_OFFICER', 'QUALITY_ASSURANCE']);
  assert.deepEqual(rolesOf(db, 'user:priya'), ['READ_ONLY']);
  assert.deepEqual(rolesOf(db, 'user:nobody'), [], 'an unknown identity holds nothing');
});

// ------------------------------------------------------------------ REQ-034: evidence contract

test('REQ-034: an approval missing any evidence field is rejected', async () => {
  const c = ctx();
  const r = await pending(c);

  for (const field of REQUIRED_EVIDENCE_FIELDS) {
    if (field === 'alternatives') continue; // covered separately: empty is legal, absent is not
    assert.throws(
      () => submitApproval(c.db, c.ledger, evidenceFor(r, { [field]: null })),
      (e) => e instanceof ApprovalError && e.kind === 'INCOMPLETE_EVIDENCE'
        && e.detail.missing.includes(field),
      `omitting ${field} must be rejected`,
    );
  }
});

test('REQ-034: a bare approved=true is not an approval', async () => {
  const c = ctx();
  const r = await pending(c);
  assert.throws(
    () => submitApproval(c.db, c.ledger, {
      decisionId: r.decisionId, approverIdentity: 'user:ravi',
      requiredRole: 'SUPPLY_CHAIN_MANAGER', decisionValue: 'APPROVED',
    }),
    (e) => e.kind === 'INCOMPLETE_EVIDENCE',
  );
});

test('a stored approval carries the alternatives that were on the table', async () => {
  const c = ctx();
  const r = await pending(c);
  const a = submitApproval(c.db, c.ledger, evidenceFor(r));

  const alts = JSON.parse(a.alternatives_json);
  assert.ok(alts.length > 0, 'the approver must be recorded as having seen the alternatives');
  assert.ok(a.decision_payload_hash, 'the approval binds to the exact plan approved');
  assert.deepEqual(JSON.parse(a.approver_roles_json), ['SUPPLY_CHAIN_MANAGER']);
});

// ------------------------------------------------------------------ REQ-035/036: authorization

test('REQ-035: an identity without the required role cannot approve', async () => {
  const c = ctx();
  const r = await pending(c);

  assert.throws(
    () => submitApproval(c.db, c.ledger, evidenceFor(r, {
      approverIdentity: 'user:priya', requiredRole: 'SUPPLY_CHAIN_MANAGER',
    })),
    (e) => e.kind === 'ROLE_NOT_HELD',
    'the read-only hospital lead must not be able to approve a reroute',
  );

  assert.throws(
    () => submitApproval(c.db, c.ledger, evidenceFor(r, {
      approverIdentity: 'user:ravi', requiredRole: 'QUALITY_ASSURANCE',
    })),
    (e) => e.kind === 'ROLE_NOT_HELD',
    'Ravi does not hold QA and must not self-certify a cold-chain excursion',
  );
});

test('REQ-036: one identity cannot satisfy two required roles', async () => {
  const c = ctx();
  const r = await pending(c);

  // Sofia legitimately holds both FINANCE_APPROVER and SUPPLY_CHAIN_MANAGER.
  submitApproval(c.db, c.ledger, evidenceFor(r, {
    approverIdentity: 'user:sofia', requiredRole: 'SUPPLY_CHAIN_MANAGER',
  }));

  assert.throws(
    () => submitApproval(c.db, c.ledger, evidenceFor(r, {
      approverIdentity: 'user:sofia', requiredRole: 'FINANCE_APPROVER',
    })),
    (e) => e.kind === 'SELF_APPROVAL',
    'holding two roles must not let one person constitute a two-person control',
  );
});

// ------------------------------------------------------------------ REQ-037: state discipline

test('REQ-037: approval is impossible outside PENDING_APPROVAL', async () => {
  const c = ctx();
  const r = await runPipeline({ ...c, asOf: SEED_EPOCH, approval: { approvals: APPROVERS } });
  assert.equal(r.state, 'SEALED');

  assert.throws(
    () => submitApproval(c.db, c.ledger, evidenceFor(r, { approverIdentity: 'user:ravi' })),
    (e) => e.kind === 'WRONG_STATE',
    'an executed and sealed decision must not accept a retrospective approval',
  );
});

// ------------------------------------------------------------------ REQ-038: staleness

test('REQ-038: approvals are invalidated when the decision inputs change', async () => {
  const c = ctx();
  const r = await pending(c);
  submitApproval(c.db, c.ledger, evidenceFor(r));

  // Nothing changed yet.
  let res = invalidateStaleApprovals(c.db, c.ledger, { ...r.payloadInputs });
  assert.equal(res.invalidated, 0);
  assert.equal(approvalStatus(c.db, r.decisionId, ['SUPPLY_CHAIN_MANAGER']).satisfied, true);

  // Now the selected plan changes underneath the approver.
  res = invalidateStaleApprovals(c.db, c.ledger, {
    ...r.payloadInputs, selectedScenarioId: 'SCN-DIFFERENT',
  });
  assert.equal(res.invalidated, 1);

  const after = approvalStatus(c.db, r.decisionId, ['SUPPLY_CHAIN_MANAGER']);
  assert.equal(after.satisfied, false, 'a stale signature must stop counting');

  // The record is preserved, not deleted — the trail shows it existed and why it lapsed.
  assert.equal(c.db.prepare('SELECT COUNT(*) c FROM approval').get().c, 1);
  const inv = c.db.prepare('SELECT * FROM approval_invalidation').get();
  assert.match(inv.reason, /inputs changed/i);
  assert.notEqual(inv.old_hash, inv.new_hash);
});

test('REQ-038: the pipeline returns to PENDING_APPROVAL rather than executing on a stale approval', async () => {
  const c = ctx();
  const r = await pending(c);

  // Approve against the CURRENT plan, then mutate the world so the hash no longer matches.
  for (const a of APPROVERS) submitApproval(c.db, c.ledger, evidenceFor(r, { approverIdentity: a.identity, requiredRole: a.role }));

  const changed = invalidateStaleApprovals(c.db, c.ledger, {
    ...r.payloadInputs, actions: [...r.actions, { type: 'REROUTE_SHIPMENT', shipmentId: 'SHP-9999' }],
  });
  assert.equal(changed.invalidated, 3, 'all three signatures lapse together');

  const status = approvalStatus(c.db, r.decisionId, r.policy.requiredRoles);
  assert.equal(status.satisfied, false);
  assert.equal(c.db.prepare('SELECT COUNT(*) c FROM execution_authorization').get().c, 0);
});

// ------------------------------------------------------------------ REQ-039/040

test('REQ-039: a rejection seals the decision and nothing executes', async () => {
  const c = ctx();
  const r = await runPipeline({
    ...c, asOf: SEED_EPOCH,
    approval: {
      approvals: [
        { identity: 'user:ravi', role: 'SUPPLY_CHAIN_MANAGER' },
        { identity: 'user:daniel', role: 'QUALITY_ASSURANCE', decisionValue: 'REJECTED', reason: 'Excursion budget unacceptable.' },
      ],
    },
  });

  assert.equal(r.state, 'SEALED');
  assert.equal(r.executed, null);
  assert.equal(c.db.prepare('SELECT COUNT(*) c FROM execution_result').get().c, 0);
  assert.equal(c.db.prepare('SELECT COUNT(*) c FROM execution_authorization').get().c, 0);

  const states = c.db.prepare(
    "SELECT payload_json FROM audit_event WHERE event_type='STATE_TRANSITION'").all()
    .map((e) => JSON.parse(e.payload_json).payload.to);
  assert.ok(states.includes('REJECTED'));
  assert.ok(!states.includes('EXECUTING'), 'a rejected decision must never reach EXECUTING');
});

test('REQ-040: approvals are append-only; a correction supersedes', async () => {
  const c = ctx();
  const r = await pending(c);
  const original = submitApproval(c.db, c.ledger, evidenceFor(r));

  assert.throws(
    () => c.db.prepare('UPDATE approval SET decision_value = ? WHERE id = ?')
      .run('REJECTED', original.id),
    /append-only|Approval records/i,
    'the database itself must refuse an in-place edit',
  );

  const corrected = supersedeApproval(c.db, c.ledger, {
    approvalId: original.id, newDecisionValue: 'REJECTED',
    reason: 'Reconsidered after speaking to the carrier.', approverIdentity: 'user:ravi',
  });

  assert.equal(corrected.supersedes_id, original.id);
  assert.equal(c.db.prepare('SELECT COUNT(*) c FROM approval').get().c, 2, 'both records survive');

  const active = approvalStatus(c.db, r.decisionId, ['SUPPLY_CHAIN_MANAGER']);
  assert.equal(active.rejected, true, 'the superseding record is the one that counts');
});

test('only the original approver may supersede their own approval', async () => {
  const c = ctx();
  const r = await pending(c);
  const a = submitApproval(c.db, c.ledger, evidenceFor(r));

  assert.throws(
    () => supersedeApproval(c.db, c.ledger, {
      approvalId: a.id, newDecisionValue: 'REJECTED', reason: 'x', approverIdentity: 'user:daniel',
    }),
    (e) => e.kind === 'NOT_OWNER',
  );
});

// ------------------------------------------------------------------ full governed run

test('REQ-033: a multi-role decision retains each approval plus the final authorization', async () => {
  const c = ctx();
  const r = await runPipeline({ ...c, asOf: SEED_EPOCH, approval: { approvals: APPROVERS } });

  assert.equal(r.state, 'SEALED');
  assert.equal(r.policy.requiredRoles.length, 3);

  const stored = c.db.prepare('SELECT * FROM approval ORDER BY decided_at').all();
  assert.equal(stored.length, 3, 'each individual approval is retained');
  assert.deepEqual(
    stored.map((a) => a.required_role).sort(),
    ['FINANCE_APPROVER', 'QUALITY_ASSURANCE', 'SUPPLY_CHAIN_MANAGER'],
  );
  assert.equal(new Set(stored.map((a) => a.approver_identity)).size, 3, 'three distinct people');

  const auth = c.db.prepare('SELECT * FROM execution_authorization').get();
  assert.ok(auth, 'a single final authorization is minted');
  assert.equal(JSON.parse(auth.approvals_json).length, 3);
});

test('the flagship decision requires three roles because three distinct rules fired', async () => {
  const c = ctx();
  const r = await pending(c);

  assert.deepEqual(r.policy.requiredRoles,
    ['FINANCE_APPROVER', 'QUALITY_ASSURANCE', 'SUPPLY_CHAIN_MANAGER']);
  const ids = r.policy.firedRules.map((x) => x.id);
  assert.ok(ids.includes('R-COLD-CHAIN'), 'the air lane carries an excursion');
  assert.ok(ids.includes('R-HIGH-COST'), 'the air premium crosses the finance threshold');
});

test('the whole governed run stays audit-verifiable', async () => {
  const c = ctx();
  await runPipeline({ ...c, asOf: SEED_EPOCH, approval: { approvals: APPROVERS } });

  assert.equal(c.ledger.verify().valid, true);
  const types = c.db.prepare('SELECT event_type FROM audit_event').all().map((e) => e.event_type);
  assert.equal(types.filter((t) => t === 'APPROVAL_GRANTED').length, 3);
  assert.ok(types.includes('AUTHORIZATION_MINTED'));
});
