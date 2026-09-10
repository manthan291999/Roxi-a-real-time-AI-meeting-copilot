/**
 * Embedding-scoped usage queries — everything the dashboard needs to answer
 * "how is every embedding call being used", isolated from the general
 * completion-dominated queries in server.js.
 *
 * Single responsibility: this module only knows how to read embedding rows
 * out of the shared `llm_requests` table. It does not touch the schema, the
 * write path, or completion queries — those are untouched by this feature.
 *
 * Discriminator: every embedding call is written with
 * endpoint = 'https://api.openai.com/v1/embeddings' (OpenAiEmbeddingGateway.js),
 * while every completion call — Rust agents, OpenAiLlmGateway, LangchainLlmGateway —
 * writes the chat/completions endpoint. That column already exists on every
 * row today, so no schema change (and no touching the write path in
 * UsageRecorder.js / usage_store.rs) was needed to add this feature.
 *
 * PRICING: delegated to lib/schema.js's costOf/MODEL_PRICES — kept in one
 * place rather than duplicated here.
 */

'use strict';

const EMBEDDING_ENDPOINT_MATCH = "endpoint LIKE '%/embeddings'";

/** Aggregate totals across every embedding call ever recorded. */
function querySummary(db, costOf) {
  const row = db.prepare(`
    SELECT COUNT(*) AS requests,
           SUM(status = 'ok') AS ok,
           SUM(status = 'failed') AS failed,
           COALESCE(SUM(prompt_tokens), 0) AS tokens_embedded,
           COALESCE(SUM(cost_usd), 0) AS cost_usd,
           AVG(CASE WHEN status = 'ok' THEN latency_ms END) AS avg_latency_ms,
           COUNT(DISTINCT model) AS model_count,
           MIN(ts) AS first_ts, MAX(ts) AS last_ts
    FROM llm_requests
    WHERE ${EMBEDDING_ENDPOINT_MATCH}
  `).get();

  const lat = db.prepare(`
    SELECT latency_ms FROM llm_requests
    WHERE ${EMBEDDING_ENDPOINT_MATCH} AND status = 'ok' AND latency_ms IS NOT NULL
    ORDER BY latency_ms
  `).raw(true).all();
  const p95 = lat.length ? lat[Math.min(lat.length - 1, Math.floor(lat.length * 0.95))][0] : null;

  // Read-time cost fallback, mirroring /api/summary's fallback for rows
  // recorded before cost_usd was populated.
  let cost = row.cost_usd || 0;
  if (!cost && row.tokens_embedded > 0) {
    const perModel = db.prepare(`
      SELECT model, COALESCE(SUM(prompt_tokens), 0) tin
      FROM llm_requests
      WHERE ${EMBEDDING_ENDPOINT_MATCH} AND status = 'ok'
      GROUP BY model
    `).all();
    cost = perModel.reduce((sum, m) => sum + costOf(m.model, m.tin, 0), 0);
  }

  return {
    requests: row.requests || 0,
    ok: row.ok || 0,
    failed: row.failed || 0,
    tokens_embedded: row.tokens_embedded || 0,
    cost_usd: cost,
    avg_latency_ms: row.avg_latency_ms != null ? Math.round(row.avg_latency_ms) : null,
    p95_latency_ms: p95,
    model_count: row.model_count || 0,
    first_ts: row.first_ts,
    last_ts: row.last_ts,
  };
}

/** Rollup by (source, tag, model) — e.g. embed_query vs embed_document vs embed_chunk. */
function queryByTag(db) {
  return db.prepare(`
    SELECT source, COALESCE(tag, '(untagged)') AS tag, model,
           COUNT(*) AS calls,
           SUM(status = 'ok') AS ok,
           SUM(status = 'failed') AS failed,
           COALESCE(SUM(prompt_tokens), 0) AS tokens_embedded,
           COALESCE(SUM(cost_usd), 0) AS cost_usd,
           AVG(CASE WHEN status = 'ok' THEN latency_ms END) AS avg_latency_ms
    FROM llm_requests
    WHERE ${EMBEDDING_ENDPOINT_MATCH}
    GROUP BY source, tag, model
    ORDER BY calls DESC
  `).all();
}

/** Tokens embedded / cost / calls per time bucket — same bucketing rule as /api/timeline. */
function queryTimeline(db, bucket) {
  const fmt = bucket === 'hour' ? '%Y-%m-%d %H:00' : '%Y-%m-%d %H:%M';
  return db.prepare(`
    SELECT strftime('${fmt}', ts) AS bucket,
           COUNT(*) AS requests,
           COALESCE(SUM(prompt_tokens), 0) AS tokens_embedded,
           COALESCE(SUM(cost_usd), 0) AS cost_usd
    FROM llm_requests
    WHERE ${EMBEDDING_ENDPOINT_MATCH}
    GROUP BY bucket
    ORDER BY bucket
  `).all();
}

/** Which bucket size /api/embeddings/timeline should use — mirrors /api/timeline's rule. */
function pickBucket(db) {
  const range = db.prepare(`
    SELECT MIN(ts) a, MAX(ts) b FROM llm_requests WHERE ${EMBEDDING_ENDPOINT_MATCH}
  `).get();
  const spanMs = range.a && range.b ? Date.parse(range.b) - Date.parse(range.a) : 0;
  return spanMs > 6 * 3600 * 1000 ? 'hour' : 'minute';
}

/** Per-process (one sidecar run) rollup of embedding calls only. */
function querySessions(db) {
  return db.prepare(`
    SELECT pid, GROUP_CONCAT(DISTINCT source) AS sources,
           MIN(ts) AS started, MAX(ts) AS last_seen,
           COUNT(*) AS requests,
           SUM(status = 'failed') AS failed,
           COALESCE(SUM(prompt_tokens), 0) AS tokens_embedded,
           COALESCE(SUM(cost_usd), 0) AS cost_usd
    FROM llm_requests
    WHERE ${EMBEDDING_ENDPOINT_MATCH}
    GROUP BY pid
    ORDER BY started DESC
  `).all();
}

module.exports = {
  EMBEDDING_ENDPOINT_MATCH,
  querySummary,
  queryByTag,
  queryTimeline,
  pickBucket,
  querySessions,
};
