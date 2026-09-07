/**
 * P11 — the AI evaluation harness, asserted as a test so a regression in a guardrail
 * fails the build rather than merely lowering a number in a report nobody reads.
 *
 * Covers condition AI-2 and NFR-012.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runEval, classifyResult } from '../src/eval/runner.mjs';
import { EVAL_CASES, VERDICTS } from '../src/eval/cases.mjs';

const report = await runEval();

test('AI-2: every adversarial case reaches its expected verdict', () => {
  const failures = report.results.filter((r) => !r.pass).map((r) => ({
    id: r.id, title: r.title, expected: r.expected, actual: r.actual,
    failedChecks: r.checks.filter((c) => !c.pass),
  }));
  assert.deepEqual(failures, [], `guardrail regressions:\n${JSON.stringify(failures, null, 2)}`);
});

test('AI-2: the pass rate is 100% — a guardrail suite is not graded on a curve', () => {
  assert.equal(report.passRate, 1);
});

test('the dataset actually exercises every failure class we claim to defend against', () => {
  for (const cat of ['schema', 'entity', 'authority', 'uncertainty', 'availability', 'recovery', 'injection']) {
    assert.ok(report.byCategory[cat]?.total > 0, `no eval coverage for category: ${cat}`);
  }
});

test('the dataset contains a passing baseline, so the suite cannot be satisfied by rejecting everything', () => {
  const baseline = report.results.filter((r) => r.expected === VERDICTS.ACCEPT);
  assert.ok(baseline.length >= 2);
  for (const b of baseline) assert.equal(b.actual, VERDICTS.ACCEPT);
});

test('every case states why it exists', () => {
  for (const c of EVAL_CASES) {
    assert.ok(c.why && c.why.length > 20, `case ${c.id} has no stated rationale`);
    assert.ok(c.id && c.title && c.category && c.seam);
  }
});

test('the report declares its own limitations', () => {
  assert.ok(report.limitations.length >= 3);
  assert.match(report.limitations.join(' '), /not.*live model|scripted/i);
});

test('classifyResult maps a clean run to ACCEPT', () => {
  assert.equal(classifyResult({ ok: true, usedFallback: false, record: {} }), VERDICTS.ACCEPT);
  assert.equal(
    classifyResult({ ok: true, usedFallback: true, record: { validationResult: 'PROVIDER_ERROR' } }),
    VERDICTS.FALLBACK,
  );
});
