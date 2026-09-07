# P1 — Problem Definition

| Field | Value |
|---|---|
| Phase ID | P1 |
| Phase Name | Problem Definition |
| Status | **PASSED** (pending sign-off, `APR-P1-001`) |
| Depends on | P0 (PASSED) |
| Primary approver | Product Manager · Supporting: Pharmaceutical Supply-Chain Domain Expert |

## Objective
State precisely which decision, for which user, under which conditions, this system improves — and
state equally precisely what it will not do.

## Inputs
P0 handoff package; Master Prompt §§1–4, 32, 36.

---

## 1. Problem Statement (one paragraph, per acceptance criterion)

> When a logistics disruption strikes — a port closure, a lane suspension, a cold-chain excursion —
> a pharmaceutical supply-chain manager can usually *see* the event within minutes, but still needs
> hours to days to answer the question that actually matters: **which specific patient-facing orders
> are now at risk, what are my feasible alternatives, and which one is safest given cold-chain,
> shelf-life, cost and regulatory constraints?** That gap exists because the answer requires joining
> shipment status, inventory positions, lane capacity, supplier lead times and product criticality
> that live in different systems, then evaluating trade-offs no single dashboard computes. During
> the delay, decisions are made on partial information by whoever is available, are rarely recorded
> with their rationale, and cannot be audited afterwards. **This system closes that gap by sensing
> the disruption, deterministically computing the blast radius and a set of feasible recovery
> scenarios, using agents to interpret unstructured signals and explain the trade-offs, routing the
> chosen action to the correct human approver under an explicit policy, executing only what was
> approved, verifying recovery, and writing a tamper-evident audit record of the whole chain.**

**Compressed form:** *cut time-to-safe-decision for a disrupted critical-medicine shipment from
hours to minutes, without removing the human from high-stakes calls, and leave behind provable
evidence of why the decision was made.*

## 2. Why this problem is worth solving

| Claim | Status |
|---|---|
| Drug shortages are a persistent, documented problem in health systems | **ASSUMPTION pending citation** — P16 must attach a verifiable source or the claim is dropped from the pitch |
| Delay between disruption detection and coordinated response is the costly interval | **ASSUMPTION** (design premise) — measured only *within our simulation* in P16 |
| Cold-chain products fail irreversibly once excursion thresholds are crossed | **VERIFIED-PENDING** — P3 must cite a primary source before this is used as a hard constraint |

**Governing rule (from Master Prompt §2 and §30):** no pharmaceutical or regulatory fact enters any
artefact without a verified citation. Everything above that is not cited is carried as an explicit
ASSUMPTION and rendered as such in the UI and the deck. We would rather present three cited facts
than twenty impressive unsourced ones.

## 3. Personas

### P-1 — Ravi, Supply-Chain Control-Tower Manager *(primary user)*
- **Goal:** keep critical medicines available to hospitals; never be the reason a therapy is missed.
- **Context:** monitors ~dozens of in-flight shipments; interrupted constantly; not a data scientist.
- **Pain:** knows *something broke* long before knowing *what it means* or *what to do*.
- **Success:** in one screen — what's at risk, ranked options with real numbers, one action to take.
- **Decision authority:** may approve low/medium-impact rerouting; cannot switch a critical supplier alone.

### P-2 — Meera, Procurement Manager
- **Goal:** secure supply without contract/qualification violations.
- **Needs from us:** alternate-supplier comparison with lead time, cost, capacity, qualification status.
- **Authority:** co-approver on supplier switches.

### P-3 — Daniel, Compliance Officer
- **Goal:** every deviation is justified, documented and reconstructable months later.
- **Needs:** immutable audit chain — trigger → data → options → policy → approver → execution → outcome.
- **Authority:** co-approver on anything cold-chain-sensitive, GxP-adjacent, or compliance-uncertain.
- **Blocking power:** can BLOCK; a blocked action cannot be executed by anyone else.

### P-4 — Priya, Hospital Pharmacy Lead *(affected stakeholder, read-only)*
- Cares about one thing: *will the medicine arrive before we run out?* Sees ETA + substitution advice.

### P-5 — Finance/Executive Approver *(exception path)*
- Engaged only above a configurable financial threshold. Deliberately rare.

## 4. Primary User Journey (flagship)

```text
T+0    Disruption signal arrives (simulated feed + unstructured advisory text)
T+0m   Disruption Sensing Agent classifies: type, severity, confidence, geography, duration
T+1m   Impact Engine (deterministic) computes blast radius:
       affected shipments · affected orders · days-of-cover per site · stockout dates
T+2m   Scenario Engine (deterministic) enumerates feasible recovery options;
       infeasible options are excluded WITH a stated reason, not silently dropped
T+3m   Agents rank and EXPLAIN trade-offs; no agent invents a number
T+3m   Policy Engine classifies the action: AUTONOMOUS | RECOMMEND | APPROVAL | MULTI | BLOCKED
T+4m   Correct approver(s) notified with full evidence package
T+5m   Human approves → bounded execution → shipment/inventory state updated
T+6m   Recovery verification recomputes days-of-cover and confirms (or fails) the objective
T+6m   Audit record sealed (hash-chained), exportable
```

**Counter-journey (must also work):** the agent recommends an option the human **rejects**; the
system records the rejection with reason, re-ranks, and does *not* execute. A system that only
demos the happy path is not a governance system.

## 5. Failure Modes We Must Handle (not hide)

| ID | Failure | Required behaviour |
|---|---|---|
| F-1 | LLM unavailable / times out | Deterministic pipeline still produces impact + ranked scenarios; explanation degraded to templated text, **labelled as such** |
| F-2 | LLM returns malformed structured output | Schema validation rejects; retry once; then fall back to deterministic ranking; log the failure |
| F-3 | LLM proposes a route/supplier/quantity that does not exist | Tool layer rejects unknown entity IDs; agent cannot execute; incident logged as guardrail hit |
| F-4 | Disruption signal is ambiguous or low-confidence | Confidence surfaced; below threshold → RECOMMEND only, never AUTONOMOUS |
| F-5 | Underlying data changes after approval | Approval invalidated; decision returns to approval queue (§10.4) |
| F-6 | Prompt injection inside an advisory text field | Untrusted text is data, never instruction; tool permissions unchanged by content; tested in P11/P14 |
| F-7 | SAP endpoint unreachable | Documented fallback to labelled simulated data; UI shows the data-source badge honestly |
| F-8 | Two approvers act concurrently | Idempotent, versioned decision state; second write on a stale version rejected |

## 6. KPIs (measured, never asserted)

| KPI | Definition | Baseline source |
|---|---|---|
| K-1 Time-to-decision | disruption ingest → approved action | measured in-system, both arms of an A/B demo (manual-baseline vs agentic) |
| K-2 Time-to-recovery-verified | ingest → recovery check passes | measured |
| K-3 Orders protected | orders whose stockout date moves past their need-by date | computed by deterministic engine |
| K-4 Δ landed cost | chosen scenario vs do-nothing and vs best-cost option | computed |
| K-5 Stockout risk reduction | risk score before/after | computed |
| K-6 Human intervention rate | % decisions requiring approval | measured |
| K-7 Guardrail hit rate | blocked/invalid agent actions caught | measured |
| K-8 Audit completeness | % executed actions with a complete, verifying evidence chain | **target 100%** |

Every KPI is reported as *"measured on synthetic scenario X, N runs"* — never as a real-world claim.

## 7. Scope (MVP)

**IN**
1. One flagship disruption scenario, end-to-end, repeatable.
2. Deterministic core: network model, routing, cost, inventory/days-of-cover, risk, constraints, scenario ranking.
3. Agent layer: sensing, impact narration, scenario reasoning, explanation, compliance recording, bounded orchestration.
4. Policy engine + multi-role approval with full evidence contract.
5. Hash-chained audit log with export.
6. SAP integration on a genuine, documented API contract, with honest fallback labelling.
7. Control-tower UI: Dashboard · Network · Incident · Scenarios · Approvals · Agent Activity · Inventory · Audit.
8. Seed data, labelled SYNTHETIC.
9. Tests, AI evals, red-team suite, docs, demo script, deck.

**OUT (non-goals — deliberate)**
- Real patient data, real PHI, any real regulatory filing.
- Multi-tenant SaaS, billing, SSO federation, mobile apps.
- Live carrier/weather/geopolitical API subscriptions.
- Model training/fine-tuning. Predictive demand forecasting.
- Every disruption type — exactly one is done well (Master Prompt §4, §36).
- Autonomous execution of high-impact actions. By design, not by omission.

## 8. Flagship Scenario (selected)

> **"Cold-chain lane collapse on a temperature-controlled vaccine corridor."**

A primary maritime/air corridor carrying a temperature-controlled critical product is suspended
(port closure + reefer capacity loss). In flight are shipments destined for regional warehouses that
supply hospitals already running thin days-of-cover. Recovery requires choosing among: expedited air
reroute (fast, expensive, capacity-limited), alternate port + inland cold-chain (cheaper, slower,
higher excursion risk), inter-warehouse inventory rebalancing (no new supply, buys days), or
alternate qualified supplier (slow, needs Procurement **and** Compliance approval).

**Why this scenario:** it forces *all six* theme capabilities to be genuinely exercised —
sensing, scenario planning, rerouting, inventory rebalancing, compliance, human-in-the-loop — and it
makes the multi-approver path unavoidable rather than decorative. A pure rerouting scenario would let
us fake governance with a single "Approve" button.

**Data classification:** the entire network, product master, inventory and disruption feed are
**SYNTHETIC**, generated deterministically from a seed. This is stated in the UI, the docs and the deck.

## 9. Deliverables
Problem statement · personas · user journey + counter-journey · failure modes · KPIs · scope ·
non-goals · flagship scenario.

## 10. Decisions Made
- **D1-1** Single flagship scenario: cold-chain lane collapse (mitigates R-01).
- **D1-2** All demo data SYNTHETIC and labelled; no claim of live data anywhere.
- **D1-3** Rejection path is a first-class requirement, not an edge case.
- **D1-4** Uncited pharma/regulatory claims are carried as ASSUMPTION or removed.

## 11. Requirements Affected
Seeds REQ-001…REQ-0xx in `docs/requirements.md` (authored in P3).

## 12. Verification Performed
| Check | Result |
|---|---|
| Problem expressible in one precise paragraph | PASS (§1) |
| Every persona has a distinct decision authority | PASS (§3) — feeds the approver matrix, avoids the "one approver" anti-pattern (§10.1) |
| Flagship scenario exercises all six theme capabilities | PASS (§8 rationale) |
| KPIs are computable from system state, not narrative | PASS (§6) |
| Non-goals explicitly include autonomy limits | PASS (§7) |
| Domain-expert challenge applied | PASS — see §13 |

## 13. Domain-Expert Challenge (Role 3, adversarial review of Role 2)

> **Challenge 1:** "Rerouting a cold-chain shipment is not a routing problem, it's a *product-integrity*
> problem. If you optimise on cost and time only, you are not credible."
> **Resolution:** cold-chain excursion risk is a **hard feasibility constraint**, not a soft cost term.
> Scenarios that breach the temperature-time budget are marked INFEASIBLE with the reason shown.
> This is now REQ-material for P3/P5.

> **Challenge 2:** "Alternate suppliers are not interchangeable — qualification status per market
> governs whether a switch is even legal."
> **Resolution:** supplier entities carry a `qualification_status` per destination market, modelled as a
> **CONFIGURABLE RULE** (not a claimed real regulation). Unqualified supplier → BLOCKED, not merely costed.

> **Challenge 3:** "Days-of-cover without shelf-life is misleading."
> **Resolution:** inventory lots carry expiry; the inventory engine nets out lots expiring before the
> need-by date. Modelled as SYNTHETIC data with a CONFIGURABLE RULE.

These three challenges materially changed the data model and are carried into P4/P5 as binding.

## 14. Known Issues / Open Risks
- Pharma factual claims remain uncited (owned by P3/P16). Until cited they may not appear in the deck.
- R-01 mitigated but not eliminated; P2 must choose the *smallest* architecture that satisfies §32.

## 15. Assumptions
A-01, A-02 (from P0) plus: **A-03** judges value a working, honest narrow system over a broad
simulated one (Master Prompt §36 explicitly endorses this).

## 16. Approver(s)
Product Manager (primary), Domain Expert (supporting, challenges recorded §13). `APR-P1-001`.

## 17. Handoff Package → P2
Flagship scenario, personas with distinct authorities, failure modes F-1…F-8, KPIs K-1…K-8, and
three binding domain constraints (cold-chain feasibility, supplier qualification, shelf-life netting).
P2 must show how each candidate architecture supports **all** of these, especially F-1 (must work
without an LLM) and the multi-approver path.
