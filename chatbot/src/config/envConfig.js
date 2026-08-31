/**
 * Environment configuration — the ONLY module that reads process.env.
 *
 * Precedence: chatbot/.env (own overrides) > gateway/.env (shared keys,
 * fills gaps only) > existing process env. This lets the chatbot reuse the
 * project's OPENAI_API_KEY without duplicating secrets, while staying fully
 * decoupled from gateway code.
 */

const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const CHATBOT_ROOT = path.join(__dirname, '..', '..');

// Own .env wins...
dotenv.config({ path: path.join(CHATBOT_ROOT, '.env') });
// ...gateway/.env only fills missing vars (never overrides).
const gatewayEnv = path.join(CHATBOT_ROOT, '..', 'gateway', '.env');
if (fs.existsSync(gatewayEnv)) {
  dotenv.config({ path: gatewayEnv, override: false });
}

function envStr(name, fallback = '') {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function envInt(name, fallback) {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/**
 * @returns {Readonly<Object>} frozen config object
 */
function loadConfig() {
  return Object.freeze({
    /** OpenAI-compatible API key (shared with gateway unless overridden). */
    openAiApiKey: envStr('OPENAI_API_KEY'),
    /** Optional base URL override (proxies, Azure-compatible gateways). */
    openAiBaseUrl: envStr('OPENAI_BASE_URL'),
    /** Model id. gpt-5.6-luna is the project default (see LLM adapter note). */
    model: envStr('CHATBOT_MODEL', 'gpt-5.6-luna'),
    /** 'openai' (direct SDK, quirk-safe) or 'langchain' (ChatOpenAI). */
    llmAdapter: envStr('CHATBOT_LLM_ADAPTER', 'openai'),
    /** Meeting database owned by the capture pipeline (READ-ONLY here). */
    meetingDbPath: envStr(
      'CHATBOT_MEETING_DB',
      path.join(CHATBOT_ROOT, '..', 'gateway', 'meeting_history.db')
    ),
    /** Chatbot-owned FTS index database (never touches the meeting DB). */
    indexDbPath: envStr('CHATBOT_INDEX_DB', path.join(CHATBOT_ROOT, 'data', 'chat_index.db')),
    /** Per-process chat LLM budget (call counts). */
    budgetSoft: envInt('CHATBOT_LLM_BUDGET_SOFT', 60),
    budgetHard: envInt('CHATBOT_LLM_BUDGET_HARD', 80),
    /** Rebuild the FTS index when older than this (ms). */
    indexMaxAgeMs: envInt('CHATBOT_INDEX_MAX_AGE_MS', 30 * 60 * 1000),
    /** Shared LLM usage DB written by gateway + chatbot, read by dashboard/. */
    usageDbPath: envStr('LLM_USAGE_DB', path.join(CHATBOT_ROOT, '..', 'gateway', 'llm_usage.db')),
    /** Store request/response payloads in the usage DB ('0' disables — privacy). */
    trackUsagePayloads: envStr('LLM_TRACK_PAYLOADS', '1') !== '0',
    /** Disable LLM usage recording entirely when '0'. */
    usageTracking: envStr('LLM_USAGE_TRACKING', '1') !== '0',
    /** Log level: debug|info|warn|error. */
    logLevel: envStr('CHATBOT_LOG_LEVEL', 'info'),
  });
}

module.exports = { loadConfig, CHATBOT_ROOT };
