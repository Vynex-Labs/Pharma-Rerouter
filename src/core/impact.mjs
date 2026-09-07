/**
 * Impact engine — deterministic blast-radius analysis.
 *
 * Requirements: REQ-010 (graph traversal, no LLM), REQ-011 (days-of-cover + stockout dates),
 * REQ-013 (do-nothing baseline), REQ-014 (reproducible).
 *
 * This module answers "what is affected?" using only the frozen snapshot. It never calls an agent.
 */

import { buildGraph, downstreamOf } from './network.mjs';
import { computeDaysOfCover, ordersAtRisk, daysBetween } from './inventory.mjs';

/**
 * Apply a disruption to a snapshot, producing the state the network is actually in.
 * Returns a NEW payload — the snapshot itself is immutable evidence and must not be mutated.
 */
export function applyDisruption(snapshot, disruption) {
  const lanes = snapshot.lanes.map((l) =>
    l.id === disruption.reported_lane_id ? { ...l, status: 'CLOSED' } : { ...l },
  );

  // Shipments already moving on the closed lane are held, not delivered.
  const shipments = snapshot.shipments.map((s) =>
    s.lane_id === disruption.reported_lane_id && s.status === 'IN_TRANSIT'
      ? { ...s, status: 'HELD' }
      : { ...s },
  );

  return { ...snapshot, lanes, shipments };
}

export function assessImpact(snapshot, disruption, { asOf }) {
  const disrupted = applyDisruption(snapshot, disruption);
  const graph = buildGraph(disrupted);

  const closedLane = snapshot.lanes.find((l) => l.id === disruption.reported_lane_id);

  // --- affected shipments: those held on the closed lane
  const affectedShipments = disrupted.shipments
    .filter((s) => s.status === 'HELD')
    .map((s) => ({
      shipmentId: s.id,
      productId: s.product_id,
      quantityUnits: s.quantity_units,
      destinationFacilityId: s.destination_facility_id,
      originalEta: s.eta,
      status: s.status,
    }))
    .sort((a, b) => a.shipmentId.localeCompare(b.shipmentId));

  // --- affected facilities: the lane's destination and everything downstream of it
  const affectedFacilities = closedLane
    ? [closedLane.to_facility_id, ...downstreamOf(graph, closedLane.to_facility_id)].sort()
    : [];

  // --- BASELINE (REQ-013): what happens if we do nothing. Held shipments contribute nothing.
  const baselineCover = computeDaysOfCover(disrupted, { asOf, inboundByFacility: new Map() });
  const baselineOrderRisk = ordersAtRisk(disrupted, baselineCover, { asOf });

  // --- COUNTERFACTUAL: what cover would have been had the disruption not happened.
  const inboundIfUndisrupted = new Map();
  for (const s of snapshot.shipments) {
    if (s.status !== 'IN_TRANSIT') continue;
    const key = `${s.destination_facility_id}|${s.product_id}`;
    inboundIfUndisrupted.set(key, (inboundIfUndisrupted.get(key) ?? 0) + s.quantity_units);
  }
  const undisruptedCover = computeDaysOfCover(snapshot, {
    asOf,
    inboundByFacility: inboundIfUndisrupted,
  });

  const undisruptedIndex = new Map(
    undisruptedCover.map((c) => [`${c.facilityId}|${c.productId}`, c]),
  );

  const coverDelta = baselineCover.map((c) => {
    const before = undisruptedIndex.get(`${c.facilityId}|${c.productId}`);
    return {
      ...c,
      daysOfCoverIfUndisrupted: before ? before.daysOfCover : c.daysOfCover,
      daysLost: before ? before.daysOfCover - c.daysOfCover : 0,
    };
  });

  const criticalSites = coverDelta
    .filter((c) => c.status === 'CRITICAL' || c.status === 'WARNING')
    .sort((a, b) => a.daysOfCover - b.daysOfCover || a.facilityId.localeCompare(b.facilityId));

  const unitsAtRisk = baselineOrderRisk.reduce((s, o) => s + o.quantityUnits, 0);

  return {
    disruptionId: disruption.id,
    asOf,
    closedLaneId: disruption.reported_lane_id,
    affected: {
      shipments: affectedShipments,
      facilities: affectedFacilities,
      lanes: closedLane ? [closedLane.id] : [],
      orderCount: baselineOrderRisk.length,
    },
    daysOfCover: coverDelta,
    criticalSites,
    ordersAtRisk: baselineOrderRisk,
    baseline: {
      strategy: 'DO_NOTHING',
      ordersAtRisk: baselineOrderRisk.length,
      unitsAtRisk,
      earliestStockoutDate: criticalSites.length ? criticalSites[0].stockoutDate : null,
      shipmentsHeld: affectedShipments.length,
    },
    // The disrupted state downstream engines must plan against.
    disruptedSnapshot: disrupted,
  };
}

/** Earliest need-by across at-risk orders — the deadline scenarios must beat. */
export function earliestDeadlineDays(impact) {
  if (!impact.ordersAtRisk.length) return Infinity;
  return Math.min(...impact.ordersAtRisk.map((o) => o.daysUntilNeed));
}

export { daysBetween };
