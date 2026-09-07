/**
 * Append-only, hash-chained audit ledger.
 *
 * Authority: ADR-0003 §5, docs/data-model.md §3.
 * Requirements: REQ-080 (record §14 fields), REQ-081 (chain), REQ-082 (no update/delete),
 *               REQ-083 (tampering detectable), REQ-084 (export).
 *
 * Honesty note (ADR-0003, REQ-085): this is tamper-EVIDENT within one database. It is not a
 * blockchain and is not externally notarised. Someone with write access to the file could rewrite
 * the entire chain. What they cannot do is alter one record and leave the chain intact.
 */

import { randomUUID } from 'node:crypto';
import { chainHash, GENESIS_HASH, hashCanonical } from './canonical.mjs';

export class AuditLedger {
  #db;

  constructor(db) {
    this.#db = db;
  }

  #tip() {
    const row = this.#db
      .prepare('SELECT chain_hash FROM audit_event ORDER BY seq DESC LIMIT 1')
      .get();
    return row ? row.chain_hash : GENESIS_HASH;
  }

  /**
   * Append an event. The payload carries the Master Prompt §14 fields supplied by the caller;
   * this method adds identity, ordering and integrity.
   */
  append({ eventType, actor, decisionId = null, occurredAt, payload }) {
    const eventId = randomUUID();
    const at = occurredAt ?? new Date().toISOString();

    // The hashed payload includes the envelope, so event_type/actor/time are covered by the chain
    // too — otherwise an attacker could relabel an event without breaking verification.
    const full = { eventId, eventType, actor, decisionId, occurredAt: at, payload };

    const prev = this.#tip();
    const { payloadHash, chainHash: chain } = chainHash(prev, full);

    this.#db
      .prepare(
        `INSERT INTO audit_event
           (event_id, occurred_at, event_type, decision_id, actor,
            payload_json, prev_hash, payload_hash, chain_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        eventId,
        at,
        eventType,
        decisionId,
        actor,
        JSON.stringify(full),
        prev,
        payloadHash,
        chain,
      );

    return { eventId, chainHash: chain };
  }

  /**
   * Walk the whole chain and recompute every link.
   * Returns the first break with enough detail to say WHICH record failed and why —
   * "the chain is broken" is not useful evidence on its own.
   */
  verify() {
    const rows = this.#db
      .prepare(
        `SELECT seq, event_id, payload_json, prev_hash, payload_hash, chain_hash
           FROM audit_event ORDER BY seq ASC`,
      )
      .all();

    let expectedPrev = GENESIS_HASH;

    for (const row of rows) {
      const payload = JSON.parse(row.payload_json);

      if (row.prev_hash !== expectedPrev) {
        return {
          valid: false,
          brokenAtSeq: row.seq,
          eventId: row.event_id,
          reason: 'PREV_HASH_MISMATCH',
          detail: `expected prev_hash ${expectedPrev}, stored ${row.prev_hash}`,
        };
      }

      const recomputedPayload = hashCanonical(payload);
      if (recomputedPayload !== row.payload_hash) {
        return {
          valid: false,
          brokenAtSeq: row.seq,
          eventId: row.event_id,
          reason: 'PAYLOAD_TAMPERED',
          detail: 'stored payload does not hash to the stored payload_hash',
        };
      }

      const { chainHash: recomputedChain } = chainHash(row.prev_hash, payload);
      if (recomputedChain !== row.chain_hash) {
        return {
          valid: false,
          brokenAtSeq: row.seq,
          eventId: row.event_id,
          reason: 'CHAIN_HASH_MISMATCH',
          detail: 'stored chain_hash is not derivable from prev_hash + payload',
        };
      }

      expectedPrev = row.chain_hash;
    }

    return { valid: true, events: rows.length, tip: expectedPrev };
  }

  /** REQ-084 — self-contained, verifiable evidence export. */
  export() {
    const rows = this.#db
      .prepare('SELECT * FROM audit_event ORDER BY seq ASC')
      .all()
      .map((r) => ({ ...r, payload: JSON.parse(r.payload_json), payload_json: undefined }));

    return {
      exportedAt: new Date().toISOString(),
      integrity: this.verify(),
      integrityModel:
        'Tamper-evident hash chain (SHA-256) within a single database. ' +
        'Not a blockchain; not externally notarised.',
      events: rows,
    };
  }
}
