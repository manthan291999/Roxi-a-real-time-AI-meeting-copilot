# 🎙️ Roxi — AI Meeting Interpreter

<div align="center">

![Tauri](https://img.shields.io/badge/Tauri_2.x-24C8D8?style=for-the-badge&logo=tauri&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white)
![React](https://img.shields.io/badge/React_18-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js_20-339933?style=for-the-badge&logo=node.js&logoColor=white)
![AssemblyAI](https://img.shields.io/badge/AssemblyAI_v3-0052FF?style=for-the-badge&logoColor=white)
![Speechmatics](https://img.shields.io/badge/Speechmatics-00A550?style=for-the-badge&logoColor=white)
![OpenAI](https://img.shields.io/badge/OpenAI-412991?style=for-the-badge&logo=openai&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white)

**A real-time desktop copilot that listens to your meetings, transcribes speech with ultra-low latency, and turns complex discussion into plain language, decisions, action items, risks, and suggested replies — then answers questions about it all afterwards, from your meeting history, your uploaded documents, or the live web.**

[Overview](#-overview) • [Status](#-status) • [Features](#-key-features) • [Architecture](#-architecture) • [Tech Stack](#-tech-stack) • [Quick Start](#-quick-start) • [Configuration](#-configuration) • [Project Structure](#-project-structure) • [Testing](#-testing) • [Dashboard](#-developer-llm-usage-dashboard) • [Audit](#-code-audit)

</div>

---

## 📖 Overview

**Roxi** is an AI-powered desktop application built on **Tauri v2**, **Rust**, **React** and **TypeScript**.

It captures combined system audio and microphone streams, delivers live transcription via **AssemblyAI Universal-3 Streaming STT** (with **Speechmatics** as automatic fallback), and routes each finalized transcript through a **Rust-native multi-agent OpenAI pipeline** that explains, analyses and responds in real time. Every agent is grounded by a **compiled context brief** — project charter, glossary, roster, meeting history and uploaded documents, rendered once per meeting into a cache-friendly prompt prefix instead of being re-sent on every chunk.

Meetings live inside **projects**, browsable from a project library, and each capture is tracked by a lightweight session identity that exists before the meeting row itself does.

> **macOS-first.** Loopback capture depends on a virtual audio driver (BlackHole) and native window vibrancy uses AppKit APIs. Windows/Linux would need target gating and a per-platform loopback path.

### The live session is three tabs

1. **Listen** — real-time transcription with speaker labels and partial/final utterance buffering, plus a live amplitude-reactive waveform.
2. **Suggest** — decisions, action items, risks, plain-language explanations and suggested replies, rendered as filterable cards.
3. **Ask** — "Ask Roxi": ask questions across your meeting history and uploaded documents, with inline citations back to their source (`[M3]` for a meeting, `[D2]` for a document). When neither corpus has the answer — or the question is about something current or external — the model can reach for a live web search on its own and cite the result as `[W1]`.

---

## 🚦 Status

| Area | State |
|---|---|
| Audio capture, STT, diarization | ✅ Shipped |
| Rust agent pipeline (explanations, decisions, actions, risks, replies) | ✅ Shipped |
| Compiled per-agent context briefs (project + documents → cached prompt prefix) | ✅ Shipped |
| Projects (multi-project meeting library) & session identity | ✅ Shipped |
| Ask Roxi over meeting history | ✅ Shipped |
| Document parsing, chunking, embedding, vector store, upload/list/delete from the UI | ✅ Shipped |
| Hybrid retrieval (meetings + documents, RRF-merged), citations across both corpora | ✅ Shipped |
| Ask Roxi web search (model decides per turn; no UI toggle, config-only) | ✅ Shipped |
| Native window vibrancy (`NSVisualEffectView`, light-pinned) | ✅ Shipped |
| Dedicated LLM usage panel (`get_session_usage`) | ✅ Shipped |
| Screen-capture invisibility / "stealth" overlay window | ⛔ **Removed from the codebase**, not merely disabled. The earlier fixed-size, always-on-top, no-Dock-icon widget and its capture shield no longer exist — the app is now a normal resizable, Dock-visible window. Re-adding stealth behavior is a rebuild, not a flag flip. |
| Token-level answer streaming | ⛔ Not implemented, on either the corpus or the web-search chat path. Answers arrive complete; what streams today is *node progress*. |
| Windows / Linux | ⛔ macOS-only. |

---

## ✨ Key Features

- 🎧 **Hybrid Audio Capture** — native system output (loopback) and microphone captured simultaneously via `cpal`, downmixed and resampled to 16 kHz mono PCM16 with high-quality FFT resampling (`rubato`), with a live 3-band RMS waveform feed that doesn't require a second mic permission prompt.
- ⚡ **Ultra-Low Latency Streaming STT** — AssemblyAI v3 WebSocket streaming with automatic fallback to Speechmatics, managed by `ProviderManager`.
- 🗣️ **Speaker Diarization** — MFCC voice embeddings with cosine-similarity matching for cross-session speaker identification, and global speaker renaming.
- 🧠 **Rust-native multi-agent pipeline** (`src-tauri/src/agents/`) — every finalized transcript runs through `ChunkGraph`:
  - **Chit-chat gate** — a local heuristic that fast-exits small talk with **no LLM call at all**.
  - **Context Manager** — tracks the meeting topic, grades chunk significance, and returns the chunk's complexity in the same response.
  - **Complexity routing** — `Low` → explanation only; `Medium` → + risk detection; `High` → + technical analysis and meeting analyst, fanned out in parallel — a meaningful reduction in average LLM spend versus running every agent every time.
  - **Response Agent** — a natural, contextual reply you can actually say in the meeting.
- 📋 **Compiled context briefs** — one deterministic, cache-friendly system-prompt prefix per agent, compiled once at capture start from the active project's charter, glossary, roster, prior-meeting history and uploaded documents. Every chunk after that reuses the frozen prefix and only appends the live turn, so grounding cost is paid once per meeting rather than once per chunk.
- 🗂️ **Projects & session library** — meetings are organized into projects (with a seeded catch-all for anything un-filed), browsable from a dedicated library pane; each capture carries a lightweight session identity that exists before the underlying meeting row does.
- 💬 **Ask Roxi — hybrid retrieval, now with the web** — a LangGraph Adaptive-RAG sidecar that searches meeting history (FTS5/BM25, lexical) and uploaded documents (vector similarity, semantic) at once, merged by **Reciprocal Rank Fusion** and answered with inline `[M3]`/`[D2]` citations. On top of that, the model is handed a hosted **web search** tool through the OpenAI Responses API on every turn and decides for itself whether a question needs one — cited as `[W1]`, `[W2]`… No UI switch controls this; it's a single environment variable (`auto`/`always`/`never`, default `auto`), so the decision is genuinely the model's, not a pre-classifier's.
- 📄 **Document RAG** — PDF, DOCX, TXT and Markdown are parsed, chunked on semantic boundaries with page numbers carried through, embedded with `text-embedding-3-small`, and stored as L2-normalized vectors. Re-uploading a file is deduplicated by content hash and costs nothing. Upload/list/delete are fully wired from the UI through Rust to the chatbot sidecar, which alone parses, chunks, embeds and writes — Rust only reads, for the brief compiler.
- 🛡️ **Cost & failure resilience** — circuit breaker and cost-anomaly detection on the capture pipeline; separate call budgets for embeddings and web search so neither can starve the conversation that triggered it; every agent degrades to a grounded fallback rather than failing the turn.
- 🪟 **Native window vibrancy** — a transparent, resizable window backed by a real `NSVisualEffectView` pinned to light appearance, not a CSS blur — CSS `backdrop-filter` can't sample the desktop behind the window, so the material is native.
- 💾 **SQLite persistence** — forward-only migrations, WAL mode, and three deliberately separate databases (see [Database Schema](#-database-schema)), with the gateway sidecar remaining the sole writer of meeting history even as Rust's control channel requests persistence on its behalf.
- 📊 **LLM observability** — every completion, embedding *and* web-search call is logged with tokens, latency, cost and prompts, inspectable in a bundled dashboard and a lightweight in-app usage panel.

---

## 🏛️ Architecture

Four cooperating runtimes, deliberately process-isolated. Rust ↔ Node communication is over OS pipes — binary framed audio and control commands in, typed JSON lines out.

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        TAURI DESKTOP APPLICATION                         │
│                                                                          │
│  ┌────────────────────────┐             ┌─────────────────────────────┐  │
│  │  React + TypeScript    │ ◄─ invoke ──┤      Rust Core Engine       │  │
│  │  one window, 3 tabs    │    events   │      (src-tauri/src)        │  │
│  │  suggest / ask / listen│ ──────────► │                             │  │
│  │  + project library     │             │  cpal capture → rubato       │  │
│  │  + session dashboard   │             │  → PCM1 framing + CTL1       │  │
│  └────────────────────────┘             │                              │  │
│                                         │  BriefUseCase compiles one    │  │
│                                         │  cached prompt prefix per     │  │
│                                         │  agent at capture start       │  │
│                                         │                              │  │
│                                         │  ChunkGraph (agents/):       │  │
│                                         │   chit-chat gate → context   │  │
│                                         │   → routing::decide()        │  │
│                                         │   → {explanation, technical, │  │
│                                         │      analyst, risk} parallel │  │
│                                         │   → response agent           │  │
│                                         └───────┬──────────────┬───────┘  │
└─────────────────────────────────────────────────┼──────────────┼──────────┘
                       framed PCM1+CTL1 (stdin)   │              │  stdio JSON
                    ┌──────────────────────────────┘              └──────────┐
                    ▼                                                        ▼
      ┌──────────────────────────────┐                    ┌──────────────────────────────┐
      │   gateway/sidecar.js (Node)  │                    │  chatbot/sidecar.js (Node)   │
      │   PcmDeframer                │                    │  LangGraph Adaptive-RAG      │
      │   → ProviderManager          │                    │                              │
      │     (AssemblyAI → Speechmatics)                   │  analyze → retrieve → grade  │
      │   → sanitizer → diarization  │                    │    → generate / generate_web │
      │   → SOLE WRITER of           │                    │    / clarify / direct_answer │
      │     meeting_history.db        │                    │                              │
      └───────────────┬──────────────┘                    │  EvidenceSource:             │
                      │                                   │   FTS5 (meetings)   ─┐       │
                      │                                   │   vectors (documents)─┴─RRF   │
                      │                                   │  WebSearchGateway (model-     │
                      │                                   │   decided, own port)          │
                      ▼                                   └──────────────────────────────┘
            meeting_history.db  ◄──── read by Rust ────┬─── read-only ─────────┘
                                                       │
   External:  AssemblyAI / Speechmatics (STT, WS)  ·  OpenAI (LLM + embeddings + web search, HTTPS)
   Audio in:  BlackHole 2ch (loopback) + system mic, via cpal
```

### Pipeline flow

```
Audio capture → PCM1 framing → STT provider → sanitizer → diarization
    → meeting_history.db → ChunkGraph (Rust agents, grounded by compiled briefs)
    → Tauri events → React UI
```

### Ask Roxi flow

```
question → analyze_query → retrieve (FTS5 ∥ vectors → RRF) → grade_documents
    → generate (cited [M#]/[D#]) | generate_web (cited [M#]/[D#]/[W#]) | clarify
    | rewrite | direct_answer | web_answer | no_data → chat_reply
```

`generate_web`/`web_answer` are the normal production terminals when web search is enabled (the default) — the classic `generate`/`direct_answer` nodes are the fallback used when a web call fails or the container has no web-search key configured at all.

> 📐 **Deeper reference:** [`brain.md`](brain.md) is the canonical, file-by-file architecture document — process topology, the citation model, the brief compiler, the project/session domain, the web-search design, storage layout, the complete command/event catalog, and the ADRs behind the load-bearing decisions. [`docs/SYSTEM-ARCHITECTURE.md`](docs/SYSTEM-ARCHITECTURE.md) covers process topology and end-to-end data flow with diagrams, and [`docs/architecture/`](docs/architecture/) breaks that down into focused deep dives — one each for the [agent pipeline](docs/architecture/agent-pipeline.md), [Ask Roxi's retrieval + web search](docs/architecture/ask-roxi-rag.md), [data & persistence](docs/architecture/data-persistence.md), the [frontend](docs/architecture/frontend.md), and [security & configuration](docs/architecture/security-config.md).

---

## 🛠️ Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Desktop shell** | Tauri v2 | Native window, IPC, sidecar management, tray, global shortcuts |
| **Audio capture** | Rust + `cpal` + `rubato` | Loopback & mic capture, FFT resampling to 16 kHz, live level metering |
| **Agent pipeline** | Rust + `rig-core` + `tokio` | Native multi-agent graph, grounded by compiled per-agent briefs |
| **Native window material** | `window-vibrancy` + `objc2-app-kit` | Real `NSVisualEffectView` behind the transparent webview, pinned to light appearance |
| **Frontend** | React 18 + TypeScript + Vite + Tailwind | Single-window three-tab widget plus a project library and session dashboard, on a glass design system |
| **Sidecar runtime** | Node.js 20+ | STT/diarization (`gateway/`, sole writer of meeting history) and Ask Roxi (`chatbot/`) |
| **STT** | AssemblyAI + Speechmatics | Real-time streaming STT with automatic fallback |
| **LLM** | **OpenAI** — `gpt-4o-mini` (all agent tiers today) | All agent completions |
| **Web search** | **OpenAI Responses API**, hosted `web_search` tool | Ask Roxi's model-decided web path |
| **Embeddings** | **OpenAI `text-embedding-3-small`** (1,536-dim) | Document chunk and query vectors |
| **RAG framework** | `@langchain/langgraph` | Adaptive-RAG state graph for Ask Roxi |
| **Document parsing** | `pdf-parse`, `mammoth` | PDF and DOCX text extraction |
| **Database** | SQLite (`better-sqlite3` / `rusqlite`) | Meetings, projects, transcripts, artifacts, FTS index, document vectors, usage |

**Model tiering matters — and is currently an interim state, on purpose.** Tiers are set in one place — `src-tauri/src/application/agent_registry.rs`, as two named constants, `FAST_MODEL` and `PREMIUM_MODEL` — not hardcoded per agent. Both constants currently point at `gpt-4o-mini`: the in-code comment explains that the stronger model family bills prompt-cache *writes* at a premium, which can outweigh the read savings on a typical meeting's chunk count, so the "premium" tier is being measured per-model rather than assumed. If you add an agent, register a tag in this file and pick a tier deliberately.

---

## 🚀 Quick Start

### 1. Prerequisites

- **Rust & Cargo** — [install](https://www.rust-lang.org/tools/install)
- **Node.js** `v20.x` or later
- **BlackHole 2ch** — the virtual audio driver used for loopback capture ([install](https://existential.audio/blackhole/)). The app detects whether it's present and guides you through setup.
- **API keys:**
  - [OpenAI](https://platform.openai.com/) — **required** (agents, Ask Roxi, embeddings, web search)
  - [AssemblyAI](https://www.assemblyai.com/) — primary STT
  - [Speechmatics](https://www.speechmatics.com/) — fallback STT (optional but recommended)

### 2. Clone

```bash
git clone https://github.com/manthan291999/meeting-interpreter.git
cd meeting-interpreter
```

### 3. Install dependencies

There are **three separate npm trees** — root, gateway and chatbot:

```bash
npm install
cd gateway && npm install && cd ..
cd chatbot && npm install && cd ..
```

### 4. Configure environment variables

Create a **`.env` at the project root** — not in `gateway/`. Both the Rust core (via `dotenvy`) and both Node sidecars read the root file first. This matters for packaged `.app` bundles, which don't inherit your shell environment.

```env
# Required — all agent, chatbot, embedding and web-search calls
OPENAI_API_KEY=your_openai_key_here

# At least one STT provider is required
ASSEMBLYAI_API_KEY=your_assemblyai_key_here
SPEECHMATICS_API_KEY=your_speechmatics_key_here
```

> The pre-commit hook blocks staged `.env` files and greps the diff for API-key patterns. Don't bypass it with `--no-verify` unless you mean to.

### 5. Run in development

```bash
npm run tauri dev
```

The window opens automatically — resizable, with a Dock icon and normal traffic-light controls. Pick or create a project, click **Start Capture**, give the meeting some context, and begin speaking or play audio through your system.

---

## ⚙️ Configuration

All variables live in the root `.env`. Only `OPENAI_API_KEY` plus one STT key are required; everything else has a working default.

### Required

| Variable | Description |
|---|---|
| `OPENAI_API_KEY` | All LLM completions, embeddings, and web-search calls. Startup logs a fatal error if empty and agents will then fail with 401s. |
| `ASSEMBLYAI_API_KEY` | Primary real-time STT. |
| `SPEECHMATICS_API_KEY` | Fallback STT. At least one of the two STT keys is required. |

### Optional — capture pipeline

| Variable | Default | Description |
|---|---|---|
| `STT_PROVIDER` | auto | Force `assemblyai` or `speechmatics`. |
| `LLM_BUDGET_SOFT` / `LLM_BUDGET_HARD` | `60` / `80` | Circuit-breaker call caps per session. |
| `ANOMALY_COST_PER_CHUNK_USD` | `0.05` | Cost-anomaly threshold per chunk. |
| `ANOMALY_COST_PER_MIN_USD` | `0.10` | Cost-anomaly threshold per minute. |
| `ANOMALY_SESSION_BUDGET_USD` | `2.00` | Session cost ceiling. |

### Optional — Ask Roxi, documents & web search

| Variable | Default | Description |
|---|---|---|
| `CHATBOT_MODEL` | — | Chatbot completion model. |
| `CHATBOT_LLM_ADAPTER` | `openai` | Set `langchain` to swap the chatbot's LLM gateway. |
| `CHATBOT_LLM_BUDGET_SOFT` / `_HARD` | `60` / `80` | Chatbot's own budget guard. |
| `CHATBOT_EMBED_MODEL` | `text-embedding-3-small` | Embedding model. |
| `CHATBOT_EMBED_BUDGET_HARD` | `400` | **Separate** embedding call budget — one big upload must not exhaust the conversation's allowance. |
| `CHATBOT_MAX_DOCUMENT_BYTES` | `20 MiB` | Per-file upload cap. |
| `CHATBOT_MAX_LIBRARY_BYTES` | `200 MiB` | Total document library cap. |
| `CHATBOT_MAX_DOCUMENTS` | `50` | File-count backstop. |
| `CHATBOT_WEB_SEARCH_MODE` | `auto` | `auto` (model decides) \| `always` (forced) \| `never` (tool not sent at all). **The only web control there is — no UI switch exists.** Unrecognised means `never`. |
| `CHATBOT_WEB_SEARCH_MODEL` | — | Model for the web path only; empty falls back to `CHATBOT_MODEL`. |
| `CHATBOT_WEB_SEARCH_TOOL_TYPE` | `web_search` | Hosted tool id; one-time fallback to `web_search_preview` if rejected. |
| `CHATBOT_WEB_SEARCH_CONTEXT_SIZE` | `medium` | `low`/`medium`/`high` — `low` is the latency lever. |
| `CHATBOT_WEB_MAX_TOOL_CALLS` | `0` | Searches per turn; `0` means the param is omitted entirely. |
| `CHATBOT_WEB_TIMEOUT_MS` | `60000` | Double the chat gateway's own timeout — a multi-search turn can exceed 30s. |
| `CHATBOT_WEB_BUDGET_HARD` | `20` | Own call budget, separate from the chat budget. |
| `CHATBOT_WEB_USER_COUNTRY` / `_CITY` / `_REGION` | — | Optional `user_location` for the search tool. |
| `CHATBOT_DOC_DB` / `CHATBOT_INDEX_DB` / `CHATBOT_MEETING_DB` | see defaults | Database path overrides. |

### Optional — observability & privacy

| Variable | Default | Description |
|---|---|---|
| `LLM_USAGE_DB` | `gateway/llm_usage.db` | Shared usage database. |
| `LLM_USAGE_TRACKING` | `1` | Set `0` to disable usage recording entirely. |
| `LLM_TRACK_PAYLOADS` | `1` | Set `0` to stop storing prompts/responses — **privacy toggle**. |

---

## 📁 Project Structure

```text
meeting-interpreter/
├── brain.md                    # Canonical architecture reference + ADRs
├── CLAUDE.md                   # Working instructions for AI coding agents
├── audit/                      # Code audit reports
├── docs/                       # Deeper design + architecture docs
│
├── src/                        # Frontend — React + TypeScript (ONE window)
│   ├── app/                    # App.tsx (idle screen, project library, or live session), main.tsx
│   ├── shell/                  # AppShell, NavigationTabs, WidgetHeader
│   ├── design-system/          # GlassCard, Badge, TagChip, Waveform, ContextRow, tokens.ts
│   ├── context/                # ServicesProvider — dependency injection over Tauri
│   ├── features/
│   │   ├── capture/            # useCaptureSession/Flow, useAudioLevel, IdleScreen, context-intake/
│   │   ├── transcript/         # TranscriptPane, SpeakerRenameModal, useTranscript
│   │   ├── suggest/            # SuggestAnswersPane, SuggestCard, RefineRow, tag filters
│   │   ├── chat/                # ChatPane, ChatThreadProvider, RoxiAnswerCard, SourceChip
│   │   ├── session/             # LiveSessionDashboard, LiveStage — the live-capture shell
│   │   ├── library/              # ProjectLibrary, ProjectDetail — the multi-project meeting browser
│   │   ├── usage/                # UsagePill — reads get_session_usage
│   │   ├── analysis/            # AnalysisPane
│   │   └── history/              # HistoryPane, MeetingDetailModal
│   ├── services/                # Tauri-backed implementations + wire types & mappers
│   ├── shared/                   # interfaces/ (5 service contracts), types/, ui/
│   └── styles.css                # Tailwind + the --glass-alpha tint over native vibrancy
│
├── gateway/                    # Node sidecar — STT + diarization; SOLE WRITER of meeting_history.db
│   ├── sidecar.js               # PCM1 parser → ProviderManager → stdout JSON
│   ├── control/command-handler.js  # Handles CTL1 control frames from Rust (rename, persist)
│   ├── audio/pcm-deframer.js
│   ├── providers/               # assemblyai.js, speechmatics.js, mfcc.js
│   ├── stt/                     # provider-manager, diarization-layer, transcript-sanitizer
│   ├── config/                  # gateway's own env/argv resolution
│   ├── db/                      # index.js, migrate.js (forward-only)
│   └── state/, infrastructure/, tools/, lifecycle/
│
├── chatbot/                    # Node sidecar — Ask Roxi (meetings + documents + web)
│   ├── sidecar.js               # stdio JSON protocol entry
│   ├── bin/                      # rebuild-index.js, ask.js (--web=auto|always|never), eval-web-search.js
│   ├── data/                     # chat_index.db (FTS5), doc_store.db (documents)
│   ├── test/                      # 395 node:test cases, zero network calls (eval:web is separate)
│   └── src/
│       ├── composition/container.js     # DI root
│       ├── domain/ports/                 # Retriever, EvidenceSource, EmbeddingGateway,
│       │                                 #   WebSearchGateway, DocumentParser, LlmGateway
│       ├── application/
│       │   ├── graph/                    # buildChatGraph, routing, evidence, webPolicy, webCitations
│       │   ├── nodes/                     # analyze, retrieve, grade, rewrite, clarify, generate,
│       │   │                              #   generateWeb, webAnswer
│       │   ├── retrieval/                 # CompositeEvidenceSource, rrf.js
│       │   └── useCases/                  # AnswerQuestion, IndexDocument, ManageDocuments
│       ├── infrastructure/
│       │   ├── persistence/               # FtsRetriever, FtsIndexBuilder, FtsEvidenceSource
│       │   ├── documents/                 # repository, chunker, parsers/, DocumentEvidenceSource
│       │   ├── embedding/                 # OpenAiEmbeddingGateway
│       │   └── llm/                        # OpenAiLlmGateway, OpenAiResponsesGateway, textResponse
│       └── transport/stdioSidecar.js      # Protocol: Ask + Upload/List/Delete, two busy lanes
│
├── dashboard/                  # LLM usage dashboard (zero-build Express app)
│
└── src-tauri/                  # Rust backend
    ├── tauri.conf.json         # One window "main": 1180×760, min 480×520, resizable, transparent, decorated
    └── src/
        ├── lib.rs              # Composition root: adapters, agents, commands, setup hook
        ├── window_material.rs  # Native NSVisualEffectView vibrancy, pinned to light appearance
        ├── application/        # agent_registry.rs (MODEL TIERS), brief_usecase.rs,
        │                        #   session_registry.rs, capture_usecase.rs
        ├── agents/              # Rust-native LLM pipeline (hexagonal), incl. brief/ (context
        │                        #   brief compiler) and its own ports/adapters/domain
        │   ├── orchestrator/     # chunk_graph.rs, routing.rs (pure, unit-tested)
        │   ├── agents/            # context_manager, explanation, technical, analyst,
        │   │                      #   risk_detector, response_agent, chit_chat_gate
        │   ├── brief/              # model, budget, compiler, compose, store
        │   ├── adapters/           # openai_adapter.rs, openai_embedding_adapter.rs, usage_store.rs
        │   └── ports/               # agent_port.rs, llm_port.rs
        ├── domain/              # meeting, project, session, audio_level, usage
        ├── adapters/            # mac_audio, gateway_client, chat_client, control_channel,
        │                         #   audio_meter, sqlite*.rs (schema/usage/projects/brief_source/
        │                         #   document_source — the last read-only against the chatbot's DB)
        ├── commands/            # capture, db, chat, audio_devices, speaker, projects, documents, usage
        ├── sidecar/             # events.rs, event_router.rs, chat_events.rs, persistence.rs
        ├── streaming.rs         # PCM1 framing sink
        └── resample.rs          # FFT audio resampler
```

---

## 🗄️ Database Schema

**Three separate SQLite databases**, never joined at the query level. The separation is deliberate — each has a different owner and lifetime.

| Database | Owner | Notes |
|---|---|---|
| `gateway/meeting_history.db` | gateway sidecar (write, **exclusively**) | Read by Rust across several dedicated adapters; opened **read-only** by the chatbot to avoid WAL conflicts. Rust never writes to it directly — it asks the gateway to, over the same control channel used for speaker renames. |
| `gateway/llm_usage.db` | Rust + chatbot (write) | One row per LLM/embedding/web-search call. Read by the dashboard and by an in-app usage panel. |
| `chatbot/data/chat_index.db` | chatbot | FTS5 index over meeting history. Wholesale-rebuilt — regenerate with `bin/rebuild-index.js`, never hand-edit. |
| `chatbot/data/doc_store.db` | chatbot (write, **exclusively**) | Uploaded documents and their vectors. Rust reads it directly, read-only, to feed the context-brief compiler — it never writes. |

Schemas evolve via **forward-only migrations** (`gateway/db/migrate.js`, `chatbot/src/infrastructure/documents/migrations.js`). Never edit a shipped migration — add a new one.

### Meeting history — core tables

```sql
CREATE TABLE meetings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    end_time DATETIME, context TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    api_calls INTEGER NOT NULL DEFAULT 0,
    provider TEXT, summary TEXT
);

CREATE TABLE transcripts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_id INTEGER REFERENCES meetings(id),
    speaker TEXT, text TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_id INTEGER NOT NULL REFERENCES meetings(id),
    seq INTEGER NOT NULL, speaker TEXT, text TEXT NOT NULL,
    significance TEXT, topic TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (meeting_id, seq)
);

-- Extracted artifacts, speaker identity, and project scoping
CREATE TABLE decisions (...);        CREATE TABLE action_items (...);
CREATE TABLE risks (...);            CREATE TABLE technical_analyses (...);
CREATE TABLE suggested_replies (...); CREATE TABLE summaries (...);
CREATE TABLE glossary_terms (...);   CREATE TABLE speaker_profiles (...);
CREATE TABLE speaker_names (...);    CREATE TABLE speaker_embeddings (...);
-- plus the project-scoping columns/tables the Projects feature added
```

### Document store

```sql
CREATE TABLE documents (
    doc_id TEXT PRIMARY KEY, file_name TEXT NOT NULL, mime_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL, page_count INTEGER,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    embed_model TEXT NOT NULL,      -- provenance: re-embed if the model changes
    dimensions INTEGER NOT NULL,
    status TEXT NOT NULL,           -- indexing | ready | failed
    error_message TEXT, uploaded_at TEXT NOT NULL,
    content_hash TEXT NOT NULL      -- sha256; dedupes re-uploads
);

CREATE TABLE document_chunks (
    chunk_id TEXT PRIMARY KEY,
    doc_id TEXT NOT NULL REFERENCES documents(doc_id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL, page_number INTEGER,
    char_start INTEGER NOT NULL, char_end INTEGER NOT NULL, text TEXT NOT NULL,
    embedding BLOB NOT NULL         -- Float32LE[dimensions], L2-normalized
);
```

Vectors are stored **L2-normalized**, so cosine similarity is a plain dot product at query time. Brute-force search over a few thousand vectors is single-digit milliseconds — no vector database required at this scale.

---

## 🧪 Testing

```bash
npm test           # chatbot suite
npm run test:all   # chatbot + gateway
npm run lint       # tsc --noEmit

cd chatbot && node --test test/rrf.test.js          # a single file
cd chatbot && node --test "test/web-*.test.js"        # web-search unit tests
npm --prefix chatbot run eval:web -- --dry            # web-search routing eval — REAL API calls, never in CI
cd src-tauri && cargo test                             # the Rust unit tests
```

Verified by running the suites: **chatbot 395**, **gateway 99**, and **Rust 72** `#[test]` functions spread across **19 files** — well beyond just the pipeline-routing logic, and now covering the context-brief compiler, the control channel, and the read-only document/usage adapters too.

**No test makes a network call**, with one deliberate exception: `eval:web` (`chatbot/bin/eval-web-search.js`) makes real OpenAI calls to measure web-search routing precision/recall and is kept **outside** `npm test` on purpose — never wire it into CI or pre-commit. Every other OpenAI-touching class sits behind a port, so the regular suites run entirely on fakes.

---

## 📊 Developer LLM Usage Dashboard

Every LLM request, embedding request, *and* web-search call — tokens, latency, cost, errors and the actual prompts — is persisted to `gateway/llm_usage.db`. A standalone dashboard inspects it:

```bash
npm run dashboard        # → http://localhost:3300
npm run dashboard:seed   # optional demo data
```

Four tabs: **Overview** (totals, tokens/cost over time, per-agent rollup), **Requests** (filterable table), **Request Detail** (exact prompt sent, params, response preview, and the file/function that made the call), and **API Call Map** (every LLM call site plus STT providers). A hosted web search is billed per call, separate from tokens, so a `webSearchCount` column is logged alongside cost rather than folded into it. See [`dashboard/README.md`](dashboard/README.md) for the data dictionary and privacy toggles (`LLM_TRACK_PAYLOADS=0` disables prompt storage).

---

## 📦 Building for Production

```bash
npm run tauri build
```

The bundle is written to `src-tauri/target/release/bundle/`. macOS is the supported target today.

---

## 🔍 Code Audit

A comprehensive audit was performed on **2026-08-26** — full report at [`audit/CODE-AUDIT-REPORT.md`](audit/CODE-AUDIT-REPORT.md).

| Severity | Count | Key issues |
|---|---|---|
| **Critical** | 1 | API keys stored in plaintext |
| **High** | 4 | CSP disabled, `withGlobalTauri: true`, sidecar path from CWD, unauthenticated stdin protocol |
| **Medium** | 8 | Mutex panics, unbounded channels, resampler flush, fragile DB path, O(n) deframer scan, flush timer race, type confusion |
| **Low** | 9 | Misleading names, unused deps, logger not initialized, dead code, hardcoded limits |

### Outstanding

1. **Rotate any keys that were ever committed** — treat plaintext keys as compromised.
2. **Enable CSP** in `tauri.conf.json` (`security.csp` is still `null`).
3. **Set `"withGlobalTauri": false`** — `window.__TAURI__` is still referenced nowhere in `src/` or `index.html`, so this can be turned off safely.

> ⚠️ **The report is a point-in-time snapshot**, and predates several architectural changes since — the removal of the macOS overlay/stealth window subsystem, the context-brief compiler, the project/session domain, and the Ask Roxi web-search feature. Verify against current code before acting on any individual finding, and see [`brain.md`](brain.md)'s "Known Gaps & Stale Claims" table for the full list of what's changed underneath it.

### Architecture verdict

Clean separation of concerns — hexagonal architecture in Rust (nested one level deeper inside `agents/` too), ports-and-adapters in the chatbot, a layered pipeline in the gateway. The primary risks are security *configuration*, not architectural flaws.

---

## 📄 License

Licensed under the [MIT License](LICENSE).
