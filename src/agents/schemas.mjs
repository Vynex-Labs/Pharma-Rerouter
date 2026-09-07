/**
 * Agent output schemas + validation.
 *
 * Authority: ADR-0002 §1 (field-level authority), §3 (referential validation), §4 (mandatory
 * uncertainty). Requirements: REQ-002, REQ-003, REQ-027, REQ-062, REQ-063, REQ-064 (AI-1).
 *
 * THE CENTRAL RULE (AR-1): there is NO numeric supply-chain field in ANY schema below.
 * An agent cannot fabricate a cost, an ETA, a risk score, a quantity or a days-of-cover figure
 * because there is no property for it to put one in. This is enforcement by absence, which is
 * stronger than instruction — a prompt is a request, a schema is a boundary.
 *
 * Zod is not used here deliberately: hand-written validators keep the "what may an agent say?"
 * question readable to a non-TypeScript reviewer (auditor, domain expert, judge).
 */

export class ValidationError extends Error {
  constructor(kind, message, detail = {}) {
    super(message);
    this.kind = kind; // SCHEMA_INVALID | REFERENTIAL_INVALID
    this.detail = detail;
  }
}

const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const EVENT_TYPES = [
  'PORT_CLOSURE', 'LANE_SUSPENSION', 'SUPPLIER_FAILURE', 'WEATHER',
  'CAPACITY_LOSS', 'LABOUR_ACTION', 'UNKNOWN',
];

/** AI-1 / REQ-064 — every agent output must declare confidence AND uncertainty. */
function requireUncertainty(out) {
  if (typeof out.confidence !== 'number' || out.confidence < 0 || out.confidence > 1) {
    throw new ValidationError('SCHEMA_INVALID', 'confidence must be a number in [0,1]', {
      received: out.confidence,
    });
  }
  if (typeof out.uncertainty !== 'string' || out.uncertainty.trim() === '') {
    throw new ValidationError(
      'SCHEMA_INVALID',
      'uncertainty is mandatory (condition AI-1); hiding uncertainty violates Master Prompt §11',
      { received: out.uncertainty },
    );
  }
}

/**
 * Seam S1 — Disruption classification.
 * MAY produce: event type, severity band, confidence, geography, duration.
 * MAY NOT produce: affected entities or any quantity (REQ-003) — no such fields exist.
 */
export function validateDisruptionClassification(out) {
  if (!out || typeof out !== 'object') {
    throw new ValidationError('SCHEMA_INVALID', 'output is not an object');
  }
  requireUncertainty(out);

  if (!EVENT_TYPES.includes(out.eventType)) {
    throw new ValidationError('SCHEMA_INVALID', `eventType must be one of ${EVENT_TYPES.join('|')}`, {
      received: out.eventType,
    });
  }
  if (!SEVERITIES.includes(out.severity)) {
    throw new ValidationError('SCHEMA_INVALID', `severity must be one of ${SEVERITIES.join('|')}`, {
      received: out.severity,
    });
  }
  if (typeof out.geography !== 'string' || !out.geography) {
    throw new ValidationError('SCHEMA_INVALID', 'geography must be a non-empty string');
  }
  if (out.expectedDurationHours !== null && out.expectedDurationHours !== undefined) {
    if (!Number.isInteger(out.expectedDurationHours) || out.expectedDurationHours < 0) {
      throw new ValidationError('SCHEMA_INVALID', 'expectedDurationHours must be a non-negative integer or null');
    }
  }

  // Reject any attempt to smuggle authoritative supply-chain values into the classification.
  const forbidden = [
    'affectedShipments', 'affectedOrders', 'affectedFacilities', 'daysOfCover',
    'cost', 'costDelta', 'etaHours', 'riskScore', 'quantity', 'units', 'unitsAtRisk',
  ].filter((k) => k in out);
  if (forbidden.length) {
    throw new ValidationError(
      'SCHEMA_INVALID',
      `AR-1 violation: agent attempted to supply authoritative field(s) ${forbidden.join(', ')}`,
      { forbidden },
    );
  }

  return {
    eventType: out.eventType,
    severity: out.severity,
    confidence: out.confidence,
    geography: out.geography,
    expectedDurationHours: out.expectedDurationHours ?? null,
    uncertainty: out.uncertainty,
    reasoning: typeof out.reasoning === 'string' ? out.reasoning : null,
  };
}

/**
 * Seam S3 — Strategy intents (condition CA-2).
 * MAY produce: which strategies to pursue and why.
 * MAY NOT produce: cost, ETA, risk, feasibility (REQ-027) — no such fields exist.
 */
export function validateStrategyIntents(out, { knownStrategies }) {
  if (!out || typeof out !== 'object') {
    throw new ValidationError('SCHEMA_INVALID', 'output is not an object');
  }
  requireUncertainty(out);

  if (!Array.isArray(out.intents) || out.intents.length === 0) {
    throw new ValidationError('SCHEMA_INVALID', 'intents must be a non-empty array');
  }

  const accepted = [];
  const rejected = [];

  for (const intent of out.intents) {
    if (!intent || typeof intent.strategy !== 'string') {
      rejected.push({ strategy: String(intent?.strategy), reason: 'MALFORMED_INTENT' });
      continue;
    }
    // REQ-063 referential validation: an agent cannot invent a strategy the engine lacks.
    if (!knownStrategies.includes(intent.strategy)) {
      rejected.push({ strategy: intent.strategy, reason: 'UNKNOWN_STRATEGY' });
      continue;
    }
    const numericLeak = ['cost', 'costDeltaMinor', 'etaHours', 'riskScore', 'feasibility']
      .filter((k) => k in intent);
    if (numericLeak.length) {
      rejected.push({ strategy: intent.strategy, reason: 'AR1_AUTHORITATIVE_FIELD', fields: numericLeak });
      continue;
    }
    accepted.push({
      strategy: intent.strategy,
      rationale: typeof intent.rationale === 'string' ? intent.rationale : null,
    });
  }

  if (accepted.length === 0) {
    throw new ValidationError('REFERENTIAL_INVALID', 'no valid strategy intents remained after validation', {
      rejected,
    });
  }

  return { intents: accepted, rejected, confidence: out.confidence, uncertainty: out.uncertainty };
}

/** Seams S2/S5/S6 — prose only. Text may be null, which forces the deterministic template. */
export function validateNarrative(out) {
  if (!out || typeof out !== 'object') {
    throw new ValidationError('SCHEMA_INVALID', 'output is not an object');
  }
  requireUncertainty(out);
  if (out.text !== null && typeof out.text !== 'string') {
    throw new ValidationError('SCHEMA_INVALID', 'text must be a string or null');
  }
  return { text: out.text ?? null, confidence: out.confidence, uncertainty: out.uncertainty };
}

/**
 * REQ-063 — resolve every entity ID an agent mentions against the database.
 * An unknown ID invalidates the whole output; we do not "clean" it and proceed, because a model
 * that referenced a non-existent facility was not reasoning about our network.
 */
export function assertEntitiesExist(ids, knownIds, kind) {
  const unknown = ids.filter((id) => !knownIds.has(id));
  if (unknown.length) {
    throw new ValidationError('REFERENTIAL_INVALID', `unknown ${kind}: ${unknown.join(', ')}`, {
      unknown, kind,
    });
  }
}
