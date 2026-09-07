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

import { captureSnapshot } from './snapshot.mjs';
import { assessImpact } from './impact.mjs';
import { generateScenarios } from './scenarios.mjs';
import { rankScenarios } from './scoring.mjs';
import { DecisionMachine } from './statemachine.mjs';
import { mintAuthorization, executeDecision, verifyRecovery } from './execution.mjs';
import { persistImpact, persistScenarios } from './persist.mjs';
import { senseDisruption, narrateImpact, proposeStrategies, explainDecision, orchestratorAdvice }
  from '../agents/index.mjs';

/**
 * Interim policy used by P9 to exercise the spine. **This is not the P12 policy engine.**
 * It implements only the coarse classification needed to prove the state machine works; P12
 * replaces it with the full rule table, role routing and evidence contract.
 */
export const INTERIM_POLICY_VERSION = 'interim-p9-0.1.0';

export function evaluatePolicyInterim(scenario, impact) {
  if (!scenario) {
    return { autonomyClass: 'BLOCKED', requiredRoles: [], reason: 'No feasible scenario exists.' };
  }
  if (scenario.feasibility === 'BLOCKED') {
    return {
      autonomyClass: 'BLOCKED', requiredRoles: [],
      reason: scenario.infeasibilityReason ?? 'Selected option is blocked by policy.',
    };
  }
  const highValue = Math.abs(scenario.costDeltaMinor) >= 1_000_000; // 10,000 currency units
  const critical = impact.daysOfCover.some((c) => c.status === 'CRITICAL');

  return {
    autonomyClass: 'APPROVAL_REQUIRED',
    requiredRoles: highValue || critical
      ? ['SUPPLY_CHAIN_MANAGER', 'QUALITY_ASSURANCE']
      : ['SUPPLY_CHAIN_MANAGER'],
    reason: highValue
      ? 'Cost impact exceeds the autonomous threshold; dual approval required.'
      : critical
        ? 'A site is below the critical cover threshold; dual approval required.'
        : 'Routine rerouting within thresholds; single approval required.',
  };
}

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
  const policy = evaluatePolicyInterim(selected, impact);
  const policyEvalId = `POL-${decision.id}`;
  db.prepare(
    `INSERT INTO policy_evaluation
       (id, decision_id, evaluated_at, autonomy_class, required_roles_json, fired_rules_json,
        policy_version, reason)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(
    policyEvalId, decision.id, new Date().toISOString(), policy.autonomyClass,
    JSON.stringify(policy.requiredRoles), JSON.stringify(['interim-p9']),
    INTERIM_POLICY_VERSION, policy.reason,
  );

  const actions = actionsFor(selected);
  const payloadInputs = {
    decisionId: decision.id,
    selectedScenarioId: selected?.id ?? null,
    snapshotHash: snapshot.snapshotHash,
    actions,
    policyVersion: INTERIM_POLICY_VERSION,
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

  // ---------------------------------------------------------------- APPROVED
  const current = machine.get(decision.id);
  machine.transition(decision.id, 'APPROVED', {
    actor: approval.approverIdentity,
    expectedVersion: current.version,
  });
  step('APPROVED', { approver: approval.approverIdentity });

  const auth = mintAuthorization(db, ledger, {
    ...payloadInputs, approvals: approval.approvals ?? [approval.approverIdentity],
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
