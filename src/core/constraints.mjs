/**
 * Constraint checker — feasibility gates.
 *
 * Authority: P2 conditions **DE-1** and **DE-2** (Domain Expert, binding, non-negotiable).
 * Requirements: REQ-022 (cold-chain is a GATE), REQ-023 (unqualified supplier BLOCKS),
 *               REQ-024 (never silently dropped).
 *
 * The Domain Expert's position at P2 was explicit: "Rerouting a cold-chain shipment is not a
 * routing problem, it's a product-integrity problem. If you optimise on cost and time only, you
 * are not credible." Accordingly cold-chain and qualification are NOT weighted cost terms that a
 * cheap option can outbid — they are gates that return INFEASIBLE / BLOCKED with a stated reason.
 *
 * Distinction, which matters for governance (ADR-0003):
 *   INFEASIBLE — physically/technically impossible for this product. Not rankable.
 *   BLOCKED    — may be physically possible but prohibited by rule. Not approvable by ANY role.
 */

export const FEASIBLE = 'FEASIBLE';
export const INFEASIBLE = 'INFEASIBLE';
export const BLOCKED = 'BLOCKED';

/**
 * DE-1 / REQ-022 — cold-chain temperature-time budget.
 * Cumulative excursion across every leg is compared against the product's budget.
 *
 * `max_excursion_hours` is an ASSUMED / CONFIGURABLE RULE (docs/data-model.md §6), not a cited
 * regulatory threshold. It is honest to model the concept; it would not be honest to claim the number.
 */
export function checkColdChain(product, path) {
  if (!product.requires_cold_chain) return { ok: true };

  if (!path.coldChainCapable) {
    return {
      ok: false,
      verdict: INFEASIBLE,
      code: 'COLD_CHAIN_NOT_CAPABLE',
      reason:
        `Route includes at least one lane without cold-chain capability, which ` +
        `${product.name} requires (${product.min_temp_c}–${product.max_temp_c} °C).`,
    };
  }

  if (path.excursionHours > product.max_excursion_hours) {
    return {
      ok: false,
      verdict: INFEASIBLE,
      code: 'EXCURSION_BUDGET_EXCEEDED',
      reason:
        `Cumulative temperature excursion ${path.excursionHours} h exceeds the ` +
        `${product.max_excursion_hours} h budget for ${product.name}. ` +
        `Product integrity cannot be assured; this option is not rankable at any cost.`,
      detail: {
        excursionHours: path.excursionHours,
        budgetHours: product.max_excursion_hours,
        overageHours: path.excursionHours - product.max_excursion_hours,
        perLane: path.lanes.map((l) => ({ laneId: l.id, excursionHours: l.excursion_hours })),
      },
    };
  }

  return { ok: true, marginHours: product.max_excursion_hours - path.excursionHours };
}

/**
 * DE-2 / REQ-023 — supplier qualification for the destination market.
 * An unqualified supplier is BLOCKED, not merely penalised: no approver role can authorise it.
 */
export function checkSupplierQualification(supplierProduct, destinationMarket, supplierName) {
  const markets = (supplierProduct.qualified_markets || '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);

  if (!markets.includes(destinationMarket)) {
    return {
      ok: false,
      verdict: BLOCKED,
      code: 'SUPPLIER_NOT_QUALIFIED',
      reason:
        `${supplierName ?? supplierProduct.supplier_id} is not qualified to supply ` +
        `${supplierProduct.product_id} into market ${destinationMarket} ` +
        `(qualified: ${markets.join(', ') || 'none'}). ` +
        `This option is BLOCKED and cannot be approved by any role.`,
      detail: { destinationMarket, qualifiedMarkets: markets },
    };
  }

  return { ok: true };
}

/** Capacity gate — a route that physically cannot carry the volume is infeasible. */
export function checkCapacity(path, requiredUnits) {
  if (requiredUnits > path.minCapacityUnits) {
    return {
      ok: false,
      verdict: INFEASIBLE,
      code: 'INSUFFICIENT_CAPACITY',
      reason:
        `Required volume ${requiredUnits} units exceeds the binding lane capacity of ` +
        `${path.minCapacityUnits} units on this route.`,
      detail: { requiredUnits, availableUnits: path.minCapacityUnits },
    };
  }
  return { ok: true };
}

/** Supplier lead time cannot beat the need-by date. */
export function checkLeadTime(leadTimeDays, daysUntilNeed) {
  if (leadTimeDays > daysUntilNeed) {
    return {
      ok: false,
      verdict: INFEASIBLE,
      code: 'LEAD_TIME_EXCEEDS_NEED_BY',
      reason:
        `Lead time ${leadTimeDays} days exceeds the ${daysUntilNeed} days remaining ` +
        `before the earliest need-by date.`,
      detail: { leadTimeDays, daysUntilNeed },
    };
  }
  return { ok: true };
}

/**
 * Run a set of checks and collapse them into one verdict.
 * BLOCKED dominates INFEASIBLE: a prohibited option must never be presented as merely impractical.
 * ALL failures are retained (REQ-024) — we never silently drop an option or hide a second reason.
 */
export function evaluateConstraints(checks) {
  const failures = checks.filter((c) => c && c.ok === false);

  if (failures.length === 0) {
    return { feasibility: FEASIBLE, failures: [], reason: null };
  }

  const blocked = failures.find((f) => f.verdict === BLOCKED);
  const dominant = blocked ?? failures[0];

  return {
    feasibility: dominant.verdict,
    failures,
    reason: failures.map((f) => f.reason).join(' '),
    codes: failures.map((f) => f.code),
  };
}
