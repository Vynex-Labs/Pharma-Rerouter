# Pharma-Rerouter

**Agentic Pharmaceutical Supply-Chain Resilience Control Tower**
SAP Hackfest 2026 · Theme 1: Resilient Supply Chains

> Detect disruption → understand impact → simulate alternatives → select the safest feasible
> response → obtain human approval when required → execute bounded actions → verify recovery →
> maintain a complete audit trail.

---

## Current status

**Phases P0–P9, P11, P12 complete. The full flow runs end to end. `npm test` → 167/167 passing.**

| Phase | Status |
|---|---|
| P0 Repository Reconnaissance | PASSED |
| P1 Problem Definition | PASSED |
| P2 Architecture | PASSED (with 10 conditions) |
| P3 Requirements | PASSED |
| P4 Data Architecture | PASSED |
| P5 Deterministic Core | PASSED |
| P6 AI / Agent Layer | PASSED — closes AI-1, CA-2 |
| P7 SAP Integration | PASSED WITH CONDITION — SAP-1 open by design |
| P8 Control Tower UI | PASSED — closes PM-1 |
| P9 End-to-End Integration | PASSED |
| P11 AI Evaluation | PASSED |
| P12 Security & Governance | PASSED |
| P10 Testing | next |
| P13–P21 | not started |

7 of the 10 binding P2 conditions are closed. See `docs/phase-plan.md` for live gate status and
`docs/approvals.md` for the approval evidence behind each.

## Running it

```bash
npm install
npm run seed     # deterministic; snapshot hash 0dfe4d97…a65a0b8
npm run dev      # control tower on http://localhost:3000
npm run demo     # end-to-end transcript (add -- --approve to run through execution)
npm test         # 167 tests
npm run eval     # AI guardrail evaluation, 17/17
```

Everything runs offline. The default LLM provider is a deterministic mock, and the SAP adapter
runs in `SIMULATED` mode unless a real API key is supplied.

### What actually works today
The complete spine, verified end to end in 25 ms:

```
DETECTED → IMPACT_ASSESSED → SCENARIOS_GENERATED → RANKED → POLICY_EVALUATED
        → PENDING_APPROVAL → APPROVED → EXECUTING → RECOVERY_VERIFIED → SEALED
```

Disruption sensing (agent) → deterministic impact → agent-selected strategy generation → MCDA
ranking with hard feasibility gates → bounded execution behind a single-use, hash-bound
authorization → recovery verification measured against the selected scenario's own prediction →
hash-chained audit → eight-screen control tower.

Flagship run: 4 orders at risk → **1** after execution, recovery objective met, chain valid.

**Governance (P12) is real.** The deterministic policy engine (`POLICY_VERSION 1.0.0`, 11 rules,
no agent involvement) classifies the flagship as `APPROVAL_REQUIRED` needing **three** roles —
FINANCE_APPROVER + QUALITY_ASSURANCE + SUPPLY_CHAIN_MANAGER — because three independent rules fire.
Approvals require an 11-field evidence contract; a bare `approved=true` is rejected. A run
supplying only two of the three approvals **halts** at `AWAITING_APPROVAL` and executes nothing.

**Scope limit: authorization, not authentication.** Identities are seeded rows asserted by the
caller — there is no SSO, session or token. The system protects against mistake, drift and process
bypass by trusted operators, not against an untrusted caller. See `docs/security.md` §1.

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
- **SAP: we have implemented an integration *contract*, not a verified integration.** The OData
  service paths, entity sets, field mappings and both V2/V4 envelope shapes are real and tested
  against SAP's published API documentation. **No request has ever been sent to SAP** — no API key
  is provisioned. The adapter downgrades `LIVE_SAP`/`SAP_SANDBOX` to `SIMULATED` whenever no key is
  present, so the badge cannot overstate what we have. The phrases "integrated with SAP", "live SAP
  data" and "powered by SAP AI Core" appear nowhere, and a test enforces that.
- **No real language model has been exercised.** The default provider is a deterministic mock that
  declines to write prose, so narrative text comes from deterministic templates and the UI labels it
  `Template · deterministic` rather than `AI-generated`.
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
| `docs/SRS.md` | 75 functional + 12 non-functional requirements |
| `docs/traceability.md` | Requirement → design → implementation → test → evidence |
| `docs/phase-plan.md` | Gate status, dependencies, parallelism, risk register |
| `docs/approvals.md` | Phase approval evidence records |
| `docs/agents.md` | Agent specification — which seams are genuine agents, which are narration, and why |
| `docs/design-extension.md` | Additive product-surface extension to `DESIGN.md` (resolves R0-2, R0-3) |
| `docs/P5-deterministic-core.md` … `docs/P12-security-governance.md` | Phase output packages |
| `docs/security.md`, `docs/governance.md` | Trust boundaries, authority model, approval rules |
| `docs/changelog.md` | Reverse-chronological, one entry per phase gate, with propagation records |
| `docs/ADR/` | ADR-0001 architecture · 0002 AI boundary · 0003 governance · 0004 SAP strategy · 0005 determinism |

## Environment

Node ≥ 22, ESM throughout. Runtime dependency: `better-sqlite3` (pinned `^13.0.3`). Dev dependency:
`jsdom`. No web framework — the API surface is small enough that adding one would be unjustified
weight. Everything runs offline with no service to start.

## Repository conventions

- Work happens on branch `arena/01a07bbf-pharma-rerouter`.
- `Skiils.md` is provenance metadata (it records how `DESIGN.md` was generated), not a dependency.
- Every phase produces a completion package in `docs/` and an approval record in `docs/approvals.md`
  before the next dependent phase may start.
