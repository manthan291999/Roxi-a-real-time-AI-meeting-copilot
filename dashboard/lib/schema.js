/**
 * Dashboard-side copy of the llm_requests schema + model pricing.
 *
 * Used by scripts/seed-demo.js (creates demo data) and by server.js as a
 * read-time cost fallback for rows written without pricing.
 *
 * SCHEMA SYNC: keep the DDL identical to
 *   - gateway/infrastructure/usage-store.js
 *   - chatbot/src/infrastructure/usage/UsageRecorder.js
 * PRICING SYNC: keep MODEL_PRICES identical to
 *   - gateway/infrastructure/billing-tracker.js (source of truth)
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS llm_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  source TEXT NOT NULL,
  tag TEXT,
  provider TEXT NOT NULL DEFAULT 'openai',
  endpoint TEXT,
  model TEXT,
  expect_json INTEGER NOT NULL DEFAULT 0,
  max_tokens INTEGER,
  timeout_ms INTEGER,
  status TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  attempts INTEGER NOT NULL DEFAULT 1,
  latency_ms INTEGER,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  cost_usd REAL NOT NULL DEFAULT 0,
  request_messages TEXT,
  response_preview TEXT,
  pid INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_llm_requests_ts ON llm_requests (ts);
CREATE INDEX IF NOT EXISTS idx_llm_requests_tag ON llm_requests (tag);
CREATE INDEX IF NOT EXISTS idx_llm_requests_status ON llm_requests (status);
`;

// Prices per 1,000,000 tokens (USD).
const MODEL_PRICES = {
  'gpt-5.6-luna': { input: 0.15, output: 0.60 },
  'openai/gpt-oss-20b': { input: 0.20, output: 0.60 },
  'openai/gpt-oss-120b': { input: 0.90, output: 0.90 },
  'llama-3.3-70b-versatile': { input: 0.59, output: 0.79 },
  'gemma2-9b-it': { input: 0.20, output: 0.20 },
  default: { input: 0.50, output: 0.50 },
};

function costOf(model, promptTokens, completionTokens) {
  const prices = MODEL_PRICES[model] || MODEL_PRICES.default;
  return ((promptTokens || 0) / 1_000_000) * prices.input
       + ((completionTokens || 0) / 1_000_000) * prices.output;
}

module.exports = { SCHEMA, MODEL_PRICES, costOf };
