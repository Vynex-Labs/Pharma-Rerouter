/**
 * P7 verification — SAP adapter.
 * Traces: REQ-070..076, ADR-0004. Closes condition SAP-1 (no claim without evidence).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/index.mjs';
import { seedDatabase } from '../src/db/seed.mjs';
import { SapAdapter, CircuitBreaker, mapMaterialStock, SERVICES, adapterFromEnv } from '../src/sap/adapter.mjs';
import {
  MATERIAL_STOCK_V2_RESPONSE, MATERIAL_STOCK_V4_RESPONSE, makeSimulator,
} from '../src/sap/fixtures.mjs';

function seeded() {
  const db = openDatabase(':memory:');
  seedDatabase(db);
  return db;
}
const okFetch = (body) => async () => ({ ok: true, status: 200, json: async () => body });

test('REQ-074: OData V2 rows map correctly against the published contract shape', () => {
  const rows = MATERIAL_STOCK_V2_RESPONSE.d.results.map(mapMaterialStock);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].material, '000000000000100001');
  assert.equal(rows[0].plant, '1010');
  assert.equal(rows[0].batch, 'LOT-C-001');
  assert.equal(rows[0].quantityUnits, 4200, 'decimal string must become an integer unit count');
  assert.equal(rows[1].quantityUnits, 20000);
});

test('REQ-074: an empty batch string maps to null, not to the empty string', () => {
  const [row] = MATERIAL_STOCK_V4_RESPONSE.value.map(mapMaterialStock);
  assert.equal(row.batch, null);
});

test('REQ-070: the adapter targets the documented service paths', () => {
  assert.equal(SERVICES.materialStock.service, 'API_MATERIAL_STOCK_SRV');
  assert.equal(SERVICES.materialStock.entitySet, 'A_MaterialStock');
  assert.match(SERVICES.materialStock.path, /API_MATERIAL_STOCK_SRV\/A_MaterialStock$/);
});

test('REQ-071: every response carries data_source and fetched_at', async () => {
  const db = seeded();
  const a = new SapAdapter({ mode: 'SIMULATED', simulate: makeSimulator(db) });
  const r = await a.readMaterialStock({ material: '000000000000100001', plant: 'WH-CENTRAL' });

  assert.equal(r.dataSource, 'SIMULATED');
  assert.match(r.fetchedAt, /^\d{4}-\d{2}-\d{2}T.*Z$/);
  assert.ok(r.rows.length > 0, 'simulation must return our synthetic lots');
});

test('REQ-072: simulated data can NEVER be labelled live, even if the mode says so', async () => {
  const db = seeded();
  // The dangerous misconfiguration: someone sets SAP_MODE=LIVE_SAP with no key.
  const a = new SapAdapter({ mode: 'LIVE_SAP', apiKey: null, simulate: makeSimulator(db) });

  assert.equal(a.mode, 'SIMULATED', 'the adapter must downgrade rather than mislabel');
  assert.match(a.downgradeReason, /no API key/i);

  const r = await a.readMaterialStock({ material: '000000000000100001', plant: 'WH-CENTRAL' });
  assert.equal(r.dataSource, 'SIMULATED');
  assert.notEqual(r.dataSource, 'LIVE_SAP');
});

test('REQ-072: a real fetch with a key is labelled with the configured mode', async () => {
  const a = new SapAdapter({
    mode: 'SAP_SANDBOX', apiKey: 'test-key', fetchImpl: okFetch(MATERIAL_STOCK_V2_RESPONSE),
  });
  const r = await a.readMaterialStock({ material: '000000000000100001', plant: '1010' });
  assert.equal(r.dataSource, 'SAP_SANDBOX');
  assert.equal(r.rows.length, 2);
});

test('REQ-073: a failing endpoint degrades to simulated data with the badge updated', async () => {
  const db = seeded();
  const a = new SapAdapter({
    mode: 'SAP_SANDBOX', apiKey: 'k', maxRetries: 1,
    fetchImpl: async () => { throw new Error('ECONNRESET'); },
    simulate: makeSimulator(db),
  });

  const r = await a.readMaterialStock({ material: '000000000000100001', plant: 'WH-CENTRAL' });
  assert.equal(r.dataSource, 'SIMULATED', 'must not claim SAP when SAP failed');
  assert.equal(r.degraded, true);
  assert.match(r.note, /degraded to simulated/i);
  assert.ok(r.rows.length > 0, 'the workflow continues — a resilience tool must survive its own dependency');
});

test('REQ-073: an HTTP error status also degrades honestly', async () => {
  const db = seeded();
  const a = new SapAdapter({
    mode: 'SAP_SANDBOX', apiKey: 'k', maxRetries: 0,
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
    simulate: makeSimulator(db),
  });
  const r = await a.readMaterialStock({ material: '000000000000100001', plant: 'WH-CENTRAL' });
  assert.equal(r.dataSource, 'SIMULATED');
  assert.match(r.error, /503/);
});

test('REQ-073: the circuit breaker opens after repeated failures', async () => {
  const db = seeded();
  const breaker = new CircuitBreaker({ threshold: 2, cooldownMs: 60_000 });
  const a = new SapAdapter({
    mode: 'SAP_SANDBOX', apiKey: 'k', maxRetries: 0,
    fetchImpl: async () => { throw new Error('down'); },
    simulate: makeSimulator(db), breaker,
  });

  await a.readMaterialStock({ material: '000000000000100001', plant: 'X' });
  await a.readMaterialStock({ material: '000000000000100001', plant: 'X' });
  assert.equal(breaker.isOpen, true);

  const r = await a.readMaterialStock({ material: '000000000000100001', plant: 'X' });
  assert.match(r.note, /circuit breaker open/i);
  assert.equal(r.dataSource, 'SIMULATED');
});

test('SAP-1/REQ-075: describe() makes no unsupported integration claim', () => {
  const d = new SapAdapter({ mode: 'SIMULATED' }).describe();
  assert.equal(d.mode, 'SIMULATED');
  assert.equal(d.credentialsConfigured, false);
  assert.match(d.claim, /contract implemented/i);
  assert.match(d.claim, /SIMULATED/);
  assert.doesNotMatch(d.claim, /integrated with sap/i);
  assert.doesNotMatch(d.claim, /live sap data/i);
});

test('REQ-076: credentials come from the environment and are never hard-coded', () => {
  const a = adapterFromEnv({ SAP_MODE: 'SAP_SANDBOX', SAP_API_KEY: '' }, { simulate: () => [] });
  assert.equal(a.mode, 'SIMULATED', 'a blank key must not yield a sandbox claim');

  const b = adapterFromEnv({}, { simulate: () => [] });
  assert.equal(b.mode, 'SIMULATED');
  assert.equal(b.apiKey, null);
});

test('an invalid mode is rejected outright rather than silently defaulted', () => {
  assert.throws(() => new SapAdapter({ mode: 'TOTALLY_LIVE' }), /Invalid SAP mode/);
});
