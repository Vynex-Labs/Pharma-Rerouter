/**
 * P4 verification — canonical serialisation (closes condition DA-1).
 * Traces: REQ-081, REQ-051, docs/data-model.md §3.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalise, hashCanonical, chainHash, GENESIS_HASH } from '../src/core/canonical.mjs';

test('DA-1: key insertion order does not change the hash', () => {
  const a = { zebra: 1, alpha: 2, middle: { y: 1, x: 2 } };
  const b = { middle: { x: 2, y: 1 }, alpha: 2, zebra: 1 };
  assert.equal(canonicalise(a), canonicalise(b));
  assert.equal(hashCanonical(a), hashCanonical(b));
});

test('DA-1: array order IS significant (it is semantic)', () => {
  assert.notEqual(hashCanonical({ r: ['a', 'b'] }), hashCanonical({ r: ['b', 'a'] }));
});

test('DA-1: equivalent timestamp renderings normalise to one hash', () => {
  const utc = { t: '2026-09-07T12:00:00.000Z' };
  const offset = { t: '2026-09-07T14:00:00.000+02:00' };
  assert.equal(hashCanonical(utc), hashCanonical(offset));
});

test('DA-1: Date objects and their ISO strings agree', () => {
  const d = new Date('2026-09-07T12:00:00.000Z');
  assert.equal(hashCanonical({ t: d }), hashCanonical({ t: '2026-09-07T12:00:00.000Z' }));
});

test('DA-1: float formatting is stable', () => {
  assert.equal(hashCanonical({ n: 1.5 }), hashCanonical({ n: 1.5000000 }));
  assert.equal(canonicalise({ n: 2 }), '{"n":2}', 'integers stay integers');
});

test('DA-1: undefined is omitted but null is preserved', () => {
  assert.equal(canonicalise({ a: 1, b: undefined }), '{"a":1}');
  assert.equal(canonicalise({ a: 1, b: null }), '{"a":1,"b":null}');
  assert.notEqual(hashCanonical({ b: null }), hashCanonical({}));
});

test('DA-1: non-finite numbers are rejected rather than silently hashed', () => {
  assert.throws(() => canonicalise({ n: NaN }), TypeError);
  assert.throws(() => canonicalise({ n: Infinity }), TypeError);
});

test('chain link is deterministic and depends on both prev hash and payload', () => {
  const p = { event: 'X', v: 1 };
  const one = chainHash(GENESIS_HASH, p);
  const two = chainHash(GENESIS_HASH, p);
  assert.equal(one.chainHash, two.chainHash);
  assert.notEqual(chainHash('a'.repeat(64), p).chainHash, one.chainHash);
  assert.notEqual(chainHash(GENESIS_HASH, { event: 'X', v: 2 }).chainHash, one.chainHash);
});
