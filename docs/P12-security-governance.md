# P12 — Security & Governance

**Phase owner:** Security Engineer · **Reviewers:** Safety/Governance, System Architect
**Status:** COMPLETE · **Closes:** REQ-030…041, AR-R3

---

## 1. Objective

Replace the interim policy stub with a real deterministic authority model, and make approval
something that must be *earned with evidence* rather than asserted with a boolean.

## 2. Policy engine — `src/core/policy.mjs`

Seam **S4, which has no agent by design**. The module has **zero imports** — a test asserts this,
so no future edit can wire a model into the decision that decides whether a human is required.

`POLICY_VERSION = '1.0.0'`. Four autonomy classes: `AUTONOMOUS`, `RECOMMENDED`,
`APPROVAL_REQUIRED`, `BLOCKED`.

**Thresholds** (declared as data, not buried in branches — this is the answer to risk AR-R3):

| Threshold | Value |
|---|---|
| `autonomousMaxCostMinor` | 500,000 |
| `financeApprovalCostMinor` | 5,000,000 |
| `autonomousMaxRisk` | 25 |
| `lowConfidence` | 0.7 |
| `criticalCoverDays` | 3 |

**11 rules**, each with a stable id, a human-readable reason and the roles it demands:
`R-BLOCK-INFEASIBLE`, `R-BLOCK-POLICY`, `R-BLOCK-INFEASIBLE-SELECTED`, `R-COLD-CHAIN`,
`R-SUPPLIER-SWITCH`, `R-HIGH-COST`, `R-MODERATE-COST`, `R-HIGH-RISK`, `R-CRITICAL-COVER`,
`R-LOW-AGENT-CONFIDENCE`, `R-IRREVERSIBLE`.

Any approval requirement always adds `SUPPLY_CHAIN_MANAGER` as accountable owner. A `BLOCKED`
verdict carries `requiredRoles: []` — a blocked action is not "approvable by the right person".

### Flagship verdict (reproducible)

`APPROVAL_REQUIRED`, roles **FINANCE_APPROVER + QUALITY_ASSURANCE + SUPPLY_CHAIN_MANAGER**,
fired rules `R-COLD-CHAIN`, `R-HIGH-COST`, `R-MODERATE-COST`, `R-HIGH-RISK`.

Three roles is not a configuration accident — it is three independent rules firing on a
cold-chain air reroute costing 232,000 minor units against a site at critical cover.

## 3. Identity & authority

`identity`, `identity_role` (CHECK-constrained to six roles) and `approval_invalidation` added to
the schema. Five identities seeded from the P1 personas:

| Identity | Persona | Roles |
|---|---|---|
| `user:ravi` | P-1 Control-Tower Manager | `SUPPLY_CHAIN_MANAGER` |
| `user:meera` | P-2 Procurement | `PROCUREMENT_MANAGER` |
| `user:daniel` | P-3 Compliance/QA | `COMPLIANCE_OFFICER`, `QUALITY_ASSURANCE` |
| `user:priya` | P-4 Hospital Pharmacy | `READ_ONLY` |
| `user:sofia` | P-5 Finance | `FINANCE_APPROVER`, `SUPPLY_CHAIN_MANAGER` |

Two deliberate design choices: **Ravi lacks QA**, so a cold-chain reroute cannot be self-certified
by the person running the control tower; **Sofia holds two roles**, which exercises REQ-036
(one identity may not satisfy two required roles on the same decision).

> **Scope declaration:** P12 models **authorization, not authentication**. Identities are seeded
> rows; there is no SSO, password or session. Claiming otherwise would be a fake implementation.
> Recorded in `docs/security.md`.

## 4. Approval integrity — `src/core/approval.mjs`

**REQ-034 — evidence contract.** An approval must carry all eleven fields, or it is rejected:
`requestedAction`, `reason`, `riskClassification`, `policyEvaluationId`, `requiredRole`,
`approverIdentity`, `snapshotId`, `alternatives`, `policyVersion`, `systemVersion`,
`decisionPayloadHash`. **A bare `approved=true` is not an approval.**

| Requirement | Enforcement | `ApprovalError.kind` |
|---|---|---|
| REQ-034 | All evidence fields present | `INCOMPLETE_EVIDENCE` |
| REQ-035 | Approver holds the role being signed | `ROLE_NOT_HELD` |
| REQ-036 | One identity cannot fill two required roles | `SELF_APPROVAL` |
| REQ-037 | Approval only in `PENDING_APPROVAL` | `WRONG_STATE` |
| REQ-038 | Inputs changed → approvals invalidated | — |
| REQ-040 | Append-only; corrections supersede | `NOT_OWNER` |

**REQ-038** is the one that matters most: if the decision payload hash changes after an approval is
captured, the approval is invalidated into `approval_invalidation` (recording old and new hash) and
the pipeline returns to `PENDING_APPROVAL` rather than executing on a stale approval. The pipeline
re-checks this immediately before minting an authorization — the narrowest possible window.

## 5. Evidence

`tests/governance.test.mjs` — **24 tests**, all passing. The load-bearing ones are adversarial:
an identity without the role cannot approve; one identity cannot satisfy two roles; approval
outside `PENDING_APPROVAL` is impossible; a rejection seals the decision and nothing executes;
approvals are append-only.

Two failures found while writing them, both fixed:

- The evidence-completeness check ran **after** the role check, so omitting `requiredRole`
  produced a misleading `ROLE_NOT_HELD` for a role that was never supplied. Structural validation
  now runs first.
- A test asserting "policy imports nothing from the agent layer" matched prose in the module's own
  doc comment. Rewritten to assert on actual `import` statements with comments stripped.

**Demonstrated end to end:** a two-approver run correctly **halts** at
`AWAITING_APPROVAL missing=FINANCE_APPROVER`. Adding the third approver reaches `SEALED` with 16
audit events and a valid hash chain. The halt is the evidence — the system refuses to execute a
decision that has not been fully authorised.
