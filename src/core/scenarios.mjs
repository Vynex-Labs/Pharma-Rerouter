/**
 * Scenario generator — deterministic recovery options.
 *
 * Requirements: REQ-020 (≥3 candidates + do-nothing), REQ-021 (deterministic cost/ETA/risk),
 * REQ-022/023 (gates), REQ-024 (infeasible shown with reason), REQ-026 (agent intents can drive
 * generation — condition CA-2), REQ-028 (bound to a snapshot).
 *
 * CA-2 note: `generateScenarios` accepts `strategyIntents`. The Scenario Reasoning Agent (seam S3,
 * built in P6) proposes TYPED INTENTS that select and parameterise which strategies run here — it
 * does not comment on a fixed list, and it never computes a value. That is the difference between
 * an agent that changes outcomes and a decorative summariser (Competition Analyst concern CA-1).
 */

import { buildGraph, findPath, summarisePath } from './network.mjs';
import { computeTransportCost, computeRiskScore } from './scoring.mjs';
import {
  checkColdChain,
  checkSupplierQualification,
  checkCapacity,
  checkLeadTime,
  evaluateConstraints,
  FEASIBLE,
} from './constraints.mjs';
import { computeDaysOfCover, ordersAtRisk } from './inventory.mjs';

export const ALL_STRATEGIES = [
  'DO_NOTHING',
  'AIR_REROUTE',
  'ALT_PORT',
  'INVENTORY_REBALANCE',
  'ALT_SUPPLIER',
];

/** How many at-risk orders a scenario rescues, recomputed from the engine — never asserted. */
function ordersProtectedBy(snapshot, impact, inboundByFacility, asOf) {
  const cover = computeDaysOfCover(snapshot, { asOf, inboundByFacility });
  const stillAtRisk = ordersAtRisk(snapshot, cover, { asOf });
  const rescued = impact.ordersAtRisk.length - stillAtRisk.length;
  return { ordersProtected: Math.max(0, rescued), residualAtRisk: stillAtRisk, cover };
}

function baseScenario(id, strategyType, origin) {
  return {
    id,
    strategyType,
    origin, // 'ENGINE' | 'AGENT_INTENT' — CA-2 evidence trail
    actions: [],
    costDeltaMinor: 0,
    etaHours: 0,
    riskScore: 0,
    riskComponents: null,
    ordersProtected: 0,
    feasibility: FEASIBLE,
    infeasibilityReason: null,
    constraintCodes: [],
    detail: {},
  };
}

/**
 * @param {object} opts.strategyIntents Optional agent-proposed intents (CA-2):
 *   [{ strategy: 'AIR_REROUTE', rationale: '...', parameters: {...} }]
 *   Unknown strategies are ignored and reported — an agent cannot invent a strategy that
 *   does not exist in the engine (ADR-0002 §3 referential validation).
 */
export function generateScenarios(impact, { asOf, strategyIntents = null } = {}) {
  const snapshot = impact.disruptedSnapshot;
  const graph = buildGraph(snapshot);
  const productIndex = new Map(snapshot.products.map((p) => [p.id, p]));
  const facilityIndex = new Map(snapshot.facilities.map((f) => [f.id, f]));

  // Decide which strategies to run. Default = all (engine-driven).
  let selected = ALL_STRATEGIES;
  let rejectedIntents = [];
  let origin = 'ENGINE';

  if (Array.isArray(strategyIntents) && strategyIntents.length) {
    const valid = strategyIntents.filter((i) => ALL_STRATEGIES.includes(i.strategy));
    rejectedIntents = strategyIntents
      .filter((i) => !ALL_STRATEGIES.includes(i.strategy))
      .map((i) => ({ strategy: i.strategy, reason: 'UNKNOWN_STRATEGY' }));

    if (valid.length) {
      // DO_NOTHING is always retained: the baseline is not the agent's to remove (REQ-013).
      selected = ['DO_NOTHING', ...valid.map((i) => i.strategy).filter((s) => s !== 'DO_NOTHING')];
      origin = 'AGENT_INTENT';
    }
  }

  const intentIndex = new Map((strategyIntents ?? []).map((i) => [i.strategy, i]));
  const scenarios = [];
  let n = 0;
  const nextId = (s) => `SCN-${String(++n).padStart(3, '0')}-${s}`;

  for (const strategy of selected) {
    const intent = intentIndex.get(strategy);
    const scenarioOrigin = intent ? 'AGENT_INTENT' : origin === 'AGENT_INTENT' ? 'ENGINE' : 'ENGINE';
    const built = buildStrategy(strategy, {
      impact,
      snapshot,
      graph,
      productIndex,
      facilityIndex,
      asOf,
      id: nextId(strategy),
      origin: strategy === 'DO_NOTHING' ? 'ENGINE' : scenarioOrigin,
      parameters: intent?.parameters ?? {},
    });
    if (built) scenarios.push(built);
  }

  return { scenarios, rejectedIntents, generationOrigin: origin };
}

function buildStrategy(strategy, ctx) {
  switch (strategy) {
    case 'DO_NOTHING': return buildDoNothing(ctx);
    case 'AIR_REROUTE': return buildReroute(ctx, 'LN-AIR-EXPRESS', 'AIR_REROUTE', true);
    case 'ALT_PORT': return buildAltPort(ctx);
    case 'INVENTORY_REBALANCE': return buildRebalance(ctx);
    case 'ALT_SUPPLIER': return buildAltSupplier(ctx);
    default: return null;
  }
}

// ---------------------------------------------------------------- DO_NOTHING (REQ-013)

/**
 * DO_NOTHING baseline (REQ-013).
 *
 * Modelling note: an earlier version set `etaHours = 0`, which made the MCDA award doing nothing
 * FULL MARKS on speed and cost — it scored 40/100 purely for being free and instantaneous. That is
 * a real scoring defect, not a cosmetic one: "no goods ever arrive" is the opposite of "arrives in
 * zero hours". The relief ETA is therefore the point at which the disrupted lane is expected to
 * reopen, which is what a planner would actually be waiting for.
 */
function buildDoNothing({ impact, snapshot, id }) {
  const s = baseScenario(id, 'DO_NOTHING', 'ENGINE');
  const closedLane = snapshot.lanes.find((l) => l.id === impact.closedLaneId);
  const disruptionRow = snapshot.disruptions?.find((d) => d.id === impact.disruptionId);

  // Relief arrives only once the lane reopens AND the original transit completes.
  const outageHours = disruptionRow?.expected_duration_hours ?? 144;
  s.etaHours = outageHours + (closedLane?.transit_hours ?? 0);
  s.costDeltaMinor = 0;
  s.riskScore = 100; // doing nothing during a critical disruption is the maximum-risk option
  s.riskComponents = { reliability: 0, excursion: 0, capacity: 0, modeChange: 0, doNothing: 100 };
  s.ordersProtected = 0;
  s.actions = [];
  s.detail = {
    ordersAtRisk: impact.ordersAtRisk.length,
    earliestStockoutDate: impact.baseline.earliestStockoutDate,
    assumedOutageHours: outageHours,
    note:
      'Baseline for comparison. No corrective action taken; relief only when the lane reopens. ' +
      'Outage duration is an ASSUMED value from the advisory, not a guarantee.',
  };
  return s;
}

// ---------------------------------------------------------------- rerouting

function buildReroute({ impact, snapshot, graph, productIndex, asOf, id, origin }, laneId, type, modeChanged) {
  const s = baseScenario(id, type, origin);
  const lane = snapshot.lanes.find((l) => l.id === laneId);
  if (!lane) return null;

  const held = impact.affected.shipments;
  if (!held.length) return null;

  const path = summarisePath([lane]);
  const units = held.reduce((sum, h) => sum + h.quantityUnits, 0);

  // Gate against the most demanding product in the consignment.
  const products = [...new Set(held.map((h) => h.productId))].sort();
  const checks = [];
  for (const pid of products) {
    const product = productIndex.get(pid);
    if (product) checks.push(checkColdChain(product, path));
  }
  checks.push(checkCapacity(path, units));

  const verdict = evaluateConstraints(checks);
  s.feasibility = verdict.feasibility;
  s.infeasibilityReason = verdict.reason;
  s.constraintCodes = verdict.codes ?? [];

  s.etaHours = path.transitHours;
  s.costDeltaMinor = computeTransportCost(path, units);

  const primaryProduct = productIndex.get(products[0]);
  const risk = computeRiskScore({ path, product: primaryProduct, units, modeChanged });
  s.riskScore = risk.score;
  s.riskComponents = risk.components;

  const inbound = new Map();
  for (const h of held) {
    const key = `${h.destinationFacilityId}|${h.productId}`;
    inbound.set(key, (inbound.get(key) ?? 0) + h.quantityUnits);
  }
  const { ordersProtected, residualAtRisk } = ordersProtectedBy(snapshot, impact, inbound, asOf);
  // An infeasible route delivers nothing — it must not be credited with protecting orders.
  s.ordersProtected = verdict.feasibility === FEASIBLE ? ordersProtected : 0;

  s.actions = held.map((h) => ({
    type: 'REROUTE_SHIPMENT',
    shipmentId: h.shipmentId,
    fromLaneId: impact.closedLaneId,
    toLaneId: lane.id,
    units: h.quantityUnits,
  }));

  s.detail = {
    laneId: lane.id,
    mode: lane.mode,
    units,
    transitHours: path.transitHours,
    excursionHours: path.excursionHours,
    capacityUnits: path.minCapacityUnits,
    residualOrdersAtRisk: residualAtRisk.length,
  };
  return s;
}

/** Alternate port + inland leg. Cumulative excursion is what makes this INFEASIBLE (DE-1). */
function buildAltPort(ctx) {
  const { snapshot, impact, productIndex, asOf, id, origin } = ctx;
  const legs = ['LN-SEA-ALTPORT', 'LN-ROAD-SOUTH-CENTRAL']
    .map((lid) => snapshot.lanes.find((l) => l.id === lid))
    .filter(Boolean);
  if (legs.length !== 2) return null;

  const s = baseScenario(id, 'ALT_PORT', origin);
  const path = summarisePath(legs);
  const held = impact.affected.shipments;
  if (!held.length) return null;
  const units = held.reduce((sum, h) => sum + h.quantityUnits, 0);

  const products = [...new Set(held.map((h) => h.productId))].sort();
  const checks = products
    .map((pid) => productIndex.get(pid))
    .filter(Boolean)
    .map((p) => checkColdChain(p, path));
  checks.push(checkCapacity(path, units));

  const verdict = evaluateConstraints(checks);
  s.feasibility = verdict.feasibility;
  s.infeasibilityReason = verdict.reason;
  s.constraintCodes = verdict.codes ?? [];

  s.etaHours = path.transitHours;
  s.costDeltaMinor = computeTransportCost(path, units);

  const risk = computeRiskScore({
    path, product: productIndex.get(products[0]), units, modeChanged: true,
  });
  s.riskScore = risk.score;
  s.riskComponents = risk.components;
  s.ordersProtected = 0; // infeasible by excursion; delivers nothing usable

  s.actions = held.map((h) => ({
    type: 'REROUTE_SHIPMENT',
    shipmentId: h.shipmentId,
    fromLaneId: impact.closedLaneId,
    toLaneId: path.laneIds.join('+'),
    units: h.quantityUnits,
  }));

  s.detail = {
    laneIds: path.laneIds,
    units,
    transitHours: path.transitHours,
    excursionHours: path.excursionHours,
    perLegExcursion: legs.map((l) => ({ laneId: l.id, hours: l.excursion_hours })),
  };
  return s;
}

// ---------------------------------------------------------------- inventory rebalancing

function buildRebalance({ impact, snapshot, graph, productIndex, asOf, id, origin }) {
  const s = baseScenario(id, 'INVENTORY_REBALANCE', origin);

  const critical = impact.criticalSites[0];
  if (!critical) return null;

  // Find a surplus site for the same product, reachable on a cold-chain lane.
  const donors = impact.daysOfCover
    .filter((c) => c.productId === critical.productId && c.facilityId !== critical.facilityId)
    .filter((c) => c.status === 'HEALTHY')
    .sort((a, b) => b.daysOfCover - a.daysOfCover || a.facilityId.localeCompare(b.facilityId));

  // Find the best donor that is actually REACHABLE. A direct-lane lookup was the first
  // implementation and it silently returned null whenever the surplus site had no single hop to
  // the shortage site — which is not how a real network behaves. Rebalancing must be able to
  // route multi-hop (e.g. WH-NORTH -> WH-CENTRAL -> WH-SOUTH), so we use the route engine.
  let donor = null;
  let path = null;
  for (const candidate of donors) {
    const found = findPath(graph, candidate.facilityId, critical.facilityId, {
      requireColdChain: productIndex.get(critical.productId)?.requires_cold_chain === 1,
    });
    if (found) {
      donor = candidate;
      path = found;
      break;
    }
  }
  if (!donor || !path) return null;

  const product = productIndex.get(critical.productId);

  // Transfer enough to lift the critical site to the warning threshold, without
  // dropping the donor below it. Integer arithmetic only.
  const targetDays = 10;
  const need = Math.max(0, (targetDays - critical.daysOfCover) * critical.dailyDemandUnits);
  const donorSpare = Math.max(0, (donor.daysOfCover - targetDays) * donor.dailyDemandUnits);
  const units = Math.min(need, donorSpare, path.minCapacityUnits);

  if (units <= 0) return null;

  const checks = [checkColdChain(product, path), checkCapacity(path, units)];
  const verdict = evaluateConstraints(checks);
  s.feasibility = verdict.feasibility;
  s.infeasibilityReason = verdict.reason;
  s.constraintCodes = verdict.codes ?? [];

  s.etaHours = path.transitHours;
  s.costDeltaMinor = computeTransportCost(path, units);

  const risk = computeRiskScore({ path, product, units, modeChanged: false });
  s.riskScore = risk.score;
  s.riskComponents = risk.components;

  const inbound = new Map([[`${critical.facilityId}|${critical.productId}`, units]]);
  const { ordersProtected, residualAtRisk } = ordersProtectedBy(snapshot, impact, inbound, asOf);
  s.ordersProtected = verdict.feasibility === FEASIBLE ? ordersProtected : 0;

  s.actions = [{
    type: 'INVENTORY_TRANSFER',
    productId: critical.productId,
    fromFacilityId: donor.facilityId,
    toFacilityId: critical.facilityId,
    units,
    laneIds: path.laneIds,
  }];

  s.detail = {
    donorFacilityId: donor.facilityId,
    donorDaysOfCoverBefore: donor.daysOfCover,
    recipientFacilityId: critical.facilityId,
    recipientDaysOfCoverBefore: critical.daysOfCover,
    units,
    note: 'Buys days at the critical site; adds no new supply to the network.',
    residualOrdersAtRisk: residualAtRisk.length,
  };
  return s;
}

// ---------------------------------------------------------------- alternate supplier (DE-2)

function buildAltSupplier({ impact, snapshot, productIndex, facilityIndex, asOf, id, origin }) {
  const s = baseScenario(id, 'ALT_SUPPLIER', origin);

  const critical = impact.criticalSites[0];
  if (!critical) return null;

  const destination = facilityIndex.get(critical.facilityId);
  if (!destination) return null;

  const candidates = snapshot.supplierProducts
    .filter((sp) => sp.product_id === critical.productId)
    .sort((a, b) => a.supplier_id.localeCompare(b.supplier_id));

  // The primary supplier is upstream of the disruption; the alternate is the real question.
  const alt = candidates.find((c) => c.supplier_id !== 'SUP-PRIMARY');
  if (!alt) return null;

  const supplier = facilityIndex.get(alt.supplier_id);
  const daysUntilNeed = impact.ordersAtRisk.length
    ? Math.min(...impact.ordersAtRisk.map((o) => o.daysUntilNeed))
    : 30;

  // DE-2 / REQ-023 — qualification is a BLOCK, evaluated before anything else matters.
  const qualification = checkSupplierQualification(alt, destination.market, supplier?.name);
  const leadTime = checkLeadTime(alt.lead_time_days, daysUntilNeed);

  const verdict = evaluateConstraints([qualification, leadTime]);
  s.feasibility = verdict.feasibility;
  s.infeasibilityReason = verdict.reason;
  s.constraintCodes = verdict.codes ?? [];

  const units = Math.min(alt.capacity_units, critical.dailyDemandUnits * 14);
  s.etaHours = alt.lead_time_days * 24;
  s.costDeltaMinor = alt.unit_cost_minor * units;
  s.riskScore = 70;
  s.riskComponents = { supplierSwitch: 70 };
  s.ordersProtected = 0; // blocked and/or too slow — delivers nothing within the window

  s.actions = [{
    type: 'SWITCH_SUPPLIER',
    productId: critical.productId,
    fromSupplierId: 'SUP-PRIMARY',
    toSupplierId: alt.supplier_id,
    units,
    destinationFacilityId: critical.facilityId,
  }];

  s.detail = {
    supplierId: alt.supplier_id,
    supplierName: supplier?.name,
    destinationMarket: destination.market,
    qualifiedMarkets: alt.qualified_markets,
    leadTimeDays: alt.lead_time_days,
    daysUntilNeed,
    units,
  };
  return s;
}
