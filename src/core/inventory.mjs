/**
 * Inventory engine — days-of-cover with shelf-life netting.
 *
 * Authority: docs/data-model.md; P1 §13 Challenge 3 (Domain Expert, binding).
 * Requirements: REQ-011, REQ-012 (shelf-life netting), REQ-013 (do-nothing baseline).
 *
 * The Domain Expert's objection at P1 was that days-of-cover without shelf-life is misleading:
 * stock that expires before it can be consumed is not cover. This module nets it out, and the
 * seed data is deliberately shaped so that netting CHANGES the answer at WH-CENTRAL.
 */

const MS_PER_DAY = 86_400_000;

export function daysBetween(fromIso, toIso) {
  return Math.floor((new Date(toIso).getTime() - new Date(fromIso).getTime()) / MS_PER_DAY);
}

/**
 * Usable quantity at a facility for a product as of `asOf`.
 *
 * A lot contributes only the units that can actually be consumed before it expires:
 * a lot expiring in 6 days against 1400 units/day demand contributes at most 8400 units,
 * however large the lot is. Lots already expired contribute nothing.
 */
export function usableQuantity(lots, { asOf, dailyDemandUnits }) {
  let usable = 0;
  let expiringSoonUnits = 0;
  let rawTotal = 0;

  for (const lot of [...lots].sort((a, b) => a.id.localeCompare(b.id))) {
    if (lot.status !== 'AVAILABLE') continue;
    rawTotal += lot.quantity_units;

    const daysToExpiry = daysBetween(asOf, `${lot.expiry_date}T00:00:00.000Z`);
    if (daysToExpiry <= 0) {
      expiringSoonUnits += lot.quantity_units;
      continue;
    }

    if (dailyDemandUnits > 0) {
      const consumable = Math.min(lot.quantity_units, daysToExpiry * dailyDemandUnits);
      usable += consumable;
      expiringSoonUnits += lot.quantity_units - consumable;
    } else {
      usable += lot.quantity_units;
    }
  }

  return { usableUnits: usable, rawTotalUnits: rawTotal, unusableUnits: expiringSoonUnits };
}

/**
 * Days-of-cover per facility+product.
 * `inboundByFacility` lets callers model "what if this shipment arrives / does not arrive".
 */
export function computeDaysOfCover(snapshot, { asOf, inboundByFacility = new Map() } = {}) {
  const results = [];

  const demandRows = [...snapshot.demand].sort(
    (a, b) => a.facility_id.localeCompare(b.facility_id) || a.product_id.localeCompare(b.product_id),
  );

  for (const d of demandRows) {
    const lots = snapshot.lots.filter(
      (l) => l.facility_id === d.facility_id && l.product_id === d.product_id,
    );

    const { usableUnits, rawTotalUnits, unusableUnits } = usableQuantity(lots, {
      asOf,
      dailyDemandUnits: d.daily_demand_units,
    });

    const inboundKey = `${d.facility_id}|${d.product_id}`;
    const inboundUnits = inboundByFacility.get(inboundKey) ?? 0;

    const effective = usableUnits + inboundUnits;
    const daysOfCover =
      d.daily_demand_units > 0 ? Math.floor(effective / d.daily_demand_units) : Infinity;

    const stockoutDate =
      Number.isFinite(daysOfCover)
        ? new Date(new Date(asOf).getTime() + daysOfCover * MS_PER_DAY).toISOString().slice(0, 10)
        : null;

    results.push({
      facilityId: d.facility_id,
      productId: d.product_id,
      dailyDemandUnits: d.daily_demand_units,
      rawTotalUnits,
      usableUnits,
      unusableUnits, // REQ-012 evidence: what shelf-life netting removed
      inboundUnits,
      effectiveUnits: effective,
      daysOfCover,
      stockoutDate,
      status: classifyCover(daysOfCover),
    });
  }

  return results;
}

/**
 * Cover bands. CONFIGURABLE RULE — organisational thresholds, not cited regulation.
 */
export const COVER_THRESHOLDS = { critical: 3, warning: 7, watch: 14 };

export function classifyCover(days) {
  if (!Number.isFinite(days)) return 'HEALTHY';
  if (days <= COVER_THRESHOLDS.critical) return 'CRITICAL';
  if (days <= COVER_THRESHOLDS.warning) return 'WARNING';
  if (days <= COVER_THRESHOLDS.watch) return 'WATCH';
  return 'HEALTHY';
}

/** Orders that cannot be met from projected cover at their destination by their need-by date. */
export function ordersAtRisk(snapshot, coverRows, { asOf }) {
  const coverIndex = new Map(coverRows.map((c) => [`${c.facilityId}|${c.productId}`, c]));
  const risks = [];

  for (const order of [...snapshot.orders].sort((a, b) => a.id.localeCompare(b.id))) {
    // Hospitals draw from their upstream warehouse; resolve it from the graph edges.
    const supplyingLane = snapshot.lanes.find(
      (l) => l.to_facility_id === order.destination_facility_id && l.status !== 'CLOSED',
    );
    const sourceFacility = supplyingLane ? supplyingLane.from_facility_id : null;
    if (!sourceFacility) continue;

    const cover = coverIndex.get(`${sourceFacility}|${order.product_id}`);
    if (!cover) continue;

    const daysUntilNeed = daysBetween(asOf, `${order.need_by_date}T00:00:00.000Z`);
    const atRisk = cover.daysOfCover < daysUntilNeed;

    if (atRisk) {
      risks.push({
        orderId: order.id,
        productId: order.product_id,
        destinationFacilityId: order.destination_facility_id,
        sourceFacilityId: sourceFacility,
        quantityUnits: order.quantity_units,
        needByDate: order.need_by_date,
        daysUntilNeed,
        coverDays: cover.daysOfCover,
        shortfallDays: daysUntilNeed - cover.daysOfCover,
        priority: order.priority,
      });
    }
  }

  return risks.sort((a, b) => b.priority - a.priority || a.orderId.localeCompare(b.orderId));
}
