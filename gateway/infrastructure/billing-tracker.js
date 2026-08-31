/**
 * AI Meeting Interpreter — Real-Time Billing Tracker
 * 
 * Aggregates token usage and calculates session costs based on Groq pricing.
 * Fully decoupled from meeting state and LLM orchestration.
 */

// Prices per 1,000,000 tokens (USD)
// Based on Groq pricing 2025
const MODEL_PRICES = {
  'gpt-5.6-luna': { input: 0.15, output: 0.60 },
  'openai/gpt-oss-20b': { input: 0.20, output: 0.60 },
  'openai/gpt-oss-120b': { input: 0.90, output: 0.90 },
  'llama-3.3-70b-versatile': { input: 0.59, output: 0.79 },
  'gemma2-9b-it': { input: 0.20, output: 0.20 },
  'default': { input: 0.50, output: 0.50 }, // fallback
};

const costAnomalyDetector = require('./cost-anomaly-detector.js');

const billingState = {
  session_total_usd: 0,
  session_prompt_tokens: 0,
  session_completion_tokens: 0,
  calls_made: 0,
  per_agent: {}
};

/**
 * Calculates the cost for a given call based on model pricing.
 */
function calculateCost(model, promptTokens, completionTokens) {
  const prices = MODEL_PRICES[model] || MODEL_PRICES['default'];
  const inputCost = (promptTokens / 1_000_000) * prices.input;
  const outputCost = (completionTokens / 1_000_000) * prices.output;
  return inputCost + outputCost;
}

/**
 * Records an API call and adds its cost/tokens to the session totals.
 * @param {string} agentName - The name of the agent (e.g., 'context_manager')
 * @param {string} model - The model used
 * @param {Object} usage - { prompt_tokens, completion_tokens }
 */
function recordCall(agentName, model, usage) {
  if (!usage || (usage.prompt_tokens == null && usage.completion_tokens == null)) {
    return;
  }

  const promptTokens = usage.prompt_tokens || 0;
  const completionTokens = usage.completion_tokens || 0;
  const cost = calculateCost(model, promptTokens, completionTokens);

  // Update session totals
  billingState.session_prompt_tokens += promptTokens;
  billingState.session_completion_tokens += completionTokens;
  billingState.session_total_usd += cost;
  billingState.calls_made += 1;

  costAnomalyDetector.record(cost, promptTokens + completionTokens);

  // Update per-agent stats
  if (!billingState.per_agent[agentName]) {
    billingState.per_agent[agentName] = { calls: 0, cost_usd: 0, tokens_in: 0, tokens_out: 0 };
  }
  
  const agentStats = billingState.per_agent[agentName];
  agentStats.calls += 1;
  agentStats.cost_usd += cost;
  agentStats.tokens_in += promptTokens;
  agentStats.tokens_out += completionTokens;
}

/**
 * Returns a snapshot of the current session billing state.
 */
function getSnapshot() {
  // Deep clone to prevent accidental mutations
  return JSON.parse(JSON.stringify(billingState));
}

/**
 * Resets the billing state (useful on new session start).
 */
function reset() {
  billingState.session_total_usd = 0;
  billingState.session_prompt_tokens = 0;
  billingState.session_completion_tokens = 0;
  billingState.calls_made = 0;
  billingState.per_agent = {};
}

module.exports = {
  recordCall,
  getSnapshot,
  reset,
  // Exported so the LLM usage store (infrastructure/usage-store.js) prices
  // persisted requests with the exact same table — single source of truth.
  calculateCost,
  MODEL_PRICES,
};
