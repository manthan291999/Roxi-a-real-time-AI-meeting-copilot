# 🎙️ Roxi — AI Meeting Interpreter

Roxi is a real-time, desktop AI meeting copilot built for macOS. It listens to both your microphone and system audio, provides live streaming transcription, detects speakers, and generates real-time meeting insights (plain-English explanations, action items, risks, and suggested replies). 

It also includes an **Ask Roxi** RAG chat pane that answers questions across your past meeting history, uploaded documents, or live web search.

---

## ✨ Features

- **Live System Audio & Mic Capture**: Captures both sides of any meeting (Zoom, Google Meet, Teams, Slack) using macOS CoreAudio and BlackHole.
- **Ultra-Low Latency Streaming STT**: Live speech-to-text powered by AssemblyAI v3 WebSocket streaming with automatic fallback to Speechmatics.
- **Speaker Diarization**: Tracks speaker turns and matches returning voices across meetings using voice embeddings.
- **Real-Time Multi-Agent Insights**: Finalized speech chunks pass through an efficient Rust-native multi-agent pipeline:
  - *Chit-chat Gate*: Instantly filters small talk locally to save LLM cost.
  - *Context Manager*: Grades chunk importance and assigns complexity.
  - *Complexity Routing*: Runs lightweight agents for simple turns and parallel analysis (technical, risk, summary) for complex turns.
  - *Suggested Replies*: Real-time contextual reply suggestions you can use during the call.
- **Ask Roxi (Adaptive RAG Chat)**: A conversational sidecar that retrieves answers using:
  - **Meeting History** (BM25 lexical search via SQLite FTS5)
  - **Uploaded Documents** (Vector semantic search via Qdrant)
  - **Live Web Search** (Autonomous model-driven web search via OpenAI Responses API)
- **Native macOS Overlay**: A floating, transparent glass UI window built with Tauri v2 and native macOS vibrancy.
- **Projects & Session History**: Organize your meetings under projects and review past transcripts and action items anytime.

---

## 🛠️ Tech Stack

- **Frontend**: React 18, TypeScript, Tailwind CSS, Vite
- **Desktop Shell**: Tauri v2, Rust
- **Gateway Sidecar**: Node.js (Audio deframing, STT streaming, diarization, SQLite persistence)
- **Chatbot Sidecar**: Node.js (LangGraph Adaptive RAG, embeddings, web search)
- **Databases**:
  - SQLite (WAL mode for meeting transcripts, session history, and LLM usage)
  - Qdrant (Vector database for document and semantic embeddings)

---

## 📋 Prerequisites

Before running Roxi, make sure you have the following installed on macOS:

1. **Node.js**: `v20.x` or later (`node -v`)
2. **Rust & Cargo**: Latest stable Rust (`rustc --version`)
3. **BlackHole 2ch** (Required for system audio capture):
   ```bash
   brew install blackhole-2ch
   ```
4. **API Keys**:
   - **OpenAI API Key** (for agent analysis and chat)
   - **AssemblyAI API Key** (or Speechmatics API Key) for real-time STT

---

## 🚀 Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/manthan291999/final-meeting-interpreter.git
cd final-meeting-interpreter
```

### 2. Install dependencies

```bash
npm install
npm --prefix gateway install
npm --prefix chatbot install
```

### 3. Configure environment variables

Copy the template file to `.env` at the root of the project:

```bash
cp .env.example .env
```

Open `.env` and add your API keys:

```env
OPENAI_API_KEY=sk-...
ASSEMBLYAI_API_KEY=your_assemblyai_key_here
```

### 4. Fetch Qdrant binary (Vector Store)

Run the included fetch script to download the Qdrant binary:

```bash
./scripts/fetch-qdrant.sh
```

### 5. Launch the application

You can start everything with the automated startup script:

```bash
./run.sh
```

Or run directly in development mode using npm:

```bash
npm run tauri dev
```

---

## 🎧 Audio Setup (macOS)

To capture both your microphone and incoming meeting audio:

1. Open **Audio MIDI Setup** on your Mac (press `Cmd + Space` and search for "Audio MIDI Setup").
2. Click the `+` icon at the bottom-left and select **Create Multi-Output Device**.
3. Check both:
   - Your primary output (e.g. **MacBook Speakers** or **Headphones**)
   - **BlackHole 2ch**
4. Set your system sound output to this newly created **Multi-Output Device**.
5. Inside the Roxi app, choose **BlackHole 2ch** as your capture source.

---

## 🧪 Testing

Run all test suites across frontend, gateway, and chatbot:

```bash
# Run all tests (frontend vitest + chatbot + gateway)
npm run test:all

# Frontend unit tests only
npm run test:frontend

# Gateway tests
cd gateway && npm test

# Chatbot tests
cd chatbot && npm test

# Rust core tests
cd src-tauri && cargo test

# TypeScript typecheck
npm run lint
```

---

## 📂 Project Structure

```text
├── src/                  # React + TypeScript frontend (App, UI tabs, design tokens)
│   ├── app/              # App root and navigation
│   ├── features/         # Features: capture, suggest, chat, history, settings
│   └── design-system/    # UI components, Markdown renderers, styling tokens
├── src-tauri/            # Tauri desktop shell and Rust core engine
│   └── src/
│       ├── adapters/     # CoreAudio capture, Qdrant client, SQLite storage
│       ├── agents/       # Rust multi-agent ChunkGraph and prompt compiler
│       └── sidecar/      # Subprocess lifecycle management and IPC routing
├── gateway/              # Audio ingestion & STT sidecar (Node.js)
│   ├── stt/              # AssemblyAI & Speechmatics streaming clients
│   ├── diarization/      # Speaker embedding and turn clustering
│   └── db/               # Meeting SQLite repository and migrations
├── chatbot/              # Adaptive RAG & Ask Roxi sidecar (Node.js)
│   ├── src/application/  # LangGraph graph, routing, triage guardrails
│   └── src/domain/       # Document ingestion, vector sync, web citations
├── dashboard/            # LLM token usage and cost tracking dashboard
├── scripts/              # Helper scripts (e.g. fetch-qdrant.sh)
└── run.sh                # Interactive startup and diagnostic script
```

---

## 📄 License

This project is licensed under the terms described in the [LICENSE](LICENSE) file.
