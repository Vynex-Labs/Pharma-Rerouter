-- Pharma-Rerouter — schema (P4 Data Architecture)
-- Authority: docs/data-model.md, ADR-0005 (stack), ADR-0003 (governance/audit)
--
-- Conventions (ADR-0005 determinism rules):
--   * money  -> INTEGER minor units  (never REAL — floats must not reach a hash)
--   * qty    -> INTEGER units
--   * time   -> TEXT, UTC ISO-8601 with 'Z'
--   * dates  -> TEXT, 'YYYY-MM-DD'
--   * every table carries data_classification (REQ-100)

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ============================================================ NETWORK GRAPH

CREATE TABLE IF NOT EXISTS facility (
  id                  TEXT PRIMARY KEY,
  type                TEXT NOT NULL CHECK (type IN
                        ('SUPPLIER','MANUFACTURER','DC','WAREHOUSE','HOSPITAL')),
  tier                INTEGER NOT NULL,           -- upstream(1) .. downstream(5)
  name                TEXT NOT NULL,
  country             TEXT NOT NULL,
  market              TEXT NOT NULL,              -- destination market for qualification checks
  lat                 REAL NOT NULL,
  lon                 REAL NOT NULL,
  cold_chain_capable  INTEGER NOT NULL CHECK (cold_chain_capable IN (0,1)),
  capacity_units      INTEGER NOT NULL,
  data_classification TEXT NOT NULL DEFAULT 'SYNTHETIC'
) STRICT;

CREATE TABLE IF NOT EXISTS lane (
  id                  TEXT PRIMARY KEY,
  from_facility_id    TEXT NOT NULL REFERENCES facility(id),
  to_facility_id      TEXT NOT NULL REFERENCES facility(id),
  mode                TEXT NOT NULL CHECK (mode IN ('SEA','AIR','ROAD','RAIL')),
  transit_hours       INTEGER NOT NULL,
  cost_per_unit_minor INTEGER NOT NULL,
  reliability_pct     INTEGER NOT NULL CHECK (reliability_pct BETWEEN 0 AND 100),
  cold_chain_capable  INTEGER NOT NULL CHECK (cold_chain_capable IN (0,1)),
  -- hours the payload spends outside guaranteed temperature control on this lane.
  -- ASSUMED / CONFIGURABLE RULE — not a cited regulatory figure.
  excursion_hours     INTEGER NOT NULL DEFAULT 0,
  capacity_units      INTEGER NOT NULL,
  status              TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','DEGRADED','CLOSED')),
  data_classification TEXT NOT NULL DEFAULT 'SYNTHETIC'
) STRICT;

CREATE INDEX IF NOT EXISTS idx_lane_from ON lane(from_facility_id);
CREATE INDEX IF NOT EXISTS idx_lane_to   ON lane(to_facility_id);

-- ============================================================ PRODUCT & INVENTORY

CREATE TABLE IF NOT EXISTS product (
  id                   TEXT PRIMARY KEY,
  sap_material_number  TEXT,                      -- maps to S/4HANA Material (ADR-0004)
  name                 TEXT NOT NULL,
  form                 TEXT NOT NULL,
  criticality          INTEGER NOT NULL CHECK (criticality BETWEEN 1 AND 4), -- 4 = life-critical
  requires_cold_chain  INTEGER NOT NULL CHECK (requires_cold_chain IN (0,1)),
  min_temp_c           REAL,
  max_temp_c           REAL,
  -- cold-chain time budget gating REQ-022. ASSUMED / CONFIGURABLE RULE.
  max_excursion_hours  INTEGER NOT NULL DEFAULT 0,
  shelf_life_days      INTEGER NOT NULL,
  data_classification  TEXT NOT NULL DEFAULT 'SYNTHETIC'
) STRICT;

CREATE TABLE IF NOT EXISTS inventory_lot (
  id                  TEXT PRIMARY KEY,
  product_id          TEXT NOT NULL REFERENCES product(id),
  facility_id         TEXT NOT NULL REFERENCES facility(id),
  quantity_units      INTEGER NOT NULL CHECK (quantity_units >= 0),
  expiry_date         TEXT NOT NULL,              -- REQ-103 shelf-life netting
  status              TEXT NOT NULL DEFAULT 'AVAILABLE'
                        CHECK (status IN ('AVAILABLE','QUARANTINE','EXPIRED','CONSUMED')),
  data_source         TEXT NOT NULL DEFAULT 'SIMULATED'
                        CHECK (data_source IN ('LIVE_SAP','SAP_SANDBOX','SIMULATED')),
  fetched_at          TEXT,
  data_classification TEXT NOT NULL DEFAULT 'SYNTHETIC'
) STRICT;

CREATE INDEX IF NOT EXISTS idx_lot_prod_fac ON inventory_lot(product_id, facility_id);

CREATE TABLE IF NOT EXISTS demand_rate (
  product_id          TEXT NOT NULL REFERENCES product(id),
  facility_id         TEXT NOT NULL REFERENCES facility(id),
  daily_demand_units  INTEGER NOT NULL CHECK (daily_demand_units >= 0),
  data_classification TEXT NOT NULL DEFAULT 'SYNTHETIC',
  PRIMARY KEY (product_id, facility_id)
) STRICT;

CREATE TABLE IF NOT EXISTS order_line (
  id                      TEXT PRIMARY KEY,
  product_id              TEXT NOT NULL REFERENCES product(id),
  destination_facility_id TEXT NOT NULL REFERENCES facility(id),
  quantity_units          INTEGER NOT NULL CHECK (quantity_units > 0),
  need_by_date            TEXT NOT NULL,
  priority                INTEGER NOT NULL CHECK (priority BETWEEN 1 AND 4),
  status                  TEXT NOT NULL DEFAULT 'OPEN'
                            CHECK (status IN ('OPEN','AT_RISK','FULFILLED','MISSED')),
  data_classification     TEXT NOT NULL DEFAULT 'SYNTHETIC'
) STRICT;

CREATE TABLE IF NOT EXISTS shipment (
  id                       TEXT PRIMARY KEY,
  product_id               TEXT NOT NULL REFERENCES product(id),
  quantity_units           INTEGER NOT NULL CHECK (quantity_units > 0),
  origin_facility_id       TEXT NOT NULL REFERENCES facility(id),
  destination_facility_id  TEXT NOT NULL REFERENCES facility(id),
  lane_id                  TEXT REFERENCES lane(id),
  departed_at              TEXT,
  eta                      TEXT,
  status                   TEXT NOT NULL DEFAULT 'IN_TRANSIT'
                             CHECK (status IN ('PLANNED','IN_TRANSIT','HELD','REROUTED',
                                               'DELIVERED','LOST')),
  temperature_excursion_hours INTEGER NOT NULL DEFAULT 0,
  version                  INTEGER NOT NULL DEFAULT 1,   -- optimistic concurrency (F-8)
  data_classification      TEXT NOT NULL DEFAULT 'SYNTHETIC'
) STRICT;

CREATE TABLE IF NOT EXISTS supplier_product (
  supplier_id         TEXT NOT NULL REFERENCES facility(id),
  product_id          TEXT NOT NULL REFERENCES product(id),
  lead_time_days      INTEGER NOT NULL,
  unit_cost_minor     INTEGER NOT NULL,
  capacity_units      INTEGER NOT NULL,
  -- REQ-104: per-market qualification. CONFIGURABLE RULE, models a real concept
  -- with invented values. Comma-delimited market codes.
  qualified_markets   TEXT NOT NULL DEFAULT '',
  data_classification TEXT NOT NULL DEFAULT 'ASSUMED',
  PRIMARY KEY (supplier_id, product_id)
) STRICT;

-- ============================================================ DISRUPTION & ANALYSIS

CREATE TABLE IF NOT EXISTS disruption_event (
  id                   TEXT PRIMARY KEY,
  detected_at          TEXT NOT NULL,
  raw_advisory_text    TEXT,                      -- UNTRUSTED input (ADR-0002 §5)
  reported_lane_id     TEXT REFERENCES lane(id),
  reported_facility_id TEXT REFERENCES facility(id),
  -- agent-classified fields (seam S1). Non-authoritative for quantities.
  event_type           TEXT,
  severity             TEXT CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  confidence           REAL CHECK (confidence BETWEEN 0 AND 1),
  geography            TEXT,
  expected_duration_hours INTEGER,
  classification_source TEXT NOT NULL DEFAULT 'DETERMINISTIC_FALLBACK'
                         CHECK (classification_source IN ('AGENT','DETERMINISTIC_FALLBACK')),
  data_classification  TEXT NOT NULL DEFAULT 'SYNTHETIC'
) STRICT;

-- DA-2 / REQ-028: frozen inputs behind every analysis
CREATE TABLE IF NOT EXISTS input_snapshot (
  id             TEXT PRIMARY KEY,
  created_at     TEXT NOT NULL,
  snapshot_hash  TEXT NOT NULL,                   -- SHA-256 over canonical form
  payload_json   TEXT NOT NULL                    -- canonical serialisation
) STRICT;

CREATE TABLE IF NOT EXISTS impact_assessment (
  id                  TEXT PRIMARY KEY,
  disruption_id       TEXT NOT NULL REFERENCES disruption_event(id),
  snapshot_id         TEXT NOT NULL REFERENCES input_snapshot(id),
  created_at          TEXT NOT NULL,
  affected_json       TEXT NOT NULL,              -- shipments / orders / facilities / lanes
  days_of_cover_json  TEXT NOT NULL,              -- per site+product, shelf-life netted
  baseline_json       TEXT NOT NULL,              -- do-nothing baseline (REQ-013)
  narrative           TEXT,                       -- agent prose (seam S2), non-authoritative
  narrative_source    TEXT NOT NULL DEFAULT 'DETERMINISTIC_FALLBACK'
                        CHECK (narrative_source IN ('AGENT','DETERMINISTIC_FALLBACK'))
) STRICT;

CREATE TABLE IF NOT EXISTS scenario (
  id                  TEXT PRIMARY KEY,
  impact_id           TEXT NOT NULL REFERENCES impact_assessment(id),
  snapshot_id         TEXT NOT NULL REFERENCES input_snapshot(id),   -- DA-2
  strategy_type       TEXT NOT NULL,              -- DO_NOTHING | AIR_REROUTE | ALT_PORT |
                                                  -- INVENTORY_REBALANCE | ALT_SUPPLIER
  origin              TEXT NOT NULL DEFAULT 'ENGINE'
                        CHECK (origin IN ('ENGINE','AGENT_INTENT')),  -- CA-2 evidence
  actions_json        TEXT NOT NULL,
  cost_delta_minor    INTEGER NOT NULL,           -- engine-computed (AR-1)
  eta_hours           INTEGER NOT NULL,
  risk_score          INTEGER NOT NULL,
  orders_protected    INTEGER NOT NULL,
  feasibility         TEXT NOT NULL CHECK (feasibility IN ('FEASIBLE','INFEASIBLE','BLOCKED')),
  infeasibility_reason TEXT,                      -- REQ-024: never silently dropped
  score               INTEGER,
  rank                INTEGER,
  rationale           TEXT,                       -- agent prose, non-authoritative
  rationale_source    TEXT NOT NULL DEFAULT 'DETERMINISTIC_FALLBACK'
                        CHECK (rationale_source IN ('AGENT','DETERMINISTIC_FALLBACK'))
) STRICT;

-- ============================================================ GOVERNANCE

CREATE TABLE IF NOT EXISTS decision (
  id                TEXT PRIMARY KEY,
  disruption_id     TEXT NOT NULL REFERENCES disruption_event(id),
  impact_id         TEXT REFERENCES impact_assessment(id),
  selected_scenario_id TEXT REFERENCES scenario(id),
  state             TEXT NOT NULL CHECK (state IN
                      ('DETECTED','IMPACT_ASSESSED','SCENARIOS_GENERATED','RANKED',
                       'POLICY_EVALUATED','PENDING_APPROVAL','APPROVED','REJECTED',
                       'BLOCKED','EXECUTING','RECOVERY_VERIFIED','SEALED')),
  version           INTEGER NOT NULL DEFAULT 1,   -- F-8 optimistic concurrency
  payload_hash      TEXT,                         -- REQ-051 staleness detection
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  system_version    TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS policy_evaluation (
  id              TEXT PRIMARY KEY,
  decision_id     TEXT NOT NULL REFERENCES decision(id),
  evaluated_at    TEXT NOT NULL,
  autonomy_class  TEXT NOT NULL CHECK (autonomy_class IN
                    ('AUTONOMOUS','RECOMMENDED','APPROVAL_REQUIRED','BLOCKED')),
  required_roles_json TEXT NOT NULL,
  fired_rules_json    TEXT NOT NULL,
  policy_version  TEXT NOT NULL,                  -- REQ-041
  reason          TEXT NOT NULL
) STRICT;

-- REQ-034 full §10.3 evidence contract. Append-only (REQ-040).
CREATE TABLE IF NOT EXISTS approval (
  id                     TEXT PRIMARY KEY,
  decision_id            TEXT NOT NULL REFERENCES decision(id),
  request_id             TEXT NOT NULL,
  requested_action       TEXT NOT NULL,
  reason                 TEXT NOT NULL,
  risk_classification    TEXT NOT NULL,
  policy_evaluation_id   TEXT NOT NULL REFERENCES policy_evaluation(id),
  required_role          TEXT NOT NULL,
  approver_identity      TEXT NOT NULL,
  approver_roles_json    TEXT NOT NULL,
  decided_at             TEXT NOT NULL,
  decision_value         TEXT NOT NULL CHECK (decision_value IN ('APPROVED','REJECTED')),
  comments               TEXT,
  snapshot_id            TEXT NOT NULL REFERENCES input_snapshot(id),
  selected_scenario_id   TEXT REFERENCES scenario(id),
  alternatives_json      TEXT NOT NULL,
  policy_version         TEXT NOT NULL,
  system_version         TEXT NOT NULL,
  agent_recommendation   TEXT,
  agent_confidence       REAL,
  agent_uncertainty      TEXT,
  decision_payload_hash  TEXT NOT NULL,
  supersedes_id          TEXT REFERENCES approval(id)   -- corrections, never edits
) STRICT;

CREATE TABLE IF NOT EXISTS execution_authorization (
  id                    TEXT PRIMARY KEY,
  decision_id           TEXT NOT NULL REFERENCES decision(id),
  minted_at             TEXT NOT NULL,
  expires_at            TEXT NOT NULL,
  decision_payload_hash TEXT NOT NULL,            -- REQ-051 void on mismatch
  approvals_json        TEXT NOT NULL,
  consumed_at           TEXT                      -- single use
) STRICT;

CREATE TABLE IF NOT EXISTS execution_result (
  id               TEXT PRIMARY KEY,
  decision_id      TEXT NOT NULL REFERENCES decision(id),
  authorization_id TEXT NOT NULL REFERENCES execution_authorization(id),
  executed_at      TEXT NOT NULL,
  changes_json     TEXT NOT NULL,                 -- before/after
  outcome          TEXT NOT NULL CHECK (outcome IN ('SUCCESS','PARTIAL','FAILED')),
  notes            TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS recovery_verification (
  id             TEXT PRIMARY KEY,
  decision_id    TEXT NOT NULL REFERENCES decision(id),
  verified_at    TEXT NOT NULL,
  objective_met  INTEGER NOT NULL CHECK (objective_met IN (0,1)),
  before_json    TEXT NOT NULL,
  after_json     TEXT NOT NULL,
  notes          TEXT
) STRICT;

-- ============================================================ OBSERVABILITY & AUDIT

CREATE TABLE IF NOT EXISTS agent_invocation (
  id                 TEXT PRIMARY KEY,
  decision_id        TEXT REFERENCES decision(id),
  seam               TEXT NOT NULL,               -- S1,S2,S3,S5,S6,ORCHESTRATOR
  agent_name         TEXT NOT NULL,
  provider           TEXT NOT NULL,
  model              TEXT NOT NULL,
  prompt_version     TEXT NOT NULL,
  started_at         TEXT NOT NULL,
  latency_ms         INTEGER NOT NULL,
  input_json         TEXT NOT NULL,
  tool_calls_json    TEXT NOT NULL,
  output_json        TEXT,
  validation_result  TEXT NOT NULL CHECK (validation_result IN
                       ('VALID','SCHEMA_INVALID','REFERENTIAL_INVALID','PROVIDER_ERROR')),
  confidence         REAL,
  uncertainty        TEXT,
  fallback_used      INTEGER NOT NULL DEFAULT 0 CHECK (fallback_used IN (0,1)),
  -- D8-1: a record claiming VALID + fallback_used=1 must be able to say WHY.
  fallback_reason    TEXT CHECK (fallback_reason IN
                       ('PROVIDER_ERROR','SCHEMA_INVALID','REFERENTIAL_INVALID','EMPTY_OUTPUT')),
  attempts           INTEGER NOT NULL DEFAULT 1 CHECK (attempts >= 1),
  CHECK (fallback_used = 0 OR fallback_reason IS NOT NULL)
) STRICT;

CREATE TABLE IF NOT EXISTS guardrail_event (
  id           TEXT PRIMARY KEY,
  occurred_at  TEXT NOT NULL,
  kind         TEXT NOT NULL,                     -- INVENTED_ENTITY | SCHEMA_VIOLATION |
                                                  -- INJECTION_SUSPECTED | BLOCKED_ACTION |
                                                  -- STALE_APPROVAL | UNAUTHORIZED_APPROVAL
  severity     TEXT NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  actor        TEXT NOT NULL,
  detail_json  TEXT NOT NULL,
  decision_id  TEXT REFERENCES decision(id)
) STRICT;

-- Hash-chained ledger (ADR-0003 §5, DA-1). Append-only, enforced by triggers below.
CREATE TABLE IF NOT EXISTS audit_event (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id     TEXT NOT NULL UNIQUE,
  occurred_at  TEXT NOT NULL,
  event_type   TEXT NOT NULL,
  decision_id  TEXT REFERENCES decision(id),
  actor        TEXT NOT NULL,
  payload_json TEXT NOT NULL,                     -- canonical serialisation
  prev_hash    TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  chain_hash   TEXT NOT NULL
) STRICT;

-- REQ-082 / REQ-040: no update, no delete. Second line of defence is the chain itself.
CREATE TRIGGER IF NOT EXISTS audit_event_no_update
  BEFORE UPDATE ON audit_event
  BEGIN SELECT RAISE(ABORT, 'audit_event is append-only'); END;

CREATE TRIGGER IF NOT EXISTS audit_event_no_delete
  BEFORE DELETE ON audit_event
  BEGIN SELECT RAISE(ABORT, 'audit_event is append-only'); END;

CREATE TRIGGER IF NOT EXISTS approval_no_update
  BEFORE UPDATE ON approval
  BEGIN SELECT RAISE(ABORT, 'approval is append-only; create a superseding record'); END;

CREATE TRIGGER IF NOT EXISTS approval_no_delete
  BEFORE DELETE ON approval
  BEGIN SELECT RAISE(ABORT, 'approval is append-only'); END;

CREATE TRIGGER IF NOT EXISTS guardrail_no_delete
  BEFORE DELETE ON guardrail_event
  BEGIN SELECT RAISE(ABORT, 'guardrail_event is append-only'); END;
