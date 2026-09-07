# Software Requirements Specification (SRS)

**Project:** Agentic Pharmaceutical Supply-Chain Resilience Control Tower
**Repository:** `Vynex-Labs/Pharma-Rerouter`
**Version:** 0.1.0 (baseline established at P3)
**Status:** BASELINE — approved for P4 to consume
**Date:** 2026-09-07
**Authority:** subordinate to explicit user requirements; supersedes informal notes. UI matters defer
to `DESIGN.md`. Architecture defers to ADR-0001…0004.

---

## 1. Purpose and Scope
Specifies the requirements for a control-tower system that detects a pharmaceutical supply-chain
disruption, deterministically computes its impact and feasible recovery scenarios, uses bounded agents
to interpret and explain, routes actions to policy-determined human approvers, executes only what was
approved, verifies recovery, and records tamper-evident audit evidence.

Scope and non-goals are defined in `docs/P1-problem-definition.md` §7 and are normative here.

## 2. Definitions
| Term | Meaning |
|---|---|
| Spine | The deterministic, persisted workflow state machine (ADR-0001) |
| Seam | A named point where an agent is invoked (S1, S2, S3, S5, S6, orchestrator) |
| Authoritative value | A number or feasibility verdict used in a decision; only engines may produce one |
| Decision | A persisted proposal to change supply-chain state, with lifecycle and evidence |
| ExecutionAuthorization | Short-lived token minted only from an approved, non-stale decision |
| Days-of-cover | On-hand usable inventory ÷ demand rate, netting lots expiring before need-by |
| Data classification | One of `REAL`, `SIMULATED`, `SYNTHETIC`, `ASSUMED` |
| Data source | One of `LIVE_SAP`, `SAP_SANDBOX`, `SIMULATED` |

## 3. Requirement Conventions
`MUST` = mandatory for release. `SHOULD` = strongly expected; omission requires a recorded reason.
Each requirement has an ID, priority (P1 highest), owning phase, and a verification method
(T = automated test, E = eval, I = inspection, D = demo evidence).

---

## 4. Functional Requirements

### 4.1 Disruption Sensing
| ID | Requirement | Pri | Phase | Ver |
|---|---|---|---|---|
| REQ-001 | The system MUST ingest a disruption signal comprising structured fields and unstructured advisory text. | P1 | P5/P6 | T |
| REQ-002 | The Sensing Agent MUST output event type, severity band, confidence (0–1), geography and expected duration as schema-valid structured output. | P1 | P6 | E |
| REQ-003 | The Sensing Agent MUST NOT output affected entities or any quantity; such fields MUST NOT exist in its schema. | P1 | P6 | I+E |
| REQ-004 | If sensing confidence is below the configured threshold, the resulting action's autonomy class MUST be downgraded, never upgraded. | P1 | P6/P12 | T |
| REQ-005 | If the Sensing Agent fails or returns invalid output twice, the system MUST continue using the structured fields alone, labelled `DETERMINISTIC_FALLBACK`. | P1 | P6 | T |

### 4.2 Impact Analysis (deterministic)
| ID | Requirement | Pri | Phase | Ver |
|---|---|---|---|---|
| REQ-010 | The Impact Engine MUST compute affected shipments, orders, facilities and lanes by graph traversal, without any LLM call. | P1 | P5 | T |
| REQ-011 | The Impact Engine MUST compute per-site days-of-cover and projected stockout date for each affected product. | P1 | P5 | T |
| REQ-012 | Days-of-cover MUST exclude inventory lots expiring before the need-by date (shelf-life netting). | P1 | P5 | T |
| REQ-013 | The engine MUST compute a do-nothing baseline for comparison. | P1 | P5 | T |
| REQ-014 | Impact results MUST be reproducible: identical inputs yield identical outputs. | P1 | P5 | T |
| REQ-015 | The Impact Narration Agent MAY summarise results but MUST NOT alter or restate any figure as authoritative. | P1 | P6 | E |

### 4.3 Scenario Generation, Evaluation, Ranking
| ID | Requirement | Pri | Phase | Ver |
|---|---|---|---|---|
| REQ-020 | The system MUST generate at least three candidate recovery scenarios plus the do-nothing baseline. | P1 | P5 | T |
| REQ-021 | Scenario cost, ETA, risk score and feasibility MUST be computed deterministically. | P1 | P5 | T |
| REQ-022 | Cold-chain temperature-time feasibility MUST be evaluated as a hard gate; a breaching scenario MUST be marked INFEASIBLE with a stated reason and MUST NOT be rankable. (Condition DE-1) | P1 | P5 | T |
| REQ-023 | A supplier not qualified for the destination market MUST cause the scenario to be BLOCKED, not merely penalised. (Condition DE-2) | P1 | P5/P12 | T |
| REQ-024 | Infeasible scenarios MUST be displayed with their exclusion reason, never silently dropped. | P2 | P5/P8 | T+I |
| REQ-025 | Ranking MUST use a documented multi-criteria method with visible, configurable weights. | P1 | P5 | T+I |
| REQ-026 | The Scenario Reasoning Agent MUST be able to propose typed strategy intents that genuinely influence which scenarios are generated. (Condition CA-2) | P1 | P6 | E+D |
| REQ-027 | The Scenario Reasoning Agent MUST NOT produce cost, ETA, risk or feasibility values. | P1 | P6 | I+E |
| REQ-028 | Scenarios MUST persist a reference to the input snapshot they were computed from. (Condition DA-2) | P1 | P4/P5 | T |

### 4.4 Policy, Approval, Governance
| ID | Requirement | Pri | Phase | Ver |
|---|---|---|---|---|
| REQ-030 | The Policy Engine MUST classify every proposed action as AUTONOMOUS, RECOMMENDED, APPROVAL_REQUIRED (single/multi) or BLOCKED. | P1 | P12 | T |
| REQ-031 | Policy evaluation MUST be deterministic code with no agent involvement. | P1 | P12 | I+T |
| REQ-032 | Policy MUST derive required approver roles from action type, financial impact, inventory impact, criticality, risk, reversibility, compliance sensitivity and agent confidence. | P1 | P12 | T |
| REQ-033 | Multi-approval actions MUST retain each individual approval plus a final authorization. | P1 | P12 | T |
| REQ-034 | Every approval MUST persist the complete evidence contract (Master Prompt §10.3). A boolean flag MUST NOT be sufficient. | P1 | P12 | T+I |
| REQ-035 | The system MUST reject approval by an identity lacking the required role. | P1 | P12 | T |
| REQ-036 | The system MUST prevent one identity from satisfying two required roles in a multi-approval. | P1 | P12 | T |
| REQ-037 | The system MUST reject approval submitted outside the `PENDING_APPROVAL` state (no post-execution approval). | P1 | P12 | T |
| REQ-038 | If decision inputs change after approval, the approval MUST be invalidated and the decision returned to `PENDING_APPROVAL`. | P1 | P12 | T |
| REQ-039 | A REJECTED or BLOCKED decision MUST NOT be executable by any role. | P1 | P12 | T |
| REQ-040 | Approval records MUST be append-only; corrections create superseding records. | P1 | P12 | T |
| REQ-041 | The policy rule set MUST be versioned and `policy_version` recorded in every evaluation and approval. | P1 | P12 | T |

### 4.5 Execution and Recovery
| ID | Requirement | Pri | Phase | Ver |
|---|---|---|---|---|
| REQ-050 | State-changing execution MUST require a valid `ExecutionAuthorization`; no other code path may mutate supply-chain state. | P1 | P9/P12 | T |
| REQ-051 | The authorization MUST embed a canonical hash of the decision payload and be void on mismatch. | P1 | P12 | T |
| REQ-052 | Execution MUST be idempotent and versioned; a stale-version write MUST be rejected. | P1 | P9 | T |
| REQ-053 | After execution the system MUST recompute impact and record whether the recovery objective was met. | P1 | P5/P9 | T |
| REQ-054 | Recovery verification failure MUST be recorded and surfaced, not suppressed. | P1 | P9 | T |
| REQ-055 | Execution against carriers is simulated; the UI and docs MUST state this. | P1 | P8 | I |

### 4.6 Agents (cross-cutting)
| ID | Requirement | Pri | Phase | Ver |
|---|---|---|---|---|
| REQ-060 | Every agent MUST have a documented responsibility, inputs, outputs, tools, permissions, autonomy level, constraints, handoff rule, failure behaviour and audit behaviour. | P1 | P6 | I |
| REQ-061 | Tool allow-lists MUST be derived server-side from agent role and MUST NOT be alterable by prompt or input content. | P1 | P6/P12 | T |
| REQ-062 | Every agent output MUST pass JSON-Schema validation and referential validation against persisted entities. | P1 | P6 | T+E |
| REQ-063 | An agent referencing a non-existent entity MUST have its output rejected and a guardrail event logged. | P1 | P6 | E |
| REQ-064 | Every agent output MUST include `confidence` and `uncertainty`; omission MUST invalidate the output. (Condition AI-1) | P1 | P6 | E |
| REQ-065 | No agent MUST have access to execute, approve, authorize or audit-mutating capabilities. | P1 | P6/P12 | I+T |
| REQ-066 | The Orchestrator Agent's output MUST be advisory only and MUST NOT trigger a state transition. | P1 | P6 | T |
| REQ-067 | Agent invocations MUST record provider, model, prompt version, inputs, tool calls, results, latency and outcome. | P1 | P6/P13 | T |
| REQ-068 | The LLM provider MUST be replaceable behind an interface without changes to the spine. | P2 | P6 | I |

### 4.7 SAP Integration
| ID | Requirement | Pri | Phase | Ver |
|---|---|---|---|---|
| REQ-070 | Inventory and material master MUST be read through a typed SAP port modelled on published S/4HANA Cloud OData services. | P1 | P7 | T |
| REQ-071 | Every port response MUST carry `data_source` and `fetched_at`. | P1 | P7 | T |
| REQ-072 | A simulated response MUST NEVER be labelled `LIVE_SAP` or `SAP_SANDBOX`. | P1 | P7 | T |
| REQ-073 | The adapter MUST implement timeout, bounded retry and a circuit breaker, degrading to SIMULATED with the badge updated. | P1 | P7 | T |
| REQ-074 | Response mapping MUST be verified against fixtures shaped from published OData metadata. | P1 | P7 | T |
| REQ-075 | No artefact may claim live SAP integration without attached request/response evidence. (Condition SAP-1) | P1 | P7/P13 | I |
| REQ-076 | Credentials MUST come from environment configuration; no secret may be committed. | P1 | P7/P12 | T+I |

### 4.8 Audit
| ID | Requirement | Pri | Phase | Ver |
|---|---|---|---|---|
| REQ-080 | Every significant event MUST append an audit record containing the Master Prompt §14 fields. | P1 | P12 | T |
| REQ-081 | The ledger MUST be hash-chained using canonical serialisation. (Condition DA-1) | P1 | P4/P12 | T |
| REQ-082 | No code path may update or delete an audit record. | P1 | P12 | I+T |
| REQ-083 | Tampering with a persisted record MUST cause chain verification to fail. | P1 | P10 | T |
| REQ-084 | The audit trail MUST be exportable as a self-contained evidence file. | P2 | P12 | D |
| REQ-085 | Audit integrity MUST be described as tamper-evident, never as blockchain or externally notarised. | P1 | P15 | I |

### 4.9 User Interface
| ID | Requirement | Pri | Phase | Ver |
|---|---|---|---|---|
| REQ-090 | The UI MUST provide Dashboard, Network, Incident Center, Scenario Comparison, Approval Center, Agent Activity, Inventory and Audit screens. | P1 | P8 | I+D |
| REQ-091 | The UI MUST comply with `DESIGN.md`; any product-surface token added MUST be an additive, documented extension citing the Known Gaps clause. | P1 | P8 | I |
| REQ-092 | Model-generated text MUST be visually distinguishable from computed values. (Condition PM-1) | P1 | P8 | I |
| REQ-093 | Data-source and data-classification badges MUST be visible wherever derived figures are shown. | P1 | P8 | I |
| REQ-094 | The Approval Center MUST display requested action, reason, evidence, scenarios considered, risk, policy result, required approver and approval state. | P1 | P8 | I |
| REQ-095 | The Agent Activity screen MUST show real invocations including tool calls, rejected outputs and fallbacks. | P1 | P8 | D |
| REQ-096 | Loading, empty, error and degraded states MUST be designed for every screen. | P2 | P8 | I |
| REQ-097 | The interface MUST meet WCAG 2.1 AA contrast for text and provide visible keyboard focus using the `primary-focus` ring. | P2 | P8 | T+I |
| REQ-098 | A first-time user SHOULD be able to identify the current disruption, its impact and the pending decision within ~30 seconds. | P2 | P8 | I |

### 4.10 Data
| ID | Requirement | Pri | Phase | Ver |
|---|---|---|---|---|
| REQ-100 | Every dataset MUST carry a data classification. | P1 | P4 | T |
| REQ-101 | Demo data MUST be SYNTHETIC, generated from a fixed seed, and reproducible. | P1 | P4 | T |
| REQ-102 | The data model MUST represent the flagship scenario completely. | P1 | P4 | I |
| REQ-103 | Inventory MUST be lot-level with expiry dates. | P1 | P4 | T |
| REQ-104 | Suppliers MUST carry per-market qualification status as a CONFIGURABLE RULE. | P1 | P4 | T |
| REQ-105 | No real patient or personal data may be present. | P1 | P4 | I |

---

## 5. Non-Functional Requirements

| ID | Requirement | Pri | Ver |
|---|---|---|---|
| NFR-001 | Deterministic pipeline (ingest → ranked scenarios) completes in < 2 s for the flagship dataset. | P1 | T |
| NFR-002 | The full flagship scenario completes end-to-end in < 5 minutes including human approval. | P1 | D |
| NFR-003 | The system remains functional with the LLM provider disabled; only explanation quality degrades. | P1 | T+D |
| NFR-004 | The flagship scenario produces identical deterministic outputs across 10 consecutive runs. | P1 | T |
| NFR-005 | No secret in source control; configuration via environment with a committed `.env.example`. | P1 | T |
| NFR-006 | Structured logging with correlation IDs across spine, engines, agents and adapter. | P2 | I |
| NFR-007 | All external and agent inputs validated at the boundary; failures return typed errors, never stack traces. | P1 | T |
| NFR-008 | Deterministic core MUST have no dependency on the agent layer (dependency direction enforced). | P1 | I+T |
| NFR-009 | Unit-test coverage of the deterministic core ≥ 80%. | P2 | T |
| NFR-010 | Every requirement in this SRS appears in `docs/traceability.md`. | P1 | I |
| NFR-011 | Documentation MUST match implementation at release; mismatch is a release blocker. | P1 | I |
| NFR-012 | Prompt-injection attempts MUST NOT alter tool allow-lists or produce state transitions. | P1 | E+T |

## 6. Assumptions
A-01 no SAP credentials provisioned · A-02 demo-time SAP connectivity not guaranteed ·
A-03 narrow honest system preferred over broad simulated one · A-04 approver identity is a simulated
role login in MVP, not enterprise SSO · A-05 all pharmaceutical parameters (temperature budgets,
shelf-life, criticality tiers) are SYNTHETIC/CONFIGURABLE and not asserted as real regulation.

## 7. Constraints
`DESIGN.md` is UI authority · deterministic core precedes agent layer · only branch
`arena/01a07bbf-pharma-rerouter` is used · no fabricated regulatory or SAP claims.

## 8. Acceptance
Release acceptance is defined in `docs/acceptance-criteria.md` and gated by Master Prompt §35.
