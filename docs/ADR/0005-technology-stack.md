# ADR-0005 — Technology Stack

- **Status:** ACCEPTED
- **Date:** 2026-09-07
- **Version:** 1.0
- **Deciders:** System Architect (primary); Backend Engineer, Data Architect, Frontend Engineer, QA
- **Related:** ADR-0001 (must not compromise the deterministic spine), ADR-0004 (must not block the BTP path)

## Context
P4 cannot define a schema without knowing the persistence technology, and P0 left the stack open
(Node 22 and Python 3.11 both available). The choice must serve: a deterministic, reproducible core
(NFR-004); a demo that cannot fail on a conference network; typed contracts end-to-end (AR-2); and a
credible migration path to SAP BTP (ADR-0004 §6) without a rewrite.

## Alternatives Considered

1. **Python (FastAPI + SQLAlchemy + PostgreSQL), React frontend.**
   Strong optimisation ecosystem (OR-Tools, NetworkX, PuLP). Rejected as primary: two languages
   across the stack doubles the contract surface between frontend and backend, and Postgres adds a
   service dependency that can fail at demo time. The OR advantage is real but our scenario count is
   small — we need correct multi-criteria ranking over a handful of candidates, not a large MILP.

2. **TypeScript everywhere (Node + Express + PostgreSQL + React).**
   Single language, shared types. Rejected only on the database: Postgres requires a running server,
   container or cloud instance. For a hackathon demo that must survive an unreliable network, an
   embedded database is strictly safer.

3. **TypeScript everywhere with embedded SQLite (better-sqlite3), React + Vite frontend.**
   **Selected.**

4. **SAP CAP (Cloud Application Programming) on BTP as the primary runtime.**
   Rejected for MVP for the reason given in ADR-0004 alternative 3: it puts the entire demo behind
   entitlements we do not control (assumption A-01). Retained as the documented production path.

## Decision

| Layer | Choice | Reason |
|---|---|---|
| Language | **TypeScript 5.x** (strict) | One language across spine, engines, agents, adapter and UI; types *are* the contracts required by AR-2 |
| Runtime | **Node.js 22** | Verified present; native `node:test` runner and `--experimental-strip-types` reduce tooling weight |
| Database | **SQLite via `better-sqlite3`** | Embedded — zero services to start, cannot fail at demo time; synchronous API removes async races in the deterministic core; WAL + `STRICT` tables give real typing |
| API | **Express + Zod** | Zod schemas validate at the boundary (NFR-007) *and* validate agent output (AR-2) from a single definition |
| Frontend | **React + Vite** | Fast HMR; Vite dev-server proxy keeps browser calls relative (required by the preview environment) |
| Tests | **`node:test` + `c8`** | No extra framework; coverage for NFR-009 |
| LLM | **Provider interface, no SDK lock-in** | AR-7 / ADR-0002 §7; a `MockProvider` keeps the whole suite runnable offline |

### Determinism requirements imposed on the stack
- No floating-point currency. Money is stored as **integer minor units**; quantities as integers.
- All timestamps are **UTC ISO-8601 strings**; no local time reaches the database.
- Any iteration that feeds a hash or a ranking is over a **sorted** key list (supports DA-1).
- Randomness in seed generation uses an explicit **seeded PRNG**, never `Math.random()` (REQ-101).

## Consequences

**Positive**
- The entire test suite, the deterministic core and the demo run with no network and no services.
- Shared TypeScript types remove an entire class of frontend/backend contract drift.
- `better-sqlite3` being synchronous means the spine's state transitions are trivially atomic within
  a transaction — no partially applied state machine step.

**Negative / accepted**
- SQLite is single-writer. Irrelevant at demo scale; would need Postgres for real concurrency. The
  repository layer is therefore kept behind an interface so the driver can be swapped.
- No OR-Tools. Accepted: our scenario evaluation is exhaustive over a small candidate set with a
  documented weighted-sum MCDA, which is more explainable to a judge than an opaque solver anyway.
- `better-sqlite3` is a native module requiring a build toolchain. Verified working in this
  environment before this ADR was accepted (probe: install + in-memory insert/select round-trip).

## Risks
| Risk | Mitigation |
|---|---|
| Native module fails on a different machine | Node 22 prebuilds available; documented in README setup |
| SQLite mistaken for production-grade choice | Stated explicitly as an MVP decision here and in `docs/data-model.md` |
| Weighted-sum MCDA criticised as simplistic | Weights are visible and configurable in the UI (REQ-025); we defend explainability over sophistication |

## Verification
Probe executed 2026-09-07 before acceptance: `npm install better-sqlite3` succeeded and an in-memory
create/insert/select round-trip returned the expected row. Node 22.22.3 confirmed.

### Verification correction (2026-09-07, same day)
The initial probe installed `better-sqlite3` **unpinned** and resolved to **13.0.3**, which ships a
prebuilt binary for Node 22 on this platform. `package.json` was then written with `^11.0.0`, which
has **no matching prebuild**; the install fell through to `node-gyp rebuild`, which failed because
the sandbox could not fetch Node headers over TLS.

**Correction:** pinned to `^13.0.3` — the version actually verified. Install now succeeds in 580 ms
with no compilation.

**Lesson recorded (it generalises):** a probe that does not pin the version does not verify the
version you later depend on. Risk row "native module fails on a different machine" is upgraded from
theoretical to **observed**, and the mitigation is strengthened: the dependency must be pinned to a
release with a prebuild for the target Node major, and CI (P10) must run `npm ci` on a clean cache to
catch a regression rather than discovering it at demo time.
