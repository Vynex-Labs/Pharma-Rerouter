# Requirements Traceability Matrix

**Version:** 0.4.0 (updated at P6/P7/P8) · **Date:** 2026-09-07
**Rule:** every requirement traces Requirement → Design → Implementation → Test → Evidence.
At baseline, Implementation/Test/Evidence columns are `PENDING` by definition — no code exists.
A requirement may not be marked satisfied until all four downstream columns are populated.

**Status legend:** `PENDING` (not started) · `DESIGNED` (design artefact exists) ·
`IMPLEMENTED` · `VERIFIED` (test passing + evidence linked).

---

## 1. Functional Requirements

| Req | Design artefact | Impl | Test | Evidence | Status |
|---|---|---|---|---|---|
| REQ-001 | ADR-0001 seam S1; arch §7 | `src/agents/index.mjs` senseDisruption | `tests/agents.test.mjs` S1 | classification PORT_CLOSURE/CRITICAL from advisory | VERIFIED |
| REQ-002 | ADR-0002 §1; review AI-1 | `src/agents/schemas.mjs` | `tests/agents.test.mjs` AI-1 | confidence+uncertainty required on every path | VERIFIED |
| REQ-003 | ADR-0002 §1 field-level authority | `schemas.mjs` forbidden-key check | `tests/agents.test.mjs` AR-1 | no numeric supply-chain field exists | VERIFIED |
| REQ-004 | ADR-0002 §4; ADR-0003 §2 | `runtime.mjs` wrapUntrusted | `tests/agents.test.mjs` injection | SYSTEM OVERRIDE payload changes nothing | VERIFIED |
| REQ-005 | ADR-0002 §6 failure ladder | `runtime.mjs` runAgent | `tests/agents.test.mjs` ladder ×4 | error→1 attempt, malformed→2, empty→fallback | VERIFIED |
| REQ-010 | arch §7 Deterministic Core | `src/core/network.mjs`, `impact.mjs` | `tests/core.test.mjs` REQ-010 | pass | VERIFIED |
| REQ-011 | arch §7; P1 §8 | `src/core/inventory.mjs` | `tests/core.test.mjs` REQ-011 | pass | VERIFIED |
| REQ-012 | P1 §13 Challenge 3 | `inventory.mjs` usableQuantity | `tests/core.test.mjs` REQ-012 ×2 | write-off 15,800 units at WH-CENTRAL | VERIFIED |
| REQ-013 | P1 §4 journey | `impact.mjs` baseline; `scenarios.mjs` buildDoNothing | `tests/core.test.mjs` REQ-013 ×2 | baseline ranks last | VERIFIED |
| REQ-014 | AR-1; NFR-004 | pure functions over frozen snapshot | `tests/core.test.mjs` REQ-014 | identical across runs | VERIFIED |
| REQ-015 | ADR-0002 §1; seam S2 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-020 | arch §7 scenario engine | `src/core/scenarios.mjs` | `tests/core.test.mjs` REQ-020 | 5 scenarios | VERIFIED |
| REQ-021 | AR-1 | `scoring.mjs` cost + risk | `tests/core.test.mjs` risk scoring | pass | VERIFIED |
| REQ-022 | Condition DE-1 | `constraints.mjs` checkColdChain | `tests/core.test.mjs` DE-1 ×3 | ALT_PORT INFEASIBLE 14h>12h | VERIFIED |
| REQ-023 | Condition DE-2; ADR-0003 §2 | `constraints.mjs` checkSupplierQualification | `tests/core.test.mjs` DE-2 ×3 | ALT_SUPPLIER BLOCKED (EU) | VERIFIED |
| REQ-024 | P1 §4; REQ-024 | `scoring.mjs`; `persist.mjs` persistScenarios | `tests/pipeline.test.mjs` REQ-024 | excluded options stored with reasons | VERIFIED |
| REQ-025 | arch §7 MCDA ranker | `scoring.mjs` DEFAULT_MCDA_WEIGHTS | `tests/core.test.mjs` REQ-025 | weights visible + breakdown | VERIFIED |
| REQ-026 | Condition CA-2; ADR-0002 tool matrix | `scenarios.mjs` strategyIntents + `agents/index.mjs` proposeStrategies | `tests/core.test.mjs` CA-2 ×2; `tests/agents.test.mjs` CA-2 | omitting ALT_PORT removes it from the candidate set; computed figures byte-identical | VERIFIED |
| REQ-027 | ADR-0002 §1 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-028 | `input_snapshot` FK from `scenario` | `src/core/snapshot.mjs` | `tests/seed.test.mjs` DA-2 | pass | VERIFIED |
| REQ-030 | ADR-0003 §1 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-031 | ADR-0001 seam S4 (no agent) | PENDING | PENDING | PENDING | DESIGNED |
| REQ-032 | ADR-0003 §2 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-033 | ADR-0003 §3 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-034 | ADR-0003 §3 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-035 | ADR-0003 §4 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-036 | ADR-0003 §4 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-037 | ADR-0003 §4 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-038 | ADR-0003 §4; AR-3 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-039 | ADR-0003 §4 | `statemachine.mjs` TRANSITIONS | `tests/pipeline.test.mjs` REQ-039 | REJECTED/BLOCKED reach only SEALED | VERIFIED |
| REQ-040 | ADR-0003 §4 | `approval` append-only triggers | `tests/seed.test.mjs` REQ-040 | pass | PARTIAL (P12) |
| REQ-041 | ADR-0003 §6 | `pipeline.mjs` policy_evaluation insert | `tests/pipeline.test.mjs` REQ-041 | policy_version persisted | VERIFIED |
| REQ-050 | ADR-0003 §3 | `execution.mjs` mintAuthorization | `tests/pipeline.test.mjs` REQ-050 | mint refused unless APPROVED | VERIFIED |
| REQ-051 | ADR-0003 §3; DA-1 | `execution.mjs` validateAuthorization | `tests/pipeline.test.mjs` REQ-051 | HASH_MISMATCH on changed input | VERIFIED |
| REQ-052 | F-8; ADR-0005 | `execution.mjs` single-use + row versions | `tests/pipeline.test.mjs` REQ-052 ×2 | replay rejected; stale write rejected | VERIFIED |
| REQ-053 | P1 §4 | `execution.mjs` verifyRecovery; `impact.mjs` countInbound | `tests/pipeline.test.mjs` REQ-053, D9-2 | measured against scenario prediction; 4->1 | VERIFIED |
| REQ-054 | P1 §4 | `execution.mjs` verifyRecovery | `tests/pipeline.test.mjs` REQ-054 | RECOVERY_OBJECTIVE_MISSED audited | VERIFIED |
| REQ-055 | Master Prompt §30 | `execution.mjs` simulated envelope; UI badge | `tests/pipeline.test.mjs` REQ-055 | carrierContacted=false recorded | VERIFIED |
| REQ-060 | Master Prompt §6; ADR-0002 | `src/agents/index.mjs` 6 seams | `tests/agents.test.mjs` | 24 tests pass | VERIFIED |
| REQ-061 | ADR-0002 §2 | `runtime.mjs` AGENT_TOOL_GRANTS | `tests/agents.test.mjs` REQ-061 | grants ≤3 tools, frozen | VERIFIED |
| REQ-062 | AR-2; ADR-0002 §3 | `runtime.mjs` ScopedTools | `tests/agents.test.mjs` REQ-062 | out-of-grant call rejected | VERIFIED |
| REQ-063 | ADR-0002 §3; F-3 | `runtime.mjs` buildToolRegistry | `tests/agents.test.mjs` REQ-063 | server-side allow-list | VERIFIED |
| REQ-064 | Condition AI-1 | `schemas.mjs` validators | `tests/agents.test.mjs` REQ-064 | blank uncertainty rejected | VERIFIED |
| REQ-065 | ADR-0002 §2 | `runtime.mjs` FORBIDDEN_CAPABILITIES | `tests/agents.test.mjs` REQ-065 | 7 capabilities absent from registry | VERIFIED |
| REQ-066 | ADR-0001 seam table | `index.mjs` orchestratorAdvice | `tests/agents.test.mjs` REQ-066 | canTransitionState=false | VERIFIED |
| REQ-067 | ADR-0002 §7 | `runtime.mjs` persist() | `tests/agents.test.mjs` REQ-095 | every invocation recorded | VERIFIED |
| REQ-068 | ADR-0002 §7; AR-7 | `index.mjs` advisory only | `tests/agents.test.mjs` REQ-066 | no write path to state | VERIFIED |
| REQ-070 | ADR-0004 §1 | `src/sap/adapter.mjs` SERVICES | `tests/sap.test.mjs` REQ-070 | documented OData paths | VERIFIED |
| REQ-071 | ADR-0004 §2 | `adapter.mjs` envelope | `tests/sap.test.mjs` REQ-071 | dataSource+fetchedAt always present | VERIFIED |
| REQ-072 | ADR-0004 §2; AR-R4 | `adapter.mjs` mode downgrade | `tests/sap.test.mjs` REQ-072 ×2 | LIVE_SAP without key → SIMULATED | VERIFIED |
| REQ-073 | ADR-0004 §3 | `adapter.mjs` CircuitBreaker | `tests/sap.test.mjs` REQ-073 ×3 | degrades honestly, breaker opens | VERIFIED |
| REQ-074 | ADR-0004 §4 | `adapter.mjs` mapMaterialStock | `tests/sap.test.mjs` REQ-074 ×2 | V2 and V4 shapes mapped | VERIFIED |
| REQ-075 | ADR-0004 §5; Condition SAP-1 | `adapter.mjs` describe() | `tests/sap.test.mjs` SAP-1 | forbidden phrasings absent | VERIFIED |
| REQ-076 | ADR-0004 §6; NFR-005 | `adapter.mjs` adapterFromEnv | `tests/sap.test.mjs` REQ-076 | no hard-coded credentials | VERIFIED |
| REQ-080 | ADR-0003 §5 | `src/core/audit.mjs` | `tests/audit.test.mjs` | pass | IMPLEMENTED |
| REQ-081 | ADR-0003 §5; DA-1 | `src/core/canonical.mjs`, `audit.mjs` | `tests/canonical.test.mjs`, `audit.test.mjs` | 9+7 pass | VERIFIED |
| REQ-082 | AR-4 | schema triggers + no update API | `tests/audit.test.mjs` REQ-082 | pass | VERIFIED |
| REQ-083 | AR-R2 mitigation | `src/core/audit.mjs` verify() | `tests/audit.test.mjs` REQ-083 ×2 | pass | VERIFIED |
| REQ-084 | ADR-0003 §5 | `audit.mjs` export() | `tests/audit.test.mjs` REQ-084 | pass | VERIFIED |
| REQ-085 | ADR-0003 honesty note | `audit.mjs` integrityModel | `tests/audit.test.mjs` REQ-085 | pass | VERIFIED |
| REQ-090 | Master Prompt §15; arch §7 | `src/ui/public/app.js` 8 screens | `tests/ui.test.mjs` REQ-090 | all pages render >100 chars | VERIFIED |
| REQ-091 | P0 finding R0-2 | `src/ui/tokens.mjs`; `docs/design-extension.md` | `tests/design.test.mjs` REQ-091 ×2 | every base token verbatim in DESIGN.md | VERIFIED |
| REQ-092 | Condition PM-1 | `app.js` generated() | `tests/design.test.mjs`, `tests/ui.test.mjs` | prose never escapes provenance block | VERIFIED |
| REQ-093 | AR-6; ADR-0004 §2 | `app.js` badges; `tokens.mjs` statusOf | `tests/ui.test.mjs` REQ-093 | SIMULATED badge always shown | VERIFIED |
| REQ-094 | Master Prompt §9 example | `app.js` scenarios screen | `tests/ui.test.mjs` REQ-024 | excluded options keep reasons | VERIFIED |
| REQ-095 | AR-R1 mitigation | `app.js` agents screen; `runtime.mjs` | `tests/ui.test.mjs` REQ-095; `agents.test.mjs` | fallback_reason shown, never UNEXPLAINED | VERIFIED |
| REQ-096 | P0 R0-2 (states) | `tokens.mjs` STATUS | `tests/design.test.mjs` | status semantics documented + tested | VERIFIED |
| REQ-097 | DESIGN.md focus ring spec | `app.css` :focus-visible; `tokens.mjs` | `tests/design.test.mjs` REQ-097 ×3 | all contrast ≥4.5:1; labels never colour-only | VERIFIED |
| REQ-098 | P8 acceptance criterion | PENDING | PENDING | PENDING | DESIGNED |
| REQ-100 | Master Prompt §12 | `schema.sql` data_classification | `tests/seed.test.mjs` REQ-100 | pass | VERIFIED |
| REQ-101 | P1 §8 | `src/db/seed.mjs` mulberry32 | `tests/seed.test.mjs` REQ-101 | pass | VERIFIED |
| REQ-102 | P4 acceptance criterion | `src/db/seed.mjs` | `tests/seed.test.mjs` REQ-102 + non-trivial | pass | VERIFIED |
| REQ-103 | P1 §13 Challenge 3 | `inventory_lot.expiry_date` | `tests/seed.test.mjs` REQ-103 | pass | VERIFIED |
| REQ-104 | P1 §13 Challenge 2 | `supplier_product.qualified_markets` | `tests/seed.test.mjs` REQ-104 | pass | VERIFIED |
| REQ-105 | P1 §7 non-goals | schema (no person entity) | `tests/seed.test.mjs` REQ-105 | pass | VERIFIED |

## 2. Non-Functional Requirements

| Req | Design artefact | Impl | Test | Evidence | Status |
|---|---|---|---|---|---|
| NFR-001 | arch §7 | core pipeline | `tests/core.test.mjs` NFR-001 | < 2 s measured | VERIFIED |
| NFR-002 | P1 §4 | PENDING | PENDING | PENDING | DESIGNED |
| NFR-003 | ADR-0002 §6; F-1 | core has zero agent imports; `runtime.mjs` fallback ladder | `core.test.mjs` + `agents.test.mjs` ladder | full pipeline completes with a failing provider | VERIFIED |
| NFR-004 | AR-1 | `src/db/seed.mjs` seeded PRNG | `tests/seed.test.mjs` | seed hash stable across runs | VERIFIED |
| NFR-005 | ADR-0004 §6 | PENDING | PENDING | PENDING | DESIGNED |
| NFR-006 | arch §7 | PENDING | PENDING | PENDING | DESIGNED |
| NFR-007 | AR-2 | `schemas.mjs` ValidationError kinds; `server.mjs` typed handler | `agents.test.mjs`; live 500 on D8-3 returned typed JSON | no stack trace reaches the client | VERIFIED |
| NFR-008 | ADR-0001 layering | `src/core/*` imports nothing from agents | inspection + offline test run | pass | VERIFIED |
| NFR-009 | P5 exit criterion | PENDING | PENDING | PENDING | DESIGNED |
| NFR-010 | this document | N/A | N/A | this document | VERIFIED |
| NFR-011 | P15 gate | PENDING | PENDING | PENDING | DESIGNED |
| NFR-012 | ADR-0002 §5 | `runtime.mjs` wrapUntrusted + ScopedTools | `agents.test.mjs` injection | privileged instructions in advisory text change nothing | VERIFIED |

## 3. Architectural Rules → Requirements
Confirms every AR from `architecture.md` §8 is testable (handoff obligation from P2).

| Rule | Covered by |
|---|---|
| AR-1 no LLM authoritative numbers | REQ-003, 015, 021, 027 |
| AR-2 schema + referential validation | REQ-062, 063, NFR-007 |
| AR-3 execution authorization / staleness | REQ-050, 051, 038 |
| AR-4 append-only hash-chained ledger | REQ-081, 082, 083 |
| AR-5 untrusted content containment | REQ-061, NFR-012 |
| AR-6 data classification & source | REQ-071, 093, 100 |
| AR-7 provider abstraction | REQ-068 |

## 4. P2 Conditions → Requirements
| Condition | Owner phase | Requirement(s) |
|---|---|---|
| PM-1 | P8 | REQ-092 |
| DE-1 | P5 | REQ-022 |
| DE-2 | P5 | REQ-023 |
| AI-1 | P6 | REQ-064 |
| AI-2 | P11 | REQ-062, 063 |
| DA-1 | P4 | REQ-081, 051 |
| DA-2 | P4 | REQ-028 |
| SAP-1 | P7 | REQ-075 |
| SAP-2 | P18 | REQ-072, 093 |
| CA-2 | P6 | REQ-026 |

## 5. P1 Failure Modes → Requirements
| Failure | Requirement(s) |
|---|---|
| F-1 LLM unavailable | REQ-005, NFR-003 |
| F-2 malformed output | REQ-062, 005 |
| F-3 invented entity | REQ-063 |
| F-4 ambiguous signal | REQ-002, 004 |
| F-5 data changed post-approval | REQ-038, 051 |
| F-6 prompt injection | REQ-061, NFR-012 |
| F-7 SAP unreachable | REQ-073, 072 |
| F-8 concurrent approvers | REQ-052 |

## 6. Coverage Summary
- Functional requirements: **75** · Non-functional: **12** · **Total: 87**
- All 87 traced to a design artefact, verified by set comparison against `docs/SRS.md`:
  zero requirements in the SRS are missing from this matrix, and zero rows here are absent from the
  SRS. Zero orphan architectural rules.

> **Correction (P8):** this summary previously read "62 functional / total 74". That count was
> wrong from the P3 baseline onward — the SRS has always contained 75 functional requirements.
> The matrix rows themselves were complete and correct; only the summary arithmetic was wrong.
> The count is now derived by comparing the two documents rather than asserted by hand.
- All 10 P2 conditions have at least one requirement. All 8 failure modes covered.
- **P4 update (2026-09-07):** 16 requirements moved off PENDING; 13 now VERIFIED with passing tests
  (26/26 in `npm test`). Conditions **DA-1** and **DA-2** are CLOSED.
- **P5 update (2026-09-07):** 13 further requirements VERIFIED (54/54 tests). Conditions **DE-1** and **DE-2** CLOSED.
- **P6/P7/P8 update (2026-09-07):** 31 further requirements VERIFIED (**110/110 tests**).
  Conditions **AI-1**, **CA-2** (APR-P6-001) and **PM-1** (APR-P8-001) CLOSED.
  **SAP-1 remains OPEN BY DESIGN** — REQ-075 is VERIFIED in the sense that no unsupported claim
  exists and a test enforces that, but connectivity itself is unverified and is not claimed.

### Status counts after P9
| Status | Count |
|---|---|
| VERIFIED | 68 |
| IMPLEMENTED | 1 |
| PARTIAL | 1 (REQ-040, completes at P12) |
| DESIGNED (not started) | 17 |
| **Total** | **87** |

- **P9 update (2026-09-07):** 9 further requirements VERIFIED (**134/134 tests**). The full flow
  runs DETECTED -> SEALED with a valid hash chain. No condition is owned by P9.
- Remaining requirements are owned by P10 (testing), P11 (AI evaluation),
  P12 (governance/approval capture), P13+ (audit, red team, demo).
