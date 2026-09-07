/**
 * Persistence for computed artefacts (P9).
 *
 * P4 designed these tables and P5 computed the values, but nothing wired the two together — the
 * engines returned in-memory objects that were rendered and discarded. That gap is why a decision
 * could not reference the scenario it selected. This module closes it.
 *
 * DA-2: every scenario persists the `snapshot_id` it was computed from, so a stored decision can
 * always be re-derived from the exact inputs that produced it.
 */

/** Persists an impact assessment. Returns the stored id. */
export function persistImpact(db, { impact, disruptionId, snapshotId, narrative = null, now }) {
  const id = `IMP-${disruptionId}-${snapshotId.slice(-8)}`;

  db.prepare(
    `INSERT OR REPLACE INTO impact_assessment
       (id, disruption_id, snapshot_id, created_at, affected_json, days_of_cover_json,
        baseline_json, narrative, narrative_source)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(
    id, disruptionId, snapshotId, now ?? new Date().toISOString(),
    JSON.stringify({
      shipments: impact.affected.shipments,
      facilities: impact.affected.facilities,
      ordersAtRisk: impact.ordersAtRisk,
      closedLaneId: impact.closedLaneId,
    }),
    JSON.stringify(impact.daysOfCover),
    JSON.stringify(impact.baseline),
    narrative?.text ?? null,
    narrative?.source ?? 'DETERMINISTIC_FALLBACK',
  );

  return id;
}

/**
 * Persists every scenario — ranked AND excluded.
 *
 * REQ-024: excluded options are stored with their reason, not dropped. A decision record that
 * shows only the winner cannot answer "what else was considered?", which is the question an
 * auditor actually asks.
 */
export function persistScenarios(db, { ranked, excluded, impactId, snapshotId, rationales = {} }) {
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO scenario
       (id, impact_id, snapshot_id, strategy_type, origin, actions_json, cost_delta_minor,
        eta_hours, risk_score, orders_protected, feasibility, infeasibility_reason,
        score, rank, rationale, rationale_source)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );

  const all = [...ranked, ...excluded];
  const tx = db.transaction(() => {
    for (const s of all) {
      const r = rationales[s.id];
      stmt.run(
        s.id, impactId, snapshotId, s.strategyType, s.origin ?? 'ENGINE',
        JSON.stringify(s.actions ?? s.transfers ?? []),
        s.costDeltaMinor, s.etaHours, s.riskScore, s.ordersProtected,
        s.feasibility, s.infeasibilityReason ?? null,
        s.score ?? null, s.rank ?? null,
        r?.text ?? null, r?.source ?? 'DETERMINISTIC_FALLBACK',
      );
    }
  });
  tx();

  return all.map((s) => s.id);
}
