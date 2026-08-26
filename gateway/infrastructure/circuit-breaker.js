/**
 * AI Meeting Interpreter — API Budget Circuit Breaker
 *
 * Replaces the old hard-stop at 200 calls with three states:
 *
 *  - closed   (< softLimit):            all agents run.
 *  - degraded (softLimit ≤ used < hard): Context Manager + Explanation only.
 *  - open     (≥ hardLimit):            Context Manager only, plus one
 *                                        full-cascade "probe" chunk per
 *                                        cooldown window so the meeting can
 *                                        recover if the budget is raised.
 *
 * Accounting is per API call (recordCall after each successful call), so the
 * budget can no longer overshoot by a whole chunk's worth of calls.
 */

const STATES = { CLOSED: 'closed', DEGRADED: 'degraded', OPEN: 'open' };

/** Chunk modes returned by beginChunk(). */
const MODES = { FULL: 'full', DEGRADED: 'degraded', MINIMAL: 'minimal', PROBE: 'probe' };

const AGENT_TIERS = {
  transcript_cleaner: 'core',
  context_manager: 'core',
  explanation: 'standard',
  technical: 'standard',
  analyst: 'deep',
  risk: 'deep',
  response: 'standard',
};

function envInt(name, fallback) {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

class CircuitBreaker {
  constructor({ softLimit, hardLimit, probeCooldownMs } = {}) {
    this.softLimit = softLimit != null ? softLimit : envInt('LLM_BUDGET_SOFT', 60);
    this.hardLimit = hardLimit != null ? hardLimit : envInt('LLM_BUDGET_HARD', 80);
    this.probeCooldownMs = probeCooldownMs != null
      ? probeCooldownMs
      : envInt('LLM_PROBE_COOLDOWN_MS', 15 * 60 * 1000);
    this.used = 0;
    this.nextProbeAt = 0;
  }

  get state() {
    if (this.used >= this.hardLimit) return STATES.OPEN;
    if (this.used >= this.softLimit) return STATES.DEGRADED;
    return STATES.CLOSED;
  }

  /**
   * Decide which agents the next chunk may run. Call exactly once per chunk,
   * before any agent runs.
   * @returns {'full'|'degraded'|'minimal'|'probe'}
   */
  beginChunk(now = Date.now()) {
    if (this.state === STATES.OPEN) {
      if (now >= this.nextProbeAt) {
        this.nextProbeAt = now + this.probeCooldownMs;
        return MODES.PROBE;
      }
      return MODES.MINIMAL;
    }
    if (this.state === STATES.DEGRADED) return MODES.DEGRADED;
    return MODES.FULL;
  }

  /** Whether a given agent may run under the chunk's mode. */
  allowAgent(agentName, mode) {
    const tier = AGENT_TIERS[agentName];
    if (!tier) return false;
    if (mode === MODES.FULL || mode === MODES.PROBE) return true;
    if (mode === MODES.DEGRADED) return tier === 'core' || agentName === 'explanation';
    return tier === 'core'; // minimal
  }

  /** Record n successful API calls against the budget. */
  recordCall(n = 1) {
    this.used += n;
  }

  snapshot() {
    return {
      state: this.state,
      used: this.used,
      softLimit: this.softLimit,
      hardLimit: this.hardLimit,
      nextProbeAt: this.nextProbeAt || null,
    };
  }

  reset() {
    this.used = 0;
    this.nextProbeAt = 0;
  }
}

function createCircuitBreaker(opts) {
  return new CircuitBreaker(opts);
}

module.exports = { CircuitBreaker, createCircuitBreaker, STATES, MODES, AGENT_TIERS };
