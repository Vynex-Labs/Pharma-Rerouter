# ADR-0001 — Deterministic Spine with Bounded Agents at the Edges

- **Status:** ACCEPTED (with conditions, see `docs/P2-architecture-review.md`)
- **Date:** 2026-09-07
- **Version:** 1.0
- **Deciders:** System Architect (primary); AI Architect, SAP Strategy Specialist, Master Orchestrator
- **Supersedes:** none

## Context
The system must be genuinely agentic (SAP Hackfest Theme 1) while never allowing a language model to
originate an authoritative number (Master Prompt §5), must keep functioning when the model is
unavailable (P1 failure mode F-1), and must make high-stakes actions structurally unable to bypass
human approval (§9, §10.4). These requirements pull in opposite directions: maximal autonomy conflicts
with determinism, auditability and demo reliability.

## Alternatives Considered
1. **LLM-orchestrated multi-agent mesh (A)** — a supervisor LLM owns control flow; deterministic
   engines are leaf tools.
2. **Pure deterministic workflow + optimiser (B)** — rules and an optimiser own everything; no agents.
3. **Deterministic spine with bounded agents at named seams (C)** — a persisted state machine owns
   control flow; agents contribute interpretation, reasoning and explanation at six defined seams.

Scored against thirteen weighted criteria: A = 148, B = 200, C = 240 (of 275). Matrix in
`docs/architecture.md` §3.

## Decision
Adopt **Architecture C**.

A persisted, versioned state machine
(`DETECTED → IMPACT_ASSESSED → SCENARIOS_GENERATED → RANKED → POLICY_EVALUATED → PENDING_APPROVAL →
APPROVED|REJECTED|BLOCKED → EXECUTING → RECOVERY_VERIFIED → SEALED`) owns the workflow. Agents are
invoked at seams S1, S2, S3, S5, S6 plus an advisory orchestrator. Seam S4 (policy evaluation) has
**no agent**. Policy evaluation, authorization, approval-evidence creation and audit sealing are
middleware that agents cannot call.

## Reasoning
- A fails two non-negotiables: control flow becomes non-deterministic (unreconstructable audit,
  unreliable live demo) and the system stops working entirely if the model is down.
- B fails the theme: it is not agentic and has no answer to "why AI?".
- C is the only option scoring ≥4 on both *genuine agentic behaviour* and *determinism + degradation +
  governance*. It also produces the strongest answer to the hostile judging question "what happens
  when your AI is wrong?" — the decision is unchanged; only the prose degrades.

## Consequences

**Positive**
- Authoritative values are deterministic by construction, not by policy or prompt discipline.
- Governance is unbypassable: execution requires an `ExecutionAuthorization` that only an approved,
  non-stale decision can mint, and no agent has a code path to it.
- Every run of the flagship scenario follows the same path → repeatable demo and repeatable tests.
- The whole workflow is replayable from the append-only event log.
- LLM providers are swappable without touching the spine.

**Negative / accepted costs**
- Agents cannot invent new workflow shapes at runtime; new disruption types require a new generator
  strategy plus policy rules.
- Significant upfront investment in typed contracts and schemas.
- Requires deliberate effort in the UI (Agent Activity screen) to make real agent contribution
  visible, otherwise agents may *appear* decorative even though they change outcomes.

## Risks
| ID | Risk | Mitigation |
|---|---|---|
| AR-R1 | Agents perceived as decorative summarisers | Condition CA-2: scenario-reasoning intents must genuinely drive scenario generation; Agent Activity screen shows real tool calls, rejections and fallbacks |
| AR-R2 | Hash chain implemented but never verified | P10 test: mutate a persisted row, assert verification fails |
| AR-R3 | Policy engine degenerates into a hard-coded if-ladder | Declarative, versioned rules; `policy_version` recorded in every approval record |
| AR-R4 | Adapter silently falls back while the demo claims "live SAP" | `data_source` badge mandatory in the API contract and asserted by test |

## Conditions of Acceptance
PM-1, DE-1, DE-2, AI-1, AI-2, DA-1, DA-2, SAP-1, SAP-2, CA-2 — each assigned an owning phase in
`docs/P2-architecture-review.md`. This ADR is not unconditionally accepted until all are closed.

## Change Policy
Any later change to the state machine, the seam table, or the agent/middleware boundary requires a
superseding ADR, invalidation of affected phase approvals, and re-verification of P5, P6, P9 and P12
per Master Prompt §27.
