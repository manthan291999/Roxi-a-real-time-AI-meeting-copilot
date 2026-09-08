# brain.md — Canonical Knowledge Base: Roxi AI Meeting Interpreter

> Machine-optimized reference. Every fact below was re-verified against file contents on **2026-09-07**. An AI agent reading only this file should be able to explain the project and safely propose changes without re-scanning the repo.
>
> **What changed since the 2026-09-01 revision:** the frontend was rebuilt as a single-window three-tab shell (the `TopBar.tsx`/`ContextModal.tsx`/overlay-window tree described in the old revision is gone), agent model tiering was split (most agents run `gpt-4o-mini`), screen-capture protection was **turned off**, and "Ask Roxi" grew a second corpus — uploaded documents, retrieved semantically and merged with meeting search by rank fusion. Sections below marked **NEW** did not exist in the previous revision.

## Project Overview

- **Name:** Roxi AI / AI Meeting Interpreter (manifest names still generic: `tauri-app`, version `0.1.0`).
- **Purpose:** Real-time desktop copilot that listens to meetings, transcribes speech with speaker diarization, and translates complex/technical discussion into plain language with extracted decisions, action items, risks, and suggested replies. It also answers questions over past meetings **and over documents the user uploads**.
- **Summary:** A Tauri v2 desktop app with four cooperating runtimes: a React/Tailwind frontend, a Rust core that captures loopback + mic audio and runs the **native LLM agent pipeline** (multi-agent OpenAI graph via rig-core), a Node.js sidecar for STT + MFCC diarization (`gateway/`), and a second Node.js sidecar (`chatbot/`, LangGraph Adaptive-RAG) for meeting-history and document Q&A. Rust ↔ Node communicate over OS pipes (PCM1 audio in, typed JSON events out). A circuit breaker + cost anomaly detector cap LLM spend.
- **Domain:** Productivity / meeting intelligence / accessibility for non-technical participants.
- **Primary user flows:**
  1. Launch → frameless transparent widget (420×780), status "Ready". App is a menubar agent: no Dock icon.
  2. **Start Capture** → meeting-context intake → `invoke("start_capture")` → gateway sidecar spawns, audio capture begins → live session.
  3. The live session is a **three-tab shell**: `suggest` (decisions/risks/actions/replies as cards), `ask` ("Ask Roxi"), `listen` (live transcript).
  4. Speech appears as partial then final transcripts; explanations, decisions/action items/risks and suggested replies stream in from the Rust agent graph.
  5. Rename speaker labels globally via the rename modal (`rename_speaker`).
  6. At limit → cost-limit state, AI processing pauses.
  7. **Stop** → `invoke("stop_capture")` → sidecar killed.
  8. **Option+Space** global hotkey toggles window visibility (tray icon Show/Hide/Quit is the other lifeline).

## Window & Overlay Architecture (macOS)

Implemented in the `src-tauri/src/lib.rs` setup hook + `src-tauri/src/macos_overlay.rs`.

| Feature | Implementation | Status |
|---|---|---|
| **Capture shield** | `win.set_content_protected(true)` | ⚠️ **DISABLED.** Commented out at `lib.rs:82` with the note "Removed so the window is visible in screen shares." The window **is** visible to screenshots and screen sharing today. |
| **Dock/app-switcher hiding** | `app.set_activation_policy(ActivationPolicy::Accessory)` | Active — no Dock icon, no Cmd+Tab entry. |
| **Fullscreen float** | `macos_overlay.rs`: `NSStatusWindowLevel` + `CanJoinAllSpaces \| FullScreenAuxiliary` (objc2-app-kit) | Active — stays above fullscreen Zoom/Meet and follows Spaces. |
| **Global hotkey** | `tauri-plugin-global-shortcut`, `Option+Space` | Active — toggles show/hide + focus. |
| **Tray lifeline** | `TrayIconBuilder` id `roxi-tray`, menu Show/Hide/Quit | Active — the only way back when hidden. |
| **Transparent window** | `tauri.conf.json`: `transparent`, `decorations:false`, `alwaysOnTop`, `shadow`; `macOSPrivateApi: true` | Active. |

**If a task says "stealth" or "invisible to screen share", it is describing behaviour that is currently off.** Confirm with the user before assuming it works; re-enabling is one uncommented line, but it was removed deliberately.

**Honest limits (when re-enabled):** a phone photo of the monitor always shows it; the process still appears in Activity Monitor; capture apps bypassing ScreenCaptureKit on macOS < 13 are outside the guarantee.

## Glassmorphism shell — the opacity budget

The visual shell is governed by **one architectural rule**, defined in `src/styles.css` and consumed through `src/design-system/tokens.ts`:

| Variable | Value | Meaning |
|---|---|---|
| `--glass-alpha` | `0.35` | Alpha of the shell's dark layer. Lower = more see-through. Rises to `0.88` in the high-contrast media query. |
| `--glass-dim` | `0.25` | `brightness()` applied to the **backdrop** before the shell, inside `backdrop-filter`. This is what makes text readable over a bright desktop without making the shell opaque. |
| `--glass-blur` | `32px` | Backdrop blur radius. |

**The rule:** every surface inside the shell is either transparent or a white overlay at **≤ 0.06 alpha**. Nested opaque panels are what turn glass into grey soup. Sheets that sit *over* the glass (modals, tooltips) are the deliberate exception — they cannot derive from `--glass-alpha` or the text behind them shows through, so they carry their own readable ground. Readability is bought with `brightness()` inside `backdrop-filter`, **not** by raising surface alpha.

Reusable primitives live in `src/design-system/` (`GlassCard`, `Badge`, `TagChip`, `Waveform`, `SignalRing`, `Tooltip`, icons, `tokens.ts`, `tagPalette.ts`). Build with these rather than ad-hoc styled `div`s.

## Tech Stack

| Layer | Technology | Version | Purpose |
|---|---|---|---|
| Desktop shell | Tauri | `2` (locked 2.11.5) | Native window, IPC, sidecar management, tray, global shortcuts |
| Tauri plugins | tauri-plugin-opener, tauri-plugin-global-shortcut | `2` / `2.3.2` | Opener links; Option+Space hotkey |
| macOS native FFI | objc2-app-kit | `0.3` | Window level + collection behavior in `macos_overlay.rs` |
| Frontend framework | React / TypeScript | `~5.6.2` | UI (`src/app/App.tsx` + feature hooks) |
| Frontend styling | Tailwind CSS | `^3.4.x` + glass tokens in `styles.css` | Frosted-glass shell (see opacity budget) |
| Bundler/dev server | Vite | `^6.0.3` | Dev server port 1420, production bundling |
| Audio capture | cpal (Rust) | `0.15.3` | Loopback (BlackHole) + mic input streams |
| Resampling | rubato (Rust) | `0.16.2` | FFT sinc resample → 16 kHz |
| Rust LLM pipeline | rig-core, tokio, reqwest, async-trait | `0.2.1`, `1`, `0.12`, `0.1.80` | Native multi-agent graph |
| Env loading (Rust) | dotenvy | `0.15` | Loads root `.env` — critical for macOS .app bundles |
| Sidecar runtime | Node.js | 20+ | STT + diarization (`gateway/`), history/document chatbot (`chatbot/`) |
| Streaming STT | assemblyai / @speechmatics/real-time-client | `^4.6.0` / `^8.5.1` | Real-time STT via `ProviderManager` |
| LLM | OpenAI — **tiered**, see below | SDK `openai` (JS), rig (Rust) | All completions |
| **Embeddings** | **OpenAI `text-embedding-3-small`** | 1,536 dims, $0.02/1M tokens | **Document chunk + query vectors** |
| **Document parsing** | **pdf-parse `^2.4.5`, mammoth `^1.12.2`** | — | **PDF and DOCX text extraction** |
| Graph framework | @langchain/langgraph | `^0.2.0` | Chatbot Adaptive-RAG state graph |
| Database driver | better-sqlite3 / rusqlite | `^13.0.3` / `0.31` | SQLite persistence |
| LLM observability | dashboard/ (express + better-sqlite3, zero-build) | — | Reads `llm_usage.db` |

### Model tiering (important — changed since the last revision)

Set in `src-tauri/src/application/agent_registry.rs:13-21`, **not** hardcoded per agent:

| Tier | Model | Agents |
|---|---|---|
| Fast | `gpt-4o-mini` | `context_manager`, `explanation`, `technical`, `analyst`, `risk_detector` |
| Premium | `gpt-5.6-luna` | `response_agent` only (final synthesis) |

The chatbot's own default model is `gpt-5.6-luna` (`CHATBOT_MODEL`). When adding an agent, choose a tier deliberately — do not default to premium. **Never send `temperature`** — treat this as the safe default for every agent call, not just the premium one.

## Folder & File Structure

```text
meeting-interpreter-mac-main/
├── .env                      # API keys (gitignored) — both Rust and sidecars read root first
├── brain.md                  # THIS FILE — canonical machine reference
├── CLAUDE.md                 # Working instructions for Claude Code
├── PLAN-glass-ui-and-document-rag.md   # The 12-phase plan this codebase is mid-way through
├── src/                      # Frontend (React + Tailwind) — SINGLE WINDOW
│   ├── app/                  # App.tsx (composition root: idle screen or 3-tab session), main.tsx (HashRouter)
│   ├── shell/                # AppShell.tsx (glass shell), NavigationTabs.tsx, WidgetHeader.tsx
│   ├── design-system/        # GlassCard, Badge, TagChip, Waveform, SignalRing, Tooltip, icons,
│   │                         #   tokens.ts, tagPalette.ts, keyframes.css
│   ├── context/              # ServicesContext.ts, ServicesProvider.tsx, useServices.ts (DI)
│   ├── features/
│   │   ├── capture/          # useCaptureSession + useCaptureFlow, IdleScreen, StartCaptureButton,
│   │   │                     #   BlackholeNotice, context-intake/ (MeetingContextModal + presets)
│   │   ├── transcript/       # TranscriptPane, TranscriptLine, useTranscript, useAutoScroll,
│   │   │                     #   SpeakerRenameModal
│   │   ├── suggest/          # SuggestAnswersPane, SuggestCard, TagFilterRow, useSuggestAnswers,
│   │   │                     #   useSuggestFilters
│   │   ├── chat/             # ChatPane, ChatInput, ChatThreadProvider, useChatThread,
│   │   │                     #   components/{RoxiAnswerCard,SourceChip,ThinkingIndicator,UserBubble}
│   │   ├── analysis/         # AnalysisPane, useAnalysis
│   │   └── history/          # HistoryPane, MeetingDetailModal, useHistory, useMeetingDetail
│   ├── services/             # TauriCaptureService, TauriEventBus, TauriChatService,
│   │   │                     #   TauriHistoryRepository, SpeakerRepository
│   │   ├── mappers/          # wire-format → UI-type mappers
│   │   └── wire/             # wireTypes.ts (raw event payload shapes)
│   ├── shared/
│   │   ├── interfaces/       # ICaptureService, IEventBus, IChatService, IHistoryRepository,
│   │   │                     #   ISpeakerRepository
│   │   ├── types/            # chat.ts, suggest.ts, analysis.ts, capture.ts, history.ts, core.ts, ui.ts
│   │   └── ui/               # EmptyState, InputBar, RoxiLogo, Spinner, StopButton
│   ├── utils/                # deduplicateCards, formatTime, speakerColors
│   └── styles.css            # Tailwind directives + --glass-* budget + keyframes
├── gateway/                  # Node.js STT sidecar engine
│   ├── sidecar.js            # PCM1 parser → ProviderManager → stdout JSON (+ diarization, sanitizer)
│   ├── audio/pcm-deframer.js
│   ├── providers/            # assemblyai.js, speechmatics.js, mfcc.js (13-coeff MFCC)
│   ├── stt/                  # provider-manager.js, diarization-layer.js, transcript-sanitizer.js
│   ├── config/               # gateway's own env/argv resolution + validation (NOT a leftover)
│   ├── db/                   # index.js, migrate.js (forward-only migrations)
│   └── ... tools/, interfaces/, infrastructure/, state/, lifecycle/
├── chatbot/                  # Ask Roxi: LangGraph Adaptive-RAG over meetings AND documents
│   ├── sidecar.js            # stdio JSON protocol entry
│   ├── bin/                  # rebuild-index.js, ask.js
│   ├── data/                 # chat_index.db (FTS5), doc_store.db (documents + vectors)
│   └── src/
│       ├── composition/container.js       # DI root — the only module naming concrete classes
│       ├── config/envConfig.js            # the only module reading process.env
│       ├── domain/
│       │   ├── errors.js                  # ChatbotError, ConfigError, BudgetExhaustedError,
│       │   │                              #   StoreError, DocumentError
│       │   └── ports/                     # Retriever, EvidenceSource, MeetingStore, LlmGateway,
│       │                                  #   EmbeddingGateway, DocumentParser, DocumentRepository,
│       │                                  #   BudgetGuard, ChatLogger
│       ├── application/
│       │   ├── graph/                     # buildChatGraph, routing, state, constants, evidence
│       │   ├── nodes/                     # analyzeQuery, retrieve, gradeDocuments, rewriteQuery,
│       │   │                              #   clarify, generate, respondNoData
│       │   ├── retrieval/                 # CompositeEvidenceSource, rrf.js
│       │   └── useCases/                  # AnswerQuestionUseCase, IndexDocumentUseCase,
│       │                                  #   ManageDocumentsUseCase
│       ├── infrastructure/
│       │   ├── persistence/               # FtsRetriever, FtsIndexBuilder, FtsEvidenceSource,
│       │   │                              #   SqliteMeetingStore, ftsQuery
│       │   ├── documents/                 # DocumentRepositorySqlite, DocumentEvidenceSource,
│       │   │                              #   chunker, migrations, parsers/{Text,Pdf,Docx,registry}
│       │   ├── embedding/OpenAiEmbeddingGateway.js
│       │   ├── llm/                       # OpenAiLlmGateway, LangchainLlmGateway, prompts, json-parse
│       │   ├── budget/, usage/, logging/
│       └── transport/                     # stdioSidecar.js (protocol), cliRepl.js
├── dashboard/                # LLM usage dashboard (zero-build): server.js, codemap.json
└── src-tauri/                # Rust backend (Tauri v2)
    ├── tauri.conf.json       # ONE window "main" (420×780, transparent, undecorated, always-on-top)
    ├── capabilities/default.json
    └── src/
        ├── lib.rs            # Composition root: adapters, agents, ChunkGraph, commands, setup hook
        ├── macos_overlay.rs  # NSStatusWindowLevel + CanJoinAllSpaces FFI
        ├── application/
        │   ├── agent_registry.rs   # MODEL TIERS live here
        │   └── capture_usecase.rs
        ├── agents/           # RUST-NATIVE LLM PIPELINE (hexagonal)
        │   ├── orchestrator/ # chunk_graph.rs, routing.rs (pure fn, unit-tested)
        │   ├── agents/       # context_manager, explanation, technical, analyst, risk_detector,
        │   │                 #   response_agent, chit_chat_gate, complexity_analyzer (UNWIRED)
        │   ├── adapters/     # openai_adapter.rs (rig → OpenAI, tagged), usage_store.rs
        │   ├── ports/        # agent_port.rs (Agent trait), llm_port.rs (LlmClient trait)
        │   └── domain/       # chunk_state, decision, action_item, risk, agent_error
        ├── adapters/         # mac_audio.rs, gateway_client.rs, chat_client.rs, sqlite.rs
        ├── commands/         # capture, db, chat, audio_devices, speaker
        ├── sidecar/          # events.rs, event_router.rs, chat_events.rs
        ├── streaming.rs      # PCM1 framing sink
        └── resample.rs       # FFT audio resampler
```

**Note:** `src/features/history-chat/` survives as empty directories only (its files were deleted when the chat panes were de-duplicated; git does not track empty dirs). Nothing imports it.

## Architecture & Data Flow

**Pattern: layered, process-isolated pipeline (real-time plane + intelligence plane). The LLM agent pipeline lives in Rust, not Node.**

1. User clicks Start → `useCaptureFlow` → `captureService.startCapture(context)` → `invoke("start_capture")`.
2. `lib.rs`: loads root `.env` via dotenvy; spawns `node ../gateway/sidecar.js` (optional `--context`, `--role` argv).
3. `mac_audio.rs`: captures BlackHole loopback + mic, downmixes to mono.
4. `resample.rs` → 16 kHz; `streaming.rs` frames PCM1 (8-byte header + PCM16) → sidecar stdin.
5. `sidecar.js`: `PcmDeframer` → `ProviderManager` (AssemblyAI primary, Speechmatics fallback) → `partial`/`final`.
6. Final path: `validateTranscriptEvent` → `transcript-sanitizer` (drops low-confidence/filler) → `diarization-layer` (MFCC + cosine similarity vs `speaker_embeddings`) → typed JSON line on stdout → transcript row persisted to `meeting_history.db`.
7. `event_router.rs` deserializes each line into `SidecarEvent`. On `Final` it runs the Rust-native **`ChunkGraph`** on `tauri::async_runtime`:
   - `chit_chat_gate::is_filler` (local heuristic) → fast-exits small talk with **no LLM call**.
   - `ContextManagerAgent` (sequential) → topic tracking + significance grading.
   - **Complexity (Low/Medium/High) arrives as one extra field in `ContextManagerAgent`'s JSON**, folded in to save a sequential round-trip. `agents/agents/complexity_analyzer.rs` still exists but is **intentionally unwired** — nothing constructs it. Re-wire it in `application/agent_registry.rs` only if complexity needs its own model or cadence. `Complexity::Medium` is the `ChunkState` default when the field is absent.
   - Stage-2 conditional parallel fan-out via the pure function `orchestrator/routing.rs::decide()`:
     - `Low` → `ExplanationAgent` only
     - `Medium` → `ExplanationAgent` + `RiskDetectorAgent`
     - `High` → `ExplanationAgent` + `TechnicalAgent` + `AnalystAgent` + `RiskDetectorAgent`
   - `ResponseAgent` (sequential, last) → suggested reply, on the premium model.
   - Every call goes through `OpenAiAdapter` with per-tag usage logging to `llm_usage.db`.
8. `event_router.rs` emits Tauri events (list under API Reference).
9. Frontend: `TauriEventBus` subscribes via `IEventBus`; each feature hook owns its slice of state.

**Stealth flow (startup):** setup hook sets Accessory policy → always-on-top → `macos_overlay::make_overlay` → registers Option+Space → builds tray. **`set_content_protected` is commented out.**

## Ask Roxi — hybrid retrieval over meetings + documents **NEW**

"Ask Roxi" is a separate on-demand branch: `invoke("ask_chat")` → `adapters/chat_client.rs` spawns/talks to `chatbot/sidecar.js` over stdio JSON → LangGraph graph → `chat_thinking` / `chat_reply` / `chat_error` events.

**Graph** (`application/graph/buildChatGraph.js`, routing in `graph/routing.js`):
`analyze_query → retrieve → grade_documents → {generate | clarify | rewrite_query | respond_no_data}`

### Two corpora behind one port

`retrieveNode` depends on a single **`EvidenceSource`** and cannot tell how many corpora sit behind it:

| Adapter | Corpus | Method |
|---|---|---|
| `FtsEvidenceSource` | Meeting history (`chat_index.db`) | Lexical — FTS5/BM25, wraps the untouched `FtsRetriever` |
| `DocumentEvidenceSource` | Uploaded documents (`doc_store.db`) | Semantic — embeds the question, cosine over stored chunk vectors |
| `CompositeEvidenceSource` | Both, concurrently | Merges by Reciprocal Rank Fusion |

`EvidenceSource` is a **second port beside `Retriever`, not a widened `Retriever`**: `Retriever.search` takes sanitized FTS5 MATCH expressions that a vector search cannot use, and `respondNoDataNode` still needs `Retriever.recentTopics()`. `search()` receives both `question` and `matchExprs`; each adapter uses what it can.

**Failure isolation:** `CompositeEvidenceSource` treats a failing source as empty and logs it. A missing document store or a rate-limited embedding call must not take down meeting search.

**Cost guard:** `DocumentEvidenceSource` checks the corpus **before** embedding. With no documents uploaded it returns `[]` without billing a query embedding — otherwise every question on every install would pay for one forever.

### Merging — Reciprocal Rank Fusion, not score arithmetic

`application/retrieval/rrf.js` is pure and unit-tested (mirroring how `orchestrator/routing.rs` and `graph/routing.js` are kept). BM25-derived scores are unbounded and cosine is 0..1; adding them, or min-max normalizing per query, is unstable because the ranges move with every question. RRF uses **only rank**, so it is scale-free. `RRF_K: 60`.

### Citations — refs, not meeting ids

`meetingId` was load-bearing in grouping, prompting and citation. Documents have no meeting, so rather than faking one:

- Every hit belongs to a **group** — one meeting or one document — identified by `groupKey` (`meeting:3`, `doc:abc`).
- Every group gets a **`ref`**: the token the model cites and the UI matches on. Meetings keep `M<meetingId>`; documents get `D1`, `D2`… in selection order.
- **Refs are assigned in `boundEvidence`, not by the sources.** They are scoped to one answer — `D2` means "the second document *in this answer*" and means nothing outside it.
- `GENERATE_SYSTEM` asks for `citedRefs: ["M3","D2"]`. `generateNode` **also accepts the legacy `citedMeetingIds`**, mapped through `M<id>`, so an in-flight or old-shaped model response still resolves its source cards.
- **Source quota:** `MIN_GROUPS_PER_SOURCE_TYPE: 1` guarantees each contributing corpus at least one group, so a 200-chunk PDF cannot occupy every slot in `MAX_EVIDENCE_GROUPS: 4`.

`toSources` emits **different fields per type** — meeting cards carry `meetingId`/`date`/`speaker`, document cards carry `docId`/`fileName`/`pageNumber`. A padded shape would emit `Number(null) === 0` and render as "Meeting #0".

### Document indexing pipeline

`IndexDocumentUseCase`: **validate → hash → parse → chunk → embed → store**, reporting progress at each phase.

- **Validation runs before any row exists**, so a rejected upload leaves no trace: missing file, unsupported extension (the error lists what *is* supported), zero bytes, over `maxDocumentBytes`, or over either library cap.
- **Content is hashed before insert.** `content_hash` carries a unique index; a ready duplicate returns the existing document and re-embeds nothing. A non-ready duplicate (failed, or killed mid-index) is deleted and re-indexed — otherwise one failed upload would own that file's hash forever.
- **Failures are recorded on the row** via `markFailed`, and `list()` returns `status` + `errorMessage`: the document list is the only place to learn why an upload failed once the toast is gone.
- **Only `ready` documents are searchable** — `searchByVector` filters on status, so a half-indexed document never answers a question.
- Embedding is sliced at 64 (the gateway's own internal batch size) so progress is observable without adding requests.
- Chunking (`chunker.js`) is pure, char-based (2,000 chars ≈ 500 tokens, 256 overlap), preferring paragraph → sentence → hard-cut boundaries, carrying page numbers through so a citation can say "p4".

### Concurrency — two busy lanes

`stdioSidecar.js` keeps **`askBusy` and `docBusy` independently**. A single flag would make a question asked during a 30-second upload fail with `BUSY` — precisely when someone wants to ask about the document they just added. `better-sqlite3` is synchronous and the doc store is its own file, so the lanes cannot interleave a write; each lock only serializes its own kind of request.

`startStdioSidecar(container, io?)` takes optional `{input, output, exit}` defaulting to the real process streams, so the protocol is testable without touching stdio or calling `process.exit`.

### Fully Wired

Documents are now reachable from the UI. The `DocumentTray`, `DocumentUploadButton`, and Rust-side Tauri commands (`upload_document`, `list_documents`, `delete_document`) provide full UI integration. `ChatSource` and `SourceChip` render citations pointing to documents seamlessly.

## Database Schema

SQLite. **Three** stores, never joined at the query level:

- **`meeting_history.db`** — written by the gateway sidecar (better-sqlite3), read by Rust (rusqlite, `adapters/sqlite.rs`), opened **read-only** by the chatbot to avoid WAL conflicts between two Node processes. Tables (verified against the live DB 2026-09-07): `meetings`, `transcripts`, `chunks`, `decisions`, `action_items`, `risks`, `technical_analyses`, `suggested_replies`, `summaries`, `glossary_terms`, `speaker_profiles`, `speaker_names`, `speaker_embeddings`, `schema_version`. (Earlier revisions of this file also listed `speaker_sessions` — that table does not exist.) Forward-only migrations in `gateway/db/migrate.js` — never edit a shipped one.
- **`llm_usage.db`** — written by Rust `agents/adapters/usage_store.rs` and by the chatbot's `UsageRecorder` (one row per LLM/embedding call: tag, model, status, latency, tokens, cost, payloads). Read by `dashboard/`.
- **`chatbot/data/chat_index.db`** — the chatbot's own FTS5 index over meeting history. Rebuilt wholesale by `FtsIndexBuilder`; opened read-only by `FtsRetriever`. Regenerate with `chatbot/bin/rebuild-index.js` — never hand-edit.
- **`chatbot/data/doc_store.db`** **NEW** — uploaded documents and their vectors. Deliberately **not** `chat_index.db`: that file is wholesale-rebuilt, which would tie user documents to an index rebuild. A separate file means separate ownership and a deletable module.

```sql
CREATE TABLE documents (
  doc_id TEXT PRIMARY KEY, file_name TEXT NOT NULL, mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL, page_count INTEGER, chunk_count INTEGER NOT NULL DEFAULT 0,
  embed_model TEXT NOT NULL,        -- provenance: re-embed if the model changes
  dimensions INTEGER NOT NULL,
  status TEXT NOT NULL,             -- indexing | ready | failed
  error_message TEXT, uploaded_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,       -- sha256; dedupes re-uploads
  meeting_id INTEGER                -- RESERVED, unused: documents are global today
);
CREATE TABLE document_chunks (
  chunk_id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL REFERENCES documents(doc_id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL, page_number INTEGER,
  char_start INTEGER NOT NULL, char_end INTEGER NOT NULL, text TEXT NOT NULL,
  embedding BLOB NOT NULL           -- Float32LE[dimensions], L2-normalized
);
CREATE UNIQUE INDEX idx_docs_hash ON documents(content_hash);
```

Vectors are stored **L2-normalized**, which makes cosine similarity a plain dot product at query time. Brute-force search over a few thousand 1,536-dim vectors is single-digit milliseconds — no vector database needed. Revisit past ~50k chunks. Forward-only migrations in `chatbot/src/infrastructure/documents/migrations.js`.

**Document scope: GLOBAL.** Uploaded documents are searchable in every conversation. The `meeting_id` column exists but is unused, so per-meeting scoping later is one forward migration plus a filter in `DocumentEvidenceSource`.

## API Reference

**Tauri Commands** (`invoke_handler!` in `lib.rs`): `start_capture`, `stop_capture`, `check_blackhole_installed`, `get_meetings`, `get_meeting_details`, `ask_chat`, `close_chat`, `rename_speaker`.

**Tauri → frontend events:**
- Capture/STT: `provider_status`, `transcript_partial`, `transcript_final` (payloads include `sttLabel`), `capture_error`
- Agents: `context_explanation`, `technical_explanation`, `chunk_significance`, `meeting_decisions`, `meeting_action_items`, `meeting_risks`, `meeting_summary`, `suggested_response`, `suggest_answer`, `agent_trace`
- Health/cost: `circuit_breaker`, `api_health`, `billing`, `speaker_revision`
- Chat: `chat_ready`, `chat_thinking`, `chat_reply`, `chat_error`, `chat_closed`, `chat_index_rebuilt`

**Gateway sidecar stdout JSON types:** `Connected`, `Closed`, `Error`, `Partial`, `Final`, `Significance`, `Explanation`, `TechnicalExplanation`, `Decisions`, `ActionItems`, `Risks`, `Response`, `CircuitBreaker`, `Billing`, `ApiHealth`, `ProviderStatus`, `SpeakerRevision`. In practice the gateway emits `Partial`/`Final`/`ProviderStatus`/`Error`; semantic types come from the Rust `ChunkGraph`.

**Chatbot sidecar stdio protocol** (`chatbot/src/transport/stdioSidecar.js`):

```jsonc
// stdin
{"type":"Ask","question":"…","threadId":"ask","history":[…]}
{"type":"UploadDocument","docId":"uuid","filePath":"/abs/spec.pdf","fileName":"spec.pdf"}
{"type":"ListDocuments"}
{"type":"DeleteDocument","docId":"uuid"}
{"type":"RebuildIndex","force":false}
{"type":"Shutdown"}

// stdout
{"type":"Ready"}
{"type":"ChatThinking","threadId":"ask","node":"retrieve"}
{"type":"ChatReply","threadId":"ask","payload":{…}}
{"type":"DocumentProgress","docId":"…","phase":"parse|chunk|embed|store","done":128,"total":200}
{"type":"DocumentReady","docId":"…","fileName":"spec.pdf","chunkCount":200,"pageCount":42,"deduped":false}
{"type":"DocumentList","docs":[{"docId","fileName","chunkCount","pageCount","uploadedAt","bytes","status","errorMessage"}]}
{"type":"DocumentDeleted","docId":"…"}
{"type":"IndexRebuilt","stats":{…}}
{"type":"Error","threadId":"ask","docId":"…","message":"…","code":"…"}
{"type":"Bye"}
```

**Correlation:** chat messages echo `threadId` (without it, a UI with more than one thread appends every answer to all of them); document messages carry `docId` instead — they belong to a file, not a conversation. Both are omitted where genuinely unknown.

**Document error codes:** `DOCUMENT_UNSUPPORTED_TYPE`, `DOCUMENT_NOT_FOUND`, `DOCUMENT_TOO_LARGE`, `DOCUMENT_NO_TEXT`, `DOCUMENT_LIBRARY_FULL`, `DOCUMENT_INVALID_REQUEST`, `EMBED_COUNT_MISMATCH`, `BUDGET_EXHAUSTED`, `BUSY`.

## Environment Variables

Put them in a **root `.env`** — both Rust (`dotenvy::dotenv()`) and the sidecars read root first, falling back to `gateway/.env` / `chatbot/.env`. This matters for packaged `.app` bundles, which don't inherit shell env.

| Name | Purpose | Required? |
|---|---|---|
| `OPENAI_API_KEY` | LLM + embeddings (Rust agents, chatbot) | **Yes** |
| `ASSEMBLYAI_API_KEY` | Primary streaming STT | One of the two |
| `SPEECHMATICS_API_KEY` | Fallback STT | " |
| `STT_PROVIDER` | Force `speechmatics` or `assemblyai` | No |
| `LLM_BUDGET_SOFT` / `LLM_BUDGET_HARD` | Circuit breaker call caps (60/80) | No |
| `ANOMALY_COST_PER_CHUNK_USD` / `_PER_MIN_USD` / `_SESSION_BUDGET_USD` | Cost anomaly thresholds (0.05/0.10/2.00) | No |
| `CHATBOT_LLM_BUDGET_SOFT` / `_HARD` | Chatbot's own budget guard (60/80) | No |
| `CHATBOT_LLM_ADAPTER` | `langchain` swaps the chatbot LLM gateway | No |
| `CHATBOT_MODEL` | Chatbot completion model (`gpt-5.6-luna`) | No |
| `CHATBOT_EMBED_MODEL` | **`text-embedding-3-small`** | No |
| `CHATBOT_EMBED_BUDGET_HARD` | **Separate embedding call budget (400)** | No |
| `CHATBOT_DOC_DB` | **`chatbot/data/doc_store.db`** | No |
| `CHATBOT_MAX_DOCUMENT_BYTES` | **Per-file cap (20 MiB)** | No |
| `CHATBOT_MAX_LIBRARY_BYTES` | **Total library cap (200 MiB)** | No |
| `CHATBOT_MAX_DOCUMENTS` | **File-count backstop (50)** | No |
| `CHATBOT_INDEX_DB` / `CHATBOT_MEETING_DB` / `LLM_USAGE_DB` | Path overrides | No |

**Embeddings get their own budget** on purpose: one large upload must not exhaust the call allowance belonging to the conversation it was uploaded for.

## External Integrations

- **OpenAI** — all completions (tiered `gpt-4o-mini` / `gpt-5.6-luna`; never send `temperature`) and all embeddings (`text-embedding-3-small`). Rust via rig-core; chatbot via the OpenAI SDK behind `LlmGateway`/`EmbeddingGateway` ports.
- **AssemblyAI** primary real-time STT; **Speechmatics** automatic fallback.
- **BlackHole 2ch** virtual audio driver for loopback capture.

## Build, Run, Deploy

```bash
npm install && (cd gateway && npm install) && (cd chatbot && npm install)
npm run tauri dev          # Rust + Vite + spawns sidecars on demand

npm run lint               # tsc --noEmit
npm run build              # tsc && vite build
npm run tauri build        # production bundle

npm test                   # chatbot tests only
npm run test:all           # chatbot + gateway
cd chatbot && node --test test/rrf.test.js          # one file
cd src-tauri && cargo test routing::                 # the Rust unit tests that exist

npm run dashboard          # http://localhost:3300 (reads llm_usage.db)
npm run audit:all
```

Dev notes: cargo lives at `~/.cargo/bin/cargo` (not always on PATH). Husky pre-commit blocks staged `.env` files, greps for API-key patterns, and runs `npx tsc --noEmit` — use `--no-verify` only when the user explicitly asks.

**Test counts (2026-09-07):** chatbot **199**, gateway **60**, Rust: only `orchestrator::routing` has `#[test]`s. No chatbot or gateway test makes a network call — every OpenAI-touching class sits behind a port.

## Conventions & Patterns

- **Rust:** `anyhow` errors; hexagonal layout (`ports/`/`adapters/`/`domain/`) mirrored in both `src-tauri/src/` and `src-tauri/src/agents/`. `lib.rs` is the composition root — every adapter, agent and command is constructed there.
- **Agents** implement the `Agent` trait; all LLM access goes through `LlmClient` → `OpenAiAdapter`, which is where usage/cost logging happens. Never call an LLM SDK directly from an agent.
- **`complete_json` is fragile by design:** it extracts JSON by taking the substring between the first `{` and last `}` — no schema validation, no repair. Keep JSON-producing prompts tightly constrained to "return only a JSON object".
- **Chatbot:** ports in `domain/ports/`, one composition root (`container.js`), one env reader (`envConfig.js`). Pure decision logic (`routing.js`, `rrf.js`, `evidence.js`, `chunker.js`) is dependency-free and unit-tested.
- **JS sidecars:** typed JSON stdout IPC; structured logs to **stderr** only — stdout carries protocol messages exclusively.
- **React:** feature folders own their hooks; consume services via `useServices()`, never construct a service class inside a component. Reuse `design-system/` primitives.
- **Process isolation is deliberate** — don't turn the Rust ↔ Node pipes into network sockets.

## Agent Instructions

- **Modifying JSON events** is a three-file lockstep change: `sidecar/events.rs` (payload struct), `event_router.rs` (match arm → Tauri event), and the frontend (`IEventBus` + `TauriEventBus`/`wireTypes.ts`/mapper + hook).
- **Adding an agent:** implement `Agent`; decide sequential vs stage-2; add it as a field on `ChunkGraph`; update `routing::decide()` if stage-2; register an `OpenAiAdapter::with_tag(...)` in `agent_registry.rs` **with a deliberate model tier**; emit its output in `event_router.rs` plus the matching TS handler.
- **Adding a retrieval corpus:** implement `EvidenceSource` and add one entry to the `sources` array in `container.js`. Nothing else changes — `retrieveNode` sees one source.
- **Citations:** never derive a citation token from `meetingId` again. Assign refs in `boundEvidence`, print them in `formatEvidenceBlock`, and keep the legacy `citedMeetingIds` fallback in `generateNode` until the prompt change has shipped for a while.
- **Diarization & speakers:** always pass `sttLabel` alongside `speaker` end-to-end so the rename modal can map labels.
- **Cost safety:** all LLM calls flow through `OpenAiAdapter` (Rust) or `LlmGateway` + `CallCountBudgetGuard` (chatbot); all embeddings through `EmbeddingGateway` + its **separate** budget. Never bypass.
- **Never send `temperature`** to any agent's LLM call.
- **Migrations are forward-only** in both `gateway/db/migrate.js` and `chatbot/.../documents/migrations.js` — add a new one, never edit a shipped one.
- **Don't** reintroduce Node LLM/agent logic into `gateway/`; `gateway/config/` is the gateway's own config module, not a leftover.
- **Don't** hand-edit `chatbot/data/*.db` — regenerate the FTS index via `bin/rebuild-index.js`.

## Known Gaps & Stale Claims

| Claim | Reality |
|---|---|
| "Invisible to screenshots / screen sharing" (README, older brain.md) | **Off.** `set_content_protected` is commented out in `lib.rs:82`. |
| Toolbar + caption overlay windows | Never existed in the shipped config; the dead surface (`commands/overlay.rs`, toolbar/caption capabilities) has been removed. Reinstating one needs *all* of it: window declaration, hash route, component, capability file, and a `setup()` re-navigation for dev mode (Tauri loads `devUrl` for every window and ignores each one's configured `url`). |
| "All agents use `gpt-5.6-luna`" | Only `response_agent` does. |
| `ComplexityAnalyzerAgent` in the graph | Unwired; complexity is a field on `ContextManagerAgent`'s JSON. |
| `csp: null`, `withGlobalTauri: true` | Both still set, both flagged High in `audit/CODE-AUDIT-REPORT.md`. Verified 2026-09-07: `window.__TAURI__` is referenced nowhere in `src/` or `index.html`, so `withGlobalTauri` can be turned off safely. Queued behind packaging work. |
| `audit/CODE-AUDIT-REPORT.md` (2026-08-26) | Point-in-time; several LLM/agent findings are stale post-migration. Verify against current code before citing. |
| Token-level answer streaming | **Not implemented.** `generateNode` requests `response_format: json_object` and awaits the whole object, so `ChatReply` arrives complete. What streams is *node progress* (`ChatThinking`). Real token streaming means dropping the JSON response format, re-deriving citations from streamed prose, and a new protocol message — a redesign of the answer contract, not a tweak. |
| Windows/Linux support | macOS-only. Cross-platform needs `Cargo.toml` target gating and per-platform loopback audio. |

## Code Audit Summary (2026-08-26)

Full report: `audit/CODE-AUDIT-REPORT.md`. Critical: plaintext API keys in `gateway/.env` (rotate). High: CSP disabled, `withGlobalTauri: true` (XSS→IPC risk), sidecar path from CWD, unauthenticated stdin protocol. Medium/Low: mutex panics, unbounded channels, fragile DB path, O(n) deframer resync, dead code. `TEST-001`: gateway had no real tests (it now has 60). Architecture verdict: clean separation; risks are configuration, not structure.

## Changelog

- **[2026-09-07]** Document RAG, phases 5–9 of `PLAN-glass-ui-and-document-rag.md`:
  - *Phase 5* document domain — ports, `chunker`, Text/PDF/DOCX parsers, `DocumentRepositorySqlite`, `doc_store.db` + migrations. Unit-tested, unwired.
  - *Phase 6* `OpenAiEmbeddingGateway` with its own call budget and usage/pricing rows.
  - *Phase 7* `EvidenceSource` port, `FtsEvidenceSource`, `DocumentEvidenceSource`, `rrf.js`, `CompositeEvidenceSource`; `retrieveNode` swapped to one source; wired in `container.js`. Behaviour-neutral at the time — no upload path existed, so the document source returned empty. (`9c41c0d`)
  - *Phase 8* ref-based citations across meetings and documents: `groupKey` grouping, per-answer `M#`/`D#` refs, source quota, `citedRefs` with a legacy `citedMeetingIds` fallback. The only change to the shipped answer path, isolated for revertability. (`01b16b2`)
  - *Phase 9* upload/list/delete over the chat sidecar protocol: `IndexDocumentUseCase`, `ManageDocumentsUseCase`, three handlers, `askBusy`/`docBusy` lanes, injectable transport io. (`8627cdf`)
  - Chatbot tests: 109 after phase 6, 147 after phase 7, 165 after phase 8, **199** after phase 9. Remaining: Phase 10 (Rust file picker + commands), Phase 11 (upload UI), Phase 12 (E2E + docs).
- **[2026-09-07]** Frontend rebuild (phases 1–4): Material Symbols + missing keyframes (`a36ad39`); frosted-glass shell with a measured opacity budget (`4ab3d7d`); chat de-duplication into one parameterized thread, fixing cross-thread bleed and blank sources (`cc21194`); `threadId` through the whole protocol (`94f4080`). Dead overlay surface removed; durability/hygiene pass (`34a78e4`).
- **[2026-09-01]** Hybrid agent architecture: complexity routing added; ChunkGraph routes Low/Medium/High to 4/5/7 LLM calls vs a fixed 6; ~25% average cost reduction.
- **[2026-09-01]** Overlay work: Accessory policy, `NSStatusWindowLevel` fullscreen float, Option+Space, tray, fully-transparent window. (Capture shield later disabled.)
- **[2026-08-28]** Ask Roxi chatbot (LangGraph Adaptive-RAG + FTS5); LLM stack Groq → OpenAI; Node agent pipeline replaced by the Rust `ChunkGraph`; `dashboard/` added.
- **[2026-08-26]** Folder/data-flow sync + code audit.
- **[2026-08-22]** `sttLabel` speaker renaming; React/Tailwind upgrade; multi-STT provider manager; MFCC diarization; SQLite migration.

## Architectural Decision Records (ADRs)

### ADR 1: Why Node.js Sidecars Remain (2026-09-01)
**Context:** The agent pipeline was rewritten in pure Rust, yet two Node sidecars remain.
**Decision:** Keep Node for STT and the chatbot; use Rust for agents.
**Rationale:** (1) The production real-time SDKs for AssemblyAI and Speechmatics are Node-first, and the diarization engine relies on 13-coefficient MFCC extraction already tuned in JS. (2) The chatbot relies on LangGraph, whose ecosystem is rooted in JS/Python; a cyclic graph runtime in Rust would reinvent the wheel.
**Result:** A hybrid architecture — Rust for concurrency, routing and OS-level window behaviour; Node for specialized SDKs and graph frameworks.

### ADR 2: A Second Retrieval Port, Not a Widened One (2026-09-07) **NEW**
**Context:** Document search had to join meeting search behind `retrieveNode`.
**Decision:** Add `EvidenceSource` beside `Retriever` rather than widening `Retriever.search`.
**Rationale:** `Retriever.search` takes sanitized FTS5 MATCH expressions, which a vector search cannot consume, and `respondNoDataNode` legitimately needs `Retriever.recentTopics()`. Widening would force `FtsRetriever` to accept an argument it does not want — an Interface Segregation violation.
**Result:** `FtsRetriever`, `FtsIndexBuilder`, `ftsQuery`, `buildChatGraph` and `routing.js` were all untouched by the change.

### ADR 3: Rank Fusion, Not Score Arithmetic (2026-09-07) **NEW**
**Context:** Two sources return incomparable relevance scores.
**Decision:** Merge with Reciprocal Rank Fusion (`RRF_K: 60`).
**Rationale:** BM25-derived scores are unbounded; cosine is 0..1. Adding them, or min-max normalizing per query, is unstable because the ranges shift with every question. RRF uses only rank, so it is scale-free.
**Result:** A pure, unit-tested merge function, kept the way `routing.rs` and `routing.js` are kept.

### ADR 4: Documents Get Their Own Database (2026-09-07) **NEW**
**Context:** Where to store uploaded documents and their vectors.
**Decision:** A separate `doc_store.db`, not `chat_index.db`.
**Rationale:** `chat_index.db` is opened read-only by `FtsRetriever` and **wholesale-rebuilt** by `FtsIndexBuilder`. Putting user documents there would couple their lifetime to an index rebuild.
**Result:** Separate file = separate ownership = the document module is deletable in one move.

### ADR 5: Citations Are Per-Answer Refs (2026-09-07) **NEW**
**Context:** `meetingId` was the citation token, and documents have no meeting.
**Decision:** Every hit belongs to a `groupKey`; every group gets a `ref` (`M3`, `D2`) assigned while evidence is bounded.
**Rationale:** Faking a `meetingId` for documents would corrupt grouping, deep links and the UI. Refs are scoped to one answer, so they belong to the bounding step, not the source. Meetings keep `M<meetingId>` so meeting-only answers produce a byte-identical prompt to before.
**Result:** One risky commit, revertable alone, with a legacy `citedMeetingIds` fallback retained.

### ADR 6: Two Concurrency Lanes in the Chat Sidecar (2026-09-07) **NEW**
**Context:** A single `busy` flag guarded all sidecar work.
**Decision:** Split into `askBusy` and `docBusy`.
**Rationale:** A multi-second upload would otherwise reject every question with `BUSY` — exactly when the user wants to ask about the document they just added. `better-sqlite3` is synchronous and the doc store is a separate file, so there is no write-interleaving hazard.
**Result:** Questions and uploads proceed independently; each lock only serializes its own request kind.

### ADR 7: Uploaded Documents Are Global (2026-09-07) **NEW**
**Context:** Documents could be global (searchable everywhere) or scoped to the meeting that was live at upload.
**Decision:** Global, with an unused `meeting_id` column reserved on `documents`.
**Rationale:** Global is simpler and matches "during a meeting or any time". It is also the reversible direction: adding scoping later is one forward migration plus a filter, whereas shipping a scope filter nobody wanted silently hides documents.
**Result:** No scope filter in `DocumentEvidenceSource`; the column stands ready if the decision changes.
