/**
 * Control Tower front end.
 * Authority: DESIGN.md + docs/design-extension.md.
 *
 * Two rules are enforced in the render layer, not left to discipline:
 *   REQ-092 — model prose renders through `generated()`, computed figures through `.computed`.
 *   REQ-093 — the data-source and classification badges are drawn on every page.
 */

const PAGES = [
  ['dashboard', 'Dashboard'], ['network', 'Network'], ['incident', 'Incident'],
  ['scenarios', 'Scenarios'], ['approvals', 'Approvals'], ['agents', 'Agent Activity'],
  ['inventory', 'Inventory'], ['audit', 'Audit'],
];

let S = null, AGENTS = null, AUDIT = null, page = 'dashboard';

const $ = (h) => { const t = document.createElement('template'); t.innerHTML = h.trim(); return t.content; };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (m) => (m / 100).toLocaleString('en-GB', { maximumFractionDigits: 0 });

const STATUS_MAP = {
  CRITICAL: 'critical', WARNING: 'warning', WATCH: 'info', HEALTHY: 'healthy',
  FEASIBLE: 'healthy', INFEASIBLE: 'warning', BLOCKED: 'critical',
  LIVE_SAP: 'healthy', SAP_SANDBOX: 'info', SIMULATED: 'warning',
  HIGH: 'warning', MEDIUM: 'warning', LOW: 'info',
};
const LABELS = {
  LIVE_SAP: 'Live SAP', SAP_SANDBOX: 'SAP Sandbox', SIMULATED: 'Simulated data',
  FEASIBLE: 'Feasible', INFEASIBLE: 'Infeasible', BLOCKED: 'Blocked',
};
const pill = (v, label) =>
  `<span class="pill ${STATUS_MAP[v] ?? 'neutral'}">${esc(label ?? LABELS[v] ?? v)}</span>`;

/** REQ-092 / condition PM-1 — the ONLY way model prose reaches the DOM. */
const generated = (text, source, uncertainty) => `
  <div class="generated">
    <span class="tag">${source === 'TEMPLATE' ? 'Template · deterministic' : 'AI-generated'}</span>
    <div>${esc(text)}</div>
    ${uncertainty ? `<div class="mono-sm" style="margin-top:8px">Uncertainty: ${esc(uncertainty)}</div>` : ''}
  </div>`;

async function boot() {
  S = await (await fetch('/api/state')).json();
  AGENTS = await (await fetch('/api/agents')).json();
  AUDIT = await (await fetch('/api/audit')).json();
  renderNav(); render();
}

function renderNav() {
  const nav = document.getElementById('nav');
  nav.innerHTML = '';
  for (const [id, label] of PAGES) {
    const b = document.createElement('button');
    b.textContent = label;
    if (id === page) b.setAttribute('aria-current', 'page');
    b.onclick = () => { page = id; renderNav(); render(); };
    nav.appendChild(b);
  }
  document.getElementById('badges').innerHTML =
    pill(S.dataSource, LABELS[S.dataSource]) + ' ' + pill('WATCH', 'Synthetic data');
}

function render() {
  const el = document.getElementById('app');
  el.innerHTML = '';
  el.appendChild($(({
    dashboard, network, incident, scenarios, approvals, agents, inventory, audit,
  })[page]()));
  window.scrollTo(0, 0);
}

// ------------------------------------------------------------------ dashboard
function dashboard() {
  const i = S.impact, top = S.scenarios.ranked[0];
  const critical = i.daysOfCover.filter((c) => c.status === 'CRITICAL' || c.status === 'WARNING');
  return `
  <div class="page-head">
    <h1>Resilience Control Tower</h1>
    <p class="sub">Disruption ${esc(S.disruption.id)} · lane ${esc(S.disruption.laneId)} ·
       all figures computed deterministically from ${esc(S.dataSource)} data.</p>
  </div>

  <div class="grid g4">
    ${metric('Orders at risk', i.ordersAtRisk.length, 'if no action is taken')}
    ${metric('Shipments held', i.shipmentsHeld.length, `on ${esc(i.closedLaneId)}`)}
    ${metric('Earliest stockout', i.baseline.earliestStockoutDate ?? '—', 'projected, do-nothing')}
    ${metric('Sites below threshold', critical.length, 'of ' + i.daysOfCover.length + ' tracked')}
  </div>

  <h2>What the system understood</h2>
  <div class="card">
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      ${pill(S.disruption.severity, 'Severity ' + esc(S.disruption.severity))}
      <span class="pill neutral">${esc(S.disruption.eventType)}</span>
      <span class="pill neutral">Confidence ${(S.disruption.confidence * 100).toFixed(0)}%</span>
      <span class="pill neutral">${esc(S.disruption.classificationSource)}</span>
    </div>
    ${generated(S.narrative.text, S.narrative.source, S.narrative.uncertainty)}
  </div>

  <h2>Recommended action</h2>
  ${top ? scenarioCard(top, true) : '<div class="empty">No feasible option — escalate.</div>'}

  <h2>Operator flags <span class="pill neutral">advisory only</span></h2>
  <div class="card">
    ${S.agents.advice.flags.map((f) => `
      <div style="margin-bottom:12px">
        <span class="pill ${f.kind === 'CRITICAL_COVER' ? 'critical' : 'info'}">${esc(f.kind)}</span>
        <span style="margin-left:8px;color:var(--ink-muted)">${esc(f.note)}</span>
      </div>`).join('')}
    <div class="mono-sm">The orchestrator cannot transition state (REQ-066); these are observations for a human.</div>
  </div>`;
}

const metric = (label, value, foot) => `
  <div class="metric"><div class="label">${esc(label)}</div>
  <div class="value">${esc(value)}</div><div class="foot">${esc(foot)}</div></div>`;

// ------------------------------------------------------------------ network
function network() {
  const F = S.network.facilities, L = S.network.lanes;
  const xs = F.map((f) => f.lon), ys = F.map((f) => f.lat);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const px = (f) => 60 + ((f.lon - x0) / (x1 - x0 || 1)) * 880;
  const py = (f) => 360 - ((f.lat - y0) / (y1 - y0 || 1)) * 300;
  const idx = Object.fromEntries(F.map((f) => [f.id, f]));

  const edges = L.map((l) => {
    const a = idx[l.from_facility_id], b = idx[l.to_facility_id];
    if (!a || !b) return '';
    const closed = l.status === 'CLOSED';
    return `<line x1="${px(a)}" y1="${py(a)}" x2="${px(b)}" y2="${py(b)}"
      stroke="${closed ? 'var(--critical)' : 'var(--hairline-strong)'}"
      stroke-width="${closed ? 2.5 : 1}" ${closed ? 'stroke-dasharray="6 4"' : ''} />`;
  }).join('');

  const nodes = F.map((f) => {
    const tint = { SUPPLIER: 'var(--info)', MANUFACTURER: 'var(--info)', DC: 'var(--primary)',
                   WAREHOUSE: 'var(--ink-muted)', HOSPITAL: 'var(--healthy)' }[f.type];
    const hit = S.impact.facilities.includes(f.id);
    return `<g><circle cx="${px(f)}" cy="${py(f)}" r="${hit ? 7 : 5}"
      fill="${tint}" ${hit ? 'stroke="var(--critical)" stroke-width="2"' : ''} />
      <text class="node-label" x="${px(f) + 10}" y="${py(f) + 4}">${esc(f.id)}</text></g>`;
  }).join('');

  return `
  <div class="page-head"><h1>Network</h1>
    <p class="sub">${F.length} facilities · ${L.length} lanes · red ring = downstream of the disruption</p></div>
  <div class="map"><svg viewBox="0 0 1000 420">${edges}${nodes}</svg></div>
  <div class="card" style="margin-top:16px">
    <strong>${esc(S.impact.closedLaneId)}</strong> is CLOSED.
    Downstream affected: ${S.impact.facilities.map((f) => `<span class="tool">${esc(f)}</span>`).join('')}
  </div>`;
}

// ------------------------------------------------------------------ incident
function incident() {
  return `
  <div class="page-head"><h1>Incident Center</h1>
    <p class="sub">Signal → classification → deterministic impact</p></div>

  <div class="advisory">
    <span class="tag">Untrusted external content · treated as data, never as instruction</span>
    ${esc(S.disruption.advisoryText)}
  </div>

  <h2>Agent classification (seam S1)</h2>
  <div class="card">
    <table><tbody>
      ${row('Event type', S.disruption.eventType)}
      ${row('Severity', S.disruption.severity)}
      ${row('Confidence', (S.disruption.confidence * 100).toFixed(0) + '%')}
      ${row('Geography', S.disruption.geography)}
      ${row('Expected duration', (S.disruption.expectedDurationHours ?? '—') + ' h')}
      ${row('Source', S.disruption.classificationSource)}
    </tbody></table>
    <div class="generated" style="margin-top:16px">
      <span class="tag">Declared uncertainty (condition AI-1)</span>
      <div>${esc(S.disruption.uncertainty)}</div>
    </div>
  </div>

  <h2>Orders at risk <span class="pill neutral">computed</span></h2>
  <div class="card"><table>
    <thead><tr><th>Order</th><th>Product</th><th>Destination</th><th>Need by</th>
      <th>Cover</th><th>Shortfall</th></tr></thead>
    <tbody>${S.impact.ordersAtRisk.map((o) => `<tr>
      <td class="num">${esc(o.orderId)}</td><td>${esc(o.productId)}</td>
      <td>${esc(o.destinationFacilityId)}</td><td class="num">${esc(o.needByDate)}</td>
      <td class="num">${o.coverDays} d</td>
      <td class="num" style="color:var(--critical)">−${o.shortfallDays} d</td></tr>`).join('')}
    </tbody></table></div>`;
}
const row = (k, v) => `<tr><td style="color:var(--ink-subtle);width:200px">${esc(k)}</td>
  <td class="num">${esc(v)}</td></tr>`;

// ------------------------------------------------------------------ scenarios
function scenarios() {
  const { ranked, excluded, weights, generationOrigin } = S.scenarios;
  return `
  <div class="page-head"><h1>Scenario Comparison</h1>
    <p class="sub">Generation origin: <strong>${esc(generationOrigin)}</strong> ·
    weights — orders ${weights.ordersProtected} / speed ${weights.speed} /
    risk ${weights.risk} / cost ${weights.cost}</p></div>

  ${ranked.map((s, i) => scenarioCard(s, i === 0)).join('')}

  <h2>Excluded options <span class="pill neutral">retained with reasons</span></h2>
  <p class="sub" style="margin-bottom:12px">Infeasible and blocked options are never silently
     dropped (REQ-024) and can never outrank a feasible option at any cost.</p>
  ${excluded.map((s) => scenarioCard(s, false)).join('')}`;
}

function scenarioCard(s, top) {
  const ex = s.feasibility !== 'FEASIBLE';
  const b = s.scoreBreakdown;
  return `
  <div class="scenario ${top ? 'top' : ''} ${ex ? 'excluded' : ''}">
    <div class="scenario-head">
      ${s.rank ? `<span class="rank">#${s.rank}</span>` : ''}
      <span class="scenario-name">${esc(s.strategyType.replace(/_/g, ' '))}</span>
      ${pill(s.feasibility)}
      ${s.origin === 'AGENT_INTENT' ? '<span class="pill info">Agent-proposed</span>' : ''}
      ${s.score != null ? `<span class="score">${s.score}</span>` : ''}
    </div>
    <div class="figs">
      ${fig('Orders protected', s.ordersProtected)}
      ${fig('ETA', s.etaHours + ' h')}
      ${fig('Cost delta', money(s.costDeltaMinor))}
      ${fig('Risk', s.riskScore + '/100')}
    </div>
    ${b ? `<div class="bar">
      <span style="width:${b.ordersProtected}%;background:var(--healthy)"></span>
      <span style="width:${b.speed}%;background:var(--info)"></span>
      <span style="width:${b.risk}%;background:var(--warning)"></span>
      <span style="width:${b.cost}%;background:var(--primary)"></span></div>` : ''}
    ${s.infeasibilityReason ? `<div class="reason ${s.feasibility.toLowerCase()}">
      ${esc(s.infeasibilityReason)}</div>` : ''}
  </div>`;
}
const fig = (k, v) => `<div class="fig"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`;

// ------------------------------------------------------------------ approvals
function approvals() {
  return `
  <div class="page-head"><h1>Approval Center</h1>
    <p class="sub">Policy engine and approval workflow are implemented in P12.</p></div>
  <div class="card">
    <p style="margin-top:0">This screen is intentionally not simulated. The governance model
    (ADR-0003) specifies a full evidence contract, multi-role routing and stale-approval
    invalidation. Showing a fake "Approve" button before that exists would misrepresent the
    system's maturity.</p>
    <p class="mono-sm">Blocked on: P12 — Security &amp; Governance.</p>
  </div>`;
}

// ------------------------------------------------------------------ agents
function agents() {
  return `
  <div class="page-head"><h1>Agent Activity</h1>
    <p class="sub">Real invocations — including rejected outputs and fallbacks (REQ-095)</p></div>

  <div class="card"><table>
    <thead><tr><th>Seam</th><th>Agent</th><th>Provider</th><th>Validation</th>
      <th>Conf.</th><th>Fallback</th><th>ms</th></tr></thead>
    <tbody>${AGENTS.invocations.map((r) => `<tr>
      <td class="num seam">${esc(r.seam)}</td><td>${esc(r.agent_name)}</td>
      <td class="num">${esc(r.provider)}</td>
      <td>${pill(r.validation_result === 'VALID' ? 'HEALTHY' : 'CRITICAL', r.validation_result)}</td>
      <td class="num">${r.confidence ?? '—'}</td>
      <td>${r.fallback_used
        ? pill('WARNING', esc(r.fallback_reason ?? 'UNEXPLAINED'))
        : '<span class="pill neutral">No</span>'}</td>
      <td class="num">${r.latency_ms}</td></tr>`).join('')}
    </tbody></table></div>

  <h2>Strategy intents (seam S3)</h2>
  <div class="card">
    <p class="sub" style="margin-top:0">These intents selected which strategies the engine
       generated — the agent changed the candidate set, it did not comment on a fixed list.</p>
    ${S.agents.intents.map((i) => `<div style="margin-bottom:8px">
      <span class="tool">${esc(i.strategy)}</span>
      <span style="color:var(--ink-muted)">${esc(i.rationale ?? '')}</span></div>`).join('')}
  </div>

  <h2>Guardrail events</h2>
  <div class="card">${AGENTS.guardrails.length
    ? AGENTS.guardrails.map((g) => `<div>${pill('CRITICAL', g.kind)}
        <span class="mono-sm">${esc(g.detail_json)}</span></div>`).join('')
    : '<div class="empty">No guardrail violations in this run.</div>'}</div>`;
}

// ------------------------------------------------------------------ inventory
function inventory() {
  return `
  <div class="page-head"><h1>Inventory</h1>
    <p class="sub">Days of cover after shelf-life netting — expiring stock is not cover</p></div>
  <div class="card"><table>
    <thead><tr><th>Site</th><th>Product</th><th>Raw</th><th>Usable</th><th>Write-off</th>
      <th>Demand/day</th><th>Cover</th><th>Stockout</th><th>Status</th></tr></thead>
    <tbody>${S.impact.daysOfCover.map((c) => `<tr>
      <td>${esc(c.facilityId)}</td><td>${esc(c.productId)}</td>
      <td class="num">${c.rawTotalUnits.toLocaleString()}</td>
      <td class="num">${c.usableUnits.toLocaleString()}</td>
      <td class="num" style="color:${c.unusableUnits ? 'var(--warning)' : 'var(--ink-tertiary)'}">
        ${c.unusableUnits.toLocaleString()}</td>
      <td class="num">${c.dailyDemandUnits.toLocaleString()}</td>
      <td class="num">${c.daysOfCover} d</td>
      <td class="num">${esc(c.stockoutDate ?? '—')}</td>
      <td>${pill(c.status)}</td></tr>`).join('')}
    </tbody></table></div>
  <div class="card" style="margin-top:16px">
    <span class="pill warning">Shelf-life netting</span>
    <span style="margin-left:8px;color:var(--ink-muted)">Stock that cannot be consumed before its
    expiry date is excluded from cover. Raw quantity alone would overstate readiness.</span>
  </div>`;
}

// ------------------------------------------------------------------ audit
function audit() {
  const v = AUDIT.integrity;
  return `
  <div class="page-head"><h1>Audit</h1>
    <p class="sub">${esc(AUDIT.integrityModel)}</p></div>

  <div class="card" style="margin-bottom:16px">
    ${v.valid ? pill('HEALTHY', `Chain verified · ${v.events} events`)
              : pill('CRITICAL', `Chain broken at #${v.brokenAtSeq} — ${v.reason}`)}
    ${v.tip ? `<div class="mono-sm" style="margin-top:8px">tip ${esc(v.tip)}</div>` : ''}
  </div>

  <div class="card"><table>
    <thead><tr><th>#</th><th>Event</th><th>Actor</th><th>At</th><th>Chain hash</th></tr></thead>
    <tbody>${AUDIT.events.map((e) => `<tr>
      <td class="num">${e.seq}</td><td>${esc(e.event_type)}</td>
      <td class="num">${esc(e.actor)}</td>
      <td class="num">${esc(e.occurred_at.slice(11, 19))}</td>
      <td class="mono-sm">${esc(e.chain_hash.slice(0, 16))}…</td></tr>`).join('')}
    </tbody></table></div>`;
}

boot().catch((e) => {
  document.getElementById('app').innerHTML =
    `<div class="card"><h1>Failed to load</h1><p class="mono-sm">${esc(e.message)}</p></div>`;
});
