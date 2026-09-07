/**
 * SAP S/4HANA Cloud OData adapter.
 *
 * Authority: ADR-0004. Requirements: REQ-070..076.
 *
 * ============================ HONESTY CONTRACT (ADR-0004 §5) ============================
 * At the time of writing NO SAP credentials are provisioned (assumption A-01). This module
 * implements the published OData contract and is exercised against fixtures whose SHAPE is taken
 * from the public service metadata. That proves our MAPPING is correct. It does NOT prove
 * connectivity, and nothing in this repository may claim otherwise until P7 attaches a real
 * request/response pair.
 *
 * Permitted phrasing:  "Implements the SAP S/4HANA Cloud OData contract for material stock;
 *                       currently running against simulated data — see the data-source badge."
 * Forbidden phrasing:  "Integrated with SAP", "live SAP data", "Powered by SAP AI Core".
 * ========================================================================================
 *
 * Verified public references (checked 2026-09-07):
 *  - sandbox base https://sandbox.api.sap.com/s4hanacloud with API-key auth
 *  - API_MATERIAL_STOCK_SRV entity sets A_MaterialStock / A_MatlStkInAcctMod
 *  - API_MRP_MATERIALS_SRV_01 entity sets A_MRPMaterial / SupplyDemandItems
 *  - productive access via communication arrangement + communication user (basic auth)
 */

export const DATA_SOURCES = Object.freeze(['LIVE_SAP', 'SAP_SANDBOX', 'SIMULATED']);

export const SERVICES = Object.freeze({
  materialStock: {
    service: 'API_MATERIAL_STOCK_SRV',
    entitySet: 'A_MaterialStock',
    path: '/sap/opu/odata/sap/API_MATERIAL_STOCK_SRV/A_MaterialStock',
  },
  supplyDemand: {
    service: 'API_MRP_MATERIALS_SRV_01',
    entitySet: 'SupplyDemandItems',
    path: '/sap/opu/odata/sap/API_MRP_MATERIALS_SRV_01/SupplyDemandItems',
  },
  product: {
    service: 'API_PRODUCT_SRV',
    entitySet: 'A_Product',
    path: '/sap/opu/odata/sap/API_PRODUCT_SRV/A_Product',
  },
});

/** REQ-073 — a resilience platform whose own dependency failure breaks it would be self-refuting. */
export class CircuitBreaker {
  constructor({ threshold = 3, cooldownMs = 30_000 } = {}) {
    this.threshold = threshold;
    this.cooldownMs = cooldownMs;
    this.failures = 0;
    this.openedAt = null;
  }
  get isOpen() {
    if (this.openedAt === null) return false;
    if (Date.now() - this.openedAt > this.cooldownMs) {
      this.failures = 0;
      this.openedAt = null;
      return false;
    }
    return true;
  }
  recordSuccess() { this.failures = 0; this.openedAt = null; }
  recordFailure() {
    this.failures += 1;
    if (this.failures >= this.threshold) this.openedAt = Date.now();
  }
}

/**
 * Map an OData A_MaterialStock row to our domain shape.
 * Isolated here so a field rename in a future S/4HANA release touches exactly one function.
 */
export function mapMaterialStock(row) {
  return {
    material: row.Material,
    plant: row.Plant,
    storageLocation: row.StorageLocation ?? null,
    batch: row.Batch || null,
    quantityUnits: Math.trunc(Number(row.MatlWrhsStkQtyInMatlBaseUnit ?? 0)),
    unit: row.MaterialBaseUnit ?? null,
    stockType: row.InventoryStockType ?? null,
  };
}

export class SapAdapter {
  /**
   * @param {object} cfg
   * @param {'LIVE_SAP'|'SAP_SANDBOX'|'SIMULATED'} cfg.mode
   * @param {Function} cfg.fetchImpl injectable for testing
   * @param {Function} cfg.simulate  returns rows when running simulated
   */
  constructor({
    mode = 'SIMULATED',
    baseUrl = 'https://sandbox.api.sap.com/s4hanacloud',
    apiKey = null,
    timeoutMs = 5_000,
    maxRetries = 1,
    fetchImpl = globalThis.fetch,
    simulate = () => [],
    breaker = new CircuitBreaker(),
  } = {}) {
    if (!DATA_SOURCES.includes(mode)) throw new Error(`Invalid SAP mode: ${mode}`);

    // REQ-072 enforcement at construction: a live/sandbox claim requires an actual credential.
    // Without this, a misconfigured .env would let the UI badge lie.
    if ((mode === 'LIVE_SAP' || mode === 'SAP_SANDBOX') && !apiKey) {
      this.mode = 'SIMULATED';
      this.downgradeReason =
        `Requested mode ${mode} but no API key is configured; downgraded to SIMULATED ` +
        `rather than mislabelling simulated data (REQ-072).`;
    } else {
      this.mode = mode;
      this.downgradeReason = null;
    }

    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.fetchImpl = fetchImpl;
    this.simulate = simulate;
    this.breaker = breaker;
  }

  /** REQ-071 — every response carries provenance. There is no code path that omits it. */
  #envelope(rows, dataSource, extra = {}) {
    if (!DATA_SOURCES.includes(dataSource)) throw new Error('invalid data_source');
    return {
      rows,
      dataSource,
      fetchedAt: new Date().toISOString(),
      service: SERVICES.materialStock.service,
      ...extra,
    };
  }

  async readMaterialStock({ material, plant }) {
    if (this.mode === 'SIMULATED') {
      return this.#envelope(this.simulate({ material, plant }), 'SIMULATED', {
        note: this.downgradeReason ?? 'No SAP credentials configured; deterministic simulation in use.',
      });
    }

    if (this.breaker.isOpen) {
      return this.#envelope(this.simulate({ material, plant }), 'SIMULATED', {
        note: 'SAP circuit breaker open after repeated failures; degraded to simulated data.',
        degraded: true,
      });
    }

    const url =
      `${this.baseUrl}${SERVICES.materialStock.path}` +
      `?$filter=Material eq '${material}' and Plant eq '${plant}'&$format=json`;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        const res = await this.fetchImpl(url, {
          headers: { APIKey: this.apiKey, Accept: 'application/json' },
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (!res.ok) throw new Error(`SAP responded ${res.status}`);
        const body = await res.json();
        const rows = (body?.d?.results ?? body?.value ?? []).map(mapMaterialStock);

        this.breaker.recordSuccess();
        return this.#envelope(rows, this.mode);
      } catch (err) {
        this.breaker.recordFailure();
        if (attempt === this.maxRetries) {
          return this.#envelope(this.simulate({ material, plant }), 'SIMULATED', {
            note: `SAP request failed (${err.message}); degraded to simulated data.`,
            degraded: true,
            error: err.message,
          });
        }
      }
    }
    // unreachable, but explicit rather than implicit
    return this.#envelope([], 'SIMULATED', { note: 'unreachable' });
  }

  /** What the UI badge renders. Honest by construction. */
  describe() {
    return {
      mode: this.mode,
      baseUrl: this.mode === 'SIMULATED' ? null : this.baseUrl,
      credentialsConfigured: Boolean(this.apiKey),
      downgradeReason: this.downgradeReason,
      claim:
        this.mode === 'SIMULATED'
          ? 'SAP S/4HANA Cloud OData contract implemented; running against SIMULATED data.'
          : `Connected to ${this.mode} via API key.`,
      contract: SERVICES,
    };
  }
}

export function adapterFromEnv(env = process.env, { simulate } = {}) {
  return new SapAdapter({
    mode: env.SAP_MODE ?? 'SIMULATED',
    baseUrl: env.SAP_BASE_URL ?? 'https://sandbox.api.sap.com/s4hanacloud',
    apiKey: env.SAP_API_KEY || null,
    simulate,
  });
}
