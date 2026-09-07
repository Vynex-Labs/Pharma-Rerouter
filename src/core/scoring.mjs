/**
 * Cost and risk engines + multi-criteria ranking.
 *
 * Requirements: REQ-021 (cost/ETA/risk computed deterministically), REQ-025 (documented MCDA with
 * visible configurable weights). AR-1: no language model may originate any value in this file.
 *
 * Money is INTEGER minor units throughout (ADR-0005) — floats must never reach a hash.
 */

/** Landed cost of moving `units` along a path. Integer minor units. */
export function computeTransportCost(path, units) {
  return path.costPerUnitMinor * units;
}

/**
 * Risk score 0–100 (higher = worse). Deterministic, explainable, and decomposed so the UI can
 * show WHY a scenario is risky rather than presenting an opaque number.
 *
 * Components are ASSUMED / CONFIGURABLE RULE weights, not empirical measurements.
 */
export const RISK_WEIGHTS = {
  reliability: 40,   // route failure probability
  excursion: 30,     // cold-chain margin consumed
  capacity: 15,      // how close to the capacity ceiling
  modeChange: 15,    // operational disruption of switching mode
};

export function computeRiskScore({ path, product, units, modeChanged = false }) {
  const reliabilityRisk = (100 - path.reliabilityPct) / 100;

  const budget = product.max_excursion_hours || 1;
  const excursionRisk = product.requires_cold_chain
    ? Math.min(1, path.excursionHours / budget)
    : 0;

  const capacityRisk = path.minCapacityUnits > 0
    ? Math.min(1, units / path.minCapacityUnits)
    : 1;

  const modeRisk = modeChanged ? 1 : 0;

  const raw =
    RISK_WEIGHTS.reliability * reliabilityRisk +
    RISK_WEIGHTS.excursion * excursionRisk +
    RISK_WEIGHTS.capacity * capacityRisk +
    RISK_WEIGHTS.modeChange * modeRisk;

  return {
    score: Math.round(raw),
    components: {
      reliability: Math.round(RISK_WEIGHTS.reliability * reliabilityRisk),
      excursion: Math.round(RISK_WEIGHTS.excursion * excursionRisk),
      capacity: Math.round(RISK_WEIGHTS.capacity * capacityRisk),
      modeChange: Math.round(RISK_WEIGHTS.modeChange * modeRisk),
    },
  };
}

/**
 * MCDA weights (REQ-025) — visible and configurable, deliberately not hidden in a solver.
 * Ordering reflects the P1 problem statement: patient availability first, then integrity, then money.
 */
export const DEFAULT_MCDA_WEIGHTS = {
  ordersProtected: 40,
  speed: 25,
  risk: 20,
  cost: 15,
};

/**
 * Weighted-sum ranking over normalised criteria. Higher score is better.
 *
 * We chose an explainable weighted sum over an opaque optimiser (ADR-0005): with a handful of
 * candidates, the ability to show a judge exactly why option A beat option B is worth more than
 * solver sophistication. Normalisation is min-max across the FEASIBLE candidate set.
 */
export function rankScenarios(scenarios, weights = DEFAULT_MCDA_WEIGHTS) {
  // REQ-022/REQ-023: infeasible and blocked options are NOT rankable. They are retained and
  // returned with their reason (REQ-024) but can never outrank a feasible option.
  const rankable = scenarios.filter((s) => s.feasibility === 'FEASIBLE');
  const excluded = scenarios.filter((s) => s.feasibility !== 'FEASIBLE');

  if (rankable.length === 0) {
    return {
      ranked: [],
      excluded: excluded.map((s) => ({ ...s, rank: null, score: null })),
      weights,
    };
  }

  const range = (vals) => {
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    return { min, max, span: max - min };
  };

  const protectedR = range(rankable.map((s) => s.ordersProtected));
  const etaR = range(rankable.map((s) => s.etaHours));
  const riskR = range(rankable.map((s) => s.riskScore));
  const costR = range(rankable.map((s) => s.costDeltaMinor));

  // Higher-is-better normalisation; when every candidate ties, award full marks rather than 0/0.
  const norm = (v, r, invert) => {
    if (r.span === 0) return 1;
    const x = (v - r.min) / r.span;
    return invert ? 1 - x : x;
  };

  const scored = rankable.map((s) => {
    const parts = {
      ordersProtected: weights.ordersProtected * norm(s.ordersProtected, protectedR, false),
      speed: weights.speed * norm(s.etaHours, etaR, true),
      risk: weights.risk * norm(s.riskScore, riskR, true),
      cost: weights.cost * norm(s.costDeltaMinor, costR, true),
    };
    const score = Math.round(parts.ordersProtected + parts.speed + parts.risk + parts.cost);
    return {
      ...s,
      score,
      scoreBreakdown: {
        ordersProtected: Math.round(parts.ordersProtected),
        speed: Math.round(parts.speed),
        risk: Math.round(parts.risk),
        cost: Math.round(parts.cost),
      },
    };
  });

  // Stable ordering: score desc, then id asc so repeated runs are identical (NFR-004).
  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  scored.forEach((s, i) => {
    s.rank = i + 1;
  });

  return {
    ranked: scored,
    excluded: excluded.map((s) => ({ ...s, rank: null, score: null })),
    weights,
  };
}
