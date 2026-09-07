# Changelog

Format: reverse-chronological, one entry per phase gate or material change.
A change to a requirement, architecture, data model, agent contract, SAP integration or major UI
workflow must appear here together with its propagation record (Master Prompt §27).

---

## [0.1.0] — 2026-09-07 — Phases P0–P3 baseline

### Added
- `docs/P0-repository-reconnaissance.md` — repository map, technology inventory, design-system
  assessment of `DESIGN.md`, documentation/test/integration inventories, risks R-01…R-06,
  findings R0-1…R0-3, constraints.
- `docs/P1-problem-definition.md` — problem statement, 5 personas with distinct decision
  authorities, primary journey and rejection counter-journey, failure modes F-1…F-8, KPIs K-1…K-8,
  scope and non-goals, flagship scenario (cold-chain lane collapse), Domain-Expert adversarial review.
- `docs/architecture.md` — three candidate architectures, 13-criterion weighted comparison
  (A=148, B=200, C=240 of 275), selected Architecture C, rejected alternatives with salvaged ideas,
  architectural rules AR-1…AR-7, logical diagram, verified SAP capability positioning.
- `docs/P2-architecture-review.md` — independent evaluations by Product Manager, Domain Expert,
  AI Architect, Data Architect, SAP Strategy Specialist and Competition Analyst; 10 binding
  conditions with owning phases.
- `docs/ADR/0001-deterministic-spine-with-bounded-agents.md`
- `docs/ADR/0002-ai-boundary-and-agent-authority.md`
- `docs/ADR/0003-governance-approval-and-audit-model.md`
- `docs/ADR/0004-sap-integration-strategy.md`
- `docs/SRS.md` — 62 functional + 12 non-functional requirements, v0.1.0 baseline.
- `docs/traceability.md` — 74/74 requirements traced; AR rules, P2 conditions and failure modes
  all covered; zero orphans.
- `docs/phase-plan.md` — gate status, dependency table, permitted parallelism, consolidated risk
  register, change-propagation procedure, per-phase definition of done.
- `docs/approvals.md` — approval records APR-P0-001, APR-P1-001, APR-P2-001, APR-P3-001.
- `README.md` — rewritten from a single heading to a project overview including an explicit
  "what we will not claim" honesty section.

### Decisions
- **D0-1** `Skiils.md` is provenance metadata, not a project dependency.
- **D0-2** `DESIGN.md` adopted unmodified as UI authority; changes only by additive extension.
- **D1-1** Single flagship scenario: cold-chain lane collapse.
- **D1-2** All demo data SYNTHETIC and labelled.
- **D1-3** The rejected-recommendation path is a first-class requirement.
- **ADR-0001** Deterministic spine with bounded agents at named seams.
- **ADR-0002** Field-level AI authority, server-side tool allow-lists, mandatory uncertainty.
- **ADR-0003** Declarative versioned policy, full approval evidence contract, hash-chained ledger.
- **ADR-0004** Typed SAP port with three honest runtime modes and a language contract.

### Unchanged
- `DESIGN.md` — preserved byte-for-byte as the design authority.
- `Skiils.md` — preserved as provenance.

### Not done (deliberately)
No application code, dependencies, build configuration or tests. Master Prompt §37 requires the
architecture gate to pass before implementation begins. P4 (Data Architecture) is the next phase.

### Open conditions carried forward
PM-1 (P8) · DE-1 (P5) · DE-2 (P5) · AI-1 (P6) · AI-2 (P11) · DA-1 (P4) · DA-2 (P4) · SAP-1 (P7) ·
SAP-2 (P18) · CA-2 (P6).

---

## [0.2.0] — 2026-09-07 — Phase P4: Data Architecture

### Added
- `docs/ADR/0005-technology-stack.md` — TypeScript/Node 22 + embedded SQLite + Express/Zod +
  React/Vite; four alternatives considered; determinism rules imposed on the stack
  (integer minor units, UTC strings, sorted iteration, seeded PRNG).
- `docs/data-model.md` — entity model, canonical-serialisation spec, snapshot mechanism, state
  machine, data classification table, flagship seed design.
- `src/db/schema.sql` — 22 STRICT tables covering network graph, product/inventory, disruption and
  analysis, governance, observability and the hash-chained ledger; append-only triggers.
- `src/core/canonical.mjs` — canonical serialisation and hashing (closes **DA-1**).
- `src/core/audit.mjs` — append-only hash-chained ledger with `verify()` and `export()`.
- `src/core/snapshot.mjs` — input snapshots and decision payload hashing (closes **DA-2**).
- `src/db/seed.mjs` + `scripts/seed.mjs` — seeded synthetic flagship network (14 facilities,
  18 lanes, 2 products, 9 lots, 7 orders, 4 shipments, 1 disruption advisory).
- `tests/` — 26 tests, all passing.
- `.gitignore`, `.env.example`, `package.json`.

### Conditions closed
**DA-1** (canonical serialisation) · **DA-2** (scenario input snapshot).

### Risks closed
**R-05** (no `.gitignore`) · **AR-R2** (hash chain never verified).

### Corrections made during verification
- **ADR-0005 verification correction:** the stack probe installed `better-sqlite3` unpinned
  (resolved 13.0.3, prebuilt) but `package.json` was written with `^11.0.0`, which has no prebuild
  for Node 22 and failed to compile offline. Pinned to `^13.0.3`. Lesson recorded: an unpinned probe
  does not verify the version you depend on.
- **Audit tamper test rewritten:** the first version was blocked by the append-only triggers, so the
  hash chain was never actually exercised. It now explicitly drops the triggers to simulate an
  attacker with raw file access — the actual threat model ADR-0003 addresses.
- **Empty-table assertion replaced:** a `throws` assertion against the unpopulated `approval` table
  would have passed for the wrong reason; replaced with a schema-level trigger assertion.

### Traceability
16 requirements moved off PENDING; 13 now VERIFIED with passing tests.
