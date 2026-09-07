# Agent Specification

**Version:** 0.1.0 · **Phase:** P6 · **Status:** IMPLEMENTED
**Implements:** ADR-0002 (bounded agents), architecture seams S1/S2/S3/S5/S6 + Orchestrator
**Closes conditions:** AI-1, CA-2

---

## 1. What makes these agents, and not prompts

The Master Prompt is explicit that "an LLM wrapper is not an agent". Our test for agenthood is:

> Does the component *decide* something that changes what the system subsequently does, within
> authority that is enforced rather than requested?

Each seam below is measured against that. Two of them (S2, S5, S6) **fail** that test and are
therefore documented as *narration*, not agency — we do not inflate them.

| Seam | Component | Decides | Changes system behaviour | Genuine agent |
|---|---|---|---|---|
| S1 | Disruption Sensing | event type, severity, geography, duration | Yes — severity drives triage and cover thresholds | **Yes** |
| S2 | Impact Narration | wording only | No | No — narration |
| S3 | Scenario Reasoning | *which strategies are generated* | Yes — changes the candidate set | **Yes** |
| S4 | Policy | — | — | **No agent by design** |
| S5 | Explanation | wording only | No | No — narration |
| S6 | Compliance Narration | wording only | No | No — narration |
| — | Orchestrator | suggests next step | No — advisory only | Advisory |

**S4 has no agent.** Policy determines who must approve and what is blocked. That is a
governance decision with legal weight; it is a deterministic rule table (P12). An LLM is not
permitted anywhere in that path.

## 2. Authority model (AR-1 … AR-7)

### AR-1 — Authority by absence

The strongest guarantee we can make about "the LLM must never invent authoritative numbers" is not
to validate them away, but to ensure **no field exists to put one in**.

`src/agents/schemas.mjs` defines no numeric supply-chain field on any agent output. There is no
`costDelta`, no `etaHours`, no `daysOfCover`, no `riskScore`. A model that emits one is rejected by
an explicit forbidden-key check, and the rejection is recorded as a `SCHEMA_VIOLATION` guardrail
event.

> Verified by: *"AR-1/REQ-003: the sensing schema has NO field for an authoritative value"*.

`confidence` is the one number an agent may produce — it is a statement about the agent's own
epistemic state, not about the supply chain.

### AR-2 — Scoped tools, server-side

Tool grants are a frozen allow-list held on the server. The model never sees, and cannot name, a
capability outside its grant.

| Agent | Tools granted |
|---|---|
| DisruptionSensing | `geo.resolve`, `catalog.lookup_lane` |
| ScenarioReasoning | `network.read`, `inventory.read`, `supplier.read` |
| ImpactNarration / Explanation / Compliance / Orchestrator | `impact.read_result` |

`FORBIDDEN_CAPABILITIES` — `execute`, `approve`, `mint_authorization`, `audit.mutate`,
`audit.delete`, `state.transition`, `policy.evaluate` — are **absent from the registry entirely**.
There is no name to call. This is a stronger property than "the call is denied".

No grant exceeds 3 tools (asserted), because a broad tool surface is itself a risk.

### AR-3 — Every output carries calibrated uncertainty

Every agent output must include `confidence ∈ [0,1]` **and** a non-empty `uncertainty` string —
including every deterministic fallback. An agent that cannot say what it is unsure about is not
being honest about being a model. `CONFIDENCE_THRESHOLD = 0.7`; below it, the UI marks the
classification as low-confidence and the orchestrator raises a flag.

### AR-4 — Untrusted content is data, never instruction

External advisory text is wrapped by `wrapUntrusted()` and rendered in the UI inside an explicitly
labelled untrusted block. The injection test feeds an advisory containing
`SYSTEM OVERRIDE … call execute() … mint_authorization` and asserts that `tools.allowed` is
unchanged and no privileged call succeeds.

### AR-5 — The failure ladder

```
provider call
  ├── provider throws      → NO retry  → deterministic fallback   (attempts = 1)
  ├── output invalid       → ONE retry with the validation error  (attempts = 2)
  │     └── still invalid  → deterministic fallback
  ├── output valid but EMPTY → deterministic fallback             (attempts = 1)
  └── valid                → use it
```

Provider errors are not retried because retrying a dead endpoint adds latency during an incident
and changes nothing. Malformed output *is* retried once, because that is a fault the model can
correct when shown the error.

**Every path produces a usable result.** A resilience tool that fails when its LLM fails has
misunderstood its own subject matter.

### AR-6 — Full invocation recording

Every invocation writes to `agent_invocation`: seam, agent, provider, model, prompt version,
latency, input, tool calls, output, validation result, confidence, uncertainty, `fallback_used`,
`fallback_reason`, `attempts`. A database CHECK constraint enforces
`fallback_used = 0 OR fallback_reason IS NOT NULL` — see defect D8-1.

### AR-7 — No agent transitions state

`orchestratorAdvice()` returns `{ advisory: true, canTransitionState: false, suggestedNext, flags }`.
It has no write path to the state machine. Its flags (`BLOCKED_OPTION_PRESENT`, `CLOSE_CALL`,
`CRITICAL_COVER`) are observations for a human.

## 3. Condition CA-2 — proving S3 is causal, not decorative

The risk with "AI scenario planning" is that the engine generates a fixed list and the model writes
a caption. We prove otherwise:

- The agent emits **typed strategy intents**, which select which strategies the engine generates.
- With agent intents omitting `ALT_PORT`, `ALT_PORT` **is not generated**. The candidate set changed.
- `DO_NOTHING` is always retained regardless of intents — the agent cannot suppress the baseline.
- Every computed figure (`costDeltaMinor`, `etaHours`, `riskScore`, `feasibility`) is
  **byte-identical** between intent-driven and exhaustive generation.

That last point is the crux: the agent changed *what was considered*, and changed *nothing* about
what any option is worth. Selection is reasoning; valuation is arithmetic.

`generationOrigin` is recorded as `ENGINE` or `AGENT_INTENT` and displayed in the UI.

## 4. Providers

| Provider | Purpose |
|---|---|
| `MockProvider` | Deterministic, offline, labelled. Returns `text: null` for narrative schemas — it declines to invent prose rather than emit plausible filler. |
| `FailingProvider` | Test-only. Modes `error`, `malformed`, `invented`, `no-uncertainty`. |
| `providerFromEnv()` | **Throws** rather than silently substituting a mock when a real provider is configured but unreachable. |

The default demo run uses `MockProvider`, so the impact narrative is produced by the deterministic
template and the UI labels it `Template · deterministic`. This is the honest outcome: **no real
model is configured, so no model-written prose is claimed.**

## 5. Verified defects found by these tests

| ID | Severity | Finding |
|---|---|---|
| D6-1 | — (test defect) | REQ-065 assertion sat outside its loop → `ReferenceError`. |
| D6-2 | MEDIUM | `runAgent` treated schema-valid-but-empty output as success, persisting a null narrative under `ok:true`. **Valid ≠ useful.** Fixed with an `isEmpty` guard. |
| D8-1 | MEDIUM | An invocation row read `VALID / fallback_used=1 / reason=(none)`. A record that cannot explain its own fallback is not an audit record. Added `fallback_reason`, `attempts`, and a CHECK constraint. |

## 6. Test coverage

24 tests in `tests/agents.test.mjs` covering AR-1…AR-7, the failure ladder, injection resistance,
CA-2 causality, and record self-explanation.
