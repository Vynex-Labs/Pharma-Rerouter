/**
 * End-to-end pipeline (P9) — the flagship flow, wired.
 *
 *   DETECTED -> IMPACT_ASSESSED -> SCENARIOS_GENERATED -> RANKED -> POLICY_EVALUATED
 *            -> PENDING_APPROVAL -> APPROVED -> EXECUTING -> RECOVERY_VERIFIED -> SEALED
 *
 * The orchestrator is deterministic code. Agents are called at named seams and their output is
 * consumed as interpretation only; every authoritative number comes from `src/core/`.
 *
 * The pipeline STOPS at PENDING_APPROVAL unless an approval is supplied. There is no auto-approve
 * convenience path, because a demo that approves itself would defeat the entire governance model.
 */

import { captureSnapshot, computeDecisionPayloadHash } from './snapshot.mjs';
import { assessImpact } from './impact.mjs';
import { generateScenarios } from './scenarios.mjs';
import { rankScenarios } from './scoring.mjs';
import { DecisionMachine } from './statemachine.mjs';
import { mintAuthorization, executeDecision, verifyRecovery } from './execution.mjs';
import { persistImpact, persistScenarios } from './persist.mjs';
import { evaluatePolicy, persistPolicyEvaluation, POLICY_VERSION } from './policy.mjs';
import { submitApproval, approvalStatus, invalidateStaleApprovals } from './approval.mjs';
import { senseDisruption, narrateImpact, proposeStrategies, explainDecision, orchestratorAdvice }
  from '../agents/index.mjs';

/**
 * Returns the bounded action list for a scenario.
 *
 * The engine already emits a fully-formed `actions` array when it builds each scenario, computed
 * from the same path/transfer data that produced the cost and ETA. An earlier version of this
 * function re-derived actions from the impact record instead, which silently produced malformed
 * entries (a whole shipment object where an id belonged, and a null lane) — defect D9-1. Re-deriving
 * data the engine already computed is how the executed actions drift away from the scored ones.
 */
export function actionsFor(scenario) {
  if (!scenario) return [];
  return scenario.actions ?? [];
}

/**
 * Runs the pipeline from detection to PENDING_APPROVAL (or BLOCKED).
 *
 * @param approval  optional. When supplied by a caller that has performed real approval capture,
 *                  the pipeline continues through execution and recovery verification.
 */
export async function runPipeline({
  db, ledger, provider, disruptionId = 'DSR-0001', asOf,
  approval = null, systemVersion = '0.5.0',
}) {
  const machine = new DecisionMachine(db, ledger, { systemVersion });
  const trace = [];
  const step = (name, detail) => trace.push({ step: name, ...detail });

  // ---------------------------------------------------------------- DETECTED
  const disruptionRow = db.prepare('SELECT * FROM disruption_event WHERE id = ?').get(disruptionId);
  if (!disruptionRow) throw new Error(`Unknown disruption ${disruptionId}`);

  const decision = machine.create({ disruptionId });
  const snapshot = captureSnapshot(db, { disruptionId });
  step('DETECTED', { decisionId: decision.id, snapshotHash: snapshot.snapshotHash });

  // S1 — sensing (agent interprets; it does not decide the workflow)
  const sensing = await senseDisruption({
    provider, disruption: disruptionRow, snapshot: snapshot.payload, db, decisionId: decision.id,
  });
  db.prepare(
    `UPDATE disruption_event SET event_type=?, severity=?, confidence=?, geography=?,
       expected_duration_hours=?, classification_source=? WHERE id=?`,
  ).run(
    sensing.output.eventType, sensing.output.severity, sensing.output.confidence,
    sensing.output.geography, sensing.output.expectedDurationHours,
    sensing.ok ? 'AGENT' : 'DETERMINISTIC_FALLBACK', disruptionId,
  );
  const classified = db.prepare('SELECT * FROM disruption_event WHERE id = ?').get(disruptionId);

  // ---------------------------------------------------------------- IMPACT_ASSESSED
  const impact = assessImpact(snapshot.payload, classified, { asOf });
  const impactId = persistImpact(db, {
    impact, disruptionId, snapshotId: snapshot.id,
  });
  machine.transition(decision.id, 'IMPACT_ASSESSED', {
    expectedVersion: 1, fields: { impact_id: impactId },
  });
  step('IMPACT_ASSESSED', {
    ordersAtRisk: impact.ordersAtRisk.length,
    criticalSites: impact.daysOfCover.filter((c) => c.status === 'CRITICAL').length,
  });

  const narrative = await narrateImpact({
    provider, impact, snapshot: snapshot.payload, db, decisionId: decision.id,
  });
  db.prepare('UPDATE impact_assessment SET narrative = ?, narrative_source = ? WHERE id = ?')
    .run(
      narrative.output.text,
      narrative.usedFallback ? 'DETERMINISTIC_FALLBACK' : 'AGENT',
      impactId,
    );

  // ---------------------------------------------------------------- SCENARIOS_GENERATED
  const intents = await proposeStrategies({
    provider, impact, snapshot: snapshot.payload, db, decisionId: decision.id,
  });
  const gen = generateScenarios(impact, { asOf, strategyIntents: intents.output.intents });
  machine.transition(decision.id, 'SCENARIOS_GENERATED', { expectedVersion: 2 });
  step('SCENARIOS_GENERATED', {
    count: gen.scenarios.length, origin: gen.generationOrigin,
  });

  // ---------------------------------------------------------------- RANKED
  const { ranked, excluded, weights } = rankScenarios(gen.scenarios);
  const selected = ranked[0] ?? null;
  persistScenarios(db, { ranked, excluded, impactId, snapshotId: snapshot.id });
  machine.transition(decision.id, 'RANKED', {
    expectedVersion: 3,
    fields: { selected_scenario_id: selected?.id ?? null },
  });
  step('RANKED', {
    top: selected?.strategyType ?? null, score: selected?.score ?? null,
    excluded: excluded.length,
  });

  // ---------------------------------------------------------------- POLICY_EVALUATED
  // S4 — deterministic policy engine. No agent involvement (REQ-031).
  const policy = evaluatePolicy({
    scenario: selected, impact,
    agentConfidence: sensing.output.confidence ?? null,
  });
  const policyEvalId = persistPolicyEvaluation(db, { decisionId: decision.id, verdict: policy });

  const actions = actionsFor(selected);
  const payloadInputs = {
    decisionId: decision.id,
    selectedScenarioId: selected?.id ?? null,
    snapshotHash: snapshot.snapshotHash,
    actions,
    policyVersion: POLICY_VERSION,
  };

  machine.transition(decision.id, 'POLICY_EVALUATED', { expectedVersion: 4 });
  step('POLICY_EVALUATED', {
    autonomyClass: policy.autonomyClass, requiredRoles: policy.requiredRoles,
  });

  const explanation = selected
    ? await explainDecision({
      provider,
      decisionContext: { selected, alternatives: [...ranked.slice(1), ...excluded], policy },
      snapshot: snapshot.payload, impact, db, decisionId: decision.id,
    })
    : null;
  const advice = orchestratorAdvice({ impact, ranked, excluded });

  const base = {
    decisionId: decision.id, machine, snapshot, impact, gen, ranked, excluded, weights,
    selected, policy, policyEvalId, actions, payloadInputs, trace, impactId,
    policyVersion: POLICY_VERSION,
    agents: { sensing, narrative, intents, explanation, advice },
    disruption: classified,
  };

  // ---------------------------------------------------------------- BLOCKED
  if (policy.autonomyClass === 'BLOCKED') {
    machine.transition(decision.id, 'BLOCKED', { expectedVersion: 5, reason: policy.reason });
    step('BLOCKED', { reason: policy.reason });
    return { ...base, state: machine.get(decision.id).state, executed: null, recovery: null };
  }

  // ---------------------------------------------------------------- PENDING_APPROVAL
  machine.transition(decision.id, 'PENDING_APPROVAL', {
    expectedVersion: 5,
    fields: { payload_hash: null },
  });
  step('PENDING_APPROVAL', { requiredRoles: policy.requiredRoles });

  // The pipeline halts here by design unless a caller supplies genuine approval evidence.
  if (!approval) {
    return { ...base, state: machine.get(decision.id).state, executed: null, recovery: null };
  }

  // ---------------------------------------------------------------- APPROVAL CAPTURE (P12)
  // `approvals` is a list of {identity, role, comments}. Each is captured individually and
  // validated against the policy verdict, role holdings and separation of duties.
  const submitted = [];
  for (const a of (approval.approvals ?? [])) {
    submitted.push(submitApproval(db, ledger, {
      decisionId: decision.id,
      approverIdentity: a.identity,
      requiredRole: a.role,
      decisionValue: a.decisionValue ?? 'APPROVED',
      requestedAction: `${selected.strategyType}: ${actions.length} bounded action(s)`,
      reason: a.reason ?? policy.reason,
      riskClassification: `risk ${selected.riskScore}/100, ${policy.autonomyClass}`,
      policyEvaluationId: policyEvalId,
      snapshotId: snapshot.id,
      selectedScenarioId: selected.id,
      alternatives: [...ranked.slice(1), ...excluded].map((x) => ({
        id: x.id, strategy: x.strategyType, score: x.score ?? null,
        feasibility: x.feasibility, reason: x.infeasibilityReason ?? null,
      })),
      policyVersion: POLICY_VERSION,
      systemVersion,
      agentRecommendation: explanation?.output?.text ?? null,
      agentConfidence: sensing.output.confidence ?? null,
      agentUncertainty: sensing.output.uncertainty ?? null,
      decisionPayloadHash: computeDecisionPayloadHash(payloadInputs),
      comments: a.comments ?? null,
    }));
  }

  const status = approvalStatus(db, decision.id, policy.requiredRoles);
  step('APPROVAL_CAPTURED', {
    granted: submitted.length, satisfied: status.satisfied,
    missing: status.missingRoles, rejected: status.rejected,
  });

  if (status.rejected) {
    machine.transition(decision.id, 'REJECTED', {
      actor: status.rejectedBy[0].identity,
      expectedVersion: machine.get(decision.id).version,
      reason: 'Rejected by an approver.',
    });
    machine.transition(decision.id, 'SEALED', {
      expectedVersion: machine.get(decision.id).version,
    });
    step('REJECTED', { by: status.rejectedBy });
    return { ...base, state: machine.get(decision.id).state, executed: null, recovery: null, approvals: submitted };
  }

  if (!status.satisfied) {
    step('AWAITING_APPROVAL', { missingRoles: status.missingRoles });
    return { ...base, state: machine.get(decision.id).state, executed: null, recovery: null, approvals: submitted };
  }

  // ---------------------------------------------------------------- APPROVED
  machine.transition(decision.id, 'APPROVED', {
    actor: submitted[0].approver_identity,
    expectedVersion: machine.get(decision.id).version,
  });
  step('APPROVED', { approvers: submitted.map((a) => `${a.approver_identity}/${a.required_role}`) });

  // REQ-038: re-check that nothing changed between approval and authorization.
  const staleCheck = invalidateStaleApprovals(db, ledger, { ...payloadInputs });
  if (staleCheck.invalidated > 0) {
    machine.transition(decision.id, 'PENDING_APPROVAL', {
      expectedVersion: machine.get(decision.id).version,
      reason: 'Decision inputs changed; approvals invalidated.',
    });
    step('APPROVAL_INVALIDATED', { count: staleCheck.invalidated });
    return { ...base, state: machine.get(decision.id).state, executed: null, recovery: null, approvals: submitted };
  }

  const auth = mintAuthorization(db, ledger, {
    ...payloadInputs,
    approvals: submitted.map((a) => ({
      approvalId: a.id, identity: a.approver_identity, role: a.required_role,
    })),
  });

  // ---------------------------------------------------------------- EXECUTING
  machine.transition(decision.id, 'EXECUTING', {
    expectedVersion: machine.get(decision.id).version,
  });

  const executed = executeDecision(db, ledger, {
    decisionId: decision.id, authorizationId: auth.id, ...payloadInputs,
  });
  step('EXECUTING', { outcome: executed.outcome, actions: actions.length });

  // ---------------------------------------------------------------- RECOVERY_VERIFIED
  const afterSnapshot = captureSnapshot(db, { disruptionId });
  // countInbound: rerouted shipments are now in transit and DO contribute to cover (D9-2).
  const afterImpact = assessImpact(afterSnapshot.payload, classified, { asOf, countInbound: true });

  /**
   * The objective is the SELECTED SCENARIO'S OWN PREDICTION, not an arbitrary ideal.
   *
   * "Zero orders at risk" would be unachievable for most real options and would report every
   * execution as a failure, which tells an operator nothing. The question worth answering is:
   * *did the action deliver what the engine said it would?* That makes the ranking itself
   * falsifiable — if scenarios routinely miss their predictions, the scoring model is wrong.
   */
  const predictedResidual = selected.detail?.residualOrdersAtRisk
    ?? Math.max(0, impact.ordersAtRisk.length - selected.ordersProtected);

  const objective = {
    maxOrdersAtRisk: predictedResidual,
    maxCriticalSites: 0,
    basis: 'SELECTED_SCENARIO_PREDICTION',
    predictedBy: selected.id,
  };
  const recovery = verifyRecovery(db, ledger, {
    decisionId: decision.id, before: impact, after: afterImpact, objective,
  });

  machine.transition(decision.id, 'RECOVERY_VERIFIED', {
    expectedVersion: machine.get(decision.id).version,
  });
  step('RECOVERY_VERIFIED', {
    objectiveMet: recovery.objective_met === 1,
    ordersAtRisk: afterImpact.ordersAtRisk.length,
  });

  // ---------------------------------------------------------------- SEALED
  machine.transition(decision.id, 'SEALED', {
    expectedVersion: machine.get(decision.id).version,
  });
  step('SEALED', { integrity: ledger.verify().valid });

  return {
    ...base,
    state: machine.get(decision.id).state,
    authorization: auth,
    executed,
    recovery,
    afterImpact,
  };
}
