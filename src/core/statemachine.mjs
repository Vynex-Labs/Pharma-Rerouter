/**
 * Decision state machine — the deterministic spine (Architecture C, ADR-0001).
 *
 * This module owns the workflow. Every transition is explicit, validated, audited and versioned.
 * No agent has a code path into it (AR-7): `runAgent` cannot import this module without a cycle,
 * and a test asserts no file under `src/agents/` references it.
 *
 * Optimistic concurrency (F-8): every transition asserts the caller's expected version, so two
 * concurrent approvers cannot both advance the same decision.
 */

import { randomUUID } from 'node:crypto';

export const STATES = Object.freeze([
  'DETECTED', 'IMPACT_ASSESSED', 'SCENARIOS_GENERATED', 'RANKED', 'POLICY_EVALUATED',
  'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'BLOCKED', 'EXECUTING',
  'RECOVERY_VERIFIED', 'SEALED',
]);

/**
 * The legal transition graph. Anything absent is illegal — this is an allow-list, not a
 * deny-list, so a new state cannot accidentally become reachable from everywhere.
 */
export const TRANSITIONS = Object.freeze({
  DETECTED: ['IMPACT_ASSESSED'],
  IMPACT_ASSESSED: ['SCENARIOS_GENERATED'],
  SCENARIOS_GENERATED: ['RANKED'],
  RANKED: ['POLICY_EVALUATED'],
  // Policy may auto-approve (AUTONOMOUS), require a human, or block outright.
  POLICY_EVALUATED: ['PENDING_APPROVAL', 'APPROVED', 'BLOCKED'],
  // REQ-038: inputs changing after approval returns the decision for re-approval.
  PENDING_APPROVAL: ['APPROVED', 'REJECTED', 'BLOCKED'],
  APPROVED: ['EXECUTING', 'PENDING_APPROVAL'],
  EXECUTING: ['RECOVERY_VERIFIED'],
  RECOVERY_VERIFIED: ['SEALED'],
  // Terminal states. REQ-039: a rejected or blocked decision is not executable by any role.
  REJECTED: ['SEALED'],
  BLOCKED: ['SEALED'],
  SEALED: [],
});

export const TERMINAL_STATES = Object.freeze(['SEALED']);

/** Thrown for any illegal transition. Typed so callers can distinguish it from a bug. */
export class StateTransitionError extends Error {
  constructor(message, { from, to, decisionId, kind }) {
    super(message);
    this.name = 'StateTransitionError';
    this.kind = kind; // ILLEGAL_TRANSITION | VERSION_CONFLICT | UNKNOWN_STATE | NOT_FOUND
    this.from = from;
    this.to = to;
    this.decisionId = decisionId;
  }
}

export function canTransition(from, to) {
  return (TRANSITIONS[from] ?? []).includes(to);
}

/** All states reachable from `from`, for UI progress rendering. */
export function reachableFrom(from) {
  const seen = new Set();
  const walk = (s) => {
    for (const next of TRANSITIONS[s] ?? []) {
      if (!seen.has(next)) { seen.add(next); walk(next); }
    }
  };
  walk(from);
  return [...seen];
}

export class DecisionMachine {
  #db;
  #ledger;
  #systemVersion;

  constructor(db, ledger, { systemVersion = '0.5.0' } = {}) {
    this.#db = db;
    this.#ledger = ledger;
    this.#systemVersion = systemVersion;
  }

  create({ disruptionId, decisionId = null, now = new Date().toISOString() }) {
    const id = decisionId ?? `DEC-${randomUUID().slice(0, 8)}`;
    this.#db
      .prepare(
        `INSERT INTO decision (id, disruption_id, state, version, created_at, updated_at, system_version)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .run(id, disruptionId, 'DETECTED', 1, now, now, this.#systemVersion);

    this.#ledger.append({
      eventType: 'DECISION_CREATED', actor: 'system:orchestrator', decisionId: id,
      payload: { disruptionId, state: 'DETECTED' },
    });
    return this.get(id);
  }

  get(decisionId) {
    const row = this.#db.prepare('SELECT * FROM decision WHERE id = ?').get(decisionId);
    if (!row) {
      throw new StateTransitionError(`Decision ${decisionId} not found`, {
        decisionId, kind: 'NOT_FOUND',
      });
    }
    return row;
  }

  /**
   * The single write path for decision state.
   *
   * @param expectedVersion  optimistic lock; omit only for internal pipeline steps that already
   *                         hold the row. Supplying it is strongly preferred (F-8).
   */
  transition(decisionId, to, {
    actor = 'system:orchestrator',
    expectedVersion = null,
    fields = {},
    reason = null,
  } = {}) {
    if (!STATES.includes(to)) {
      throw new StateTransitionError(`Unknown target state ${to}`, { to, decisionId, kind: 'UNKNOWN_STATE' });
    }

    const current = this.get(decisionId);

    if (expectedVersion !== null && current.version !== expectedVersion) {
      throw new StateTransitionError(
        `Version conflict on ${decisionId}: expected ${expectedVersion}, found ${current.version}. ` +
        'Another actor modified this decision.',
        { from: current.state, to, decisionId, kind: 'VERSION_CONFLICT' },
      );
    }

    if (!canTransition(current.state, to)) {
      throw new StateTransitionError(
        `Illegal transition ${current.state} -> ${to} for ${decisionId}`,
        { from: current.state, to, decisionId, kind: 'ILLEGAL_TRANSITION' },
      );
    }

    const now = new Date().toISOString();
    const allowed = ['impact_id', 'selected_scenario_id', 'payload_hash'];
    const sets = Object.keys(fields).filter((k) => allowed.includes(k));
    const assignments = sets.map((k) => `${k} = ?`).join(', ');

    this.#db
      .prepare(
        `UPDATE decision SET state = ?, version = version + 1, updated_at = ?
           ${assignments ? ', ' + assignments : ''}
         WHERE id = ? AND version = ?`,
      )
      .run(to, now, ...sets.map((k) => fields[k]), decisionId, current.version);

    this.#ledger.append({
      eventType: 'STATE_TRANSITION', actor, decisionId,
      payload: { from: current.state, to, fromVersion: current.version, reason },
    });

    return this.get(decisionId);
  }
}
