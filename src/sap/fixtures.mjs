/**
 * SAP_SANDBOX_SHAPE_FIXTURE
 *
 * These payloads reproduce the SHAPE of SAP S/4HANA Cloud OData V2 responses for
 * API_MATERIAL_STOCK_SRV / A_MaterialStock (OData V2 wraps results in `d.results`).
 *
 * WHAT THESE PROVE:      our field mapping is correct against the published contract.
 * WHAT THESE DO NOT PROVE: that we have ever successfully called SAP.
 *
 * Per ADR-0004 §4 and condition SAP-1, connectivity may only be claimed once a real
 * request/response pair (redacted) is attached to the P7 evidence package. It has not been,
 * because no API key is provisioned in this environment (assumption A-01).
 */

export const MATERIAL_STOCK_V2_RESPONSE = {
  d: {
    results: [
      {
        __metadata: { type: 'API_MATERIAL_STOCK_SRV.A_MaterialStockType' },
        Material: '000000000000100001',
        Plant: '1010',
        StorageLocation: '101A',
        Batch: 'LOT-C-001',
        InventoryStockType: '01',
        MatlWrhsStkQtyInMatlBaseUnit: '4200.000',
        MaterialBaseUnit: 'EA',
      },
      {
        __metadata: { type: 'API_MATERIAL_STOCK_SRV.A_MaterialStockType' },
        Material: '000000000000100001',
        Plant: '1010',
        StorageLocation: '101A',
        Batch: 'LOT-C-002',
        InventoryStockType: '01',
        MatlWrhsStkQtyInMatlBaseUnit: '20000.000',
        MaterialBaseUnit: 'EA',
      },
    ],
  },
};

/** OData V4 style, which returns a flat `value` array — the adapter must handle both. */
export const MATERIAL_STOCK_V4_RESPONSE = {
  value: [
    {
      Material: '000000000000100002',
      Plant: '1010',
      StorageLocation: '101B',
      Batch: '',
      InventoryStockType: '01',
      MatlWrhsStkQtyInMatlBaseUnit: '3000',
      MaterialBaseUnit: 'EA',
    },
  ],
};

/** Deterministic simulation used when no credentials exist. Reads our own synthetic lots. */
export function makeSimulator(db) {
  return ({ material }) => {
    const rows = db
      .prepare(
        `SELECT l.id AS batch, l.quantity_units, l.facility_id, p.sap_material_number
           FROM inventory_lot l JOIN product p ON p.id = l.product_id
          WHERE p.sap_material_number = ? AND l.status = 'AVAILABLE'
          ORDER BY l.id`,
      )
      .all(material);

    return rows.map((r) => ({
      material: r.sap_material_number,
      plant: r.facility_id,
      storageLocation: null,
      batch: r.batch,
      quantityUnits: r.quantity_units,
      unit: 'EA',
      stockType: '01',
    }));
  };
}
