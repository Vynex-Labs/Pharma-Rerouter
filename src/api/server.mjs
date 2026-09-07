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
import { captureSnapshot } from '../core/snapshot.mjs';
import { assessImpact } from '../core/impact.mjs';
import { generateScenarios } from '../core/scenarios.mjs';
import { rankScenarios } from '../core/scoring.mjs';
import { AuditLedger } from '../core/audit.mjs';
import { providerFromEnv } from '../agents/provider.mjs';
import { senseDisruption, proposeStrategies, narrateImpact, orchestratorAdvice } from '../agents/index.mjs';
import { adapterFromEnv } from '../sap/adapter.mjs';
import { makeSimulator } from '../sap/fixtures.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, '..', 'ui', 'public');
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' };

export async function buildState({ dbPath = ':memory:', provider } = {}) {
  const db = openDatabase(dbPath);
  if (dbPath !== ':memory:') resetData(db);
  seedDatabase(db);

  const ledger = new AuditLedger(db);
  const llm = provider ?? providerFromEnv();
  const sap = adapterFromEnv(process.env, { simulate: makeSimulator(db) });

  const snapshot = captureSnapshot(db, { disruptionId: 'DSR-0001' });
  const disruption = db.prepare("SELECT * FROM disruption_event WHERE id='DSR-0001'").get();

  ledger.append({
    eventType: 'DISRUPTION_DETECTED', actor: 'system:ingest',
    payload: { disruptionId: disruption.id, laneId: disruption.reported_lane_id, snapshotHash: snapshot.snapshotHash },
  });

  // S1 — sensing
  const sensing = await senseDisruption({ provider: llm, disruption, snapshot: snapshot.payload, db });
  db.prepare(
    `UPDATE disruption_event SET event_type=?, severity=?, confidence=?, geography=?,
       expected_duration_hours=?, classification_source=? WHERE id=?`,
  ).run(
    sensing.output.eventType, sensing.output.severity, sensing.output.confidence,
    sensing.output.geography, sensing.output.expectedDurationHours,
    sensing.ok ? 'AGENT' : 'DETERMINISTIC_FALLBACK', disruption.id,
  );
  const classified = db.prepare("SELECT * FROM disruption_event WHERE id='DSR-0001'").get();

  // deterministic impact
  const impact = assessImpact(snapshot.payload, classified, { asOf: SEED_EPOCH });
  ledger.append({
    eventType: 'IMPACT_ASSESSED', actor: 'engine:impact',
    payload: {
      ordersAtRisk: impact.ordersAtRisk.length,
      shipmentsHeld: impact.affected.shipments.length,
      earliestStockout: impact.baseline.earliestStockoutDate,
    },
  });

  // S2 + S3
  const narrative = await narrateImpact({ provider: llm, impact, snapshot: snapshot.payload, db });
  const intents = await proposeStrategies({ provider: llm, impact, snapshot: snapshot.payload, db });

  const gen = generateScenarios(impact, { asOf: SEED_EPOCH, strategyIntents: intents.output.intents });
  const { ranked, excluded, weights } = rankScenarios(gen.scenarios);

  ledger.append({
    eventType: 'SCENARIOS_RANKED', actor: 'engine:scenario',
    payload: {
      generationOrigin: gen.generationOrigin,
      ranked: ranked.map((s) => ({ id: s.id, strategy: s.strategyType, score: s.score })),
      excluded: excluded.map((s) => ({ id: s.id, strategy: s.strategyType, feasibility: s.feasibility })),
    },
  });

  const advice = orchestratorAdvice({ impact, ranked, excluded });
  const stock = await sap.readMaterialStock({ material: '000000000000100001', plant: 'WH-CENTRAL' });

  return {
    db, ledger, sap, llm,
    snapshot, disruption: classified, impact, ranked, excluded, weights,
    sensing, narrative, intents, gen, advice, stock,
  };
}

function view(state) {
  const { impact, ranked, excluded, weights, snapshot } = state;
  return {
    generatedAt: new Date().toISOString(),
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
