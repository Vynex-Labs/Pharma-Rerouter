/**
 * Language-model provider abstraction.
 *
 * Authority: ADR-0002 §7, AR-7. Requirements: REQ-068 (swappable without touching the spine),
 * REQ-067 (record provider/model/prompt version), NFR-003 (system works with the model disabled).
 *
 * The MockProvider is not a stub for convenience — it is the mechanism that makes NFR-003 testable
 * and keeps the whole suite runnable offline. Swapping in SAP AI Core / Generative AI Hub later is
 * an implementation of this interface (ADR-0004 §6), not a rewrite.
 */

export class LanguageModelProvider {
  get name() { return 'abstract'; }
  get model() { return 'abstract'; }
  // eslint-disable-next-line no-unused-vars
  async complete({ system, user, schemaName }) {
    throw new Error('not implemented');
  }
}

/**
 * Deterministic offline provider. Produces schema-valid output for each seam by simple pattern
 * work over the input — NOT by reasoning. It exists so that:
 *   - the test suite never needs network or credentials
 *   - the demo has a guaranteed fallback (risk R-06)
 * Its outputs are always labelled so nothing can mistake them for genuine model reasoning.
 */
export class MockProvider extends LanguageModelProvider {
  get name() { return 'mock'; }
  get model() { return 'deterministic-mock-v1'; }

  async complete({ schemaName, context }) {
    switch (schemaName) {
      case 'DisruptionClassification': {
        const text = (context?.advisoryText ?? '').toLowerCase();
        const closure = /suspend|closure|closed|halt/.test(text);
        const reefer = /reefer|temperature|cold/.test(text);
        const durations = [...(context?.advisoryText ?? '').matchAll(/(\d+)\s*(?:to|-|–)\s*(\d+)\s*hours/gi)];
        const upper = durations.length ? Number(durations[0][2]) : null;
        return {
          eventType: closure ? 'PORT_CLOSURE' : 'UNKNOWN',
          severity: closure && reefer ? 'CRITICAL' : closure ? 'HIGH' : 'LOW',
          confidence: closure ? 0.82 : 0.35,
          geography: /northern europe/i.test(context?.advisoryText ?? '') ? 'Northern Europe' : 'Unknown',
          expectedDurationHours: upper,
          uncertainty: upper
            ? 'Restoration window is provisional; reefer power restoration is unconfirmed and backlog clearance has no estimate.'
            : 'No duration stated in the advisory.',
          reasoning: 'Pattern-matched offline classification (mock provider).',
        };
      }
      case 'StrategyIntents':
        return {
          intents: [
            { strategy: 'AIR_REROUTE', rationale: 'Fastest option for held cold-chain volume.' },
            { strategy: 'INVENTORY_REBALANCE', rationale: 'Buys days at the shortage site without new supply.' },
            { strategy: 'ALT_SUPPLIER', rationale: 'Check whether an alternate source is even permissible.' },
          ],
          confidence: 0.6,
          uncertainty: 'Offline heuristic; no semantic reading of the advisory was performed.',
        };
      case 'Narrative':
        return {
          text: null, // forces the deterministic template — honest about adding nothing
          confidence: 0.5,
          uncertainty: 'Mock provider does not generate prose.',
        };
      default:
        throw new Error(`MockProvider has no behaviour for schema ${schemaName}`);
    }
  }
}

/** Simulates provider failure — used by tests proving the failure ladder (ADR-0002 §6). */
export class FailingProvider extends LanguageModelProvider {
  constructor(mode = 'error') { super(); this.mode = mode; }
  get name() { return 'failing'; }
  get model() { return `failing-${this.mode}`; }
  async complete() {
    if (this.mode === 'error') throw new Error('provider unavailable');
    if (this.mode === 'malformed') return { nonsense: true };
    if (this.mode === 'invented') {
      return {
        intents: [{ strategy: 'TELEPORT_STOCK', rationale: 'hallucinated strategy' }],
        confidence: 0.99,
        uncertainty: 'none',
      };
    }
    if (this.mode === 'no-uncertainty') {
      return { eventType: 'PORT_CLOSURE', severity: 'HIGH', confidence: 0.9, geography: 'X' };
    }
    throw new Error('unknown failure mode');
  }
}

export function providerFromEnv(env = process.env) {
  const kind = (env.LLM_PROVIDER ?? 'mock').toLowerCase();
  if (kind === 'mock' || !env.LLM_API_KEY) return new MockProvider();
  throw new Error(
    `LLM_PROVIDER=${kind} is configured but no adapter is implemented. ` +
    `The system runs on the deterministic MockProvider rather than silently pretending otherwise.`,
  );
}
