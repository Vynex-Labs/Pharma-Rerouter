/**
 * P8 verification — design-system compliance.
 * Traces: REQ-091 (DESIGN.md authority), REQ-092 (PM-1), REQ-093, REQ-097 (accessibility).
 * Closes P0 findings R0-2 and R0-3.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BASE, STATUS, PROVENANCE, RADIUS, SPACING, statusOf, contrastRatio } from '../src/ui/tokens.mjs';

const DESIGN = readFileSync(new URL('../DESIGN.md', import.meta.url), 'utf8');

test('REQ-091: every BASE token matches DESIGN.md verbatim', () => {
  for (const [name, value] of Object.entries(BASE)) {
    assert.ok(
      DESIGN.includes(`${name}: "${value}"`),
      `token ${name}=${value} does not appear in DESIGN.md — the authority must not be overridden`,
    );
  }
});

test('REQ-091: the extension is additive — no DESIGN.md value is redefined', () => {
  const baseValues = new Set(Object.values(BASE));
  for (const [name, value] of Object.entries(STATUS)) {
    if (baseValues.has(value)) {
      // Reuse is fine (healthy === semantic-success, neutral === ink-subtle); redefinition is not.
      assert.ok(
        ['healthy', 'neutral'].includes(name),
        `${name} reuses a DESIGN.md value but is not a documented reuse`,
      );
    }
  }
  assert.equal(STATUS.healthy, BASE['semantic-success'], 'healthy must reuse semantic-success');
});

test('the extension does not repurpose brand lavender as a status colour', () => {
  const lavenders = [BASE.primary, BASE['primary-hover'], BASE['primary-focus']];
  for (const [name, value] of Object.entries(STATUS)) {
    assert.ok(!lavenders.includes(value), `${name} must not use the scarce brand accent`);
  }
});

test('DESIGN.md prohibitions are respected: no true black, no pill CTAs', () => {
  assert.notEqual(BASE.canvas, '#000000', 'DESIGN.md forbids true black as the canvas');
  assert.equal(RADIUS.md, 8, 'buttons are 8px — DESIGN.md explicitly forbids pill-rounded CTAs');
  assert.equal(RADIUS.lg, 12);
});

test('spacing and radius scales match DESIGN.md', () => {
  assert.deepEqual(Object.values(SPACING), [4, 8, 12, 16, 24, 32, 48, 96]);
  assert.equal(RADIUS.xl, 16);
  assert.equal(RADIUS.pill, 9999);
});

test('REQ-097: status colours meet WCAG AA (4.5:1) against the canvas', () => {
  for (const key of ['critical', 'warning', 'healthy', 'info', 'neutral']) {
    const ratio = contrastRatio(STATUS[key], BASE.canvas);
    assert.ok(ratio >= 4.5, `${key} contrast ${ratio.toFixed(2)}:1 is below AA`);
  }
});

test('REQ-097: primary ink and muted ink meet AA on canvas and surface-1', () => {
  assert.ok(contrastRatio(BASE.ink, BASE.canvas) >= 4.5);
  assert.ok(contrastRatio(BASE.ink, BASE['surface-1']) >= 4.5);
  assert.ok(contrastRatio(BASE['ink-muted'], BASE['surface-1']) >= 4.5);
});

test('REQ-092/PM-1: generated text is visually recessive versus computed text', () => {
  assert.equal(PROVENANCE['computed-ink'], BASE.ink);
  assert.equal(PROVENANCE['generated-ink'], BASE['ink-muted']);
  assert.ok(
    contrastRatio(PROVENANCE['computed-ink'], BASE['surface-1']) >
    contrastRatio(PROVENANCE['generated-ink'], BASE['surface-1']),
    'computed values must read as more prominent than model prose',
  );
  // ...but generated text must still be legible, not decorative grey.
  assert.ok(contrastRatio(PROVENANCE['generated-ink'], BASE['surface-1']) >= 4.5);
});

test('never colour alone: every status mapping carries a text label', () => {
  const cases = [
    ['cover', 'CRITICAL'], ['cover', 'HEALTHY'],
    ['feasibility', 'BLOCKED'], ['feasibility', 'INFEASIBLE'], ['feasibility', 'FEASIBLE'],
    ['dataSource', 'SIMULATED'], ['dataSource', 'LIVE_SAP'],
    ['severity', 'CRITICAL'],
  ];
  for (const [kind, value] of cases) {
    const s = statusOf(kind, value);
    assert.ok(s.label && s.label.length > 0, `${kind}/${value} must have a text label (WCAG 1.4.1)`);
    assert.ok(s.colour.startsWith('#'));
  }
});

test('REQ-093: a simulated data source renders as a warning, never as success', () => {
  assert.equal(statusOf('dataSource', 'SIMULATED').token, 'warning');
  assert.equal(statusOf('dataSource', 'LIVE_SAP').token, 'healthy');
  assert.notEqual(statusOf('dataSource', 'SIMULATED').colour, STATUS.healthy);
});

test('an unknown value degrades to neutral with a readable label rather than throwing', () => {
  const s = statusOf('cover', 'NONSENSE');
  assert.equal(s.token, 'neutral');
  assert.equal(s.label, 'NONSENSE');
});
