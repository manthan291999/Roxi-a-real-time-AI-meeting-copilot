/**
 * LLM Usage Dashboard — read-only developer server.
 *
 * Serves the single-page UI (public/) plus a small REST API over the shared
 * usage DB written by:
 *   - gateway/infrastructure/usage-store.js      (capture pipeline)
 *   - chatbot/src/infrastructure/usage/UsageRecorder.js (chatbot)
 *
 * The DB is opened READ-ONLY; the dashboard never writes usage data.
 * If the DB file does not exist yet, every endpoint degrades to an empty
 * shape so the UI can render a helpful "no data" state.
 *
 * Run:  npm install && npm start   →  http://localhost:3300
 * Env:  DASHBOARD_PORT (default 3300), LLM_USAGE_DB (default ../gateway/llm_usage.db)
 */

const path = require('path');
const fs = require('fs');
const express = require('express');
const Database = require('better-sqlite3');
const { MODEL_PRICES, costOf } = require('./lib/schema.js');

const PORT = parseInt(process.env.DASHBOARD_PORT || '3300', 10);
const DB_PATH = process.env.LLM_USAGE_DB || path.join(__dirname, '..', 'gateway', 'llm_usage.db');
const CODEMAP_PATH = path.join(__dirname, 'codemap.json');

let db = null;
let dbError = null;

function openDb() {
  if (db) return true;
  if (!fs.existsSync(DB_PATH)) {
    dbError = `Usage DB not found at ${DB_PATH}. Run a meeting (or: npm run seed) first.`;
    return false;
  }
  try {
    db = new Database(DB_PATH, { readonly: true });
    db.pragma('busy_timeout = 3000');
    dbError = null;
    return true;
  } catch (err) {
    dbError = `Could not open usage DB: ${err.message}`;
    return false;
  }
}

/** Run a query fn when the DB is available; otherwise return fallback. */
function withDb(fallback, fn) {
  if (!openDb()) return fallback;
  try {
    return fn(db);
  } catch (err) {
    return { error: err.message, fallback };
  }
}

const app = express();
app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public')));

// --- Health -----------------------------------------------------------------

app.get('/api/health', (req, res) => {
  res.json({ dbPath: DB_PATH, dbAvailable: openDb(), dbError, modelPrices: MODEL_PRICES });
});

// --- Summary ----------------------------------------------------------------

app.get('/api/summary', (req, res) => {
  const empty = {
    dbAvailable: false, requests: 0, ok: 0, failed: 0,
    prompt_tokens: 0, completion_tokens: 0, total_tokens: 0,
    cost_usd: 0, avg_latency_ms: null, p95_latency_ms: null,
    first_ts: null, last_ts: null,
  };
  const out = withDb(empty, (d) => {
    const row = d.prepare(`
      SELECT COUNT(*) AS requests,
             SUM(status = 'ok') AS ok,
             SUM(status = 'failed') AS failed,
             COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
             COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
             COALESCE(SUM(total_tokens), 0) AS total_tokens,
             COALESCE(SUM(cost_usd), 0) AS cost_usd,
             AVG(CASE WHEN status = 'ok' THEN latency_ms END) AS avg_latency_ms,
             MIN(ts) AS first_ts, MAX(ts) AS last_ts
      FROM llm_requests
    `).get();

    // p95 latency (fine at dev scale: pull ordered latencies, pick index).
    const lat = d.prepare(
      "SELECT latency_ms FROM llm_requests WHERE status = 'ok' AND latency_ms IS NOT NULL ORDER BY latency_ms"
    ).raw(true).all();
    const p95 = lat.length ? lat[Math.min(lat.length - 1, Math.floor(lat.length * 0.95))][0] : null;

    // Read-time cost fallback for rows recorded without pricing.
    let cost = row.cost_usd || 0;
    if (!cost && row.total_tokens > 0) {
      const perModel = d.prepare(`
        SELECT model, COALESCE(SUM(prompt_tokens),0) tin, COALESCE(SUM(completion_tokens),0) tout
        FROM llm_requests WHERE status = 'ok' GROUP BY model
      `).all();
      cost = perModel.reduce((sum, m) => sum + costOf(m.model, m.tin, m.tout), 0);
    }

    return {
      dbAvailable: true,
      requests: row.requests, ok: row.ok || 0, failed: row.failed || 0,
      prompt_tokens: row.prompt_tokens, completion_tokens: row.completion_tokens,
      total_tokens: row.total_tokens, cost_usd: cost,
      avg_latency_ms: row.avg_latency_ms != null ? Math.round(row.avg_latency_ms) : null,
      p95_latency_ms: p95,
      first_ts: row.first_ts, last_ts: row.last_ts,
    };
  });
  res.json(out);
});

// --- Request list (filterable, paginated) ------------------------------------

app.get('/api/requests', (req, res) => {
  const { source, tag, model, status, from, to } = req.query;
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  const where = [];
  const params = {};
  if (source) { where.push('source = @source'); params.source = source; }
  if (tag) { where.push('tag = @tag'); params.tag = tag; }
  if (model) { where.push('model = @model'); params.model = model; }
  if (status) { where.push('status = @status'); params.status = status; }
  if (from) { where.push('ts >= @from'); params.from = from; }
  if (to) { where.push('ts <= @to'); params.to = to; }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const out = withDb({ dbAvailable: false, total: 0, rows: [] }, (d) => {
    const total = d.prepare(`SELECT COUNT(*) c FROM llm_requests ${whereSql}`).get(params).c;
    const rows = d.prepare(`
      SELECT id, ts, source, tag, provider, model, status, error_code, attempts,
             latency_ms, prompt_tokens, completion_tokens, total_tokens, cost_usd
      FROM llm_requests ${whereSql}
      ORDER BY id DESC
      LIMIT @limit OFFSET @offset
    `).all({ ...params, limit, offset });
    return { dbAvailable: true, total, rows };
  });
  res.json(out);
});

// --- Single request detail ----------------------------------------------------

app.get('/api/requests/:id', (req, res) => {
  const out = withDb({ dbAvailable: false, error: 'no db' }, (d) => {
    const row = d.prepare('SELECT * FROM llm_requests WHERE id = ?').get(req.params.id);
    if (!row) return { dbAvailable: true, error: 'not found' };

    let messages = null;
    if (row.request_messages) {
      try { messages = JSON.parse(row.request_messages); }
      catch (_) { messages = row.request_messages; } // truncated JSON → raw text
    }
    return { dbAvailable: true, request: { ...row, parsed_messages: messages } };
  });
  res.json(out);
});

// --- Per-agent rollup ----------------------------------------------------------

app.get('/api/by-agent', (req, res) => {
  const out = withDb({ dbAvailable: false, rows: [] }, (d) => ({
    dbAvailable: true,
    rows: d.prepare(`
      SELECT source, COALESCE(tag, '(untagged)') AS tag,
             COUNT(*) AS calls,
             SUM(status = 'ok') AS ok,
             SUM(status = 'failed') AS failed,
             COALESCE(SUM(prompt_tokens), 0) AS tokens_in,
             COALESCE(SUM(completion_tokens), 0) AS tokens_out,
             COALESCE(SUM(cost_usd), 0) AS cost_usd,
             AVG(CASE WHEN status = 'ok' THEN latency_ms END) AS avg_latency_ms
      FROM llm_requests
      GROUP BY source, tag
      ORDER BY calls DESC
    `).all(),
  }));
  res.json(out);
});

// --- Timeline (tokens / cost / calls per bucket) -------------------------------

app.get('/api/timeline', (req, res) => {
  const out = withDb({ dbAvailable: false, bucket: 'minute', rows: [] }, (d) => {
    // Auto bucket: minute granularity, hourly once the range exceeds 6 hours.
    let bucket = req.query.bucket;
    if (!bucket || bucket === 'auto') {
      const range = d.prepare('SELECT MIN(ts) a, MAX(ts) b FROM llm_requests').get();
      const spanMs = range.a && range.b ? Date.parse(range.b) - Date.parse(range.a) : 0;
      bucket = spanMs > 6 * 3600 * 1000 ? 'hour' : 'minute';
    }
    const fmt = bucket === 'hour' ? '%Y-%m-%d %H:00' : '%Y-%m-%d %H:%M';
    const rows = d.prepare(`
      SELECT strftime('${fmt}', ts) AS bucket,
             COUNT(*) AS requests,
             COALESCE(SUM(prompt_tokens), 0) AS tokens_in,
             COALESCE(SUM(completion_tokens), 0) AS tokens_out,
             COALESCE(SUM(cost_usd), 0) AS cost_usd,
             AVG(CASE WHEN status = 'ok' THEN latency_ms END) AS avg_latency_ms
      FROM llm_requests
      GROUP BY bucket
      ORDER BY bucket
    `).all();
    return { dbAvailable: true, bucket, rows };
  });
  res.json(out);
});

// --- Sessions (one sidecar process = one session) -------------------------------

app.get('/api/sessions', (req, res) => {
  const out = withDb({ dbAvailable: false, rows: [] }, (d) => ({
    dbAvailable: true,
    rows: d.prepare(`
      SELECT pid, GROUP_CONCAT(DISTINCT source) AS sources,
             MIN(ts) AS started, MAX(ts) AS last_seen,
             COUNT(*) AS requests,
             SUM(status = 'failed') AS failed,
             COALESCE(SUM(total_tokens), 0) AS total_tokens,
             COALESCE(SUM(cost_usd), 0) AS cost_usd
      FROM llm_requests
      GROUP BY pid
      ORDER BY started DESC
    `).all(),
  }));
  res.json(out);
});

// --- Latency histogram -----------------------------------------------------------

app.get('/api/latency-histogram', (req, res) => {
  const ORDER = ['<0.5s', '0.5-1s', '1-2s', '2-5s', '5-10s', '10s+'];
  const out = withDb({ dbAvailable: false, rows: [] }, (d) => {
    const rows = d.prepare(`
      SELECT CASE
        WHEN latency_ms < 500 THEN '<0.5s'
        WHEN latency_ms < 1000 THEN '0.5-1s'
        WHEN latency_ms < 2000 THEN '1-2s'
        WHEN latency_ms < 5000 THEN '2-5s'
        WHEN latency_ms < 10000 THEN '5-10s'
        ELSE '10s+' END AS bucket,
        COUNT(*) AS calls
      FROM llm_requests
      WHERE status = 'ok' AND latency_ms IS NOT NULL
      GROUP BY bucket
    `).all();
    const byBucket = Object.fromEntries(rows.map((r) => [r.bucket, r.calls]));
    return { dbAvailable: true, rows: ORDER.map((b) => ({ bucket: b, calls: byBucket[b] || 0 })) };
  });
  res.json(out);
});

// --- Code map (static, authored from the codebase audit) --------------------------

app.get('/api/codemap', (req, res) => {
  try {
    const codemap = JSON.parse(fs.readFileSync(CODEMAP_PATH, 'utf8'));
    res.json({ dbAvailable: openDb(), ...codemap, pricing: MODEL_PRICES });
  } catch (err) {
    res.status(500).json({ error: `codemap.json unreadable: ${err.message}` });
  }
});

// --- Boot ------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`[dashboard] LLM usage dashboard on http://localhost:${PORT}`);
  console.log(`[dashboard] usage DB: ${DB_PATH} (${openDb() ? 'available' : `not available — ${dbError}`})`);
});

