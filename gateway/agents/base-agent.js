const { log, metrics } = require('../infrastructure/logger.js');
const billingTracker = require('../infrastructure/billing-tracker.js');


async function runAgent(agent, chunkText, speaker, mode, calls, breaker, extraContext = {}) {
  if (!breaker.allowAgent(agent.name, mode)) {
    return { ok: false, skipped: true, error: { agent: agent.name, code: 'budget_denied' } };
  }

  const started = Date.now();
  try {
    const raw = await agent.run(chunkText, speaker, extraContext);
    breaker.recordCall(1);
    calls.count++;
    const data = agent.validate ? agent.validate(raw.data) : raw.data;
    if (raw.usage && raw.model) {
      billingTracker.recordCall(agent.name, raw.model, raw.usage);
    }
    log('info', 'agent', 'agent_ok', { agent: agent.name, latencyMs: raw.latencyMs, attempts: raw.attempts });
    return { ok: true, data, latencyMs: raw.latencyMs, usage: raw.usage };
  } catch (err) {
    const latencyMs = Date.now() - started;
    const code = err.code || 'unknown';
    log('error', 'agent', 'agent_failed', {
      agent: agent.name,
      code,
      message: (err.message || '').slice(0, 200),
      latencyMs,
      attempts: err.attempts || 1,
    });
    metrics.increment('agent_failure', { agent: agent.name, code });
    return {
      ok: false,
      error: { agent: agent.name, code, message: err.message, latencyMs, attempts: err.attempts || 1 },
    };
  }
}

function createBaseAgent(name, runFn, validateFn = null) {
  return {
    name,
    run: runFn,
    validate: validateFn
  };
}

module.exports = {
  runAgent,
  createBaseAgent
};
