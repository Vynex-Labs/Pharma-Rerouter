/**
 * P4 verification — audit ledger integrity.
 * Traces: REQ-080, REQ-081, REQ-082, REQ-083 (closes risk AR-R2), REQ-084, REQ-085.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/index.mjs';
import { AuditLedger } from '../src/core/audit.mjs';

function ledgerWithEvents(n = 3) {
  const db = openDatabase(':memory:');
  const ledger = new AuditLedger(db);
  for (let i = 0; i < n; i++) {
    ledger.append({
      eventType: 'TEST_EVENT',
      actor: 'system',
      occurredAt: `2026-09-07T0${i}:00:00.000Z`,
      payload: { index: i, note: `event ${i}` },
    });
  }
  return { db, ledger };
}

test('REQ-081: a clean chain verifies', () => {
  const { ledger } = ledgerWithEvents(5);
  const r = ledger.verify();
  assert.equal(r.valid, true);
  assert.equal(r.events, 5);
});

/**
 * Simulate an attacker who has raw write access to the database file and has therefore already
 * defeated defence one (the append-only triggers). This is the ONLY honest way to test defence two.
 *
 * Note this is precisely why ADR-0003 claims tamper-EVIDENT and not tamper-PROOF: someone at this
 * privilege level can change a row. What they cannot do is leave the chain intact afterwards.
 */
function bypassAppendOnlyTriggers(db) {
  db.exec('DROP TRIGGER IF EXISTS audit_event_no_update');
  db.exec('DROP TRIGGER IF EXISTS audit_event_no_delete');
}

test('REQ-083: tampering with a payload breaks verification and names the record', () => {
  const { db, ledger } = ledgerWithEvents(4);
  assert.equal(ledger.verify().valid, true);

  bypassAppendOnlyTriggers(db);
  const target = db.prepare('SELECT seq, payload_json FROM audit_event ORDER BY seq LIMIT 1 OFFSET 1').get();
  const mutated = JSON.parse(target.payload_json);
  mutated.payload.note = 'quietly altered';
  db.prepare('UPDATE audit_event SET payload_json = ? WHERE seq = ?').run(
    JSON.stringify(mutated),
    target.seq,
  );

  const r = ledger.verify();
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'PAYLOAD_TAMPERED');
  assert.equal(r.brokenAtSeq, target.seq, 'must identify WHICH record changed');
});

test('REQ-083: rewriting a chain_hash is also detected', () => {
  const { db, ledger } = ledgerWithEvents(3);
  bypassAppendOnlyTriggers(db);
  db.prepare('UPDATE audit_event SET chain_hash = ? WHERE seq = 2').run('f'.repeat(64));
  const r = ledger.verify();
  assert.equal(r.valid, false);
  assert.ok(['CHAIN_HASH_MISMATCH', 'PREV_HASH_MISMATCH'].includes(r.reason));
});

test('REQ-082: UPDATE and DELETE on audit_event are blocked by trigger', () => {
  const { db } = ledgerWithEvents(2);
  assert.throws(
    () => db.prepare("UPDATE audit_event SET actor='mallory' WHERE seq=1").run(),
    /append-only/,
  );
  assert.throws(() => db.prepare('DELETE FROM audit_event WHERE seq=1').run(), /append-only/);
});

test('REQ-082: the envelope is hashed, so relabelling an event is detectable', () => {
  // actor/event_type live inside the hashed payload, not merely in columns.
  const { db, ledger } = ledgerWithEvents(2);
  const row = db.prepare('SELECT payload_json FROM audit_event WHERE seq=1').get();
  const parsed = JSON.parse(row.payload_json);
  assert.equal(parsed.actor, 'system');
  assert.equal(parsed.eventType, 'TEST_EVENT');
  assert.ok(ledger.verify().valid);
});

test('REQ-084: export is self-contained and carries its own integrity result', () => {
  const { ledger } = ledgerWithEvents(3);
  const out = ledger.export();
  assert.equal(out.events.length, 3);
  assert.equal(out.integrity.valid, true);
  assert.match(out.integrityModel, /Tamper-evident/);
  assert.doesNotMatch(out.integrityModel, /blockchain(?!;)/i);
});

test('REQ-085: integrity is described honestly, never as blockchain', () => {
  const { ledger } = ledgerWithEvents(1);
  const model = ledger.export().integrityModel;
  assert.match(model, /Not a blockchain/);
  assert.match(model, /not externally notarised/);
});
