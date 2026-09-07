# P5 — Deterministic Core

| Field | Value |
|---|---|
| Phase ID | P5 |
| Phase Name | Deterministic Core |
| Status | **READY FOR REVIEW → PASSED on `APR-P5-001`** |
| Depends on | P4 (PASSED) |
| Primary approver | Optimization Engineer · Supporting: Backend, QA |
| Closes conditions | **DE-1** (cold-chain feasibility gate), **DE-2** (supplier qualification BLOCKS) |

## Objective
Compute impact and recovery alternatives **without any language model**, so that the agent layer
built in P6 can only interpret and explain — never originate an authoritative value (AR-1).

## Modules Delivered
| Module | Responsibility | Requirements |
|---|---|---|
| `src/core/network.mjs` | Graph build, Dijkstra routing, path summarisation, downstream traversal | REQ-010, REQ-014 |
| `src/core/inventory.mjs` | Usable quantity with shelf-life netting, days-of-cover, orders at risk | REQ-011, REQ-012 |
| `src/core/constraints.mjs` | Cold-chain gate, supplier qualification, capacity, lead time | REQ-022, REQ-023, REQ-024 |
| `src/core/scoring.mjs` | Transport cost, decomposed risk score, MCDA ranking | REQ-021, REQ-025 |
| `src/core/impact.mjs` | Blast radius, cover deltas vs counterfactual, do-nothing baseline | REQ-010, REQ-013 |
| `src/core/scenarios.mjs` | Five strategies + agent-intent driven generation | REQ-020, REQ-026, REQ-028 |

## Condition Closure

### DE-1 — cold-chain feasibility is a GATE (REQ-022)
`checkColdChain` returns `INFEASIBLE` when cumulative excursion across **all legs** exceeds the
product budget. The reason text states explicitly that the option is *"not rankable at any cost"*,
and `rankScenarios` filters non-FEASIBLE options out of ranking entirely. Verified by a test proving
a cheap infeasible option can never outrank a costly feasible one.

### DE-2 — supplier qualification BLOCKS (REQ-023)
`checkSupplierQualification` returns `BLOCKED` for an unqualified destination market, with reason
text stating it *"cannot be approved by any role"*. `evaluateConstraints` makes BLOCKED dominate
INFEASIBLE so a prohibited option is never presented as merely impractical.

## Flagship Output (evidence)

```text
WH-CENTRAL / PRD-VAX-01: raw 24,200 → usable 8,400 (write-off 15,800) → 6 days cover, WARNING
orders at risk: 4   earliest stockout: 2026-09-12

 #1 AIR_REROUTE          score=81  protected=2  eta=  36h  risk=32
 #2 INVENTORY_REBALANCE  score=80  protected=1  eta=  24h  risk=15
 #3 DO_NOTHING           score=15  protected=0  eta= 624h  risk=100
    INFEASIBLE  ALT_PORT      — excursion 14 h exceeds 12 h budget
    BLOCKED     ALT_SUPPLIER  — not qualified for market EU
```

All four governance outcomes (FEASIBLE / INFEASIBLE / BLOCKED / baseline) occur in **one run**,
as designed in P4 §7. The top two options are genuinely close (81 vs 80) on different merits —
air protects more orders, rebalancing is cheaper and lower risk — which is what makes the
human approval step meaningful rather than ceremonial.

## Defects Found and Fixed During Verification

**D5-1 (HIGH, product logic) — shelf-life netting did not actually bite.**
`docs/data-model.md` §7 claimed WH-CENTRAL "looks adequate on raw quantity but a large lot expires
inside the horizon". It did not: the short-dated lot held 5,000 units against 1,400/day demand over
6 days, so all 5,000 were consumable and the write-off was zero. REQ-012 was therefore passing
against data that could not exercise it. The lot was re-specified to 20,000 units at 3 days
(write-off 15,800). The Domain Expert's P1 Challenge 3 is now genuinely demonstrated.

**D5-2 (MEDIUM, engine) — inventory rebalancing only searched direct lanes.**
`buildRebalance` looked for a single hop between donor and shortage site and returned `null`
otherwise, so rebalancing silently disappeared whenever the surplus was two hops away. Replaced
with a cold-chain-constrained route-engine search over ranked donors. Caught by the CA-2 test.

**D5-3 (MEDIUM, scoring) — DO_NOTHING was rewarded for being free and instantaneous.**
With `etaHours = 0` the MCDA gave inaction full marks on speed and cost, scoring it 40/100. "No
goods ever arrive" is the opposite of "arrives in zero hours". The baseline now uses
outage duration + original transit (624 h) and correctly collapses to 15, ranking last. A
regression test asserts every corrective action outscores inaction.

**D5-4 (test defect) — an assertion that the router was wrong.**
A test asserted the fastest DC→hospital path included the 480 h sea lane; Dijkstra correctly chose
the 36 h air lane. The test was corrected and strengthened to also verify exclusion and CLOSED-lane
handling.

## Verification
| Check | Evidence |
|---|---|
| Impact/alternatives computed without an LLM | No module in `src/core/` imports an agent or provider (NFR-003, NFR-008) |
| DE-1 closed | 3 tests incl. in-situ ALT_PORT INFEASIBLE with numbers |
| DE-2 closed | 3 tests incl. in-situ ALT_SUPPLIER BLOCKED |
| REQ-024 never silently dropped | Excluded scenarios retained with mandatory reason |
| REQ-026 / CA-2 | Agent intents change the generated set; unknown strategy rejected |
| Determinism (NFR-004) | Repeated runs produce identical output |
| Performance (NFR-001) | Full pipeline < 2 s (measured, well under) |
| Snapshot immutability | Impact does not mutate the frozen snapshot |
| **Test total** | **54/54 passing** |

## Known Issues / Open Risks
- MCDA weights are ASSUMED organisational values, not empirical. Configurable and shown in the UI.
- Risk scoring components are heuristic. Decomposed so a reviewer can challenge each part.
- `ordersAtRisk` resolves a hospital's supplying warehouse via the first inbound lane; adequate for
  the flagship topology, would need explicit sourcing rules in a multi-source network.

## Handoff → P6
Deterministic tools and typed contracts are available for agents to call. P6 owns conditions
**AI-1** (mandatory confidence/uncertainty) and **CA-2** (intents must drive generation — the
engine hook `generateScenarios({ strategyIntents })` already exists and is tested).
