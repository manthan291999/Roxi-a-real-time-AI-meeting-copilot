# brain.md — Canonical Knowledge Base: Roxi AI Meeting Interpreter

> Machine-optimized reference. Every fact below was verified against file contents on 2026-09-01. An AI agent reading only this file should be able to explain the project and safely propose changes without re-scanning the repo.

## Project Overview

- **Name:** Roxi AI / AI Meeting Interpreter (manifest names still generic: `tauri-app`).
- **Purpose:** Real-time desktop copilot that listens to meetings, transcribes speech with speaker diarization, and translates complex/technical discussion into plain language with extracted decisions, action items, risks, and suggested replies. Runs as a **stealth overlay**: invisible to screenshots and screen sharing, hidden from the Dock, floating above fullscreen meeting apps.
- **Summary:** A Tauri v2 desktop app with four cooperating runtimes: a React/Tailwind frontend, a Rust core that captures loopback + mic audio and now also runs the **native LLM agent pipeline** (multi-agent OpenAI graph via rig-core), a Node.js sidecar child process that handles STT providers (AssemblyAI/Speechmatics) and MFCC-based speaker diarization, and a second Node.js sidecar (`chatbot/`, LangGraph Adaptive-RAG) for meeting-history Q&A. Rust ↔ Node communicate over OS pipes (PCM1 audio in, typed JSON events out). A circuit breaker + cost anomaly detector cap LLM spend.
- **Domain:** Productivity / meeting intelligence / accessibility for non-technical participants.
- **Primary user flows:**
  1. Launch → window shows UI (frameless, transparent), status "Ready". App is a menubar agent: no Dock icon.
  2. Click **Start Capture** (or open the Context modal for meeting context) → `invoke("start_capture")` → sidecar spawns, audio capture begins → status "Live".
  3. Speech appears as partial then final transcripts; explanations + technical explanations, decisions/action items/risks, and suggested replies stream in from the Rust agent graph.
  4. Click "Speakers" to rename speaker labels globally via modal. "Ask Roxi" opens the chatbot panel over meeting history.
  5. At limit → "Cost Limit Reached" (red), AI processing pauses.
  6. Click **Stop** → `invoke("stop_capture")` → sidecar killed.
  7. **Option+Space** global hotkey toggles window visibility at any time (tray icon: Show/Hide/Quit is the other lifeline).

## Stealth Overlay Architecture (macOS, 2026-09-01)

The app window is deliberately undetectable by screen capture. Implemented in `src-tauri/src/lib.rs` setup hook + `src-tauri/src/macos_overlay.rs`:

| Feature | Implementation | Effect |
|---|---|---|
| **Capture shield** | `win.set_content_protected(true)` (Apple `NSWindow.sharingType = .none`) | Window content invisible to screenshots (Cmd+Shift+3/4/5), QuickTime/OBS recording, and Zoom/Meet/Teams/Slack full-screen sharing. Viewers see what's *behind* the window. |
| **Dock/app-switcher hiding** | `app.set_activation_policy(ActivationPolicy::Accessory)` | No Dock icon, no Cmd+Tab entry, no Force Quit listing. |
| **Fullscreen float** | `macos_overlay.rs`: `NSStatusWindowLevel` + `CanJoinAllSpaces \| FullScreenAuxiliary` (objc2-app-kit) | Window stays visible over fullscreen Zoom/Meet windows and follows Spaces. |
| **Global hotkey** | `tauri-plugin-global-shortcut`, registered `Option+Space` in setup; handler toggles show/hide + focus | Instant hide/restore without Dock access. |
| **Tray lifeline** | `TrayIconBuilder` id `roxi-tray`, menu Show/Hide/Quit | Only persistent way to reach the app when window is hidden. |
| **Transparent window** | `tauri.conf.json`: `transparent: true`, `decorations: false`, `alwaysOnTop: true`, `shadow: true`; `macOSPrivateApi: true` + tauri feature `macos-private-api` | Fully transparent frameless window. |

**Crystal-clear transparency (current look):** native vibrancy was **removed** (commit `2a59dba`) so the desktop shows through pixel-sharp. The web layer provides the only contrast: faint tints (`bg-white/10-25`, cards `bg-white/12`, `.glass-modal` 38% white + 8px blur in `src/styles.css`) and a global white `text-shadow` halo on `body` for readability over any background (`.no-text-shadow` opts out — used on the dark terminal block in `BlackHoleModal`). Custom window controls (pin/minimize/hide) live in `TopBar.tsx` via `window.__TAURI__` (withGlobalTauri is on). The top bar is a `data-tauri-drag-region`.

**Honest limits:** a phone photo of the monitor always shows it; the *process* (`tauri-app`) still appears in Activity Monitor; capture apps bypassing ScreenCaptureKit on macOS < 13 are outside the guarantee.

## Tech Stack

| Layer | Technology | Version | Purpose |
|---|---|---|---|
| Desktop shell | Tauri | `2` (locked 2.11.5) | Native window, IPC, sidecar management, tray, global shortcuts |
| Tauri plugins | tauri-plugin-opener, tauri-plugin-global-shortcut | `2` / `2.3.2` | Opener links; Option+Space hotkey |
| macOS native FFI | objc2-app-kit | `0.3` (features: std, NSWindow) | Window level + collection behavior in `macos_overlay.rs` |
| Frontend framework | React / TypeScript | `~5.6.2` | UI logic (`src/App.tsx`) |
| Frontend styling | Tailwind CSS | `^3.4.x` + custom glass tokens in `styles.css` | Light translucent theme (see Stealth section) |
| Bundler/dev server | Vite | `^6.0.3` | Dev server port 1420, production bundling |
| Audio capture | cpal (Rust) | `0.15.3` | Loopback (BlackHole) + mic input streams |
| Resampling | rubato (Rust) | `0.16.2` | FFT sinc resample → 16 kHz |
| **Rust LLM pipeline** | **rig-core, tokio, reqwest, async-trait** | `0.2.1`, `1`, `0.12`, `0.1.80` | **Native multi-agent graph (replaced the old Node.js pipeline)** |
| Env loading (Rust) | dotenvy | `0.15` | Loads root `.env` — critical for macOS .app bundles |
| Sidecar runtime | Node.js | 20+ | STT + diarization (`gateway/`), history chatbot (`chatbot/`) |
| Streaming STT | assemblyai / @speechmatics/real-time-client | `^4.6.0` / `^8.5.1` | Real-time STT via `ProviderManager` |
| **LLM (Rust agents + chatbot)** | **OpenAI** (`gpt-5.6-luna`, locked — never send temperature) | SDK `openai` (JS), rig (Rust) | All completions; Groq removed |
| Database driver | better-sqlite3 / rusqlite | `^13.0.3` / `0.31` | SQLite persistence |
| LLM observability | dashboard/ (express + better-sqlite3, zero-build) | — | Reads `llm_usage.db`; prompts, latency, cost, errors, codemap |

## Folder & File Structure

```text
meeting-interpreter-mac-main/
├── .env                      # API keys (gitignored) — sidecar reads root first, falls back to gateway/.env
├── brain.md                  # THIS FILE — canonical machine reference
├── README.md                 # Project documentation
├── src/                      # Frontend (React + Tailwind)
│   ├── App.tsx               # Main component: state, listeners, modals, layout
│   ├── main.tsx              # React DOM entry
│   ├── styles.css            # Tailwind directives + keyframes + glass tokens + text-shadow halo
│   ├── components/           # Shared.tsx (PaneLabel, RoxiLogo…), Overlays.tsx (Connecting/Error)
│   ├── context/              # ServicesContext.ts, ServicesProvider.tsx (DI container)
│   ├── features/
│   │   ├── capture/          # TopBar.tsx (drag region, WindowControls, StatusPill), ContextModal.tsx
│   │   ├── transcript/       # TranscriptPane.tsx, useTranscript.ts, SpeakerRenameModal.tsx
│   │   ├── analysis/         # InterpretationPane.tsx, RepliesPane.tsx, useAnalysis.ts
│   │   ├── chat/             # ChatPanel.tsx ("Ask Roxi")
│   │   ├── history/          # HistoryView.tsx (slide-in, deep-linkable via initialMeetingId)
│   │   └── onboarding/       # BlackHoleModal.tsx (driver setup)
│   ├── hooks/                # useTauriEvents.ts, useSpeakerMap.ts
│   ├── services/             # TauriCaptureService, TauriEventBus, TauriChatService, TauriHistoryRepository, SpeakerRepository
│   └── types/                # Shared TS types
├── gateway/                  # Node.js STT sidecar engine
│   ├── sidecar.js            # MAIN sidecar: PCM1 parser → ProviderManager → stdout JSON (+ diarization, sanitizer)
│   ├── audio/pcm-deframer.js # PCM1 frame parser
│   ├── providers/            # assemblyai.js, speechmatics.js, mfcc.js (13-coeff MFCC)
│   ├── stt/                  # provider-manager.js (fallback chain), diarization-layer.js, transcript-sanitizer.js
│   ├── tools/                # pcm-consumer.js (stream validator/stats), transcriber.js
│   ├── interfaces/           # IAgent.js, ISttProvider.js, ITranscriptCleaner.js, ITranscriptSanitizer.js
│   ├── infrastructure/       # logger, validate, stdout-protocol (typed emitters), circuit-breaker,
│   │                         # cost-anomaly-detector, billing-tracker, usage-store, retry, text-similarity
│   ├── state/                # meeting-state.js (+user/role profiles), prompt-builder.js, speaker-tracker.js
│   ├── db/                   # index.js (better-sqlite3), migrate.js (forward-only)
│   ├── llm/                  # llm-port.js, openai-client.js (gpt-5.6-luna; legacy path, kept for dashboard/tooling)
│   ├── config/agent-config.js
│   └── lifecycle/shutdown.js
├── chatbot/                  # Ask Roxi: LangGraph Adaptive-RAG over FTS5 index (self-contained sidecar)
│   ├── sidecar.js            # stdio JSON protocol entry
│   ├── src/                  # composition/container.js (DI), application/graph/, transport/stdioSidecar.js …
│   └── data/chat_index.db    # own FTS5 index (read-only on meeting DB — zero WAL conflicts)
├── dashboard/                # LLM usage dashboard (zero-build): server.js, codemap.json, lib/schema.js
└── src-tauri/                # Rust backend (Tauri v2)
    ├── Cargo.toml            # tauri(macos-private-api,tray-icon,image-png), rig-core, tokio, reqwest, objc2-app-kit…
    ├── tauri.conf.json       # macOSPrivateApi, transparent frameless always-on-top window "main"
    ├── capabilities/default.json  # window show/hide/focus/minimize/drag/always-on-top permissions
    └── src/
        ├── main.rs           # Bin entry
        ├── lib.rs            # Setup hook (stealth overlay), agent graph wiring, command registration
        ├── macos_overlay.rs  # NSStatusWindowLevel + CanJoinAllSpaces FFI (fullscreen float)
        ├── agents/           # RUST-NATIVE LLM PIPELINE (hexagonal)
        │   ├── orchestrator/chunk_graph.rs   # ChunkGraph: chit-chat gate → context mgr → parallel swarm → response
        │   ├── agents/                        # context_manager, explanation, technical, analyst, risk_detector, response_agent, chit_chat_gate
        │   ├── adapters/                     # openai_adapter.rs (rig → OpenAI, tagged), usage_store.rs (llm_usage.db)
        │   ├── ports/                        # agent_port.rs (Agent trait), llm_port.rs (LlmClient trait)
        │   └── domain/                        # chunk_state, decision, action_item, risk, agent_error
        ├── adapters/          # mac_audio.rs (cpal), gateway_client.rs (STT sidecar proc), sqlite.rs, chat_client.rs (chatbot proc)
        ├── commands/          # capture, db, chat, audio_devices
        ├── application/capture_usecase.rs
        ├── domain/ ports/     # Traits + models
        ├── sidecar/           # events.rs (SidecarEvent), event_router.rs (JSON → Tauri events → ChunkGraph), chat_events.rs
        ├── streaming.rs       # PCM1 framing sink
        ├── resample.rs        # FFT audio resampler
        └── wav_sink.rs        # Debug WAV writer
```

## Architecture & Data Flow

**Pattern: layered, process-isolated pipeline (real-time plane + intelligence plane). The LLM agent pipeline now lives in Rust, not Node.**

1. User clicks Start → `App.tsx` calls `invoke("start_capture")`.
2. `lib.rs`: loads `.env` via dotenvy; spawns `node ../gateway/sidecar.js` (with optional `--context`, `--role` argv).
3. `mac_audio.rs`: captures BlackHole loopback + mic, downmixes to mono, resamples to 16 kHz.
4. `streaming.rs`: chunks audio into PCM1 frames (8-byte header + PCM16 payload) → sidecar stdin.
5. `sidecar.js`: `PcmDeframer` parses frames → `ProviderManager` routes audio to active STT (AssemblyAI first, Speechmatics fallback).
6. STT returns turn → ProviderManager emits `partial`/`final`.
7. Final path: `validateTranscriptEvent` → `sanitizer.sanitize` (drops low-confidence/filler) → `DiarizationLayer.resolveLabel` (MFCC embedding + cosine similarity vs `speaker_embeddings`) → prints `{type:"Final", text, speaker (displayName), sttLabel, start, end}` → saves transcript to SQLite. *(The old Node semantic-buffer/agent pipeline is disabled at `gateway/sidecar.js:104`.)*
8. `lib.rs` `event_router.rs`: deserializes `SidecarEvent`. On `Final` it **intercepts the transcript and runs the Rust-native `ChunkGraph`** on `tauri::async_runtime`:
   - `chit_chat_gate::is_filler` (local heuristic) → fast-exit small talk.
   - `ContextManagerAgent` (sequential) → topic + significance grading.
   - Parallel swarm (concurrent futures): `ExplanationAgent`, `TechnicalAgent`, `AnalystAgent` (decisions/action items), `RiskDetectorAgent`.
   - `ResponseAgent` (sequential, last) → suggested reply (+ type).
   - All agents call `OpenAiAdapter` (rig-core → `gpt-5.6-luna`; temperature omitted — model rejects overrides) with per-tag usage logging to `llm_usage.db`.
9. `event_router.rs` emits Tauri events: `context_explanation`, `technical_explanation`, `meeting_decisions`, `meeting_action_items`, `meeting_risks`, `suggested_response` (+ still relays legacy sidecar `Explanation`/`Decisions`/… types if a Node pipeline ever emits them).
10. `App.tsx` (`useTauriEvents` / ServicesProvider DI) updates React state.

**Chat flow:** "Ask Roxi" → `invoke("ask_chat")` → `adapters/chat_client.rs` spawns `chatbot/sidecar.js` (stdio JSON) → LangGraph Adaptive-RAG (`analyze_query → retrieve (FTS5/BM25) → grade_documents → decide`) → events `chat_thinking` / `chat_reply` / `chat_error` → `ChatPanel.tsx` renders cited answers; `[M#]` source chips deep-link into `HistoryView`.

**Stealth flow (startup):** setup hook sets accessory policy → `set_content_protected(true)` → always-on-top → `macos_overlay::make_overlay` → registers Option+Space → builds tray. No vibrancy — window is fully transparent.

## Database Schema

SQLite. Two stores:
- **`meeting_history.db`** (sidecar writes via better-sqlite3; Rust reads via rusqlite; chatbot opens read-only): meetings, transcripts, speaker_names, speaker_embeddings, speaker_sessions, speaker_profiles, chunks, decisions, action_items, technical_analyses, suggested_replies, summaries, risks, glossary_terms. Forward-only migrations in `gateway/db/migrate.js`.
- **`llm_usage.db`** (Rust `usage_store.rs` + dashboard): per-call usage records (tag, provider, model, tokens, latency, cost, messages) for observability.

## API Reference

**Tauri Commands:** `start_capture`, `stop_capture`, `check_blackhole_installed`, `get_meetings`, `get_meeting_details`, `ask_chat`, `close_chat`.

**Frontend Events:**
- `provider_status`, `transcript_partial`, `transcript_final` (payloads include `sttLabel`)
- `context_explanation`, `technical_explanation`, `chunk_significance`
- `meeting_decisions`, `meeting_action_items`, `meeting_risks`, `meeting_summary`
- `suggested_response`, `circuit_breaker`, `capture_error`, `api_health`, `billing`, `speaker_revision`
- Chat: `chat_thinking`, `chat_reply`, `chat_error`

**Sidecar JSON Events (stdout):** `Connected`, `Closed`, `Error`, `Partial`, `Final`, `Significance`, `Explanation`, `TechnicalExplanation`, `Decisions`, `ActionItems`, `Risks`, `Response`, `CircuitBreaker`, `Billing`, `ApiHealth`, `ProviderStatus`, `SpeakerRevision`. (Since the Rust pipeline took over, in practice the sidecar emits STT events; semantic types are emitted by the Rust graph as Tauri events directly. Typed emitters live in `gateway/infrastructure/stdout-protocol.js`.)

## Environment Variables

| Name | Purpose | Required? |
|---|---|---|
| `OPENAI_API_KEY` | OpenAI LLM auth (Rust agents + chatbot) | **Yes** |
| `ASSEMBLYAI_API_KEY` | Primary streaming STT | One of the two STT keys required |
| `SPEECHMATICS_API_KEY` | Fallback STT | Optional but recommended |
| `STT_PROVIDER` | `speechmatics` or `assemblyai` | No |
| `LLM_BUDGET_SOFT` / `LLM_BUDGET_HARD` | Circuit breaker call limits (default 60/80) | No |
| `ANOMALY_COST_PER_CHUNK_USD` / `ANOMALY_COST_PER_MIN_USD` / `ANOMALY_SESSION_BUDGET_USD` | Cost anomaly detector thresholds (default 0.05 / 0.10 / 2.00) | No |
| `CHATBOT_LLM_BUDGET_SOFT/HARD` | Per-process chatbot budget guard | No |
| `CHATBOT_LLM_ADAPTER` | `langchain` to swap chatbot LLM gateway | No |

Env loading: `gateway/sidecar.js` prefers root `.env` (falls back to `gateway/.env`); Rust loads root `.env` via dotenvy at startup — required for packaged .app bundles which don't inherit shell env.

## External Integrations

- **OpenAI**: all LLM completions (`gpt-5.6-luna`, locked; temperature must be omitted). Rust via rig-core, chatbot via OpenAI SDK, dashboard-adjacent JS client kept for tooling.
- **AssemblyAI**: primary real-time STT. **Speechmatics**: automatic fallback.
- **BlackHole 2ch**: virtual audio driver for loopback capture (onboarding modal checks install).

## Build, Run, Deploy

```bash
npm install
cd gateway && npm install && cd ..
cd chatbot && npm install && cd ..   # Ask Roxi
cp gateway/.env.example ../.env     # put keys at project root (sidecar + Rust both read root .env)
npm run tauri dev
```

Dev notes: cargo lives at `~/.cargo/bin/cargo` (not on default PATH). Builds work offline from the local registry cache. Verify Rust APIs against cached crate sources under `~/.cargo/registry/src/`. Husky pre-commit runs `npx tsc --noEmit` + blocks `.env`/API-key commits — use `--no-verify` only for deliberate snapshots.

## Conventions & Patterns

- Rust: `anyhow` errors, hexagonal layout (`ports/`/`adapters/`/`domain/`) mirrored in both `src-tauri/src/` and `src-tauri/src/agents/`.
- Agents implement `Agent` trait (`ports/agent_port.rs`); LLM access behind `LlmClient` trait (`ports/llm_port.rs`) — swap providers by writing one adapter.
- JS sidecar: typed JSON stdout IPC (`stdout-protocol.js` emitters); structured logging via `infrastructure/logger.js`.
- React: functional components + ServicesContext DI (`services/` classes wrap invoke/listen).
- Stealth/capture tuning: all window presentation code is in the `lib.rs` setup hook + `macos_overlay.rs` + CSS glass tokens. Capture/transcript/chat logic is untouched by the overlay.

## Agent Instructions

- **Modifying JSON events:** update `SidecarEvent` + payload structs (`sidecar/events.rs`), the match arms in `event_router.rs`, and `App.tsx`/`useTauriEvents` types in lockstep.
- **Adding an agent:** implement `Agent`, add it to the `parallel_agents` vec or as a new sequential node in `chunk_graph.rs`, wire an `OpenAiAdapter::with_tag(...)` in `lib.rs`, and add the matching emit in `event_router.rs`.
- **Diarization & speakers:** always pass `sttLabel` alongside `speaker` end-to-end so the Rename Modal can map labels.
- **Cost safety:** all LLM calls must flow through `OpenAiAdapter` (Rust) / `callLLM`+circuit-breaker (gateway tooling) / `CallCountBudgetGuard` (chatbot). Never bypass; keys are rotated and usage-logged.
- **Never send temperature to gpt-5.6-luna** — the model rejects non-default values; omit it entirely.
- **Stealth regressions:** if screenshot-invisibility stops working, check `set_content_protected(true)` is still called in the setup hook and that the window label is still `"main"`.

## Code Audit Summary (2026-08-26)

Full report: `audit/CODE-AUDIT-REPORT.md`. Critical: plaintext API keys in `gateway/.env` (rotate). High: CSP disabled (`csp: null`), `withGlobalTauri: true` (XSS→IPC risk), sidecar path from CWD, unauthenticated stdin protocol. Medium/Low: mutex panics, unbounded channels, fragile DB path, O(n) deframer resync, dead code. Architecture verdict: clean separation (hexagonal Rust, layered Node); risks are configuration, not structure. The LLM migration to OpenAI + Rust-native agents (2026-08-28→09-01) postdates the audit.

## Changelog
- **[2026-09-01]**: Stealth overlay + crystal-clear transparency: `set_content_protected` capture shield, Accessory policy (no Dock/Cmd+Tab), NSStatusWindowLevel fullscreen float (`macos_overlay.rs`), Option+Space hotkey, tray lifeline, frameless fully-transparent window (vibrancy removed — pixel-sharp background), glass token retune + text-shadow halo. Commits `718fac1`, `2a59dba`.
- **[2026-08-28]**: Ask Roxi chatbot (`chatbot/` LangGraph Adaptive-RAG, FTS5 index, Rust chat bridge, ChatPanel with deep-linked citations). LLM stack migrated Groq → OpenAI `gpt-5.6-luna`; Node agent pipeline replaced by Rust-native `ChunkGraph` (rig-core); dashboard/ LLM-usage observability added; gateway restructured (`pipeline/`,`agents/` → `tools/`, `interfaces/`; cost-anomaly-detector; root `.env`).
- **[2026-08-26]**: Folder structure/core-modules/data-flow sync + code audit summary.
- **[2026-08-22]**: `sttLabel` tracking for speaker renaming; React/Tailwind UI upgrade; multi-STT provider manager; MFCC diarization; SQLite migration.
