# ADR-0004 — SAP Integration Strategy and Honesty Contract

- **Status:** ACCEPTED (design); implementation and claims gated on P7 evidence
- **Date:** 2026-09-07
- **Version:** 1.0
- **Deciders:** SAP Integration Engineer + SAP Strategy Specialist (primary); System Architect, Independent Auditor (observer)
- **Related:** ADR-0001

## Context
The solution must use SAP technology genuinely (Master Prompt §7 Role 11/12, P7) while §30 forbids
claiming an integration that does not exist. At P0 we confirmed **no SAP credentials are provisioned**
in this environment (assumption A-01), and demo-time connectivity is not guaranteed (A-02). The
failure mode to avoid is the most common hackathon dishonesty: a slide saying "Powered by SAP" over a
hard-coded JSON fixture.

## Verified SAP Capabilities (public documentation, checked 2026-09-07)
- SAP publishes S/4HANA Cloud OData APIs via the SAP Business Accelerator Hub with a sandbox base URL
  `https://sandbox.api.sap.com/s4hanacloud`, authenticated by an API key obtained from the Hub account
  settings; the sandbox is read-only sample data intended for development
  [3](https://prismatic.io/docs/components/sapS4Hana/).
- Relevant services include `API_MATERIAL_STOCK_SRV` (entity sets `A_MaterialStock`,
  `A_MatlStkInAcctMod`), `API_MRP_MATERIALS_SRV_01` (`A_MRPMaterial`, `SupplyDemandItems`), and
  `API_PRODUCTION_ORDER_2_SRV` [1](https://support.tulip.co/docs/sap-s4-hana-cloud-connector).
- Productive access uses communication arrangements and a communication user (basic auth) rather than
  the sandbox API key; OData V2 services require SICF activation while OData V4 requires the service
  group to be published
  [2](https://community.sap.com/t5/technology-blog-posts-by-members/api-consumption-s-4-hana-cloud-public-edition-and-s-4-hana-cloud-private/ba-p/14162598).
- SAP BTP offers a **Free Tier** (production-ready, no expiry, selected always-free plans) distinct
  from the 90-day **Trial**; SAP AI Core is available on Free Tier but **not** on Trial
  [3](https://github.com/SAP-archive/btp-ai-sustainability-bootcamp/blob/opensap-freetier/prerequisites/prerequisites.md),
  [2](https://bluestonex.com/knowledge-bank/the-ultimate-guide-to-sap-btp/).

Nothing above asserts that *we* have called these endpoints. That claim requires P7 evidence.

## Alternatives Considered
1. **No SAP; mention it only in the pitch.** Rejected — fails the theme and §30.
2. **Mock an "SAP-like" API and present it as SAP.** Rejected — direct §30 violation; would be found
   by the Independent Auditor and would be fatal under judge questioning.
3. **Full BTP deployment (CAP app on Cloud Foundry + AI Core) as the runtime.** Rejected for MVP —
   entitlement provisioning is outside our control (A-01) and would put the entire demo behind an
   account we may not obtain in time. Retained as the documented production path.
4. **Typed SAP port with three honest runtime modes, contract-tested against published OData shapes.**
   Selected.

## Decision

### 1. Where SAP sits in the workflow
The SAP Adapter implements the deterministic core's **inventory & product-master read port** and the
**approved-action write-back port**:

```text
Deterministic Core
  ├── InventoryPort.read_stock(material, plant)   → S/4HANA API_MATERIAL_STOCK_SRV / A_MaterialStock
  ├── MaterialPort.read_master(material)          → API_PRODUCT_SRV
  ├── SupplyDemandPort.read(material, plant)      → API_MRP_MATERIALS_SRV_01 / SupplyDemandItems
  └── WritebackPort.post_approved_action(intent)  → executed ONLY with an ExecutionAuthorization
```

Days-of-cover — the number the whole flagship scenario turns on — is computed from stock read through
this port. That is a concrete, defensible answer to "where exactly is SAP used?".

### 2. Three honest runtime modes
Every response from the port carries `data_source ∈ {LIVE_SAP, SAP_SANDBOX, SIMULATED}` and a
`fetched_at`. The API contract requires the field; the UI renders it as a badge on every screen that
displays stock-derived figures; a test asserts that a simulated response can never be labelled live.

### 3. Resilience
Timeout, bounded retry, and a circuit breaker. On open circuit the adapter returns SIMULATED data with
the badge changed — the workflow continues (supply-chain resilience software that cannot survive its
own dependency failing would be self-refuting), but it never lies about provenance.

### 4. Contract testing without credentials
Response parsing/mapping is tested against fixtures whose **shape** is taken from published OData
metadata for the named services. These are labelled `SAP_SANDBOX_SHAPE_FIXTURE` — they prove our
mapping is correct, they do **not** prove connectivity. Live connectivity evidence (request, redacted
response, timestamp) is attached in P7 only if a key is provisioned.

### 5. Permitted and forbidden language (condition SAP-1)
- Permitted now: *"Implements the SAP S/4HANA Cloud OData contract for material stock; currently
  running against simulated data — see the data-source badge."*
- Forbidden until evidence exists: *"Integrated with SAP"*, *"live SAP data"*, *"Powered by SAP AI Core"*.
- BTP/AI Core is described as the **documented production deployment path**, not as current state.

### 6. Production path (documented, not claimed)
CAP/Node service on BTP Cloud Foundry; destination service for S/4HANA connectivity; XSUAA for
role-based auth replacing the MVP simulated role login; SAP AI Core / Generative AI Hub as an
implementation of the `LanguageModelProvider` interface (ADR-0002 §7) — a swap, not a rewrite,
which is itself evidence the abstraction was worth building.

## Consequences
- We can state exactly where SAP is, at field level, and defend it.
- The demo cannot be broken by SAP connectivity failing.
- Cost: we cannot claim a live enterprise integration unless a key appears. Accepted — an honest
  narrow claim survives questioning; an inflated one does not.

## Risks
| Risk | Mitigation |
|---|---|
| Adapter falls back silently and someone says "live" on stage (AR-R4) | Mandatory badge + test + condition SAP-2 (fallback shown deliberately during the demo) |
| Judges read "simulated" as "no SAP work done" | Show the typed contract, the mapping tests, and the production path in one slide |
| OData field names drift between releases | Mapping isolated in one module with versioned fixtures |
