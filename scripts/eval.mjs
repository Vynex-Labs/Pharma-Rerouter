#!/usr/bin/env node
/** Runs the P11 AI evaluation suite and writes docs/evidence/ai-eval-report.json. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { runEval } from '../src/eval/runner.mjs';

const report = await runEval();
mkdirSync(new URL('../docs/evidence/', import.meta.url), { recursive: true });
const out = new URL('../docs/evidence/ai-eval-report.json', import.meta.url);
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);

const bar = (p, t) => `${'#'.repeat(p)}${'.'.repeat(t - p)}`;
console.log('\nAI Evaluation — guardrail suite (P11)\n');
for (const [cat, s] of Object.entries(report.byCategory)) {
  console.log(`  ${cat.padEnd(14)} ${bar(s.passed, s.total)}  ${s.passed}/${s.total}`);
}
console.log(`\n  TOTAL ${report.passed}/${report.total}  (${(report.passRate * 100).toFixed(1)}%)`);
for (const r of report.results.filter((x) => !x.pass)) {
  console.log(`  FAIL ${r.id} ${r.title}: expected ${r.expected}, got ${r.actual}`);
}
console.log('\n  Limitations:');
for (const l of report.limitations) console.log(`   - ${l}`);
console.log(`\n  Report: docs/evidence/ai-eval-report.json\n`);
process.exit(report.failed === 0 ? 0 : 1);
