# P10 — Testing

**Phase owner:** QA Engineer · **Reviewer:** Master Orchestrator
**Status:** COMPLETE · **Closes:** REQ-083, the D8-2 drift item, ADR-0005 determinism proof

---

## 1. Objective

Test the parts of the system that had never been executed by a test, and prove the two claims the
whole project rests on: **determinism** (identical inputs → byte-identical outputs) and
**bounded execution** (nothing changes the world except through an authorization).

## 2. Where the gaps actually were

Aggregate coverage at the start of P10 was 95.83% — a number that looked finished and was not.
The gaps were concentrated in exactly the wrong places:

| Module | Line cov. before | What was untested |
|---|---|---|
| `src/api/server.mjs` | 73.7% | **The entire HTTP routing table.** No test had ever made a request. |
| `src/core/execution.mjs` | 78.6% | `INVENTORY_TRANSFER`, `RELEASE_SHIPMENT`, and the **whole rollback path** |
| `src/core/pipeline.mjs` | 53.7% branch | `BLOCKED` and stale-approval branches |

This is the D8-2 lesson recurring: at P8 the suite was green while `/api/state` returned a 500,
because everything tested the functions *behind* the server. **A high aggregate is an average, and
an average hides the specific thing that is broken.**

## 3. What was added

| Suite | Tests | Focus |
|---|---|---|
| `tests/http.test.mjs` | 10 | Real server on an ephemeral port, real `fetch`. Routes, MIME, 404, provenance (REQ-093), typed errors (NFR-007), **path traversal**, read idempotence. |
| `tests/execution.test.mjs` | 13 | Stock conservation, FEFO ordering, over-draw refusal, version bumps (REQ-052), **transactional rollback**, authorization expiry/single-use/hash-binding. |
| `tests/determinism.test.mjs` | 14 | Seed reproducibility, published-hash verification, 6× repeat-run equality, total ordering, clock/PRNG bans, **schema-drift guard**, integer-money invariants, D10-1 regression. |

**Total: 167 → 204 tests.** Coverage 95.83% → **97.52%** lines, 86.76% → 87.55% branches, with
`execution.mjs` 78.6% → **96.8%** and `server.mjs` 73.7% → **92.2%**.

Three tests are worth calling out because they defend claims made elsewhere in the docs:

- **The published snapshot hash is asserted against the code.** `0dfe4d97…` is cited in the README
  and in the P4 approval record. If the fixture drifts, that test fails and the documentation stops
  being a lie by omission.
- **A rolled-back batch leaves the authorization unconsumed.** Burning an approval on a batch that
  wrote nothing would force a re-approval for work that never happened.
- **Reads are idempotent.** A `GET` that appends audit events or mutates state would make the
  audit trail a record of who looked, not who acted.

## 4. Defect found

| ID | Severity | Finding |
|---|---|---|
| **D10-1** | **HIGH** | `buildReroute` and `buildAltPort` resolve lanes by ID straight from the snapshot instead of through `buildGraph`, which was the only code that honoured `status === 'CLOSED'`. With **every lane in the network closed**, the engine still returned `AIR_REROUTE` as `FEASIBLE`, costed it, ranked it **first**, and would have executed a reroute onto a shut lane. |

Root cause: two ways to reach the same concept, one of which enforced a rule the other did not —
the same shape as D9-1 (`actionsFor` re-deriving actions) and D9-2 (two vocabularies for one
concept). **When a rule lives in one path and the caller takes another path, the rule is optional.**

Fix: a first-class `checkLaneAvailability()` constraint in `constraints.mjs`, emitting
`LANE_UNAVAILABLE`, wired into both path-based builders so it runs through the same
`evaluateConstraints` gate as cold-chain and capacity.

The fix is surgical — with lanes open the snapshot hash, scenario set and ranking are unchanged
(asserted by test), so the flagship result is not quietly rewritten by a bug fix.

**Why no test caught it:** every scenario test ran against the seeded fixture, where the disrupted
lane is closed but the *alternatives* are open. The engine was only ever asked questions to which
"open" was the right answer. Coverage was 100% on `scenarios.mjs` throughout.

## 5. Schema drift (D8-2, owed since P8)

`assertSchemaCurrent()` now has direct tests: a database missing a current column fails **at open
time** with the table, the column and the remedy in the message; a current database passes cleanly.

This remains a **drift guard, not a migration system**, and the phase does not pretend otherwise.
For a demonstration whose data is fully reproducible from `npm run seed`, "delete and reseed" is the
honest remedy. A real deployment with retained history would need versioned migrations — recorded
as a known limitation rather than silently closed.

## 6. Evidence

```
npm test              # 204/204
npm run test:coverage # 97.52% lines, 87.55% branches
npm run eval          # 17/17
npm run demo -- --approve   # SEALED, 16 events, chain valid
```
