/**
 * seed-demo.js — inserts realistic demo rows into llm_usage.db so the
 * dashboard can be explored without running a live meeting.
 *
 * Usage:
 *   npm run seed                 # append a demo meeting + chat session
 *   npm run seed -- --reset      # wipe the DB first, then seed
 *   LLM_USAGE_DB=/tmp/x.db npm run seed
 *
 * The generated data mimics real shapes: one gateway sidecar pid running a
 * ~75-minute meeting (up to 6 agent calls per chunk + final summary) and one
 * chatbot sidecar pid answering a handful of RAG questions, including a few
 * failures (429 / timeout) so error paths are visible in the UI.
 */

const path = require('path');
const Database = require('better-sqlite3');
const { SCHEMA, costOf } = require('../lib/schema.js');

const DB_PATH = process.env.LLM_USAGE_DB || path.join(__dirname, '..', '..', 'gateway', 'llm_usage.db');
const MODEL = 'gpt-5.6-luna';
const ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const RESET = process.argv.includes('--reset');
const NO_PAYLOADS = process.argv.includes('--no-payloads');

// Per-tag shape: [promptTokensBase, completionTokensBase, latencyMsBase]
const PROFILES = {
  context_manager: [780, 120, 900],
  explanation: [460, 90, 1400],
  technical: [520, 130, 2600],
  analyst: [710, 150, 2400],
  risk: [660, 110, 2100],
  response: [560, 80, 1700],
  summary: [3600, 850, 7200],
  analyze_query: [340, 60, 800],
  grade_documents: [820, 45, 950],
  rewrite_query: [310, 50, 750],
  clarify: [610, 90, 1200],
  generate: [1500, 320, 2900],
};

const SYSTEM_PROMPTS = {
  context_manager: 'You are the context manager of a live meeting. Track the topic, keep a rolling summary, extract glossary terms and grade chunk significance.',
  explanation: 'You translate technical discussion into plain language for non-technical listeners.',
  technical: 'You provide precise, detailed technical explanations for engineers.',
  analyst: 'You extract decisions and action items (assignee + deadline) from meeting dialogue. Respond in JSON.',
  risk: 'You detect risks, blockers and concerns with category and severity. Respond in JSON.',
  response: 'You draft a short, natural reply the participant can say in the meeting, tagged [ANSWER]/[QUESTION]/[DECISION].',
  summary: 'You are a Senior Management Consultant producing an executive meeting summary with 6 fixed sections.',
  analyze_query: 'Convert the user question into safe full-text-search keywords; flag ambiguity. Respond in JSON.',
  grade_documents: 'Grade which retrieved meeting snippets are relevant to the question. Respond in JSON.',
  rewrite_query: 'Rewrite search keywords because the previous retrieval missed. Respond in JSON.',
  clarify: 'Ask exactly ONE clarifying question, showing what you already found. Respond in JSON.',
  generate: 'Answer from the meeting evidence only, citing [M#] sources. Respond in JSON.',
};

const CHUNK_SAMPLES = [
  'Speaker 1: the payments migration is blocked because the rate limiter keeps tripping at 4k rps.\nSpeaker 2: we can shard the queue and move to backpressure, but that slips the deadline by a week.',
  'Speaker 2: on the data side, the FTS index rebuild is taking 40 minutes; we should incremental-index instead.\nSpeaker 3: agreed, lets target next sprint.',
  'Speaker 3: the client wants the risk report in the exec deck by Friday. Owner will be Priya.\nSpeaker 1: fine, deadline Thursday EOD.',
  'Speaker 1: if the STT fallback triggers mid-meeting we lose about two seconds of audio, acceptable.\nSpeaker 2: yes, but log it so we can spot a pattern.',
];

function jitter(base, spread = 0.35) {
  return Math.max(1, Math.round(base * (1 + (Math.random() * 2 - 1) * spread)));
}

function iso(msAgo) {
  return new Date(Date.now() - msAgo).toISOString();
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(SCHEMA);

if (RESET) {
  const n = db.prepare('DELETE FROM llm_requests').run().changes;
  console.log(`[seed] reset: removed ${n} existing rows`);
}

const insert = db.prepare(`
  INSERT INTO llm_requests (
    ts, source, tag, provider, endpoint, model, expect_json, max_tokens, timeout_ms,
    status, error_code, error_message, attempts, latency_ms,
    prompt_tokens, completion_tokens, total_tokens, cost_usd,
    request_messages, response_preview, pid
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

function addRow({ tsAgoMs, source, tag, expectJson, maxTokens, timeoutMs, status = 'ok',
                  errorCode = null, errorMessage = null, attempts = 1, pid, userText }) {
  const [pBase, cBase, lBase] = PROFILES[tag];
  const ok = status === 'ok';
  const promptTokens = ok ? jitter(pBase) : jitter(Math.round(pBase * 0.6));
  const completionTokens = ok ? jitter(cBase) : 0;
  const latency = ok ? jitter(lBase) : jitter(lBase * 1.6);
  const messages = NO_PAYLOADS ? null : JSON.stringify([
    { role: 'system', content: SYSTEM_PROMPTS[tag] || 'You are a meeting assistant.' },
    { role: 'user', content: userText || CHUNK_SAMPLES[Math.floor(Math.random() * CHUNK_SAMPLES.length)] },
  ]);
  const preview = ok && !NO_PAYLOADS
    ? `[demo ${tag}] ${tag === 'summary' ? '# Meeting Summary\n\n## 1. Meeting Overview\nDemo meeting covering payments migration, indexing performance and exec reporting.' : 'Demo response generated by seed-demo.js (not a real model output).'}`
    : null;
  insert.run(
    iso(tsAgoMs), source, tag, 'openai', ENDPOINT, MODEL, expectJson ? 1 : 0,
    maxTokens, timeoutMs, status, errorCode, errorMessage, attempts, latency,
    ok ? promptTokens : null, ok ? completionTokens : null,
    ok ? promptTokens + completionTokens : null,
    ok ? costOf(MODEL, promptTokens, completionTokens) : 0,
    messages, preview, pid,
  );
}

const MIN = 60 * 1000;
const GATEWAY_PID = 40000 + Math.floor(Math.random() * 999);
const CHATBOT_PID = 50000 + Math.floor(Math.random() * 999);

const seedAll = db.transaction(() => {
  // --- Simulated gateway meeting: 12 chunks across the last ~75 minutes ---
  const chunks = 12;
  for (let i = 0; i < chunks; i++) {
    const t0 = (75 - i * 6) * MIN; // minutes ago
    const chunkText = CHUNK_SAMPLES[i % CHUNK_SAMPLES.length];
    let t = t0;

    addRow({ tsAgoMs: t, source: 'gateway', tag: 'context_manager', expectJson: true,
      maxTokens: 400, timeoutMs: 8000, pid: GATEWAY_PID, userText: chunkText });
    t -= 1200;

    // One chunk hits a 429 that exhausts retries on the risk agent.
    if (i === 7) {
      addRow({ tsAgoMs: t, source: 'gateway', tag: 'risk', expectJson: true,
        maxTokens: 400, timeoutMs: 20000, status: 'failed', errorCode: '429',
        errorMessage: '429 Rate limit reached for model gpt-5.6-luna (demo failure)',
        attempts: 2, pid: GATEWAY_PID, userText: chunkText });
      t -= 2500;
    }

    for (const tag of ['explanation', 'technical', 'analyst', 'risk']) {
      if (i === 7 && tag === 'risk') continue; // recorded above as failed
      if (Math.random() < 0.12) continue;       // occasional circuit-breaker skip
      const cfg = { explanation: [false, 300, 10000], technical: [false, 400, 20000],
                    analyst: [true, 512, 20000], risk: [true, 400, 20000] }[tag];
      addRow({ tsAgoMs: t, source: 'gateway', tag, expectJson: cfg[0],
        maxTokens: cfg[1], timeoutMs: cfg[2], pid: GATEWAY_PID, userText: chunkText });
      t -= 400;
    }

    if (Math.random() < 0.85) {
      addRow({ tsAgoMs: t, source: 'gateway', tag: 'response', expectJson: false,
        maxTokens: 300, timeoutMs: 15000, pid: GATEWAY_PID, userText: chunkText });
    }
  }
  // End-of-meeting executive summary.
  addRow({ tsAgoMs: 2 * MIN, source: 'gateway', tag: 'summary', expectJson: false,
    maxTokens: 1024, timeoutMs: 30000, pid: GATEWAY_PID,
    userText: 'Generate a polished executive summary of the full meeting history.' });

  // --- Simulated chatbot session: 5 questions in the last ~20 minutes ---
  const questions = [
    'What did we decide about the payments migration?',
    'Who owns the risk report for Friday?',
    'Why is the FTS index rebuild slow?',
    'What happens when the STT provider fails over?',
    'Summarize the deadlines mentioned this week',
  ];
  questions.forEach((q, i) => {
    const t0 = (20 - i * 4) * MIN;
    let t = t0;
    addRow({ tsAgoMs: t, source: 'chatbot', tag: 'analyze_query', expectJson: true,
      maxTokens: 400, timeoutMs: 30000, pid: CHATBOT_PID, userText: `User question: ${q}` });
    t -= 900;
    addRow({ tsAgoMs: t, source: 'chatbot', tag: 'grade_documents', expectJson: true,
      maxTokens: 300, timeoutMs: 30000, pid: CHATBOT_PID, userText: `Question: ${q}\n\nCandidates: [M1] … [M4]` });
    t -= 800;

    if (i === 2) {
      // One question needed a corrective rewrite loop.
      addRow({ tsAgoMs: t, source: 'chatbot', tag: 'rewrite_query', expectJson: true,
        maxTokens: 300, timeoutMs: 30000, pid: CHATBOT_PID, userText: `Question: ${q}\nKeywords already tried: fts | rebuild` });
      t -= 700;
    }
    if (i === 4) {
      // One ambiguous question → clarify path, plus a timeout failure on generate.
      addRow({ tsAgoMs: t, source: 'chatbot', tag: 'clarify', expectJson: true,
        maxTokens: 500, timeoutMs: 30000, pid: CHATBOT_PID, userText: `User question: ${q}` });
    } else if (i === 3) {
      addRow({ tsAgoMs: t, source: 'chatbot', tag: 'generate', expectJson: true,
        maxTokens: 1200, timeoutMs: 30000, status: 'failed', errorCode: 'network',
        errorMessage: 'LLM call timed out after 30000ms (demo failure)', attempts: 3,
        pid: CHATBOT_PID, userText: `Question: ${q}` });
    } else {
      addRow({ tsAgoMs: t, source: 'chatbot', tag: 'generate', expectJson: true,
        maxTokens: 1200, timeoutMs: 30000, pid: CHATBOT_PID, userText: `Question: ${q}` });
    }
  });
});

seedAll();

const totals = db.prepare(`
  SELECT COUNT(*) AS rows, COALESCE(SUM(total_tokens),0) AS tokens, COALESCE(SUM(cost_usd),0) AS cost
  FROM llm_requests
`).get();
console.log(`[seed] done → ${DB_PATH}`);
console.log(`[seed] demo pids: gateway=${GATEWAY_PID} chatbot=${CHATBOT_PID}`);
console.log(`[seed] DB totals: ${totals.rows} rows, ${totals.tokens} tokens, $${totals.cost.toFixed(6)}`);
console.log('[seed] now run: npm start  →  http://localhost:3300');
db.close();

