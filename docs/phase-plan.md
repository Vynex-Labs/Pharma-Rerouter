# Phase Plan, Dependencies, Approval Authorities and Gate Status

**Maintained by:** Master Orchestrator · **Version:** 0.1.0 · **Date:** 2026-09-07
This is the single source of truth for phase status. A phase is `PASSED` only when deliverables are
complete, acceptance criteria are satisfied, verification evidence exists, required approvers have
signed, and no Critical/High blocker it owns remains open (Master Prompt §21).

---

## 1. Current Gate Status

| Phase | Name | Depends on | Status | Primary approver | Supporting |
|---|---|---|---|---|---|
| P0 | Repository Reconnaissance | — | **PASSED** | Master Orchestrator | Architecture/Engineering |
| P1 | Problem Definition | P0 | **PASSED** | Product Manager | Domain Expert |
| P2 | Architecture | P1 | **PASSED (with conditions)** | System Architect | AI Architect, SAP Strategy, Master Orchestrator |
| P3 | Requirements | P2 | **PASSED** | Requirements Manager | Product Manager, System Architect |
| P4 | Data Architecture | P3 | **PASSED** | Data Architect | Backend, Domain Expert |
| P5 | Deterministic Core | P4 | **PASSED** | Optimization Engineer | Backend, QA |
| P6 | AI / Agent Layer | P5 | **COMPLETE** (APR-P6-001) | AI Architect | AI Evaluation, Safety/Governance |
| P7 | SAP Integration | P2, P3, P4 | **COMPLETE WITH CONDITION** (APR-P7-001) | SAP Integration Engineer | SAP Strategy, System Architect |
| P8 | UI / UX | P2, P3 | **COMPLETE** (APR-P8-001) | UI/UX Designer | Visual QA, Product Manager |
| P9 | End-to-End Integration | P5, P6, P7, P8 | **COMPLETE** (APR-P9-001) | Master Orchestrator | Backend, Frontend, QA |
| P10 | Testing | P9 | **NOT STARTED** (unblocked — next) | QA Engineer | Master Orchestrator |
| P11 | AI Evaluation | P6, P9 | **NOT STARTED** (unblocked) | AI Evaluation Engineer | AI Architect, Safety/Governance |
| P12 | Security & Governance | P2, P6, P7, P9 | **NOT STARTED** (unblocked) | Security Engineer | Safety/Governance, System Architect |
| P13 | Independent Audit | P10, P11, P12 | NOT STARTED | Independent Auditor | (findings not alterable by Orchestrator) |
| P14 | Red Team | P13 | NOT STARTED | Red Team | Independent Auditor, Security |
| P15 | Documentation & Records | P13, P14 | NOT STARTED | Engineering Records Manager | Master Orchestrator |
| P16 | Business Validation | P9, P10, P15 | NOT STARTED | Business Strategy Analyst | Product Manager, Domain Expert |
| P17 | Competition Review | P16 | NOT STARTED | Competition Analyst | Product, SAP, Technical leads |
| P18 | Demo Design | P9, P16, P17 | NOT STARTED | Demo Experience Designer | QA, Master Orchestrator |
| P19 | Pitch Strategy | P17, P18 | NOT STARTED | Pitch Strategist | Competition Analyst |
| P20 | Presentation | P19 | NOT STARTED | PPT Designer | Pitch Strategist, Competition Analyst |
| P21 | Final Release | P10–P20 | NOT STARTED | Master Orchestrator | Auditor, Security, Governance, SAP, QA |

**Critical path (P0–P9 done):** {P10 ∥ P11 ∥ P12} → P13 → P14 → P15 → P16 → P17 → P18 → P19 → P20 → P21.

## 2. Permitted Parallelism (Master Prompt §20)
- **P8 (UI/UX)** may start now — its dependencies P2 and P3 have both passed. It must not consume
  unstable API contracts; it works against the typed contracts defined in P4.
- **P7 (SAP)** may start as soon as P4 passes, in parallel with P5/P6.
- **P10, P11, P12** may run in parallel after P9 — they validate different dimensions.
- No downstream phase may consume an artefact whose producing phase has not passed its gate.

## 3. Open Conditions Blocking Future Gates
Carried from `docs/P2-architecture-review.md`. A phase may not pass while holding an open condition.

| Condition | Owner | Status |
|---|---|---|
| PM-1 computed vs generated text visually distinct | P8 | **CLOSED** (APR-P8-001) |
| DE-1 cold-chain feasibility is a hard gate | P5 | **CLOSED** (APR-P5-001) |
| DE-2 supplier qualification can BLOCK | P5 | **CLOSED** (APR-P5-001) |
| AI-1 confidence + uncertainty mandatory | P6 | **CLOSED** (APR-P6-001) |
| AI-2 invalid agent output rejected (proven by eval) | P11 | OPEN |
| DA-1 canonical serialisation for hashing | P4 | **CLOSED** (APR-P4-001) |
| DA-2 scenarios persist input snapshot | P4 | **CLOSED** (APR-P4-001) |
| SAP-1 no integration claim without evidence | P7 | **OPEN BY DESIGN** — no unsupported claim exists anywhere (APR-P7-001); closes only when a redacted real request/response is attached |
| SAP-2 fallback shown deliberately in demo | P18 | OPEN |
| CA-2 scenario intents genuinely drive generation | P6 | **CLOSED** (APR-P6-001) |

## 4. Blocked-Phase Register (Master Prompt §26)
None currently. Entries require: blocked phase, blocking dependency, reason, impact, owner,
resolution required.

## 5. Risk Register (consolidated)
| ID | Risk | Sev | Owner phase | Status |
|---|---|---|---|---|
| R-01 | Scope explosion across 22 phases | HIGH | P1 | MITIGATED — single flagship scenario (D1-1) |
| R-02 | Faked SAP integration | CRITICAL | P7 | MITIGATED BY DESIGN — ADR-0004 §5 language contract |
| R-03 | DESIGN.md is marketing, product needs status semantics | HIGH | P8 | OPEN — additive extension planned |
| R-04 | LLM originating authoritative numbers | CRITICAL | P5/P6 | MITIGATED BY DESIGN — ADR-0002 §1 |
| R-05 | No `.gitignore` | MEDIUM | P4 | **CLOSED** — `.gitignore` + `.env.example` added |
| R-06 | Demo fails without live LLM | HIGH | P18 | MITIGATED BY DESIGN — NFR-003 fallback |
| R0-3 | Proprietary fonts unavailable | MEDIUM | P8 | OPEN — open-source substitute permitted |
| AR-R1 | Agents look decorative | MEDIUM | P6/P8 | OPEN — condition CA-2 |
| AR-R2 | Hash chain never verified | MEDIUM | P10 | **CLOSED** — `tests/audit.test.mjs` REQ-083 ×2 |
| AR-R3 | Policy becomes an if-ladder | MEDIUM | P12 | OPEN — REQ-041 |
| AR-R4 | Silent SAP fallback presented as live | HIGH | P7 | OPEN — REQ-072 |

## 6. Change Propagation Procedure (Master Prompt §27)
Any change to a requirement, the architecture, the data model, an agent contract, the SAP integration
or a major UI workflow must: identify affected phases, requirements, artefacts and tests; invalidate
stale approvals; re-verify; re-approve; update `SRS.md`, `traceability.md`, the relevant ADR and
`changelog.md`. Architectural changes require a superseding ADR.

## 7. Definition of Done (per phase)
1. Universal phase output package (Master Prompt §18.1) written to `docs/`.
2. Phase-specific mandatory outputs produced.
3. Acceptance criterion explicitly evaluated with evidence.
4. Approval record appended to `docs/approvals.md`.
5. `traceability.md` updated for affected requirements.
6. This table updated.
