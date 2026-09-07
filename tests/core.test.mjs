/**
 * P5 verification — deterministic core.
 *
 * Traces: REQ-010..015 (impact), REQ-020..028 (scenarios), REQ-021/025 (scoring),
 *         REQ-022 (DE-1), REQ-023 (DE-2), REQ-024, REQ-026 (CA-2), NFR-001, NFR-003, NFR-004.
 *
 * NFR-003 is proven implicitly by this entire file: not one test imports an agent or a provider.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/index.mjs';
import { seedDatabase, SEED_EPOCH } from '../src/db/seed.mjs';
import { captureSnapshot } from '../src/core/snapshot.mjs';
import { buildGraph, findPath, downstreamOf } from '../src/core/network.mjs';
import { computeDaysOfCover, usableQuantity, ordersAtRisk } from '../src/core/inventory.mjs';
import { assessImpact } from '../src/core/impact.mjs';
import { generateScenarios } from '../src/core/scenarios.mjs';
import { rankScenarios, computeRiskScore, DEFAULT_MCDA_WEIGHTS } from '../src/core/scoring.mjs';
import { checkColdChain, checkSupplierQualification, evaluateConstraints } from '../src/core/constraints.mjs';

const ASOF = SEED_EPOCH;

function fixture() {
  const db = openDatabase(':memory:');
  seedDatabase(db);
  const snap = captureSnapshot(db, { disruptionId: 'DSR-0001' });
  const disruption = db.prepare("SELECT * FROM disruption_event WHERE id='DSR-0001'").get();
  return { db, snapshot: snap.payload, disruption, snapshotHash: snap.snapshotHash };
}

// ------------------------------------------------------------------ network

test('REQ-010: graph traversal finds a path and respects closed lanes', () => {
  const { snapshot } = fixture();
  const graph = buildGraph(snapshot);

  const path = findPath(graph, 'DC-CENTRAL', 'HOSP-C1');
  assert.ok(path, 'a path must exist in the healthy network');
  assert.ok(path.transitHours > 0);
  // findPath optimises transit time, so it correctly prefers air (36h) over sea (480h).
  // Asserting it returns the sea lane would be asserting the engine is wrong.
  assert.ok(path.laneIds.includes('LN-AIR-EXPRESS'), 'must select the fastest feasible route');

  // Exclusion must be honoured: removing air forces the slower sea corridor.
  const viaSea = findPath(graph, 'DC-CENTRAL', 'HOSP-C1', { excludeLaneIds: ['LN-AIR-EXPRESS'] });
  assert.ok(viaSea, 'an alternative must exist when the air lane is excluded');
  assert.ok(!viaSea.laneIds.includes('LN-AIR-EXPRESS'));
  assert.ok(viaSea.transitHours > path.transitHours, 'the fallback must be slower');

  // A closed lane must never appear in any path.
  const closed = buildGraph({
    ...snapshot,
    lanes: snapshot.lanes.map((l) =>
      l.id === 'LN-AIR-EXPRESS' ? { ...l, status: 'CLOSED' } : l),
  });
  const avoiding = findPath(closed, 'DC-CENTRAL', 'HOSP-C1');
  assert.ok(avoiding && !avoiding.laneIds.includes('LN-AIR-EXPRESS'), 'CLOSED lanes are excluded');
});

test('path summary accumulates excursion across every leg', () => {
  const { snapshot } = fixture();
  const graph = buildGraph(snapshot);
  const path = findPath(graph, 'DC-CENTRAL', 'WH-CENTRAL', { excludeLaneIds: ['LN-SEA-PRIMARY', 'LN-AIR-EXPRESS'] });
  assert.ok(path);
  const summed = path.lanes.reduce((s, l) => s + l.excursion_hours, 0);
  assert.equal(path.excursionHours, summed, 'excursion must be cumulative, not per-leg maximum');
});

test('downstream traversal finds the blast radius', () => {
  const { snapshot } = fixture();
  const graph = buildGraph(snapshot);
  const down = downstreamOf(graph, 'WH-CENTRAL');
  assert.ok(down.includes('HOSP-C1'));
  assert.ok(down.includes('HOSP-C2'));
  assert.ok(!down.includes('WH-CENTRAL'), 'must not include itself');
});

// ------------------------------------------------------------------ inventory / REQ-012

test('REQ-012: shelf-life netting removes stock that cannot be consumed before expiry', () => {
  const lots = [
    { id: 'A', status: 'AVAILABLE', quantity_units: 5000, expiry_date: '2026-09-13' }, // 6 days
    { id: 'B', status: 'AVAILABLE', quantity_units: 4200, expiry_date: '2026-12-06' },
  ];
  const r = usableQuantity(lots, { asOf: ASOF, dailyDemandUnits: 1400 });

  assert.equal(r.rawTotalUnits, 9200);
  // Lot A can only ever contribute 6 days x 1400 = 8400, but it only holds 5000 -> all 5000 usable.
  assert.equal(r.usableUnits, 9200);

  // Now make the short-dated lot genuinely unusable at scale.
  const r2 = usableQuantity(
    [{ id: 'A', status: 'AVAILABLE', quantity_units: 50000, expiry_date: '2026-09-09' }],
    { asOf: ASOF, dailyDemandUnits: 1400 },
  );
  assert.equal(r2.rawTotalUnits, 50000);
  assert.equal(r2.usableUnits, 2 * 1400, 'only two days of demand can be consumed before expiry');
  assert.ok(r2.unusableUnits > 0, 'the write-off must be reported, not hidden');
});

test('REQ-012: expired lots contribute nothing', () => {
  const r = usableQuantity(
    [{ id: 'X', status: 'AVAILABLE', quantity_units: 9999, expiry_date: '2026-09-01' }],
    { asOf: ASOF, dailyDemandUnits: 100 },
  );
  assert.equal(r.usableUnits, 0);
});

test('REQ-011: days-of-cover and stockout dates are computed per site+product', () => {
  const { snapshot } = fixture();
  const cover = computeDaysOfCover(snapshot, { asOf: ASOF });
  assert.ok(cover.length >= 6);
  for (const c of cover) {
    assert.ok(Number.isInteger(c.daysOfCover));
    assert.match(c.stockoutDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(['CRITICAL', 'WARNING', 'WATCH', 'HEALTHY'].includes(c.status));
  }
});

// ------------------------------------------------------------------ impact

test('REQ-010/013: impact identifies held shipments and produces a do-nothing baseline', () => {
  const { snapshot, disruption } = fixture();
  const impact = assessImpact(snapshot, disruption, { asOf: ASOF });

  assert.equal(impact.closedLaneId, 'LN-SEA-PRIMARY');
  assert.ok(impact.affected.shipments.length >= 2, 'shipments on the closed lane must be held');
  assert.ok(impact.affected.facilities.includes('WH-CENTRAL'));
  assert.ok(impact.affected.facilities.includes('HOSP-C1'), 'downstream hospitals are affected');

  assert.equal(impact.baseline.strategy, 'DO_NOTHING');
  assert.ok(impact.baseline.ordersAtRisk >= 1, 'the disruption must actually put orders at risk');
  assert.ok(impact.baseline.unitsAtRisk > 0);
});

test('the disruption measurably reduces cover versus the undisrupted counterfactual', () => {
  const { snapshot, disruption } = fixture();
  const impact = assessImpact(snapshot, disruption, { asOf: ASOF });
  const central = impact.daysOfCover.find(
    (c) => c.facilityId === 'WH-CENTRAL' && c.productId === 'PRD-VAX-01',
  );
  assert.ok(central, 'WH-CENTRAL must be modelled');
  assert.ok(central.daysLost > 0, 'held shipments must cost the site days of cover');
  assert.ok(central.unusableUnits > 0, 'shelf-life netting must bite at the critical site');
});

test('REQ-014 / NFR-004: impact is reproducible across runs', () => {
  const a = fixture();
  const b = fixture();
  const ia = assessImpact(a.snapshot, a.disruption, { asOf: ASOF });
  const ib = assessImpact(b.snapshot, b.disruption, { asOf: ASOF });
  assert.deepEqual(ia.daysOfCover, ib.daysOfCover);
  assert.deepEqual(ia.ordersAtRisk, ib.ordersAtRisk);
});

test('impact never mutates the frozen snapshot (it is evidence)', () => {
  const { snapshot, disruption } = fixture();
  const before = JSON.stringify(snapshot.lanes);
  assessImpact(snapshot, disruption, { asOf: ASOF });
  assert.equal(JSON.stringify(snapshot.lanes), before);
});

// ------------------------------------------------------------------ DE-1 (REQ-022)

test('DE-1/REQ-022: excursion budget breach yields INFEASIBLE with a stated reason', () => {
  const product = { name: 'X', requires_cold_chain: 1, min_temp_c: 2, max_temp_c: 8, max_excursion_hours: 8 };
  const path = { coldChainCapable: true, excursionHours: 14, lanes: [{ id: 'L1', excursion_hours: 14 }] };

  const r = checkColdChain(product, path);
  assert.equal(r.ok, false);
  assert.equal(r.verdict, 'INFEASIBLE');
  assert.equal(r.code, 'EXCURSION_BUDGET_EXCEEDED');
  assert.match(r.reason, /not rankable at any cost/, 'must be a gate, not a cost term');
  assert.equal(r.detail.overageHours, 6);
});

test('DE-1: a non-cold-chain lane is infeasible for a cold-chain product', () => {
  const product = { name: 'X', requires_cold_chain: 1, min_temp_c: 2, max_temp_c: 8, max_excursion_hours: 8 };
  const r = checkColdChain(product, { coldChainCapable: false, excursionHours: 0, lanes: [] });
  assert.equal(r.verdict, 'INFEASIBLE');
  assert.equal(r.code, 'COLD_CHAIN_NOT_CAPABLE');
});

// ------------------------------------------------------------------ DE-2 (REQ-023)

test('DE-2/REQ-023: an unqualified supplier is BLOCKED, not merely penalised', () => {
  const sp = { supplier_id: 'SUP-ALT', product_id: 'PRD-VAX-01', qualified_markets: 'APAC' };
  const r = checkSupplierQualification(sp, 'EU', 'Meridian');
  assert.equal(r.ok, false);
  assert.equal(r.verdict, 'BLOCKED');
  assert.match(r.reason, /cannot be approved by any role/);
});

test('DE-2: a qualified supplier passes', () => {
  const sp = { supplier_id: 'SUP-PRIMARY', product_id: 'PRD-VAX-01', qualified_markets: 'EU,APAC' };
  assert.equal(checkSupplierQualification(sp, 'EU', 'Helix').ok, true);
});

test('BLOCKED dominates INFEASIBLE, and every failure reason is retained (REQ-024)', () => {
  const v = evaluateConstraints([
    { ok: false, verdict: 'INFEASIBLE', code: 'A', reason: 'reason A.' },
    { ok: false, verdict: 'BLOCKED', code: 'B', reason: 'reason B.' },
  ]);
  assert.equal(v.feasibility, 'BLOCKED', 'prohibited must never be presented as merely impractical');
  assert.equal(v.failures.length, 2);
  assert.match(v.reason, /reason A/);
  assert.match(v.reason, /reason B/);
});

// ------------------------------------------------------------------ scenarios

test('REQ-020: at least three candidates plus the do-nothing baseline are generated', () => {
  const { snapshot, disruption } = fixture();
  const impact = assessImpact(snapshot, disruption, { asOf: ASOF });
  const { scenarios } = generateScenarios(impact, { asOf: ASOF });

  assert.ok(scenarios.length >= 4, `expected >= 4 scenarios, got ${scenarios.length}`);
  assert.ok(scenarios.some((s) => s.strategyType === 'DO_NOTHING'));
});

test('the flagship scenario exercises FEASIBLE, INFEASIBLE and BLOCKED in a single run', () => {
  const { snapshot, disruption } = fixture();
  const impact = assessImpact(snapshot, disruption, { asOf: ASOF });
  const { scenarios } = generateScenarios(impact, { asOf: ASOF });

  const verdicts = new Set(scenarios.map((s) => s.feasibility));
  assert.ok(verdicts.has('FEASIBLE'), 'at least one option must be actionable');
  assert.ok(verdicts.has('INFEASIBLE'), 'alt-port must breach the excursion budget');
  assert.ok(verdicts.has('BLOCKED'), 'alt-supplier must be blocked on EU qualification');
});

test('REQ-022 in situ: ALT_PORT is infeasible on cumulative excursion, with the numbers shown', () => {
  const { snapshot, disruption } = fixture();
  const impact = assessImpact(snapshot, disruption, { asOf: ASOF });
  const { scenarios } = generateScenarios(impact, { asOf: ASOF });

  const alt = scenarios.find((s) => s.strategyType === 'ALT_PORT');
  assert.ok(alt);
  assert.equal(alt.feasibility, 'INFEASIBLE');
  assert.ok(alt.constraintCodes.includes('EXCURSION_BUDGET_EXCEEDED'));
  assert.equal(alt.detail.excursionHours, 14);
  assert.equal(alt.ordersProtected, 0, 'an undeliverable option must not be credited');
});

test('REQ-023 in situ: ALT_SUPPLIER is blocked on market qualification', () => {
  const { snapshot, disruption } = fixture();
  const impact = assessImpact(snapshot, disruption, { asOf: ASOF });
  const { scenarios } = generateScenarios(impact, { asOf: ASOF });

  const sup = scenarios.find((s) => s.strategyType === 'ALT_SUPPLIER');
  assert.ok(sup);
  assert.equal(sup.feasibility, 'BLOCKED');
  assert.ok(sup.constraintCodes.includes('SUPPLIER_NOT_QUALIFIED'));
  assert.equal(sup.detail.destinationMarket, 'EU');
});

test('AIR_REROUTE is feasible, fast, expensive and protects orders', () => {
  const { snapshot, disruption } = fixture();
  const impact = assessImpact(snapshot, disruption, { asOf: ASOF });
  const { scenarios } = generateScenarios(impact, { asOf: ASOF });

  const air = scenarios.find((s) => s.strategyType === 'AIR_REROUTE');
  assert.ok(air);
  assert.equal(air.feasibility, 'FEASIBLE');
  assert.ok(air.ordersProtected > 0, 'the recommended option must actually rescue orders');
  assert.ok(air.costDeltaMinor > 0);
  assert.ok(air.etaHours < 480, 'must beat the original sea transit');
});

// ------------------------------------------------------------------ CA-2 (REQ-026)

test('CA-2/REQ-026: agent strategy intents genuinely change which scenarios are generated', () => {
  const { snapshot, disruption } = fixture();
  const impact = assessImpact(snapshot, disruption, { asOf: ASOF });

  const all = generateScenarios(impact, { asOf: ASOF });
  const narrowed = generateScenarios(impact, {
    asOf: ASOF,
    strategyIntents: [{ strategy: 'INVENTORY_REBALANCE', rationale: 'buy days locally first' }],
  });

  assert.ok(narrowed.scenarios.length < all.scenarios.length, 'intents must change the output set');
  assert.equal(narrowed.generationOrigin, 'AGENT_INTENT');
  assert.ok(narrowed.scenarios.some((s) => s.strategyType === 'INVENTORY_REBALANCE'));
  assert.ok(
    narrowed.scenarios.some((s) => s.strategyType === 'DO_NOTHING'),
    'the baseline is not the agent\'s to remove (REQ-013)',
  );
  const rebalance = narrowed.scenarios.find((s) => s.strategyType === 'INVENTORY_REBALANCE');
  assert.equal(rebalance.origin, 'AGENT_INTENT', 'provenance must be recorded for the audit trail');
});

test('an agent cannot invent a strategy the engine does not implement', () => {
  const { snapshot, disruption } = fixture();
  const impact = assessImpact(snapshot, disruption, { asOf: ASOF });

  const r = generateScenarios(impact, {
    asOf: ASOF,
    strategyIntents: [
      { strategy: 'TELEPORT_STOCK', rationale: 'hallucinated' },
      { strategy: 'AIR_REROUTE', rationale: 'valid' },
    ],
  });

  assert.deepEqual(r.rejectedIntents, [{ strategy: 'TELEPORT_STOCK', reason: 'UNKNOWN_STRATEGY' }]);
  assert.ok(!r.scenarios.some((s) => s.strategyType === 'TELEPORT_STOCK'));
  assert.ok(r.scenarios.some((s) => s.strategyType === 'AIR_REROUTE'));
});

// ------------------------------------------------------------------ ranking

test('REQ-025: ranking is deterministic with visible weights', () => {
  const { snapshot, disruption } = fixture();
  const impact = assessImpact(snapshot, disruption, { asOf: ASOF });
  const { scenarios } = generateScenarios(impact, { asOf: ASOF });

  const r1 = rankScenarios(scenarios);
  const r2 = rankScenarios(scenarios);
  assert.deepEqual(r1.ranked.map((s) => s.id), r2.ranked.map((s) => s.id));
  assert.deepEqual(r1.weights, DEFAULT_MCDA_WEIGHTS);
  assert.ok(r1.ranked[0].scoreBreakdown, 'the score must be decomposed for explainability');
});

test('REQ-022/023: infeasible and blocked options are excluded from ranking but retained with reasons', () => {
  const { snapshot, disruption } = fixture();
  const impact = assessImpact(snapshot, disruption, { asOf: ASOF });
  const { scenarios } = generateScenarios(impact, { asOf: ASOF });
  const { ranked, excluded } = rankScenarios(scenarios);

  assert.ok(ranked.every((s) => s.feasibility === 'FEASIBLE'));
  assert.ok(excluded.length >= 2);
  for (const e of excluded) {
    assert.equal(e.rank, null);
    assert.ok(e.infeasibilityReason, 'REQ-024: never silently dropped — a reason is mandatory');
  }
});

test('a cheap infeasible option can never outrank a costly feasible one', () => {
  const cheapInfeasible = {
    id: 'SCN-X', feasibility: 'INFEASIBLE', infeasibilityReason: 'excursion',
    ordersProtected: 99, etaHours: 1, riskScore: 0, costDeltaMinor: 1,
  };
  const costlyFeasible = {
    id: 'SCN-Y', feasibility: 'FEASIBLE', infeasibilityReason: null,
    ordersProtected: 1, etaHours: 500, riskScore: 90, costDeltaMinor: 9_999_999,
  };
  const { ranked, excluded } = rankScenarios([cheapInfeasible, costlyFeasible]);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].id, 'SCN-Y');
  assert.equal(excluded[0].id, 'SCN-X');
});

test('risk scoring is decomposed and bounded', () => {
  const product = { requires_cold_chain: 1, max_excursion_hours: 8 };
  const r = computeRiskScore({
    path: { reliabilityPct: 90, excursionHours: 4, minCapacityUnits: 10000 },
    product, units: 5000, modeChanged: true,
  });
  assert.ok(r.score >= 0 && r.score <= 100);
  assert.ok(r.components.excursion > 0);
  assert.ok(r.components.modeChange > 0);
});

// ------------------------------------------------------------------ NFR-001

test('NFR-001: the full deterministic pipeline completes well under 2 s', () => {
  const { snapshot, disruption } = fixture();
  const t0 = performance.now();
  const impact = assessImpact(snapshot, disruption, { asOf: ASOF });
  const { scenarios } = generateScenarios(impact, { asOf: ASOF });
  rankScenarios(scenarios);
  const elapsed = performance.now() - t0;
  assert.ok(elapsed < 2000, `pipeline took ${elapsed.toFixed(0)} ms`);
});

test('REQ-013: doing nothing is not rewarded for being free and instantaneous', () => {
  const { snapshot, disruption } = fixture();
  const impact = assessImpact(snapshot, disruption, { asOf: ASOF });
  const { scenarios } = generateScenarios(impact, { asOf: ASOF });
  const { ranked } = rankScenarios(scenarios);

  const nothing = ranked.find((s) => s.strategyType === 'DO_NOTHING');
  assert.ok(nothing, 'the baseline must remain visible for comparison');
  assert.ok(nothing.etaHours > 100, 'relief waits for the lane to reopen; it is not instantaneous');
  assert.equal(nothing.rank, ranked.length, 'the baseline must rank last among feasible options');
  assert.ok(
    ranked.filter((s) => s.strategyType !== 'DO_NOTHING').every((s) => s.score > nothing.score),
    'every corrective action must outscore inaction',
  );
});
