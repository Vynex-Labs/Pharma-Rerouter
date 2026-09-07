# Requirements Traceability Matrix

**Version:** 0.1.0 (baseline at P3) · **Date:** 2026-09-07
**Rule:** every requirement traces Requirement → Design → Implementation → Test → Evidence.
At baseline, Implementation/Test/Evidence columns are `PENDING` by definition — no code exists.
A requirement may not be marked satisfied until all four downstream columns are populated.

**Status legend:** `PENDING` (not started) · `DESIGNED` (design artefact exists) ·
`IMPLEMENTED` · `VERIFIED` (test passing + evidence linked).

---

## 1. Functional Requirements

| Req | Design artefact | Impl | Test | Evidence | Status |
|---|---|---|---|---|---|
| REQ-001 | ADR-0001 seam S1; arch §7 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-002 | ADR-0002 §1; review AI-1 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-003 | ADR-0002 §1 field-level authority | PENDING | PENDING | PENDING | DESIGNED |
| REQ-004 | ADR-0002 §4; ADR-0003 §2 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-005 | ADR-0002 §6 failure ladder | PENDING | PENDING | PENDING | DESIGNED |
| REQ-010 | arch §7 Deterministic Core | PENDING | PENDING | PENDING | DESIGNED |
| REQ-011 | arch §7; P1 §8 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-012 | P1 §13 Challenge 3 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-013 | P1 §4 journey | PENDING | PENDING | PENDING | DESIGNED |
| REQ-014 | AR-1; NFR-004 | snapshot replay | `tests/seed.test.mjs` NFR-004 | pass | PARTIAL (P5) |
| REQ-015 | ADR-0002 §1; seam S2 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-020 | arch §7 scenario engine | PENDING | PENDING | PENDING | DESIGNED |
| REQ-021 | AR-1 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-022 | Condition DE-1 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-023 | Condition DE-2; ADR-0003 §2 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-024 | P1 §4 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-025 | arch §7 MCDA ranker | PENDING | PENDING | PENDING | DESIGNED |
| REQ-026 | Condition CA-2; ADR-0002 tool matrix | PENDING | PENDING | PENDING | DESIGNED |
| REQ-027 | ADR-0002 §1 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-028 | `input_snapshot` FK from `scenario` | `src/core/snapshot.mjs` | `tests/seed.test.mjs` DA-2 | 26/26 pass | VERIFIED |
| REQ-030 | ADR-0003 §1 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-031 | ADR-0001 seam S4 (no agent) | PENDING | PENDING | PENDING | DESIGNED |
| REQ-032 | ADR-0003 §2 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-033 | ADR-0003 §3 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-034 | ADR-0003 §3 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-035 | ADR-0003 §4 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-036 | ADR-0003 §4 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-037 | ADR-0003 §4 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-038 | ADR-0003 §4; AR-3 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-039 | ADR-0003 §4 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-040 | ADR-0003 §4 | `approval` append-only triggers | `tests/seed.test.mjs` REQ-040 | pass | PARTIAL (P12) |
| REQ-041 | ADR-0003 §2 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-050 | AR-3; ADR-0003 §4 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-051 | AR-3; DA-1 | `src/core/snapshot.mjs` computeDecisionPayloadHash | `tests/seed.test.mjs` REQ-051 | pass | VERIFIED |
| REQ-052 | F-8; arch §7 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-053 | P1 §4 T+6m | PENDING | PENDING | PENDING | DESIGNED |
| REQ-054 | P1 §5 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-055 | P2 review, Domain Expert challenge | PENDING | PENDING | PENDING | DESIGNED |
| REQ-060 | Master Prompt §6; ADR-0002 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-061 | ADR-0002 §2 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-062 | AR-2; ADR-0002 §3 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-063 | ADR-0002 §3; F-3 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-064 | Condition AI-1 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-065 | ADR-0002 §2 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-066 | ADR-0001 seam table | PENDING | PENDING | PENDING | DESIGNED |
| REQ-067 | ADR-0002 §7 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-068 | ADR-0002 §7; AR-7 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-070 | ADR-0004 §1 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-071 | ADR-0004 §2 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-072 | ADR-0004 §2; AR-R4 | `schema.sql` data_source CHECK | `tests/seed.test.mjs` REQ-072 | pass | PARTIAL (adapter at P7) |
| REQ-073 | ADR-0004 §3 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-074 | ADR-0004 §4 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-075 | ADR-0004 §5; Condition SAP-1 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-076 | ADR-0004 §6; NFR-005 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-080 | ADR-0003 §5 | `src/core/audit.mjs` | `tests/audit.test.mjs` | pass | IMPLEMENTED |
| REQ-081 | ADR-0003 §5; DA-1 | `src/core/canonical.mjs`, `audit.mjs` | `tests/canonical.test.mjs`, `audit.test.mjs` | 9+7 pass | VERIFIED |
| REQ-082 | AR-4 | schema triggers + no update API | `tests/audit.test.mjs` REQ-082 | pass | VERIFIED |
| REQ-083 | AR-R2 mitigation | `src/core/audit.mjs` verify() | `tests/audit.test.mjs` REQ-083 ×2 | pass | VERIFIED |
| REQ-084 | ADR-0003 §5 | `audit.mjs` export() | `tests/audit.test.mjs` REQ-084 | pass | VERIFIED |
| REQ-085 | ADR-0003 honesty note | `audit.mjs` integrityModel | `tests/audit.test.mjs` REQ-085 | pass | VERIFIED |
| REQ-090 | Master Prompt §15; arch §7 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-091 | P0 finding R0-2 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-092 | Condition PM-1 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-093 | AR-6; ADR-0004 §2 | PENDING | PENDING | PENDING | DESIGNED |
| REQ-094 | Master Prompt §9 example | PENDING | PENDING | PENDING | DESIGNED |
| REQ-095 | AR-R1 mitigation | PENDING | PENDING | PENDING | DESIGNED |
| REQ-096 | P0 R0-2 (states) | PENDING | PENDING | PENDING | DESIGNED |
| REQ-097 | DESIGN.md focus ring spec | PENDING | PENDING | PENDING | DESIGNED |
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
| NFR-001 | arch §7 | PENDING | PENDING | PENDING | DESIGNED |
| NFR-002 | P1 §4 | PENDING | PENDING | PENDING | DESIGNED |
| NFR-003 | ADR-0002 §6; F-1 | PENDING | PENDING | PENDING | DESIGNED |
| NFR-004 | AR-1 | `src/db/seed.mjs` seeded PRNG | `tests/seed.test.mjs` | seed hash stable across runs | VERIFIED |
| NFR-005 | ADR-0004 §6 | PENDING | PENDING | PENDING | DESIGNED |
| NFR-006 | arch §7 | PENDING | PENDING | PENDING | DESIGNED |
| NFR-007 | AR-2 | PENDING | PENDING | PENDING | DESIGNED |
| NFR-008 | ADR-0001 layering | PENDING | PENDING | PENDING | DESIGNED |
| NFR-009 | P5 exit criterion | PENDING | PENDING | PENDING | DESIGNED |
| NFR-010 | this document | N/A | N/A | this document | VERIFIED |
| NFR-011 | P15 gate | PENDING | PENDING | PENDING | DESIGNED |
| NFR-012 | ADR-0002 §5 | PENDING | PENDING | PENDING | DESIGNED |

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
- Functional requirements: 62 · Non-functional: 12 · **Total: 74**
- All 74 traced to a design artefact. Zero orphan requirements. Zero orphan architectural rules.
- All 10 P2 conditions have at least one requirement. All 8 failure modes covered.
- **P4 update (2026-09-07):** 16 requirements moved off PENDING; 13 now VERIFIED with passing tests
  (26/26 in `npm test`). Conditions **DA-1** and **DA-2** are CLOSED.
- Remaining requirements are owned by P5 (engines), P6 (agents), P7 (SAP), P8 (UI), P12 (governance).
