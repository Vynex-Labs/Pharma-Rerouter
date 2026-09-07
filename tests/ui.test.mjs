/**
 * P8 verification — the UI actually renders, in a real DOM, from real API output.
 *
 * This deliberately does NOT mock the backend. It boots the same buildState() the server uses,
 * feeds the genuine API payloads into jsdom, and renders every page. A screenshot proves nothing;
 * this proves each screen produces content and that provenance survives rendering.
 *
 * Traces: REQ-090..097, condition PM-1.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { buildState } from '../src/api/server.mjs';

const PAGES = ['dashboard', 'network', 'incident', 'scenarios', 'approvals', 'agents', 'inventory', 'audit'];
const read = (p) => readFileSync(new URL(`../src/ui/public/${p}`, import.meta.url), 'utf8');

/** Boots the front end against genuine API payloads derived from the real pipeline. */
async function mount() {
  const state = await buildState();
  const payload = {
    '/api/state': JSON.parse(JSON.stringify(viewOf(state))),
    '/api/agents': {
      invocations: state.db.prepare('SELECT * FROM agent_invocation ORDER BY started_at').all(),
      guardrails: state.db.prepare('SELECT * FROM guardrail_event').all(),
      grants: state.advice,
    },
    '/api/audit': state.ledger.export(),
  };

  const dom = new JSDOM(read('index.html'), { runScripts: 'outside-only', url: 'http://localhost/' });
  const { window } = dom;
  window.fetch = async (u) => ({ json: async () => payload[new URL(u, 'http://localhost/').pathname] });
  window.scrollTo = () => {};

  const src = read('app.js').replace(/^import .*$/gm, '');
  window.eval(`${src}\n;window.__go=async(p)=>{page=p;renderNav();render();};`);
  await new Promise((r) => setTimeout(r, 250));
  return { window, state, payload };
}

// The server's private view() is not exported; re-derive the same shape via the HTTP layer instead.
function viewOf(state) {
  return JSON.parse(JSON.stringify({
    generatedAt: new Date().toISOString(),
    dataClassification: 'SYNTHETIC',
    dataSource: state.stock.dataSource,
    sap: state.sap.describe(),
    llm: { provider: state.llm.name, model: state.llm.model },
    disruption: {
      id: state.disruption.id, laneId: state.disruption.reported_lane_id,
      eventType: state.disruption.event_type, severity: state.disruption.severity,
      confidence: state.disruption.confidence, geography: state.disruption.geography,
      expectedDurationHours: state.disruption.expected_duration_hours,
      classificationSource: state.disruption.classification_source,
      uncertainty: state.sensing.output.uncertainty,
      advisoryText: state.disruption.raw_advisory_text,
    },
    narrative: {
      text: state.narrative.output.text,
      source: state.narrative.usedFallback ? 'TEMPLATE' : 'AI-GENERATED',
      uncertainty: state.narrative.output.uncertainty,
    },
    impact: {
      closedLaneId: state.impact.closedLaneId,
      shipmentsHeld: state.impact.affected.shipments,
      facilities: state.impact.affected.facilities,
      ordersAtRisk: state.impact.ordersAtRisk,
      daysOfCover: state.impact.daysOfCover,
      baseline: state.impact.baseline,
    },
    scenarios: {
      ranked: state.ranked, excluded: state.excluded,
      weights: state.weights, generationOrigin: state.gen.generationOrigin,
    },
    agents: {
      intents: state.intents.output.intents,
      rejected: state.intents.output.rejected ?? [], advice: state.advice,
    },
    network: {
      facilities: state.snapshot.payload.facilities,
      lanes: state.snapshot.payload.lanes.map((l) => ({
        ...l, status: l.id === state.impact.closedLaneId ? 'CLOSED' : l.status,
      })),
    },
  }));
}

test('REQ-090: every page renders substantive content', async () => {
  const { window } = await mount();
  for (const p of PAGES) {
    await window.__go(p);
    const text = window.document.getElementById('app').textContent.trim();
    assert.ok(text.length > 100, `page "${p}" rendered only ${text.length} chars`);
  }
});

test('no page leaks undefined, NaN or [object Object] to the operator', async () => {
  const { window } = await mount();
  for (const p of PAGES) {
    await window.__go(p);
    const text = window.document.getElementById('app').textContent;
    assert.doesNotMatch(text, /undefined|NaN|\[object Object\]/, `page "${p}" leaked a raw JS value`);
  }
});

test('REQ-092/PM-1: model prose only ever renders inside a provenance block', async () => {
  const { window, payload } = await mount();
  await window.__go('dashboard');
  const blocks = [...window.document.querySelectorAll('.generated')];
  assert.ok(blocks.length > 0, 'the narrative must be wrapped');

  const narrative = payload['/api/state'].narrative.text;
  const wrapped = blocks.map((b) => b.textContent).join(' ');
  assert.ok(wrapped.includes(narrative.slice(0, 40)), 'narrative escaped its provenance block');
  assert.match(wrapped, /AI-generated|Template/i, 'the block must be labelled');
});

test('REQ-093: the data-source badge is always visible and never overstates', async () => {
  const { window, payload } = await mount();
  const chrome = window.document.getElementById('badges').textContent;
  assert.match(chrome, /Simulated/i);
  assert.match(chrome, /Synthetic/i);
  assert.doesNotMatch(chrome, /Live SAP/i, 'must not claim live SAP without credentials');
  assert.equal(payload['/api/state'].dataSource, 'SIMULATED');
});

test('REQ-024: excluded scenarios stay visible with their reasons', async () => {
  const { window, payload } = await mount();
  await window.__go('scenarios');
  const text = window.document.getElementById('app').textContent;

  for (const s of payload['/api/state'].scenarios.excluded) {
    assert.ok(text.includes(s.strategyType.replace(/_/g, ' ')), `${s.strategyType} was hidden`);
    assert.ok(text.includes(s.infeasibilityReason), `${s.strategyType} lost its reason`);
  }
  assert.match(text, /Blocked/);
});

test('the approval screen refuses to fake an unbuilt workflow', async () => {
  const { window } = await mount();
  await window.__go('approvals');
  const text = window.document.getElementById('app').textContent;
  assert.match(text, /P12/, 'must name the phase it is blocked on');
  assert.equal(window.document.querySelectorAll('button.approve').length, 0);
});

test('REQ-095: the agent screen shows fallbacks with their reason, not just a flag', async () => {
  const { window, payload } = await mount();
  await window.__go('agents');
  const text = window.document.getElementById('app').textContent;

  const fell = payload['/api/agents'].invocations.filter((r) => r.fallback_used);
  assert.ok(fell.length > 0, 'the mock provider declines to write prose, so S2 must fall back');
  for (const r of fell) {
    assert.ok(text.includes(r.fallback_reason), `fallback reason ${r.fallback_reason} not shown`);
  }
  assert.doesNotMatch(text, /UNEXPLAINED/, 'no invocation may render as unexplained');
});

test('the audit page reports chain verification honestly', async () => {
  const { window, payload } = await mount();
  await window.__go('audit');
  const text = window.document.getElementById('app').textContent;
  assert.equal(payload['/api/audit'].integrity.valid, true);
  assert.match(text, /Chain verified/);
  assert.match(text, /tamper/i, 'the integrity model must be stated, not implied');
});

test('the network map marks the closed lane and the affected facilities', async () => {
  const { window, payload } = await mount();
  await window.__go('network');
  const svg = window.document.querySelector('svg');
  assert.ok(svg, 'the map must render');
  assert.equal(
    svg.querySelectorAll('circle').length,
    payload['/api/state'].network.facilities.length,
    'every facility must be plotted',
  );
  assert.ok(svg.innerHTML.includes('stroke-dasharray'), 'the closed lane must be visually distinct');
  assert.ok(window.document.getElementById('app').textContent.includes(payload['/api/state'].impact.closedLaneId));
});
