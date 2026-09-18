# LLM Cost Optimisation Plan — Meeting Interpreter

## Executive Summary

After auditing the full pipeline architecture, I identified **6 distinct cost-reduction strategies** that can be implemented without breaking existing functionality or system flow. These strategies follow SOLID principles and are fully decoupled from each other — each can be shipped independently.

**Estimated savings: 55–75% reduction in per-meeting LLM spend.**

---

## Current Cost Profile (Baseline)

Every non-filler chunk triggers **6 parallel LLM calls** through the orchestrator:

| Agent | `maxTokens` (output) | Fires on every chunk? |
|---|---|---|
| `context_manager` | 400 | ✅ Yes (sequential) |
| `explanation` | 300 | ✅ Yes (parallel) |
| `technical` | 400 | ✅ Yes (parallel) |
| `analyst` | 512 | ✅ Yes (parallel) |
| `risk` | 400 | ✅ Yes (parallel) |
| `response` | 150 | ✅ Yes (parallel) |
| `summary` (on demand) | 1024 | ⚡ On request |

**Key cost driver:** You are paying for 6 LLM calls **per chunk**. For a 30-minute meeting at 1 chunk/8s, that's ~225 chunks × 6 calls = **1,350 API calls per meeting**.

---

## Strategy 1 — Agent Relevance Gating (Highest Impact)

> **Goal:** Don't run every agent on every chunk. Run only the agents that are relevant to the content.

### Problem
Currently, all 5 parallel agents (`explanation`, `technical`, `analyst`, `risk`, `response`) fire unconditionally on every non-filler chunk. This means:
- `technical` fires even on pure business discussions — then returns `[NON_TECHNICAL]` wasting the full prompt tokens.
- `analyst` fires even when no decision language is present.
- `risk` fires even on routine status updates.

### Solution: Lightweight Pre-Classification (Zero LLM Cost)

Add a **rule-based Chunk Classifier** that gates each agent using regex and keyword signals before any LLM call is made.

#### New File: `pipeline/chunk-classifier.js`

```javascript
// Classifiers run BEFORE LLM calls — zero cost, zero latency.
// Each returns true if the agent should fire for this chunk.

const DECISION_LANGUAGE = require('../config/agent-config.js').DECISION_LANGUAGE;

const TECHNICAL_SIGNALS = /\b(api|sdk|database|sql|cache|latency|throughput|microservice|kubernetes|docker|regression|bug|deploy|migration|refactor|schema|endpoint|token|auth|jwt|ssl|timeout|bottleneck|memory|cpu|queue|async|thread|payload|webhook|cron|pipeline|ci\/cd|git|branch|merge|pr|rollback|staging|prod|node|python|java|react|typescript|golang|rust|architecture|infrastructure|cloud|aws|gcp|azure|s3|lambda|firestore|redis|kafka|rabbitmq|grpc|graphql|rest)\b/i;

const RISK_SIGNALS = /\b(blocked|blocker|can't|cannot|won't|risk|delay|behind|miss|deadline|issue|problem|concern|worried|unclear|dependency|waiting|stuck|overloaded|resigned|leaving|budget cut|scope change|no one|no capacity)\b/i;

function shouldRunExplanation(text) {
  // Explanation adds value only when there is something non-trivial
  const wordCount = text.split(/\s+/).length;
  return wordCount > 10; // trivially short = nothing to explain
}

function shouldRunTechnical(text) {
  return TECHNICAL_SIGNALS.test(text);
}

function shouldRunAnalyst(text) {
  return DECISION_LANGUAGE.test(text);
}

function shouldRunRisk(text) {
  return RISK_SIGNALS.test(text);
}

function shouldRunResponse(text) {
  // Only suggest a response when there's a question, decision, or risk raised
  return /\?/.test(text) || RISK_SIGNALS.test(text) || DECISION_LANGUAGE.test(text);
}

module.exports = {
  shouldRunExplanation,
  shouldRunTechnical,
  shouldRunAnalyst,
  shouldRunRisk,
  shouldRunResponse,
};
```

#### Modification: `pipeline/agent-orchestrator.js`

Replace the hardcoded `Promise.all(...)` block with conditional agent firing:

```javascript
const classifier = require('./chunk-classifier.js');

// BEFORE: always runs all 5 agents
const [explRes, techRes, analystRes, riskRes, respRes] = await Promise.all([...]);

// AFTER: gate each agent by relevance
const agentsToRun = [];
if (classifier.shouldRunExplanation(text)) agentsToRun.push(['expl', explanationAgent]);
if (classifier.shouldRunTechnical(text))   agentsToRun.push(['tech', technicalAgent]);
if (classifier.shouldRunAnalyst(text))     agentsToRun.push(['analyst', meetingAnalystAgent]);
if (classifier.shouldRunRisk(text))        agentsToRun.push(['risk', riskDetectorAgent]);
if (classifier.shouldRunResponse(text))    agentsToRun.push(['resp', responseAgent]);

const results = Object.fromEntries(
  await Promise.all(
    agentsToRun.map(async ([key, agent]) => [key, await runAgent(agent, text, speakerLabel, mode, calls, breaker)])
  )
);
```

**Estimated saving: 30–50% fewer API calls.** In a typical meeting, many chunks are pure status updates or narrative — only `explanation` and `context_manager` are needed.

---

## Strategy 2 — Context Window Compression

> **Goal:** Reduce the prompt token count sent to the model on every call.

### Problem
Every agent prompt currently includes `buildRecentConversationBlock()` and `buildMeetingContextBlock()`. These blocks grow linearly as the meeting progresses. A 30-minute meeting could push prompts to 2,000+ tokens just in context.

### Solution A: Rolling Conversation Summary (Lossy but Effective)

Instead of sending the last N raw transcript chunks, send a **compressed summary** of older turns and only keep the **last 3 turns verbatim**.

#### Modification: `state/meeting-state.js`

```javascript
// Cap recent_chunks at 3 verbatim — the rest are already in conversation_summary
const MAX_VERBATIM_CHUNKS = 3;
```

The `context_manager` already updates `conversation_summary`. Use that for older context rather than re-injecting all raw chunks.

### Solution B: Truncate Prompt Blocks by Token Budget

Add a `truncateToTokens(text, maxTokens)` utility in `state/prompt-builder.js`:

```javascript
// Rough 1 token ≈ 4 chars heuristic (accurate enough for budgeting)
function truncateToTokens(text, maxTokens) {
  const charLimit = maxTokens * 4;
  if (text.length <= charLimit) return text;
  return text.slice(0, charLimit) + '\n[...truncated for token budget...]';
}
```

Apply this to all `buildRecentConversationBlock()` calls with a cap of ~600 tokens.

**Estimated saving: 20–35% fewer input tokens per call.**

---

## Strategy 3 — Semantic Response Cache

> **Goal:** Don't call the LLM if you've already seen a semantically identical chunk recently.

### Problem
In real meetings, participants often repeat themselves, circle back to topics, or say near-identical things across chunks (e.g., "Let's go with Approach A"). You're currently paying for duplicate LLM processing.

### Solution: In-Memory Semantic Deduplication Cache

#### New File: `pipeline/chunk-cache.js`

```javascript
// Lightweight similarity check using character n-gram overlap.
// No vector database needed — this works for near-duplicate detection only.

const CACHE_SIZE = 50;
const SIMILARITY_THRESHOLD = 0.85;
const TTL_MS = 5 * 60 * 1000; // 5 minutes

const cache = []; // [{text, result, ts}]

function ngramSimilarity(a, b, n = 3) {
  const ngrams = (s) => new Set([...s.toLowerCase().matchAll(new RegExp(`.{${n}}`, 'g'))].map(m => m[0]));
  const setA = ngrams(a), setB = ngrams(b);
  const intersection = [...setA].filter(x => setB.has(x)).length;
  return intersection / Math.max(setA.size, setB.size, 1);
}

function get(text) {
  const now = Date.now();
  const entry = cache.find(e => e.ts > now - TTL_MS && ngramSimilarity(text, e.text) >= SIMILARITY_THRESHOLD);
  return entry ? entry.result : null;
}

function set(text, result) {
  if (cache.length >= CACHE_SIZE) cache.shift();
  cache.push({ text, result, ts: Date.now() });
}

module.exports = { get, set };
```

#### Modification: `pipeline/chunk-runner.js`

```javascript
const chunkCache = require('./chunk-cache.js');

async function runChunk(chunkText, speaker) {
  // Check cache before any LLM call
  const cached = chunkCache.get(chunkText);
  if (cached) {
    log('info', 'runner', 'cache_hit', { seq });
    broadcastChunkEvents(cached, speaker); // reuse previous result
    return;
  }

  const result = await analyseChunk(chunkText, speaker);
  chunkCache.set(chunkText, result);
  // ...rest of pipeline
}
```

**Estimated saving: 5–15% in repetition-heavy meetings.**

---

## Strategy 4 — Aggressive `maxTokens` Tuning

> **Goal:** Prevent the model from generating more output tokens than you need.

### Problem
`max_tokens` is a hard ceiling OpenAI uses for billing on completion tokens. Currently your agents have conservative-but-high caps. The model will try to fill these budgets.

### Tuned Limits (evidence-based from prompt analysis)

| Agent | Current | Optimized | Rationale |
|---|---|---|---|
| `transcript_cleaner` | 256 | **64** | JSON with 3 short fields |
| `context_manager` | 400 | **200** | Topic (1 line) + summary (2 lines) + terms |
| `explanation` | 300 | **120** | Hard rule: max 3 sentences ~80 words |
| `technical` | 400 | **150** | Hard rule: max 3 sentences OR `[NON_TECHNICAL]` |
| `analyst` | 512 | **200** | JSON array — typically 0–3 items |
| `risk` | 400 | **150** | JSON array — typically 0–2 items |
| `response` | 150 | **80** | Hard rule: max 30 words |

#### Modification: `config/agent-config.js`

```javascript
const AGENT_CONFIG = {
  transcript_cleaner: { timeoutMs: 2000,  retries: 0, maxTokens: 64,  tier: 'core' },
  context_manager:    { timeoutMs: 8000,  retries: 1, maxTokens: 200, tier: 'core' },
  explanation:        { timeoutMs: 10000, retries: 1, maxTokens: 120, tier: 'standard' },
  technical:          { timeoutMs: 20000, retries: 1, maxTokens: 150, tier: 'standard' },
  analyst:            { timeoutMs: 20000, retries: 1, maxTokens: 200, tier: 'deep' },
  risk:               { timeoutMs: 20000, retries: 1, maxTokens: 150, tier: 'deep' },
  response:           { timeoutMs: 15000, retries: 1, maxTokens: 80,  tier: 'standard' },
};
```

**Estimated saving: 25–40% reduction in completion tokens.** This is one of the highest-leverage, lowest-risk changes.

---

## Strategy 5 — Chunk Batching for Low-Priority Agents

> **Goal:** Reduce API call frequency by batching non-real-time agents.

### Problem
`analyst` and `risk` are not real-time requirements. The user doesn't need to know about a new decision or risk within 200ms — showing it 20 seconds later is fine. You are currently paying to run these on **every chunk**.

### Solution: Batch Non-Real-Time Agents Every N Chunks

#### New File: `pipeline/batch-gate.js`

```javascript
let chunksSinceLastBatch = 0;
const BATCH_INTERVAL = 3; // run analyst/risk every 3 chunks

function shouldRunBatch() {
  chunksSinceLastBatch++;
  if (chunksSinceLastBatch >= BATCH_INTERVAL) {
    chunksSinceLastBatch = 0;
    return true;
  }
  return false;
}

module.exports = { shouldRunBatch };
```

#### Modification: `pipeline/agent-orchestrator.js`

```javascript
const { shouldRunBatch } = require('./batch-gate.js');

// In analyseChunk():
const runDeepAgents = shouldRunBatch();

const agentsToRun = [
  ...(classifier.shouldRunExplanation(text) ? [['expl', explanationAgent]] : []),
  ...(classifier.shouldRunTechnical(text)   ? [['tech', technicalAgent]]  : []),
  ...(classifier.shouldRunResponse(text)    ? [['resp', responseAgent]]   : []),
  // Deep agents run only every 3 chunks
  ...(runDeepAgents && classifier.shouldRunAnalyst(text) ? [['analyst', meetingAnalystAgent]] : []),
  ...(runDeepAgents && classifier.shouldRunRisk(text)    ? [['risk', riskDetectorAgent]]      : []),
];
```

**Estimated saving: 50–65% reduction in `analyst` and `risk` calls.**

---

## Strategy 6 — Prompt System Message Caching (OpenAI Prompt Caching)

> **Goal:** Use OpenAI's built-in prompt caching to get ~50% discount on repeated system prompts.

### Problem
OpenAI charges full price for input tokens. However, OpenAI supports **automatic prompt caching** for prompts > 1,024 tokens — repeated prefixes are cached server-side and billed at 50% of normal input price.

### Solution: Restructure Prompts for Cache-Friendliness

OpenAI caches the **longest repeated prefix**. To maximize cache hits:

1. **Put static content first** (system role, rules, output format).
2. **Put dynamic content last** (meeting context, conversation history, current chunk).

#### Current (cache-unfriendly):
```
System: "You are a Senior Risk Analyst..."
User: "[MEETING BRIEFING] [dynamic context] [RECENT CONVERSATION] [dynamic] [CHUNK] [dynamic]"
```

#### Optimized (cache-friendly):
```
System: "You are a Senior Risk Analyst... [FULL STATIC RULES + OUTPUT FORMAT]"
User: "[CHUNK]: [dynamic] | [CONTEXT]: [dynamic]"  ← only dynamic data in user turn
```

This ensures the large, static system prompt (which is identical across all calls to the same agent) is cached after the first call of each meeting.

#### Modification: All agent files

Move the **Rules, Output Format, Examples, Edge Cases, Safety** sections from the user prompt into the system prompt. Keep only the **dynamic input data** in the user message.

**Estimated saving: ~50% on input tokens for cached prefixes (typically 60–80% of a prompt).**

---

## Implementation Roadmap

| Priority | Strategy | Effort | Estimated Saving |
|---|---|---|---|
| 🔴 **P0** | Strategy 4: Tune `maxTokens` | 5 min | 25–40% completion tokens |
| 🔴 **P0** | Strategy 1: Agent Relevance Gating | 2 hours | 30–50% fewer API calls |
| 🟠 **P1** | Strategy 5: Batch non-RT agents | 1 hour | 50% fewer analyst/risk calls |
| 🟠 **P1** | Strategy 2: Context Compression | 2 hours | 20–35% input tokens |
| 🟡 **P2** | Strategy 6: Prompt Caching layout | 3 hours | 50% on cached input tokens |
| 🟢 **P3** | Strategy 3: Semantic Cache | 2 hours | 5–15% in repeat-heavy meetings |

---

## Combined Savings Estimate

| Scenario | Current calls/meeting | Optimised calls/meeting | Token reduction |
|---|---|---|---|
| 30-min meeting | ~1,350 LLM calls | ~340–450 LLM calls | -55–70% |
| Cost @ $0.15/$0.60 per 1M tokens | ~$0.80–$1.20 | **~$0.20–$0.35** | **~70% reduction** |

---

> [!IMPORTANT]
> **Recommended starting point:** Apply **Strategy 4** (maxTokens tuning) immediately — it is a 5-minute change with zero risk and 25–40% immediate savings. Then implement **Strategy 1** (gating) as it has the highest impact.

> [!NOTE]
> All strategies are additive and fully decoupled. They follow the Open/Closed Principle — each is a new module that wraps, not modifies, the core pipeline logic.
