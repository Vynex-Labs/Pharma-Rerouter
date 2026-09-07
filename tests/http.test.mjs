/**
 * P10 — HTTP layer tests.
 *
 * Why this file exists: at P8 the whole test suite was green while `/api/state` returned a 500,
 * because every test called the functions behind the server and nothing ever made a request
 * (defect D8-2, "a green suite did not prove the server serves"). Coverage confirmed the gap was
 * still open at P10 — `createApp` routing was 0% covered.
 *
 * These tests bind a real server to an ephemeral port and use real fetch. No route is mocked.
 *
 * Traces: REQ-093 (provenance on every derived payload), NFR-007 (typed errors, no stack traces).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildState, createApp } from '../src/api/server.mjs';

/** Boots a real listening server on an ephemeral port. */
async function withServer(fn, { state } = {}) {
  const s = state ?? await buildState();
  const server = createApp(s);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(base, s);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('GET /api/state returns 200 JSON with the decision the pipeline actually produced', async () => {
  await withServer(async (base, state) => {
    const res = await fetch(`${base}/api/state`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /application\/json/);
    assert.equal(res.headers.get('cache-control'), 'no-store');

    const body = await res.json();
    // The served payload must match the in-process state, not a re-derivation.
    assert.equal(body.decision.state, state.state);
    assert.equal(body.decision.id, state.decisionId);
    assert.ok(body.decision.policyVersion, 'policy version must be served');
  });
});

test('REQ-093: every response carrying derived figures carries provenance', async () => {
  await withServer(async (base) => {
    const body = await (await fetch(`${base}/api/state`)).json();
    assert.ok(body.dataClassification, 'data classification must be present');
    assert.ok(body.dataSource, 'data source must be present');
    assert.ok(body.sap && body.sap.mode, 'SAP mode must be declared');
    assert.ok(body.llm && body.llm.provider && body.llm.model, 'LLM provenance must be declared');
    // A derived figure without provenance is the failure mode this requirement exists to prevent.
    assert.ok(body.impact, 'impact figures are served');
    assert.equal(body.dataClassification, 'SYNTHETIC');
  });
});

test('GET /api/agents returns real invocations, guardrails and grants', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/agents`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.invocations));
    assert.ok(body.invocations.length > 0, 'the pipeline ran agents, so invocations must exist');
    assert.ok(Array.isArray(body.guardrails));
    assert.ok(body.grants, 'tool grants must be disclosed');
    for (const inv of body.invocations) {
      assert.ok(inv.agent_name, 'every invocation names its agent');
      // A fallback with no reason is defect D8-1; assert it cannot come back.
      if (inv.fallback_used) assert.ok(inv.fallback_reason, 'a fallback must state its reason');
    }
  });
});

test('GET /api/audit serves a verifiable chain export', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/audit`);
    assert.equal(res.status, 200);
    const body = await res.json();
    const events = body.events ?? body;
    assert.ok(Array.isArray(events) && events.length > 0);
    // REQ-084: the export must be self-contained — hashes travel with the records.
    assert.ok(events[0].chain_hash ?? events[0].chainHash, 'export carries chain hashes');
  });
});

test('the static host serves the SPA at / and at /index.html', async () => {
  await withServer(async (base) => {
    for (const path of ['/', '/index.html']) {
      const res = await fetch(`${base}${path}`);
      assert.equal(res.status, 200, `${path} must serve`);
      assert.match(res.headers.get('content-type'), /text\/html/);
      assert.match(await res.text(), /<div id="app"|<body/i);
    }
  });
});

test('static assets are served with correct MIME types', async () => {
  await withServer(async (base) => {
    const css = await fetch(`${base}/app.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type'), /text\/css/);

    const js = await fetch(`${base}/app.js`);
    assert.equal(js.status, 200);
    assert.match(js.headers.get('content-type'), /text\/javascript/);
  });
});

test('an unknown route returns a typed 404, not a crash', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/does-not-exist`);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'not found' });
  });
});

test('path traversal cannot escape the public directory', async () => {
  await withServer(async (base) => {
    // Encoded so the client does not normalise it away before it reaches the server.
    for (const attack of [
      '/%2e%2e/%2e%2e/package.json',
      '/..%2f..%2fpackage.json',
      '/%2e%2e%2f%2e%2e%2fsrc%2fdb%2fseed.mjs',
    ]) {
      const res = await fetch(`${base}${attack}`);
      assert.notEqual(res.status, 200, `${attack} must not serve a file outside PUBLIC`);
      const text = await res.text();
      assert.doesNotMatch(text, /"name":\s*"pharma-rerouter"/, 'package.json must never be served');
      assert.doesNotMatch(text, /IDENTITIES/, 'source must never be served');
    }
  });
});

test('NFR-007: an internal failure returns a typed error and never a stack trace', async () => {
  const state = await buildState();
  // Break the database so the /api/agents query throws inside the handler.
  state.db.close();

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/agents`);
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.error, 'internal_error');
    // The message may describe the fault, but must not carry a stack.
    assert.doesNotMatch(JSON.stringify(body), /\bat\s+\w+.*\.mjs:\d+/, 'no stack frames to the client');
  }, { state });
});

test('the server does not mutate state across requests — reads are idempotent', async () => {
  await withServer(async (base) => {
    const a = await (await fetch(`${base}/api/state`)).json();
    const b = await (await fetch(`${base}/api/state`)).json();
    // generatedAt is a timestamp; everything else must be byte-identical.
    delete a.generatedAt; delete b.generatedAt;
    assert.deepEqual(a, b, 'a GET must not change what the next GET returns');

    const auditA = await (await fetch(`${base}/api/audit`)).json();
    const auditB = await (await fetch(`${base}/api/audit`)).json();
    const len = (x) => (x.events ?? x).length;
    assert.equal(len(auditA), len(auditB), 'reading state must not append audit events');
  });
});
