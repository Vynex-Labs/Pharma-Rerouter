# P9 — End-to-End Integration · Phase Output Package

**Status:** COMPLETE · **Date:** 2026-09-07 · **Gate:** PASS

## 1. Objective
Wire the deterministic spine: a real state machine, real persistence of computed artefacts, bounded
execution behind an authorization, and recovery verification that can actually fail.

## 2. Deliverables
| Artifact | Path |
|---|---|
| Decision state machine | `src/core/statemachine.mjs` |
| Authorization, bounded execution, recovery verification | `src/core/execution.mjs` |
| Artefact persistence (impact, scenarios) | `src/core/persist.mjs` |
| Pipeline orchestrator | `src/core/pipeline.mjs` |
| Demo CLI | `scripts/demo.mjs` (`npm run demo [-- --approve]`) |
| Tests (24) | `tests/pipeline.test.mjs` |

## 3. Verified end-to-end run
```
DETECTED -> IMPACT_ASSESSED -> SCENARIOS_GENERATED -> RANKED -> POLICY_EVALUATED
         -> PENDING_APPROVAL -> APPROVED -> EXECUTING -> RECOVERY_VERIFIED -> SEALED
```
Flagship figures: 4 orders at risk, 2 shipments held, earliest stockout 2026-09-12.
Ranked `AIR_REROUTE 81` / `INVENTORY_REBALANCE 80` / `DO_NOTHING 15`; `ALT_SUPPLIER` BLOCKED.
Execution rerouted 2 shipments; orders at risk **4 -> 1**; recovery objective **MET**; audit chain
valid across 13 events. **Pipeline latency 25 ms** (NFR-001 budget: 2 s).

## 4. Design decisions worth defending

**The pipeline halts at PENDING_APPROVAL by default.** There is no auto-approve convenience path.
A demo that approves itself would defeat the governance model that is the point of the project.
Continuing requires a caller to pass explicit approval evidence.

**Recovery is measured against the selected scenario's own prediction**, not an arbitrary ideal.
"Zero orders at risk" would mark almost every real action as a failure and tell an operator nothing.
Comparing outcome to prediction makes the *ranking model itself falsifiable* — if scenarios
routinely miss their predictions, the scoring is wrong and the evidence will show it. In the
flagship run the engine predicted 2 residual at-risk orders and execution achieved 1.

**Consume-then-write inside one transaction.** The authorization is marked consumed in the same
transaction as the state mutations, so a mid-execution failure rolls back both — a failed attempt
does not burn the authorization, and a replay cannot double-execute.

**Execution is bounded by a handler table.** An action type absent from `ACTION_HANDLERS` cannot
run regardless of what any agent, policy or caller requests.

**The UI now consumes the pipeline.** `buildState()` previously re-implemented the flow inline, so
the screens could drift from the tested path. There is now one orchestration path; the UI test
imports the server's real `view()` rather than keeping a parallel copy.

## 5. Defects found and fixed
| ID | Severity | Finding |
|---|---|---|
| D9-1 | HIGH | `actionsFor` re-derived actions from the impact record instead of using the engine's own `actions` array, producing a whole shipment object where an id belonged and a null lane. The executed actions would have diverged from the scored ones. Fixed by using the engine output; handlers now validate every field and name what is missing. |
| D9-2 | HIGH | Recovery verification reused the do-nothing cover basis, which counts no inbound stock. Orders at risk read 4 before and 4 after a successful reroute, so the objective was reported missed no matter what execution achieved. **A verification step whose result is independent of the action being verified is not a verification step.** Fixed with an explicit `countInbound` option, leaving baseline semantics untouched. |
| D9-3 | MEDIUM | Computed impact and scenarios were never persisted — P4 designed the tables, P5 computed the values, nothing joined them. A decision could not reference the scenario it selected (FK failure). Fixed in `src/core/persist.mjs`. |
| D9-4 | LOW (test defect) | A test asserted the persisted shipment status was `HELD`; `HELD` is derived in memory from the lane closure and deliberately never written back. The test was asserting inference as if it were stored fact. |

## 6. Requirements verified
REQ-050 (authorization required), REQ-051 (hash-bound, void on change), REQ-052 (single-use,
idempotent, row-level optimistic locking), REQ-053 (recovery recomputed), REQ-054 (misses recorded
and surfaced), REQ-055 (simulated, labelled), REQ-039 (rejected/blocked never executable),
REQ-041 (policy version recorded), REQ-024 (excluded options persisted with reasons), DA-2.

## 7. Honest limitations
- **The policy engine here is interim** (`interim-p9-0.1.0`) and exists only to exercise the spine.
  It implements coarse classification, not the full P12 rule table, role routing or evidence
  contract. It is named `evaluatePolicyInterim` so it cannot be mistaken for the real thing.
- **Approval capture does not exist.** The pipeline accepts approval evidence from a caller but
  performs no identity or role verification, no self-approval prevention, no stale-approval
  invalidation. That is P12. The UI says so instead of showing an Approve button.
- Execution is simulated; no carrier or SAP write occurs.
- Only the flagship disruption is exercised end to end.
