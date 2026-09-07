# Phase Approval Records

Approval evidence per Master Prompt §23. Decisions: `APPROVED`, `APPROVED_WITH_CONDITIONS`,
`REJECTED`, `BLOCKED`. Approvers are **role-based authorities**, not fictional individuals.
A conditional approval is never treated as unconditional release approval.

---

## APR-P0-001

| Field | Value |
|---|---|
| Phase | P0 — Repository Reconnaissance |
| Phase version | 1.0 |
| Approver role | Master Orchestrator |
| Supporting review | System Architect / Engineering |
| Date/time | 2026-09-07 (UTC) |
| Decision | **APPROVED** |
| Acceptance criteria reviewed | "Team understands what already exists before modifying it" |
| Evidence reviewed | Full filesystem enumeration (3 files); complete read of `DESIGN.md`; git history (1 commit); toolchain probe; secret scan of all files |
| Outstanding issues | R0-2 (HIGH, design-system conflict) and R0-3 (MEDIUM, fonts) — both deferred to P8 with a defined resolution path; neither affects P1 |
| Risk assessment | Acceptable. Greenfield baseline means no legacy constraints and no risk of overwriting prior work. |
| Conditions | None |
| Linked artefacts | `docs/P0-repository-reconnaissance.md`, `DESIGN.md` |
| Linked tests | N/A (no code exists) |
| Linked requirements | Seeds REQ-091 (design compliance), REQ-097 (accessibility) |
| Linked findings | R0-1, R0-2, R0-3; risks R-01…R-06 |
| Comments | Reconnaissance is complete and honest about the emptiness of the repository. The one substantive artefact, `DESIGN.md`, was read in full and reduced to binding constraints rather than skimmed. |

---

## APR-P1-001

| Field | Value |
|---|---|
| Phase | P1 — Problem Definition |
| Phase version | 1.0 |
| Approver role | Product Manager |
| Supporting review | Pharmaceutical Supply-Chain Domain Expert |
| Date/time | 2026-09-07 (UTC) |
| Decision | **APPROVED_WITH_CONDITIONS** |
| Acceptance criteria reviewed | "Problem can be explained in one precise paragraph" — satisfied (§1) |
| Evidence reviewed | Problem statement; 5 personas with distinct decision authorities; primary journey and counter-journey; failure modes F-1…F-8; KPIs K-1…K-8; scope and non-goals; flagship scenario rationale |
| Outstanding issues | Pharmaceutical/regulatory claims remain uncited |
| Risk assessment | R-01 (scope) mitigated by the single-flagship-scenario decision. Residual risk that the scenario is still too large is passed to P2 to constrain. |
| **Conditions** | **(C1)** No uncited pharmaceutical, clinical or regulatory claim may appear in the UI, README or deck; such claims must be cited by P16 or removed. **(C2)** The three Domain-Expert challenges (cold-chain feasibility as a gate, per-market supplier qualification, shelf-life netting) are binding on P4/P5 and are not negotiable down to "soft cost terms". |
| Linked artefacts | `docs/P1-problem-definition.md` |
| Linked tests | N/A at this phase |
| Linked requirements | REQ-012, REQ-022, REQ-023, REQ-103, REQ-104 (from C2); REQ-085 (from C1) |
| Linked findings | Domain-Expert challenges 1–3 (§13) |
| Comments | The Domain Expert's challenges materially changed the design rather than being recorded and ignored; that is the intended function of the adversarial review. The counter-journey (rejected recommendation) being made a first-class requirement is what distinguishes this from a demo script. |

---

## APR-P2-001

| Field | Value |
|---|---|
| Phase | P2 — Architecture |
| Phase version | 1.0 |
| Approver role | System Architect (primary) |
| Supporting review | AI Architect, SAP Strategy Specialist, Master Orchestrator; plus Product Manager, Domain Expert, Data Architect, Competition Analyst evaluations |
| Date/time | 2026-09-07 (UTC) |
| Decision | **APPROVED_WITH_CONDITIONS** |
| Acceptance criteria reviewed | "Architecture is technically, commercially, SAP and agentically defensible" |
| Evidence reviewed | Three genuinely distinct architectures differing in locus of control; 13-criterion weighted matrix (A=148, B=200, C=240/275); mapping of every P1 failure mode to an architectural mechanism; SAP capability verification with public-source citations; six independent role evaluations with recorded dissent |
| Outstanding issues | AR-R1 (agents may appear decorative), AR-R2, AR-R3, AR-R4 |
| Risk assessment | Principal residual risk is AR-R1 — the honest weakness identified by the Competition Analyst. Mitigated by condition CA-2 but not eliminated until P6 demonstrates that scenario intents change generated output. |
| **Conditions** | PM-1 (P8), DE-1 (P5), DE-2 (P5), AI-1 (P6), AI-2 (P11), DA-1 (P4), DA-2 (P4), SAP-1 (P7), SAP-2 (P18), CA-2 (P6). Each is assigned an owning phase; no owning phase may pass while its condition is open. |
| Linked artefacts | `docs/architecture.md`, `docs/P2-architecture-review.md`, ADR-0001…ADR-0004 |
| Linked tests | Deferred: REQ-062/063 (P11), REQ-083 (P10), REQ-072 (P7) |
| Linked requirements | All 74 in `docs/SRS.md`; architectural rules AR-1…AR-7 mapped in `traceability.md` §3 |
| Linked findings | AR-R1…AR-R4; CA-1 |
| Comments | Architecture C was selected unanimously but not uncritically. The decision that seam S4 (policy evaluation) has **no agent** is the load-bearing choice: it is what makes governance structural rather than prompt-dependent. The Competition Analyst's CA-1 concern ("your agents are just fancy summarisers") is recorded as a fair criticism rather than dismissed, and condition CA-2 exists specifically to make it untrue. |

---

## APR-P3-001

| Field | Value |
|---|---|
| Phase | P3 — Requirements |
| Phase version | 0.1.0 |
| Approver role | Requirements Manager |
| Supporting review | Product Manager, System Architect |
| Date/time | 2026-09-07 (UTC) |
| Decision | **APPROVED** |
| Acceptance criteria reviewed | "Every major requirement maps to design and future verification" |
| Evidence reviewed | `SRS.md` (62 functional + 12 non-functional requirements, each with priority, owning phase and verification method); `traceability.md` showing 74/74 requirements traced to a design artefact, 7/7 architectural rules covered, 10/10 P2 conditions covered, 8/8 failure modes covered, zero orphans |
| Outstanding issues | Implementation/Test/Evidence columns are 0% populated |
| Risk assessment | Low. The empty downstream columns are correct at baseline; the risk is only that they are not maintained, which the P4+ Definition of Done addresses. |
| Conditions | None. (Note: the P2 conditions remain open against their own owning phases; they are not P3's to close.) |
| Linked artefacts | `docs/SRS.md`, `docs/traceability.md` |
| Linked tests | None yet — by design |
| Linked requirements | REQ-001…REQ-105, NFR-001…NFR-012 |
| Linked findings | None new |
| Comments | Approved specifically because the traceability matrix demonstrates *coverage of the conditions and failure modes*, not merely a list of requirements. NFR-010 (every requirement appears in the matrix) is self-verifying and is the only requirement currently marked VERIFIED — correctly so. |

---

## Pending
No approval records exist for P4–P21. P4 is unblocked and is the next phase.

---

## APR-P4-001

| Field | Value |
|---|---|
| Phase | P4 — Data Architecture |
| Phase version | 1.0 |
| Approver role | Data Architect (primary) |
| Supporting review | Backend Engineer, Domain Expert |
| Date/time | 2026-09-07 (UTC) |
| Decision | **APPROVED** |
| Acceptance criteria reviewed | "Flagship disruption can be represented completely" — satisfied; every element of P1 §8 maps to a table, verified by `tests/seed.test.mjs` REQ-102 |
| Evidence reviewed | `docs/data-model.md`; `src/db/schema.sql` (22 tables, STRICT typing, append-only triggers); `src/core/canonical.mjs`; `src/core/audit.mjs`; `src/core/snapshot.mjs`; `src/db/seed.mjs`; **26/26 tests passing**; reproducible seed hash `673d8f1e…7cdaa2` (**superseded** — see note below) |
| Conditions closed | **DA-1** — canonical serialisation specified and tested (key order, timezone, float, null/undefined, non-finite rejection). **DA-2** — `input_snapshot` implemented; scenarios and authorizations bind to `snapshot_hash`. |
| Outstanding issues | REQ-072 and REQ-040 are PARTIAL pending P7/P12; `REQ-014` full determinism awaits the P5 engines |
| Risk assessment | Acceptable. AR-R2 (hash chain never verified) is now **CLOSED** — two tests prove that mutating a payload or a chain hash is detected and the offending record is named. |
| Linked artefacts | `docs/data-model.md`, `docs/ADR/0005-technology-stack.md`, `src/db/*`, `src/core/*`, `tests/*` |
| Linked tests | `tests/canonical.test.mjs` (9), `tests/audit.test.mjs` (7), `tests/seed.test.mjs` (10) |
| Linked requirements | REQ-014, 028, 040, 051, 072, 080–085, 100–105, NFR-004 |
| Linked findings | Three test failures found and resolved during verification — see Comments |
| Comments | Two of the three initial test failures were **the system working correctly**: the append-only triggers blocked the tamper attempt, which meant the hash chain itself was never being exercised. The test was rewritten to explicitly drop the triggers first — simulating an attacker who already has raw file access — because that is the only honest way to test defence two, and it is exactly the threat model ADR-0003 claims to address (tamper-*evident*, not tamper-*proof*). The third failure was a test asserting `throws` against an empty table, which would have passed for the wrong reason; it was replaced with a schema-level assertion. A separate correction was recorded in ADR-0005 after the pinned `better-sqlite3` range turned out to have no prebuild for Node 22 — the original probe had not pinned a version, so it verified something different from what was depended on. |

---

## APR-P5-001

| Field | Value |
|---|---|
| Phase | P5 — Deterministic Core |
| Phase version | 1.0 |
| Approver role | Optimization / Operations Research Engineer (primary) |
| Supporting review | Backend Engineer, QA Engineer, Domain Expert (condition owner) |
| Date/time | 2026-09-07 (UTC) |
| Decision | **APPROVED** |
| Acceptance criteria reviewed | "Impact and alternatives can be calculated without an LLM" — satisfied; no module under `src/core/` imports an agent or model provider, and all 54 tests run offline |
| Evidence reviewed | `docs/P5-deterministic-core.md`; six core modules; flagship run producing FEASIBLE/INFEASIBLE/BLOCKED/baseline in one pass; **54/54 tests passing**; measured pipeline latency well under the NFR-001 2 s budget |
| Conditions closed | **DE-1** — cold-chain excursion is a hard gate returning INFEASIBLE, excluded from ranking, reason states "not rankable at any cost". **DE-2** — unqualified supplier returns BLOCKED with "cannot be approved by any role"; BLOCKED dominates INFEASIBLE. |
| Outstanding issues | MCDA and risk weights are ASSUMED organisational values (declared, configurable, visible); hospital-to-warehouse sourcing is inferred from the first inbound lane, adequate for the flagship topology only |
| Risk assessment | Acceptable. The load-bearing risk was that gates would degrade into weighted cost terms under demo pressure; a test now proves a cheap infeasible option cannot outrank a costly feasible one. |
| Linked artefacts | `src/core/{network,inventory,constraints,scoring,impact,scenarios}.mjs`, `docs/P5-deterministic-core.md` |
| Linked tests | `tests/core.test.mjs` (28), plus P4 suite (26) |
| Linked requirements | REQ-010–015, 020–028, NFR-001, NFR-003, NFR-004, NFR-008 |
| Linked findings | D5-1 (HIGH), D5-2, D5-3, D5-4 — all fixed and regression-tested |
| Comments | Four defects were found by the phase's own tests, and three were substantive rather than cosmetic. D5-1 is the most serious: the seed data could not exercise shelf-life netting, so REQ-012 had been passing against data that made the Domain Expert's binding P1 challenge unobservable — the requirement was verified in name only. D5-3 is the kind of scoring defect that survives to a live demo: the baseline was scoring 40/100 because "do nothing" was credited with zero cost and zero ETA. Both were caught only because the tests asserted on *outcomes the domain requires* rather than on function return shapes. |

---

## APR-P6-001

| Field | Value |
|---|---|
| Phase | P6 — AI / Agent Layer |
| Phase version | 1.0 |
| Approver role | AI Architect (primary) |
| Supporting review | AI Evaluation Engineer, Safety/Governance Officer |
| Date/time | 2026-09-07 (UTC) |
| Decision | **APPROVED** |
| Acceptance criteria reviewed | "Agents have bounded authority enforced in code, not requested in prompts" — satisfied. Forbidden capabilities are absent from the tool registry entirely, so no name exists to call; no agent output schema contains a numeric supply-chain field. |
| Evidence reviewed | `docs/agents.md`; `docs/P6-agent-layer.md`; four modules under `src/agents/`; **24 agent tests**, suite green at 110/110; injection test; CA-2 causality test comparing intent-driven vs exhaustive generation |
| Conditions closed | **AI-1** — `confidence ∈ [0,1]` and a non-empty `uncertainty` string are required on every output including every fallback path, asserted per-seam and on every persisted row. **CA-2** — omitting `ALT_PORT` from agent intents removes it from the generated candidate set while every computed figure stays byte-identical, proving the agent changes *what is considered* and nothing about *what it is worth*. |
| Outstanding issues | No real LLM has been exercised; `MockProvider` is the default and deliberately declines to write prose. AI-2 (invalid output rejection proven by systematic eval) remains open and is owned by P11. Injection resistance is shown against one crafted payload, not proven in general. |
| Risk assessment | Acceptable. The load-bearing risk was authority creep — an agent gradually acquiring the ability to produce a number or trigger an action. Authority-by-absence makes that a schema change rather than a prompt change, so it cannot happen quietly. |
| Linked artefacts | `src/agents/{provider,schemas,runtime,index}.mjs`, `docs/agents.md` |
| Linked tests | `tests/agents.test.mjs` (24) |
| Linked requirements | REQ-002, 003, 004, 005, 015, 026, 027, 060–067, 095, NFR-003, NFR-012 |
| Linked findings | D6-1 (test defect), D6-2 (MEDIUM), D8-1 (MEDIUM) — all fixed and regression-tested |
| Comments | D6-2 is the finding worth recording. `runAgent` treated schema-valid-but-empty output as success, so a provider returning `{text: null, confidence, uncertainty}` produced `ok: true` and persisted a null narrative — the UI would have rendered a blank explanation while the invocation record claimed success. **Valid is not the same as useful**, and a validator that only checks shape will not catch the difference. The related D8-1, found later while reading a live API response, is the same class of problem one level up: the record itself said `VALID / fallback_used=1 / reason=(none)`. A record that cannot explain its own fallback is not evidence, it is a rumour. Both are now enforced at the database boundary rather than by convention. |

---

## APR-P7-001

| Field | Value |
|---|---|
| Phase | P7 — SAP Integration |
| Phase version | 1.0 |
| Approver role | SAP Integration Engineer (primary) |
| Supporting review | SAP Strategy Advisor, System Architect |
| Date/time | 2026-09-07 (UTC) |
| Decision | **APPROVED WITH CONDITION** |
| Acceptance criteria reviewed | "Genuine, non-faked SAP integration with honest labelling" — satisfied in the only form the environment permits: a real OData contract implementation with provenance that cannot lie. Connectivity is explicitly **not** claimed. |
| Evidence reviewed | `docs/P7-sap-integration.md`; `src/sap/adapter.mjs`; `src/sap/fixtures.mjs`; **12 SAP tests**; published SAP API documentation for `API_MATERIAL_STOCK_SRV`, `API_MRP_MATERIALS_SRV_01`, `API_PRODUCT_SRV` |
| Conditions closed | None. **SAP-1 remains OPEN BY DESIGN.** |
| Outstanding issues | Zero verified round-trips against SAP — no API key is provisioned (assumption A-01). Fixtures prove field mapping against the published contract, not connectivity, and are named `SAP_SANDBOX_SHAPE_FIXTURE` to prevent that misreading. Adapter is read-only. |
| Risk assessment | Acceptable, and the residual risk is disclosure rather than function. The dangerous failure mode for a hackathon is a green "Live SAP" badge over simulated numbers; the constructor makes that unreachable by downgrading `LIVE_SAP`/`SAP_SANDBOX` to `SIMULATED` whenever no key is present, so the badge is derived from the effective mode and never the requested one. |
| Linked artefacts | `src/sap/adapter.mjs`, `src/sap/fixtures.mjs`, `docs/P7-sap-integration.md` |
| Linked tests | `tests/sap.test.mjs` (12) |
| Linked requirements | REQ-070–076 |
| Linked findings | None new |
| Comments | The honest position is that we have implemented an integration *contract*, not an integration. Approving this phase therefore required deciding what "genuine, non-faked" can mean without credentials. We settled on: the wire format must be real, the mapping must be tested against the published contract, the failure behaviour must be real, and the system must be structurally incapable of overstating what it has. A test asserts the forbidden phrasings — "Integrated with SAP", "live SAP data", "Powered by SAP AI Core" — appear nowhere in the adapter's own description. SAP-1 stays open because closing it would require evidence we do not have, and the condition exists precisely to stop us claiming otherwise. |

---

## APR-P8-001

| Field | Value |
|---|---|
| Phase | P8 — Control Tower UI |
| Phase version | 1.0 |
| Approver role | UI/UX Designer (primary) |
| Supporting review | Visual QA, Product Manager (condition owner) |
| Date/time | 2026-09-07 (UTC) |
| Decision | **APPROVED** |
| Acceptance criteria reviewed | "UI follows the design system" — satisfied; every base token is asserted to appear verbatim in `DESIGN.md`, and the product-surface layer is additive and documented. "Operator can distinguish computed from generated" — satisfied via a single enforced render path. |
| Evidence reviewed | `docs/design-extension.md`; `docs/P8-ui.md`; `src/ui/tokens.mjs`; `src/ui/public/*`; `src/api/server.mjs`; **11 design tests + 9 DOM render tests**; suite green at 110/110; measured contrast ratios all ≥ 4.5:1 |
| Conditions closed | **PM-1** — model prose reaches the DOM through exactly one function, which applies a provenance border, recessed ink and an explicit `AI-generated` / `Template · deterministic` label. A test asserts the narrative never renders outside that block and that computed text is strictly more prominent while generated text stays AA-legible. |
| Outstanding issues | No screenshot or visual-regression testing — the sandbox cannot download a browser binary (TLS restriction), so verification is DOM-level and does not cover pixel layout. The Approval Center is an intentional placeholder. Fonts load from Google Fonts. |
| Risk assessment | Acceptable. The load-bearing risk was R0-2: inventing status colours ad hoc and drifting away from the design authority. Binding the tokens to a test that greps `DESIGN.md` means drift now breaks the build rather than accumulating silently. |
| Linked artefacts | `src/ui/tokens.mjs`, `src/ui/public/{index.html,app.css,app.js}`, `src/api/server.mjs`, `docs/design-extension.md`, `docs/P8-ui.md` |
| Linked tests | `tests/design.test.mjs` (11), `tests/ui.test.mjs` (9) |
| Linked requirements | REQ-090–097, PM-1 |
| Linked findings | D8-1 (MEDIUM), D8-2 (MEDIUM), D8-3 (LOW) — all fixed |
| Comments | Two decisions are worth defending. First, the Approval Center renders a statement that it is blocked on P12 instead of a working-looking Approve button. A fake approval control is the single most misleading thing this UI could contain, because approval integrity is the project's central governance claim. Second, D8-2 was found the honest way — the server refused to start after a schema change, because `CREATE TABLE IF NOT EXISTS` had silently accepted a stale database and then failed deep inside an INSERT with "no column named fallback_reason". Rather than delete the file and move on, the failure now happens at open time and names both the missing columns and the fix. The original error pointed at the symptom; the guard points at the cause. |

---

## Note: snapshot hash supersession (recorded at P8)

The P4 approval above cites snapshot hash `673d8f1e…7cdaa2`. That value is **no longer
reproducible**, and the reason is recorded here rather than quietly overwritten.

Defect **D5-1** (found at P5) showed the seed data could not exercise shelf-life netting:
`LOT-C-002` held 5,000 units expiring at +6 days against 1,400 units/day of demand, so no
write-off ever occurred and REQ-012 passed vacuously. The fixture was corrected to 20,000 units
expiring at +3 days. Changing the fixture necessarily changes the canonical snapshot.

| | Value |
|---|---|
| Superseded hash | `673d8f1e…7cdaa2` |
| Current hash | `0dfe4d975c82cd743cb2905839e920bbd63d25e1206ee7ff54a077433a65a0b8` |
| Cause | D5-1 seed correction (`src/db/seed.mjs`) |
| Reproduce | `npm run seed` with `SEED=20260907` |
| Verified at | P8, 2026-09-07 |

The hash is still deterministic — re-running the seed reproduces `0dfe4d97…` exactly. What changed
is the input, not the determinism guarantee (ADR-0005).
