const protocol = require('./stdout-protocol.js');
const { log } = require('./logger.js');

function envFloat(name, fallback) {
  const v = parseFloat(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

const RULES = [
  {
    id: 'cost_per_chunk',
    label: 'Single chunk cost spike',
    threshold: () => envFloat('ANOMALY_COST_PER_CHUNK_USD', 0.05),
    check: (costUsd, _windowCost, _sessionCost) => costUsd,
  },
  {
    id: 'burn_rate_per_min',
    label: 'Cost burn rate per minute',
    threshold: () => envFloat('ANOMALY_COST_PER_MIN_USD', 0.10),
    check: (_cost, windowCost, _sessionCost) => windowCost,
  },
  {
    id: 'session_budget',
    label: 'Session total budget cap',
    threshold: () => envFloat('ANOMALY_SESSION_BUDGET_USD', 2.00),
    check: (_cost, _windowCost, sessionCost) => sessionCost,
  },
];

const COOLDOWN_MS = 60_000;
const WINDOW_MS   = 60_000;

const state = {
  sessionCostUsd: 0,
  window: [],       // [{ts, costUsd}]
  lastFired: {},    // ruleId → timestamp
};

function getWindowCost() {
  const cutoff = Date.now() - WINDOW_MS;
  state.window = state.window.filter(e => e.ts >= cutoff);
  return state.window.reduce((sum, e) => sum + e.costUsd, 0);
}

function record(costUsd, _tokens) {
  state.sessionCostUsd += costUsd;
  state.window.push({ ts: Date.now(), costUsd });
  const windowCost = getWindowCost();

  for (const rule of RULES) {
    const value = rule.check(costUsd, windowCost, state.sessionCostUsd);
    const threshold = rule.threshold();
    if (value >= threshold) {
      const lastFired = state.lastFired[rule.id] || 0;
      if (Date.now() - lastFired >= COOLDOWN_MS) {
        state.lastFired[rule.id] = Date.now();
        log('warn', 'cost_anomaly', rule.id, { value: value.toFixed(4), threshold });
        protocol.emitCostAnomaly(rule.id, rule.label, value, threshold);
      }
    }
  }
}

function getStatus() {
  return {
    windowCostUsd: getWindowCost(),
    sessionCostUsd: state.sessionCostUsd,
    activeAlerts: Object.keys(state.lastFired).filter(
      id => Date.now() - state.lastFired[id] < COOLDOWN_MS
    ),
  };
}

function reset() {
  state.sessionCostUsd = 0;
  state.window = [];
  state.lastFired = {};
}

module.exports = { record, getStatus, reset };
