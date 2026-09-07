/**
 * UsageRecorder — persists chatbot LLM usage into the shared usage DB.
 *
 * Decoupled twin of gateway/infrastructure/usage-store.js. The chatbot is
 * self-contained (hexagonal) and never requires gateway code, so this small
 * adapter writes to the SAME database file (gateway/llm_usage.db by default)
 * using the same idempotent schema. SQLite WAL + busy_timeout makes the two
 * writers safe together, and the dashboard opens the file read-only.
 *
 * SCHEMA SYNC: keep the DDL below identical to
 *   - gateway/infrastructure/usage-store.js
 *   - dashboard/lib/schema.js
 *
 * PRICING SYNC: MODEL_PRICES must match the other two price tables in the
 * project. Update all three when prices change:
 *   - dashboard/lib/schema.js                     (read path)
 *   - src-tauri/src/agents/adapters/usage_store.rs (Rust agent writer)
 * (This previously named gateway/infrastructure/billing-tracker.js, which was
 * deleted when the agent pipeline moved to Rust.)
 *
 * Never throws — usage tracking must never break a chat reply.
 */

const path = require('path');
const Database = require('better-sqlite3');

const CHATBOT_ROOT = path.join(__dirname, '..', '..', '..');
const DEFAULT_DB_PATH = path.join(CHATBOT_ROOT, '..', 'gateway', 'llm_usage.db');
const REQUEST_MESSAGES_MAX = 16000;
const RESPONSE_PREVIEW_MAX = 2000;
const ERROR_MESSAGE_MAX = 500;

// Prices per 1,000,000 tokens (USD) — keep in sync with billing-tracker.js.
const MODEL_PRICES = {
  'gpt-5.6-luna': { input: 0.15, output: 0.60 },
  'openai/gpt-oss-20b': { input: 0.20, output: 0.60 },
  'openai/gpt-oss-120b': { input: 0.90, output: 0.90 },
  'llama-3.3-70b-versatile': { input: 0.59, output: 0.79 },
  'gemma2-9b-it': { input: 0.20, output: 0.20 },
  // Embeddings: input-only, so output is 0 (see OpenAiEmbeddingGateway).
  'text-embedding-3-small': { input: 0.02, output: 0 },
  default: { input: 0.50, output: 0.50 },
};

function calculateCost(model, promptTokens, completionTokens) {
  const prices = MODEL_PRICES[model] || MODEL_PRICES.default;
  return (promptTokens / 1_000_000) * prices.input
       + (completionTokens / 1_000_000) * prices.output;
}

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

class UsageRecorder {
  /**
   * @param {{dbPath?: string, trackPayloads?: boolean, enabled?: boolean,
   *          source?: string, logger?: import('../../domain/ports/ChatLogger').ChatLogger}} [opts]
   */
  constructor({ dbPath = DEFAULT_DB_PATH, trackPayloads = true, enabled = true,
                source = 'chatbot', logger = null } = {}) {
    this.dbPath = dbPath;
    this.trackPayloads = trackPayloads;
    this.enabled = enabled;
    this.source = source;
    this.logger = logger;
    this.db = null;
    this.insertStmt = null;
    this.initFailed = false;
    this.warnedOnce = false;
  }

  _init() {
    if (this.insertStmt || this.initFailed) return Boolean(this.insertStmt);
    try {
      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('busy_timeout = 3000');
      this.db.exec(SCHEMA);
      this.insertStmt = this.db.prepare(`
        INSERT INTO llm_requests (
          ts, source, tag, provider, endpoint, model, expect_json, max_tokens, timeout_ms,
          status, error_code, error_message, attempts, latency_ms,
          prompt_tokens, completion_tokens, total_tokens, cost_usd,
          request_messages, response_preview, pid
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      this.logger?.debug('usage', 'recorder_ready', { dbPath: this.dbPath });
      return true;
    } catch (err) {
      this.initFailed = true;
      this.logger?.warn('usage', 'recorder_init_failed', { message: String(err.message).slice(0, 200) });
      return false;
    }
  }

  _truncate(value, max) {
    if (typeof value !== 'string') return value;
    return value.length > max ? `${value.slice(0, max)}…[truncated]` : value;
  }

  /**
   * Record one LLM request. Best-effort; never throws.
   * Accepts the same entry shape as gateway/infrastructure/usage-store.js.
   */
  record(entry) {
    if (!this.enabled) return;
    try {
      if (!this._init()) return;

      const promptTokens = entry.usage?.prompt_tokens ?? null;
      const completionTokens = entry.usage?.completion_tokens ?? null;
      const totalTokens = (promptTokens || 0) + (completionTokens || 0);
      const costUsd = entry.status === 'ok'
        ? calculateCost(entry.model, promptTokens || 0, completionTokens || 0)
        : 0;

      let requestMessages = null;
      if (this.trackPayloads && Array.isArray(entry.messages)) {
        try { requestMessages = this._truncate(JSON.stringify(entry.messages), REQUEST_MESSAGES_MAX); }
        catch (_) { requestMessages = null; }
      }
      const responsePreview = this.trackPayloads && entry.responsePreview != null
        ? this._truncate(String(entry.responsePreview), RESPONSE_PREVIEW_MAX)
        : null;

      this.insertStmt.run(
        new Date().toISOString(),
        entry.source || this.source,
        entry.tag || null,
        entry.provider || 'openai',
        entry.endpoint || null,
        entry.model || null,
        entry.expectJson ? 1 : 0,
        entry.maxTokens ?? null,
        entry.timeoutMs ?? null,
        entry.status || 'ok',
        entry.errorCode != null ? String(entry.errorCode) : null,
        entry.errorMessage ? this._truncate(String(entry.errorMessage), ERROR_MESSAGE_MAX) : null,
        entry.attempts ?? 1,
        entry.latencyMs ?? null,
        promptTokens,
        completionTokens,
        totalTokens || null,
        costUsd,
        requestMessages,
        responsePreview,
        process.pid
      );
    } catch (err) {
      if (!this.warnedOnce) {
        this.warnedOnce = true;
        this.logger?.warn('usage', 'record_failed', { message: String(err.message).slice(0, 200) });
      }
    }
  }

  /** Close the DB (best effort). Safe to call multiple times. */
  close() {
    try { if (this.db) this.db.close(); } catch (_) { /* best effort */ }
    this.db = null;
    this.insertStmt = null;
  }
}

module.exports = { UsageRecorder };

