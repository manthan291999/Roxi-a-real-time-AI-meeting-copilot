# Roxi — Complete Performance & Scalability Audit
### Phase 1: Read-Only Analysis — No Files Modified

---

## A. EXECUTIVE SUMMARY

| Score Area | Score | Notes |
|---|---|---|
| **Overall Performance** | **74 / 100** | Well-engineered for its scale; several targeted fixes available |
| **Scalability** | 82 / 100 | Single-user desktop — horizontal scale is irrelevant by design |
| **Database Efficiency** | 65 / 100 | Good write path; several missing read indexes; one pattern per call |
| **API Efficiency** | 80 / 100 | Excellent concurrency model; no LLM timeout guard is the main gap |
| **Frontend Efficiency** | 88 / 100 | Strong — partials-as-ref trick, O(1) dedup, event cleanup |
| **Cache Strategy** | 60 / 100 | No caching of any kind; several opportunities exist |
| **Load Readiness** | 90 / 100 | Semaphore backpressure, shedding lane, filler gate are all production-grade |
| **Observability** | 70 / 100 | Good LLM tracing; zero CPU/memory/audio-drop metrics |

---

## B. PROJECT ARCHITECTURE

### Stack Summary

| Layer | Technology |
|---|---|
| **OS target** | macOS only (Tauri Accessory policy, BlackHole loopback, cpal) |
| **Core process (P1)** | Rust — Tauri v2, cpal, rubato FFT resampler, rig-core OpenAI, rusqlite |
| **STT sidecar (P2)** | Node.js — AssemblyAI WebSocket → Speechmatics failover, better-sqlite3 |
| **Chatbot sidecar (P3)** | Node.js — LangGraph Adaptive-RAG, FTS5 over `meeting_history.db` |
| **UI (P4)** | React 19 + TypeScript + Vite + Tailwind, 3 Tauri WebView windows |
| **Dashboard (P5, optional)** | Express + better-sqlite3, read-only, `localhost:3300` |
| **Databases** | 3 SQLite files: `meeting_history.db`, `llm_usage.db`, chatbot data |
| **LLM** | OpenAI — `gpt-4o-mini` for all analysis agents, `gpt-5.6-luna` for response_agent |
| **Auth** | None (local desktop app, API keys from `.env`) |
| **Caching** | None |
| **Queue** | None (Tokio semaphore for backpressure, not a durable queue) |
| **CDN / reverse proxy** | None |

### Major Business Flows (traced)

1. **Audio Capture** — cpal mic + BlackHole loopback → downmix → resample → PCM16 → stdin → deframer
2. **STT Transcription** — AssemblyAI WS → partial/final events → diarization → sanitizer → DB + UI
3. **LLM Pipeline** — Final transcript → `chit_chat_gate` → ChunkGraph (context‖explanation concurrent → routing → technical/risk/analyst → response)
4. **Suggest Card Display** — Tauri event → React state → deduplicated UI card
5. **Transcript Display** — partial events (ref-based, not state) → word-by-word update
6. **Chat (RAG)** — `ask_chat` Tauri command → chatbot sidecar → LangGraph → FTS5 search → LLM → streaming reply
7. **History View** — `get_meetings` / `get_meeting_details` Tauri commands → Rust → SQLite
8. **LLM Usage Dashboard** — Express reads `llm_usage.db` read-only; paginated REST

### Architecture Request/Data Flow

```
Mic + System Audio
  → cpal (capture thread)
  → Resampler (rubato FFT)
  → PCM16 StreamingSink (250ms chunks)
  → stdin pipe
  → gateway/sidecar.js (PcmDeframer → ProviderManager)
  → AssemblyAI WebSocket (STT)
  → DiarizationLayer
  → db.saveTranscript (batched)
  → stdout JSON lines
  → Rust event_router.rs
  ├─ [instant] Tauri emit → React UI (transcript_final)
  └─ [async] ChunkGraph.run() under Semaphore(3)
           ├─ Stage 0: chit_chat_gate (zero-LLM)
           ├─ Stage 1: context_manager ‖ explanation (concurrent gpt-4o-mini)
           ├─ Stage 2: technical (awaited, High only) + risk‖analyst (detached, sheds)
           └─ Stage 3: response_agent (gpt-5.6-luna)
                → Tauri emit → React UI (suggest_answer, context_explanation, etc.)
```

---

## C. WHAT IS ALREADY GOOD

These areas are well-implemented and should **not** be changed:

1. **Concurrency model is excellent.** `PIPELINE_SEMAPHORE(3)` + `DETACHED_SEMAPHORE(4)` with shed-vs-queue differentiation is production-grade backpressure. This is the most critical performance concern for a real-time app and it is solved correctly.

2. **Stage 1 concurrent join.** `context_manager ‖ explanation` running together at t=0 is optimal — the two are independent and this saves the full round-trip of one LLM call from the critical path.

3. **chit_chat_gate is a genuine win.** Zero-LLM filler filter saves 2–8s and real API cost for every filler utterance. The exact-match + prefix approach is correct.

4. **Detached slow lane shed instead of queue.** Dropping stale risk/analyst work when the lane is full is the correct choice. Queueing would just cause late, confusing UI updates.

5. **model routing (fast vs premium).** `gpt-4o-mini` for all analysis, `gpt-5.6-luna` only for `response_agent` is correct. The comment in `lib.rs` is accurate.

6. **React partials-as-ref pattern (`useTranscript.ts`).** Storing partials in a `useRef<Map>` and bumping a counter avoids re-rendering the entire transcript pane on every STT word. This is the right solution.

7. **O(1) suggest-card deduplication.** `seenIds: Set<string>` ref avoids O(n) array scan as the meeting progresses. Correct.

8. **5-second batched transcript flush.** High-frequency transcript inserts are batched. Immediate writes are kept only for low-frequency artifacts (risks, decisions). This is correct prioritization.

9. **Prepared statements in gateway DB.** All hot-path inserts use pre-compiled `better-sqlite3` prepared statements. Correct.

10. **WAL mode on all SQLite databases.** Enables the Rust read path (history viewer) to work concurrently with the Node write path. Correct.

11. **Event listener cleanup in React.** Every `useEffect` returns an unlisten function. No visible listener leak pattern.

12. **Forward-only migration runner.** The `schema_version` + transactional migration approach is correct and safe.

13. **Error isolation.** `run_agent_timed()` swallows agent errors. One LLM failure never kills the pipeline. Correct.

---

## D. CRITICAL FINDINGS TABLE

| ID | Severity | Area | Finding | Evidence | Production Impact | Mandatory? |
|---|---|---|---|---|---|---|
| PERF-001 | P1 | LLM Client | **No timeout on OpenAI calls** — a hung connection can block a pipeline slot indefinitely, consuming a semaphore permit and starving all future chunks | `openai_adapter.rs` has no `tokio::time::timeout` wrapper; rig-core's `Prompt::prompt()` has no configurable deadline in use | A 30-60s LLM hang occupies 1 of 3 pipeline slots. Two concurrent hangs halve the effective pipeline. | **MANDATORY NOW** |
| PERF-002 | P1 | DB | **UsageStore opens a new SQLite connection + runs `execute_batch(SCHEMA)` on every single LLM call** | `usage_store.rs:103–114` — `Connection::open()` then `execute_batch(SCHEMA)` inside `record()` | Medium-High complexity chunks fire 4–6 LLM calls; each call opens+migrates+inserts+closes a fresh DB connection. This is unnecessary I/O churn every ~5-15 seconds during an active meeting | **MANDATORY NOW** |
| PERF-003 | P2 | DB | **`transcripts` table has no index on `meeting_id`** — `get_meeting_details` does a full table scan as the DB grows | `sqlite.rs:83` queries `WHERE meeting_id = ?1 ORDER BY timestamp ASC`; `db/index.js` creates no index on `transcripts(meeting_id)` | A long meeting accumulates thousands of transcript rows. After 10+ meetings, loading history detail becomes slow. | **RECOMMENDED** |
| PERF-004 | P2 | DB | **`decisions`, `action_items`, `technical_analyses`, `suggested_replies` have no index on `meeting_id`** — all queried by `meeting_id` in `get_meeting_details` | `sqlite.rs:96,106,117,127` — four separate WHERE queries; no covering index exists | Five sequential unindexed scans on meeting detail load. Low impact now; grows with data | **RECOMMENDED** |
| PERF-005 | P2 | DB | **`speaker_embeddings` full table scan on every `buildEmbedding()` call** — all embeddings loaded into memory for cosine search | `diarization-layer.js:140` — `getAllSpeakerEmbeddings()` fetches all rows; `db/index.js:454` — `SELECT ... FROM speaker_embeddings` with no WHERE | O(N) memory + O(N) CPU per embedding comparison where N = all historical speakers. Will degrade with sessions | **RECOMMENDED** |
| PERF-006 | P2 | Memory | **Transcript lines array grows without bound in React** | `useTranscript.ts:7,33` — `setLines(prev => [...prev, line])` with no cap; for a 2-hour meeting at 1 line/5s = ~1440 lines kept in memory + re-spread on every final event | Long meetings: memory growth, slower state updates, longer reconciliation on re-renders. | **RECOMMENDED** |
| PERF-007 | P3 | DB | **`get_meetings` opens a connection, checks table existence with a full `sqlite_master` scan, then queries** — two round trips per call | `sqlite.rs:34–63` — checks `sqlite_master` every call even after the table is confirmed to exist | Minor overhead per call. Called only when user opens history tab | **OPTIONAL AT SCALE** |
| PERF-008 | P3 | CPU | **`process_and_send` allocates three `Vec<_>` per 250ms audio callback** — downmix Vec, resample Vec, PCM16 Vec | `mac_audio.rs:412-439` — each audio callback `collect()`s 3 separate owned Vecs | On a fast machine this is negligible. Worth noting as a future allocation pressure point. | **OPTIONAL AT SCALE** |
| PERF-009 | P3 | Observability | **No audio drop/overrun counter; no CPU/memory metrics; no event-loop lag** | No `sysinfo`, no metrics endpoint, no Node `perf_hooks` usage | Cannot diagnose audio glitches or performance regressions in production | **RECOMMENDED** |
| PERF-010 | P4 | Retry | **No retry on LLM agent failures** — a transient 429 or 503 drops the chunk silently | `run_agent_timed()` in `chunk_graph.rs:50-56` returns original state on error; no retry | Transient errors produce missing cards with no user feedback. Adding retry adds risk of duplicate events if not idempotent. | **OPTIONAL AT SCALE** |

---

## E. DATABASE FINDINGS

### E1. Missing Indexes

| Table | Queried On | Index Exists? | Impact |
|---|---|---|---|
| `transcripts` | `meeting_id` + `ORDER BY timestamp` | ❌ No | Full scan on history detail load |
| `decisions` | `meeting_id` + `ORDER BY timestamp` | ❌ No | Full scan |
| `action_items` | `meeting_id` + `ORDER BY timestamp` | ❌ No | Full scan |
| `technical_analyses` | `meeting_id` + `ORDER BY timestamp` | ❌ No | Full scan |
| `suggested_replies` | `meeting_id` + `ORDER BY timestamp` | ❌ No | Full scan |
| `speaker_embeddings` | No filter — full scan intentional | — | Grows O(N) |
| `chunks` | `meeting_id, seq` | ✅ Yes | Good |
| `risks` | `meeting_id` | ✅ Yes | Good |
| `speaker_profiles` | PK `(meeting_id, speaker)` | ✅ Yes (PK) | Good |
| `llm_requests` | `ts`, `tag`, `status` | ✅ Yes | Good |

**N+1 Check:** No N+1 patterns found. `get_meeting_details` issues exactly 5 separate queries by design (one per artifact type). This is acceptable and not N+1 in the classic sense (no loop over results that then queries again).

### E2. Pagination

- `get_meetings` (`sqlite.rs:46-56`) — no LIMIT. Returns all meetings. For a personal desktop app with ~hundreds of meetings this is acceptable. **SUSPECTED** risk at very high meeting counts.
- `get_meeting_details` — no pagination on transcripts, decisions, etc. A very long meeting could return a large payload. **LOW** risk for current use.
- Dashboard `/api/requests` — **has** pagination (`LIMIT/OFFSET`, max 500). ✅ Good.

### E3. Connection Management — Critical Finding (PERF-002)

The `UsageStore::record()` function in [`usage_store.rs`](file:///Users/manthan/final%20code%20of%20the%20meeting%20/meeting-interpreter-mac-main/meeting-interpreter-mac-main/src-tauri/src/agents/adapters/usage_store.rs#L103-L114):
```rust
pub fn record(entry: UsageEntry) {
    let conn = Connection::open(&db_path)?;    // ← New connection every call
    let _ = conn.pragma_update(None, "journal_mode", "WAL");
    let _ = conn.busy_timeout(Duration::from_millis(3000));
    conn.execute_batch(SCHEMA)?;               // ← Schema creation attempted every call
    ...
    conn.execute(...)?;
    // conn dropped = connection closed
}
```
This runs for **every single LLM call**. On a Medium-complexity chunk: 4 LLM calls = 4 full open/migrate/insert/close cycles. On a High chunk: 6 cycles. At 3 concurrent pipeline tasks this means potentially 18 sequential DB connections being opened and closed per ~5 seconds.

The `better-sqlite3` gateway DB does not have this problem — it opens once at startup and reuses a singleton.

---

## F. API FINDINGS (LLM Pipeline)

### F1. No LLM Call Timeout (PERF-001 — P1)

The `openai_adapter.rs` `complete()` and `complete_json()` methods call `agent.prompt(user).await` with **no timeout**. If the OpenAI API hangs (TCP stall, connection reset delay), the future will await indefinitely.

- **Impact:** A hung call holds a `PIPELINE_SEMAPHORE` permit. Two concurrent hangs (possible) reduce effective pipeline parallelism from 3 to 1. At 3 hangs, the pipeline stalls entirely.
- **Proposed fix:** Wrap with `tokio::time::timeout(Duration::from_secs(30), agent.prompt(user)).await` and propagate as error.
- **Risk:** LOW. Adding a timeout has no behavioral change under normal conditions.

### F2. No LLM Retry Logic

On any LLM failure, `run_agent_timed` returns the original `state` unchanged. There is no retry for transient errors (429, 503, network blip). This is a **deliberate design choice** (as the comment notes — one crash never kills the pipeline). The tradeoff is that transient errors silently produce degraded output.

- **Evidence level:** CONFIRMED
- **Impact:** LOW for occasional errors; could become noticeable during OpenAI rate-limit storms
- **Note:** Adding retry requires careful handling — the response agent must not fire twice for the same chunk.

### F3. Prompt Sizes Are Not Bounded on the User Side

`context_manager.rs` passes `state.conversation_summary` (potentially growing each chunk) and `state.chunk_text` directly into the user prompt. `response_agent.rs` passes both `state.explanation` and `state.technical_explanation`. These are not truncated before being sent to the LLM, which could silently inflate token usage over a long meeting.

- **Evidence:** `CONFIRMED` — no truncation in agent run() methods.
- **Impact:** Gradually increasing token cost per call over a long meeting. The `UsageStore` truncates for *recording* at 16,000 chars, but the actual API call is unbounded.
- **Severity:** P3

### F4. External API Dependencies

| Service | Timeout | Retry | Fallback | Rate Limit Handling |
|---|---|---|---|---|
| OpenAI (LLM) | ❌ None | ❌ None | Complexity default=Medium | Semaphore prevents storm |
| AssemblyAI (STT) | ✅ (WebSocket reconnect) | ✅ (ring buffer) | Speechmatics | Not explicit |
| Speechmatics | ✅ | ✅ | Exhausted event | Not explicit |

---

## G. FRONTEND / REACT FINDINGS

### G1. Transcript Line Array Unbounded (PERF-006)

In [`useTranscript.ts:33`](file:///Users/manthan/final%20code%20of%20the%20meeting%20/meeting-interpreter-mac-main/meeting-interpreter-mac-main/src/features/transcript/useTranscript.ts#L33):
```ts
setLines(prev => [...prev, line]);
```
Every final transcript event spreads the entire lines array and adds one entry. For a 2-hour meeting at ~1 line per 5 seconds, this is ~1440 array spreads + React reconciliation. The array itself is never trimmed.

- **Evidence:** CONFIRMED
- **Impact:** Long meetings will see progressively slower state updates. The spread creates a new array reference which React uses to detect changes — this is functionally correct but creates allocation pressure.
- **Proposed fix:** Cap `lines` at the last N entries (e.g., 500) for the live view. Full history is always available from the DB.

### G2. No Rebuilds from Broad Context

No `ServicesProvider` or broad state triggers were found that would cause excessive rebuilds. The `useServices` hook reads a stable context, and each feature subscribes narrowly via Tauri event listeners. **No rebuild issues detected.**

### G3. Suggest Cards Accumulate Without Bound

Similar to transcript lines, `cards` in `useSuggestAnswers` grow without bound. Cards can be removed by the user (`removeCard`), but if the user never dismisses them, the array and the `seenIds` Set grow for the entire session.

- **Evidence:** CONFIRMED
- **Impact:** VERY LOW in practice (suggestions are low-frequency), but theoretically unbounded.
- **Severity:** P4

---

## H. MEMORY + CPU FINDINGS

### Confirmed Issues

**H1. Connection-per-LLM-call in UsageStore (`usage_store.rs:103-114`)**
Each `record()` call allocates a DB connection, runs schema creation, inserts, and drops the connection. This generates unnecessary heap allocations and OS file-handle churn at the rate of 4–6× per pipeline chunk.

**H2. Three Vec allocations per 250ms audio callback (`mac_audio.rs:412-439`)**
Each call to `process_and_send` allocates a `Vec<f32>` for downmix, a second `Vec<f32>` from the resampler, and a third `Vec<i16>` for PCM16 conversion. At 4 callbacks/second this is 12 Vec allocations/second, all short-lived. The allocator will reuse memory quickly but this could be improved with pre-allocated buffers.

### Suspected Issues (Requires Profiling)

**H3. `speaker_embeddings` full-load on every `buildEmbedding()`**
If a user has run 50+ meetings and each had 3 speakers, `getAllSpeakerEmbeddings()` loads all rows (potentially 150+ entries with full JSON embedding arrays) into memory per invocation. The in-memory cosine search is O(N). Confirmed by code; actual timing requires profiling.

**H4. `PipelineTrace.log_summary()` builds a multi-line String and calls `tracing::info!` per chunk**
This allocates and formats a string on every processed chunk. In production at `info` level this fires for every non-filler chunk. Low cost individually; at high meeting frequency could create tracing overhead.

---

## I. CACHE + REDIS DECISION

### Redis Status: **NOT NEEDED**

**Reasoning:**
- This is a single-user macOS desktop application. There is only one user, one session, and one process tree.
- There is no shared cache invalidation problem.
- There is no distributed session management.
- There is no multi-server deployment.
- All state that needs to be shared between components (Rust ↔ React) uses Tauri's built-in event system.

**In-process caching opportunities that make sense (no Redis):**

| Data | Current | Opportunity | TTL Suggestion |
|---|---|---|---|
| `llm_usage.db` connection | Re-opened per call | Lazy singleton `OnceLock<Mutex<Connection>>` | Session lifetime |
| `get_meetings` result | Re-queried per UI view | In-memory cache invalidated on `end_meeting` | 30 seconds |
| `speaker_names` DB lookup | Per-label DB read in `resolveOrCreateSlot` | In-memory Map (already done in sessionSpeakers) | Session |
| AssemblyAI speaker embeddings | All loaded per `buildEmbedding` | Load once at session start + incremental additions | Session |

---

## J. LOAD SCALABILITY MODEL

This is a **single-user local desktop application**. Traditional load models do not apply. The relevant model is: **what happens as a single meeting session runs longer?**

| Dimension | Current Traffic (1 meeting) | Long Meeting (2h) | Very Long (4h+) |
|---|---|---|---|
| Transcript lines in React | ~50 | ~1,440 | ~2,880 — noticeable state update lag |
| `speaker_embeddings` rows | ~3–10 | ~3–10 | Stable (per-meeting, not cumulative) |
| `llm_usage.db` rows | ~100/hour | ~200 | DB stays fast; indexed on `ts` |
| `meeting_history.db` transcripts | ~50–100 | ~1,440+ | Unindexed `meeting_id` scan slows on history load |
| LLM semaphore pressure | Depends on speech rate | Same | Same — bounded by `Semaphore(3)` |
| OpenAI API cost | ~$0.01–0.05/hour | ~$0.02–0.10 | Predictable linear growth |

**Across many meetings (accumulated data):**

| Metric | 10 meetings | 100 meetings | Risk |
|---|---|---|---|
| `transcripts` unindexed scan | Fast (small) | Slow (large) | MEDIUM — add index |
| History tab load time | Fast | Degrading | MEDIUM |
| Dashboard queries | Fast | Fast (indexed on `ts`, `tag`, `status`) | LOW |

---

## K. TOP 10 BOTTLENECKS

| Rank | Bottleneck | Evidence | Impact | Root Cause | Recommended Fix | Benefit | Risk | Mandatory |
|---|---|---|---|---|---|---|---|---|
| 1 | **No LLM timeout** | `openai_adapter.rs`, no `tokio::time::timeout` | A hung API call permanently holds a semaphore permit; 3 hangs = pipeline stall | rig-core `prompt()` has no built-in deadline | `tokio::time::timeout(30s, ...)` wrapping each LLM call | Large — prevents deadlock under network issues | LOW | **MANDATORY NOW** |
| 2 | **DB connection per LLM usage record** | `usage_store.rs:111-114` | 4–18 DB open/SCHEMA/insert/close cycles per pipeline chunk (~every 10-15s) | `UsageStore::record()` is a free function with no persistent connection | `OnceLock<Mutex<Connection>>` singleton, schema run once at first access | Moderate — reduces I/O churn | LOW | **MANDATORY NOW** |
| 3 | **Missing index on `transcripts(meeting_id)`** | `sqlite.rs:83`, no index | Full table scan on history detail load; degrades with meeting count | Table predates indexing decisions | `CREATE INDEX IF NOT EXISTS idx_transcripts_meeting ON transcripts(meeting_id, timestamp)` | Moderate — eliminates scan | LOW — index only, no query change | **RECOMMENDED** |
| 4 | **Missing indexes on decisions/actions/analyses/replies** | `sqlite.rs:96,106,117,127` | 4 unindexed scans on meeting detail view | Same as above | 4 compound indexes on `(meeting_id, timestamp)` | Small per query, large per view over time | LOW | **RECOMMENDED** |
| 5 | **Unbounded transcript lines array in React** | `useTranscript.ts:33` | Increasing spread cost + memory over long meetings | Append-only with no eviction | Cap `lines` at last 500 entries for live view | Moderate for long meetings | LOW — visual-only change | **RECOMMENDED** |
| 6 | **Speaker embeddings full-load per buildEmbedding** | `diarization-layer.js:140` | O(N) memory + CPU for cross-session matching as embedding count grows | No caching or lazy-load of embeddings | Load embeddings once at session start; use an in-memory array; invalidate only on `saveSpeakerEmbedding` | Moderate for sessions with many historical speakers | LOW | **RECOMMENDED** |
| 7 | **Unbounded prompt size** | `context_manager.rs`, `response_agent.rs` | Token cost grows as conversation_summary and explanation accumulate | No truncation in agent user prompts | Cap `conversation_summary` at ~500 chars and `explanation` at ~800 chars before formatting the prompt | Small — cost reduction + latency stability | MEDIUM — could clip useful context | **RECOMMENDED** |
| 8 | **No retry on transient LLM errors** | `chunk_graph.rs:50-56` | Transient 429/503 silently drops agent output | Deliberate but incomplete — no user signal | Add 1 retry with 1s backoff for `status != 200` on non-response agents | Small — improves reliability | MEDIUM — retry must be idempotent | **OPTIONAL AT SCALE** |
| 9 | **3 Vec allocations per audio callback** | `mac_audio.rs:399-447` | Allocation pressure at 4 callbacks/second | Pipeline-oriented data transform without pre-allocation | Pre-allocate reusable buffers per stream; use in-place mutation where rubato allows | Small | MEDIUM — audio pipeline, careful testing needed | **OPTIONAL AT SCALE** |
| 10 | **`get_meetings` table-existence check on every call** | `sqlite.rs:36-44` | 2 DB round trips per call instead of 1 | Defensive check for fresh DB that should be removed after migrations run | Remove `sqlite_master` check; let `SELECT` fail gracefully if table missing | Negligible | LOW | **OPTIONAL AT SCALE** |

---

## L. QUICK WINS

> Low-risk, high-value — can be implemented safely in a short session.

1. **PERF-001:** Add `tokio::time::timeout(Duration::from_secs(30), ...)` around `agent.prompt()` in `openai_adapter.rs`. 3 lines of change. Prevents indefinite semaphore lock.

2. **PERF-002:** Add `OnceLock<Mutex<Connection>>` singleton to `UsageStore`. Run `execute_batch(SCHEMA)` only once on first access. Eliminates repeated open/migrate cycles.

3. **PERF-003/004:** Add 5 `CREATE INDEX IF NOT EXISTS` statements to the migration runner (version 8). Zero risk — indexes are build-once, never affect existing behavior.

4. **PERF-006:** Cap `useTranscript` lines at last 500 entries: change `setLines(prev => [...prev, line])` to `setLines(prev => [...prev.slice(-499), line])`. One-line fix.

---

## M. DO NOT CHANGE

The following are well-designed and should remain untouched:

- **`PIPELINE_SEMAPHORE(3)` + `DETACHED_SEMAPHORE(4)` architecture** — Do not change these values or the shed vs. queue decision without profiling actual meeting load.
- **Stage 1 concurrent join pattern** in `chunk_graph.rs` — Correct and optimal.
- **`chit_chat_gate` filler detection** — Do not add regex here; the current prefix/exact approach is O(1) and reliable.
- **`better-sqlite3` prepared statement pattern** in `gateway/db/index.js` — Already optimal.
- **5-second batch transcript flush** — Correct balance of write frequency vs. crash safety.
- **Complexity default = Medium** — The safe fallback is intentional. Do not change.
- **`run_agent_timed()` error swallowing** — Correct isolation. One agent failure must never kill the pipeline.
- **WAL mode on all three databases** — Required for concurrent access. Do not change.
- **React event listener cleanup pattern** — Already correct.
- **Dashboard pagination (max 500)** — Correct. Do not remove or raise the limit significantly.

---

## N. PROFILING / BENCHMARKS REQUIRED

The following cannot be confirmed from static analysis alone:

1. **LLM call latency distribution (p50/p95/p99)** — The `llm_usage.db` contains this data. Run `SELECT latency_ms FROM llm_requests WHERE status='ok' ORDER BY latency_ms` to compute. The dashboard's `/api/latency-histogram` already exposes a bucketed view.

2. **Actual semaphore saturation rate** — How often does the pipeline queue behind the semaphore? Add a counter or use the existing `tracing::debug` output.

3. **Audio mixer thread CPU usage** — The `recv_timeout(50ms)` loop is efficient but verify it doesn't spin on high-load machines with `Instruments.app → CPU Profiler`.

4. **`speaker_embeddings` row count in practice** — Query: `SELECT COUNT(*) FROM speaker_embeddings` in `meeting_history.db`. If < 100 rows, PERF-005 is negligible. If > 1000, it is significant.

5. **React render frequency during active meeting** — Use React DevTools Profiler to confirm `TranscriptPane` does not re-render more than once per `partialsTick` increment.

6. **`UsageStore` connection open latency** — Measure `Connection::open()` + `execute_batch(SCHEMA)` cost. On macOS with WAL, this is likely 2–5ms per call. At 6 calls/chunk × 3 concurrent = 18 open/close cycles per ~10s window.

7. **Transcript lines render performance at 1000+ lines** — Open a long meeting recording and scroll the transcript pane. If there is visible jank, virtualization is needed.

---

## O. APPROVAL PLAN

### Batch 1 — Mandatory P1 Fixes (Low Risk)
**Estimated time: 1–2 hours**

| ID | Fix | Files Affected |
|---|---|---|
| PERF-001 | Add 30s `tokio::time::timeout` to LLM calls | `src-tauri/src/agents/adapters/openai_adapter.rs` |
| PERF-002 | Singleton DB connection in `UsageStore` | `src-tauri/src/agents/adapters/usage_store.rs` |

- **Risk:** LOW. No behavioral change. Timeouts only fire on genuine hangs.
- **Expected benefit:** LARGE (PERF-001), MODERATE (PERF-002)

---

### Batch 2 — Database Index Additions (Low Risk)
**Estimated time: 30 minutes**

| ID | Fix | Files Affected |
|---|---|---|
| PERF-003/004 | Add migration version 8 with 5 compound indexes | `gateway/db/migrate.js` |

- **Risk:** LOW. Indexes are additive; they never break existing queries.
- **Expected benefit:** MODERATE for history loading after 10+ meetings.

---

### Batch 3 — Frontend & Memory Improvements (Low Risk)
**Estimated time: 1 hour**

| ID | Fix | Files Affected |
|---|---|---|
| PERF-006 | Cap transcript lines at 500 | `src/features/transcript/useTranscript.ts` |
| PERF-007 | Remove redundant `sqlite_master` check | `src-tauri/src/adapters/sqlite.rs` |

- **Risk:** LOW. The cap is visual-only; full history is always in DB.

---

### Batch 4 — Optional / Scale Improvements
**Implement only after Batch 1–3 and with profiling data.**

| ID | Fix | Files Affected |
|---|---|---|
| PERF-005 | Load speaker embeddings once at session start | `gateway/stt/diarization-layer.js`, `gateway/db/index.js` |
| PERF-007 (prompt sizing) | Truncate prompts in agents | `context_manager.rs`, `response_agent.rs` |
| PERF-010 | 1× retry on transient LLM errors | `chunk_graph.rs` |

- **Risk:** MEDIUM — requires careful testing of each.

---

## AUDIT COMPLETE — NO FILES OR CODE HAVE BEEN MODIFIED.

**Approval Menu:**

- `Approve Batch 1` — Fix the P1 LLM timeout + UsageStore connection issues
- `Approve Batch 2` — Add 5 missing database indexes via migration
- `Approve Batch 3` — Frontend transcript cap + minor DB cleanup
- `Approve Batch 1 and Batch 2 only`
- `Approve all MANDATORY NOW fixes` (= Batch 1)
- `Request deeper analysis of PERF-XXX` — specify which finding
- `Do not modify anything`
