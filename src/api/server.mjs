/**
 * Control-tower API + static host.
 *
 * Zero-dependency Node http server (ADR-0005 chose Express, but the endpoint surface here is small
 * enough that adding a framework would be unjustified weight for the demo; the routing table below
 * is the whole API). Recorded as a deviation in docs/P8-ui.md.
 *
 * Every response that carries derived figures also carries provenance (REQ-093).
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openDatabase, resetData, DEFAULT_DB_PATH } from '../db/index.mjs';
import { seedDatabase, SEED_EPOCH } from '../db/seed.mjs';
import { AuditLedger } from '../core/audit.mjs';
import { runPipeline } from '../core/pipeline.mjs';
import { providerFromEnv } from '../agents/provider.mjs';
import { adapterFromEnv } from '../sap/adapter.mjs';
import { makeSimulator } from '../sap/fixtures.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, '..', 'ui', 'public');
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' };

/**
 * Boots the application state by running the REAL pipeline (P9).
 *
 * This previously re-implemented the flow inline, which meant the UI could drift away from the
 * tested pipeline. There is now exactly one orchestration path, and the screens render its output.
 */
export async function buildState({ dbPath = ':memory:', provider, approval = null } = {}) {
  const db = openDatabase(dbPath);
  if (dbPath !== ':memory:') resetData(db);
  seedDatabase(db);

  const ledger = new AuditLedger(db);
  const llm = provider ?? providerFromEnv();
  const sap = adapterFromEnv(process.env, { simulate: makeSimulator(db) });

  const result = await runPipeline({
    db, ledger, provider: llm, disruptionId: 'DSR-0001', asOf: SEED_EPOCH, approval,
  });

  const stock = await sap.readMaterialStock({
    material: '000000000000100001', plant: 'WH-CENTRAL',
  });

  return {
    db, ledger, sap, llm, stock,
    ...result,
    disruption: result.disruption,
    sensing: result.agents.sensing,
    narrative: result.agents.narrative,
    intents: result.agents.intents,
    advice: result.agents.advice,
    explanation: result.agents.explanation,
  };
}

export function view(state) {
  const { impact, ranked, excluded, weights, snapshot } = state;
  return {
    generatedAt: new Date().toISOString(),
    decision: {
      id: state.decisionId,
      state: state.state,
      trace: state.trace,
      policy: state.policy,
      policyVersion: state.policy ? (state.policyVersion ?? state.policy.policyVersion ?? null) : null,
      actions: state.actions,
      executed: state.executed
        ? { outcome: state.executed.outcome, at: state.executed.executed_at,
            changes: JSON.parse(state.executed.changes_json) }
        : null,
      recovery: state.recovery
        ? { objectiveMet: state.recovery.objective_met === 1,
            checks: JSON.parse(state.recovery.notes),
            before: JSON.parse(state.recovery.before_json),
            after: JSON.parse(state.recovery.after_json) }
        : null,
      explanation: state.explanation
        ? { text: state.explanation.output.text,
            source: state.explanation.usedFallback ? 'TEMPLATE' : 'AI-GENERATED',
            uncertainty: state.explanation.output.uncertainty }
        : null,
    },
    dataClassification: 'SYNTHETIC',
    dataSource: state.stock.dataSource,
    sap: state.sap.describe(),
    llm: { provider: state.llm.name, model: state.llm.model },
    disruption: {
      id: state.disruption.id,
      laneId: state.disruption.reported_lane_id,
      eventType: state.disruption.event_type,
      severity: state.disruption.severity,
      confidence: state.disruption.confidence,
      geography: state.disruption.geography,
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
      closedLaneId: impact.closedLaneId,
      shipmentsHeld: impact.affected.shipments,
      facilities: impact.affected.facilities,
      ordersAtRisk: impact.ordersAtRisk,
      daysOfCover: impact.daysOfCover,
      baseline: impact.baseline,
    },
    scenarios: { ranked, excluded, weights, generationOrigin: state.gen.generationOrigin },
    agents: {
      intents: state.intents.output.intents,
      rejected: state.intents.output.rejected ?? [],
      advice: state.advice,
    },
    network: {
      facilities: snapshot.payload.facilities,
      lanes: snapshot.payload.lanes.map((l) => ({
        ...l, status: l.id === impact.closedLaneId ? 'CLOSED' : l.status,
      })),
    },
  };
}

export function createApp(state) {
  return createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const send = (code, body, type = 'application/json') => {
      res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(type === 'application/json' ? JSON.stringify(body) : body);
    };

    try {
      if (url.pathname === '/api/state') return send(200, view(state));

      if (url.pathname === '/api/agents') {
        const rows = state.db.prepare('SELECT * FROM agent_invocation ORDER BY started_at ASC').all();
        const guards = state.db.prepare('SELECT * FROM guardrail_event ORDER BY occurred_at ASC').all();
        return send(200, { invocations: rows, guardrails: guards, grants: state.advice });
      }

      if (url.pathname === '/api/audit') {
        return send(200, state.ledger.export());
      }

      // static
      let p = url.pathname === '/' ? '/index.html' : url.pathname;
      const file = join(PUBLIC, p);
      if (file.startsWith(PUBLIC) && existsSync(file)) {
        return send(200, readFileSync(file, 'utf8'), MIME[extname(file)] ?? 'text/plain');
      }
      return send(404, { error: 'not found' });
    } catch (err) {
      // NFR-007: typed error, never a stack trace to the client
      return send(500, { error: 'internal_error', message: err.message });
    }
  });
}

export async function start({ port = Number(process.env.PORT ?? 3000) } = {}) {
  const state = await buildState({ dbPath: DEFAULT_DB_PATH });
  const server = createApp(state);
  server.listen(port, '0.0.0.0', () => {
    console.log(`Control tower on http://0.0.0.0:${port}`);
    console.log(`  data classification : SYNTHETIC`);
    console.log(`  SAP mode            : ${state.sap.mode}`);
    console.log(`  LLM provider        : ${state.llm.name} (${state.llm.model})`);
  });
  return { server, state };
}
