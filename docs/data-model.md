# P4 — Data Architecture

| Field | Value |
|---|---|
| Phase ID | P4 |
| Phase Name | Data Architecture |
| Status | **READY FOR REVIEW → PASSED on `APR-P4-001`** |
| Depends on | P3 (PASSED) |
| Primary approver | Data Architect · Supporting: Backend Engineer, Domain Expert |
| Closes conditions | **DA-1** (canonical serialisation), **DA-2** (scenario input snapshot) |

## Objective
Define an entity model, schema, event model, supply-chain graph, audit model, data classification and
seed design capable of representing the flagship scenario **completely** — including its governance
and audit dimensions, not merely its logistics.

---

## 1. Design Principles

1. **The graph is data, not code.** Facilities and lanes are rows; the routing engine traverses them.
   Adding a lane must never require a code change.
2. **Inventory is lot-level.** Aggregate stock cannot express shelf-life netting (REQ-012), which the
   Domain Expert made binding.
3. **Decisions are entities with lifecycles**, not booleans (REQ-034).
4. **Every derived artefact records what it was derived from.** Scenarios reference an input snapshot
   (DA-2); authorizations embed a payload hash (REQ-051).
5. **Append-only where integrity matters.** `audit_events`, `approvals`, `agent_invocations` have no
   update or delete path (REQ-082, REQ-040).
6. **Classification travels with the data** (REQ-100), never inferred at the UI.

## 2. Entity Model

### 2.1 Network graph
| Entity | Purpose | Key fields |
|---|---|---|
| `facility` | Supplier, manufacturer, DC, regional warehouse, hospital | `id`, `type`, `name`, `country`, `lat`, `lon`, `cold_chain_capable`, `capacity_units` |
| `lane` | Directed transport arc between facilities | `id`, `from_facility_id`, `to_facility_id`, `mode` (SEA/AIR/ROAD), `transit_hours`, `cost_per_unit_minor`, `reliability_pct`, `cold_chain_capable`, `capacity_units`, `status` |
| `supplier_product` | Which supplier can supply what, where | `supplier_id`, `product_id`, `lead_time_days`, `unit_cost_minor`, `capacity_units`, `qualified_markets` |

`facility` + `lane` form a directed weighted graph. Facility types are ordered by tier so traversal
can reason about upstream/downstream direction.

### 2.2 Product and inventory
| Entity | Purpose | Key fields |
|---|---|---|
| `product` | Medicine SKU | `id`, `name`, `form`, `criticality` (1–4), `requires_cold_chain`, `min_temp_c`, `max_temp_c`, `max_excursion_hours`, `daily_demand_units` |
| `inventory_lot` | Physical stock, lot-level | `id`, `product_id`, `facility_id`, `quantity_units`, `expiry_date`, `status` |
| `order_line` | Hospital demand with a need-by date | `id`, `product_id`, `destination_facility_id`, `quantity_units`, `need_by_date`, `priority` |
| `shipment` | In-flight goods on a lane | `id`, `product_id`, `quantity_units`, `origin/destination_facility_id`, `lane_id`, `departed_at`, `eta`, `status`, `temperature_excursion_hours` |

`max_excursion_hours` is the cold-chain time budget that REQ-022 gates on. It is a **CONFIGURABLE
RULE / SYNTHETIC** value, not a cited regulatory threshold.

### 2.3 Disruption and analysis
| Entity | Purpose |
|---|---|
| `disruption_event` | Ingested signal: structured fields + raw unstructured advisory text, plus agent classification (type, severity, confidence, geography, duration) |
| `impact_assessment` | Deterministic output: affected shipments/orders/facilities, per-site days-of-cover, projected stockout dates, do-nothing baseline |
| `input_snapshot` | **(DA-2)** Frozen, canonically serialised copy of every input used by an analysis, with its SHA-256 `snapshot_hash` |
| `scenario` | A candidate recovery option: `strategy_type`, actions, computed `cost_delta_minor`, `eta_hours`, `risk_score`, `feasibility` (FEASIBLE/INFEASIBLE/BLOCKED), `infeasibility_reason`, `rank`, `snapshot_id` |

### 2.4 Governance
| Entity | Purpose |
|---|---|
| `decision` | Proposal to act. `state` ∈ the ADR-0001 state machine; `version` for optimistic concurrency (F-8); `payload_hash` |
| `policy_evaluation` | `autonomy_class`, `required_roles[]`, `fired_rule_ids[]`, `policy_version` |
| `approval` | Full §10.3 evidence contract, append-only |
| `execution_authorization` | Minted only from an approved decision; embeds `decision_payload_hash`; single-use; `expires_at` |
| `execution_result` | What actually changed, with before/after references |
| `recovery_verification` | Recomputed impact after execution; `objective_met` boolean **plus** the numbers behind it |

### 2.5 Observability and audit
| Entity | Purpose |
|---|---|
| `agent_invocation` | Provider, model, prompt version, seam, inputs, tool calls, output, validation result, latency, fallback used (REQ-067) |
| `guardrail_event` | Every rejected agent output, invented entity, injection attempt, blocked action (REQ-063) |
| `audit_event` | Hash-chained ledger (§3) |

## 3. Audit Ledger and Canonical Serialisation (closes DA-1)

**The DA-1 concern:** hashing `JSON.stringify(obj)` is unsafe — key order, float formatting and
timezone rendering can vary, producing false verification failures.

**Canonical form (binding specification):**
1. Object keys sorted lexicographically (by UTF-16 code unit), recursively.
2. No insignificant whitespace.
3. Integers only for money and quantity — money in **minor units**, so no float formatting ever
   enters a hash.
4. Any unavoidable real number serialised with fixed 6-decimal precision.
5. Timestamps as UTC ISO-8601 with `Z`, millisecond precision.
6. `undefined` omitted; `null` preserved (they are semantically different here).
7. UTF-8 encoding before hashing.

**Chain:** `hash_n = SHA256( hash_{n-1} || canonical(event_payload) )`, genesis `hash_0` = 64 zeros.
Each `audit_event` stores `seq`, `prev_hash`, `payload_hash`, `chain_hash`.

**Verification** walks the chain recomputing every link. REQ-083 requires a test proving that mutating
any persisted row breaks verification.

**Honesty (per ADR-0003):** tamper-**evident** within one database. Not a blockchain, not externally
notarised. Anyone with write access to the file could rewrite the whole chain; what they cannot do is
alter one record and leave the chain intact.

## 4. Input Snapshots (closes DA-2)

Before impact analysis runs, the spine freezes every input it read — network state, lot positions,
shipment states, order lines, active disruption — into an `input_snapshot` row with a
`snapshot_hash` over its canonical form.

This single mechanism serves three separate requirements:
- **REQ-028** scenarios are reproducible because their inputs are recoverable.
- **REQ-038 / REQ-051** stale-approval detection: the authorization embeds the decision payload hash,
  which incorporates the snapshot hash. If reality moved, the hash mismatches and the approval is void.
- **REQ-014 / NFR-004** determinism is testable: replay the snapshot, assert identical output.

## 5. State Machine (persisted on `decision.state`)

```text
DETECTED ──► IMPACT_ASSESSED ──► SCENARIOS_GENERATED ──► RANKED ──► POLICY_EVALUATED
                                                                        │
                        ┌───────────────────────────────────────────────┤
                        ▼                        ▼                      ▼
                    AUTONOMOUS            PENDING_APPROVAL          BLOCKED (terminal)
                        │                   │        │
                        │            APPROVED    REJECTED (terminal)
                        │                   │
                        └────────►    EXECUTING
                                            ▼
                                   RECOVERY_VERIFIED ──► SEALED (terminal)
```

Transitions are validated against an explicit allow-list; an illegal transition raises and is logged.
`BLOCKED` and `REJECTED` are terminal — no role can revive them (REQ-039).

## 6. Data Classification (REQ-100)

Every table carries `data_classification`; every SAP-derived read carries `data_source`.

| Dataset | Classification | Note |
|---|---|---|
| Facilities, lanes, products, lots, orders, shipments | `SYNTHETIC` | Seeded, reproducible |
| Disruption advisory text | `SYNTHETIC` | Written for the scenario; realistic phrasing, invented event |
| Cold-chain thresholds, criticality tiers, shelf-life | `ASSUMED` + CONFIGURABLE RULE | **Not** cited regulation |
| Supplier qualification status | `ASSUMED` + CONFIGURABLE RULE | Models a real concept; values invented |
| Policy rules and thresholds | `ASSUMED` | Organisational policy examples |
| Material stock read via SAP port | `data_source` = `LIVE_SAP`/`SAP_SANDBOX`/`SIMULATED` | Never mislabelled (REQ-072) |
| Patient data | **absent by design** | REQ-105 |

## 7. Seed / Demo Data Design (REQ-101, REQ-102)

Deterministic, seeded generator producing the flagship network:

```text
2 API suppliers (1 primary, 1 alternate — alternate NOT qualified in one market)
      ↓
2 manufacturing sites
      ↓
1 central cold-chain DC
      ↓  SEA lane (primary, cold-chain, cheap, slow)  ← THE LANE THAT COLLAPSES
      ↓  AIR lane (fast, expensive, capacity-limited)
      ↓  SEA+ROAD alternate port route (cheaper, slower, excursion risk)
3 regional warehouses (differing days-of-cover: comfortable / tight / critical)
      ↓
6 hospitals with order lines and need-by dates
```

Tuned so the scenario is genuinely *interesting*: no single option wins on every axis.
- Air reroute: meets every need-by date, but breaches the cost threshold → **Finance escalation**.
- Alternate port: affordable, but the excursion budget is exceeded → **INFEASIBLE**, shown with reason.
- Inventory rebalancing: buys days for the critical site, but leaves another site thin → partial.
- Alternate supplier: viable for one market, **BLOCKED** for the other on qualification.

This guarantees the demo exercises FEASIBLE, INFEASIBLE, BLOCKED and MULTI-APPROVAL in one run rather
than needing four contrived runs.

## 8. Deliverables
Entity model · schema (`src/db/schema.sql`) · relationships · event model · supply-chain graph ·
audit model · data classification · seed design and implementation · determinism tests.

## 9. Verification
| Check | Method | Evidence |
|---|---|---|
| Flagship scenario fully representable | Walk P1 §8 against §2 entities | §7 mapping; every element has a table |
| DA-1 closed | Canonical spec §3 + implementation + test | `npm test` canonical/chain tests |
| DA-2 closed | `input_snapshot` §4 + FK from `scenario` | schema + test |
| Seed reproducible (REQ-101) | Generate twice, compare hashes | determinism test |
| Lot-level expiry present (REQ-103) | Schema inspection | `inventory_lot.expiry_date` |
| Per-market qualification (REQ-104) | Schema inspection | `supplier_product.qualified_markets` |
| No personal data (REQ-105) | Schema inspection | no person entity exists |
| Append-only integrity | Triggers blocking UPDATE/DELETE | schema triggers + test |

## 10. Known Issues / Open Risks
- SQLite single-writer (ADR-0005) — acceptable at demo scale; repository interface allows swap.
- Append-only is enforced by SQL triggers *and* the absence of update methods in the repository. A
  direct `sqlite3` CLI write could still bypass triggers with `PRAGMA ignore_check_constraints`; this
  is exactly why the hash chain exists as the second line of defence, and why we claim
  tamper-*evident* rather than tamper-*proof*.

## 11. Handoff → P5
Schema, canonical serialiser, hash chain, snapshot mechanism and seeded flagship network are
available. P5 builds the deterministic engines on top and owns conditions DE-1 and DE-2.
