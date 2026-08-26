# brain.md — Canonical Knowledge Base: AI Meeting Interpreter

> Machine-optimized reference. Every fact below was verified against file contents on 2026-08-26. An AI agent reading only this file should be able to explain the project and safely propose changes without re-scanning the repo.

## Project Overview

- **Name:** AI Meeting Interpreter / Roxi AI (manifest names still generic: `tauri-app`).
- **Purpose:** Real-time desktop copilot that listens to meetings, transcribes speech with speaker diarization, and translates complex/technical discussion into plain language with extracted decisions, action items, risks, and suggested replies.
- **Summary:** A Tauri v2 desktop app with three cooperating runtimes: a React/Tailwind frontend, a Rust core that captures loopback + mic audio, and a Node.js sidecar child process that manages STT providers (AssemblyAI/Speechmatics), speaker diarization (MFCC embeddings + cosine similarity), and routes finalized chunks through a Groq (Llama 3) multi-agent LLM pipeline. Rust and Node communicate over OS pipes. A circuit breaker caps LLM usage to prevent runaway costs.
- **Domain:** Productivity / meeting intelligence / accessibility for non-technical participants.
- **Primary user flows:**
  1. Launch → window shows UI, status "Ready".
  2. Click **Start Capture** → `invoke("start_capture")` → sidecar spawns, audio capture begins → status "Live".
  3. Speech appears as partial then final transcripts; explanations + significance badge; decisions/action items/risks/suggested replies.
  4. Click "Speakers" to rename speaker labels globally via modal.
  5. At limit → "Cost Limit Reached" (red), AI processing pauses.
  6. Click **Stop** → `invoke("stop_capture")` → sidecar killed.

## Tech Stack

| Layer | Technology | Version | Purpose |
|---|---|---|---|
| Desktop shell | Tauri | `2` | Native window, IPC, sidecar process management |
| Frontend API bridge | @tauri-apps/api | `^2.11.1` | `invoke` / `listen` from TS |
| Frontend framework | React / TypeScript | `~5.6.2` | UI logic (`src/App.tsx`, `src/main.tsx`) |
| Frontend styling | Tailwind CSS | `^3.4.x` | Dark glassmorphism theme |
| Bundler/dev server | Vite | `^6.0.3` | Dev server on port 1420, production bundling |
| Audio capture | cpal (Rust) | `0.15.3` | WASAPI loopback + mic input streams |
| Resampling | rubato (Rust) | `0.16.2` | FFT sinc resample 48/44.1 kHz → 16 kHz |
| Sidecar runtime | Node.js | 20+ | AI orchestration (`gateway/`) |
| Streaming STT | assemblyai / @speechmatics/real-time-client | `^4.6.0` / `^8.5.1` | Real-time STT via `ProviderManager` |
| LLM | Groq | REST API | `gateway/llm/groq-client.js`; Llama 3 models |
| Database driver | better-sqlite3 / rusqlite | `^13.0.3` / `0.31` | SQLite persistence layer |
| Env loading | dotenv (npm) | `^16.4.5` | Loads `gateway/.env` |

## Folder & File Structure

```text
meeting-interpreter/
├── index.html                  # React app shell
├── package.json                # Root manifest: vite/typescript/tauri devDeps; scripts
├── tailwind.config.js          # Tailwind styling rules
├── brain.md                    # THIS FILE — canonical machine reference
├── README.md                   # Project documentation
├── audit/                      # Code audit reports
│   └── CODE-AUDIT-REPORT.md    # Full codebase audit findings (2026-08-26)
├── src/                        # Frontend
│   ├── App.tsx                 # Main React component (listeners, state, UI layout, Modals)
│   ├── main.tsx                # React DOM entry point
│   ├── index.css               # Global styles + Tailwind directives
│   ├── features/
│   │   ├── capture/            # Live capture view components
│   │   └── history/            # Meeting history view components
│   ├── hooks/
│   │   └── useTauriEvents.ts   # Tauri event subscription hook
│   ├── services/
│   │   └── TauriEventBus.ts    # Event bus abstraction
│   └── interfaces/
│       └── IEventBus.ts        # Event bus interface
├── gateway/                    # Node.js sidecar engine
│   ├── sidecar.js              # MAIN sidecar: audio parser → ProviderManager → stdout JSON
│   ├── audio/
│   │   ├── pcm-deframer.js     # PCM1 frame parser
│   │   └── semantic-buffer.js  # Word-count based chunking
│   ├── agents/
│   │   ├── base-agent.js       # Base LLM agent class
│   │   └── context-manager.js  # Topic tracking & significance grading
│   ├── pipeline/
│   │   ├── agent-orchestrator.js # Multi-agent coordination
│   │   ├── chunk-runner.js     # Per-chunk processing pipeline
│   │   ├── chunk-broadcaster.js # Event emission to stdout
│   │   └── chit-chat-gate.js   # Small talk filtering
│   ├── providers/
│   │   ├── assemblyai.js       # AssemblyAI v3 STT integration
│   │   ├── speechmatics.js     # Speechmatics realtime integration
│   │   └── mfcc.js             # Pure-JS 13-coefficient MFCC feature extractor
│   ├── stt/
│   │   ├── provider-manager.js # Manages multiple STT providers (fallback/active)
│   │   ├── diarization-layer.js # Matches speaker labels to embeddings and profiles
│   │   └── transcript-sanitizer.js # Text cleaning
│   ├── llm/
│   │   ├── groq-client.js      # Fetch-wrapper for Groq API
│   │   ├── groq-key-pool.js    # Multi-key rotation to handle strict rate limits
│   │   └── model-discovery.js  # Dynamic model selection
│   ├── db/
│   │   ├── index.js            # SQLite persistence (better-sqlite3)
│   │   └── migrate.js          # Forward-only SQLite migrations
│   ├── state/
│   │   ├── meeting-state.js    # In-memory meeting context
│   │   ├── prompt-builder.js   # LLM prompt construction
│   │   └── speaker-tracker.js  # Speaker statistics
│   ├── infrastructure/
│   │   ├── logger.js           # Structured logging
│   │   ├── validate.js         # Input sanitization and event validation
│   │   ├── billing-tracker.js  # API usage tracking
│   │   └── text-similarity.js  # Deduplication
│   ├── lifecycle/
│   │   └── shutdown.js         # Graceful shutdown handler
│   ├── config/
│   │   └── agent-config.js     # Agent model/timeout config
│   └── .env                    # API keys (gitignored)
└── src-tauri/                  # Rust backend (Tauri v2)
    ├── Cargo.toml              # Crate manifest
    ├── tauri.conf.json         # Tauri settings
    ├── capabilities/
    │   └── default.json        # Tauri permissions
    └── src/
        ├── main.rs             # Bin entry
        ├── lib.rs              # App setup, command registration
        ├── adapters/
        │   ├── gateway_client.rs # Node sidecar process management
        │   ├── mac_audio.rs    # Audio capture (cpal)
        │   └── sqlite.rs       # SQLite read path
        ├── application/
        │   └── capture_usecase.rs # Capture orchestration
        ├── commands/
        │   ├── capture.rs      # start_capture / stop_capture
        │   ├── db.rs           # get_meetings / get_meeting_details
        │   └── audio_devices.rs # Device detection
        ├── domain/
        │   └── meeting.rs      # Domain models
        ├── ports/
        │   ├── audio_capture.rs # AudioCapture trait
        │   ├── db.rs           # Database trait
        │   └── gateway.rs      # GatewayClient trait
        ├── sidecar/
        │   ├── event_router.rs # JSON → Tauri event routing
        │   └── events.rs       # Event payload structs
        ├── streaming.rs        # PCM1 framing sink
        ├── resample.rs         # FFT audio resampler
        └── wav_sink.rs         # Debug WAV writer
```

## Architecture & Data Flow

**Pattern: layered, process-isolated pipeline (real-time plane + intelligence plane).**

1. User clicks Start → `App.tsx` calls `invoke("start_capture")`.
2. `lib.rs` `start_capture`: spawns `node ../gateway/sidecar.js`.
3. `mac_audio.rs`: captures output and mic, downmixes to mono, resamples to 16 kHz.
4. `streaming.rs`: chunks audio into PCM1 frames and writes to sidecar `stdin`.
5. `sidecar.js`: parses PCM1, passes to `ProviderManager`.
6. `ProviderManager`: routes binary audio to active STT (e.g. Speechmatics).
7. STT returns turn → `ProviderManager` emits `partial`/`final` to `sidecar.js`.
8. `sidecar.js` runs label through `diarization-layer.js` (extracts MFCC via `mfcc.js` + cosine similarity against `speaker_embeddings` DB).
9. `sidecar.js` prints `{type:"Final", speaker, sttLabel, text}` to `stdout`.
10. `sidecar.js` semantic buffer flushes → `chunk-runner.js` LLM pipeline.
11. `chunk-runner.js` checks `circuit-breaker.js`, fetches completions via `groq-client.js` (rotated keys via `groq-key-pool.js`).
12. `sidecar.js` prints semantic JSON events to `stdout`.
13. `lib.rs` deserializes `SidecarEvent` (including `sttLabel`), emits Tauri events.
14. `App.tsx` listens and updates React state.

## Database Schema

SQLite (via `better-sqlite3` in JS, `rusqlite` in Rust). Located at `meeting_history.db`.
Schema maintained via forward-only migrations in `gateway/db/migrate.js`.

- `meetings`: id, start_time, summary, end_time, status, api_calls
- `transcripts`: meeting_id, speaker, text, timestamp
- `speaker_names`: stt_label, display_name
- `speaker_embeddings`: label, embedding (JSON)
- `speaker_sessions`: meeting_id, display_name, last_seen
- `speaker_profiles`: meeting_id, speaker, chunk_count, topics
- `chunks`: meeting_id, seq, speaker, text, significance, topic
- `decisions`, `action_items`, `technical_analyses`, `suggested_replies`, `summaries`, `risks`, `glossary_terms`.

## API Reference

**Tauri Commands:** `start_capture`, `stop_capture`.

**Frontend Events:** 
- `provider_status`
- `transcript_partial`, `transcript_final` (Payload includes `sttLabel`!)
- `context_explanation`, `chunk_significance`
- `meeting_decisions`, `meeting_action_items`, `suggested_response`
- `circuit_breaker`, `capture_error`, `api_health`

**Sidecar JSON Events:**
`Connected`, `Closed`, `Error`, `Partial`, `Final`, `Significance`, `Explanation`, `Decisions`, `ActionItems`, `Response`, `CircuitBreaker`, `ApiHealth`.

## Core Modules

| Module / File | Responsibility |
|---|---|
| `src-tauri/src/lib.rs` | App lifecycle, commands, JSON→event relay |
| `src-tauri/src/adapters/mac_audio.rs` | Loopback+mic capture, downmix, mixer thread |
| `src/App.tsx` | Main React UI, listeners, modal management |
| `gateway/sidecar.js` | Integration hub: frame parser, pipeline coordination |
| `gateway/pipeline/chunk-runner.js` | LLM pipeline |
| `gateway/db/index.js` | SQLite persistence |
| `gateway/stt/provider-manager.js`| STT fallback and active provider management |
| `gateway/stt/diarization-layer.js`| Speaker matching and identification |

## Auth & Authorization
None. API keys loaded from `gateway/.env`.

## Environment Variables

| Name | Purpose | Required? |
|---|---|---|
| `ASSEMBLYAI_API_KEY` | AssemblyAI STT auth | Optional (if using Speechmatics) |
| `SPEECHMATICS_API_KEY` | Speechmatics STT auth | Optional (if using AssemblyAI) |
| `STT_PROVIDER` | `speechmatics` or `assemblyai` | No (defaults to speechmatics) |
| `GROQ_API_KEY_1`, `2`, `3` | Groq LLM API keys for fallback pool | Yes (at least one) |
| `GROQ_MODEL` | Override model (e.g., `llama-3.1-8b-instant`) | No |
| `TAURI_DEV_HOST` | Dev-server host override | No |

## External Integrations

- **Speechmatics**: Real-time STT.
- **AssemblyAI**: Fallback Real-time STT.
- **Groq API**: OpenAI-compatible REST API for LLM completions.

## Build, Run, Deploy

```bash
npm install
cd gateway && npm install && cd ..
cp gateway/.env.example gateway/.env
npm run tauri dev
```
(No Dockerfile or deploy scripts yet).

## Conventions & Patterns
- Rust uses `anyhow` for errors.
- JS Sidecar uses typed JSON stdout for IPC.
- React UI uses functional components with Tauri `listen`.

## Agent Instructions
- **Modifying JSON events:** When adding fields to sidecar JSON out (`sidecar.js`), update `SidecarEvent` mapping in `lib.rs`, the `Payload` structs in Rust, and the `addListener` types in `App.tsx` in lockstep.
- **Diarization & Speakers:** Always pass `sttLabel` alongside `speaker` from sidecar to frontend so the UI can map it to the Rename Modal.
- **Circuit Breaker:** Always route LLM requests through `groq-client.js` and `circuit-breaker.js` to ensure key rotation and limit adherence.

## Code Audit Summary (2026-08-26)

A comprehensive code audit was performed on 2026-08-26. Full report: `audit/CODE-AUDIT-REPORT.md`.

### Findings by Severity

| Severity | Count | Key Issues |
|----------|-------|------------|
| **Critical** | 1 | API keys stored in plaintext (`gateway/.env`) |
| **High** | 4 | CSP disabled, `withGlobalTauri: true`, sidecar path from CWD, unauthenticated stdin protocol |
| **Medium** | 8 | Mutex panics, unbounded channels, resampler flush, fragile DB path, O(n) deframer scan, flush timer race, type confusion |
| **Low** | 9 | Misleading names, unused deps, logger not initialized, dead code, hardcoded limits |

### Immediate Actions Required

1. **Rotate all API keys** — treat plaintext keys as compromised
2. **Enable CSP** in `tauri.conf.json`
3. **Set `"withGlobalTauri": false`** to prevent XSS → IPC escalation

### Architecture Verdict

The codebase demonstrates clean separation of concerns with hexagonal architecture in Rust and a layered pipeline in Node.js. Primary risks are security configuration rather than architectural flaws.

## Changelog
- **[2026-08-26]**: Updated Folder Structure, Core Modules, and Data Flow to reflect actual file organization (adapters/, application/, commands/, domain/, ports/, sidecar/ in Rust; audio/, agents/, pipeline/, providers/, stt/, llm/, db/, state/, infrastructure/, lifecycle/, config/ in gateway). Added Code Audit Summary section. Updated README.md with audit information.
- **[2026-08-22]**: Added `sttLabel` field tracking across JS, Rust, and React layers for speaker renaming.
- **[2026-08-22]**: Update Project Overview, Tech Stack, Folder Structure, Data Flow, Database, and Env Vars to reflect React/Tailwind UI upgrade, Groq LLM switch, multi-STT provider manager, MFCC diarization layer, and SQLite database migration. Test files purged.