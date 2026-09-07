# P11 — AI Evaluation

**Phase owner:** AI Evaluation Engineer · **Reviewers:** AI Architect, Safety/Governance
**Status:** COMPLETE · **Closes:** condition AI-2, condition AI-1 (proof), NFR-012, REQ-062…065

---

## 1. Objective

Prove — not assert — that a schema-invalid, entity-invalid or authority-violating agent output is
**rejected rather than coerced**, and that the system degrades to deterministic behaviour when the
model is unavailable.

P6 built the guardrails. P11 tries to break them.

## 2. What was built

| Artefact | Purpose |
|---|---|
| `src/eval/cases.mjs` | The dataset: 17 adversarial cases across 8 failure classes, each with an expected verdict and a stated rationale. |
| `src/eval/runner.mjs` | Executes each case against the **real** agent runtime and scores it. Only the provider output is scripted. |
| `tests/eval.test.mjs` | Asserts the suite in CI, so a guardrail regression fails the build. |
| `scripts/eval.mjs` (`npm run eval`) | Human-readable report → `docs/evidence/ai-eval-report.json`. |

### Verdict vocabulary

`ACCEPT` · `REJECT_SCHEMA` · `REJECT_ENTITY` · `REJECT_AUTHORITY` · `FALLBACK`

### Coverage

| Category | Cases | What it attacks |
|---|---|---|
| baseline | 1 | The accept path — a suite that rejects everything is worthless |
| schema | 4 | Malformed shape, unknown enum, out-of-range and mistyped confidence |
| uncertainty | 2 | AI-1: missing and whitespace-only `uncertainty` |
| authority | 3 | AR-1: agent supplying days-of-cover, cost, ETA |
| entity | 2 | Hallucinated strategy; hallucination mixed with a valid intent |
| availability | 2 | Provider outage and timeout → deterministic fallback |
| recovery | 2 | Bounded retry: one malformed attempt recovers; two fall back |
| injection | 1 | NFR-012: instruction-like text in a field is data, never obeyed |

**Result: 17/17 (100%).** Every case additionally asserts that uncertainty is declared, confidence
is in `[0,1]`, no privileged tool is ever granted, the invocation is persisted, and a fallback
always carries a reason.

## 3. Defects found

The eval was worth building: it found **three real holes** that the P6 unit tests missed.

| ID | Severity | Finding |
|---|---|---|
| **D11-1** | **HIGH** | The AR-1 deny-list was hand-enumerated per schema and missed `costDeltaMinor` — *the actual field name used throughout the engine*. An agent could have supplied a cost figure under the real name while the list guarded a name nobody used. The S3 schema had **no top-level authority check at all**. Fixed: a single shared, pattern-based `assertNoAuthoritativeFields()` with an explicit allowlist. |
| **D11-2** | **HIGH** | `validateStrategyIntents` only rejected an output when *every* intent was invalid. A payload mixing `AIR_REROUTE` with the hallucinated `SUMMON_HELICOPTER` was **accepted**, the fabrication silently dropped. Partial acceptance lets a hallucination ride along with a valid item and hides from the operator that the model invented something. Fixed: any invalid intent invalidates the whole output. |
| **D11-3** | MEDIUM | `src/api/server.mjs` hardcoded `policyVersion: 'interim-p9-0.1.0'`, so the UI displayed a stale version for three phases after the real engine shipped. Fixed to read the engine's own `POLICY_VERSION`, with a test asserting no literal version appears in the view layer. |

D11-1 and D11-2 share a root cause worth naming: **enumerating what is forbidden is a losing
strategy**. The deny-list has to be re-derived every time a field is added, and it silently rots.
The replacement is pattern-based rejection with a small explicit allowlist — false positives are
cheap, a false negative is a model-invented number reaching a ranking function.

`tests/agents.test.mjs` contained a test that *asserted the D11-2 behaviour was correct*. It has
been rewritten, with a comment recording why the contract changed. This is the second time in this
project a test has encoded a defect as the expected result.

## 4. Limitations — stated plainly

These cases are **scripted provider outputs, not samples from a live model**. The suite proves our
guardrails reject the failure classes we anticipated. It does **not** prove a real model produces
only these failure classes, and it is not a substitute for evaluation against live model output.
The same three limitations are embedded in the JSON report so a reader of the artefact cannot miss
them.

No real LLM has been called at any point in this project (see README). Closing AI-2 means
*"invalid output is provably rejected"*, not *"the model has been evaluated"*.

## 5. Evidence

```
npm run eval     # 17/17, writes docs/evidence/ai-eval-report.json
npm test         # 167/167 including tests/eval.test.mjs
```
