/**
 * Seeded synthetic network for the flagship scenario.
 *
 * Authority: docs/data-model.md §7. Requirements: REQ-101 (reproducible from a fixed seed),
 * REQ-102 (represents the flagship scenario completely), REQ-103 (lot-level expiry),
 * REQ-104 (per-market supplier qualification), REQ-105 (no personal data).
 *
 * DATA CLASSIFICATION: SYNTHETIC throughout. Cold-chain budgets, criticality tiers, shelf-life and
 * supplier qualification are ASSUMED / CONFIGURABLE RULE — they model real concepts with invented
 * values and are NOT cited regulatory facts (Master Prompt §2, §12).
 *
 * The network is tuned so that no option wins on every axis (docs/data-model.md §7):
 *   AIR_REROUTE          -> meets every date, breaches cost ceiling  => Finance escalation
 *   ALT_PORT             -> affordable, exceeds excursion budget     => INFEASIBLE (shown w/ reason)
 *   INVENTORY_REBALANCE  -> buys days for the critical site only     => partial
 *   ALT_SUPPLIER         -> unqualified in one market                => BLOCKED
 * One run therefore exercises FEASIBLE, INFEASIBLE, BLOCKED and MULTI-APPROVAL.
 */

/** Deterministic PRNG (mulberry32). ADR-0005 forbids Math.random() in seeded generation. */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fixed clock so seeded dates are reproducible (REQ-101). */
export const SEED_EPOCH = '2026-09-07T00:00:00.000Z';

function addDays(iso, days) {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function addHours(iso, hours) {
  const d = new Date(iso);
  d.setUTCHours(d.getUTCHours() + hours);
  return d.toISOString();
}

/**
 * Seeded identities, mapped to the P1 personas.
 *
 * Note P-3 Daniel holds COMPLIANCE_OFFICER and QUALITY_ASSURANCE — he has blocking power over
 * cold-chain and GxP-adjacent actions. Ravi deliberately does NOT hold QUALITY_ASSURANCE, so a
 * cold-chain reroute cannot be approved by him alone; that is the separation of duties the
 * flagship scenario is designed to exercise.
 */
export const IDENTITIES = [
  ['user:ravi',   'Ravi Menon',      'P-1', ['SUPPLY_CHAIN_MANAGER']],
  ['user:meera',  'Meera Iyer',      'P-2', ['PROCUREMENT_MANAGER']],
  ['user:daniel', 'Daniel Okoye',    'P-3', ['COMPLIANCE_OFFICER', 'QUALITY_ASSURANCE']],
  ['user:priya',  'Priya Raman',     'P-4', ['READ_ONLY']],
  ['user:sofia',  'Sofia Lindqvist', 'P-5', ['FINANCE_APPROVER', 'SUPPLY_CHAIN_MANAGER']],
];

export function seedDatabase(db, { seed = 20260907 } = {}) {
  const rng = makeRng(seed);
  const now = SEED_EPOCH;

  const insIdentity = db.prepare(
    'INSERT OR REPLACE INTO identity (id, display_name, persona, active) VALUES (?,?,?,1)');
  const insIdentityRole = db.prepare(
    'INSERT OR REPLACE INTO identity_role (identity_id, role) VALUES (?,?)');

  // ---------------------------------------------------------------- facilities
  const facilities = [
    // tier 1 — API suppliers
    ['SUP-PRIMARY', 'SUPPLIER', 1, 'Helix API Works (Singapore)', 'SG', 'APAC', 1.35, 103.82, 1, 500000],
    ['SUP-ALT', 'SUPPLIER', 1, 'Meridian Fine Chemicals (India)', 'IN', 'APAC', 19.08, 72.88, 1, 300000],
    // tier 2 — manufacturing
    ['MFG-01', 'MANUFACTURER', 2, 'Cold-Form Biologics Plant', 'SG', 'APAC', 1.29, 103.85, 1, 200000],
    ['MFG-02', 'MANUFACTURER', 2, 'Secondary Fill-Finish Site', 'MY', 'APAC', 3.14, 101.69, 1, 90000],
    // tier 3 — central DC
    ['DC-CENTRAL', 'DC', 3, 'Central Cold-Chain Distribution Centre', 'SG', 'APAC', 1.32, 103.9, 1, 400000],
    // tier 4 — regional warehouses (EU market — comfortable / tight / critical)
    ['WH-NORTH', 'WAREHOUSE', 4, 'Northern Regional Warehouse', 'NL', 'EU', 51.92, 4.48, 1, 120000],
    ['WH-CENTRAL', 'WAREHOUSE', 4, 'Central Regional Warehouse', 'DE', 'EU', 50.11, 8.68, 1, 120000],
    ['WH-SOUTH', 'WAREHOUSE', 4, 'Southern Regional Warehouse', 'IT', 'EU', 45.46, 9.19, 1, 90000],
    // tier 5 — hospitals
    ['HOSP-N1', 'HOSPITAL', 5, 'Northern University Hospital', 'NL', 'EU', 52.09, 5.12, 0, 4000],
    ['HOSP-N2', 'HOSPITAL', 5, 'Harbour District Hospital', 'NL', 'EU', 51.44, 5.48, 0, 3000],
    ['HOSP-C1', 'HOSPITAL', 5, 'Rhein-Main Klinikum', 'DE', 'EU', 50.05, 8.62, 0, 5000],
    ['HOSP-C2', 'HOSPITAL', 5, 'Stadtklinik Ost', 'DE', 'EU', 51.34, 12.37, 0, 3500],
    ['HOSP-S1', 'HOSPITAL', 5, 'Ospedale Metropolitano', 'IT', 'EU', 45.48, 9.23, 0, 4500],
    ['HOSP-S2', 'HOSPITAL', 5, 'Ospedale Regionale Sud', 'IT', 'EU', 40.85, 14.27, 0, 2500],
  ];

  const insFac = db.prepare(
    `INSERT INTO facility (id,type,tier,name,country,market,lat,lon,cold_chain_capable,capacity_units)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  );

  // ---------------------------------------------------------------- lanes
  // id, from, to, mode, hours, cost/unit(minor), reliability, cold, excursion_h, capacity
  const lanes = [
    ['LN-SUP1-MFG1', 'SUP-PRIMARY', 'MFG-01', 'ROAD', 6, 40, 98, 1, 0, 200000],
    ['LN-SUP2-MFG2', 'SUP-ALT', 'MFG-02', 'SEA', 168, 55, 91, 1, 4, 90000],
    ['LN-MFG1-DC', 'MFG-01', 'DC-CENTRAL', 'ROAD', 8, 35, 99, 1, 0, 200000],
    ['LN-MFG2-DC', 'MFG-02', 'DC-CENTRAL', 'ROAD', 24, 60, 95, 1, 1, 90000],

    // THE FLAGSHIP LANE — primary cold-chain sea corridor DC -> EU. Cheap, slow, high volume.
    ['LN-SEA-PRIMARY', 'DC-CENTRAL', 'WH-CENTRAL', 'SEA', 480, 120, 96, 1, 2, 250000],

    // Recovery option A — air. Fast, expensive, capacity-limited.
    ['LN-AIR-EXPRESS', 'DC-CENTRAL', 'WH-CENTRAL', 'AIR', 36, 1450, 97, 1, 1, 18000],

    // Recovery option B — alternate port + inland road. Affordable, slower,
    // and the combined excursion exceeds the product budget => INFEASIBLE by REQ-022.
    ['LN-SEA-ALTPORT', 'DC-CENTRAL', 'WH-SOUTH', 'SEA', 552, 140, 89, 1, 9, 200000],
    ['LN-ROAD-SOUTH-CENTRAL', 'WH-SOUTH', 'WH-CENTRAL', 'ROAD', 30, 95, 94, 1, 5, 60000],

    // Inter-warehouse rebalancing lanes (short, cold-chain, low excursion).
    ['LN-WH-N-C', 'WH-NORTH', 'WH-CENTRAL', 'ROAD', 10, 70, 97, 1, 1, 40000],
    ['LN-WH-C-N', 'WH-CENTRAL', 'WH-NORTH', 'ROAD', 10, 70, 97, 1, 1, 40000],
    ['LN-WH-C-S', 'WH-CENTRAL', 'WH-SOUTH', 'ROAD', 14, 80, 96, 1, 2, 40000],
    ['LN-WH-S-C', 'WH-SOUTH', 'WH-CENTRAL', 'ROAD', 14, 80, 96, 1, 2, 40000],

    // Last mile to hospitals.
    ['LN-WHN-H1', 'WH-NORTH', 'HOSP-N1', 'ROAD', 3, 25, 99, 1, 0, 8000],
    ['LN-WHN-H2', 'WH-NORTH', 'HOSP-N2', 'ROAD', 3, 25, 99, 1, 0, 8000],
    ['LN-WHC-H1', 'WH-CENTRAL', 'HOSP-C1', 'ROAD', 2, 22, 99, 1, 0, 8000],
    ['LN-WHC-H2', 'WH-CENTRAL', 'HOSP-C2', 'ROAD', 5, 30, 98, 1, 0, 8000],
    ['LN-WHS-H1', 'WH-SOUTH', 'HOSP-S1', 'ROAD', 2, 22, 99, 1, 0, 8000],
    ['LN-WHS-H2', 'WH-SOUTH', 'HOSP-S2', 'ROAD', 6, 34, 97, 1, 0, 8000],
  ];

  const insLane = db.prepare(
    `INSERT INTO lane (id,from_facility_id,to_facility_id,mode,transit_hours,cost_per_unit_minor,
                       reliability_pct,cold_chain_capable,excursion_hours,capacity_units)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  );

  // ---------------------------------------------------------------- products
  // max_excursion_hours = 8 makes ALT_PORT (9h + 5h) infeasible and AIR (1h) feasible.
  const products = [
    ['PRD-VAX-01', '000000000000100001', 'Thermolabile Vaccine A', 'VIAL', 4, 1, 2.0, 8.0, 8, 240],
    ['PRD-BIO-02', '000000000000100002', 'Biologic Infusion B', 'VIAL', 3, 1, 2.0, 8.0, 12, 180],
  ];

  const insProd = db.prepare(
    `INSERT INTO product (id,sap_material_number,name,form,criticality,requires_cold_chain,
                          min_temp_c,max_temp_c,max_excursion_hours,shelf_life_days)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  );

  // ---------------------------------------------------------------- inventory lots
  // Deliberately mixed expiry so shelf-life netting (REQ-012) changes the answer:
  // WH-CENTRAL looks adequate on raw quantity but a large lot expires inside the horizon.
  const lots = [
    // id, product, facility, qty, expiry offset days
    ['LOT-C-001', 'PRD-VAX-01', 'WH-CENTRAL', 4200, 90],
    // Short-dated bulk lot: 20,000 units but only 3 days of shelf life left. At 1,400 units/day
    // only 4,200 units can ever be consumed — the remaining 15,800 are NOT cover. Raw stock says
    // this site is comfortable; shelf-life netting (REQ-012) says it is not. This is the Domain
    // Expert's P1 Challenge 3 made concrete, and it must change the answer or REQ-012 is untested.
    ['LOT-C-002', 'PRD-VAX-01', 'WH-CENTRAL', 20000, 3],
    ['LOT-C-003', 'PRD-BIO-02', 'WH-CENTRAL', 3000, 120],
    ['LOT-N-001', 'PRD-VAX-01', 'WH-NORTH', 15000, 150], // the surplus that enables rebalancing
    ['LOT-N-002', 'PRD-BIO-02', 'WH-NORTH', 6000, 140],
    ['LOT-S-001', 'PRD-VAX-01', 'WH-SOUTH', 2600, 75],
    ['LOT-S-002', 'PRD-BIO-02', 'WH-SOUTH', 1800, 60],
    ['LOT-DC-001', 'PRD-VAX-01', 'DC-CENTRAL', 60000, 200],
    ['LOT-DC-002', 'PRD-BIO-02', 'DC-CENTRAL', 25000, 210],
  ];

  const insLot = db.prepare(
    `INSERT INTO inventory_lot (id,product_id,facility_id,quantity_units,expiry_date,status,
                                data_source,fetched_at)
     VALUES (?,?,?,?,?,'AVAILABLE','SIMULATED',?)`,
  );

  // ---------------------------------------------------------------- demand
  // WH-CENTRAL burns fastest -> it becomes the critical site once the sea lane closes.
  const demand = [
    ['PRD-VAX-01', 'WH-CENTRAL', 1400],
    ['PRD-BIO-02', 'WH-CENTRAL', 400],
    ['PRD-VAX-01', 'WH-NORTH', 700],
    ['PRD-BIO-02', 'WH-NORTH', 260],
    ['PRD-VAX-01', 'WH-SOUTH', 520],
    ['PRD-BIO-02', 'WH-SOUTH', 200],
  ];

  const insDemand = db.prepare(
    `INSERT INTO demand_rate (product_id,facility_id,daily_demand_units) VALUES (?,?,?)`,
  );

  // ---------------------------------------------------------------- orders
  const orders = [
    ['ORD-0001', 'PRD-VAX-01', 'HOSP-C1', 3200, 5, 4],
    ['ORD-0002', 'PRD-VAX-01', 'HOSP-C2', 2400, 7, 4],
    ['ORD-0003', 'PRD-BIO-02', 'HOSP-C1', 900, 9, 3],
    ['ORD-0004', 'PRD-VAX-01', 'HOSP-N1', 2100, 11, 3],
    ['ORD-0005', 'PRD-VAX-01', 'HOSP-N2', 1500, 13, 2],
    ['ORD-0006', 'PRD-VAX-01', 'HOSP-S1', 1800, 8, 3],
    ['ORD-0007', 'PRD-BIO-02', 'HOSP-S2', 700, 12, 2],
  ];

  const insOrder = db.prepare(
    `INSERT INTO order_line (id,product_id,destination_facility_id,quantity_units,need_by_date,priority)
     VALUES (?,?,?,?,?,?)`,
  );

  // ---------------------------------------------------------------- in-flight shipments
  const shipments = [
    ['SHP-1001', 'PRD-VAX-01', 12000, 'DC-CENTRAL', 'WH-CENTRAL', 'LN-SEA-PRIMARY', -120, 360],
    ['SHP-1002', 'PRD-BIO-02', 4000, 'DC-CENTRAL', 'WH-CENTRAL', 'LN-SEA-PRIMARY', -48, 432],
    ['SHP-1003', 'PRD-VAX-01', 6000, 'DC-CENTRAL', 'WH-SOUTH', 'LN-SEA-ALTPORT', -72, 480],
    ['SHP-1004', 'PRD-VAX-01', 3000, 'MFG-01', 'DC-CENTRAL', 'LN-MFG1-DC', -4, 4],
  ];

  const insShip = db.prepare(
    `INSERT INTO shipment (id,product_id,quantity_units,origin_facility_id,destination_facility_id,
                           lane_id,departed_at,eta,status)
     VALUES (?,?,?,?,?,?,?,?,'IN_TRANSIT')`,
  );

  // ---------------------------------------------------------------- supplier qualification
  // REQ-104 / condition DE-2: the alternate supplier is NOT qualified for EU, so any scenario
  // routing EU demand through it must be BLOCKED — not merely costed higher.
  const supplierProducts = [
    ['SUP-PRIMARY', 'PRD-VAX-01', 21, 310, 400000, 'EU,APAC'],
    ['SUP-PRIMARY', 'PRD-BIO-02', 28, 520, 200000, 'EU,APAC'],
    ['SUP-ALT', 'PRD-VAX-01', 34, 260, 250000, 'APAC'],
    ['SUP-ALT', 'PRD-BIO-02', 40, 480, 120000, 'APAC'],
  ];

  const insSupProd = db.prepare(
    `INSERT INTO supplier_product (supplier_id,product_id,lead_time_days,unit_cost_minor,
                                   capacity_units,qualified_markets)
     VALUES (?,?,?,?,?,?)`,
  );

  // ---------------------------------------------------------------- the disruption
  // raw_advisory_text is UNTRUSTED input (ADR-0002 §5) and is the unstructured signal the
  // Sensing Agent (seam S1) must interpret. Realistic phrasing; the event is invented.
  const advisory = [
    'MARITIME ADVISORY 2026-09-07 06:15Z — Terminal operations at the primary transhipment',
    'hub serving the Northern Europe corridor are suspended following a cascading power',
    'failure affecting reefer plug capacity. Vessels currently at berth are being worked at',
    'reduced rate; inbound vessels are being held at anchorage. Reefer monitoring for',
    'temperature-controlled containers is degraded. Terminal operator indicates a provisional',
    'restoration window of 96 to 144 hours but has not confirmed reefer power restoration.',
    'Carriers are advising shippers of temperature-controlled cargo to consider alternative',
    'routings. No estimate has been given for backlog clearance after restoration.',
  ].join(' ');

  const insDisruption = db.prepare(
    `INSERT INTO disruption_event
       (id,detected_at,raw_advisory_text,reported_lane_id,event_type,severity,confidence,
        geography,expected_duration_hours,classification_source)
     VALUES (?,?,?,?,NULL,NULL,NULL,NULL,NULL,'DETERMINISTIC_FALLBACK')`,
  );

  // ---------------------------------------------------------------- transaction
  const tx = db.transaction(() => {
    for (const f of facilities) insFac.run(...f);
    for (const l of lanes) insLane.run(...l);
    for (const p of products) insProd.run(...p);
    for (const [id, prod, fac, qty, off] of lots) {
      insLot.run(id, prod, fac, qty, addDays(now, off), now);
    }
    for (const d of demand) insDemand.run(...d);
    for (const [id, prod, dest, qty, off, pri] of orders) {
      insOrder.run(id, prod, dest, qty, addDays(now, off), pri);
    }
    for (const [id, prod, qty, o, d, lane, depOff, etaOff] of shipments) {
      insShip.run(id, prod, qty, o, d, lane, addHours(now, depOff), addHours(now, etaOff));
    }
    for (const s of supplierProducts) insSupProd.run(...s);
    insDisruption.run('DSR-0001', now, advisory, 'LN-SEA-PRIMARY');

    // ---------------------------------------------------------------- identities (P12)
    // Modelled on the P1 personas. Seeded, not self-registered: this is an internal control tower
    // and P12 governs authorization (who may approve what), not authentication.
    for (const [id, name, persona, roles] of IDENTITIES) {
      insIdentity.run(id, name, persona);
      for (const r of roles) insIdentityRole.run(id, r);
    }
  });

  tx();

  // rng is intentionally exercised so the seed parameter is meaningful for future jitter;
  // all current values are fixed by design for reproducibility (REQ-101/NFR-004).
  void rng;

  return {
    seed,
    identities: IDENTITIES.length,
    facilities: facilities.length,
    lanes: lanes.length,
    products: products.length,
    lots: lots.length,
    orders: orders.length,
    shipments: shipments.length,
    disruptions: 1,
  };
}
