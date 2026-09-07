/**
 * Policy Engine (P12) — seam S4, which has NO AGENT by design.
 *
 * This is the component that decides who must approve what, and what may never be executed. It is
 * a deterministic rule table. An LLM is not permitted anywhere in this path (REQ-031, AR-1), and a
 * test asserts this module imports nothing from `src/agents/`.
 *
 * The rule set is VERSIONED (REQ-041). Changing any threshold or role mapping requires bumping
 * POLICY_VERSION, because every stored evaluation and approval cites the version it was made under
 * — an approval given under one rule set must not silently appear to have been given under another.
 */

export const POLICY_VERSION = '1.0.0';

export const ROLES = Object.freeze([
  'SUPPLY_CHAIN_MANAGER', 'PROCUREMENT_MANAGER', 'COMPLIANCE_OFFICER',
  'QUALITY_ASSURANCE', 'FINANCE_APPROVER', 'READ_ONLY',
]);

export const AUTONOMY_CLASSES = Object.freeze([
  'AUTONOMOUS', 'RECOMMENDED', 'APPROVAL_REQUIRED', 'BLOCKED',
]);

/**
 * Thresholds are ASSUMED organisational values (Master Prompt §30 — declared, not invented as
 * fact). They are configurable and surfaced in the UI so an operator can see what drove the class.
 * Money is in minor units (ADR-0005).
 */
export const THRESHOLDS = Object.freeze({
  autonomousMaxCostMinor: 500_000,        // 5,000 currency units
  financeApprovalCostMinor: 5_000_000,    // 50,000 -> exception path, P-5
  autonomousMaxRisk: 25,                  // risk score 0-100
  lowConfidence: 0.7,                     // matches CONFIDENCE_THRESHOLD (AI layer)
  criticalCoverDays: 3,
});

/**
 * The rule table. Each rule is a pure predicate over the evaluation context; every rule that fires
 * is recorded, so an approver sees *why* their signature is required rather than just *that* it is.
 *
 * Order matters only for reporting; the verdict is derived from the union of fired rules.
 */
export const RULES = Object.freeze([
  {
    id: 'R-BLOCK-INFEASIBLE',
    when: (c) => c.scenario === null,
    effect: { autonomy: 'BLOCKED' },
    reason: 'No feasible option exists. There is nothing that can be approved.',
  },
  {
    id: 'R-BLOCK-POLICY',
    when: (c) => c.scenario?.feasibility === 'BLOCKED',
    effect: { autonomy: 'BLOCKED' },
    reason: 'The selected option is BLOCKED by a hard constraint and cannot be approved by any role.',
  },
  {
    id: 'R-BLOCK-INFEASIBLE-SELECTED',
    when: (c) => c.scenario?.feasibility === 'INFEASIBLE',
    effect: { autonomy: 'BLOCKED' },
    reason: 'The selected option is INFEASIBLE and is not executable at any cost.',
  },
  {
    id: 'R-COLD-CHAIN',
    when: (c) => (c.scenario?.riskComponents?.excursion ?? 0) > 0,
    effect: { roles: ['QUALITY_ASSURANCE'] },
    reason: 'The route carries a cold-chain excursion; Quality Assurance must co-approve.',
  },
  {
    id: 'R-SUPPLIER-SWITCH',
    when: (c) => c.scenario?.strategyType === 'ALT_SUPPLIER',
    effect: { roles: ['PROCUREMENT_MANAGER', 'COMPLIANCE_OFFICER'] },
    reason: 'Switching supplier requires Procurement and Compliance co-approval (P-1 cannot do this alone).',
  },
  {
    id: 'R-HIGH-COST',
    when: (c) => Math.abs(c.scenario?.costDeltaMinor ?? 0) >= THRESHOLDS.financeApprovalCostMinor,
    effect: { roles: ['FINANCE_APPROVER'] },
    reason: `Cost impact reaches the finance exception threshold (${THRESHOLDS.financeApprovalCostMinor / 100}).`,
  },
  {
    id: 'R-MODERATE-COST',
    when: (c) => Math.abs(c.scenario?.costDeltaMinor ?? 0) > THRESHOLDS.autonomousMaxCostMinor,
    effect: { requiresApproval: true },
    reason: `Cost impact exceeds the autonomous ceiling (${THRESHOLDS.autonomousMaxCostMinor / 100}).`,
  },
  {
    id: 'R-HIGH-RISK',
    when: (c) => (c.scenario?.riskScore ?? 0) > THRESHOLDS.autonomousMaxRisk,
    effect: { requiresApproval: true },
    reason: `Risk score exceeds the autonomous ceiling (${THRESHOLDS.autonomousMaxRisk}).`,
  },
  {
    id: 'R-CRITICAL-COVER',
    when: (c) => c.criticalSites > 0,
    effect: { requiresApproval: true, roles: ['SUPPLY_CHAIN_MANAGER'] },
    reason: 'A site is at or below the critical days-of-cover threshold.',
  },
  {
    id: 'R-LOW-AGENT-CONFIDENCE',
    when: (c) => c.agentConfidence !== null && c.agentConfidence < THRESHOLDS.lowConfidence,
    effect: { requiresApproval: true },
    reason: 'The sensing agent reported low confidence; a human must confirm the interpretation.',
  },
  {
    id: 'R-IRREVERSIBLE',
    when: (c) => c.scenario?.strategyType === 'INVENTORY_REBALANCE',
    effect: { requiresApproval: true, roles: ['SUPPLY_CHAIN_MANAGER'] },
    reason: 'Moving physical stock is not cheaply reversible; it requires explicit human sign-off.',
  },
]);

/**
 * Evaluates policy for a proposed action.
 *
 * @returns {{autonomyClass, requiredRoles, firedRules, reason, policyVersion, thresholds}}
 */
export function evaluatePolicy({
  scenario, impact, agentConfidence = null,
}) {
  const context = {
    scenario: scenario ?? null,
    criticalSites: (impact?.daysOfCover ?? []).filter((c) => c.status === 'CRITICAL').length,
    agentConfidence,
  };

  const fired = RULES.filter((r) => r.when(context));

  const blocked = fired.filter((r) => r.effect.autonomy === 'BLOCKED');
  if (blocked.length > 0) {
    return {
      autonomyClass: 'BLOCKED',
      requiredRoles: [],
      firedRules: fired.map(summarise),
      reason: blocked[0].reason,
      policyVersion: POLICY_VERSION,
      thresholds: THRESHOLDS,
    };
  }

  // Roles accumulate as a SET: two rules demanding the same role do not create two approvals.
  const roles = new Set();
  let requiresApproval = false;

  for (const r of fired) {
    for (const role of r.effect.roles ?? []) roles.add(role);
    if (r.effect.requiresApproval || (r.effect.roles ?? []).length > 0) requiresApproval = true;
  }

  if (!requiresApproval) {
    return {
      autonomyClass: 'AUTONOMOUS',
      requiredRoles: [],
      firedRules: fired.map(summarise),
      reason: 'Within all autonomous thresholds; no human approval required.',
      policyVersion: POLICY_VERSION,
      thresholds: THRESHOLDS,
    };
  }

  // Anything needing a human always needs the control-tower manager as the accountable owner.
  roles.add('SUPPLY_CHAIN_MANAGER');

  return {
    autonomyClass: 'APPROVAL_REQUIRED',
    requiredRoles: [...roles].sort(),
    firedRules: fired.map(summarise),
    reason: fired.filter((r) => r.effect.requiresApproval || r.effect.roles)
      .map((r) => r.reason).join(' '),
    policyVersion: POLICY_VERSION,
    thresholds: THRESHOLDS,
  };
}

const summarise = (r) => ({ id: r.id, reason: r.reason, effect: r.effect });

/** Persists an evaluation (REQ-041). Returns the row id. */
export function persistPolicyEvaluation(db, { decisionId, verdict, now = new Date().toISOString() }) {
  const id = `POL-${decisionId}`;
  db.prepare(
    `INSERT OR REPLACE INTO policy_evaluation
       (id, decision_id, evaluated_at, autonomy_class, required_roles_json, fired_rules_json,
        policy_version, reason)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(
    id, decisionId, now, verdict.autonomyClass,
    JSON.stringify(verdict.requiredRoles), JSON.stringify(verdict.firedRules),
    verdict.policyVersion, verdict.reason,
  );
  return id;
}
