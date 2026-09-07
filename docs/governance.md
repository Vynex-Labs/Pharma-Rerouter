# Governance

Version 0.6.0 · last updated at P12

How authority is decided, who may approve what, and what evidence an approval must carry.

---

## 1. Autonomy classes

| Class | Meaning |
|---|---|
| `AUTONOMOUS` | Small, low-risk, reversible. Executes without a human. |
| `RECOMMENDED` | System has a preference; a human confirms. |
| `APPROVAL_REQUIRED` | Named roles must approve with full evidence before execution. |
| `BLOCKED` | Cannot proceed at any authority level. `requiredRoles` is empty. |

A `BLOCKED` verdict is not "approvable by a sufficiently senior person". An infeasible or
non-compliant action is refused, not escalated.

## 2. Roles

`SUPPLY_CHAIN_MANAGER`, `PROCUREMENT_MANAGER`, `COMPLIANCE_OFFICER`, `QUALITY_ASSURANCE`,
`FINANCE_APPROVER`, `READ_ONLY` — CHECK-constrained in `identity_role`.

Every approval requirement adds `SUPPLY_CHAIN_MANAGER` as **accountable owner**, so no decision
executes without someone owning the outcome.

## 3. Rules → roles

| Rule | Fires when | Demands |
|---|---|---|
| `R-BLOCK-INFEASIBLE` / `-POLICY` / `-INFEASIBLE-SELECTED` | Option is infeasible or non-compliant | BLOCKED |
| `R-COLD-CHAIN` | Route risks a temperature excursion | `QUALITY_ASSURANCE` |
| `R-SUPPLIER-SWITCH` | Strategy changes supplier | `PROCUREMENT_MANAGER`, `QUALITY_ASSURANCE` |
| `R-HIGH-COST` | Cost ≥ 5,000,000 minor | `FINANCE_APPROVER` |
| `R-MODERATE-COST` | Cost ≥ 500,000 minor | `SUPPLY_CHAIN_MANAGER` |
| `R-HIGH-RISK` | Risk score > 25 | `SUPPLY_CHAIN_MANAGER` |
| `R-CRITICAL-COVER` | Any site under 3 days cover | `SUPPLY_CHAIN_MANAGER` |
| `R-LOW-AGENT-CONFIDENCE` | Agent confidence < 0.7 | `SUPPLY_CHAIN_MANAGER` |
| `R-IRREVERSIBLE` | Action cannot be undone | `SUPPLY_CHAIN_MANAGER` |

Thresholds live in a single `THRESHOLDS` object, not scattered through branches — the mitigation
for risk **AR-R3** ("policy becomes an if-ladder").

## 4. The evidence contract (REQ-034)

An approval is rejected unless it carries all eleven fields:

`requestedAction` · `reason` · `riskClassification` · `policyEvaluationId` · `requiredRole` ·
`approverIdentity` · `snapshotId` · `alternatives` · `policyVersion` · `systemVersion` ·
`decisionPayloadHash`

**A bare `approved=true` is not an approval.** The approver must record what they were asked to
approve, why they approved it, what the alternatives were, and against exactly which version of the
policy and which payload hash. This is what makes an approval auditable a year later.

## 5. Integrity rules

| Rule | Requirement |
|---|---|
| Role held | An identity may only approve in a role it actually holds (REQ-035) |
| Separation of duties | One identity cannot satisfy two required roles on one decision (REQ-036) |
| State gate | Approval is only possible in `PENDING_APPROVAL` (REQ-037) |
| Staleness | Inputs change → approvals invalidated → back to `PENDING_APPROVAL` (REQ-038) |
| Append-only | Approvals are never edited; a correction supersedes, by the original approver only (REQ-040) |
| Rejection | A rejection seals the decision; nothing executes (REQ-039) |

## 6. Worked example — the flagship

Cold-chain lane collapse, `AIR_REROUTE`, 232,000 minor units, risk 32, WH-CENTRAL at critical
cover. Four rules fire (`R-COLD-CHAIN`, `R-HIGH-COST`, `R-MODERATE-COST`, `R-HIGH-RISK`) demanding
**three roles**: `FINANCE_APPROVER` + `QUALITY_ASSURANCE` + `SUPPLY_CHAIN_MANAGER`.

Ravi (control-tower manager) **cannot** approve this alone — he holds `SUPPLY_CHAIN_MANAGER` but
deliberately not `QUALITY_ASSURANCE`, so a cold-chain reroute cannot be self-certified by the
person running the incident.

A run supplying only two of the three approvals **halts** at
`AWAITING_APPROVAL missing=FINANCE_APPROVER` and executes nothing. That halt, not the successful
run, is the evidence that the gate is real.
