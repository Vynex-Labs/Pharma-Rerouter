#!/usr/bin/env node
/**
 * End-to-end demo (P9). Runs the flagship scenario from detection to SEALED and prints the trace.
 *
 * Usage:
 *   node scripts/demo.mjs            # halts at PENDING_APPROVAL (the honest default)
 *   node scripts/demo.mjs --approve  # supplies approval evidence and continues to SEALED
 */

import { openDatabase } from '../src/db/index.mjs';
import { seedDatabase, SEED_EPOCH } from '../src/db/seed.mjs';
import { AuditLedger } from '../src/core/audit.mjs';
import { providerFromEnv } from '../src/agents/provider.mjs';
import { runPipeline } from '../src/core/pipeline.mjs';

const approve = process.argv.includes('--approve');

const db = openDatabase(':memory:');
seedDatabase(db);
const ledger = new AuditLedger(db);
const provider = providerFromEnv();

const t0 = Date.now();
const r = await runPipeline({
  db, ledger, provider, asOf: SEED_EPOCH,
  approval: approve
    ? { approverIdentity: 'user:sofia', approvals: ['user:sofia', 'user:daniel'] }
    : null,
});
const ms = Date.now() - t0;

const line = (k, v) => console.log(`  ${String(k).padEnd(22)} ${v}`);

console.log('\n=== Pharma-Rerouter — flagship scenario ===');
console.log('  data classification    SYNTHETIC (seed 20260907)');
console.log(`  LLM provider           ${provider.name} (${provider.model})`);
console.log(`  pipeline latency       ${ms} ms\n`);

console.log('--- state machine');
for (const t of r.trace) {
  const { step, ...rest } = t;
  const detail = Object.entries(rest)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join('+') : v}`).join('  ');
  console.log(`  ${step.padEnd(22)} ${detail}`);
}

console.log('\n--- impact (deterministic)');
line('orders at risk', r.impact.ordersAtRisk.length);
line('shipments held', r.impact.affected.shipments.length);
line('earliest stockout', r.impact.baseline.earliestStockoutDate ?? '—');

console.log('\n--- options considered');
for (const s of r.ranked) {
  line(`#${s.rank} ${s.strategyType}`, `score ${s.score}  eta ${s.etaHours}h  risk ${s.riskScore}  cost ${(s.costDeltaMinor / 100).toLocaleString()}`);
}
for (const s of r.excluded) {
  line(`--  ${s.strategyType}`, `${s.feasibility} — ${s.infeasibilityReason}`);
}

console.log('\n--- policy');
line('autonomy class', r.policy.autonomyClass);
line('required roles', r.policy.requiredRoles.join(' + ') || 'none');
line('reason', r.policy.reason);

if (r.executed) {
  console.log('\n--- execution (SIMULATED — no carrier contacted)');
  line('outcome', r.executed.outcome);
  line('actions', r.actions.map((a) => a.type).join(', '));
  console.log('\n--- recovery verification');
  const checks = JSON.parse(r.recovery.notes);
  for (const c of checks) line(c.name, `target ${c.target}  actual ${c.actual}  ${c.met ? 'MET' : 'MISSED'}`);
  line('objective met', r.recovery.objective_met === 1);
  line('orders at risk after', r.afterImpact.ordersAtRisk.length);
} else {
  console.log('\n--- halted');
  console.log('  The pipeline stops at PENDING_APPROVAL. Nothing executed, no authorization minted.');
  console.log('  Re-run with --approve to supply approval evidence and continue.');
}

const v = ledger.verify();
console.log('\n--- audit');
line('final state', r.state);
line('chain valid', v.valid);
line('events', db.prepare('SELECT COUNT(*) c FROM audit_event').get().c);
console.log('');
