# P6 — Agent Layer · Phase Output Package

**Status:** COMPLETE · **Date:** 2026-09-07 · **Gate:** PASS

## 1. Objective
Implement bounded agents at seams S1, S2, S3, S5, S6 plus an advisory orchestrator, with authority
enforced in code rather than requested in prompts. Close conditions AI-1 and CA-2.

## 2. Deliverables
| Artifact | Path |
|---|---|
| Provider interface + mock/failing providers | `src/agents/provider.mjs` |
| Output schemas + validators | `src/agents/schemas.mjs` |
| Runtime: scoped tools, failure ladder, recording | `src/agents/runtime.mjs` |
| Seam implementations | `src/agents/index.mjs` |
| Specification | `docs/agents.md` |
| Tests (24) | `tests/agents.test.mjs` |

## 3. Evidence
- `npm test` → **110/110 passing** (whole suite, post-P8).
- AR-1 proven by *absence* of any numeric supply-chain field, plus a forbidden-key check.
- `FORBIDDEN_CAPABILITIES` absent from the registry — no name exists to call.
- Injection test: privileged instructions in untrusted advisory text change nothing.
- CA-2: omitting `ALT_PORT` from intents removes it from the candidate set while every computed
  figure stays byte-identical.

## 4. Conditions closed
| Condition | Status | Evidence |
|---|---|---|
| **AI-1** — every agent output carries calibrated uncertainty | **CLOSED** | Schema requires non-empty `uncertainty` + `confidence ∈ [0,1]` on every path including fallbacks; asserted per-seam and on every persisted row. |
| **CA-2** — agent reasoning must be causal, not decorative | **CLOSED** | Intents change the generated candidate set; computed figures unchanged. `generationOrigin` recorded. |

## 5. Defects found and fixed
D6-1 (test defect), D6-2 (MEDIUM — empty-but-valid output accepted as success). See `docs/agents.md` §5.

## 6. Honest limitations
- Default provider is `MockProvider`; **no real LLM has been exercised**. The mock declines to write
  prose, so narrative seams run their deterministic templates and the UI says so.
- Seams S2/S5/S6 are narration, not agency, and are documented as such.
- Prompt-injection resistance is demonstrated against one crafted payload, not proven in general.
