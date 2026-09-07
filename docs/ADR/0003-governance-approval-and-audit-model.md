# ADR-0003 — Governance, Approval Routing and Audit Integrity

- **Status:** ACCEPTED
- **Date:** 2026-09-07
- **Version:** 1.0
- **Deciders:** Safety/Governance Engineer (primary); Security Engineer, Compliance-role reviewer, System Architect
- **Related:** ADR-0001, ADR-0002

## Context
Master Prompt §9–§10 requires four autonomy classes, policy-derived approver routing, a rich approval
evidence contract, and integrity rules that prevent bypass, self-approval, post-execution approval,
stale-approval reuse and evidence tampering. §14 requires protected audit records. A boolean
`approved = true` is explicitly prohibited.

## Alternatives Considered
1. **Boolean approval flag on the decision row.** Rejected — prohibited by §10.3 and unauditable.
2. **Workflow-engine-managed approvals with an external BPM tool.** Rejected for MVP — heavyweight,
   adds a dependency we cannot verify within the timeline, and obscures the evidence we want to show.
3. **First-class Decision / Approval / AuditEvent entities with a declarative policy engine and a
   hash-chained ledger.** Selected.

## Decision

### 1. Autonomy classes
`AUTONOMOUS` (low-risk, reversible, pre-authorised) · `RECOMMENDED` · `APPROVAL_REQUIRED`
(single or multi) · `BLOCKED`. Assigned by the Policy Engine, never by an agent.

### 2. Declarative, versioned policy
Rules evaluate: action type, financial impact, inventory impact, product criticality, computed risk,
reversibility, compliance sensitivity, and agent confidence. Output: autonomy class + ordered set of
required approver roles + the rule IDs that fired. `policy_version` is stamped on every evaluation.

Illustrative routing (**CONFIGURABLE RULE — organisational policy examples, not real-world regulation**):

| Action | Class | Required approvers |
|---|---|---|
| Minor route adjustment, cost below threshold, reversible | AUTONOMOUS | none (logged) |
| Expedited reroute above cost threshold | APPROVAL | Logistics Manager |
| Inter-warehouse inventory transfer | APPROVAL | Inventory Manager |
| Critical-product supplier switch | MULTI | Procurement Manager **and** Compliance Officer |
| Any action above the financial ceiling | MULTI | + Finance/Executive Approver |
| Cold-chain feasibility breached | **BLOCKED** | not approvable by anyone |
| Supplier unqualified for destination market | **BLOCKED** | not approvable by anyone |
| Agent confidence below threshold | downgrade to RECOMMENDED | — |

`BLOCKED` is terminal for that scenario: no role can approve it. This is the difference between a
governance system and a permissions system.

### 3. Approval evidence contract
Every approval persists the full §10.3 record: approval ID, decision ID, request ID, requested action,
reason, risk classification, policy evaluation (incl. fired rule IDs), required approver role, actual
approver identity, timestamp, decision, comments, input data snapshot reference, selected scenario,
alternatives considered, policy version, system version, agent recommendation, agent confidence and
uncertainty, execution authorization reference, execution result. Multi-approval retains each
approval individually plus the final authorization.

### 4. Integrity mechanisms (each maps to a §10.4 prohibition)

| Prohibition | Mechanism |
|---|---|
| Approval bypass | Execution endpoint requires a valid `ExecutionAuthorization`; there is no other path to state mutation |
| Self-approval where prohibited | Approver identity compared against requester/initiator; the same identity cannot satisfy two required roles in a multi-approval |
| Unauthorised approval | Approver's held roles must include the required role, checked server-side |
| Approval after execution | Decision state machine: approvals accepted only in `PENDING_APPROVAL` |
| Evidence modification | Approval rows are append-only; corrections are new superseding records referencing the original |
| Audit deletion | Ledger exposes only append; no delete/update code path exists |
| Executing a rejected decision | `REJECTED` is terminal; no authorization can be minted |
| Stale approval | The authorization embeds a canonical hash of the decision payload; if any input changes the hash mismatches, the authorization is void and the decision returns to `PENDING_APPROVAL` |

### 5. Audit ledger
Append-only `audit_events`, hash-chained `h_n = SHA-256(h_{n-1} ‖ canonical(event))`, using
**canonical serialisation** (sorted keys, fixed number formatting, UTC timestamps) per condition DA-1
so that verification cannot produce false failures from key ordering. Each event records the §14
fields. A verification routine walks the chain and is exercised by a tampering test (AR-R2).

**Honesty note:** this is *tamper-evident within a single database*, not a distributed ledger and not
cryptographically notarised externally. We say "tamper-evident, hash-chained", never "immutable
blockchain". Overstating this would violate §30.

## Consequences
- High-risk actions cannot be executed without complete, role-correct, fresh approval evidence.
- The audit export is a genuine artefact we can hand a judge, not a screenshot.
- Cost: more entities and more state; concurrency requires versioned, idempotent commands (F-8).
- Cost: the demo must spend real seconds on approval. Accepted — it is the differentiator.

## Risks
- Policy rules could drift from documentation → `policy_version` plus a test asserting the documented
  routing table matches engine behaviour.
- Approver identity in MVP is a simulated role login, not enterprise SSO → stated explicitly as a
  limitation in `docs/security.md` and in the deck.
