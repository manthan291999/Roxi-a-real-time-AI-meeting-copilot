# AI Meeting Interpreter ("Roxi") — System Architecture

> **Scope:** Full architecture of the Tauri v2 macOS desktop copilot that listens to live meetings, transcribes them in real time, and routes transcript chunks through a multi-agent LLM pipeline producing plain-language explanations, suggested replies, decisions, action items, and risks — plus a RAG chatbot over meeting history and a developer LLM-usage dashboard.
>
> **Tech stack:** Rust (Tauri 2, cpal, rubato, rig-core, rusqlite) · Node.js (better-sqlite3, AssemblyAI SDK, LangGraph/LangChain) · React 19 + TypeScript + Vite + Tailwind · SQLite ×3.
>
> Every claim in this document is verified against the current source (`src-tauri/`, `gateway/`, `chatbot/`, `src/`, `dashboard/`).

---

## 1. Process Architecture — 4 Concurrent Processes (+1 optional)

```
┌────────────────────────────────────────────────────────────────────┐
│  PROCESS 1: Tauri Core (Rust)          ← the orchestrator           │
│  src-tauri/ · hexagonal ports/adapters · spawns & owns 2+3         │
└──────────────┬──────────────────────────────────┬──────────────────┘
               │ stdin (binary PCM frames)         │ line-JSON events
               ▼                                   ▲
┌──────────────────────────────┐   ┌───────────────┴────────────────┐
│ PROCESS 2: gateway/sidecar.js│   │ PROCESS 3: chatbot/sidecar.js    │
│ STT pipeline (AssemblyAI →   │   │ LangGraph Adaptive-RAG chatbot   │
│ Speechmatics fallback)       │   │ over meeting_history.db (FTS5)   │
└──────────────────────────────┘   └─────────────────────────────────┘
               ▲                                   ▲
┌──────────────┴───────────────────────────────────┴─────────────────┐
│  PROCESS 4: React WebViews (3 windows: main · toolbar · caption)   │
│  Vite dev server :1420 · HashRouter routes #/toolbar #/caption     │
└─────────────────────────────────────────────────────────────────────┘
   (OPTIONAL PROCESS 5: dashboard/server.js — Express :3300, read-only)
```

**IPC contract:**

- Rust ↔ Node sidecars: **stdio** — binary PCM frames in, line-delimited JSON events out.
- Rust ↔ React: **Tauri commands** (invoke, request/response) and **Tauri events** (emit/listen, push).
- Node sidecars never talk to each other or to the UI directly; the Rust core is the sole message broker.

**Window topology** (`tauri.conf.json` + `lib.rs` setup):

| Label | Size | Route | Notes |
|---|---|---|---|
| `main` | 420×780 | `#/` | Roxi widget: Suggest / Ask / Listen tabs |
| `toolbar` | 480×52 | `#/toolbar` | Floating always-on-top toolbar |
| `caption` | 600×48 | `#/caption` | Live-caption overlay |

All three run as transparent, borderless, always-on-top macOS overlays (`macos_overlay::make_overlay`, Accessory activation policy — no Dock icon). `Option+Space` is a registered global shortcut; a tray icon (Show/Hide/Quit) is the only other entry point.

---

## 2. End-to-End Audio → Insight Data Flow

```
 Mic (cpal input stream) ──┐
                           ├─► downmix mono ─► rubato FFT resample → 16kHz f32
 System audio (BlackHole) ──┘         (mac_audio.rs + resample.rs)
                                          │
                                          ▼ f32→PCM16, buffered
                              StreamingSink (streaming.rs)
                              frames: "PCM1" magic + LE u32 len + payload
                              4000 samples ≈ 250 ms per chunk
                                          │ stdin
                                          ▼
                        PcmDeframer (gateway/audio/pcm-deframer.js)
                                          │
                                          ▼
                        ProviderManager (stt/provider-manager.js)
                        ├─ AssemblyAI Universal-3-5-Pro WS (speaker labels)
                        └─ Speechmatics (auto failover + 5s ring-buffer replay)
                                          │ 'partial' / 'final' events
                                          ▼
                        DiarizationLayer (stt/diarization-layer.js)
                        resolveLabel() · MFCC embeddings · cross-session rename
                                          │
                                          ▼
                        sanitizer → validate → db.saveTranscript (batched 5s)
                                          │ stdout: {"type":"Final",...}
                                          ▼
                        event_router.rs (Rust) ──► Tauri emit ──► React
                                          │
                     ┌────────────────────┴──────────────────────┐
                     ▼                                             ▼
        emit("transcript_final") instantly        ChunkGraph.run() under Semaphore(3)
        (UI never blocked by LLM)                  — the multi-agent LLM pipeline —
```

Stage-by-stage:

1. **Hybrid capture** (`src-tauri/src/adapters/mac_audio.rs`): cpal opens the default **input** device (mic) and the loopback **output** device (system audio via BlackHole). Each stream is downmixed to mono, resampled to 16 kHz (`resample.rs`, rubato `FftFixedIn`, 1024-frame blocks with internal buffering), converted f32 → PCM16, and sent over an mpsc channel to a mixer thread that feeds the sink.
2. **Framing** (`streaming.rs`): `StreamingSink` buffers samples and emits fixed **4000-sample (250 ms)** frames, each with an 8-byte header — `PCM1` magic + little-endian u32 payload length — written to the gateway sidecar's stdin.
3. **Deframing** (`gateway/audio/pcm-deframer.js`): mirrors the framing format, scans forward for the magic bytes on desync, caps payload at 64 KiB.
4. **STT failover** (`stt/provider-manager.js`): ordered provider chain — AssemblyAI first, Speechmatics second. On active-provider death it fails over to the next (or reconnects the last one with backoff), replaying a **~5 s ring buffer** so the connect gap loses no speech. Auth failures (401/403) abort retries immediately. A `final` result clears the ring so a later switchover cannot duplicate it.
5. **Diarization** (`stt/diarization-layer.js`): STT labels (`Speaker A`…) resolve to display names via in-session renames → persisted `speaker_names` → raw label. MFCC voice embeddings (cosine similarity ≥ 0.85) are built per final and persisted in `speaker_embeddings` for cross-session matching.
6. **Sanitization & persistence**: `transcript-sanitizer.js` drops garbage/low-confidence finals; `validate.js` sanitizes everything before `db.saveTranscript` (batched 5 s flush; low-frequency artifacts write immediately). DB failures never throw into the live pipeline.
7. **Event routing** (`src-tauri/src/sidecar/event_router.rs`): parses each line-JSON event from the gateway sidecar, re-emits it as a Tauri event, and — for `Final` — spawns the ChunkGraph LLM pipeline under a concurrency semaphore.

---

## 3. The Multi-Agent LLM Pipeline (Rust `ChunkGraph`)

Verified in `src-tauri/src/agents/orchestrator/chunk_graph.rs` + `routing.rs` — a **fast lane / slow lane** hybrid:

```
Final chunk
    │
    ▼
Stage 0  chit_chat_gate (chit_chat_gate.rs)  ── LOCAL, zero LLM.
    │     Exact/prefix filler lists; caught filler = pipeline exits here.
    ▼
Stage 1  ┌ context_manager ┐  ┌ explanation ┐   CONCURRENT (join_all)
         │ (gpt-4o-mini)   │  │             │
         │ topic + summary │  └─────────────┘
         │ + glossary terms│
         │ + complexity    │  ← PERF FIX #5: classification folded in —
         └────────┬────────┘     one LLM hop instead of two
                  ▼
Stage 2  routing::decide(complexity)   — pure, unit-tested decision table:
         ┌─────────┬───────────────────────┬───────────────────────────┐
         │  Low    │ explanation only       │ reply SKIPPED (cost saver) │
         │  Medium │ + risk (detached)      │ 2 hops on critical path    │
         │  High   │ + technical (awaited)   │ 3 hops                     │
         │         │   + risk & analyst      │                            │
         │         │   (DETACHED slow lane) │                            │
         └─────────┴───────────────────────┴───────────────────────────┘
                  ▼
Stage 3  response_agent (premium model gpt-5.6-luna)
         synthesises chunk + explanation + technical → suggested reply
         + context_items with match_confidence (is_verbatim derived ≥ threshold)
```

**Model routing** (`lib.rs`): fast model `gpt-4o-mini` powers context_manager, explanation, technical, analyst, and risk agents (each with its own tagged `OpenAiAdapter` so usage is attributable per agent); only `response_agent` uses the premium model.

**Backpressure & resilience (verified):**

- `PIPELINE_SEMAPHORE = 3` — reply-path concurrency cap (prevents API 429s / stale out-of-order replies).
- `DETACHED_SEMAPHORE = 4` — slow lane **sheds** (drops) risk/analyst work when saturated instead of queueing: stale risks arriving late are worth less than not spending the call.
- `run_agent_timed()` — every agent error is swallowed & traced; one failure never kills the pipeline.
- Complexity default = **Medium** — safe fallback if context_manager fails or omits the field.
- LLM adapter (`openai_adapter.rs`, via **rig-core**) extracts JSON by first `{` → last `}`, handles markdown fences, and records every call (latency, prompts, errors) into `llm_usage.db` via `UsageStore`.

---

## 4. Subsystem Map (file-by-file verified)

### 4.1 Rust core — `src-tauri/src/` (hexagonal)

| Layer | Files | Role |
|---|---|---|
| **domain/** | `meeting.rs`, `audio.rs` | Core entities (Meeting, MeetingDetails) |
| **ports/** | `audio_capture`, `gateway`, `db`, `chat_gateway` | Traits: `AudioCapture`, `PcmSink`, `GatewayClient`, `Database`, `ChatGatewayClient` |
| **adapters/** | `mac_audio.rs` (cpal mic+loopback, mixer thread), `gateway_client.rs` (spawns gateway sidecar; SIGTERM → 15 s deadline → kill), `chat_client.rs` (spawns chatbot sidecar), `sqlite.rs` (rusqlite read path), `openai_adapter.rs` (rig LLM) | Concrete tech |
| **application/** | `capture_usecase.rs` | start/stop orchestration: sidecar → StreamingSink → audio capture |
| **agents/domain/** | `chunk_state.rs`, `decision.rs`, `action_item.rs`, `risk.rs`, `context_item.rs`, `agent_error.rs`, `pipeline_trace.rs` | 7 state types shared across the pipeline |
| **agents/ports/** | `agent_port.rs` (`Agent` trait), `llm_port.rs` (`LlmClient` trait) | Agent & LLM abstractions |
| **agents/agents/** | `context_manager`, `explanation`, `technical`, `analyst`, `risk_detector`, `response_agent`, `chit_chat_gate`, `complexity_analyzer` | Agent implementations |
| **agents/orchestrator/** | `chunk_graph.rs`, `routing.rs` (+ unit tests) | Execution graph & routing |
| **agents/adapters/** | `openai_adapter.rs`, `usage_store.rs` | rig-based LLM + usage persistence |
| **commands/** | `capture`, `chat`, `db`, `overlay`, `audio_devices` | 10 registered Tauri commands |
| **sidecar/** | `event_router.rs` (routes 15+ event types → Tauri emits), `events.rs` (serde DTOs), `chat_events.rs` | Event bridge |
| **misc** | `streaming.rs`, `resample.rs`, `wav_sink.rs`, `macos_overlay.rs` (NSWindow non-activating overlay) | Audio & window plumbing |
| **lib.rs** | — | DI wiring: 6 agents with per-agent tagged LLM adapters, tray icon, Option+Space global shortcut, Accessory activation policy, 3 overlay windows |

### 4.2 Gateway sidecar — `gateway/` (Node.js STT pipeline)

| Area | Files | Role |
|---|---|---|
| Entry | `sidecar.js` | Env (root `.env` → fallback), role profiles (pm / tech_lead / client / designer / executive → user_profile), provider chain, event JSON emission |
| STT failover | `stt/provider-manager.js` | Ordered chain, per-provider retry policies, auth-failure detection (no retry on 401), ~5 s ring buffer replayed on switchover |
| Diarization | `stt/diarization-layer.js` | Speaker label → display name (in-session → DB `speaker_names` → raw); MFCC embeddings (`providers/mfcc.js`, cosine ≥ 0.85) persisted in `speaker_embeddings` |
| Sanitizer | `stt/transcript-sanitizer.js` | Drops low-quality/garbage finals |
| Providers | `providers/assemblyai.js` (Universal-3-5-Pro, speaker labels ≤ 4, `formatTurns`, PENDING-speaker fallback, confidence averaging), `providers/speechmatics.js` | STT vendor adapters |
| Persistence | `db/index.js` + `db/migrate.js` | better-sqlite3, WAL, idempotent base schema + forward-only migrations, 5 s batched transcript flush, all saves non-throwing |
| Lifecycle | `lifecycle/shutdown.js` | Fallback Markdown summary from aggregates → `endMeeting(summary, status)` |
| State | `state/meeting-state.js` (rolling buffers, LRU glossary ≤ 100, dup-suggestion similarity 0.82), `state/prompt-builder.js`, `state/speaker-tracker.js` | In-memory meeting state |
| Infrastructure | `infrastructure/` — `validate.js`, `logger.js`, `text-similarity.js`, `usage-store.js` | Cross-cutting helpers |

### 4.3 Chatbot — `chatbot/` (LangGraph Adaptive-RAG)

- `sidecar.js` → `src/composition/container.js` (hand-rolled DI composition root — the only module that knows concrete implementations).
- `application/graph/buildChatGraph.js` topology:

```
START → analyze_query → retrieve(FTS5) → grade_documents ─┬─ generate ──► END
                              ▲                          ├─ clarify ───► END
                              └── rewrite (corrective    ├─ no_data ───► END
                                   loop)
```

- `MemorySaver` checkpointer → multi-turn follow-ups per `threadId`.
- `CallCountBudgetGuard` (soft/hard limits); `UsageRecorder` → shared `llm_usage.db`.
- `transport/stdioSidecar.js` protocol: in `Ask` / `RebuildIndex` / `Shutdown`; out `Ready` / `ChatThinking` / `ChatReply` / `IndexRebuilt` / `Error` / `Bye`. Busy-lock prevents concurrent questions; index rebuild-if-stale on boot.
- `bin/ask.js` (CLI REPL) and `bin/rebuild-index.js` (index-only tool, LLM-skipped).
- 6 test suites: routing, graph, json-parse, fts-query, evidence, persistence.

### 4.4 React frontend — `src/` (layered + feature-sliced)

```
main.tsx (HashRouter: /, /toolbar, /caption)
 └ App.tsx → ChatProvider → useCaptureFlow → 3 tabs (suggest | ask | listen)
interfaces/  ICaptureService, IEventBus, IChatService, IHistoryRepository  ← ports
services/    TauriCaptureService, TauriEventBus (17 event listeners),
             TauriChatService, TauriHistoryRepository, SpeakerRepository,
             mappers/ (wire→UI models), wire/ (backend payload types)
context/     ServicesProvider + useServices  (DI container)
features/    capture (IdleScreen, context-intake modal), transcript, suggest,
             chat, analysis, history, toolbar, caption
design-system/  tokens, GlassCard, TagChip, Waveform, preSessionTheme…
utils/       deduplicateCards (content-hash id), speaker colors
```


### 4.5 Dashboard — `dashboard/` (Express, read-only)

- Serves SPA from `public/` + REST API over the **shared** `gateway/llm_usage.db` (opened `readonly`; graceful "no data" degradation when the file is missing).
- Endpoints: `/api/health`, `/api/summary` (totals/cost/avg + p95 latency), `/api/timeline` (auto minute/hour buckets), `/api/sessions` (grouped by pid), `/api/latency-histogram`, `/api/requests` (+filters), `/api/codemap` (every LLM call site in the codebase).
- Written by **two producers**: Rust `UsageStore` (capture pipeline) and chatbot `UsageRecorder`. Privacy toggle: `LLM_TRACK_PAYLOADS=0` disables prompt storage.

---

## 5. Storage Topology

| DB | Owner | Contents |
|---|---|---|
| `gateway/meeting_history.db` | gateway writes; Rust reads (history UI); chatbot reads (FTS5 index over it) | 13 tables: meetings, transcripts, chunks, decisions, action_items, risks, technical_analyses, suggested_replies, summaries, glossary_terms, speaker_profiles, speaker_names, speaker_embeddings |
| `gateway/llm_usage.db` | Rust `UsageStore` + chatbot `UsageRecorder` write; dashboard reads | Every LLM call: tokens, latency, cost, prompts, errors, per-agent source tag |
| chatbot FTS index DB | chatbot-owned | `chatbot_index.db`, rebuild-if-stale on sidecar boot |

## 6. Tauri Event & Command Catalog

### Commands (invoke, frontend → Rust)

| Command | File | Purpose |
|---|---|---|
| `start_capture(context?, role?)` | `commands/capture.rs` | Start sidecar + audio capture |
| `stop_capture` | `commands/capture.rs` | Stop both |
| `check_blackhole_installed` | `commands/audio_devices.rs` | System-audio prerequisite check |
| `get_meetings` / `get_meeting_details(id)` | `commands/db.rs` | History from SQLite |
| `ask_chat(question, threadId?, history?)` | `commands/chat.rs` | Route a question to the chatbot sidecar |
| `close_chat` | `commands/chat.rs` | Stop the chatbot sidecar |
| `hide_toolbar` / `toggle_toolbar` / `toggle_caption` | `commands/overlay.rs` | Window visibility |

### Events (emit, Rust → frontend)

`transcript_partial`, `transcript_final`, `context_explanation`, `technical_explanation`, `chunk_significance`, `meeting_decisions`, `meeting_action_items`, `meeting_risks`, `suggest_answer`, `suggested_response`, `agent_trace`, `circuit_breaker`, `api_health`, `billing`, `speaker_revision`, `meeting_summary`, `provider_status`, `capture_error`, `chat_reply`, `chat_thinking`, `chat_error`.

## 7. Launch & Operational Notes

- **`run.sh`** — prerequisite checks → `.env` validation (OPENAI_API_KEY + one STT key required) → npm installs (root, gateway, chatbot, dashboard) → `cargo check` → dashboard (background, port-tracked, cleanup trap on exit) → `npm run tauri dev` (foreground).
- **Graceful shutdown chain** — UI stop → Rust SIGTERM to sidecar (15 s deadline → force kill) → sidecar flushes transcript batches → fallback Markdown summary → `endMeeting` → exit. Chatbot sidecar additionally receives a `{"type":"Shutdown"}` protocol message first.
- **Audit status** (`audit/CODE-AUDIT-REPORT.md`) — 1 critical (plaintext keys in `gateway/.env`), 4 high (CSP `null`, `withGlobalTauri: true`, CWD-relative sidecar path, unauthenticated stdin protocol). These remain present in the current source (`tauri.conf.json`, `gateway_client.rs`) as of this document's writing.

## 8. Key Design Decisions

1. **Separation of speed from quality** — fast model (gpt-4o-mini) on classification/enrichment agents; premium model only on final reply synthesis.
2. **Latency-first fast lane** — transcript finals hit the UI instantly; LLM work runs behind a bounded semaphore; risk/analyst are detached and *shed* under load.
3. **Fail-open everywhere** — missing complexity → Medium; agent error → traced + skipped; DB failure → logged, never kills live capture.
4. **Ports & adapters in all three languages** — Rust traits, JS composition roots with injected deps, TS interfaces — each subsystem independently testable (Rust unit tests on routing; 6 chatbot test suites).
5. **Cost observability as a first-class feature** — every LLM call tagged by agent name and persisted for the dashboard.
