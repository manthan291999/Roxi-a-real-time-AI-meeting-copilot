/**
 * Environment configuration — the ONLY module that reads process.env.
 *
 * Load order (later entries DO NOT override earlier ones):
 *   1. Root .env  (global — shared by Rust agents, gateway, chatbot)
 *   2. chatbot/.env  (local overrides, optional)
 * This means you only need to maintain ONE .env file at the project root.
 */

const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const CHATBOT_ROOT = path.join(__dirname, '..', '..');

// 1. Global root .env — the single source of truth
const rootEnv = path.join(CHATBOT_ROOT, '..', '.env');
if (fs.existsSync(rootEnv)) {
  dotenv.config({ path: rootEnv });
}

// 2. chatbot-local .env — only fills vars not already set (never overrides root)
const localEnv = path.join(CHATBOT_ROOT, '.env');
if (fs.existsSync(localEnv)) {
  dotenv.config({ path: localEnv, override: false });
}


function envStr(name, fallback = '') {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function envInt(name, fallback) {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function envFloat(name, fallback) {
  const v = parseFloat(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
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
    /**
     * Chatbot-owned document store. Deliberately NOT chat_index.db: that file
     * is opened read-only by FtsRetriever and wholesale-rebuilt by
     * FtsIndexBuilder, so user documents there would be tied to an index
     * rebuild.
     */
    docStorePath: envStr('CHATBOT_DOC_DB', path.join(CHATBOT_ROOT, 'data', 'doc_store.db')),
    /** Embedding model. 1,536 dims, $0.02/1M tokens. */
    embedModel: envStr('CHATBOT_EMBED_MODEL', 'text-embedding-3-small'),
    /**
     * Embeddings get their OWN call budget. Sharing the chat budget would let
     * one large upload starve the conversation it was uploaded for.
     */
    embedBudgetHard: envInt('CHATBOT_EMBED_BUDGET_HARD', 400),
    /**
     * Upload limits are driven by size rather than a file count: a library of
     * forty short notes and one of three long reports should both be allowed.
     * maxDocuments is only a backstop against pathological cases.
     */
    maxDocumentBytes: envInt('CHATBOT_MAX_DOCUMENT_BYTES', 20 * 1024 * 1024),
    maxLibraryBytes: envInt('CHATBOT_MAX_LIBRARY_BYTES', 200 * 1024 * 1024),
    maxDocuments: envInt('CHATBOT_MAX_DOCUMENTS', 50),
    /**
     * Local-only Qdrant sidecar, spawned by the Rust core (see
     * adapters/vector_client.rs). Never exposed off-loopback.
     */
    qdrantUrl: envStr('QDRANT_URL', 'http://127.0.0.1:6333'),
    /** Meeting Semantic Memory, episodic layer (Ask Roxi over chunks). */
    qdrantEpisodicCollection: envStr('QDRANT_EPISODIC_COLLECTION', 'roxi_episodic_memory'),
    /** Meeting Semantic Memory, semantic layer (glossary + speaker topics). */
    qdrantSemanticCollection: envStr('QDRANT_SEMANTIC_COLLECTION', 'roxi_semantic_memory'),
    /**
     * compositeScore() re-rank (plan §05). Relevance dominates on purpose —
     * this re-ranks an already similarity-filtered set, not a replacement
     * for semantic match. Principled defaults, not yet measured against real
     * questions (the plan's own §18 flags this as an open question).
     */
    episodicRecencyHalflifeDays: envInt('EPISODIC_RECENCY_HALFLIFE_DAYS', 14),
    episodicWeightRelevance: envFloat('EPISODIC_W_RELEVANCE', 0.6),
    episodicWeightImportance: envFloat('EPISODIC_W_IMPORTANCE', 0.25),
    episodicWeightRecency: envFloat('EPISODIC_W_RECENCY', 0.15),
    /**
     * Incremental episodic sync interval. 1 minute is the practical floor for
     * a polling design, not a cost tradeoff: analyzed chunks rarely arrive
     * faster than STT-finalize + ChunkGraph analysis allows anyway, so
     * polling tighter than this mostly finds nothing (plan §09/§13).
     */
    episodicSyncMaxAgeMs: envInt('CHATBOT_EPISODIC_SYNC_MAX_AGE_MS', 60 * 1000),
    /**
     * Semantic sync (glossary terms) rebuild interval. Glossary terms change
     * slowly relative to chunks, so this runs on its own, much slower cadence
     * rather than piggybacking on the episodic timer (plan §08/§13).
     */
    semanticSyncMaxAgeMs: envInt('CHATBOT_SEMANTIC_SYNC_MAX_AGE_MS', 30 * 60 * 1000),
    /**
     * Episodic retention (plan §01/§05a). A Qdrant point and its payload are
     * purged this many days after `created_at` — the vector copy, never the
     * `chunks` row in meeting_history.db. Semantic memory is exempt (§06).
     */
    episodicRetentionDays: envInt('EPISODIC_RETENTION_DAYS', 90),
    /** How often PurgeEpisodicMemoryUseCase runs. Daily is plenty for a 90-day window. */
    episodicPurgeIntervalMs: envInt('EPISODIC_PURGE_INTERVAL_MS', 24 * 60 * 60 * 1000),
    /** Log level: debug|info|warn|error. */
    logLevel: envStr('CHATBOT_LOG_LEVEL', 'info'),
  });
}

module.exports = { loadConfig, CHATBOT_ROOT };
