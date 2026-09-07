/**
 * The six agent seams (ADR-0001). Each is a thin, bounded wrapper around the runtime.
 *
 * Requirements: REQ-002/003/004/005 (S1), REQ-015 (S2), REQ-026/027 (S3), REQ-060, REQ-066.
 *
 * Note what is absent: there is no seam S4. Policy evaluation has NO agent (ADR-0001) — the thing
 * deciding whether a human must approve is not probabilistic. That absence is the single most
 * load-bearing design decision in this system.
 */

import {
  validateDisruptionClassification,
  validateStrategyIntents,
  validateNarrative,
} from './schemas.mjs';
import { runAgent, buildToolRegistry, wrapUntrusted } from './runtime.mjs';
import { ALL_STRATEGIES } from '../core/scenarios.mjs';

/** Confidence below this cannot yield an autonomous action (REQ-004). CONFIGURABLE RULE. */
export const CONFIDENCE_THRESHOLD = 0.7;

/** S1 — Disruption Sensing. Reads unstructured advisory text; produces a classification only. */
export async function senseDisruption({ provider, disruption, snapshot, db = null, decisionId = null }) {
  const registry = buildToolRegistry({ snapshot, impact: null });

  return runAgent({
    agentName: 'DisruptionSensing',
    seam: 'S1',
    provider, db, decisionId, registry,
    schemaName: 'DisruptionClassification',
    context: {
      advisoryText: disruption.raw_advisory_text,
      untrusted: wrapUntrusted(disruption.raw_advisory_text),
      reportedLaneId: disruption.reported_lane_id,
    },
    validate: validateDisruptionClassification,
    // REQ-005: without the model we still classify from the structured fields alone.
    fallback: () => ({
      eventType: 'LANE_SUSPENSION',
      severity: 'HIGH',
      confidence: 0.5,
      geography: 'Unknown',
      expectedDurationHours: null,
      uncertainty:
        'Classification derived from structured fields only; the advisory text was not interpreted.',
      reasoning: null,
      source: 'DETERMINISTIC_FALLBACK',
    }),
  });
}

/** S2 — Impact Narration. Prose only; may never restate a figure as authoritative (REQ-015). */
export async function narrateImpact({ provider, impact, snapshot, db = null, decisionId = null }) {
  const registry = buildToolRegistry({ snapshot, impact });

  const critical = impact.criticalSites[0];
  const template =
    `${impact.affected.shipments.length} shipment(s) held on lane ${impact.closedLaneId}. ` +
    `${impact.ordersAtRisk.length} order(s) at risk. ` +
    (critical
      ? `Tightest cover: ${critical.facilityId} / ${critical.productId} at ${critical.daysOfCover} days ` +
        `(stockout ${critical.stockoutDate}).`
      : 'No site is currently below threshold.');

  return runAgent({
    agentName: 'ImpactNarration',
    seam: 'S2',
    provider, db, decisionId, registry,
    schemaName: 'Narrative',
    context: { affected: impact.affected, baseline: impact.baseline, criticalSites: impact.criticalSites },
    validate: validateNarrative,
    isEmpty: (o) => !o.text || o.text.trim() === '',
    fallback: () => ({
      text: template,
      confidence: 1,
      uncertainty: 'Template-generated from engine output; no model interpretation applied.',
    }),
  });
}

/**
 * S3 — Scenario Reasoning (condition CA-2).
 * Produces TYPED STRATEGY INTENTS that select which strategies the engine generates. It does not
 * comment on a fixed list, and it cannot produce a cost, ETA, risk or feasibility value.
 */
export async function proposeStrategies({ provider, impact, snapshot, db = null, decisionId = null }) {
  const registry = buildToolRegistry({ snapshot, impact });

  return runAgent({
    agentName: 'ScenarioReasoning',
    seam: 'S3',
    provider, db, decisionId, registry,
    schemaName: 'StrategyIntents',
    context: {
      knownStrategies: ALL_STRATEGIES,
      criticalSites: impact.criticalSites,
      ordersAtRisk: impact.ordersAtRisk.length,
      closedLaneId: impact.closedLaneId,
    },
    validate: (out) => validateStrategyIntents(out, { knownStrategies: ALL_STRATEGIES }),
    // Without the model the engine simply evaluates every strategy — a wider, slower, safe default.
    fallback: () => ({
      intents: ALL_STRATEGIES.filter((s) => s !== 'DO_NOTHING').map((s) => ({ strategy: s, rationale: null })),
      rejected: [],
      confidence: 1,
      uncertainty: 'All strategies evaluated exhaustively; no model prioritisation applied.',
    }),
  });
}

/** S5 — Explanation. Builds the approver's evidence prose. Never produces the policy verdict. */
export async function explainDecision({ provider, decisionContext, snapshot, impact, db = null, decisionId = null }) {
  const registry = buildToolRegistry({ snapshot, impact });
  const { selected, alternatives, policy } = decisionContext;

  const template =
    `Recommended: ${selected.strategyType}. ` +
    `Protects ${selected.ordersProtected} at-risk order(s), ETA ${selected.etaHours} h, ` +
    `risk ${selected.riskScore}/100, cost delta ${(selected.costDeltaMinor / 100).toFixed(2)}. ` +
    `${alternatives.length} alternative(s) considered. ` +
    `Policy: ${policy.autonomyClass}${policy.requiredRoles?.length ? `, requires ${policy.requiredRoles.join(' + ')}` : ''}.`;

  return runAgent({
    agentName: 'Explanation',
    seam: 'S5',
    provider, db, decisionId, registry,
    schemaName: 'Narrative',
    context: { selected, alternatives, policy },
    validate: validateNarrative,
    isEmpty: (o) => !o.text || o.text.trim() === '',
    fallback: () => ({
      text: template,
      confidence: 1,
      uncertainty: 'Template-generated from engine and policy output.',
    }),
  });
}

/** S6 — Compliance. Audit narrative and source attribution. Never touches the hash chain. */
export async function narrateCompliance({ provider, record, snapshot, impact, db = null, decisionId = null }) {
  const registry = buildToolRegistry({ snapshot, impact });

  const template =
    `Decision ${record.decisionId} executed under policy ${record.policyVersion}. ` +
    `Approvers: ${record.approvers?.join(', ') || 'none (autonomous)'}. ` +
    `Data sources: ${record.dataSources?.join(', ') || 'SIMULATED'}.`;

  return runAgent({
    agentName: 'Compliance',
    seam: 'S6',
    provider, db, decisionId, registry,
    schemaName: 'Narrative',
    context: { record },
    validate: validateNarrative,
    isEmpty: (o) => !o.text || o.text.trim() === '',
    fallback: () => ({
      text: template,
      confidence: 1,
      uncertainty: 'Template-generated from persisted governance records.',
    }),
  });
}

/**
 * Orchestrator — ADVISORY ONLY (REQ-066).
 * It returns suggestions and anomaly flags. It has no state-transition capability, and the spine
 * ignores it entirely when deciding what to do next. It exists to surface observations to a human,
 * not to drive the workflow.
 */
export function orchestratorAdvice({ impact, ranked, excluded }) {
  const flags = [];

  if (excluded.some((s) => s.feasibility === 'BLOCKED')) {
    flags.push({
      kind: 'BLOCKED_OPTION_PRESENT',
      note: 'At least one option is prohibited by policy and cannot be approved by any role.',
    });
  }
  if (ranked.length >= 2 && Math.abs(ranked[0].score - ranked[1].score) <= 5) {
    flags.push({
      kind: 'CLOSE_CALL',
      note: `Top two options differ by ${Math.abs(ranked[0].score - ranked[1].score)} points; ` +
            'human judgement is likely to be decisive.',
    });
  }
  if (impact.criticalSites.some((c) => c.status === 'CRITICAL')) {
    flags.push({ kind: 'CRITICAL_COVER', note: 'At least one site is below the critical cover threshold.' });
  }

  return {
    advisory: true,
    canTransitionState: false, // stated explicitly so no caller mistakes this for authority
    suggestedNext: ranked.length ? `Review ${ranked[0].strategyType} against policy.` : 'No feasible option; escalate.',
    flags,
  };
}
