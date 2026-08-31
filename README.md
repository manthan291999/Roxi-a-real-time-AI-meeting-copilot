# 🎙️ AI Meeting Interpreter

<div align="center">

![Tauri](https://img.shields.io/badge/Tauri_2.x-24C8D8?style=for-the-badge&logo=tauri&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white)
![React](https://img.shields.io/badge/React_18-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![AssemblyAI](https://img.shields.io/badge/AssemblyAI_v3-0052FF?style=for-the-badge&logoColor=white)
![Speechmatics](https://img.shields.io/badge/Speechmatics-00A550?style=for-the-badge&logoColor=white)
![Groq](https://img.shields.io/badge/Groq_LLM-F55036?style=for-the-badge&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white)

**A high-performance, real-time desktop copilot that listens to your meetings, transcribes speech with ultra-low latency, and translates complex discussions into plain-language context, actionable decisions, and suggested replies.**

[Features](#-key-features) • [Architecture](#-architecture) • [Tech Stack](#-tech-stack) • [Quick Start](#-quick-start) • [Configuration](#-configuration) • [Project Structure](#-project-structure) • [LLM Usage Dashboard](#-developer-llm-usage-dashboard) • [Audit](#-code-audit)

</div>

---

## 📖 Overview

**AI Meeting Interpreter** is an AI-powered desktop application built on **Tauri v2**, **Rust**, **React**, and **TypeScript**. 

Designed for professionals, non-technical stakeholders, and cross-functional teams, it captures combined system audio and microphone streams, delivers live transcription powered by **AssemblyAI Universal-3 Streaming STT** (with **Speechmatics** as automatic fallback), and routes semantic transcript batches through an autonomous **Groq (Llama 3)** multi-agent reasoning pipeline.

### Three Synchronized Panels:
1. **Live Transcript** — Instantaneous real-time transcription with speaker labeling and partial/final utterance buffering.
2. **Plain-Language Context** — Translates engineering jargon, technical acronyms, and complex discussions into concise, simple explanations.
3. **Suggested Response & Insights** — Automatically identifies decisions, extracts action items with assignees, detects risks, and recommends contextual replies you can speak in the meeting.

---

## ✨ Key Features

- 🎧 **Hybrid Audio Capture**: Captures native system output (loopback) and microphone input simultaneously via `cpal`, resampled to 16kHz mono PCM16 using high-quality FFT resampling (`rubato`).
- ⚡ **Ultra-Low Latency Streaming STT**: Uses AssemblyAI v3 WebSocket Streaming protocol with automatic fallback to Speechmatics real-time STT via `ProviderManager`.
- 🗣️ **Speaker Diarization**: MFCC-based voice embeddings with cosine similarity matching for cross-session speaker identification.
- 🧠 **Multi-Agent Groq LLM Pipeline**:
  - **Context Manager**: Dynamically tracks meeting topic, maintains a rolling summary, extracts technical terms, and grades chunk significance (`none` | `low` | `medium` | `high`).
  - **Explanation Agent**: Generates plain-language breakdowns for non-technical listeners whenever technical discussion occurs.
  - **Technical Agent**: Provides detailed technical explanations for complex topics.
  - **Meeting Analyst**: Extracts concrete decisions and assigned action items with deadlines.
  - **Risk Agent**: Identifies risks, blockers, and concerns with severity levels.
  - **Response Agent**: Formulates natural, contextual replies for the meeting participant.
- 🛡️ **Intelligent Resilience**:
  - **Circuit Breaker**: Auto-caps API usage to prevent runaway costs during long meetings.
  - **Key Pool Rotation**: Multiple Groq API keys with health tracking and automatic rotation.
  - **Graceful Shutdown**: Drains buffers, attempts AI summary with fallback template, and persists all data.
  - **Robust IPC Framing**: Binary framed communication (`PCM1` protocol) between Rust and Node.js sidecar over standard streams.
- 💾 **SQLite Persistence**: Forward-only migration system with WAL mode for concurrent read/write access.
- 🎨 **Modern Glassmorphism UI**: Dark-themed React UI with real-time audio energy pulsing, significance indicators, and auto-scrolling panels.

---

## 🏛️ Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                        TAURI DESKTOP APPLICATION                       │
│                                                                        │
│  ┌──────────────────────┐               ┌───────────────────────────┐  │
│  │   React + TypeScript │ ◄─ Tauri IPC ─┤      Rust Core Engine     │  │
│  │   Glassmorphism UI   │    Events     │      (src-tauri/src)      │  │
│  └──────────────────────┘               └─────────────┬─────────────┘  │
│                                                       │                │
│                                             Audio Pipeline (cpal)      │
│                                             Resampler (rubato)         │
│                                             StreamingSink (PCM1)       │
│                                                       │                │
│                                                       ▼  (framed PCM)  │
│                                         ┌───────────────────────────┐  │
│                                         │      Node.js Sidecar      │  │
│                                         │    (gateway/sidecar.js)   │  │
│                                         └─────────────┬─────────────┘  │
└───────────────────────────────────────────────────────┼────────────────┘
                                                        │
                         ┌──────────────────────────────┴──────────────────────────────┐
                         │                                                             │
                         ▼ (Binary WebSocket)                                          ▼ (HTTPS / JSON)
            ┌───────────────────────────┐                                ┌───────────────────────────┐
            │   AssemblyAI / Speechmatics│                                │       Groq LLM API        │
            │   Real-Time Streaming STT  │                                │  (Llama 3 Multi-Agent)    │
            └───────────────────────────┘                                └───────────────────────────┘
```

### Pipeline Flow

```
Audio Capture → PCM1 Framing → STT Provider → Transcript Sanitizer → Semantic Buffer
    → Chunk Runner → Agent Orchestrator → Chunk Broadcaster → Tauri Events → React UI
```

---

## 🛠️ Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Desktop Shell** | Tauri v2 (`@tauri-apps/cli`) | Lightweight native macOS/Windows/Linux window wrapper |
| **Audio Capture** | Rust + `cpal` + `rubato` | Cross-platform audio device capture, loopback & FFT resampling |
| **Frontend** | React 18 + TypeScript + Vite | Reactive UI with Tailwind CSS styling |
| **Sidecar Runtime**| Node.js 20+ | Orchestrates streaming STT, buffer management, and LLM queries |
| **STT Provider** | AssemblyAI (`@assemblyai/sdk`) + Speechmatics (`@speechmatics/real-time-client`) | Real-time streaming speech-to-text with automatic fallback |
| **LLM Provider** | Groq (`groq-sdk`) | Multi-agent analysis via Llama 3 models with key pool rotation |
| **Database** | SQLite (`better-sqlite3` / `rusqlite`) | Meeting session history, transcripts, decisions, and action items |
| **Styling** | Tailwind CSS | Dark glassmorphism theme |

---

## 🚀 Quick Start

### 1. Prerequisites

Ensure the following tools are installed on your machine:
- **Rust & Cargo**: [Install Rust](https://www.rust-lang.org/tools/install) (`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`)
- **Node.js**: `v20.x` or later ([Download](https://nodejs.org/))
- **API Keys**:
  - [AssemblyAI API Key](https://www.assemblyai.com/) (primary STT)
  - [Speechmatics API Key](https://www.speechmatics.com/) (fallback STT, optional)
  - [Groq API Key](https://console.groq.com/) (LLM pipeline)

### 2. Clone the Repository

```bash
git clone https://github.com/manthan291999/meeting-interpreter.git
cd meeting-interpreter
```

### 3. Install Dependencies

Install root and gateway dependencies:

```bash
# Install frontend & Tauri CLI dependencies
npm install

# Install gateway (sidecar) dependencies
cd gateway
npm install
cd ..
```

### 4. Configure Environment Variables

Create `gateway/.env` by copying the example template:

```bash
cp gateway/.env.example gateway/.env
```

Edit `gateway/.env` with your API keys:

```env
# AssemblyAI API Key — primary real-time streaming STT
ASSEMBLYAI_API_KEY=your_assemblyai_key_here

# Speechmatics API Key — fallback STT (optional but recommended)
SPEECHMATICS_API_KEY=your_speechmatics_key_here

# Groq API Keys — multi-stage LLM pipeline (at least one required)
GROQ_API_KEY_1=your_groq_key_1
GROQ_API_KEY_2=your_groq_key_2
GROQ_API_KEY_3=your_groq_key_3
```

> **Note:** At least one STT provider key (AssemblyAI or Speechmatics) and at least one Groq key are required.

### 5. Run in Development Mode

```bash
npm run tauri dev
```

The application window will open automatically. Click **"Start Capture"** and begin speaking or play audio through your system.

---

## ⚙️ Configuration

| Variable | Required | Description |
|---|:---:|---|
| `ASSEMBLYAI_API_KEY` | **Yes*** | API key for AssemblyAI real-time streaming speech-to-text. |
| `SPEECHMATICS_API_KEY` | *No* | API key for Speechmatics fallback STT. |
| `GROQ_API_KEY_1` | **Yes*** | Primary Groq API key for LLM analysis. |
| `GROQ_API_KEY_2` | *No* | Secondary Groq key for rotation. |
| `GROQ_API_KEY_3` | *No* | Tertiary Groq key for rotation. |

*At least one STT key and one Groq key are required.

---

## 📁 Project Structure

```text
meeting-interpreter/
├── index.html                  # React app shell
├── package.json                # Root manifest: vite/typescript/tauri devDeps
├── tailwind.config.js          # Tailwind styling rules
├── brain.md                    # Core architectural blueprint & AI agent guidelines
├── README.md                   # Project documentation
├── audit/                      # Code audit reports
│   └── CODE-AUDIT-REPORT.md    # Full codebase audit findings
│
├── src/                        # Frontend UI source (React + TypeScript)
│   ├── App.tsx                 # Main React component (3-pane layout)
│   ├── main.tsx                # React DOM entry point
│   ├── index.css               # Tailwind directives + global styles
│   ├── features/
│   │   ├── capture/            # Live capture view components
│   │   └── history/            # Meeting history view components
│   ├── hooks/
│   │   └── useTauriEvents.ts   # Tauri event subscription hook
│   ├── services/
│   │   └── TauriEventBus.ts    # Event bus abstraction
│   └── interfaces/
│       └── IEventBus.ts        # Event bus interface
│
├── gateway/                    # Node.js sidecar engine
│   ├── sidecar.js              # Main entry: audio parser → pipeline → stdout JSON
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
│   │   └── mfcc.js             # Pure-JS MFCC feature extractor
│   ├── stt/
│   │   ├── provider-manager.js # STT fallback chain management
│   │   ├── diarization-layer.js # Speaker identification
│   │   └── transcript-sanitizer.js # Text cleaning
│   ├── llm/
│   │   ├── groq-client.js      # Groq API wrapper
│   │   ├── groq-key-pool.js    # Multi-key rotation
│   │   └── model-discovery.js  # Dynamic model selection
│   ├── db/
│   │   ├── index.js            # SQLite persistence layer
│   │   └── migrate.js          # Forward-only migrations
│   ├── state/
│   │   ├── meeting-state.js    # In-memory meeting context
│   │   ├── prompt-builder.js   # LLM prompt construction
│   │   └── speaker-tracker.js  # Speaker statistics
│   ├── infrastructure/
│   │   ├── logger.js           # Structured logging
│   │   ├── validate.js         # Input sanitization
│   │   ├── billing-tracker.js  # API usage tracking
│   │   └── text-similarity.js  # Deduplication
│   ├── lifecycle/
│   │   └── shutdown.js         # Graceful shutdown handler
│   ├── config/
│   │   └── agent-config.js     # Agent model/timeout config
│   └── .env                    # API keys (gitignored)
│
└── src-tauri/                  # Rust backend engine
    ├── Cargo.toml              # Rust crate dependencies
    ├── tauri.conf.json         # Tauri v2 application config
    ├── capabilities/
    │   └── default.json        # Tauri permissions
    └── src/
        ├── main.rs             # Binary entry point
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

---

## 🗄️ Database Schema

SQLite database located at `gateway/meeting_history.db`. Schema maintained via forward-only migrations in `gateway/db/migrate.js`.

### Core Tables

```sql
-- Meeting sessions
CREATE TABLE meetings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    end_time DATETIME,
    context TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    api_calls INTEGER NOT NULL DEFAULT 0,
    provider TEXT,
    summary TEXT
);

-- Raw transcripts
CREATE TABLE transcripts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_id INTEGER REFERENCES meetings(id),
    speaker TEXT,
    text TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Analyzed chunks
CREATE TABLE chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_id INTEGER NOT NULL REFERENCES meetings(id),
    seq INTEGER NOT NULL,
    speaker TEXT,
    text TEXT NOT NULL,
    significance TEXT,
    topic TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (meeting_id, seq)
);

-- Extracted artifacts
CREATE TABLE decisions (...);
CREATE TABLE action_items (...);
CREATE TABLE risks (...);
CREATE TABLE technical_analyses (...);
CREATE TABLE suggested_replies (...);
CREATE TABLE summaries (...);
CREATE TABLE glossary_terms (...);
CREATE TABLE speaker_profiles (...);
CREATE TABLE speaker_names (...);
CREATE TABLE speaker_embeddings (...);
```

---

## 📊 Developer LLM Usage Dashboard

Every LLM request made by the capture pipeline and the chatbot is persisted
(tokens, latency, cost, errors, and the actual prompts) into
`gateway/llm_usage.db`. A standalone dashboard lets any developer inspect it:

```bash
cd dashboard
npm install
npm run seed    # optional demo data
npm start       # → http://localhost:3300
```

Four tabs: **Overview** (totals, tokens/cost over time, per-agent rollup),
**Requests** (filterable per-request table), **Request Detail** (exact prompt
sent, params, response preview, and which file/function made the call), and
**API Call Map** (every LLM call site in the codebase + STT providers).
See [`dashboard/README.md`](dashboard/README.md) for the data dictionary and
privacy toggles (`LLM_TRACK_PAYLOADS=0` disables prompt storage).

---

## 📦 Building for Production

To compile a native executable for your current operating system:

```bash
npm run tauri build
```

The resulting standalone application bundle (`.dmg` on macOS, `.msi`/`.exe` on Windows, `.deb`/`.AppImage` on Linux) will be output to `src-tauri/target/release/bundle/`.

---

## 🔍 Code Audit

A comprehensive code audit was performed on **2026-08-26**. The full report is available at [`audit/CODE-AUDIT-REPORT.md`](audit/CODE-AUDIT-REPORT.md).

### Audit Summary

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

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).