# Performance + Scalability Audit — Roxi (meeting-interpreter-mac)

**Date:** 2026-09-05
**Scope:** Full repository, read-only
**Branch:** `main` @ `66c6b1f`
**Status:** PHASE 1 COMPLETE — no files or code were modified during the audit

**Measured evidence base:**
- `gateway/llm_usage.db` — 471 LLM calls, 2026-08-31 → 2026-09-04
- `gateway/meeting_history.db` — 51 meetings / 424 transcripts, with `EXPLAIN QUERY PLAN` output captured

Everything not derived from those two sources is explicitly labelled `REQUIRES PROFILING`, `REQUIRES PRODUCTION DATA`, or `NOT MEASURED`.

---

## A. EXECUTIVE SUMMARY

| Dimension | Score | Basis |
|---|---|---|
| **Overall Performance** | **62 / 100** | Real optimisation work already landed (parallel stage 1, concurrency cap, `React.memo`, model tiering). Undermined by LLM calls whose output has no consumer, no timeouts, and blocking I/O on async threads. |
| **Scalability** | **55 / 100** | Single-user desktop app — the real scale axes are *meeting duration* and *history size*, and both are unbounded (transcript array, `llm_usage.db`, FTS full rebuild). |
| **Database Efficiency** | **48 / 100** | Confirmed table scans via `EXPLAIN QUERY PLAN`; a fresh SQLite connection + 7-statement schema replay per LLM call; and half the schema is dead (write path broken). |
| **API / LLM Efficiency** | **58 / 100** | Measured p50 ≈ 3.5 s / p95 ≈ 9.5 s reply latency. 25–33 % of calls produce output nothing renders. No timeout, retry, or `max_tokens`. |
| **Frontend Efficiency** | **60 / 100** | Memoisation and ref-based partials are correct. Offset by unbounded unvirtualised list, scroll-on-every-render, and tab-switch state loss. |
| **Cache Strategy** | **35 / 100** | Essentially no caching. Much of that is *correct* for this workload — but the read paths that would benefit have none. |
| **Load Readiness** | **50 / 100** | Reply path **queues** instead of shedding under overload; STT has zero retry. |
| **Observability** | **70 / 100** | Genuinely strong: per-call latency/token/cost telemetry in `llm_usage.db` + a dashboard + `PipelineTrace`. This audit's numbers come from it. Gaps: `agent_trace` has no consumer, no STT-latency or event-loop-lag metric. |

**Scoring note:** scores are relative to *this* workload — one local user, one meeting at a time — not to a hyperscale web service. Points are deducted for waste and unbounded growth, not for missing infrastructure the app does not need.

---

## B. PROJECT ARCHITECTURE

**Type:** Tauri v2 macOS desktop app. Not a web service — no server, no load balancer, no CDN, no deployment platform, no auth system.

| Layer | Detected |
|---|---|
| Frontend | React 19 + TypeScript 5.6 + Vite 6 + Tailwind 3, HashRouter |
| State management | Local hooks + two React contexts (`ServicesContext`, `ChatContext`). No Redux/Zustand. |
| Backend core | Rust (Tauri 2), hexagonal — `commands/ → application/ → ports/ ← adapters/` |
| LLM pipeline | Native Rust `agents/`, `rig-core` 0.2.1 → OpenAI |
| STT sidecar | Node — AssemblyAI primary, Speechmatics fallback, WebSocket streaming |
| Chat sidecar | Node — LangGraph Adaptive-RAG over SQLite FTS5 |
| Database | SQLite ×3: `meeting_history.db` (better-sqlite3 write / rusqlite read), `llm_usage.db`, `chat_index.db`. WAL enabled. |
| ORM / ODM | None — raw SQL with prepared statements |
| IPC | OS pipes: PCM1 binary in, line-delimited JSON out |
| External services | OpenAI (HTTPS), AssemblyAI / Speechmatics (WSS) |
| Observability | `tracing` (Rust), JSON-lines stderr (Node), `llm_usage.db` + Express dashboard |
| Auth / queues / workers / Redis / CDN / reverse proxy | **None.** Correctly so — see §I and §M. |

### Business flows traced

`start capture` · `live transcription` · `chunk analysis (LLM pipeline)` · `suggested reply` · `Ask Roxi (RAG Q&A)` · `meeting history` · `session shutdown + summary`

### Performance architecture map

```
Mic + BlackHole loopback
  └─ cpal callback (REAL-TIME THREAD) ────── BOUNDARY 1: allocs + mutex in RT callback
       └─ downmix → rubato resample 16 kHz → PCM16
            └─ unbounded mpsc ────────────── BOUNDARY 2: no backpressure
                 └─ mixer thread → StreamingSink (250 ms / 4000-sample PCM1 frames)
                      └─ blocking write to sidecar stdin pipe
                                            ── BOUNDARY 3: pipe stall blocks mixer

gateway/sidecar.js (Node, single event loop)
  └─ PcmDeframer → ProviderManager → AssemblyAI WSS
                                            ── BOUNDARY 4: zero retry
       └─ 'final' → validate → sanitize → stdout JSON + batched transcript insert (5 s)

Rust event_router (stdout reader thread)
  ├─ emit transcript_final ───────────────── fast, never blocked  [GOOD]
  └─ spawn task → PIPELINE_SEMAPHORE(3) ──── BOUNDARY 5: queues, never sheds
        └─ ChunkGraph
             Stage 0  chit_chat_gate (local, 0 LLM)  [GOOD]
             Stage 1  context_manager || explanation   p50 1164 / p95 3544 ms
             Stage 2  technical (awaited, High only)
                      risk + analyst → DETACHED lane
                                            ── BOUNDARY 6: no UI consumer
             Stage 3  response_agent (premium)        p50 2315 / p95 5985 ms
                  └─ every call → UsageStore::record
                                            ── BOUNDARY 7: blocking SQLite on async thread
             └─ emit suggest_answer

React: TauriEventBus → feature hooks → panes
                                            ── BOUNDARY 8: hidden tab = unmounted = events dropped

Ask Roxi (on demand): invoke → chat_client → chatbot/sidecar.js
  └─ FTS full rebuild on start ───────────── BOUNDARY 9
       └─ LangGraph → OpenAI (has timeout + retry + budget)  [GOOD]
```

---

## C. WHAT IS ALREADY GOOD — DO NOT REWRITE

1. **`chit_chat_gate`** (`chit_chat_gate.rs`) — pure local heuristic, zero LLM cost, exits before the pipeline. Exactly the right shape.
2. **Stage-1 concurrent join** (`chunk_graph.rs:108-112`) — `context_manager || explanation` with the explicit field-take rather than `merge_from`, plus the `debug_assert!` guarding the invariant. The comment explaining *why* merge would double-count is unusually good.
3. **Detached-lane shedding** (`event_router.rs:80`) — `try_acquire_owned` correctly *drops* stale ambient work rather than queueing it. This is the right policy; the reply path should copy it (PERF-005).
4. **`routing::decide`** — pure, no I/O, four unit tests, safe `Medium` fallback. The only tested Rust module, and the right one to test.
5. **`React.memo` on `TranscriptLine` and `SuggestCard`**, and **partials stored in a ref with a tick counter** (`useTranscript.ts:16-23`) — both are correct fixes to real problems.
6. **Transcript batch flush** (`db/index.js:160-175`) — 5 s window, single transaction, prepared statements cached at init. Correct for the high-volume path.
7. **`chatbot/src/infrastructure/llm/OpenAiLlmGateway.js`** — timeout via `AbortSignal.timeout`, retry with exponential backoff, retryable-status allowlist, budget guard, `max_completion_tokens`. **This is the reference implementation the Rust adapter should be measured against.**
8. **`ProviderManager` ring buffer** — 5 s replay on switchover, cleared on each final so a switch cannot duplicate speech. Well reasoned.
9. **WAL + `busy_timeout` everywhere**, and the chatbot's read-only open of the meeting DB — the multi-process SQLite story is correct.
10. **PCM1 framing over pipes** — process isolation, no network stack, magic-byte resync. Do not turn this into a socket.
11. **Forward-only migrations** with per-migration transactions.

---

## D. CRITICAL FINDINGS

| ID | Sev | Area | Finding | Evidence | Production Impact | Mandatory? |
|---|---|---|---|---|---|---|
| PERF-001 | **P1** | LLM waste | `risk`/`analyst` detached lane has **no UI consumer** — `useAnalysis`/`AnalysisPane` are never mounted | CONFIRMED | 25 % of calls on Medium, 33 % on High are pure cost + tokens for nothing | **MANDATORY NOW** |
| PERF-002 | **P1** | Reliability | No timeout, no retry, no `max_tokens` on any Rust LLM call | CONFIRMED | One hung request holds a semaphore permit forever → pipeline degrades to 2 lanes, then 1, then stalls | **MANDATORY NOW** |
| PERF-003 | **P1** | DB / async | `UsageStore::record` opens a new connection + replays the 7-statement schema, **synchronously on a tokio worker**, per LLM call | CONFIRMED | Blocks an async worker per call; ~4 calls/chunk at up to 41 calls/min measured | **MANDATORY NOW** |
| PERF-004 | **P1** | Frontend | Tab switch unmounts `SuggestAnswersPane` / `TranscriptPane` → **all state lost, events dropped while hidden** | CONFIRMED | User switches to Ask and back: every suggestion and the whole transcript are gone, permanently | **MANDATORY NOW** |
| PERF-005 | **P1** | Backpressure | Reply-path semaphore **queues** instead of shedding | CONFIRMED | Sustained fast speech → unbounded queue → suggestions arrive for speech from minutes ago | **MANDATORY NOW** |
| PERF-006 | **P1** | DB index | `transcripts` has no index on `meeting_id` → `SCAN transcripts` + `USE TEMP B-TREE FOR ORDER BY` | CONFIRMED (query plan) | Highest-volume table; history detail degrades linearly with total transcripts across *all* meetings | **MANDATORY NOW** |
| PERF-007 | **P1** | Data loss | Analysis write path is **dead** since the Rust migration | CONFIRMED (`chunks`, `decisions`, `action_items`, `risks`, `speaker_profiles` all = **0 rows** across 51 meetings) | History and Ask Roxi permanently blind to decisions/risks/actions | **MANDATORY NOW** (correctness) |
| PERF-008 | **P1** | Reliability | STT `retryPolicy` is never set → `maxRetries: 0` → **one** connect attempt; last-provider reconnect also gets one | CONFIRMED (`sidecar.js:60-65` vs `provider-manager.js:128`) | A single transient WebSocket close ends the meeting | **MANDATORY NOW** |

### Full finding index

| ID | Sev | Evidence | Label | Title |
|---|---|---|---|---|
| PERF-001 | P1 | CONFIRMED | MANDATORY NOW | Detached risk/analyst lane has no UI consumer |
| PERF-002 | P1 | CONFIRMED | MANDATORY NOW | No timeout / retry / `max_tokens` on Rust LLM calls |
| PERF-003 | P1 | CONFIRMED | MANDATORY NOW | Blocking SQLite + schema replay per LLM call |
| PERF-004 | P1 | CONFIRMED | MANDATORY NOW | Tab switch destroys suggestions and transcript |
| PERF-005 | P1 | CONFIRMED | RECOMMENDED | Reply path queues instead of shedding |
| PERF-006 | P1 | CONFIRMED | MANDATORY NOW | `transcripts` missing `(meeting_id, timestamp)` index |
| PERF-007 | P1 | CONFIRMED | MANDATORY NOW | Analysis write path dead since Rust migration |
| PERF-008 | P1 | CONFIRMED | MANDATORY NOW | STT has zero retry / reconnect policy |
| PERF-009 | P2 | CONFIRMED | RECOMMENDED | `context_manager` generates unread fields |
| PERF-010 | P2 | CONFIRMED | RECOMMENDED | `scrollIntoView` fires on every render |
| PERF-011 | P2 | CONFIRMED | OPTIONAL AT SCALE | Transcript list unbounded and unvirtualised |
| PERF-012 | P2 | CONFIRMED | OPTIONAL AT SCALE | Unbounded mpsc + blocking pipe write, no backpressure |
| PERF-013 | P2 | CONFIRMED | RECOMMENDED | Allocations + mutex + redundant clone in RT audio callback |
| PERF-014 | P2 | CONFIRMED | OPTIONAL AT SCALE | `llm_usage.db` grows ~1.2 KB/call with no retention |
| PERF-015 | P2 | HIGH CONFIDENCE | OPTIONAL AT SCALE | FTS index full rebuild, synchronous, on chatbot startup |
| PERF-016 | P2 | CONFIRMED | OPTIONAL AT SCALE | Chat history sent in full *and* kept in `MemorySaver` |
| PERF-017 | P2 | CONFIRMED | OPTIONAL AT SCALE | `get_meetings` / `get_meeting_details` unbounded, conn per invoke |
| PERF-018 | P3 | CONFIRMED | OPTIONAL AT SCALE | `ChatProvider` context value identity churn |
| PERF-019 | P3 | CONFIRMED | RECOMMENDED | No `[profile.release]` in `Cargo.toml` |
| PERF-020 | P3 | CONFIRMED | DO NOT CHANGE | 250 ms PCM chunk = fixed pre-STT latency floor |
| PERF-021 | P3 | CONFIRMED | OPTIONAL AT SCALE | Dashboard full-scan endpoints, no time filter |
| PERF-022 | P3 | CONFIRMED | RECOMMENDED | Progress log fires ~10× per 10 s boundary |
| PERF-023 | P4 | CONFIRMED | OPTIONAL AT SCALE | `getMeetingDetails` id type mismatch (string vs i64) |
| PERF-024 | P4 | CONFIRMED | OPTIONAL AT SCALE | MFCC diarization inert — `pushAudio` never called |

---

## E. DATABASE FINDINGS

### E.1 Missing indexes — PERF-006 (CONFIRMED, query plans captured)

```
EXPLAIN QUERY PLAN
  SELECT speaker,text,timestamp FROM transcripts WHERE meeting_id=1 ORDER BY timestamp ASC
→ SCAN transcripts
→ USE TEMP B-TREE FOR ORDER BY

EXPLAIN QUERY PLAN
  SELECT id,start_time,summary FROM meetings ORDER BY start_time DESC
→ SCAN meetings
→ USE TEMP B-TREE FOR ORDER BY
```

| Table | Query it serves | Proposed index | Read benefit | Write cost | Verify? |
|---|---|---|---|---|---|
| `transcripts` | `sqlite.rs:83` — every history detail open | `(meeting_id, timestamp)` | **Large.** Removes both the scan *and* the temp B-tree sort | One extra B-tree per insert; inserts are already batched in a transaction → negligible | Re-run `EXPLAIN QUERY PLAN` after |
| `meetings` | `sqlite.rs:47` — `ORDER BY start_time DESC` | `(start_time DESC)` | **Small today** (51 rows), moderate at 1000+ | Negligible | Yes |
| `summaries` | chatbot `iterSourceRows`, `recentTopics` | `(meeting_id)` | Small | Negligible | Yes |
| `decisions`, `action_items`, `technical_analyses`, `suggested_replies` | `sqlite.rs:96-135` | `(meeting_id)` each | **Currently zero** — these tables have 0–60 rows because nothing writes them | — | **Do not add until PERF-007 is fixed.** Indexing dead tables is pure write cost. |

**Do NOT blanket-index.** `glossary_terms` and `speaker_profiles` already have covering composite primary keys. `chunks` (`idx_chunks_meeting`) and `risks` (`idx_risks_meeting`) already have their indexes. `speaker_embeddings` needs nothing — it is never read (PERF-024).

### E.2 Dead write path — PERF-007 (CONFIRMED)

Measured row counts across 51 meetings:

```
meetings            51
transcripts        424
suggested_replies   60   (legacy — pre-migration)
summaries           35   (legacy — pre-migration)
glossary_terms      24   (legacy — pre-migration)
chunks               0
decisions            0
action_items         0
risks                0
technical_analyses   0
speaker_profiles     0
speaker_names        0
speaker_embeddings   0
```

Only two writers remain live: `db.saveTranscript` (`sidecar.js:103`) and `db.endMeeting`. Everything else in `gateway/db/index.js` — `saveChunk`, `saveRisks`, `saveDecision`, `saveActionItem`, `saveTechnicalAnalysis`, `saveSuggestedReply`, `upsertSpeakerProfile`, `upsertGlossary`, `incrementApiCalls` — is exported and **called by nothing**. The Rust `ChunkGraph` produces these artifacts and emits them as Tauri events, but `adapters/sqlite.rs` is read-only, so they are never persisted.

Consequences:
- `buildFallbackSummary` (`shutdown.js`) produces an empty shell.
- `SqliteMeetingStore.iterSourceRows` indexes 4 empty tables out of 5.
- Ask Roxi can only ever cite raw transcript lines.
- Combined with PERF-001, the risk/analyst LLM calls are lost **twice** — no UI, no DB.

### E.3 Connection management

- **Rust:** `SqliteDatabase::open_db()` opens a fresh `Connection` per Tauri command; `UsageStore::record` opens one per LLM call **and re-runs the whole schema** (PERF-003). No pool. `rusqlite` is used but no pooling crate is present.
- **Node gateway:** one long-lived connection, prepared statements cached at init. **Correct.**
- **Chatbot:** lazy singleton per store; `FtsRetriever.search` prepares once per call — acceptable.
- **Serverless connection explosion:** N/A — desktop app.

### E.4 Unbounded reads / pagination — PERF-017

`get_meetings` (no `LIMIT`) and `get_meeting_details` (5 unbounded `SELECT`s, one connection). Currently trivial (51 / 424 rows) and behind dead UI, so **not urgent** — but the shape is wrong for a table that grows one row per meeting forever.

### E.5 Patterns explicitly checked and NOT found

No N+1 (see §F.1) · no queries in loops · no regex or `LIKE '%…%'` scans · no read-modify-write races on live paths · no ORM hydration overhead (no ORM) · no unnecessary `COUNT(*)` in a hot path. `upsertSpeakerProfile` does a read-then-write, but it is dead code.

---

## F. API / LLM FINDINGS

### F.1 N+1 detection — none found

Explicitly searched. `get_meeting_details` issues 6 flat queries for one meeting, not 1+N. `FtsRetriever.search` runs one statement per *expression* (≤ 2), not per hit, and joins `meetings_ref` in SQL. `SqliteMeetingStore.iterSourceRows` is one query per source table.

**No fix needed. Do not "optimise" these.**

### F.2 Measured critical-path latency

Source: `gateway/llm_usage.db`, n = 471, `status='ok'`.

| Agent / model | n | p50 | p90 | p95 | max |
|---|---|---|---|---|---|
| `context_manager` / gpt-4o-mini | 35 | 1164 | 2510 | 3544 | 5951 |
| `explanation` / gpt-4o-mini | 32 | 845 | 1926 | 2857 | 5662 |
| `risk_detector` / gpt-4o-mini | 16 | 904 | 1540 | 5180 | 5180 |
| **`response_agent` / gpt-5.6-luna** | 69 | **2315** | **4066** | **5985** | **11430** |

Legacy rows on the premium model (pre-tiering), retained for reference:

| Agent / model | n | p50 | p95 | max |
|---|---|---|---|---|
| `context_manager` / gpt-5.6-luna | 55 | 2048 | 3679 | 4476 |
| `explanation` / gpt-5.6-luna | 53 | 1346 | 2953 | 6004 |
| `technical` / gpt-5.6-luna | 14 | 1738 | 3424 | 3424 |
| `analyst` / gpt-5.6-luna | 14 | 1876 | 4179 | 4179 |
| `complexity` / gpt-4o-mini | 21 | 767 | 1381 | 4559 |

Derived reply latency, **Medium** route (the default and the safe fallback):

```
max(context_manager, explanation) + response_agent
p50            ≈ 1164 + 2315 ≈  3.5 s
p95            ≈ 3544 + 5985 ≈  9.5 s
worst observed ≈ 5951 + 11430 ≈ 17.4 s
```

**`response_agent` alone is ~66 % of p50 latency and ~63 % of p95.** It is the single dominant term. Its p95/p50 ratio of 2.6× and 11.4 s tail are exactly what an absent timeout produces.

The model-tiering change is confirmed effective: `context_manager` p50 dropped 2048 → 1164 ms (−43 %) and `explanation` 1346 → 845 ms (−37 %) after moving to `gpt-4o-mini`.

### F.3 PERF-001 — LLM calls with no consumer (CONFIRMED, P1)

Trace:

```
chunk_graph.rs  → detached lane runs risk + analyst
event_router.rs → app.emit("meeting_risks" | "meeting_decisions" | "meeting_action_items")
TauriEventBus   → onMeetingRisks / onMeetingDecisions / onMeetingActionItems
useAnalysis.ts  → the only consumer of all three
AnalysisPane    → the only consumer of useAnalysis
App.tsx         → never imports features/analysis      ← chain terminates here
```

`grep` over `src/` confirms `AnalysisPane` is referenced only by its own barrel `features/analysis/index.ts`. Same for `HistoryPane`/`useHistory`.

- **Medium route:** 4 LLM calls, 1 (`risk_detector`) discarded → **25 % waste**
- **High route:** 6 LLM calls, 2 (`risk` + `analyst`) discarded → **33 % waste**

At the measured peak of 41 Rust LLM calls/min, that is ~10–13 calls/min of pure waste, plus the API rate-limit headroom they consume.

### F.4 PERF-009 — wasted completion tokens on the critical path (CONFIRMED, P2)

`ContextManagerAgent` asks for `current_topic`, `conversation_summary`, `new_technical_terms` **and** `complexity`. `chunk_graph.rs:122-124` copies the first three into `ChunkState` — and nothing ever reads them. `ResponseAgent`'s prompt uses only `chunk_text`, `speaker`, `explanation`, `technical_explanation`.

Worse, `ChunkGraph::run` builds a **fresh** `ChunkState` per chunk (`chunk_graph.rs:88-92`), so the agent is always prompted with `Topic: None\nSummary: None`. It cannot track topic across chunks; it re-derives a summary of a single chunk, every chunk, and that summary is thrown away.

Measured: `context_manager` averages **60 completion tokens** vs `complexity`'s **5**. Only the complexity field is load-bearing. This inflates the p50 of the *first* stage-1 hop — which is on the critical path.

### F.5 PERF-002 — timeouts, retries, token caps (CONFIRMED, P1)

`agents/adapters/openai_adapter.rs` builds `self.client.agent(&model).preamble(system).build()` and calls `.prompt(user)`. No `.max_tokens()`, no timeout wrapper, no retry.

| | Rust agents | Chatbot |
|---|---|---|
| Timeout | **none** | `AbortSignal.timeout(30000)` |
| Retry | **none** | 2 retries, 300 ms × 2^n backoff, retryable-status allowlist |
| `max_tokens` | **none** | `max_completion_tokens: 1024` |
| Budget guard | **none** | `CallCountBudgetGuard` |
| JSON mode | substring `{…}` extraction | `response_format: json_object` + lenient parse |

**Failure mode:** a request that hangs past the OpenAI server timeout holds a `PIPELINE_SEMAPHORE` permit indefinitely. Three such requests and the reply pipeline is dead for the rest of the meeting, silently. The measured 11.4 s `response_agent` max is a mild instance of the same tail.

> **Documentation drift:** `LLM_BUDGET_SOFT`/`LLM_BUDGET_HARD` and the anomaly-cost variables documented in `CLAUDE.md` are read by **nothing** in the current Rust code — `grep` finds only `OPENAI_API_KEY`, `LLM_USAGE_DB`, `LLM_TRACK_PAYLOADS`, `LLM_USAGE_TRACKING`. The circuit breaker described in the docs does not exist in the live path.

### F.6 PERF-003 — blocking SQLite inside the async LLM adapter (CONFIRMED, P1)

`UsageStore::record` (`usage_store.rs:103-203`) is a **synchronous** function called from inside `async fn complete_json`. Per call it:

1. resolves a path from `std::env::current_dir()`
2. opens a new `Connection`
3. sets `journal_mode`
4. sets `busy_timeout`
5. runs `execute_batch(SCHEMA)` — 1 `CREATE TABLE` + 3 `CREATE INDEX`, all `IF NOT EXISTS` but still parsed and planned
6. inserts one row
7. drops the connection

This runs on a tokio worker thread with no `spawn_blocking`. With ~4 calls/chunk and a measured peak of 41 calls/min, that is ~41 connection open/schema-replay/close cycles per minute occupying async workers. The chatbot's `UsageRecorder` does this correctly: one lazy connection, schema once, cached prepared statement.

Side effect of the `current_dir()`-based path resolution: a 0-byte `llm_usage.db` exists at the repo root alongside the real 864 KB one in `gateway/`.

### F.7 PERF-008 — STT retry (CONFIRMED, P1)

`sidecar.js:60-65` pushes chain entries as `{ name, create }`. `provider-manager.js:128` reads `descriptor.retryPolicy || { maxRetries: 0, backoffMs: [] }` → `attempts = 1`.

Every connect and every reconnect gets exactly one try. When the last provider's socket closes:

```
handleActiveFailure → connectWithRetry (1 attempt) → emit('exhausted') → shutdown() → process.exit
```

One transient network blip ends the meeting.

### F.8 Payload sizes

Measured: average request payload **1028 bytes**, response **150 bytes**. Payloads are small and well bounded (`SNIPPET_MAX_CHARS: 600`, `MAX_EVIDENCE_MEETINGS: 4`, `MAX_SNIPPETS_PER_MEETING: 5`, `sanitizeText` caps throughout).

**No payload problem. No DTO work needed.**

One exception — **PERF-016**: `useChat.askQuestion` sends the **entire** message array on every ask, *and* the graph runs a `MemorySaver` checkpointer for the same thread. Two copies of the same growing history. Bounded in practice by `HISTORY_TURNS: 6` at prompt-build time, so it is transport waste, not prompt waste.

### F.9 External dependencies

| Service | Timeout | Retry | Fallback | Critical path? |
|---|---|---|---|---|
| OpenAI (Rust agents) | none | none | none — errors swallowed by `run_agent_timed` | **Yes** — every suggestion |
| OpenAI (chatbot) | 30 s | 2 + backoff | budget guard → degraded note | Yes, but on-demand |
| AssemblyAI | `connectTimeout: 5000` | none (PERF-008) | → Speechmatics | **Yes** — no STT, no product |
| Speechmatics | not deeply inspected | none | → exhausted → exit | Yes, last resort |

---

## G. FRONTEND FINDINGS

### G.1 PERF-004 — tab switch destroys state (CONFIRMED, P1)

```tsx
// App.tsx
{activeTab === 'suggest' && <SuggestAnswersPane onAskChat={askAndFocusChat} />}
{activeTab === 'ask'     && <ChatPane />}
{activeTab === 'listen'  && <TranscriptPane isLive={status === 'live'} />}
```

`useSuggestAnswers` (cards + `seenIds`) lives inside `SuggestAnswersPane`. `useTranscript` (lines + partials) lives inside `TranscriptPane`. Both unmount on tab change. Two consequences:

1. **State loss** — every suggestion card and the entire transcript are gone on return.
2. **Event loss** — the Tauri listener is torn down, so `suggest_answer` / `transcript_final` events that arrive while the tab is hidden are dropped at the source. The meeting keeps going; the record does not.

`ChatPane` is immune because `ChatProvider` sits above the switch in `App.tsx` — the pattern is already in the codebase and documented in `ChatContext.tsx`. It simply was not applied to the other two.

### G.2 PERF-010 — smooth scroll on every render (CONFIRMED, P2)

```ts
// useTranscript.ts:47 — new object identity on EVERY render
const partials = Object.fromEntries(partialsRef.current.entries());
```
```ts
// TranscriptPane.tsx — passed as a dep
useAutoScroll([lines, partials]);

// useAutoScroll.ts:15
useEffect(() => { maybeScroll(); }, [maybeScroll, ...deps]);
```

`partials` is a fresh object every render, so the effect fires every render and calls `scrollIntoView({ behavior: 'smooth' })` — re-triggering an in-flight smooth animation.

PERF FIX #8 moved partials into a ref specifically to stop identity churn, then handed the churn straight back via `Object.fromEntries`.

### G.3 PERF-011 — unbounded, unvirtualised transcript (CONFIRMED, P2)

`setLines(prev => [...prev, line])` grows for the whole session with no cap, and `TranscriptPane` renders `lines.map(...)` in full — no windowing. `React.memo` on `TranscriptLine` means unchanged rows skip *re-render*, but every row stays mounted in the DOM and the `.map` + array spread are O(n) per final.

`REQUIRES PROFILING` for the exact knee, but a multi-hour meeting will accumulate thousands of nodes.

### G.4 PERF-018 — context identity churn (P3)

`ChatProvider` supplies `useChat()`'s return object directly — a new literal every render. `askQuestion` also depends on `messages`, so its identity changes per message. Every `useChatContext()` consumer (including `AppContent`) re-renders on any chat state change. Small blast radius today.

### G.5 Explicitly checked and clean

- **No polling anywhere.** `grep` for `setInterval` / `setTimeout` / `requestAnimationFrame` across `src/`: **zero matches**. Fully event-driven.
- **No duplicate API calls.** `TauriEventBus.onSuggestAnswer` correctly listens to one event only (PERF FIX #6), and `suggestCardMapper` derives a content-hash id.
- **No image or media pipeline at all** — `public/icon.png`, `favicon.ico`, three SVGs in `src/assets/`. **§13 of the brief is N/A**: no uploads, no thumbnails, no CDN, no lazy loading needed, nothing to convert to WebP/AVIF.
- **Listener cleanup is correct** — every `useEffect` returns its unlisten; the `unlisten.then(f => f())` pattern is safe against unmount-before-resolve.
- **No mobile target.** §31 is N/A.
- **No WebSockets/SSE/polling in the frontend.** §22 applies only to the gateway↔AssemblyAI socket.

### G.6 Dead frontend code (P4)

`HistoryPane` · `useHistory` · `AnalysisPane` · `useAnalysis` · `deduplicateCards` · `toggleToolbar()` · `toggleCaption()`

The last two `invoke` commands **that do not exist** — `commands/mod.rs` declares only `audio_devices`, `capture`, `chat`, `db`; there is no `overlay.rs`. Calling either would reject at runtime.

Related (**PERF-023**): `TauriHistoryRepository.getMeetingDetails(id: string)` invokes a command typed `id: i64` — a deserialisation failure, latent because the path is unreachable.

> **Documentation drift:** `CLAUDE.md` describes three windows (`main`, `toolbar`, `caption`), `commands/overlay.rs`, `features/toolbar/`, `features/caption/`. `tauri.conf.json` declares **one** window; `src/features/` contains `analysis, capture, chat, history, suggest, transcript`. None of the toolbar/caption code exists. `src-tauri/capabilities/toolbar.json` and `caption.json` reference windows that are never created.

---

## H. MEMORY + CPU FINDINGS

### CONFIRMED

**PERF-012 — no backpressure from the sidecar to the audio path (P2).**
`mac_audio.rs:173-174` creates *unbounded* `mpsc::channel`s. The mixer thread drains them and calls `StreamingSink::write_samples` → blocking `write_all` on the sidecar's stdin pipe. If Node's event loop stalls, the pipe buffer (~64 KB) fills, the mixer thread blocks, and the two unbounded channels grow without limit while the cpal callbacks keep pushing. Audio is 32 KB/s post-resample, so this is slow — but it is unbounded, with no drop policy and no metric.

**PERF-013 — allocations and a mutex inside the real-time audio callback (P2).**
`process_and_send` runs on the cpal RT thread and per callback:
- allocates `mono_data` (`.collect()`)
- takes `resampler.lock()`
- allocates inside `Resampler::process` (`chunk`, `input_frames`, `output`)
- allocates `pcm16` (`.collect()`)
- `tx.send(pcm16.clone())` — **a full extra copy of a buffer that is immediately dropped** (`mac_audio.rs:442`; `pcm16` is only read afterwards for `.len()`)

Allocation in an RT audio callback can block on the allocator; a mutex there risks priority inversion. Contention is nil today (each stream owns its resampler), but the shape is wrong. The `.clone()` is free to remove.

**PERF-014 — `llm_usage.db` grows with no retention (P2).**
Measured: 471 rows, avg 1028 B request + 150 B response = **~1.2 KB/call**; file is 864 KB. At the measured peak of 41 calls/min that is ~50 KB/min ≈ **3 MB per meeting-hour, forever**. `LLM_TRACK_PAYLOADS` defaults to on. No TTL, no rotation, no `VACUUM`.

**PERF-022 — log amplification (P3).**
`mac_audio.rs:354-373` sleeps 100 ms then logs when `elapsed % 10 == 0`. `elapsed` is in whole seconds, so the condition holds for ~10 consecutive iterations → ~10 log lines per 10-second boundary. `debug!` level only.

**Bounded and correct (no action):** `meeting-state.js` caps every collection (`MAX_RECENT_CHUNKS`, `MAX_GLOSSARY_TERMS` with real LRU eviction, `MAX_IN_MEMORY_RISKS`, `MAX_PAST_SUGGESTIONS`). `ProviderManager.ring` caps at 20. `DiarizationLayer.audioRing` caps at 30. `PcmDeframer` self-limits. `batchTimer` is `unref`'d.

### SUSPECTED — REQUIRES PROFILING

- **`MemorySaver` growth** in the chatbot: in-memory checkpointer, thread id always `'default'`, never pruned. Bounded by chat volume in one sidecar lifetime. Low risk; needs a heap snapshot to size.
- **`TranscriptPane` DOM retention** over a multi-hour meeting (PERF-011). Needs React DevTools Profiler + a browser heap snapshot.
- **Tokio task queue depth** under sustained fast speech (PERF-005). Needs a live meeting with `tracing` at debug.

### CPU — nothing significant found

No image processing, no PDF/report generation, no crypto, no compression, no synchronous `fs` in a request path. The heaviest CPU is `rubato` FFT resampling, which is the correct tool. `mfcc.js` would be CPU-relevant but never executes (PERF-024). `jaccardSimilarity` runs over a 5-element window. `chit_chat_gate` scans a ~60-entry array only for utterances ≤ 5 words.

**Event-loop blocking in the gateway:** `db.saveTranscript` is just an array push (batched); the 5 s flush is one small transaction. `sanitize` is a handful of regexes on one line of text. The gateway event loop is clean.

**§29 Algorithm review:** `scanForMagicBytes` is O(n) but only on frame desync. `PcmDeframer.append` does `Buffer.concat` per stdin event — O(residual), residual < 8 KB. `deduplicateCards`'s O(n) scan was already replaced by a `Set`. **No meaningful O(n²) at realistic data scale.**

### §30 Startup performance — NOT MEASURED

Cold start includes: `dotenvy` load → 6 `OpenAiAdapter` constructions → Tauri window/tray setup → (on capture) `node` spawn + `initDB` + migration check → (on chat) `node` spawn + FTS staleness check. No blocking startup queries or large in-memory dataset loads found. Needs measurement.

---

## I. CACHE + REDIS DECISION

### Redis status: **NOT NEEDED**

Not "optional later" — **not needed, and adding it would be a net negative.**

| Redis use case | Applies here? | Why |
|---|---|---|
| Distributed cache | No | One process, one machine, one user |
| Sessions | No | No auth, no sessions |
| Rate limiting | No | Already solved in-process by `PIPELINE_SEMAPHORE` / `DETACHED_SEMAPHORE` — correctly |
| Counters / leaderboards | No | None exist |
| Pub/Sub | No | Tauri events + OS pipes already do this, faster and with no network hop |
| Locks | No | Single writer per DB; SQLite WAL + `busy_timeout` covers the two-process case |
| Queues | No | See §K — a queue would add latency to a latency-critical path |
| Idempotency | No | No external mutating API |

Redis would add a daemon to install, a failure mode, a serialisation hop, and a second source of truth — to a **local desktop app** whose entire dataset is 225 KB.

**DO NOT ADD.**

### Cache opportunities that ARE real

| ID | What | Tier | Benefit | TTL | Invalidation | Stale risk |
|---|---|---|---|---|---|---|
| PERF-C1 | `UsageStore` connection + prepared statement (PERF-003) | **L1, in-process** | **Moderate–large** — this is the fix for PERF-003, not really "caching" | process lifetime | n/a | none |
| PERF-C2 | `check_blackhole_installed` — full `cpal` device enumeration per call | **L1** | Small (called once per mount) | session | on device change | user plugs in BlackHole mid-session and the notice is stale |
| PERF-C3 | `get_meetings` result | **L1** | Negligible today (51 rows, dead UI) | 30 s | on meeting end | shows a just-finished meeting late |

### Caches explicitly rejected

- **LLM responses** — each chunk is unique speech; hit rate ≈ 0.
- **Authorization decisions** — none exist.
- **HTTP / ETag / Cache-Control** — no HTTP server in the product (the dashboard is a dev tool).
- **CDN cache** — no remote assets. `index.html` loads one local module and one local PNG.

### §34 Performance ↔ security interaction

No cache is proposed that would hold private user data across users (there is only one user), and none would cache an authorization decision (there are none). The one privacy-relevant knob already exists: `LLM_TRACK_PAYLOADS=0` disables storing raw prompts and responses in `llm_usage.db`. It defaults to **on**, which means full meeting transcript fragments are persisted to disk in cleartext — a **security finding, not a performance one**, but worth noting alongside PERF-014's retention gap.

---

## J. LOAD SCALABILITY MODEL

This app does not have "traffic." Reading the levels as intended:

### Current — 1 user, 1 meeting, normal speech

**Works.** Measured: reply p50 ≈ 3.5 s, p95 ≈ 9.5 s. Peak observed 41 LLM calls/min ≈ 13 chunks/min ≈ one chunk every ~4.6 s.

Reply-path capacity at p50 is `3 permits / 3.5 s` ≈ **51 chunks/min**. At p95 (9.5 s) capacity drops to **~19 chunks/min**, which is close to the observed peak of ~13. **Headroom exists but is thinner than it looks.**

### 10× — fast multi-party discussion, or 10× chunk rate

**Degrades, and degrades badly-shaped.** Bottlenecks in order:

1. **PERF-005** — `PIPELINE_SEMAPHORE` queues. Excess chunks pile up in the tokio queue with no shedding and no age check. The user sees suggestions for speech from minutes ago, which is worse than no suggestion.
2. **OpenAI rate limits** — `REQUIRES PRODUCTION DATA` (account tier unknown). With PERF-002 (no retry), a 429 is a silent per-agent failure, not a backoff.
3. **PERF-003** — ~4 blocking SQLite cycles per chunk × 10 competing for tokio workers.
4. **PERF-001** — 25–33 % of that pressure is spent on output nobody reads. Fixing it alone buys back roughly a third of the headroom.

Audio capture, resampling, framing, and the gateway are **not** bottlenecks at 10× — they are rate-limited by wall-clock speech, not by chunk count.

### 100× — many concurrent meetings

**Architecturally out of scope.** `NodeGatewayClient` enforces one sidecar (`"Gateway sidecar is already running"`); `gateway/db/index.js` holds a single module-level `currentMeetingId`; `meeting-state.js` is a module singleton. Multi-tenancy would be a redesign, not a tuning exercise.

**Do not pre-build for it.**

### Long-duration scaling — the axis that actually matters

| Growth axis | Effect | Finding |
|---|---|---|
| Transcript lines per session | Unbounded array + unvirtualised DOM | PERF-011 |
| `transcripts` rows across all meetings | `SCAN` + temp B-tree on every history open | PERF-006 |
| `llm_usage.db` | ~3 MB per meeting-hour, forever | PERF-014 |
| FTS corpus | Full `DELETE` + reinsert, synchronous, on chatbot start | PERF-015 |

No fabricated RPS or capacity numbers appear above. Where numbers appear they are derived from `llm_usage.db` and labelled measured.

---

## K. TOP 10 BOTTLENECKS

### 1. PERF-001 — 25–33 % of LLM calls have no consumer
- **Evidence:** CONFIRMED — `AnalysisPane` unreferenced in `App.tsx`; `chunks`/`decisions`/`risks` = 0 rows
- **Impact:** wasted latency budget, wasted cost, wasted rate-limit headroom
- **Why:** the agent pipeline moved to Rust and the UI was rebuilt around Suggest/Ask/Listen, but the risk/analyst branch was never rewired or removed
- **Fix:** either mount an analysis surface, or gate `run_risk`/`run_analyst` off
- **Benefit:** **large** (removes a third of all calls)
- **Risk:** LOW if gated; MEDIUM if new UI is built
- **MANDATORY NOW**

### 2. PERF-002 — no timeout/retry/`max_tokens` on Rust LLM calls
- **Evidence:** CONFIRMED — `openai_adapter.rs` vs `OpenAiLlmGateway.js`; measured 11.4 s `response_agent` tail
- **Impact:** a hung request permanently consumes 1 of 3 permits
- **Why:** `rig-core` defaults were never overridden
- **Fix:** `tokio::time::timeout` + bounded retry on 429/5xx + a completion-token cap, mirroring the chatbot gateway
- **Benefit:** **potentially critical** (prevents silent pipeline death)
- **Risk:** LOW
- **MANDATORY NOW**

### 3. PERF-004 — tab switch destroys suggestions and transcript
- **Evidence:** CONFIRMED — conditional render in `App.tsx`
- **Impact:** silent, permanent data loss mid-meeting
- **Why:** hook state co-located with a conditionally-rendered pane
- **Fix:** lift `useSuggestAnswers`/`useTranscript` into providers above the tab switch, exactly as `ChatProvider` already does
- **Benefit:** **potentially critical** (correctness)
- **Risk:** LOW
- **MANDATORY NOW**

### 4. PERF-005 — reply path queues instead of shedding
- **Evidence:** CONFIRMED — `event_router.rs:60` `acquire_owned().await` vs the detached lane's `try_acquire_owned` at line 80
- **Impact:** unbounded staleness under load — the worst failure mode for a real-time copilot
- **Why:** the code comment says "blocks until one completes," but it blocks the *spawned task*, not the producer, so tasks accumulate
- **Fix:** add an age check or a bounded try-acquire on the reply path too
- **Benefit:** **large** under load, none at idle
- **Risk:** MEDIUM — deliberately drops suggestions; needs a product decision on the policy
- **RECOMMENDED**

### 5. PERF-003 — blocking SQLite per LLM call on a tokio worker
- **Evidence:** CONFIRMED — `usage_store.rs:110-114` opens a connection and `execute_batch(SCHEMA)` every call
- **Impact:** async workers blocked ~41×/min at peak
- **Why:** written as a fire-and-forget helper without an async boundary
- **Fix:** `OnceLock<Mutex<Connection>>` + cached statement + `spawn_blocking`. The chatbot's `UsageRecorder` is the template.
- **Benefit:** **moderate**
- **Risk:** LOW
- **MANDATORY NOW**

### 6. PERF-006 — `transcripts` full scan
- **Evidence:** CONFIRMED — `SCAN transcripts` + `USE TEMP B-TREE FOR ORDER BY`
- **Impact:** history detail degrades linearly with total transcripts ever recorded
- **Why:** base table predates the migration runner and was never indexed
- **Fix:** migration adding `(meeting_id, timestamp)`
- **Benefit:** **large** at scale, small today
- **Risk:** LOW (additive migration, rollback = drop index)
- **MANDATORY NOW**

### 7. PERF-008 — STT dies on one socket close
- **Evidence:** CONFIRMED — `retryPolicy` never set → `maxRetries: 0`
- **Impact:** an availability cliff, not a slowdown; the meeting ends
- **Why:** `ProviderManager` supports a retry policy; `sidecar.js` never supplies one
- **Fix:** attach `{ maxRetries, backoffMs }` per chain entry
- **Benefit:** **potentially critical**
- **Risk:** LOW — but reconnect must not duplicate the ring replay (the existing `ring = []`-on-final logic already handles this)
- **MANDATORY NOW**

### 8. PERF-007 — analysis write path dead
- **Evidence:** CONFIRMED — 0 rows in 5 tables across 51 meetings
- **Impact:** no history, no summaries, Ask Roxi blind to decisions/risks
- **Why:** agents moved to Rust; `sqlite.rs` is read-only; nobody re-added the writes
- **Fix:** a write port on the Rust side, or route artifacts back through the gateway
- **Benefit:** **large** (restores a whole feature)
- **Risk:** MEDIUM — new write path on a live DB, contends with the gateway writer
- **MANDATORY NOW** for correctness; the *implementation* deserves its own design pass

### 9. PERF-009 — `context_manager` burns tokens on unread fields
- **Evidence:** CONFIRMED — 60 avg completion tokens vs `complexity`'s 5; outputs written to `ChunkState` and never read; always prompted with `Topic: None`
- **Impact:** inflates the first hop of the critical path
- **Why:** the agent kept its original contract after the fold-in of complexity
- **Fix:** either trim the prompt to `complexity` only, **or** thread topic/summary across chunks so the work becomes useful
- **Benefit:** **moderate** latency, **small** cost
- **Risk:** LOW to trim, MEDIUM to thread state (changes agent behaviour)
- **RECOMMENDED**

### 10. PERF-010 — smooth scroll fires every render
- **Evidence:** CONFIRMED — `Object.fromEntries` identity churn feeding a `useEffect` dep array
- **Impact:** continuous animation restarts during live transcription; visible jank
- **Why:** a ref-based fix undone by a derived object one line later
- **Fix:** memoise the derived snapshot on `partialsTick`, or pass `partialsTick` as the dep
- **Benefit:** **moderate** (user-perceived)
- **Risk:** LOW
- **RECOMMENDED** — best effort-to-benefit ratio in the report

---

## L. QUICK WINS — low risk, high value (NOT IMPLEMENTED)

| ID | Change | Files | Risk | Benefit |
|---|---|---|---|---|
| PERF-001 | Gate `run_risk` / `run_analyst` to `false` until a consumer exists | `orchestrator/routing.rs` | LOW | **Large** — removes 25–33 % of all LLM calls |
| PERF-010 | Memoise the `partials` snapshot on `partialsTick` | `useTranscript.ts` | LOW | Moderate, immediately visible |
| PERF-002a | Wrap LLM calls in `tokio::time::timeout` | `openai_adapter.rs` | LOW | Prevents permanent pipeline stall |
| PERF-003 | Cache the `UsageStore` connection + statement | `usage_store.rs` | LOW | Removes ~41 blocking DB cycles/min |
| PERF-006 | Migration: `CREATE INDEX idx_transcripts_meeting ON transcripts(meeting_id, timestamp)` | `gateway/db/migrate.js` (new M008) | LOW | Removes a scan + a temp B-tree sort |
| PERF-008 | Attach a `retryPolicy` to both chain entries | `gateway/sidecar.js` | LOW | Meeting survives a transient blip |
| PERF-013a | Drop the `.clone()` in `tx.send(pcm16.clone())` | `mac_audio.rs:442` | LOW | Removes a full buffer copy per RT callback |
| PERF-019 | Add `[profile.release]` — `lto`, `codegen-units = 1`, `strip` | `src-tauri/Cargo.toml` | LOW | Smaller binary, marginally faster |
| PERF-022 | Guard the progress log against 10× repetition | `mac_audio.rs:366` | LOW | Negligible perf, cleaner logs |

---

## M. DO NOT CHANGE

Beyond everything listed in §C:

1. **No Redis.** See §I.
2. **No queue / worker / broker.** The reply path is *latency*-critical; a queue would add a hop to the exact thing users wait on. The detached lane is already the correct in-process async split.
3. **No microservices.** Three cooperating processes is already the right amount of isolation for a desktop app.
4. **No horizontal scaling, no sharding, no read replicas.** One user, 225 KB of data.
5. **No CDN, no HTTP caching, no static-asset pipeline.** Everything is bundled locally.
6. **Do not convert images.** Icons and three SVGs. Nothing to gain.
7. **Do not replace SQLite.** WAL + `busy_timeout` handles the multi-process story correctly at this size.
8. **Do not turn pipes into sockets.**
9. **Do not "fix" `csp: null` / `withGlobalTauri: true` as a drive-by** — flagged in `audit/CODE-AUDIT-REPORT.md`, out of scope here, and possibly load-bearing.
10. **Do not add indexes to `decisions`/`action_items`/`risks`/`technical_analyses` yet** — they are empty. Fix PERF-007 first, then index.
11. **Do not add pagination to `get_meetings`/`get_meeting_details`** while the UI consuming them is unmounted. Revisit if history ships.
12. **Do not worker-thread the MFCC code.** It never runs (PERF-024) — decide whether to keep or delete it first.
13. **`chunk_graph.rs`'s stage split and the `merge_from` avoidance** — the reasoning in those comments is correct. Leave it.
14. **PERF-020, the 250 ms PCM chunk size** — it is a real latency floor, but it is tuned against STT provider behaviour. Do not change without provider-side measurement.

---

## N. PROFILING / BENCHMARKS REQUIRED

Cannot be settled by static analysis:

| Question | Method |
|---|---|
| Actual tokio queue depth under sustained fast speech (PERF-005) | Live meeting + `tracing` at debug on the semaphore acquire/release spans |
| `TranscriptPane` render cost and DOM retention over 1 h (PERF-011) | React DevTools Profiler + Chrome heap snapshot in the Tauri webview |
| RT audio callback deadline misses (PERF-013) | `cpal` callback timing instrumentation; macOS Instruments (Time Profiler on the RT thread) |
| FTS rebuild duration vs corpus size (PERF-015) | The `durationMs` already returned by `FtsIndexBuilder.rebuild` — record it across corpus sizes |
| `MemorySaver` heap growth (chatbot) | `node --inspect` heap snapshot after N turns |
| OpenAI rate-limit headroom | **REQUIRES PRODUCTION DATA** — account tier and observed 429 rate |
| Gateway event-loop lag | `perf_hooks.monitorEventLoopDelay()` — not currently instrumented |
| STT end-of-turn → `Final` latency | **NOT MEASURED** anywhere. The 250 ms PCM chunk (PERF-020) is a known floor; the provider-side component is unknown. |
| Post-index query plans | Re-run `EXPLAIN QUERY PLAN` after any migration |
| Cold start (app launch → capture ready) | **NOT MEASURED.** Includes `node` process spawn ×2 + `initDB` + migrations + FTS staleness check. |

### Load-test readiness (§28)

k6 / Locust / Artillery / JMeter are all **inapplicable** — there is no HTTP surface to drive.

The correct equivalent is a **recorded-audio replay harness**: feed a known WAV through `StreamingSink` at 1×, 2×, 5× speed and measure reply latency and queue depth. `gateway/tools/pcm-consumer.js` and `gateway/tools/transcriber.js` look like the seeds of exactly this.

No destructive testing is possible or needed — there is no production environment.

### Observability gaps (§26)

| Metric | Present? |
|---|---|
| LLM latency p50/p95/p99 per agent | **Yes** — `llm_usage.db` + dashboard |
| LLM token + cost per call | **Yes** |
| LLM error rate + error codes | **Yes** |
| Per-chunk pipeline trace | **Yes** — `PipelineTrace`, emitted as `agent_trace`… but **no frontend consumer** |
| STT connect/turn latency | **No** |
| Node event-loop lag | **No** |
| Tokio queue depth / semaphore wait time | **No** |
| DB query latency / slow-query log | **No** |
| Cache hit ratio | N/A (no cache) |
| Queue depth | N/A (no queue) |

These are classified as **observability gaps**, not as a mandate to install a monitoring stack.

---

## O. APPROVAL PLAN

### Batch 1 — Mandatory, low risk (recommended first)
**`PERF-001` · `PERF-002` · `PERF-003` · `PERF-010`**

- **Files:** `src-tauri/src/agents/orchestrator/routing.rs`, `agents/adapters/openai_adapter.rs`, `agents/adapters/usage_store.rs`, `src/features/transcript/useTranscript.ts`
- **Changes:** gate the two unconsumed agents off; add `tokio::time::timeout` + a completion-token cap; cache the usage-DB connection and prepared statement behind a `OnceLock`; memoise the partials snapshot on `partialsTick`.
- **Risk:** LOW. No schema change, no API-contract change, no UI change.
- **Benefit:** removes ~⅓ of LLM calls; eliminates the permanent-stall failure mode; removes ~41 blocking DB cycles/min; removes visible scroll jank.
- **Verification:** `cargo test routing::`, `npm run lint`, then a live meeting comparing `llm_usage.db` per-tag call counts and latency before/after.

### Batch 2 — Database
**`PERF-006` · `PERF-017`**

- **Files:** `gateway/db/migrate.js` (new M008 — **additive only, never edit a shipped migration**), `src-tauri/src/adapters/sqlite.rs`
- **Changes:** index `transcripts(meeting_id, timestamp)` and `meetings(start_time DESC)`; add `LIMIT` to `get_meetings`.
- **Risk:** LOW. Rollback = `DROP INDEX`. Note: adding `LIMIT` changes the shape of what the (currently unmounted) history UI would receive.
- **Benefit:** large at scale, small today.
- **Verification:** `EXPLAIN QUERY PLAN` before/after — expect `SEARCH transcripts USING INDEX` and no temp B-tree.

### Batch 3 — Reliability
**`PERF-008` · `PERF-005`**

- **Files:** `gateway/sidecar.js`, `gateway/stt/provider-manager.js`, `src-tauri/src/sidecar/event_router.rs`
- **Changes:** attach a retry policy with backoff to the STT chain; convert the reply path to age-aware or bounded acquisition.
- **Risk:** MEDIUM. Retries change failover timing. Shedding **deliberately drops suggestions** — this needs an explicit product call on the policy (drop oldest? drop newest? drop past N seconds?).
- **Benefit:** large — turns two cliff-edge failures into graceful degradation.
- **Verification:** kill the WebSocket mid-session and confirm recovery; replay audio at 3× and confirm queue depth stays bounded.

### Batch 4 — Restore the analysis write path
**`PERF-007`**

- **Files:** new Rust write port + adapter, `src-tauri/src/lib.rs`, `event_router.rs`; possibly `gateway/db/index.js`
- **Changes:** persist decisions / action items / risks / chunks again.
- **Risk:** **MEDIUM–HIGH.** A second writer on `meeting_history.db` while the gateway is writing. Needs a deliberate design decision — write from Rust with WAL contention, or route artifacts back through the gateway's existing single-writer.
- **Benefit:** large — restores history, summaries, and Ask Roxi's analytical grounding.
- **Note:** worth discussing the approach before implementing.

### Batch 5 — Cost, growth, cleanup
**`PERF-009` · `PERF-014` · `PERF-011` · `PERF-013` · `PERF-016` · `PERF-019` · `PERF-021` · `PERF-022`**

- **Risk:** LOW individually, except PERF-009's state-threading variant (MEDIUM — changes agent behaviour) and PERF-011 (MEDIUM — virtualisation changes scroll semantics).

### Batch 6 — Dead code decision (needs product input, not a fix)
**`PERF-023` · `PERF-024` + the toolbar/caption documentation drift**

Delete, or restore? `HistoryPane`, `AnalysisPane`, `deduplicateCards`, `toggleToolbar`/`toggleCaption` (which invoke non-existent commands), the inert MFCC diarization layer, and the `capabilities/toolbar.json` / `caption.json` files for windows that are never created.

**This is a product decision, not a performance one** — and it directly determines whether PERF-001 becomes "delete the agents" or "build the UI."

---

## Open questions blocking the plan

1. **Are the risk / decision / action-item cards meant to ship in the UI, or was that feature intentionally dropped?**
   This flips PERF-001 from a deletion to a build, and determines whether PERF-007 is worth the MEDIUM–HIGH risk of Batch 4.

2. **For PERF-005, when the pipeline is saturated, should the oldest pending chunk be dropped or the newest refused?**
   Both are defensible; the choice is a product decision about whether stale-but-complete or recent-but-gappy coverage is preferable.

---

**AUDIT COMPLETE — NO FILES OR CODE HAVE BEEN MODIFIED.**

Awaiting explicit approval before any implementation. Approval of a batch authorises only the IDs listed in that batch.
