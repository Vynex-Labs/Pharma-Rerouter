# Pharma-Rerouter

**Agentic Pharmaceutical Supply-Chain Resilience Control Tower**
SAP Hackfest 2026 · Theme 1: Resilient Supply Chains

> Detect disruption → understand impact → simulate alternatives → select the safest feasible
> response → obtain human approval when required → execute bounded actions → verify recovery →
> maintain a complete audit trail.

---

## Current status

**Phase P3 complete. No application code has been written yet — deliberately.**

Phases P0–P3 (reconnaissance, problem definition, architecture, requirements) have passed their
gates. Implementation begins at P4 (Data Architecture). See `docs/phase-plan.md` for live gate status.

| Phase | Status |
|---|---|
| P0 Repository Reconnaissance | PASSED |
| P1 Problem Definition | PASSED |
| P2 Architecture | PASSED (with conditions) |
| P3 Requirements | PASSED |
| P4 Data Architecture | next |
| P5–P21 | not started |

## The problem

When a logistics disruption hits, a pharmaceutical supply-chain manager can see the event in minutes
but needs hours to days to know *which patient-facing orders are at risk, what the feasible
alternatives are, and which one is safest* given cold-chain, shelf-life, cost and qualification
constraints. Decisions get made on partial information and are rarely recorded with their rationale.

This system closes that gap — and leaves behind provable evidence of why each decision was made.

## Flagship scenario

**Cold-chain lane collapse on a temperature-controlled vaccine corridor.** Chosen because it forces
all six theme capabilities to be genuinely exercised (sensing, scenario planning, rerouting, inventory
rebalancing, compliance, human-in-the-loop) and makes the multi-approver path unavoidable rather than
decorative.

## Architecture in one line

**A deterministic state machine owns the workflow; bounded agents contribute interpretation,
reasoning and explanation at six named seams.**

```text
DETECTED → IMPACT_ASSESSED → SCENARIOS_GENERATED → RANKED → POLICY_EVALUATED
        → PENDING_APPROVAL → APPROVED|REJECTED|BLOCKED → EXECUTING
        → RECOVERY_VERIFIED → SEALED
```

Policy evaluation has **no agent**. Deterministic engines own every authoritative number. No agent has
a code path to execution, approval, authorization or audit mutation. The system keeps working with the
language model switched off — only the prose degrades, never the decision.

See `docs/architecture.md` and `docs/ADR/`.

## What we will not claim

This project follows a strict honesty contract (Master Prompt §30):

- **Data is SYNTHETIC**, generated from a fixed seed, and labelled as such in the UI.
- **SAP:** we implement the S/4HANA Cloud OData contract for material stock and carry a
  `data_source` badge of `LIVE_SAP` / `SAP_SANDBOX` / `SIMULATED` on every derived figure. We will not
  write "integrated with SAP" anywhere until P7 attaches request/response evidence.
- **Audit integrity** is described as *tamper-evident, hash-chained* — never as blockchain or
  externally notarised.
- **Carrier execution is simulated.** The UI says so.
- No pharmaceutical or regulatory fact appears without a citation; uncited premises are labelled
  ASSUMPTION.

## Documentation

| Document | Purpose |
|---|---|
| `DESIGN.md` | **UI design authority** (Linear-derived token system). Do not restate; reference it. |
| `docs/P0-repository-reconnaissance.md` | Baseline assessment, risks, constraints |
| `docs/P1-problem-definition.md` | Problem, personas, journeys, failure modes, KPIs, scope, flagship scenario |
| `docs/architecture.md` | Three candidate architectures, weighted comparison, selection, rules AR-1…AR-7 |
| `docs/P2-architecture-review.md` | Six independent role evaluations, dissent, and the 10 binding conditions |
| `docs/SRS.md` | 62 functional + 12 non-functional requirements |
| `docs/traceability.md` | Requirement → design → implementation → test → evidence |
| `docs/phase-plan.md` | Gate status, dependencies, parallelism, risk register |
| `docs/approvals.md` | Phase approval evidence records |
| `docs/ADR/` | ADR-0001 architecture · 0002 AI boundary · 0003 governance · 0004 SAP strategy |

## Environment

Node 22 · Python 3.11 available. Stack selection is a P4/P5 decision and is not yet fixed.

## Repository conventions

- Work happens on branch `arena/01a07bbf-pharma-rerouter`.
- `Skiils.md` is provenance metadata (it records how `DESIGN.md` was generated), not a dependency.
- Every phase produces a completion package in `docs/` and an approval record in `docs/approvals.md`
  before the next dependent phase may start.
