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
import { buildState, view } from '../src/api/server.mjs';

const PAGES = ['dashboard', 'network', 'incident', 'scenarios', 'approvals', 'agents', 'inventory', 'audit'];
const read = (p) => readFileSync(new URL(`../src/ui/public/${p}`, import.meta.url), 'utf8');

/** Boots the front end against genuine API payloads derived from the real pipeline. */
async function mount() {
  const state = await buildState();
  const payload = {
    '/api/state': JSON.parse(JSON.stringify(view(state))),
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
  const { window, payload } = await mount();
  await window.__go('approvals');
  const app = window.document.getElementById('app');
  const text = app.textContent;

  assert.equal(payload['/api/state'].decision.state, 'PENDING_APPROVAL');
  assert.match(text, /P12/, 'must name the phase it is blocked on');
  assert.match(text, /nothing has executed/i, 'must state that no execution occurred');

  // No control that could be mistaken for a working approval.
  const buttons = [...app.querySelectorAll('button')].map((b) => b.textContent.toLowerCase());
  assert.ok(!buttons.some((t) => /approve|reject|authorise|authorize/.test(t)),
    'no approve/reject control may exist before P12 implements approval capture');
});

test('P9: the approval screen renders the real state machine and the pending decision', async () => {
  const { window, payload } = await mount();
  await window.__go('approvals');
  const text = window.document.getElementById('app').textContent;
  const d = payload['/api/state'].decision;

  assert.match(text, new RegExp(d.id), 'the decision id must be shown');
  for (const step of ['DETECTED', 'RANKED', 'POLICY EVALUATED', 'PENDING APPROVAL', 'SEALED']) {
    assert.ok(text.includes(step), `the timeline must show ${step}`);
  }
  for (const role of d.policy.requiredRoles) {
    assert.ok(text.includes(role), `required approver role ${role} must be visible`);
  }
  assert.ok(d.actions.length > 0, 'the bounded action list must be populated');
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

test('the view reports the policy engine\'s own version, never a hardcoded string', async () => {
  const { POLICY_VERSION } = await import('../src/core/policy.mjs');
  const state = await buildState();
  const v = view(state);
  assert.equal(v.decision.policyVersion, POLICY_VERSION);

  // Guard the actual defect: a literal version baked into the view layer.
  const src = readFileSync(new URL('../src/api/server.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /policyVersion:\s*['"`]/, 'policy version must be read, not hardcoded');
});
