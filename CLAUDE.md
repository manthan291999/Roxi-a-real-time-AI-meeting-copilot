# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Roxi — a Tauri v2 desktop app (macOS-first) that listens to meetings, transcribes them live, and streams back plain-language explanations, decisions, action items, risks, and suggested replies.

`brain.md` at the repo root is a second, deeply detailed architecture reference kept close to the code — read it too. But treat both docs as **lagging the code in places** (see "Where the docs and code disagree" below) — for anything load-bearing, verify against the actual source files listed here, not the docs.

## Four cooperating runtimes

1. **Rust core** (`src-tauri/`) — Tauri app: window/tray management, audio capture (`cpal`) + resampling (`rubato`), and the **native LLM agent pipeline** (`src-tauri/src/agents/`, built on `rig-core` against OpenAI).
2. **Node "gateway" sidecar** (`gateway/`) — child process spawned by Rust for STT only: PCM1 frame parsing, `ProviderManager` (AssemblyAI primary, Speechmatics fallback), MFCC-based speaker diarization, and it writes transcripts/meetings to `meeting_history.db`. It does **not** run LLM/agent logic — that moved to Rust. (`gateway/config/index.js` is the gateway's own configuration module: env/argv resolution and validation. There is no `gateway/llm/`.)
3. **Node "chatbot" sidecar** (`chatbot/`) — separate child process for "Ask Roxi": LangGraph Adaptive-RAG over an FTS5 index of meeting history, spoken to via stdio JSON.
4. **React/TypeScript frontend** (`src/`) — Vite + Tailwind, talks to Rust only through Tauri `invoke`/events, never directly to either sidecar.

Rust ↔ Node communication is over OS pipes: PCM1-framed binary audio in (gateway), typed JSON lines out (gateway) / stdio JSON both ways (chatbot). This is deliberately process-isolated — don't turn it into a network socket.

## Architecture

```
                         ┌───────────────────────────────────────────────────┐
                         │                 Tauri app (macOS)                 │
                         │                                                   │
                         │   3 webview windows, one React bundle (HashRouter)│
                         │   ┌─────────┐   ┌──────────┐   ┌────────────────┐ │
                         │   │  main   │   │ toolbar  │   │    caption     │ │
                         │   │ App.tsx │   │Floating  │   │ CaptionOverlay │ │
                         │   │ (Suggest│   │ Toolbar  │   │ (click-through)│ │
                         │   │/Ask/... │   │          │   │                │ │
                         │   └────┬────┘   └────┬─────┘   └───────┬────────┘ │
                         │        └──────┬───────┴─────────────────┘         │
                         │      invoke()  │  ▲ Tauri events                  │
                         └────────────────┼──┼─────────────────────────────┬─┘
                                          ▼  │                             │
                         ┌──────────────────────────────────┐             │
                         │      Rust core (src-tauri/)       │             │
                         │  commands/  →  application/        │             │
                         │        ▲            │               │             │
                         │        │            ▼               │             │
                         │  ports/ ◄──── adapters/             │             │
                         │    (mac_audio · gateway_client ·    │             │
                         │     chat_client · sqlite)           │             │
                         │                                     │             │
                         │  cpal capture → resample.rs →       │             │
                         │  streaming.rs (PCM1 framing)         │             │
                         │        │                             │             │
                         │        │ stdin (binary PCM1)          │             │
                         │        ▼                             │             │
                         │  sidecar/event_router.rs  ◄── stdout │ (JSON lines) │
                         │        │                             │             │
                         │        ▼ Final transcript             │             │
                         │  agents/orchestrator/ChunkGraph:      │             │
                         │   chit_chat_gate → ContextManager →   │             │
                         │   ComplexityAnalyzer → routing::decide│             │
                         │   → {Explanation,Technical,Analyst,   │             │
                         │      Risk} (parallel) → ResponseAgent │             │
                         │        │ via LlmClient trait          │             │
                         │        ▼                             │             │
                         │  adapters/openai_adapter.rs ──────────┼──────► OpenAI API
                         │        │                             │        (gpt-4o-mini agents,
                         │        ▼                             │         gpt-5.6-luna response_agent)
                         │  adapters/usage_store.rs → llm_usage.db          │
                         └──────────┬──────────────┬────────────┘             │
                                    │              │                          │
                     spawns/pipes   │              │ spawns/stdio JSON        │
                                    ▼              ▼                          │
                  ┌─────────────────────────┐  ┌─────────────────────────────┐│
                  │ gateway/sidecar.js (Node)│  │ chatbot/sidecar.js (Node)   ││
                  │  PcmDeframer             │  │  LangGraph Adaptive-RAG:    ││
                  │  → ProviderManager       │  │  analyze_query → retrieve   ││
                  │    (AssemblyAI primary,  │  │  (FTS5/BM25) → grade_docs   ││
                  │     Speechmatics fallback)│  │  → generate/clarify        ││
                  │  → transcript-sanitizer  │  │                             ││
                  │  → diarization-layer     │  │  reads meeting_history.db  ││
                  │    (MFCC + cosine sim)   │  │  READ-ONLY; owns            ││
                  │                          │  │  chat_index.db (FTS5)      ││
                  └────────────┬─────────────┘  └─────────────────────────────┘│
                               │                                                │
                               ▼                                                │
                    writes meeting_history.db ◄─────────── read by Rust ────────┘
                    (meetings, transcripts, chunks, decisions,
                     action_items, risks, speaker_embeddings, …)

  External services:  AssemblyAI / Speechmatics (STT, WebSocket) · OpenAI (LLM, HTTPS)
  Audio source:        BlackHole 2ch (loopback) + system mic, captured via cpal
```

**Read direction**: user speech + system audio → Rust captures/frames it → gateway sidecar turns it into diarized final transcripts in `meeting_history.db` → Rust's `ChunkGraph` turns each final transcript into decisions/risks/explanations/replies via OpenAI → both flow back to the frontend as Tauri events, fanned out across the `main`, `toolbar`, and `caption` windows. The chatbot sidecar is a separate, on-demand branch triggered only by "Ask Roxi," reading the same `meeting_history.db` read-only.

## Single-window frontend

`src/app/main.tsx` mounts a `HashRouter` with one route:

| Route | Window label | Component | Purpose |
|---|---|---|---|
| `/` | `main` | `app/App.tsx` | The whole widget: idle screen → context intake → live session (Suggest/Ask/Listen tabs) + history |

The `main` window is the only one declared in `src-tauri/tauri.conf.json` (`app.windows[]`: 420×780, transparent, undecorated, always-on-top).

**A floating toolbar and a click-through caption overlay were previously planned as two extra windows.** Their components were deleted in the frontend refactor and their window declarations never existed in the current config, so `commands/overlay.rs`, `capabilities/{toolbar,caption}.json` and `IEventBus.toggleToolbar/toggleCaption` were left resolving nothing and silently returning `Ok(())`. That dead surface has now been removed. If you reinstate either overlay you need all of it: the window declaration, the hash route, the component, a capability file, and a `setup()` re-navigation for dev mode (Tauri loads `devUrl` for every window and ignores each one's configured `url`, so without it a new window silently shows the wrong route under `npm run tauri dev`).

## Frontend architecture (`src/`)

Dependency injection over Tauri, not direct `invoke()` calls scattered through components:

- `src/interfaces/` — five service contracts: `ICaptureService`, `IEventBus`, `IChatService`, `IHistoryRepository`, `ISpeakerRepository`.
- `src/services/` — Tauri-backed implementations (`TauriCaptureService`, `TauriEventBus`, `TauriChatService`, `TauriHistoryRepository`, `SpeakerRepository`) plus `services/mappers/` (wire-format → UI-type mappers) and `services/wire/` (raw event payload types).
- `src/context/ServicesContext.ts` + `ServicesProvider.tsx` — constructs the five Tauri services once and provides them via context; accepts a `services` override prop so tests/harnesses can inject fakes without components knowing. Consume via `useServices()` (`context/useServices.ts`), never construct a service class directly inside a component.
- `src/features/*` — one folder per feature, each owning its own hook(s) that call `useServices()` and its own presentational components:
  - `capture/` — `useCaptureSession` (start/stop, status machine) wrapped by `useCaptureFlow` (adds the `ready → collecting-context → live` step sequencing) and `context-intake/` (the meeting-context modal + presets).
  - `transcript/` — live transcript pane.
  - `suggest/` — the "Suggest" tab: decisions/risks/actions/replies rendered as cards, with tag filters.
  - `chat/` — "Ask Roxi" (`ChatContext` provider + `useChat`), rendered inside `App.tsx`'s `ask` tab.
  - `caption/`, `toolbar/` — the two satellite windows described above.
  - `analysis/`, `history/` — analysis pane / meeting history browser (history reads via `IHistoryRepository`).
- `src/design-system/` — shared visual primitives (`GlassCard`, `Badge`, `TagChip`, `Waveform`, icons, `tokens.ts`, `tagPalette.ts`) — reuse these instead of ad hoc styled `div`s.
- `App.tsx` is a thin composition root: it renders the idle screen or the three-tab session shell (`suggest` / `ask` / `listen`) and wires `useCaptureFlow` + `useChatContext` together. Navigation/flow rules live in the hooks, not in `App.tsx`.

## Backend architecture (`src-tauri/src/`)

Hexagonal layout, twice over — once for the app core, once inside `agents/`:

```
adapters/        mac_audio.rs (cpal capture), gateway_client.rs (spawns/talks to gateway sidecar),
                 chat_client.rs (spawns/talks to chatbot sidecar), sqlite.rs (meeting_history.db reads)
application/      capture_usecase.rs — orchestrates adapters for start/stop capture
commands/         capture.rs, db.rs, chat.rs, audio_devices.rs, overlay.rs — #[tauri::command] entry points
domain/           meeting.rs, audio.rs — core models
ports/            audio_capture.rs, db.rs, gateway.rs, chat_gateway.rs — traits the adapters implement
sidecar/          events.rs (SidecarEvent + payload structs), event_router.rs (JSON → domain → Tauri events),
                 chat_events.rs
streaming.rs      PCM1 framing sink (Rust → gateway stdin)
resample.rs       FFT resampler to 16kHz mono
macos_overlay.rs  NSStatusWindowLevel + CanJoinAllSpaces FFI (macOS-only fullscreen float)
agents/           the LLM pipeline — see below, mirrors the same ports/adapters/domain split internally
```

`lib.rs` is the composition root: it builds every adapter and every agent, wires the agents into a single `ChunkGraph`, registers the Tauri command handler list, and runs the `setup()` hook (window policy, overlay behavior, global shortcut, tray). **Everything is constructed here** — if you add a new agent, sidecar client, or command, it gets instantiated/registered in `lib.rs`.

### Agent pipeline (`src-tauri/src/agents/`)

- Agents implement the `Agent` trait (`ports/agent_port.rs`); every LLM call goes through the `LlmClient` trait (`ports/llm_port.rs`) → `OpenAiAdapter` (`adapters/openai_adapter.rs`, wraps `rig-core`'s OpenAI client). Never call an LLM SDK directly from an agent — usage/cost logging to `llm_usage.db` (via `adapters/usage_store.rs`) happens inside the adapter, for both plain-text (`complete`) and JSON-extracting (`complete_json`) calls.
- **Model tiers** (set in `lib.rs`, not hardcoded per-agent): `context_manager`, `explanation`, `technical`, `analyst`, `risk_detector`, `complexity` all run on `gpt-4o-mini` for latency; only `response_agent` (the final synthesis step) runs on the premium `gpt-5.6-luna`. If you add an agent, decide deliberately which tier it belongs to — don't default to premium.
- `ChunkGraph` (`orchestrator/chunk_graph.rs`) is the pipeline for each finalized transcript chunk:
  1. `chit_chat_gate` — local heuristic, fast-exits small talk with no LLM call.
  2. `ContextManagerAgent` (sequential) — topic tracking + significance grading.
  3. Complexity (Low/Medium/High) comes back in `ContextManagerAgent`'s JSON as one
     extra field — folded in to save a sequential round-trip.
     `agents/agents/complexity_analyzer.rs` still exists but is **intentionally
     unwired**: nothing constructs it. Re-wire it in `application/agent_registry.rs`
     only if complexity needs its own model or cadence.
  4. Stage-2 conditional parallel fan-out, decided by the pure function `orchestrator/routing.rs::decide()` (no I/O, unit-tested — the one test file in the Rust codebase today):
     - Low → `ExplanationAgent` only
     - Medium → `ExplanationAgent` + `RiskDetectorAgent`
     - High → `ExplanationAgent` + `TechnicalAgent` + `AnalystAgent` + `RiskDetectorAgent`
  5. `ResponseAgent` (sequential, last) — suggested reply, on the premium model.
- **Adding an agent**: implement `Agent`, decide sequential vs. stage-2, add it as a field on `ChunkGraph` and wire it in, update `routing::decide()` if it's stage-2, register an `OpenAiAdapter::with_tag(api_key, model, "your_tag")` in `lib.rs` with a deliberate model tier, and emit its output as a new match arm in `event_router.rs` (plus the matching TS handler).
- **`complete_json` is fragile by design**: it extracts JSON by taking the substring between the first `{` and last `}` in the raw completion — no schema validation, no retry/repair. If an agent's prompt can produce nested unrelated braces or prose after the JSON, this will misparse. Keep JSON-producing prompts tightly constrained to "return only a JSON object."

## Data flow (capture → UI)

1. `App.tsx` → `useCaptureSession` → `captureService.startCapture(context)` → Tauri `invoke("start_capture")`.
2. `lib.rs`/`capture_usecase.rs`: loads root `.env` via `dotenvy`, spawns `node ../gateway/sidecar.js` (with `--context`/`--role` argv if provided).
3. `mac_audio.rs` captures BlackHole loopback + mic via `cpal`, downmixes to mono.
4. `resample.rs` resamples to 16kHz; `streaming.rs` frames it as PCM1 (8-byte header + PCM16 payload) onto the sidecar's stdin.
5. `gateway/sidecar.js`: `PcmDeframer` parses frames → `ProviderManager` (`gateway/stt/provider-manager.js`) routes audio to the active STT provider (AssemblyAI first, Speechmatics fallback) → emits `partial`/`final` turns.
6. On a final turn: `validateTranscriptEvent` → `transcript-sanitizer.js` (drops low-confidence/filler) → `diarization-layer.js` (MFCC embedding + cosine similarity against stored `speaker_embeddings`, resolves a display name) → prints a typed JSON line to stdout and persists the transcript row to `meeting_history.db`.
7. `sidecar/event_router.rs` deserializes each stdout line into `SidecarEvent`. On a `Final` transcript it runs the `ChunkGraph` (agent pipeline above) on `tauri::async_runtime`, then emits Tauri events (`context_explanation`, `technical_explanation`, `meeting_decisions`, `meeting_action_items`, `meeting_risks`, `suggested_response`, plus raw `transcript_partial`/`transcript_final`, `provider_status`, `circuit_breaker`, `capture_error`, `billing`, `api_health`, `speaker_revision`).
8. Frontend: `TauriEventBus` subscribes via `IEventBus`; each feature's hook (`useTranscript`, `useSuggestAnswers`, `useCaption`, `useToolbarState`, …) owns its slice of state and re-renders its pane.

**Chat flow**: "Ask Roxi" → `invoke("ask_chat")` → `adapters/chat_client.rs` spawns/talks to `chatbot/sidecar.js` (stdio JSON) → LangGraph graph in `chatbot/src/application/graph/buildChatGraph.js` (`analyze_query → retrieve (FTS5/BM25 via better-sqlite3) → grade_documents → generate/clarify/respond_no_data`, routing logic in `graph/routing.js`) → events `chat_thinking` / `chat_reply` / `chat_error` → `ChatPane`/`useChat` render cited answers.

## Database

Two independent SQLite databases, never joined at the query level:

- **`meeting_history.db`** — written by the gateway sidecar (`better-sqlite3`), read by Rust (`rusqlite`, `adapters/sqlite.rs`) and by the chatbot **read-only** (to avoid WAL conflicts between the two Node processes). Tables: `meetings`, `transcripts`, `chunks`, `decisions`, `action_items`, `risks`, `technical_analyses`, `suggested_replies`, `summaries`, `glossary_terms`, `speaker_profiles`, `speaker_names`, `speaker_embeddings`. Schema evolves via **forward-only** migrations in `gateway/db/migrate.js` — never edit a shipped migration, add a new one.
- **`llm_usage.db`** — written by Rust `agents/adapters/usage_store.rs` (one row per LLM call: tag, model, status, latency, tokens, prompts, response). Read by `dashboard/` for observability.
- **`chatbot/data/chat_index.db`** — the chatbot's own FTS5 index, separate from both of the above, rebuilt with `chatbot/bin/rebuild-index.js`.
- **`chatbot/data/doc_store.db`** — uploaded documents and their vectors, populated via the UI's document upload tray in the chat pane.

## Commands & events reference

**Tauri commands** (`invoke_handler!` list in `lib.rs`): `start_capture`, `stop_capture`, `check_blackhole_installed`, `get_meetings`, `get_meeting_details`, `ask_chat`, `close_chat`, `rename_speaker`.

**Tauri → frontend events**: `provider_status`, `transcript_partial`, `transcript_final`, `context_explanation`, `technical_explanation`, `chunk_significance`, `meeting_decisions`, `meeting_action_items`, `meeting_risks`, `meeting_summary`, `suggested_response`, `circuit_breaker`, `capture_error`, `api_health`, `billing`, `speaker_revision`, `chat_thinking`, `chat_reply`, `chat_error`.

**Gateway sidecar stdout JSON types**: `Connected`, `Closed`, `Error`, `Partial`, `Final`, `Significance`, `Explanation`, `TechnicalExplanation`, `Decisions`, `ActionItems`, `Risks`, `Response`, `CircuitBreaker`, `Billing`, `ApiHealth`, `ProviderStatus`, `SpeakerRevision`. In practice most semantic types are produced by the Rust `ChunkGraph`, not the sidecar — the sidecar mainly emits `Partial`/`Final`/`ProviderStatus`/`Error`.

Changing an event's shape is a **three-file** change, always in lockstep: `src-tauri/src/sidecar/events.rs` (payload struct), `event_router.rs` (match arm that turns it into a Tauri event), and the frontend (`IEventBus` + the consuming `TauriEventBus`/`wireTypes.ts`/mapper + hook).

## Environment variables

Put them in a **root `.env`** (not `gateway/.env`) — both Rust (`dotenvy::dotenv()` in `lib.rs`) and the gateway sidecar look at root first and fall back to `gateway/.env`. This matters for packaged `.app` bundles, which don't inherit shell env.

| Name | Required | Notes |
|---|---|---|
| `OPENAI_API_KEY` | **Yes** | All agent + chatbot LLM calls. `lib.rs` logs a fatal error at startup (but doesn't crash) if empty — agents will then fail with 401s. |
| `ASSEMBLYAI_API_KEY` | One of these two | Primary streaming STT |
| `SPEECHMATICS_API_KEY` | " | Fallback STT |
| `STT_PROVIDER` | No | Force `speechmatics` or `assemblyai` |
| `STT_LANGUAGES` | No | Comma-separated codes sent as `language_codes` (default: 11 languages). AssemblyAI recommends committing to one (`STT_LANGUAGES=en`) when the meeting language is known — broad steering costs accuracy. |
| `STT_MIN_TURN_SILENCE` / `STT_MAX_TURN_SILENCE` | No | Turn-detection silence in ms (default 400 / 1500, range 50–10000 / 400–10000). Deliberately above AssemblyAI's voice-agent defaults: meeting speakers pause mid-thought, and an early cut splits one idea into two chunks for the agent pipeline. Lower both to cut latency. |
| `STT_MAX_SPEAKERS` | No | Diarization cap, 1–10 (default 10) |
| `STT_MODE` | No | `balanced` (default), `max_accuracy`, or `min_latency` |
| `STT_VOICE_FOCUS` | No | `near-field` or `far-field` noise suppression; off by default (BlackHole loopback is already clean, and it bills extra per hour) |
| `LLM_BUDGET_SOFT` / `LLM_BUDGET_HARD` | No | Circuit breaker call caps (default 60/80) |
| `ANOMALY_COST_PER_CHUNK_USD` / `ANOMALY_COST_PER_MIN_USD` / `ANOMALY_SESSION_BUDGET_USD` | No | Cost anomaly thresholds (default 0.05 / 0.10 / 2.00) |
| `CHATBOT_LLM_BUDGET_SOFT` / `CHATBOT_LLM_BUDGET_HARD` | No | Chatbot's own budget guard |
| `CHATBOT_LLM_ADAPTER` | No | `langchain` swaps the chatbot's LLM gateway implementation |

## Commands

```bash
# install (three separate npm trees — root, gateway, chatbot)
npm install
cd gateway && npm install && cd ..
cd chatbot && npm install && cd ..

# run everything (Rust + Vite dev server + spawns both sidecars on capture/chat)
npm run tauri dev

# frontend typecheck + build
npm run lint            # tsc --noEmit
npm run build            # tsc && vite build
npm run tauri build      # production native bundle (.dmg/.msi/.deb/.AppImage)

# tests
npm test                 # chatbot tests only (npm --prefix chatbot test)
npm run test:all          # chatbot + gateway
cd chatbot && node --test test/routing.test.js     # single chatbot test file
cd chatbot && node --test --reporter=tap "test/*.test.js"   # CI-style
cd gateway && npm test    # 83 tests: db, deframer, diarization/pipeline, protocol,
                          # provider-manager, STT provider contract, AssemblyAI context hints
                          # (TEST-001 in audit/CODE-AUDIT-REPORT.md is stale — these now exist)

# Rust — cargo is at ~/.cargo/bin/cargo, not always on PATH
cd src-tauri && cargo build
cd src-tauri && cargo test               # only orchestrator::routing has #[test]s today
cd src-tauri && cargo test routing::      # just that module

# LLM usage dashboard (reads llm_usage.db)
npm run dashboard         # http://localhost:3300
npm run dashboard:seed    # demo data

npm run audit:all          # npm audit across root, gateway, chatbot
```

Husky `pre-commit` (`.husky/pre-commit`) blocks staged `.env`/`.env.local` files, greps the diff for obvious API-key patterns (`ASSEMBLYAI_API_KEY=`, `SPEECHMATICS_API_KEY=`, `OPENAI_API_KEY=sk-...`), and runs `npx tsc --noEmit`. Don't bypass with `--no-verify` unless the user explicitly asks for a deliberate snapshot.

## Where the docs and code disagree

`brain.md` (dated 2026-09-01) and `README.md` both describe an earlier state. Concretely, as of the current `main`:

- **Screenshot/screen-share protection is currently OFF.** `lib.rs`'s setup hook has `win.set_content_protected(true)` **commented out** with the note "Removed so the window is visible in screen shares." Both docs still describe capture-invisibility as an active feature — it is not, right now, for any window. If a task references "stealth"/"invisible to screen share," confirm with the user whether they want it re-enabled rather than assuming it still works.
- **The frontend is a single window.** brain.md describes a since-deleted `TopBar.tsx`/`ContextModal.tsx` tree, and an interim refactor added toolbar/caption overlay scaffolding that has now been removed (see "Single-window frontend"). Trust the actual `src/` tree, not brain.md's.
- **Model tiering changed**: brain.md says all agents use `gpt-5.6-luna` with temperature omitted. The code now runs most agents on `gpt-4o-mini` and reserves `gpt-5.6-luna` for `response_agent` only. The "never pass `temperature`" constraint isn't explicitly re-verified for `gpt-4o-mini` in code — treat it as still the safe default for every agent's LLM call, not just the premium one.
- **`tauri.conf.json` still has `security.csp: null` and `app.withGlobalTauri: true`**, both flagged High in `audit/CODE-AUDIT-REPORT.md` (2026-08-26) and not yet remediated — don't add anything that assumes CSP protections exist. Verified 2026-09-07: `window.__TAURI__` is referenced nowhere in `src/` or `index.html` (the window-control code that needed it went with the deleted `TopBar.tsx`), so `withGlobalTauri` can be turned off safely. Both are queued behind the packaging work rather than changed as a drive-by.

## Don't touch

- Don't add Node LLM/agent logic back to `gateway/` — it moved to Rust (`src-tauri/src/agents/`). `gateway/config/` is the gateway's own config module, not a leftover.
- Shipped entries in `gateway/db/migrate.js` — migrations are forward-only; add a new migration instead of editing an old one.
- `chatbot/data/chat_index.db*` — generated index; regenerate via `chatbot/bin/rebuild-index.js` rather than hand-editing.
- `audit/CODE-AUDIT-REPORT.md` findings are a point-in-time snapshot (2026-08-26); several (the LLM/agent-architecture ones) are already stale post-migration. Verify against current code before citing it as still-true.
