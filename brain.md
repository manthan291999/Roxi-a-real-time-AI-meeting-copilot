# brain.md — Canonical Knowledge Base: Roxi AI Meeting Interpreter

> Machine-optimized reference. Every fact below was re-verified against file contents on **2026-09-14**. An AI agent reading only this file should be able to explain the project and safely propose changes without re-scanning the repo.
>
> **What changed since the 2026-09-07 revision:** the macOS overlay subsystem (`macos_overlay.rs`, fullscreen float, capture-shield, Accessory/no-Dock policy) was **removed outright**, replaced by a plain resizable window with native vibrancy (`window_material.rs`); the agent pipeline's model-tier constants moved to `application/agent_registry.rs` and the "premium" tier is temporarily the same model as the fast tier for cost reasons; a **context-brief compiler** (`agents/brief/`) now builds a cacheable per-agent system-prompt prefix once per meeting instead of re-sending grounding context on every chunk; the app grew a **project/session domain** (multi-project meeting library, `src/features/library/`, `src/features/session/`) that neither this file nor README.md mentioned before; and "Ask Roxi" grew a **web search** capability (hosted OpenAI tool, model decides per turn) alongside its existing meeting+document retrieval. Sections below marked **NEW** did not exist in the previous revision.

## Project Overview

- **Name:** Roxi (`tauri.conf.json`: `productName: "Roxi"`, `identifier: "com.manth.roxi"`; root `package.json` manifest name is still the generic `tauri-app`, version `0.1.0`).
- **Purpose:** Real-time desktop copilot that listens to meetings, transcribes speech with speaker diarization, and translates complex/technical discussion into plain language with extracted decisions, action items, risks, and suggested replies. It answers questions over past meetings, over documents the user uploads, and — since the web search feature — over the live web when the model decides a question needs it. Meetings are organized into **projects**, and each capture grounds every agent in a **compiled brief** assembled from that project's history and documents.
- **Summary:** A Tauri v2 desktop app with four cooperating runtimes: a React/Tailwind frontend, a Rust core that captures loopback + mic audio and runs the **native LLM agent pipeline** (multi-agent OpenAI graph via rig-core, grounded by pre-compiled per-agent briefs), a Node.js sidecar for STT + MFCC diarization (`gateway/`, and the sole writer of `meeting_history.db`), and a second Node.js sidecar (`chatbot/`, LangGraph Adaptive-RAG) for meeting-history, document, and web Q&A. Rust ↔ Node communicate over OS pipes (PCM1 audio + CTL1 control frames in, typed JSON events out). A circuit breaker + cost anomaly detector cap LLM spend.
- **Domain:** Productivity / meeting intelligence / accessibility for non-technical participants.
- **Primary user flows:**
  1. Launch → a resizable, decorated, transparent window (1180×760, min 480×520) with native vibrancy. The app now runs with `ActivationPolicy::Regular` — it has a **Dock icon** and appears in Cmd+Tab, unlike the earlier Accessory/menubar-agent design.
  2. **Project Library** (`src/features/library/`) — pick an existing project or create one; every un-filed meeting lands in a seeded `Unsorted` project rather than having no project at all.
  3. **Start Capture** → meeting-context intake → `invoke("start_capture")` → `BriefUseCase` compiles one brief per agent from that project's glossary/roster/history/open-items/documents → gateway sidecar spawns, audio capture begins → live session.
  4. The live session (`src/features/session/LiveSessionDashboard.tsx` + `LiveStage.tsx`) is a **three-tab shell**: `suggest` (decisions/risks/actions/replies as cards), `ask` ("Ask Roxi"), `listen` (live transcript), with a live amplitude-reactive waveform driven by `audio_level` events.
  5. Speech appears as partial then final transcripts; explanations, decisions/action items/risks and suggested replies stream in from the Rust agent graph.
  6. Rename speaker labels globally via the rename modal (`rename_speaker`).
  7. At limit → cost-limit state, AI processing pauses.
  8. **Stop** → `invoke("stop_capture")` → sidecar killed, that session's `BriefStore` entries cleared.
  9. **Option+Space** global hotkey toggles window visibility (tray icon Show/Hide/Quit is the other lifeline) — this is unchanged from the previous revision.

## Window Architecture (macOS) — rewritten, overlay subsystem removed

`src-tauri/src/macos_overlay.rs` is **deleted** (confirmed via `git status` and absence from `lib.rs`'s `mod` list). Everything it provided — `NSStatusWindowLevel` float, `CanJoinAllSpaces | FullScreenAuxiliary` collection behavior, and `set_content_protected` (the screen-capture shield, already disabled in the prior revision) — is now **gone from the codebase entirely**, not merely turned off. There is no commented-out line to re-enable; reinstating any of it means writing the FFI again.

| Feature | Implementation | Status |
|---|---|---|
| **Window size/behavior** | `tauri.conf.json`: `width: 1180, height: 760, minWidth: 480, minHeight: 520, resizable: true, alwaysOnTop: false` | A normal resizable window, not the old fixed 420×780 always-on-top widget. |
| **Dock/app-switcher visibility** | `app.set_activation_policy(tauri::ActivationPolicy::Regular)` (`lib.rs:172`) | **Active — the Dock icon and Cmd+Tab entry are back.** This is the opposite of the removed `Accessory` policy. |
| **Fullscreen float / stealth over other apps** | — | **Removed. No replacement exists.** Grep confirms zero remaining references to `CanJoinAllSpaces`, `NSStatusWindowLevel`, or `FullScreenAuxiliary` anywhere in `src-tauri/src/`. |
| **Screen-capture shield** | — | **Removed**, not just commented out. `set_content_protected` does not appear anywhere in the source, including `lib.rs`. |
| **Native window material** | `window_material.rs`, applied per-window in `setup()` (`lib.rs:179`) | Active — see below. Purely cosmetic; unrelated to overlay/stealth behavior. |
| **Global hotkey** | `tauri-plugin-global-shortcut`, `Option+Space` (`lib.rs:187`) | Active — unchanged. Toggles show/hide + focus on the `main` window. |
| **Tray lifeline** | `TrayIconBuilder` id `roxi-tray`, menu `show`/`hide`/`quit` (`lib.rs:189-214`) | Active — unchanged. |
| **Transparent window** | `tauri.conf.json`: `transparent: true`, `decorations: true`, `titleBarStyle: "Transparent"`, `shadow: true`; `app.macOSPrivateApi: true` | Active. `decorations: true` means the traffic-light controls are visible — consistent with a Dock-visible, non-stealth app. |

**If a task says "stealth" or "invisible to screen share," it is describing a feature that no longer exists in this codebase**, not one that is merely disabled. Rebuilding it means re-adding an overlay module, re-registering `ActivationPolicy::Accessory`, and re-implementing `set_content_protected` — none of which is a one-line change anymore.

### `window_material.rs` — native vibrancy, not stealth **NEW**

New file (`src-tauri/src/window_material.rs`, 66 lines), `#[cfg(target_os = "macos")]` with a no-op stub elsewhere. Exists because CSS `backdrop-filter` cannot sample the real desktop behind a transparent OS window — only a native material can. `apply(win)`:

1. Pins the window's `NSAppearance` to `NSAppearanceNameAqua` (light mode) via `objc2_app_kit`, obtained through `win.ns_window()` inside `unsafe`. Roxi's UI is light-only; without this pin, macOS Dark Mode would render the vibrancy material dark and the near-black UI text would become unreadable.
2. Calls `window_vibrancy::apply_vibrancy(win, NSVisualEffectMaterial::Sidebar, None, None)` — the light "Sidebar" material, deliberately not the dark `HudWindow` material.
3. Leaves corner radius `None` because `decorations: true` already gives the window OS-native rounded corners.

This depends on `app.macOSPrivateApi: true` in `tauri.conf.json` plus the `macos-private-api` Cargo feature on the `tauri` dependency — without both, `transparent: true` is silently ignored on macOS.

**Do not reintroduce a `backdrop-filter` blur on the shell.** `--t-shell-backdrop` is `none` in `src/styles.css` for exactly this reason — the blur target moved from CSS to `window_material.rs`.

## Glassmorphism shell — the opacity budget (values corrected)

The visual shell is governed by **one architectural rule**, defined in `src/styles.css` and consumed through `src/design-system/tokens.ts`. The previous revision's numbers (`--glass-alpha: 0.35`, `--glass-dim: 0.25`, `--glass-blur: 32px`, backdrop-filter brightness) are **stale** — that whole CSS-blur model was replaced by the native `window_material.rs` vibrancy above. Verified current values in `src/styles.css`:

| Variable | Value | Meaning |
|---|---|---|
| `--glass-alpha` | `0.30` | A **tint over the native material**, not a surface of its own. The one value to tune by eye. Rises to `0.95` in the high-contrast media query. |
| `--t-shell-backdrop` | `none` | Deliberately disabled — `backdrop-filter` samples the backdrop *within the page*, which cannot reach the desktop outside a transparent window; a blur here would cost a pass over the whole window for no visible effect. |

**The rule:** every surface inside the shell is either transparent or a white overlay at **≤ 0.06 alpha**. Nested opaque panels are what turn glass into grey soup. Sheets that sit *over* the glass (modals, tooltips) are the deliberate exception — they carry their own readable ground rather than deriving from `--glass-alpha`.

Reusable primitives live in `src/design-system/` (`GlassCard`, `Badge`, `TagChip`, `Waveform`, `SignalRing`, `Tooltip`, `ContextRow` **NEW**, icons, `tokens.ts`, `tagPalette.ts`). Build with these rather than ad-hoc styled `div`s.

## Tech Stack

| Layer | Technology | Version | Purpose |
|---|---|---|---|
| Desktop shell | Tauri | `2` | Native window, IPC, sidecar management, tray, global shortcuts |
| Tauri plugins | tauri-plugin-opener, tauri-plugin-global-shortcut, tauri-plugin-store, tauri-plugin-process, tauri-plugin-dialog | `2.x` | Opener links; Option+Space hotkey; persisted UI state; process control; native file picker (`pick_document`) |
| macOS native FFI | objc2-app-kit `0.3` (`NSWindow`, `NSAppearance`, `NSResponder` features only), window-vibrancy `0.6` | — | Appearance pinning + native vibrancy in `window_material.rs`. **No** window-level/space-joining FFI remains — that dependency surface was removed with `macos_overlay.rs`. |
| Frontend framework | React / TypeScript | `~5.6.2` | UI (`src/app/App.tsx` + feature hooks) |
| Frontend styling | Tailwind CSS | `^3.4.x` + glass tokens in `styles.css` | Frosted-glass shell over native vibrancy (see opacity budget) |
| Bundler/dev server | Vite | `^6.0.3` | Dev server port 1420, production bundling |
| Audio capture | cpal (Rust) | `0.15.3` | Loopback (BlackHole) + mic input streams |
| Resampling | rubato (Rust) | `0.16.2` | FFT sinc resample → 16 kHz |
| Rust LLM pipeline | rig-core, tokio, reqwest, async-trait | `0.2.1`, `1`, `0.12`, `0.1.80` | Native multi-agent graph, grounded by compiled briefs |
| Env loading (Rust) | dotenvy | `0.15` | Loads root `.env` — critical for macOS .app bundles |
| Sidecar runtime | Node.js | 20+ | STT + diarization (`gateway/`), history/document/web chatbot (`chatbot/`) |
| Streaming STT | assemblyai / @speechmatics/real-time-client | `^4.6.0` / `^8.5.1` | Real-time STT via `ProviderManager` |
| LLM | OpenAI — see tiering below | SDK `openai` (JS), rig (Rust) | All completions |
| Web search | OpenAI Responses API, hosted `web_search` tool | — | `OpenAiResponsesGateway`, plain-text only (citation offsets) |
| **Embeddings** | **OpenAI `text-embedding-3-small`** | 1,536 dims | Document chunk + query vectors |
| **Document parsing** | **pdf-parse, mammoth** | — | PDF and DOCX text extraction |
| Graph framework | `@langchain/langgraph` | `^0.2.0` | Chatbot Adaptive-RAG state graph |
| Database driver | better-sqlite3 / rusqlite | — | SQLite persistence |
| LLM observability | dashboard/ (express + better-sqlite3, zero-build) | — | Reads `llm_usage.db` |

### Model tiering (`src-tauri/src/application/agent_registry.rs`) — corrected

Model tiers live in `agent_registry.rs`, **not** `lib.rs` — `lib.rs` only calls `agent_registry::initialize_agent_graph(briefs)`. As coded today:

```rust
const FAST_MODEL: &str = "gpt-4o-mini";
const PREMIUM_MODEL: &str = "gpt-4o-mini"; // same model, for now — see below
```

| Tier | Model | Agents |
|---|---|---|
| Fast | `gpt-4o-mini` | `context_manager`, `explanation`, `technical`, `analyst`, `risk_detector` |
| "Premium" | `gpt-4o-mini` (same model right now) | `response_agent` only (final synthesis) |

**This is a deliberate, documented interim state, not a bug.** The in-code comment on `PREMIUM_MODEL` explains why: the GPT-5.6 family bills prompt-cache *writes* at a premium, and with few chunks per meeting the write can cost more than the reads it later saves — so the premium tier is "the one to measure per-model rather than assume." Treat `PREMIUM_MODEL` as a single named constant to flip back to a stronger model once that measurement is done; don't hardcode a model string anywhere else.

The chatbot's own default model is separately configured (`CHATBOT_MODEL`) and is unaffected by this constant. **Never send `temperature`** to any agent's LLM call — still the safe default.

## Context Briefs — compiled, cacheable system-prompt prefixes **NEW**

`src-tauri/src/agents/brief/` (`model.rs`, `budget.rs`, `compiler.rs`, `compose.rs`, `store.rs`). A **brief** is not the whole per-session context — it is a **compiled, cacheable system-prompt prefix, one per agent**, built once at capture start and reused byte-for-byte on every chunk of that meeting.

- **`model.rs`** — `BriefInputs`, `CompiledBrief`, `BriefManifest`, `SharedBrief = Arc<CompiledBrief>`.
- **`budget.rs`** — pure token accounting: per-section ceilings under a `Budget` (default `total_cap: 5600`), a crude `estimate_tokens` (`len / 4`), and `take_within`/`clamp_to_budget`, which never emit a partial item or a partial sentence.
- **`compiler.rs`** — `compile(role_contract, inputs, budget) -> Result<CompiledBrief>`. Pure and deterministic: renders the role contract + project charter + glossary + roster + prior-meeting digests + open items + document extracts into one string wrapped in `<<<ROXI_BRIEF_V1>>> … <<<END_ROXI_BRIEF_V1>>>` sentinels, with every section sorted deterministically so identical inputs always produce a byte-identical prefix (`hash_prefix`, sha256-16, used as a cache/version key). Returns `Err` rather than silently truncating if the render exceeds `budget.total_cap`.
- **`compose.rs`** — `compose(role_contract, brief, rolling_window, chunk)` splits the final prompt into a **frozen `system` half** (the compiled brief, or the bare role contract if no brief exists) and a **volatile `user` half** (`--- LIVE SESSION ---` + recent transcript + the current turn). The point of the split is that the LLM provider's prompt-prefix cache only ever sees the byte-identical frozen half — the whole reason briefs exist.
- **`store.rs`** — `BriefStore`: `RwLock<HashMap<SessionId, HashMap<AgentTag, SharedBrief>>>`, in-memory only, scoped to the life of one capture and cleared on `stop_capture`.

**Wiring:** `lib.rs` constructs one `Arc<BriefStore>` (`briefs`) and hands it to two collaborators: `BriefUseCase` (`application/brief_usecase.rs`) fills it at `start_capture` by gathering project/glossary/roster/history/open-items/document data and calling `compiler::compile` once per agent listed in `agents::agents::role_contracts::ALL`; `agent_registry::initialize_agent_graph(briefs)` gives the same store to the `ChunkGraph`, where every agent calls `store.get(session, tag)` on every chunk and feeds the result into `compose()`. **This is pure prompt-cache economics**: pay the compile cost once per meeting, not once per chunk.

## Projects & Sessions **NEW**

Two small domains that didn't exist in the previous revision, both undocumented until now despite being fully wired into the UI (`App.tsx` renders `ProjectLibrary` and `LiveSessionDashboard`).

### Projects — `domain/project.rs`, `commands/projects.rs`, `adapters/sqlite_projects.rs`

A **project is a taxonomy container that scopes multiple meetings.** `ProjectId` is a newtype over `i64`; `ProjectRef` (id/code/name) is embedded in briefs and prompts; `Project` is the full row (`ProjectRef` + description + `meeting_count` + `last_used_at`) used by the picker UI; `ProjectSelection` (`Existing` / `New` / `Unsorted`) models the intake modal's choice as a sum type. Glossary terms, roster, prior-meeting history, open items and documents are all queried **by `project_id`** — every un-filed meeting lands in a seeded `Unsorted`/`GEN` bucket rather than having no project at all, so no query path has to handle a null project. Commands: `list_projects` (reads via `ProjectRepository`), `create_project` (creates, then re-fetches the full row so the picker never flashes an incomplete card). Frontend: `src/features/library/` (`ProjectLibrary.tsx`, `ProjectList.tsx`, `ProjectDetail.tsx`, `useDocumentLibrary.ts`).

### Sessions — `domain/session.rs`, `application/session_registry.rs`

`SessionId` is **process-local** (minted from an atomic counter) — it is *not* a database key; `meetings.id` remains the durable identity, bound to the session later once the gateway sidecar creates the row. `SessionSnapshot` is a point-in-time read (id, optional project, optional `meeting_id`, rendered rolling window); `TranscriptWindow` is a bounded `VecDeque` of the last 8 finalized turns (each capped at 600 chars) used only for pronoun/context continuity in the *volatile* prompt suffix, never the brief.

`SessionRegistry` holds `Option<ActiveSession>` — **deliberately a single slot, not a map.** The app models "one capture at a time" as structurally unrepresentable otherwise: the capture use case already rejects a second concurrent session, and the audio device can only be captured once anyway. Its purpose is to give the session an identity *before* the gateway sidecar (and thus `meetings.id`) exists, so the brief store can be pre-warmed by `SessionId` before the first transcript chunk arrives, and so the event router / agent pipeline can read the session's project/meeting-id/rolling-window on every chunk without reaching through the audio-capture machinery. Frontend: `src/features/session/` (`LiveSessionDashboard.tsx`, `LiveStage.tsx`, `useElapsed.ts`).

## Folder & File Structure

```text
meeting-interpreter-mac-main/
├── .env                      # API keys (gitignored) — both Rust and sidecars read root first
├── brain.md                  # THIS FILE — canonical machine reference
├── CLAUDE.md                 # Working instructions for Claude Code
├── src/                      # Frontend (React + Tailwind) — SINGLE WINDOW
│   ├── app/                  # App.tsx (composition root), main.tsx (HashRouter)
│   ├── shell/                # AppShell.tsx (glass shell), NavigationTabs.tsx, WidgetHeader.tsx
│   ├── design-system/        # GlassCard, Badge, TagChip, Waveform, SignalRing, Tooltip,
│   │                         #   ContextRow (NEW), icons, tokens.ts, tagPalette.ts, keyframes.css
│   ├── context/              # ServicesContext.ts, ServicesProvider.tsx, useServices.ts (DI)
│   ├── features/
│   │   ├── capture/          # useCaptureSession + useCaptureFlow, useAudioLevel, IdleScreen,
│   │   │                     #   StartCaptureButton, BlackholeNotice, CaptureErrorNotice,
│   │   │                     #   context-intake/ (MeetingContextModal + presets)
│   │   ├── transcript/       # TranscriptPane, TranscriptLine, TranscriptProvider,
│   │   │                     #   TranscriptStatusBar, useTranscript, useAutoScroll, SpeakerRenameModal
│   │   ├── suggest/          # SuggestAnswersPane, SuggestCard, RefineRow (NEW — replaces
│   │   │                     #   FollowUpRow), SuggestFilterToggle, TagFilterRow, ContextSection,
│   │   │                     #   EmptySuggestState, refine.ts, useSuggestAnswers, useSuggestFilters
│   │   ├── chat/              # ChatPane, ChatInput, ChatThreadProvider, useChatThread,
│   │   │                     #   useLiveTranscriptContext, components/{RoxiAnswerCard,SourceChip,
│   │   │                     #   ThinkingIndicator,UserBubble} — RoxiAnswerCard renders follow-up
│   │   │                     #   chips (message.followUps) here, independent of suggest/RefineRow
│   │   ├── session/          # NEW — LiveSessionDashboard, LiveStage, useElapsed
│   │   ├── library/           # NEW — ProjectLibrary, ProjectList, ProjectDetail, useDocumentLibrary
│   │   ├── usage/             # NEW — UsagePill, useUsage (reads get_session_usage)
│   │   ├── analysis/         # AnalysisPane, useAnalysis
│   │   ├── history/           # HistoryPane, MeetingDetailModal, useHistory, useMeetingDetail
│   │   └── history-chat/      # empty dirs only (dead; see Known Gaps)
│   ├── services/              # TauriCaptureService, TauriEventBus, TauriChatService,
│   │   │                      #   TauriHistoryRepository, SpeakerRepository
│   │   ├── mappers/            # wire-format → UI-type mappers
│   │   └── wire/                # wireTypes.ts (raw event payload shapes)
│   ├── shared/
│   │   ├── interfaces/         # ICaptureService, IEventBus, IChatService, IHistoryRepository,
│   │   │                       #   ISpeakerRepository
│   │   ├── types/               # chat.ts, suggest.ts, analysis.ts, capture.ts, history.ts, core.ts, ui.ts
│   │   └── ui/                   # EmptyState, InputBar, RoxiLogo, Spinner, StopButton
│   └── styles.css              # Tailwind directives + --glass-alpha tint budget + keyframes
├── gateway/                    # Node.js STT sidecar engine — SOLE WRITER of meeting_history.db
│   ├── sidecar.js               # PCM1 parser → ProviderManager → stdout JSON (+ diarization, sanitizer)
│   ├── audio/pcm-deframer.js
│   ├── control/command-handler.js  # NEW — handles CTL1-framed control commands from Rust
│   │                                #   (renameSpeaker, persistChunk, persistArtifacts)
│   ├── providers/               # assemblyai.js, speechmatics.js, mfcc.js (13-coeff MFCC)
│   ├── stt/                     # provider-manager.js, diarization-layer.js, transcript-sanitizer.js
│   ├── config/                  # gateway's own env/argv resolution + validation (NOT a leftover)
│   ├── db/                      # index.js, migrate.js (forward-only migrations)
│   └── ... tools/, interfaces/, infrastructure/, state/, lifecycle/
├── chatbot/                    # Ask Roxi: LangGraph Adaptive-RAG over meetings, documents, and web
│   ├── sidecar.js                # stdio JSON protocol entry
│   ├── bin/                      # rebuild-index.js, ask.js (has --web=auto|always|never), eval-web-search.js (NEW)
│   ├── data/                     # chat_index.db (FTS5), doc_store.db (documents + vectors)
│   └── src/
│       ├── composition/container.js         # DI root — the only module naming concrete classes
│       ├── config/envConfig.js              # the only module reading process.env (incl. CHATBOT_WEB_*)
│       ├── domain/
│       │   ├── errors.js
│       │   └── ports/                        # Retriever, EvidenceSource, MeetingStore, LlmGateway,
│       │                                     #   EmbeddingGateway, DocumentParser, DocumentRepository,
│       │                                     #   BudgetGuard, ChatLogger, WebSearchGateway (NEW)
│       ├── application/
│       │   ├── graph/                        # buildChatGraph, routing, state, constants, evidence,
│       │   │                                 #   webPolicy.js (NEW), webCitations.js (NEW)
│       │   ├── nodes/                        # analyzeQuery, retrieve, gradeDocuments, rewriteQuery,
│       │   │                                 #   clarify, generate, respondNoData, directAnswerNode,
│       │   │                                 #   webAnswerNode (NEW), generateWebNode (NEW)
│       │   ├── retrieval/                    # CompositeEvidenceSource, rrf.js
│       │   └── useCases/                     # AnswerQuestionUseCase, IndexDocumentUseCase,
│       │                                     #   ManageDocumentsUseCase
│       ├── infrastructure/
│       │   ├── persistence/                  # FtsRetriever, FtsIndexBuilder, FtsEvidenceSource,
│       │   │                                 #   SqliteMeetingStore, ftsQuery
│       │   ├── documents/                    # DocumentRepositorySqlite, DocumentEvidenceSource,
│       │   │                                 #   chunker, migrations, parsers/{Text,Pdf,Docx,registry}
│       │   ├── embedding/OpenAiEmbeddingGateway.js
│       │   ├── llm/                          # OpenAiLlmGateway, LangchainLlmGateway,
│       │   │                                 #   OpenAiResponsesGateway (NEW), textResponse.js (NEW),
│       │   │                                 #   prompts, json-parse
│       │   ├── budget/, usage/, logging/
│       └── transport/                        # stdioSidecar.js (protocol), cliRepl.js
├── dashboard/                   # LLM usage dashboard (zero-build): server.js, codemap.json
└── src-tauri/                    # Rust backend (Tauri v2)
    ├── tauri.conf.json          # ONE window "main": 1180×760, min 480×520, resizable, transparent, decorated
    ├── capabilities/default.json
    └── src/
        ├── lib.rs               # Composition root: adapters, agents, ChunkGraph, commands, setup hook
        ├── window_material.rs   # NEW — replaces macos_overlay.rs; native vibrancy + Aqua pin only
        ├── application/
        │   ├── agent_registry.rs   # MODEL TIERS live here (moved from being described as lib.rs)
        │   ├── brief_usecase.rs     # NEW — fills BriefStore at start_capture
        │   ├── session_registry.rs  # NEW — single-slot ActiveSession
        │   └── capture_usecase.rs
        ├── agents/               # RUST-NATIVE LLM PIPELINE — itself a full hexagonal slice
        │   ├── orchestrator/     # chunk_graph.rs, routing.rs (pure fn, unit-tested)
        │   ├── agents/            # context_manager, explanation, technical, analyst, risk_detector,
        │   │                     #   response_agent, chit_chat_gate, complexity_analyzer (UNWIRED),
        │   │                     #   prompt.rs, role_contracts.rs
        │   ├── brief/             # NEW — model, budget, compiler, compose, store (see Context Briefs)
        │   ├── adapters/          # openai_adapter.rs, openai_embedding_adapter.rs (NEW), usage_store.rs
        │   ├── ports/             # agent_port.rs (Agent trait), llm_port.rs (LlmClient trait)
        │   └── domain/            # chunk_state, decision, action_item, risk, agent_error, context_item,
        │                          #   pipeline_trace
        ├── domain/                # audio_level.rs, meeting.rs, project.rs (NEW), session.rs (NEW), usage.rs
        ├── ports/                 # audio_capture, audio_meter (NEW), brief_source (NEW), chat_gateway,
        │                          #   control (NEW), db, document_source (NEW), embedding (NEW), gateway,
        │                          #   project_repository (NEW), usage (NEW), vector_store (NEW)
        ├── adapters/              # mac_audio, gateway_client, chat_client, db_paths, vector_client (NEW),
        │                          #   audio_meter.rs (NEW), control_channel.rs (NEW), sqlite.rs (original
        │                          #   Database impl, unchanged), sqlite_schema.rs (NEW, shared guards),
        │                          #   sqlite_usage.rs (NEW), sqlite_projects.rs (NEW),
        │                          #   sqlite_brief_source.rs (NEW), sqlite_document_source.rs (NEW,
        │                          #   READ-ONLY against the chatbot's doc_store.db)
        ├── commands/              # capture, db, chat, audio_devices, speaker, projects (NEW),
        │                          #   documents (NEW), usage (NEW)
        ├── sidecar/               # events.rs, event_router.rs, chat_events.rs, persistence.rs (NEW —
        │                          #   builds persistChunk/persistArtifacts control commands; the
        │                          #   GATEWAY remains the sole writer of meeting_history.db)
        ├── streaming.rs           # PCM1 framing sink
        └── resample.rs            # FFT audio resampler
```

**Note:** `src/features/history-chat/` survives as empty directories only (its files were deleted when the chat panes were de-duplicated; git does not track empty dirs). Nothing imports it. Still true as of this revision.

## Architecture & Data Flow

**Pattern: layered, process-isolated pipeline (real-time plane + intelligence plane). The LLM agent pipeline lives in Rust, not Node, and is grounded by pre-compiled briefs rather than re-sent context.**

1. User picks/creates a project in the Project Library, then clicks Start → `useCaptureFlow` → `captureService.startCapture(context)` → `invoke("start_capture")`.
2. `lib.rs`: mints a `SessionId` via `SessionRegistry`, has `BriefUseCase` compile one brief per agent for the chosen project into the shared `BriefStore`, loads root `.env` via dotenvy, spawns `node ../gateway/sidecar.js` (optional `--context`, `--role` argv).
3. `mac_audio.rs` (optionally wrapped by `adapters/audio_meter.rs`'s `MeterSink`): captures BlackHole loopback + mic, downmixes to mono, and emits `audio_level` readings (~31/sec, 3-band RMS) for the waveform UI without opening a second mic stream in the webview.
4. `resample.rs` → 16 kHz; `streaming.rs` frames PCM1 (8-byte header + PCM16) → sidecar stdin. Control commands (e.g. rename-speaker, persist requests) go over the same stdin as `CTL1`-framed JSON via `adapters/control_channel.rs`, sharing the writer/lock so control writes never block the audio hot path for long.
5. `sidecar.js`: `PcmDeframer` → `ProviderManager` (AssemblyAI primary, Speechmatics fallback) → `partial`/`final`; `gateway/control/command-handler.js` handles the CTL1 side, including `persistChunk`/`persistArtifacts` requests built by Rust's `sidecar/persistence.rs` — **the gateway remains the sole writer of `meeting_history.db`**, Rust only reads it.
6. Final path: `validateTranscriptEvent` → `transcript-sanitizer` (drops low-confidence/filler) → `diarization-layer` (MFCC + cosine similarity vs `speaker_embeddings`) → typed JSON line on stdout → transcript row persisted to `meeting_history.db`.
7. `event_router.rs` deserializes each line into `SidecarEvent`. On `Final` it runs the Rust-native **`ChunkGraph`** on `tauri::async_runtime`:
   - `chit_chat_gate::is_filler` (local heuristic) → fast-exits small talk with **no LLM call**.
   - `ContextManagerAgent` (sequential) → topic tracking + significance grading; complexity (Low/Medium/High) arrives as one extra field in the same JSON.
   - Every agent call composes its prompt via `agents/brief/compose.rs`: the frozen brief (from `BriefStore`, keyed by `SessionId` + agent tag) as the system half, the live rolling window + current chunk as the volatile user half.
   - Stage-2 conditional parallel fan-out via the pure function `orchestrator/routing.rs::decide()`:
     - `Low` → `ExplanationAgent` only
     - `Medium` → `ExplanationAgent` + `RiskDetectorAgent`
     - `High` → `ExplanationAgent` + `TechnicalAgent` + `AnalystAgent` + `RiskDetectorAgent`
   - `ResponseAgent` (sequential, last) → suggested reply, on the "premium" tier (currently the same model as fast, see Model Tiering).
   - Every call goes through `OpenAiAdapter` with per-tag usage logging to `llm_usage.db`.
8. `event_router.rs` emits Tauri events (full list under API Reference).
9. Frontend: `TauriEventBus` subscribes via `IEventBus`; each feature hook owns its slice of state.

## Ask Roxi — hybrid retrieval over meetings, documents, and the web

"Ask Roxi" is a separate on-demand branch: `invoke("ask_chat")` → `adapters/chat_client.rs` spawns/talks to `chatbot/sidecar.js` over stdio JSON → LangGraph graph → `chat_thinking` / `chat_reply` / `chat_error` events. Document upload/list/delete (`upload_document`, `list_documents`, `delete_document` Tauri commands) are thin forwarders: Rust does no parsing/chunking/embedding itself — it starts a chat-sidecar session and relays the corresponding stdin command (`UploadDocument`/`ListDocuments`/`DeleteDocument`), the same way `ask_chat` relays `Ask`. The one exception is `adapters/sqlite_document_source.rs`, a **read-only** adapter that opens `doc_store.db` directly (`SQLITE_OPEN_READ_ONLY`) purely so the Rust-side brief compiler can pull document chunks (`top_chunks`, `chunks_for_documents`) without a sidecar round-trip — the chatbot remains the only writer.

### Two corpora behind one port, plus a second, narrower port for the web

`retrieveNode` depends on a single **`EvidenceSource`** and cannot tell how many corpora sit behind it:

| Adapter | Corpus | Method |
|---|---|---|
| `FtsEvidenceSource` | Meeting history (`chat_index.db`) | Lexical — FTS5/BM25, wraps the untouched `FtsRetriever` |
| `DocumentEvidenceSource` | Uploaded documents (`doc_store.db`) | Semantic — embeds the question, cosine over stored chunk vectors |
| `CompositeEvidenceSource` | Both, concurrently | Merges by Reciprocal Rank Fusion |

`EvidenceSource` is a **second port beside `Retriever`, not a widened `Retriever`**: `Retriever.search` takes sanitized FTS5 MATCH expressions that a vector search cannot use, and `respondNoDataNode` still needs `Retriever.recentTopics()`.

**Failure isolation:** `CompositeEvidenceSource` treats a failing source as empty and logs it. **Cost guard:** `DocumentEvidenceSource` checks the corpus before embedding — with no documents uploaded it returns `[]` without billing a query embedding.

**Merging** (`application/retrieval/rrf.js`, pure, unit-tested, `RRF_K: 60`) uses rank only, since BM25 scores are unbounded and cosine is 0..1 — adding or min-max normalizing them is unstable because ranges shift per query.

### Web search — the model decides, not a classifier **NEW**

Two orthogonal axes reach the chat graph:

| Axis | Field | Values | Set by | Question it answers |
|---|---|---|---|---|
| Knowledge switch | `mode` | `rag` \| `direct` | the UI toggle | which of the user's own corpora may this turn read |
| Web access | `webMode` | `auto` \| `always` \| `never` | config only, no UI switch | may this turn look outside |

**There is deliberately no Web switch in the UI.** The frontend never sends `webMode`; an absent field defaults through `CHATBOT_WEB_SEARCH_MODE` (default `auto`), applied once in `AnswerQuestionUseCase`. The graph's own internal default (`state.js`) is `never`, so every pre-existing test still passes unmodified — the use case must re-normalize `webMode` on every run because the LangGraph checkpointer's `lastWrite` reducer ignores an absent value and would otherwise let turn two silently inherit turn one's mode.

- **`domain/ports/WebSearchGateway.js`** — a narrow port beside `LlmGateway`, not a method on it (same ISP/LSP reasoning as `EvidenceSource` beside `Retriever`): `answer(req) -> {answer, citations, usedWebSearch, searchCalls, latencyMs, model, usage}`. Implementations must **reject** on failure rather than return an empty answer, so the caller can tell "searched, found nothing" apart from "could not search."
- **`infrastructure/llm/OpenAiResponsesGateway.js`** — the only file that talks to the Responses API (`/v1/responses`), with a hosted `web_search` tool attached. Sends **plain text, never `response_format`** — citation offsets are character indices into the returned string, so a JSON envelope would misaddress every offset. Retries up to twice on 429/5xx/timeout with exponential backoff; has a one-time fallback from `web_search` to `web_search_preview` if the API rejects the tool type. Counts `web_search_call` output items directly rather than inferring search use from prose. Maps `usage.input_tokens/output_tokens` onto `UsageRecorder`'s `prompt_tokens`/`completion_tokens` — otherwise a web call would log zero cost.
- **`application/graph/webPolicy.js`** — pure. `normalizeWebMode`: only `auto`/`always` pass through; anything else (including unset) is `never` — the opposite default direction from `mode`, deliberately. `decideWebTools(webMode)`: `always` → tool forced (`toolChoice: 'required'`, `mandatory: true`); `auto` → tool offered, model decides; `never` → tool not even sent, so enforcement is structural, not a prompt instruction the model could ignore.
- **Graph nodes**: `generate_web` and `web_answer` are **optional** nodes, added to the graph only if the container supplies `generateWeb`/`webAnswer` functions — a container with no web-search key builds the classic graph unchanged. `decideEntry` routes `MODES.WEB_DIRECT → web_answer` (Knowledge off + web enabled), falling back to `direct_answer` if unavailable. `decideRoute` routes to `generate_web` whenever web is enabled and evidence is ready (or exhausted the corrective loop), falling back to plain `generate`. **This means `generate_web`/`web_answer` are the normal production terminals, and `generate`/`direct_answer` are the fallback path** — the model can only decide to search if it's holding the tool.
- **`application/graph/webCitations.js`** — pure. Assigns `W1…Wn` per unique URL in first-seen order, scoped to one answer (mirrors `D2` for documents). Inserts `[W#]` tokens **back to front** (descending offset) so inserting one never shifts an offset not yet processed; replaces a pure provider-markdown-link span outright (avoids a raw 60-char URL) or appends after real prose. `readInlineRefs` reads citation tokens the model already wrote in plain prose, since the web path can't return a parallel JSON `citedRefs` field.
- **Follow-up chips on the web path** — `infrastructure/llm/textResponse.js`'s `splitFollowUps` reads a trailing `FOLLOWUPS: a | b` line, checked **only on the last non-empty line** (a mid-answer mention isn't treated as the trailer), because the web path returns plain text and can't carry a JSON `followUps` field the way `generate` does.
- **Failure policy**: in `auto`, an unreachable web degrades to the non-web twin with a `degradedNote`; in `always`, `web_answer` **refuses** rather than return an unsourced answer (a cited answer from records beats a refusal, so `generate_web` still falls back to evidence there). Never fabricate a search.
- **Env vars**: `CHATBOT_WEB_SEARCH_MODE` (default `auto`), `CHATBOT_WEB_SEARCH_MODEL` (falls back to `CHATBOT_MODEL`), `CHATBOT_WEB_SEARCH_TOOL_TYPE` (default `web_search`), `CHATBOT_WEB_SEARCH_CONTEXT_SIZE` (`low`/`medium`/`high`, default `medium`), `CHATBOT_WEB_MAX_TOOL_CALLS` (default `0` = param omitted), `CHATBOT_WEB_TIMEOUT_MS` (default `60000`), `CHATBOT_WEB_BUDGET_HARD` (default `20`, its own call budget), `CHATBOT_WEB_USER_COUNTRY`/`_CITY`/`_REGION` (optional `user_location`).
- **CLI**: `node chatbot/bin/ask.js --web=auto|always|never "question"` overrides the mode from the command line; `npm --prefix chatbot run eval:web` (`chatbot/bin/eval-web-search.js`) is a real-API-call evaluation harness measuring search recall/precision per category, **deliberately outside `npm test`** — never run it in CI or pre-commit.
- **Telemetry** rides the existing `tag` column (`web_answer`, `generate_web`) — no `llm_usage.db` migration. `webSearchCount` is logged separately because a hosted search call bills per-call, on top of tokens, so `cost_usd` alone under-reports it.

### Citations — refs, not meeting ids

Every hit belongs to a **group** (one meeting, one document, or one web result) identified by `groupKey`. Every group gets a **`ref`**: meetings keep `M<meetingId>`, documents get `D1, D2…`, web results get `W1, W2…` — all assigned in `boundEvidence` (or `webCitations.assignRefs` for the web path), scoped to one answer. `GENERATE_SYSTEM` asks for `citedRefs: ["M3","D2"]`; `generateNode` also accepts the legacy `citedMeetingIds` for in-flight/old-shaped responses. `MIN_GROUPS_PER_SOURCE_TYPE: 1` guarantees each contributing corpus at least one group so a 200-chunk PDF can't occupy every slot in `MAX_EVIDENCE_GROUPS: 4`.

### Document indexing pipeline

`IndexDocumentUseCase`: **validate → hash → parse → chunk → embed → store**, reporting progress at each phase. Validation runs before any row exists; `content_hash` (sha256) dedupes re-uploads and re-embeds nothing for a `ready` duplicate; only `ready` documents are searchable. Chunking (`chunker.js`) is pure, char-based (2,000 chars ≈ 500 tokens, 256 overlap), carrying page numbers through for citations like "p4".

### Concurrency — two busy lanes

`stdioSidecar.js` keeps `askBusy` and `docBusy` independently, so a question asked mid-upload doesn't fail with `BUSY`. `better-sqlite3` is synchronous and the doc store is its own file, so there's no write-interleaving hazard.

## Database Schema

SQLite. **Three** stores, never joined at the query level:

- **`meeting_history.db`** — written **only** by the gateway sidecar (better-sqlite3). Read by Rust (rusqlite: `adapters/sqlite.rs` for meetings/transcripts, plus the newer `sqlite_projects.rs`, `sqlite_brief_source.rs`, `sqlite_usage.rs` — see below), opened **read-only** by the chatbot to avoid WAL conflicts between two Node processes. Tables: `meetings`, `transcripts`, `chunks`, `decisions`, `action_items`, `risks`, `technical_analyses`, `suggested_replies`, `summaries`, `glossary_terms`, `speaker_profiles`, `speaker_names`, `speaker_embeddings`, `schema_version`, plus project-scoping columns/tables added for the Projects feature (guarded by `adapters/sqlite_schema.rs`'s `ensure_projects`/`has_table`/`has_column`/`meetings_are_project_scoped` helpers, which every project/brief/document adapter shares rather than each re-detecting schema). Forward-only migrations in `gateway/db/migrate.js` — never edit a shipped one.
- **`llm_usage.db`** — written by Rust `agents/adapters/usage_store.rs` and by the chatbot's `UsageRecorder`. Read by `dashboard/` and by Rust's own `adapters/sqlite_usage.rs` (`SqliteUsageRepository`, read-only, backs the `get_session_usage` command and the frontend's `usage/UsagePill`).
- **`chatbot/data/chat_index.db`** — the chatbot's own FTS5 index over meeting history. Rebuilt wholesale by `FtsIndexBuilder`; opened read-only by `FtsRetriever`. Regenerate with `chatbot/bin/rebuild-index.js` — never hand-edit.
- **`chatbot/data/doc_store.db`** — uploaded documents and their vectors, owned and written **exclusively by the chatbot**. Rust's `adapters/sqlite_document_source.rs` opens it `SQLITE_OPEN_READ_ONLY` to feed the brief compiler; it never writes.

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

Vectors are stored **L2-normalized**, which makes cosine similarity a plain dot product at query time. Brute-force search over a few thousand 1,536-dim vectors is single-digit milliseconds — no vector database needed. Forward-only migrations in `chatbot/src/infrastructure/documents/migrations.js`.

## API Reference

**Tauri Commands** (`generate_handler!` in `lib.rs`, verified against source): `start_capture`, `stop_capture`, `check_blackhole_installed`, `get_meetings`, `get_meeting_details`, `get_session_usage`, `ask_chat`, `close_chat`, `rename_speaker`, `list_projects`, `create_project`, `pick_document`, `upload_document`, `list_documents`, `delete_document`. (15 total — up from the 8 listed in the previous revision.)

**Tauri → frontend events** (verified by grepping every `.emit(` call site plus `IEventBus`'s `on*` subscriptions):
- Capture/STT: `provider_status`, `transcript_partial`, `transcript_final`, `capture_error`, `audio_level`
- Agents: `context_explanation`, `technical_explanation`, `chunk_significance`, `meeting_decisions`, `meeting_action_items`, `meeting_risks`, `meeting_summary`, `suggested_response`, `suggest_answer`, `agent_trace`
- Health/cost: `circuit_breaker`, `api_health`, `billing`, `speaker_revision`
- Chat: `chat_ready`, `chat_thinking`, `chat_reply`, `chat_error`, `chat_closed`, `chat_index_rebuilt`
- Documents: `document_progress`, `document_ready`, `document_list`, `document_deleted`

**Gateway sidecar stdout JSON types:** `Connected`, `Closed`, `Error`, `Partial`, `Final`, `Significance`, `Explanation`, `TechnicalExplanation`, `Decisions`, `ActionItems`, `Risks`, `Response`, `CircuitBreaker`, `Billing`, `ApiHealth`, `ProviderStatus`, `SpeakerRevision`. In practice the gateway emits `Partial`/`Final`/`ProviderStatus`/`Error`; semantic types come from the Rust `ChunkGraph`.

**Gateway control channel (CTL1, stdin, `adapters/control_channel.rs` → `gateway/control/command-handler.js`):** `renameSpeaker`, `persistChunk`, `persistArtifacts` — framed as `"CTL1" + u32 LE length + UTF-8 JSON`, sharing the same stdin writer/lock as audio so control writes never block audio for long.

**Chatbot sidecar stdio protocol** (`chatbot/src/transport/stdioSidecar.js`):

```jsonc
// stdin
{"type":"Ask","question":"…","threadId":"ask","history":[…],"mode":"rag","webMode":"auto"}
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

**Document error codes:** `DOCUMENT_UNSUPPORTED_TYPE`, `DOCUMENT_NOT_FOUND`, `DOCUMENT_TOO_LARGE`, `DOCUMENT_NO_TEXT`, `DOCUMENT_LIBRARY_FULL`, `DOCUMENT_INVALID_REQUEST`, `EMBED_COUNT_MISMATCH`, `BUDGET_EXHAUSTED`, `BUSY`.

## Environment Variables

Put them in a **root `.env`** — both Rust (`dotenvy::dotenv()`) and the sidecars read root first, falling back to `gateway/.env` / `chatbot/.env`.

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
| `CHATBOT_MODEL` | Chatbot completion model | No |
| `CHATBOT_EMBED_MODEL` | `text-embedding-3-small` | No |
| `CHATBOT_EMBED_BUDGET_HARD` | Separate embedding call budget (400) | No |
| `CHATBOT_DOC_DB` | `chatbot/data/doc_store.db` | No |
| `CHATBOT_MAX_DOCUMENT_BYTES` | Per-file cap (20 MiB) | No |
| `CHATBOT_MAX_LIBRARY_BYTES` | Total library cap (200 MiB) | No |
| `CHATBOT_MAX_DOCUMENTS` | File-count backstop (50) | No |
| `CHATBOT_INDEX_DB` / `CHATBOT_MEETING_DB` / `LLM_USAGE_DB` | Path overrides | No |
| `CHATBOT_WEB_SEARCH_MODE` **NEW** | `auto` (default) \| `always` \| `never`. The only web control there is — no UI switch. Unrecognised means `never` | No |
| `CHATBOT_WEB_SEARCH_MODEL` **NEW** | Falls back to `CHATBOT_MODEL` when empty | No |
| `CHATBOT_WEB_SEARCH_TOOL_TYPE` **NEW** | Default `web_search`; one-time fallback to `web_search_preview` | No |
| `CHATBOT_WEB_SEARCH_CONTEXT_SIZE` **NEW** | `low`/`medium`/`high`, default `medium` — `low` is the latency lever | No |
| `CHATBOT_WEB_MAX_TOOL_CALLS` **NEW** | Default `0` = param omitted entirely | No |
| `CHATBOT_WEB_TIMEOUT_MS` **NEW** | Default `60000` | No |
| `CHATBOT_WEB_BUDGET_HARD` **NEW** | Default `20`, own call budget | No |
| `CHATBOT_WEB_USER_COUNTRY` / `_CITY` / `_REGION` **NEW** | Optional `user_location` for the search tool | No |

## External Integrations

- **OpenAI** — completions (`gpt-4o-mini` on both current tiers, see Model Tiering), embeddings (`text-embedding-3-small`), and hosted web search (Responses API, `OpenAiResponsesGateway`). Never send `temperature`.
- **AssemblyAI** primary real-time STT; **Speechmatics** automatic fallback.
- **BlackHole 2ch** virtual audio driver for loopback capture.

## Build, Run, Deploy

```bash
npm install && (cd gateway && npm install) && (cd chatbot && npm install)
npm run tauri dev          # Rust + Vite + spawns sidecars on demand

npm run lint               # tsc --noEmit
npm run build               # tsc && vite build
npm run tauri build         # production bundle

npm test                    # chatbot tests only
npm run test:all            # chatbot + gateway
cd chatbot && node --test test/rrf.test.js          # one file
cd chatbot && node --test "test/web-*.test.js"       # web-search unit tests
npm --prefix chatbot run eval:web -- --dry           # web-search routing eval, REAL API calls, never in CI
cd src-tauri && cargo test                            # Rust unit tests (72 #[test]s across 19 files today —
                                                       #   far more than just orchestrator::routing)

npm run dashboard           # http://localhost:3300 (reads llm_usage.db)
npm run audit:all
```

Dev notes: cargo lives at `~/.cargo/bin/cargo` (not always on PATH). Husky pre-commit blocks staged `.env` files, greps for API-key patterns, and runs `npx tsc --noEmit`.

**Test counts (verified 2026-09-14 by running the suites):** chatbot **395**, gateway **99**. Rust: **72** `#[test]` functions across **19 files** — well beyond the previously-documented "only `orchestrator::routing` has tests"; other covered modules include `agents/agents/prompt.rs`, `role_contracts.rs`, `adapters/openai_adapter.rs`, the whole `agents/brief/` module, `ports/llm_port.rs`, `adapters/control_channel.rs`, `sqlite_document_source.rs`, `audio_meter.rs`, `sqlite_usage.rs`, `sidecar/persistence.rs`, `sqlite_schema.rs`, `application/brief_usecase.rs`, `session_registry.rs`, `domain/session.rs`, `domain/project.rs`. No chatbot or gateway test makes a network call except the deliberately-excluded `eval:web` harness.

## Conventions & Patterns

- **Rust:** `anyhow` errors; hexagonal layout (`ports/`/`adapters/`/`domain/`) mirrored in both `src-tauri/src/` and `src-tauri/src/agents/` (which is itself a full nested hexagonal slice, not a flat folder). `lib.rs` is the composition root — every adapter, agent and command is constructed there.
- **Agents** implement the `Agent` trait; all LLM access goes through `LlmClient` → `OpenAiAdapter`, where usage/cost logging happens. Every agent's prompt is composed from a **brief** (frozen, cacheable) plus a **volatile** live-session suffix — never hand-build a system prompt inline.
- **`complete_json` is fragile by design:** it extracts JSON by taking the substring between the first `{` and last `}` — no schema validation, no repair. Keep JSON-producing prompts tightly constrained to "return only a JSON object".
- **Chatbot:** ports in `domain/ports/`, one composition root (`container.js`), one env reader (`envConfig.js`). Pure decision logic (`routing.js`, `rrf.js`, `evidence.js`, `chunker.js`, `webPolicy.js`, `webCitations.js`) is dependency-free and unit-tested.
- **JS sidecars:** typed JSON stdout IPC; structured logs to **stderr** only — stdout carries protocol messages exclusively.
- **React:** feature folders own their hooks; consume services via `useServices()`, never construct a service class inside a component. Reuse `design-system/` primitives.
- **Process isolation is deliberate** — don't turn the Rust ↔ Node pipes into network sockets.

## Agent Instructions

- **Modifying JSON events** is a three-file lockstep change: `sidecar/events.rs` (payload struct), `event_router.rs` (match arm → Tauri event), and the frontend (`IEventBus` + `TauriEventBus`/`wireTypes.ts`/mapper + hook).
- **Adding an agent:** implement `Agent`; decide sequential vs stage-2; add it as a field on `ChunkGraph`; update `routing::decide()` if stage-2; register an `OpenAiAdapter::with_tag(...)` in `agent_registry.rs` **with a deliberate model tier**; add it to `role_contracts::ALL` so the brief compiler covers it (a dev-build assertion catches a missing contract); emit its output in `event_router.rs` plus the matching TS handler.
- **Changing the fast/premium model constants:** they're single named constants in `agent_registry.rs` — flip them there, never hardcode a model string elsewhere. If re-splitting the tiers (e.g. giving `response_agent` a real premium model again), re-read the in-code comment about GPT-5.6's cache-write cost before assuming it's a strict upgrade.
- **Adding a retrieval corpus:** implement `EvidenceSource` and add one entry to the `sources` array in `container.js`. Nothing else changes — `retrieveNode` sees one source.
- **Web search is a tool, not a corpus** — never register it into `CompositeEvidenceSource`; that array is searched on every RAG turn, which defeats the "model decides" design and reintroduces the `LLM → Search → LLM` cost this architecture avoids.
- **Citations:** never derive a citation token from `meetingId` again. Assign refs in `boundEvidence` (or `webCitations.assignRefs` for web), print them in `formatEvidenceBlock`, and keep the legacy `citedMeetingIds` fallback in `generateNode`.
- **Diarization & speakers:** always pass `sttLabel` alongside `speaker` end-to-end so the rename modal can map labels.
- **Cost safety:** all LLM calls flow through `OpenAiAdapter` (Rust) or `LlmGateway` + `CallCountBudgetGuard` (chatbot); embeddings through `EmbeddingGateway` + its separate budget; web search through `WebSearchGateway` + `CHATBOT_WEB_BUDGET_HARD`. Never bypass.
- **Never send `temperature`** to any agent's LLM call, or to the web-search Responses API call.
- **Migrations are forward-only** in `gateway/db/migrate.js` and `chatbot/.../documents/migrations.js` — add a new one, never edit a shipped one.
- **Don't** reintroduce Node LLM/agent logic into `gateway/`; `gateway/config/` is the gateway's own config module, not a leftover.
- **Don't** hand-edit `chatbot/data/*.db` — regenerate the FTS index via `bin/rebuild-index.js`.
- **Don't** write to `doc_store.db` from Rust — `sqlite_document_source.rs` is read-only by design; the chatbot owns writes.
- **Don't** assume the gateway can be bypassed for persistence — `sidecar/persistence.rs` only *builds* control commands; the gateway is still the sole writer of `meeting_history.db`.

## Known Gaps & Stale Claims

| Claim | Reality |
|---|---|
| "Invisible to screenshots / screen sharing" (README, older brain.md revisions) | **Removed from the codebase**, not merely disabled — `macos_overlay.rs` and `set_content_protected` no longer exist anywhere in the source. |
| "Menubar agent, no Dock icon" / `ActivationPolicy::Accessory` | **Reversed.** The app now runs `ActivationPolicy::Regular` — it has a Dock icon and a Cmd+Tab entry. |
| Fixed 420×780 always-on-top frameless window | **Reversed.** The window is a resizable 1180×760 (min 480×520), decorated, not always-on-top. |
| `--glass-dim` / `--glass-blur` / CSS `backdrop-filter` blur driving the shell | **Removed.** Replaced by native `window_material.rs` vibrancy; `--glass-alpha` (now `0.30`) is a tint over that material, and `--t-shell-backdrop` is `none` on purpose. |
| "All agents use `gpt-5.6-luna`" | Neither tier does right now — both `FAST_MODEL` and `PREMIUM_MODEL` are `gpt-4o-mini` in `agent_registry.rs`, a documented interim state pending a per-model cache-cost measurement. |
| Model tiers "set in `lib.rs`" | They're set in `application/agent_registry.rs`; `lib.rs` only calls `initialize_agent_graph`. |
| `ComplexityAnalyzerAgent` in the graph | Still unwired; complexity is a field on `ContextManagerAgent`'s JSON. |
| "Only `orchestrator::routing` has Rust tests" | Stale — **72** `#[test]`s across **19** files today, including the entire `agents/brief/` module. |
| Ask Roxi has no web access | Stale — a full hosted-web-search path (`generate_web`/`web_answer`, `OpenAiResponsesGateway`, `webPolicy.js`, `webCitations.js`) exists and is the normal production terminal when `CHATBOT_WEB_SEARCH_MODE=auto` (the default). |
| Projects / sessions / brief compiler are undocumented | Fixed in this revision — see their dedicated sections above. |
| `csp: null`, `withGlobalTauri: true` | Both still set. Not yet remediated; queued behind packaging work. |
| `audit/CODE-AUDIT-REPORT.md` (2026-08-26) | Point-in-time; several LLM/agent findings are stale post-migration, and the window/overlay findings predate this revision's removal of that subsystem entirely. Verify against current code before citing. |
| Token-level answer streaming | Still not implemented on the meeting/document path (`generateNode` awaits a full JSON object). The web path (`web_answer`/`generate_web`) also awaits a full response today — plain text removes the JSON-format obstacle but no streaming protocol message has been added yet. |
| Windows/Linux support | Still macOS-only. |

## Code Audit Summary (2026-08-26)

Full report: `audit/CODE-AUDIT-REPORT.md`. Critical: plaintext API keys in `gateway/.env` (rotate). High: CSP disabled, `withGlobalTauri: true` (XSS→IPC risk), sidecar path from CWD, unauthenticated stdin protocol. Medium/Low: mutex panics, unbounded channels, fragile DB path, O(n) deframer resync, dead code. Architecture verdict: clean separation; risks are configuration, not structure. **Predates** the window-subsystem removal, the brief compiler, the project/session domain, and the web-search feature — re-audit before treating any individual finding as current.

## Changelog

- **[2026-09-14]** Documentation sync: rewrote brain.md and README.md against verified current source after discovering the previous revisions no longer matched the shipped app (window/overlay subsystem removed, model tiers relocated and temporarily collapsed to one model, an undocumented brief-compiler/project/session domain, and an undocumented Ask Roxi web-search feature). No code changed in this pass.
- **[2026-09-07]** Document RAG, phases 5–9 of the glass-UI/document-RAG plan: document domain, embeddings, hybrid retrieval with RRF, ref-based citations, upload/list/delete over the chat sidecar protocol. Chatbot tests reached 199 at the time.
- **[2026-09-07]** Frontend rebuild: frosted-glass shell with a measured opacity budget, chat de-duplication into one parameterized thread, `threadId` through the whole protocol.
- **[2026-09-01]** Hybrid agent architecture: complexity routing added, ~25% average cost reduction vs a fixed agent count per chunk.
- **[2026-09-01]** Overlay work (accessory policy, fullscreen float, tray, transparent window) — later fully removed, see 2026-09-14 above.
- **[2026-08-28]** Ask Roxi chatbot (LangGraph Adaptive-RAG + FTS5); Node agent pipeline replaced by the Rust `ChunkGraph`; `dashboard/` added.
- **[2026-08-26]** Folder/data-flow sync + code audit.
- **[2026-08-22]** `sttLabel` speaker renaming; multi-STT provider manager; MFCC diarization; SQLite migration.

## Architectural Decision Records (ADRs)

### ADR 1: Why Node.js Sidecars Remain (2026-09-01)
**Context:** The agent pipeline was rewritten in pure Rust, yet two Node sidecars remain.
**Decision:** Keep Node for STT and the chatbot; use Rust for agents.
**Rationale:** The production real-time SDKs for AssemblyAI/Speechmatics and the LangGraph ecosystem are Node/Python-first; a cyclic graph runtime or diarization stack in Rust would reinvent both.
**Result:** Rust for concurrency/routing/window behavior; Node for specialized SDKs and graph frameworks. Still true today.

### ADR 2: A Second Retrieval Port, Not a Widened One (2026-09-07)
**Decision:** Add `EvidenceSource` beside `Retriever` rather than widening `Retriever.search`.
**Rationale:** `Retriever.search` takes sanitized FTS5 MATCH expressions a vector search can't consume; widening would violate ISP.
**Result:** `FtsRetriever`, `buildChatGraph` and `routing.js` were untouched by the change.

### ADR 3: Rank Fusion, Not Score Arithmetic (2026-09-07)
**Decision:** Merge with Reciprocal Rank Fusion (`RRF_K: 60`).
**Rationale:** BM25 is unbounded, cosine is 0..1; adding or normalizing them per-query is unstable.
**Result:** A pure, unit-tested merge function.

### ADR 4: Documents Get Their Own Database (2026-09-07)
**Decision:** A separate `doc_store.db`, not `chat_index.db`.
**Rationale:** `chat_index.db` is wholesale-rebuilt; coupling user documents to that would risk their lifetime.
**Result:** Separate file = separate ownership = a deletable module.

### ADR 5: Citations Are Per-Answer Refs (2026-09-07)
**Decision:** Every hit belongs to a `groupKey`; every group gets a `ref` (`M3`, `D2`, and now `W1` for web) assigned while evidence is bounded.
**Rationale:** Faking a `meetingId` for documents/web results would corrupt grouping and the UI.
**Result:** One risky commit, revertable alone, with a legacy `citedMeetingIds` fallback retained.

### ADR 6: Two Concurrency Lanes in the Chat Sidecar (2026-09-07)
**Decision:** Split a single `busy` flag into `askBusy` and `docBusy`.
**Rationale:** A multi-second upload would otherwise reject every question with `BUSY`.
**Result:** Questions and uploads proceed independently.

### ADR 7: Uploaded Documents Are Global (2026-09-07)
**Decision:** Global, with an unused `meeting_id` column reserved on `documents`.
**Rationale:** Simpler, matches "during a meeting or any time," and is the reversible direction.
**Result:** No scope filter in `DocumentEvidenceSource`; the column stands ready if the decision changes.

### ADR 8: The macOS Overlay Subsystem Was Removed, Not Disabled (2026-09-14) **NEW**
**Context:** The previous window design (fixed-size always-on-top widget, Accessory activation policy for no Dock icon, `NSStatusWindowLevel` fullscreen float, and a screen-capture shield already disabled) traded discoverability and normal window ergonomics for a "stealth widget" feel.
**Decision:** Delete `macos_overlay.rs` outright; move to `ActivationPolicy::Regular`, a resizable decorated window, and a purely cosmetic `window_material.rs` for native vibrancy.
**Rationale:** The stealth behaviors were already partially disabled (the capture shield) and added FFI surface/complexity for a positioning that conflicted with wanting a discoverable, resizable productivity app. Native vibrancy still needed solving independently — CSS `backdrop-filter` can't sample the real desktop — so that concern was kept and cleanly separated from the overlay/stealth concern, which was dropped.
**Result:** A simpler window stack with less native FFI surface; the tray and global hotkey (unrelated to the overlay code) were kept as the non-stealth show/hide affordances. Re-adding stealth behavior later is a from-scratch rebuild, not an uncomment.

### ADR 9: Compiled Briefs Instead of Re-Sent Context (2026-09-14) **NEW**
**Context:** Every agent needs grounding (project charter, glossary, roster, history, documents), but re-sending all of it on every chunk wastes tokens and defeats prompt-prefix caching, since providers only cache a byte-identical prefix.
**Decision:** Compile one deterministic, sentinel-wrapped prefix per agent per meeting (`agents/brief/compiler.rs`) once at `start_capture`, store it in an in-memory `BriefStore`, and split every subsequent prompt into that frozen prefix plus a small volatile suffix (`compose.rs`).
**Rationale:** Determinism (sorted sections, a content hash) is what makes the prefix cache-worthy — an unstable ordering would defeat the cache on every call. A hard token budget with `Result`-returning failure (rather than silent truncation) keeps a misconfigured brief from ever silently starving an agent of context.
**Result:** Grounding cost is paid once per meeting per agent, not once per chunk; `PREMIUM_MODEL`'s cache-write-cost caveat (ADR/comment in `agent_registry.rs`) is part of the same cost-accounting mindset.

### ADR 10: Projects and a Single-Slot Session Registry (2026-09-14) **NEW**
**Context:** Meetings needed a scoping container (multiple meetings per initiative), and the pipeline needed a stable identity for a capture before the gateway/DB meeting row exists.
**Decision:** Add a `Project` domain scoping glossary/roster/history/documents by `project_id` (with a seeded `Unsorted` bucket so no query handles a null project), and a `SessionRegistry` holding `Option<ActiveSession>` — a single mutable slot, not a session map.
**Rationale:** One capture at a time is already enforced by the capture use case and the audio device; modeling multiple concurrent sessions would add a data structure for a case the rest of the system already forbids. `SessionId` is deliberately process-local (not a DB key) so identity exists before `meetings.id` does, letting the brief store pre-warm ahead of the first transcript chunk.
**Result:** `src/features/library/` and `src/features/session/` on the frontend; `list_projects`/`create_project` commands; no change to the "single active capture" invariant, just a name for the state that already existed implicitly.

### ADR 11: Web Search Is a Second, Narrow Port — Not a Corpus, Not a Classifier (2026-09-14) **NEW**
**Context:** "Ask Roxi" needed to answer questions the corpora can't — current events, external facts — without a brittle pre-classifier deciding whether to search, and without corrupting the meeting/document citation model.
**Decision:** Add `WebSearchGateway` as a narrow port beside `LlmGateway`; hand the model a hosted tool through a single Responses API call and let it decide per turn whether to search; gate availability (not the decision) through `webPolicy.js`'s `auto`/`always`/`never`; assign web citations through a dedicated `webCitations.js` using `W#` refs.
**Rationale:** A classifier node would be an `LLM → Search → LLM` round trip and a second point of failure; widening `LlmGateway` would break Liskov substitution for adapters that can't search, and registering the tool into `CompositeEvidenceSource` would search on every turn regardless of need. Plain text (not JSON) is non-negotiable because citation offsets are character positions into the actual returned string.
**Result:** `generate_web`/`web_answer` are optional graph nodes that a container without a web-search key simply doesn't build; production default (`auto`) makes them the normal terminals, with `generate`/`direct_answer` as the fallback when a search call fails or the model chooses not to search.
