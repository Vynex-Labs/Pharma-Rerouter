# P2 — Architecture

| Field | Value |
|---|---|
| Phase ID | P2 |
| Phase Name | Architecture |
| Status | **READY FOR REVIEW → PASSED on `APR-P2-001`** |
| Depends on | P1 (PASSED) |
| Primary approver | System Architect · Supporting: AI Architect, SAP Strategy Specialist, Master Orchestrator |

## Objective
Select, with recorded reasoning, the smallest architecture that can genuinely satisfy the flagship
scenario, the six theme capabilities, the determinism rule (§5), the governance rule (§9–§10), and
the "must still work when the LLM is down" failure mode F-1.

---

## 1. Architectural Drivers (derived from P1, not invented here)

| ID | Driver | Source |
|---|---|---|
| AD-1 | All authoritative numbers computed deterministically; LLM may never originate one | Master Prompt §5 |
| AD-2 | System must degrade gracefully to a fully deterministic pipeline | F-1 |
| AD-3 | Multi-role approval with tamper-evident evidence; stale approvals invalid | §10.3, §10.4 |
| AD-4 | Agent actions bounded by an enforced permission model, not by prompt wording | §11 |
| AD-5 | Genuine SAP participation in the workflow, honestly labelled | §7 P7, §30 |
| AD-6 | Every state transition auditable and replayable | §14 |
| AD-7 | Buildable and demo-stable by a small team on a hackathon timeline | §36, R-01 |
| AD-8 | Cold-chain feasibility, supplier qualification, shelf-life netting are hard constraints | P1 §13 |

---

## 2. Candidate Architectures

Three genuinely different options — different *loci of control*, not cosmetic variants.

### Architecture A — "LLM-Orchestrated Multi-Agent Mesh"
A supervisor LLM agent holds the workflow. Specialist agents (sensing, impact, scenario, logistics,
inventory, supplier, compliance) communicate by message passing; the supervisor decides who runs next
and when the workflow is finished. Deterministic engines exist but are reached only as agent tools.
State lives in the conversation/agent memory, persisted opportunistically.

- **Shape:** control flow = LLM. Determinism = leaf tools.
- **Pros:** maximally "agentic" on a slide; flexible to novel disruptions; impressive traces.
- **Cons:** the *workflow itself* becomes non-deterministic — the same disruption can take different
  paths on different runs, which is fatal for a live demo and unacceptable for an audit trail that
  must be reconstructable. Violates AD-2 outright (no LLM → no workflow). Governance is advisory
  because the supervisor decides when to consult policy. Token cost and latency are unpredictable.
  Debugging a failed run means reading transcripts.

### Architecture B — "Deterministic Workflow Engine with No Agents (Rules + Optimiser)"
A classical event-driven pipeline: rules engine detects, MILP/heuristic optimiser scores scenarios,
workflow engine routes approvals. LLM used only for cosmetic summary text, or not at all.

- **Shape:** control flow = code. Reasoning = code.
- **Pros:** completely predictable, testable, fast, cheap; strongest audit story; easiest to verify.
- **Cons:** **it is not an agentic system** and does not answer the theme's core premise. It cannot
  ingest unstructured advisories, cannot explain trade-offs in the operator's language, cannot
  coordinate or adapt. Judges' first question — "why AI?" — has no answer. Fails Master Prompt §32.
  Also brittle: any signal not anticipated by a rule is invisible.

### Architecture C — "Deterministic Spine with Bounded Agents at the Edges" *(governed agentic core)*
A **deterministic, persisted state machine** owns the workflow:

```text
DETECTED → IMPACT_ASSESSED → SCENARIOS_GENERATED → RANKED → POLICY_EVALUATED
        → PENDING_APPROVAL → APPROVED | REJECTED | BLOCKED → EXECUTING
        → RECOVERY_VERIFIED → SEALED
```

Each transition is a typed, idempotent, versioned command executed by code and appended to a
hash-chained event log. Agents are invoked **at named seams** and are *contributors*, never drivers:

| Seam | Agent | May produce | May never produce |
|---|---|---|---|
| S1 ingest | Disruption Sensing | classification, severity, confidence, geography from unstructured text | affected entities, any quantity |
| S2 post-impact | Impact Narration | operator-language summary of engine output | the impact numbers themselves |
| S3 scenario | Scenario Reasoning | candidate strategies as *typed intents*, qualitative trade-off analysis, ranking rationale | cost, ETA, risk score, feasibility |
| S4 policy | (none — pure code) | — | — |
| S5 approval | Explanation | evidence-pack prose for the approver | the policy verdict |
| S6 post-exec | Compliance | audit narrative, source attribution | the audit hash chain |
| — | Orchestrator | *advisory* next-step suggestion + anomaly flags | authority to skip a state or approval |

Every agent output is schema-validated; every entity reference is resolved against the database and
rejected if unknown (closes F-3). If any agent fails, the spine continues with templated deterministic
text, marked `explanation_source: DETERMINISTIC_FALLBACK` (closes F-1, F-2).

Policy Engine, permission checks, approval evidence and audit sealing are **middleware on the state
machine**, not agent-callable. An agent physically cannot reach the execution endpoint; only an
`ExecutionAuthorization` minted by an approved, non-stale decision can.

- **Pros:** genuinely agentic where reasoning is needed (AD-1 satisfied by construction), fully
  deterministic where it must be (AD-2), governance is structurally unbypassable rather than
  prompt-dependent (AD-3, AD-4), replayable audit (AD-6), demo-stable (AD-7).
- **Cons:** less "autonomous" than A — agents cannot invent a new workflow shape; more upfront schema
  and contract work; requires discipline to keep the seams narrow.

---

## 3. Comparison Matrix

Weighted 1–5 (5 best). Weights reflect the acceptance criteria we are actually judged on.

| Criterion | W | A (LLM mesh) | B (pure deterministic) | C (governed spine) |
|---|---|---|---|---|
| Problem fit | 5 | 3 | 3 | **5** |
| Genuine agentic behaviour | 5 | 5 | 1 | **4** |
| Determinism of authoritative values (AD-1) | 5 | 2 | 5 | **5** |
| Graceful degradation w/o LLM (AD-2) | 5 | 1 | 5 | **5** |
| Governance unbypassable (AD-3/4) | 5 | 2 | 4 | **5** |
| Auditability / replayability (AD-6) | 4 | 2 | 5 | **5** |
| SAP integration fit (AD-5) | 3 | 3 | 4 | **4** |
| Demo reliability (AD-7) | 5 | 2 | 5 | **5** |
| Testability | 4 | 2 | 5 | **4** |
| Explainability to a judge | 4 | 3 | 2 | **5** |
| Build effort within timeline | 4 | 3 | 4 | **3** |
| Extensibility to new disruption types | 3 | 5 | 2 | **4** |
| Security surface | 3 | 2 | 5 | **4** |
| **Weighted total** | **55** | **148** | **200** | **240** |

*(A=148, B=200, C=240 of a possible 275.)*

## 4. Selected Architecture

> **Architecture C — Deterministic Spine with Bounded Agents at the Edges.**

It is the only candidate that scores ≥4 on *both* "genuine agentic behaviour" and "determinism /
degradation / governance". A and B each fail a non-negotiable: A fails §5 and F-1, B fails §32.

## 5. Rejected Alternatives & Why (recorded, not discarded)
- **A rejected** because a non-deterministic *control flow* cannot produce a reconstructable audit
  trail, and because a demo whose path varies per run is a demo that will fail on stage. We keep A's
  best idea — rich, visible agent traces — by rendering the seam-level agent activity in the UI.
- **B rejected** because it answers "resilient supply chain" but not "agentic". We keep B's best idea —
  every number provably computed — as the spine itself.

## 6. Trade-offs Accepted
1. Agents cannot invent new workflow shapes at runtime. **Accepted:** in a GxP-adjacent domain, an
   unpredictable workflow is a defect, not a feature. New disruption types are added as new
   scenario-generator strategies + policy rules, not by hoping the LLM improvises correctly.
2. More schema/contract code upfront. **Accepted:** it is what makes P10–P14 pass.
3. LLM quality gates the *explanation* quality, not the *decision* quality. **Accepted and desirable.**

## 7. Logical Architecture

```text
┌──────────────────────────── PRESENTATION ────────────────────────────┐
│ Control Tower UI (DESIGN.md authority + product-surface extension)   │
│ Dashboard · Network · Incident · Scenarios · Approvals · Agents ·    │
│ Inventory · Audit                                                    │
└───────────────▲──────────────────────────────────────────────────────┘
                │ typed API (REST/JSON) + event stream for live demo
┌───────────────┴──────────────── APPLICATION ─────────────────────────┐
│  RESILIENCE SPINE  (deterministic, persisted state machine)          │
│  DETECTED→IMPACT→SCENARIOS→RANKED→POLICY→APPROVAL→EXEC→RECOVERY→SEAL │
│                                                                      │
│  Middleware (code only, NOT agent-callable):                         │
│   • Policy Engine  • Permission/AuthZ  • Approval Evidence Service   │
│   • Execution Authorization Minter  • Hash-chained Audit Ledger      │
└───────┬───────────────────────────────────────────┬──────────────────┘
        │ tool calls (typed, validated, allow-listed)│ invoked at seams
┌───────▼──────────── DETERMINISTIC CORE ───────────┐ ┌────▼─── AGENT LAYER ────┐
│ Network model (graph)   Route/ETA engine          │ │ Sensing  Impact-narr.   │
│ Cost engine             Inventory & days-of-cover │ │ Scenario  Explanation   │
│ Cold-chain feasibility  Shelf-life netting        │ │ Compliance  Orchestrator│
│ Supplier qualification  Risk scoring              │ │ (advisory only)         │
│ Constraint checker      Scenario ranker (MCDA)    │ │ schema-validated I/O    │
└───────┬───────────────────────────────────────────┘ └────┬────────────────────┘
        │                                                  │ provider-abstracted
┌───────▼──────────────── DATA & INTEGRATION ──────────────▼──────────────────┐
│ Relational store: network · products · lots · shipments · orders ·          │
│ suppliers · scenarios · decisions · approvals · audit_events (hash-chained) │
│ SAP Adapter (P7): typed contract + circuit breaker + DataSource badge       │
│   LIVE_SAP | SAP_SANDBOX | SIMULATED  ← rendered in the UI, never hidden    │
│ Synthetic scenario generator (seeded, reproducible)                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 8. Key Architectural Rules (binding on all later phases)
1. **AR-1** No LLM output is persisted as an authoritative numeric field. Agent numbers, if any
   appear, are stored in an `agent_commentary` field and rendered visually distinct.
2. **AR-2** Every agent output passes JSON-Schema validation *and* referential validation against
   the database before use.
3. **AR-3** Execution requires a valid, non-stale `ExecutionAuthorization`. Its inputs include a hash
   of the decision payload; if the decision changes, the hash mismatches and the authorization is void
   (implements §10.4).
4. **AR-4** The audit ledger is append-only and hash-chained (`h_n = H(h_{n-1} ‖ event)`); no code path
   offers update or delete.
5. **AR-5** Untrusted text (advisories, supplier notes) is passed to models as clearly delimited *data*
   with a standing instruction that it carries no authority; tool allow-lists are computed server-side
   from the agent's role and are unaffected by content (mitigates F-6).
6. **AR-6** Every dataset and every API response carries a `data_classification` and `data_source`.
7. **AR-7** LLM provider is behind an interface; swapping provider must not touch the spine.

## 9. SAP Integration Position (verified capability, design only at P2)

**Verified (public documentation):** SAP publishes OData APIs for S/4HANA Cloud through the SAP
Business Accelerator Hub with a sandbox at `https://sandbox.api.sap.com/s4hanacloud`, including
`API_MATERIAL_STOCK_SRV` (`A_MaterialStock`), `API_MRP_MATERIALS_SRV_01` and `API_PRODUCT_SRV`, with
API-key authentication for sandbox use [1](https://support.tulip.co/docs/sap-s4-hana-cloud-connector)
[3](https://prismatic.io/docs/components/sapS4Hana/), and productive access via communication
arrangements/basic auth rather than the sandbox key
[2](https://community.sap.com/t5/technology-blog-posts-by-members/api-consumption-s-4-hana-cloud-public-edition-and-s-4-hana-cloud-private/ba-p/14162598).
SAP BTP offers a Free Tier with always-free service plans (distinct from the 90-day trial), and
SAP AI Core is available on Free Tier but **not** on Trial
[3](https://github.com/SAP-archive/btp-ai-sustainability-bootcamp/blob/opensap-freetier/prerequisites/prerequisites.md)
[2](https://bluestonex.com/knowledge-bank/the-ultimate-guide-to-sap-btp/).

**Architectural placement:** the SAP Adapter is the *inventory and product master read path* and the
*write-back path for the approved action*, sitting behind the Deterministic Core's data ports.
Concretely: material stock informs days-of-cover; the approved rerouting/transfer is expressed as a
write-back intent. The adapter is a first-class port with three honest modes (`LIVE_SAP`,
`SAP_SANDBOX`, `SIMULATED`) surfaced in the UI.

**Not yet claimed:** that we have a provisioned tenant, that write-back is executed against a
productive system, or that any specific endpoint has been called successfully. Those become claims
only when P7 attaches request/response evidence. Until then this section is *design*, per §30.

## 10. Risks Introduced by This Architecture
| ID | Risk | Sev | Mitigation |
|---|---|---|---|
| AR-R1 | Seams too narrow → agents look decorative | MEDIUM | Agent Activity screen must show real tool calls, real rejected outputs, real fallbacks |
| AR-R2 | Hash-chain implemented but never verified | MEDIUM | P10 test that mutating a row breaks verification |
| AR-R3 | Policy engine becomes a hard-coded if-ladder | MEDIUM | Policy as versioned declarative rules; `policy_version` recorded in every approval |
| AR-R4 | SAP adapter silently falls back and demo claims "live" | **HIGH** | Data-source badge is mandatory in the API contract and asserted by a test |

## 11. Deliverables
Three architectures · comparison matrix · selection · rejections · trade-offs · risks · diagram ·
ADRs (`docs/ADR/0001`–`0004`).

## 12. Verification Performed
| Check | Evidence |
|---|---|
| ≥3 genuinely different architectures | §2 — differ in locus of control, not styling |
| Comparison matrix with weights tied to acceptance criteria | §3 |
| Selection justified against non-negotiables | §4 |
| Rejected options preserved with salvaged ideas | §5 |
| Every P1 failure mode F-1…F-8 has an architectural answer | F-1/F-2 §2-C fallback; F-3 AR-2; F-4 seam S1 confidence; F-5 AR-3; F-6 AR-5; F-7 §9 badge; F-8 versioned idempotent commands |
| SAP claims carry verified sources | §9 with citations |
| No implementation started before this gate | repository contains no source code |

## 13. Known Issues / Open Risks
AR-R1…AR-R4 above; R0-2/R0-3 (design extension) still open for P8.

## 14. Approver(s)
System Architect (primary); AI Architect, SAP Strategy Specialist, Master Orchestrator (supporting).
Cross-role evaluations recorded in `docs/P2-architecture-review.md`. Record `APR-P2-001`.

## 15. Handoff Package → P3
Selected architecture, architectural rules AR-1…AR-7, the state machine as the requirement backbone,
the agent seam table (S1–S6) as the agent-contract backbone, and the SAP port definition with its
three honest modes. P3 must produce a requirement ID for each architectural rule so that AR-1…AR-7
are testable rather than aspirational.
