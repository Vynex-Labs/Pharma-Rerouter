/**
 * Network model + route engine (deterministic).
 *
 * Authority: docs/architecture.md §7 Deterministic Core. Requirements: REQ-010, REQ-014.
 * AR-1: everything here is authoritative and must never be produced by a language model.
 *
 * Determinism rules (ADR-0005): sorted iteration everywhere, integer money in minor units,
 * no Math.random, no wall-clock reads inside pure functions.
 */

/** Build an adjacency index from a snapshot payload. Pure — same input, same graph. */
export function buildGraph(snapshot) {
  const facilities = new Map();
  for (const f of [...snapshot.facilities].sort((a, b) => a.id.localeCompare(b.id))) {
    facilities.set(f.id, f);
  }

  const lanes = new Map();
  const outgoing = new Map();
  const incoming = new Map();

  for (const l of [...snapshot.lanes].sort((a, b) => a.id.localeCompare(b.id))) {
    lanes.set(l.id, l);
    if (!outgoing.has(l.from_facility_id)) outgoing.set(l.from_facility_id, []);
    if (!incoming.has(l.to_facility_id)) incoming.set(l.to_facility_id, []);
    outgoing.get(l.from_facility_id).push(l);
    incoming.get(l.to_facility_id).push(l);
  }

  return {
    facilities,
    lanes,
    outgoing: (id) => outgoing.get(id) ?? [],
    incoming: (id) => incoming.get(id) ?? [],
  };
}

/**
 * Least-transit-time path between two facilities using Dijkstra over transit_hours.
 * Closed lanes are excluded. Ties are broken by lane id so the result is stable (NFR-004).
 *
 * Returns null when no path exists — callers must handle that rather than assuming success.
 */
export function findPath(graph, fromId, toId, { excludeLaneIds = [], requireColdChain = false } = {}) {
  const excluded = new Set(excludeLaneIds);
  const dist = new Map([[fromId, 0]]);
  const prev = new Map();
  const visited = new Set();

  for (;;) {
    // Pick the unvisited node with the smallest distance; ties broken by id for determinism.
    let current = null;
    let best = Infinity;
    for (const [node, d] of [...dist.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (!visited.has(node) && d < best) {
        best = d;
        current = node;
      }
    }
    if (current === null) break;
    if (current === toId) break;
    visited.add(current);

    for (const lane of graph.outgoing(current)) {
      if (excluded.has(lane.id)) continue;
      if (lane.status === 'CLOSED') continue;
      if (requireColdChain && !lane.cold_chain_capable) continue;

      const next = lane.to_facility_id;
      const candidate = best + lane.transit_hours;
      if (candidate < (dist.get(next) ?? Infinity)) {
        dist.set(next, candidate);
        prev.set(next, lane);
      }
    }
  }

  if (!dist.has(toId)) return null;

  const laneChain = [];
  let cursor = toId;
  while (cursor !== fromId) {
    const lane = prev.get(cursor);
    if (!lane) return null;
    laneChain.unshift(lane);
    cursor = lane.from_facility_id;
  }

  return summarisePath(laneChain);
}

/** Aggregate a lane chain into the figures every downstream engine consumes. */
export function summarisePath(laneChain) {
  return {
    laneIds: laneChain.map((l) => l.id),
    lanes: laneChain,
    transitHours: laneChain.reduce((s, l) => s + l.transit_hours, 0),
    costPerUnitMinor: laneChain.reduce((s, l) => s + l.cost_per_unit_minor, 0),
    // Excursion accumulates along the whole journey — this is what DE-1 gates on.
    excursionHours: laneChain.reduce((s, l) => s + l.excursion_hours, 0),
    // Series reliability: every leg must succeed. Kept in integer basis points to avoid floats.
    reliabilityPct: Math.round(
      laneChain.reduce((p, l) => p * (l.reliability_pct / 100), 1) * 100,
    ),
    minCapacityUnits: laneChain.length
      ? Math.min(...laneChain.map((l) => l.capacity_units))
      : 0,
    coldChainCapable: laneChain.every((l) => l.cold_chain_capable === 1),
  };
}

/** Downstream facilities reachable from a lane's destination — the disruption blast radius. */
export function downstreamOf(graph, facilityId) {
  const seen = new Set([facilityId]);
  const queue = [facilityId];
  while (queue.length) {
    const node = queue.shift();
    for (const lane of graph.outgoing(node)) {
      if (lane.status === 'CLOSED') continue;
      if (!seen.has(lane.to_facility_id)) {
        seen.add(lane.to_facility_id);
        queue.push(lane.to_facility_id);
      }
    }
  }
  seen.delete(facilityId);
  return [...seen].sort();
}
