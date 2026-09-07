# P7 — SAP Integration · Phase Output Package

**Status:** COMPLETE (contract implemented; connectivity UNVERIFIED) · **Date:** 2026-09-07 · **Gate:** PASS WITH CONDITION

## 1. Objective
Implement a genuine SAP S/4HANA Cloud OData integration contract, with provenance labelling that
cannot lie and graceful degradation when SAP is unavailable.

## 2. What is real, and what is not

**Real:**
- The OData service paths, entity sets and field names are taken from SAP's published API contract:
  `API_MATERIAL_STOCK_SRV/A_MaterialStock`, `API_MRP_MATERIALS_SRV_01/SupplyDemandItems`,
  `API_PRODUCT_SRV/A_Product`.
- The client handles OData **V2** (`d.results`) and **V4** (`value`) envelope shapes.
- Field mapping is tested against fixtures reproducing those documented response shapes.
- Auth is via the `APIKey` header, as SAP's sandbox requires.
- Retry, circuit breaker (threshold 3, cooldown 30 s) and degradation are implemented and tested.

**Not real:**
- **No request has ever been sent to SAP from this project.** No API key is provisioned in this
  environment (assumption A-01).
- The fixtures prove our *mapping* is correct against the published contract. They do **not** prove
  connectivity, and are labelled `SAP_SANDBOX_SHAPE_FIXTURE` in the source to prevent that misreading.
- The SAP sandbox is read-only sample data; real writes would require an S/4HANA tenant and a
  communication arrangement (e.g. `SAP_COM_0009`).

## 3. The honesty mechanism
The dangerous failure is a demo where `SAP_MODE=LIVE_SAP` is set with no credentials and the UI
shows a green "Live SAP" badge over simulated numbers. The constructor makes that impossible:
it **downgrades** `LIVE_SAP`/`SAP_SANDBOX` to `SIMULATED` when no API key is present and records
`downgradeReason`. The badge is derived from the effective mode, never the requested one.

Every response is enveloped `{ rows, dataSource, fetchedAt, service }` — no code path can return
data without provenance. Failures and an open breaker degrade to `SIMULATED` with `degraded: true`.

`describe().claim` reads: *"SAP S/4HANA Cloud OData contract implemented; running against SIMULATED
data."* Forbidden phrasings — "Integrated with SAP", "live SAP data", "Powered by SAP AI Core" —
are named in the module header and asserted absent by test.

## 4. Deliverables
| Artifact | Path |
|---|---|
| Adapter, circuit breaker, mapping | `src/sap/adapter.mjs` |
| Contract-shape fixtures + simulator | `src/sap/fixtures.mjs` |
| Tests (12) | `tests/sap.test.mjs` |

## 5. Condition SAP-1
**REMAINS OPEN — by design.** Connectivity may be claimed only when a redacted real
request/response pair is attached here. It is not, so no such claim is made anywhere in the
codebase, the UI, or the presentation. The condition is satisfied in the sense that *no unsupported
claim exists*; it is not satisfied in the sense of *verified connectivity*.

## 6. Honest limitations
- Zero verified round-trips against SAP.
- Write-back is out of scope; the adapter is read-only.
- Material numbers in seed data are synthetic and follow SAP's 18-char padded format for shape only.
