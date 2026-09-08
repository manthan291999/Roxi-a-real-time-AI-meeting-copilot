# 🎙️ Roxi — AI Meeting Interpreter

<div align="center">

![Tauri](https://img.shields.io/badge/Tauri_2.x-24C8D8?style=for-the-badge&logo=tauri&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white)
![React](https://img.shields.io/badge/React_18-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![AssemblyAI](https://img.shields.io/badge/AssemblyAI_v3-0052FF?style=for-the-badge&logoColor=white)
![Speechmatics](https://img.shields.io/badge/Speechmatics-00A550?style=for-the-badge&logoColor=white)
![OpenAI](https://img.shields.io/badge/OpenAI-412991?style=for-the-badge&logo=openai&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white)

**A real-time desktop copilot that listens to your meetings, transcribes speech with ultra-low latency, and turns complex discussion into plain language, decisions, action items, risks, and suggested replies — then answers questions about it all afterwards.**

[Status](#-status) • [Features](#-key-features) • [Architecture](#-architecture) • [Tech Stack](#-tech-stack) • [Quick Start](#-quick-start) • [Configuration](#-configuration) • [Project Structure](#-project-structure) • [Testing](#-testing) • [Dashboard](#-developer-llm-usage-dashboard) • [Audit](#-code-audit)

</div>

---

## 📖 Overview

**Roxi** is an AI-powered desktop application built on **Tauri v2**, **Rust**, **React** and **TypeScript**.

It captures combined system audio and microphone streams, delivers live transcription via **AssemblyAI Universal-3 Streaming STT** (with **Speechmatics** as automatic fallback), and routes each finalized transcript through a **Rust-native multi-agent OpenAI pipeline** that explains, analyses and responds in real time.

> **macOS-first.** Loopback capture depends on a virtual audio driver (BlackHole) and the window behaviour uses AppKit APIs. Windows/Linux would need target gating and a per-platform loopback path.

### The live session is three tabs

1. **Listen** — real-time transcription with speaker labels and partial/final utterance buffering.
2. **Suggest** — decisions, action items, risks, plain-language explanations and suggested replies, rendered as filterable cards.
3. **Ask** — "Ask Roxi": ask questions across your meeting history, with inline citations back to the meeting they came from. Document search is wired end-to-end behind this tab; the upload control itself is still being built (see [Status](#-status)).

---

## 🚦 Status

| Area | State |
|---|---|
| Audio capture, STT, diarization | ✅ Shipped |
| Rust agent pipeline (explanations, decisions, actions, risks, replies) | ✅ Shipped |
| Ask Roxi over meeting history | ✅ Shipped |
| Document parsing, chunking, embedding, vector store | ✅ Shipped |
| Hybrid retrieval (meetings + documents, RRF-merged) | ✅ Shipped — wired into the live answer path |
| Citations across both corpora (`[M3]` / `[D2]`) | ✅ Shipped |
| Upload/list/delete over the sidecar protocol | ✅ Shipped |
| Document upload from the UI | ✅ Shipped |
| Screen-capture invisibility | ⛔ Currently **disabled** — `set_content_protected` is commented out so the window stays visible in screen shares. |
| Token-level answer streaming | ⛔ Not implemented. Answers arrive complete; what streams today is *node progress*. |
| Windows / Linux | ⛔ macOS-only. |

---

## ✨ Key Features

- 🎧 **Hybrid Audio Capture** — native system output (loopback) and microphone captured simultaneously via `cpal`, downmixed and resampled to 16 kHz mono PCM16 with high-quality FFT resampling (`rubato`).
- ⚡ **Ultra-Low Latency Streaming STT** — AssemblyAI v3 WebSocket streaming with automatic fallback to Speechmatics, managed by `ProviderManager`.
- 🗣️ **Speaker Diarization** — MFCC voice embeddings with cosine-similarity matching for cross-session speaker identification, and global speaker renaming.
- 🧠 **Rust-native multi-agent pipeline** (`src-tauri/src/agents/`) — every finalized transcript runs through `ChunkGraph`:
  - **Chit-chat gate** — a local heuristic that fast-exits small talk with **no LLM call at all**.
  - **Context Manager** — tracks the meeting topic, grades chunk significance, and returns the chunk's complexity in the same response.
  - **Complexity routing** — `Low` → explanation only; `Medium` → + risk detection; `High` → + technical analysis and meeting analyst, fanned out in parallel. Roughly a 25% reduction in average LLM spend versus running every agent every time.
  - **Response Agent** — a natural, contextual reply you can actually say in the meeting.
- 💬 **Ask Roxi — hybrid retrieval** — a LangGraph Adaptive-RAG sidecar that searches **two corpora at once**: meeting history (FTS5/BM25, lexical) and uploaded documents (vector similarity, semantic). Results are merged by **Reciprocal Rank Fusion**, graded for relevance, and answered with inline `[M3]` / `[D2]` citations. Either corpus can fail without taking the other down.
- 📄 **Document RAG** *(engine complete, UI in progress — see [Status](#-status))* — PDF, DOCX, TXT and Markdown are parsed, chunked on semantic boundaries with page numbers carried through, embedded with `text-embedding-3-small`, and stored as L2-normalized vectors in a dedicated SQLite store. Re-uploading a file is deduplicated by content hash and costs nothing.
- 🛡️ **Cost & failure resilience** — circuit breaker and cost-anomaly detection on the capture pipeline; a **separate** call budget for embeddings so one large upload can't starve the conversation it was uploaded for; every agent degrades to a grounded fallback rather than failing the turn.
- 💾 **SQLite persistence** — forward-only migrations, WAL mode, and three deliberately separate databases (see [Database Schema](#-database-schema)).
- 🎨 **Frosted-glass UI** — a single 420×780 always-on-top widget governed by a measured opacity budget, with an accessible high-contrast mode.
- 📊 **LLM observability** — every completion *and* embedding is logged with tokens, latency, cost and prompts, inspectable in a bundled dashboard.

---

## 🏛️ Architecture

Four cooperating runtimes, deliberately process-isolated. Rust ↔ Node communication is over OS pipes — binary framed audio in, typed JSON lines out.

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        TAURI DESKTOP APPLICATION                         │
│                                                                          │
│  ┌────────────────────────┐             ┌─────────────────────────────┐  │
│  │  React + TypeScript    │ ◄─ invoke ──┤      Rust Core Engine       │  │
│  │  one window, 3 tabs    │    events   │      (src-tauri/src)        │  │
│  │  suggest / ask / listen│ ──────────► │                             │  │
│  └────────────────────────┘             │  cpal capture → rubato       │  │
│                                         │  → PCM1 framing              │  │
│                                         │                              │  │
│                                         │  ChunkGraph (agents/):       │  │
│                                         │   chit-chat gate → context   │  │
│                                         │   → routing::decide()        │  │
│                                         │   → {explanation, technical, │  │
│                                         │      analyst, risk} parallel │  │
│                                         │   → response agent           │  │
│                                         └───────┬──────────────┬───────┘  │
└─────────────────────────────────────────────────┼──────────────┼──────────┘
                       framed PCM1 (stdin)        │              │  stdio JSON
                    ┌──────────────────────────────┘              └──────────┐
                    ▼                                                        ▼
      ┌──────────────────────────────┐                    ┌──────────────────────────────┐
      │   gateway/sidecar.js (Node)  │                    │  chatbot/sidecar.js (Node)   │
      │   PcmDeframer                │                    │  LangGraph Adaptive-RAG      │
      │   → ProviderManager          │                    │                              │
      │     (AssemblyAI → Speechmatics)                   │  analyze → retrieve → grade  │
      │   → sanitizer → diarization  │                    │    → generate / clarify      │
      │                              │                    │                              │
      │   writes meeting_history.db  │                    │  EvidenceSource:             │
      └───────────────┬──────────────┘                    │   FTS5 (meetings)   ─┐       │
                      │                                   │   vectors (documents)─┴─RRF   │
                      │                                   └──────────────────────────────┘
                      ▼                                                        │
            meeting_history.db  ◄──── read by Rust ────┬─── read-only ─────────┘
                                                       │
   External:  AssemblyAI / Speechmatics (STT, WS)  ·  OpenAI (LLM + embeddings, HTTPS)
   Audio in:  BlackHole 2ch (loopback) + system mic, via cpal
```

### Pipeline flow

```
Audio capture → PCM1 framing → STT provider → sanitizer → diarization
    → meeting_history.db → ChunkGraph (Rust agents) → Tauri events → React UI
```

### Ask Roxi flow

```
question → analyze_query → retrieve (FTS5 ∥ vectors → RRF) → grade_documents
    → generate (cited [M#]/[D#]) | clarify | rewrite | no_data → chat_reply
```

> 📐 **Deeper reference:** [`brain.md`](brain.md) is the canonical, file-by-file architecture document — process topology, the citation model, storage layout, the complete command/event catalog, and the ADRs behind the load-bearing decisions. [`docs/SYSTEM-ARCHITECTURE.md`](docs/SYSTEM-ARCHITECTURE.md) covers the capture plane in detail.

---

## 🛠️ Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Desktop shell** | Tauri v2 | Native window, IPC, sidecar management, tray, global shortcuts |
| **Audio capture** | Rust + `cpal` + `rubato` | Loopback & mic capture, FFT resampling to 16 kHz |
| **Agent pipeline** | Rust + `rig-core` + `tokio` | Native multi-agent graph — replaced the former Node pipeline |
| **Frontend** | React 18 + TypeScript + Vite + Tailwind | Single-window three-tab widget with a glass design system |
| **Sidecar runtime** | Node.js 20+ | STT/diarization (`gateway/`) and Ask Roxi (`chatbot/`) |
| **STT** | AssemblyAI + Speechmatics | Real-time streaming STT with automatic fallback |
| **LLM** | **OpenAI** — `gpt-4o-mini` (fast agents), `gpt-5.6-luna` (final synthesis) | All completions |
| **Embeddings** | **OpenAI `text-embedding-3-small`** (1,536-dim) | Document chunk and query vectors |
| **RAG framework** | `@langchain/langgraph` | Adaptive-RAG state graph for Ask Roxi |
| **Document parsing** | `pdf-parse`, `mammoth` | PDF and DOCX text extraction |
| **Database** | SQLite (`better-sqlite3` / `rusqlite`) | Meetings, transcripts, artifacts, FTS index, document vectors |

**Model tiering matters.** Most agents run on `gpt-4o-mini` for latency and cost; only the final `response_agent` uses the premium model. Tiers are set in one place — `src-tauri/src/application/agent_registry.rs` — not hardcoded per agent.

---

## 🚀 Quick Start

### 1. Prerequisites

- **Rust & Cargo** — [install](https://www.rust-lang.org/tools/install)
- **Node.js** `v20.x` or later
- **BlackHole 2ch** — the virtual audio driver used for loopback capture ([install](https://existential.audio/blackhole/)). The app detects whether it's present and guides you through setup.
- **API keys:**
  - [OpenAI](https://platform.openai.com/) — **required** (agents, Ask Roxi, embeddings)
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
# Required — all agent, chatbot and embedding calls
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

The widget opens automatically. Click **Start Capture**, give the meeting some context, and begin speaking or play audio through your system.

---

## ⚙️ Configuration

All variables live in the root `.env`. Only `OPENAI_API_KEY` plus one STT key are required; everything else has a working default.

### Required

| Variable | Description |
|---|---|
| `OPENAI_API_KEY` | All LLM completions and embeddings. Startup logs a fatal error if empty and agents will then fail with 401s. |
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

### Optional — Ask Roxi & documents

| Variable | Default | Description |
|---|---|---|
| `CHATBOT_MODEL` | `gpt-5.6-luna` | Chatbot completion model. |
| `CHATBOT_LLM_ADAPTER` | `openai` | Set `langchain` to swap the chatbot's LLM gateway. |
| `CHATBOT_LLM_BUDGET_SOFT` / `_HARD` | `60` / `80` | Chatbot's own budget guard. |
| `CHATBOT_EMBED_MODEL` | `text-embedding-3-small` | Embedding model. |
| `CHATBOT_EMBED_BUDGET_HARD` | `400` | **Separate** embedding call budget — one big upload must not exhaust the conversation's allowance. |
| `CHATBOT_MAX_DOCUMENT_BYTES` | `20 MiB` | Per-file upload cap. |
| `CHATBOT_MAX_LIBRARY_BYTES` | `200 MiB` | Total document library cap. |
| `CHATBOT_MAX_DOCUMENTS` | `50` | File-count backstop. |
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
│   ├── app/                    # App.tsx (idle screen or 3-tab session), main.tsx
│   ├── shell/                  # AppShell, NavigationTabs, WidgetHeader
│   ├── design-system/          # GlassCard, Badge, TagChip, Waveform, tokens.ts
│   ├── context/                # ServicesProvider — dependency injection over Tauri
│   ├── features/
│   │   ├── capture/            # useCaptureSession/Flow, IdleScreen, context-intake/
│   │   ├── transcript/         # TranscriptPane, SpeakerRenameModal, useTranscript
│   │   ├── suggest/            # SuggestAnswersPane, SuggestCard, tag filters
│   │   ├── chat/               # ChatPane, ChatThreadProvider, RoxiAnswerCard, SourceChip
│   │   ├── analysis/           # AnalysisPane
│   │   └── history/            # HistoryPane, MeetingDetailModal
│   ├── services/               # Tauri-backed implementations + wire types & mappers
│   ├── shared/                 # interfaces/ (5 service contracts), types/, ui/
│   └── styles.css              # Tailwind + the --glass-* opacity budget
│
├── gateway/                    # Node sidecar — STT + diarization ONLY
│   ├── sidecar.js              # PCM1 parser → ProviderManager → stdout JSON
│   ├── audio/pcm-deframer.js
│   ├── providers/              # assemblyai.js, speechmatics.js, mfcc.js
│   ├── stt/                    # provider-manager, diarization-layer, transcript-sanitizer
│   ├── config/                 # gateway's own env/argv resolution
│   ├── db/                     # index.js, migrate.js (forward-only)
│   └── state/, infrastructure/, tools/, lifecycle/
│
├── chatbot/                    # Node sidecar — Ask Roxi (meetings + documents)
│   ├── sidecar.js              # stdio JSON protocol entry
│   ├── bin/rebuild-index.js    # Rebuild the FTS5 index
│   ├── data/                   # chat_index.db (FTS5), doc_store.db (documents)
│   ├── test/                   # 199 node:test cases, zero network calls
│   └── src/
│       ├── composition/container.js     # DI root
│       ├── domain/ports/                # Retriever, EvidenceSource, EmbeddingGateway,
│       │                                #   DocumentParser, DocumentRepository, LlmGateway
│       ├── application/
│       │   ├── graph/                   # buildChatGraph, routing, evidence (citations)
│       │   ├── nodes/                   # analyze, retrieve, grade, rewrite, clarify, generate
│       │   ├── retrieval/               # CompositeEvidenceSource, rrf.js
│       │   └── useCases/                # AnswerQuestion, IndexDocument, ManageDocuments
│       ├── infrastructure/
│       │   ├── persistence/             # FtsRetriever, FtsIndexBuilder, FtsEvidenceSource
│       │   ├── documents/               # repository, chunker, parsers/, DocumentEvidenceSource
│       │   ├── embedding/               # OpenAiEmbeddingGateway
│       │   └── llm/, budget/, usage/, logging/
│       └── transport/stdioSidecar.js    # Protocol: Ask + Upload/List/Delete, two busy lanes
│
├── dashboard/                  # LLM usage dashboard (zero-build Express app)
│
└── src-tauri/                  # Rust backend
    ├── tauri.conf.json         # One window "main": 420×780, transparent, always-on-top
    └── src/
        ├── lib.rs              # Composition root: adapters, agents, commands, setup hook
        ├── macos_overlay.rs    # NSStatusWindowLevel + CanJoinAllSpaces FFI
        ├── application/        # agent_registry.rs (MODEL TIERS), capture_usecase.rs
        ├── agents/             # Rust-native LLM pipeline (hexagonal)
        │   ├── orchestrator/   # chunk_graph.rs, routing.rs (pure, unit-tested)
        │   ├── agents/         # context_manager, explanation, technical, analyst,
        │   │                   #   risk_detector, response_agent, chit_chat_gate
        │   ├── adapters/       # openai_adapter.rs, usage_store.rs
        │   └── ports/          # agent_port.rs, llm_port.rs
        ├── adapters/           # mac_audio, gateway_client, chat_client, sqlite
        ├── commands/           # capture, db, chat, audio_devices, speaker
        ├── sidecar/            # events.rs, event_router.rs, chat_events.rs
        ├── streaming.rs        # PCM1 framing sink
        └── resample.rs         # FFT audio resampler
```

---

## 🗄️ Database Schema

**Three separate SQLite databases**, never joined at the query level. The separation is deliberate — each has a different owner and lifetime.

| Database | Owner | Notes |
|---|---|---|
| `gateway/meeting_history.db` | gateway sidecar (write) | Read by Rust; opened **read-only** by the chatbot to avoid WAL conflicts between two Node processes. |
| `gateway/llm_usage.db` | Rust + chatbot (write) | One row per LLM/embedding call. Read by the dashboard. |
| `chatbot/data/chat_index.db` | chatbot | FTS5 index over meeting history. Wholesale-rebuilt — regenerate with `bin/rebuild-index.js`, never hand-edit. |
| `chatbot/data/doc_store.db` | chatbot | Uploaded documents and their vectors. Kept **out** of `chat_index.db` precisely because that file gets rebuilt. |

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

-- Extracted artifacts and speaker identity
CREATE TABLE decisions (...);        CREATE TABLE action_items (...);
CREATE TABLE risks (...);            CREATE TABLE technical_analyses (...);
CREATE TABLE suggested_replies (...); CREATE TABLE summaries (...);
CREATE TABLE glossary_terms (...);   CREATE TABLE speaker_profiles (...);
CREATE TABLE speaker_names (...);    CREATE TABLE speaker_embeddings (...);
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
npm test           # chatbot suite (199 tests)
npm run test:all   # chatbot + gateway (259 tests)
npm run lint       # tsc --noEmit

cd chatbot && node --test test/rrf.test.js        # a single file
cd src-tauri && cargo test routing::               # the Rust unit tests
```

**No test makes a network call.** Every OpenAI-touching class sits behind a port, so the suites run with fakes — LLM gateways, embedding gateways and evidence sources are all injected. Pure decision logic (`routing.js`, `rrf.js`, `evidence.js`, `chunker.js`, and Rust's `orchestrator::routing`) is dependency-free and unit-tested directly.

---

## 📊 Developer LLM Usage Dashboard

Every LLM request *and* embedding request — tokens, latency, cost, errors and the actual prompts — is persisted to `gateway/llm_usage.db`. A standalone dashboard inspects it:

```bash
npm run dashboard        # → http://localhost:3300
npm run dashboard:seed   # optional demo data
```

Four tabs: **Overview** (totals, tokens/cost over time, per-agent rollup), **Requests** (filterable table), **Request Detail** (exact prompt sent, params, response preview, and the file/function that made the call), and **API Call Map** (every LLM call site plus STT providers). See [`dashboard/README.md`](dashboard/README.md) for the data dictionary and privacy toggles (`LLM_TRACK_PAYLOADS=0` disables prompt storage).

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
3. **Set `"withGlobalTauri": false`** — verified 2026-09-07 that `window.__TAURI__` is referenced nowhere in `src/` or `index.html`, so this can be turned off safely.

> ⚠️ **The report is a point-in-time snapshot.** Several findings — particularly the LLM/agent-architecture ones — predate the migration to OpenAI and the Rust-native pipeline and are now stale. Verify against current code before acting on any individual finding. `TEST-001` (no gateway tests) has since been addressed: the gateway has 60.

### Architecture verdict

Clean separation of concerns — hexagonal architecture in Rust, ports-and-adapters in the chatbot, a layered pipeline in the gateway. The primary risks are security *configuration*, not architectural flaws.

---

## 📄 License

Licensed under the [MIT License](LICENSE).
