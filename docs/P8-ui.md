# P8 — Control Tower UI · Phase Output Package

**Status:** COMPLETE · **Date:** 2026-09-07 · **Gate:** PASS

## 1. Objective
Build the operator-facing control tower against `DESIGN.md`, resolving P0 findings R0-2 and R0-3,
and satisfying condition PM-1 (computed values visually distinguishable from generated text).

## 2. Design authority
`DESIGN.md` is unchanged and remains authoritative. `docs/design-extension.md` adds a documented,
additive product-surface layer covering status semantics, provenance semantics and nine components,
justified by DESIGN.md's own "Known Gaps" note about in-product colour tags.

Three new hues only (`critical`, `warning`, `info`); `healthy` reuses the existing
`semantic-success`. Brand lavender is never used as a status colour. Enforced by
`tests/design.test.mjs`, which asserts every base token appears verbatim in `DESIGN.md`.

| Finding | Resolution |
|---|---|
| **R0-2** (HIGH) — DESIGN.md lacks status semantics | Additive extension, §3–§4, test-enforced |
| **R0-3** (MEDIUM) — proprietary fonts | Inter + JetBrains Mono substitution, §6 |

## 3. Condition PM-1 — CLOSED
Model prose reaches the DOM through exactly one function, `generated()`, which renders a 2px left
border, recessed `ink-muted` text, and an `AI-generated` / `Template · deterministic` label.
Computed figures use full-strength ink in the mono family. A test asserts the narrative never
renders outside a provenance block, and that computed text has strictly higher contrast than
generated text while both remain AA-legible.

## 4. Screens
| Screen | Content |
|---|---|
| Dashboard | Four computed metrics, agent classification, labelled narrative, top recommendation, advisory flags |
| Network | SVG map, 14 facilities, 18 lanes, closed lane dashed red, affected nodes ringed |
| Incident Center | Untrusted advisory block, S1 classification, declared uncertainty, orders at risk |
| Scenarios | Ranked options with MCDA breakdown bars; excluded options retained with reasons |
| Approvals | **Deliberately unbuilt** — states it is blocked on P12 rather than faking a workflow |
| Agent Activity | Real invocations with validation result, fallback reason, attempts, latency; strategy intents; guardrail events |
| Inventory | Days of cover with raw vs usable vs write-off, showing shelf-life netting |
| Audit | Chain verification status, integrity model, event list with chain hashes |

## 5. Evidence
- **110/110 tests passing**, including 11 design tests and 9 DOM render tests.
- Render tests boot the real pipeline (`buildState()`), feed genuine API payloads into jsdom, and
  assert every page renders, leaks no `undefined`/`NaN`/`[object Object]`, and preserves provenance.
- Contrast measured: critical 6.18:1, warning 9.34:1, healthy 6.58:1, info 5.89:1, ink 19.61:1 — all AA.
- API verified: `/api/state`, `/api/agents`, `/api/audit` → 200; unknown path → 404.

## 6. Defects found and fixed
| ID | Severity | Finding |
|---|---|---|
| D8-1 | MEDIUM | `agent_invocation` could record `VALID + fallback_used=1` with no reason. Added `fallback_reason`, `attempts`, and a CHECK constraint forbidding an unexplained fallback. Surfaced in the UI. |
| D8-2 | MEDIUM | Every `CREATE TABLE IF NOT EXISTS` meant a stale on-disk DB was silently accepted, then failed deep inside an INSERT. Added `assertSchemaCurrent()` — fails at open time naming the missing columns and the fix. |
| D8-3 | LOW | `view()` omitted `weights` from its destructure; caught by the typed error handler rather than leaking a stack. |

## 7. Honest limitations
- No screenshot/visual-regression testing: the sandbox cannot download a browser binary (TLS
  restriction). DOM-level assertions are used instead, which verify structure and content but not
  pixel layout.
- The Approval Center is intentionally a placeholder.
- The network map uses a linear lat/lon projection, not a real geographic projection.
- Fonts load from Google Fonts; offline demos will fall back to system sans.
