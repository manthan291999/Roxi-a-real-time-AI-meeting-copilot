/**
 * AI Meeting Interpreter — LLM Usage Store
 *
 * Persists every LLM request (success or failure) into a dedicated SQLite
 * database (gateway/llm_usage.db) so the developer dashboard (dashboard/)
 * can show per-request tokens, latency, cost, payloads and errors.
 *
 * Design rules:
 *  - NEVER THROWS: usage tracking is best-effort. A tracking failure must
 *    never kill the live capture pipeline (same convention as db/index.js).
 *  - Dedicated DB file: meeting_history.db stays untouched, so the Rust read
 *    path (src-tauri/src/db.rs) and its migration history are unaffected.
 *  - Lazy init: the DB is opened on first record(), not at require time.
 *  - Privacy: prompts/responses are truncated; set LLM_TRACK_PAYLOADS=0 to
 *    disable payload capture entirely. Set LLM_USAGE_TRACKING=0 to disable
 *    the whole recorder.
 *
 * SCHEMA SYNC: the DDL below is shared with
 *   - chatbot/src/infrastructure/usage/UsageRecorder.js (second writer)
 *   - dashboard/lib/schema.js (seed script)
 * Keep the three copies identical.
 *
 * Env:
 *  - LLM_USAGE_DB        absolute path to the usage DB (default: gateway/llm_usage.db)
 *  - LLM_TRACK_PAYLOADS  '0' to skip storing request messages / response preview
 *  - LLM_USAGE_TRACKING  '0' to disable recording entirely
 */

const path = require('path');
const Database = require('better-sqlite3');
const { log } = require('./logger.js');
const { calculateCost } = require('./billing-tracker.js');

const DEFAULT_DB_PATH = path.join(__dirname, '..', 'llm_usage.db');
const REQUEST_MESSAGES_MAX = 16000; // chars of serialized messages kept
const RESPONSE_PREVIEW_MAX = 2000;  // chars of completion text kept
const ERROR_MESSAGE_MAX = 500;

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

let db = null;
let insertStmt = null;
let initFailed = false;
let warnedOnce = false;

const enabled = process.env.LLM_USAGE_TRACKING !== '0';
const trackPayloads = process.env.LLM_TRACK_PAYLOADS !== '0';
const dbPath = process.env.LLM_USAGE_DB || DEFAULT_DB_PATH;

function init() {
  if (insertStmt || initFailed) return Boolean(insertStmt);
  try {
    db = new Database(dbPath);
    // WAL lets the chatbot process and the dashboard (read-only) access the
    // same file concurrently; busy_timeout avoids writer collisions.
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 3000');
    db.exec(SCHEMA);
    insertStmt = db.prepare(`
      INSERT INTO llm_requests (
        ts, source, tag, provider, endpoint, model, expect_json, max_tokens, timeout_ms,
        status, error_code, error_message, attempts, latency_ms,
        prompt_tokens, completion_tokens, total_tokens, cost_usd,
        request_messages, response_preview, pid
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    log('info', 'usage', 'store_ready', { dbPath });
    return true;
  } catch (err) {
    initFailed = true;
    log('warn', 'usage', 'store_init_failed', { message: (err.message || '').slice(0, 200) });
    return false;
  }
}

function truncate(value, max) {
  if (typeof value !== 'string') return value;
  return value.length > max ? `${value.slice(0, max)}…[truncated]` : value;
}

/**
 * Record one LLM request. Best-effort; never throws.
 * @param {Object} entry
 * @param {'gateway'|'chatbot'} entry.source      which subsystem made the call
 * @param {string}  entry.tag                     call tag / agent name ('analyst', 'generate', …)
 * @param {'ok'|'failed'} entry.status
 * @param {string}  [entry.provider]              e.g. 'openai'
 * @param {string}  [entry.endpoint]              e.g. 'https://api.openai.com/v1/chat/completions'
 * @param {string}  [entry.model]
 * @param {boolean} [entry.expectJson]
 * @param {number}  [entry.maxTokens]
 * @param {number}  [entry.timeoutMs]
 * @param {string|number} [entry.errorCode]
 * @param {string}  [entry.errorMessage]
 * @param {number}  [entry.attempts]              total attempts incl. retries
 * @param {number}  [entry.latencyMs]             wall time for the whole call incl. retries
 * @param {{prompt_tokens?: (number|null), completion_tokens?: (number|null)}} [entry.usage]
 * @param {Array}   [entry.messages]              request messages (stored unless disabled)
 * @param {string}  [entry.responsePreview]       completion text (stored unless disabled)
 */
function record(entry) {
  if (!enabled) return;
  try {
    if (!init()) return;

    const promptTokens = entry.usage?.prompt_tokens ?? null;
    const completionTokens = entry.usage?.completion_tokens ?? null;
    const totalTokens = (promptTokens || 0) + (completionTokens || 0);
    const costUsd = entry.status === 'ok'
      ? calculateCost(entry.model, promptTokens || 0, completionTokens || 0)
      : 0;

    let requestMessages = null;
    if (trackPayloads && Array.isArray(entry.messages)) {
      try { requestMessages = truncate(JSON.stringify(entry.messages), REQUEST_MESSAGES_MAX); }
      catch (_) { requestMessages = null; }
    }
    const responsePreview = trackPayloads && entry.responsePreview != null
      ? truncate(String(entry.responsePreview), RESPONSE_PREVIEW_MAX)
      : null;

    insertStmt.run(
      new Date().toISOString(),
      entry.source || 'gateway',
      entry.tag || null,
      entry.provider || 'openai',
      entry.endpoint || null,
      entry.model || null,
      entry.expectJson ? 1 : 0,
      entry.maxTokens ?? null,
      entry.timeoutMs ?? null,
      entry.status || 'ok',
      entry.errorCode != null ? String(entry.errorCode) : null,
      entry.errorMessage ? truncate(String(entry.errorMessage), ERROR_MESSAGE_MAX) : null,
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
    if (!warnedOnce) {
      warnedOnce = true;
      log('warn', 'usage', 'record_failed', { message: (err.message || '').slice(0, 200) });
    }
  }
}

/** Close the DB (best effort). Safe to call multiple times. */
function close() {
  try { if (db) db.close(); } catch (_) { /* best effort */ }
  db = null;
  insertStmt = null;
}

module.exports = { record, close, dbPath };

