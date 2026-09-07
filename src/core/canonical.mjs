/**
 * Canonical serialisation + hashing.
 *
 * Closes P2 condition DA-1. Authority: docs/data-model.md §3.
 *
 * The Data Architect's objection at P2 was that `JSON.stringify` is unsafe for hashing because key
 * order, float formatting and timezone rendering can all vary between two semantically identical
 * objects — producing false audit-verification failures. This module is the single answer to that.
 *
 * Rules (binding, mirrored in docs/data-model.md §3):
 *   1. object keys sorted lexicographically by UTF-16 code unit, recursively
 *   2. no insignificant whitespace
 *   3. money/quantity are integers upstream, so no float ever reaches a hash
 *   4. any unavoidable non-integer is fixed to 6 decimal places
 *   5. timestamps normalised to UTC ISO-8601 with 'Z', millisecond precision
 *   6. `undefined` omitted; `null` preserved (semantically different here)
 *   7. UTF-8 before hashing
 */

import { createHash } from 'node:crypto';

export const GENESIS_HASH = '0'.repeat(64);
const ISO_LIKE = /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/;

/** Rule 5 — normalise anything that is unambiguously an instant to UTC ms precision. */
function normaliseTimestamp(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && ISO_LIKE.test(value)) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return value;
}

/** Rule 4 — deterministic number rendering. Integers stay integers. */
function normaliseNumber(n) {
  if (!Number.isFinite(n)) {
    throw new TypeError(`Non-finite number cannot be canonicalised: ${n}`);
  }
  if (Number.isInteger(n)) return String(n);
  // Strip trailing zeros so 1.5 and 1.500000 hash identically.
  return n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '.0');
}

function encode(value) {
  if (value === null) return 'null';                       // rule 6

  const t = typeof value;

  if (t === 'number') return normaliseNumber(value);
  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'bigint') return String(value);
  if (t === 'string' || value instanceof Date) {
    return JSON.stringify(normaliseTimestamp(value));      // rule 5
  }

  if (Array.isArray(value)) {
    // Array order is semantic — never sorted. Callers sort upstream when order is not meaningful.
    return `[${value.map((v) => encode(v === undefined ? null : v)).join(',')}]`;
  }

  if (t === 'object') {
    const keys = Object.keys(value)
      .filter((k) => value[k] !== undefined)               // rule 6
      .sort();                                             // rule 1
    return `{${keys.map((k) => `${JSON.stringify(k)}:${encode(value[k])}`).join(',')}}`;
  }

  throw new TypeError(`Unsupported type in canonical serialisation: ${t}`);
}

/** Canonical string form of a value. Deterministic across key insertion order. */
export function canonicalise(value) {
  return encode(value === undefined ? null : value);
}

/** SHA-256 over the canonical form, hex encoded. */
export function hashCanonical(value) {
  return createHash('sha256').update(canonicalise(value), 'utf8').digest('hex');
}

/**
 * One link of the audit chain: hash_n = SHA256( hash_{n-1} || canonical(payload) )
 * Returns both hashes so the caller can persist payload_hash and chain_hash separately —
 * the payload hash lets us prove *which* record changed, not merely that one did.
 */
export function chainHash(prevHash, payload) {
  const payloadHash = hashCanonical(payload);
  const chain = createHash('sha256')
    .update(prevHash, 'utf8')
    .update(canonicalise(payload), 'utf8')
    .digest('hex');
  return { payloadHash, chainHash: chain };
}
