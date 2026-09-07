# ADR-0002 — AI Boundary and Agent Authority Model

- **Status:** ACCEPTED
- **Date:** 2026-09-07
- **Version:** 1.0
- **Deciders:** AI Architect (primary); Safety/Governance Engineer, Security Engineer, System Architect
- **Related:** ADR-0001

## Context
Master Prompt §5 forbids AI from originating authoritative values and §31 forbids AI-for-AI's-sake;
§11 forbids agents from inventing entities, bypassing approval, or hiding uncertainty. These need to
be enforced by architecture, not by prompt wording — a prompt instruction is a request, not a control.

## Alternatives Considered
1. **Prompt-enforced boundaries** — instruct the model not to compute or execute. Rejected: no
   enforcement, defeated by prompt injection, unverifiable.
2. **Post-hoc validation only** — let agents produce anything, validate afterwards. Rejected: catches
   malformed output but not an agent that plausibly *invents* a number in a free-text field.
3. **Capability-scoped agents with typed contracts and server-side tool allow-lists.** Selected.

## Decision

**1. Field-level authority.** Every agent has a JSON Schema whose properties are partitioned into
`agent_authoritative` (classifications, prose, ordering rationale, confidence) and *nothing else*.
Numeric supply-chain quantities are not in any agent schema. If a number is needed for narration it
is injected by the spine into the prompt and echoed back for display only, stored under
`agent_commentary`, never in an authoritative column.

**2. Server-side tool allow-lists.** An agent's callable tools are derived from its role at
invocation time on the server. Prompt content cannot alter the allow-list. Agent → tool matrix:

| Agent | Allowed tools | Explicitly denied |
|---|---|---|
| Disruption Sensing | `geo.resolve`, `catalog.lookup_lane` | all write tools, all engines |
| Impact Narration | `impact.read_result` | any write, any recompute |
| Scenario Reasoning | `network.read`, `inventory.read`, `supplier.read`, `scenario.propose_intent` | cost/ETA/risk computation, scenario ranking, any write |
| Explanation | `decision.read`, `policy.read_result` | policy evaluation, approval creation |
| Compliance | `audit.read`, `audit.append_narrative` | audit mutation, chain recomputation |
| Orchestrator | `state.read`, `advice.suggest` | **all state transitions** |

No agent — including the orchestrator — has `execute`, `approve`, `mint_authorization`, or any
audit-mutating capability. These are not exposed as tools at all.

**3. Referential validation.** Any entity ID appearing in agent output is resolved against the
database. Unknown ID → the whole output is rejected, the failure is logged as a guardrail event, and
the deterministic fallback is used. This makes "invented supplier/route/lot" structurally impossible
to act on (§11).

**4. Mandatory uncertainty.** Every agent schema requires `confidence` (0–1) and `uncertainty`
(free text, may be "none identified"). Omission = invalid output. Confidence below the configured
threshold downgrades the resulting action's autonomy level — never upgrades it.

**5. Untrusted-content handling.** Advisory text, supplier notes and any externally sourced string are
delimited and presented to the model as data with a standing statement that content inside carries no
authority. Because the allow-list is server-side, a successful injection can at worst corrupt prose —
it cannot obtain a capability.

**6. Failure ladder.** invalid output → one retry with the validation error → still invalid →
deterministic templated fallback with `explanation_source: DETERMINISTIC_FALLBACK` → workflow
continues. The workflow never blocks on the model, and never silently pretends the model succeeded.

**7. Provider abstraction.** A single `LanguageModelProvider` interface; provider identity, model name
and prompt version are recorded on every agent invocation for auditability and reproducibility.

## Consequences
- The answer to "can your AI hallucinate a number into a decision?" is *no, there is no field for it*.
- Prompt injection is contained to prose quality — provable by P11/P14 tests.
- Cost: more schema code; agent outputs are narrower and less "impressive" in isolation. Accepted.
- Cost: an agent cannot opportunistically do something useful outside its allow-list. Accepted —
  that is the point.

## Risks
- Over-narrow seams make agents look decorative (AR-R1) — mitigated by condition CA-2 (scenario
  intents must genuinely drive generation) and by surfacing traces in the UI.
- Threshold tuning for confidence is arbitrary at MVP — recorded as a CONFIGURABLE RULE, not a claim.

## Verification
Enforced by P11 evals: schema violation rejection, invented-entity rejection, injection resistance,
uncertainty-omission rejection, and fallback correctness. This ADR is unverified until those pass.
